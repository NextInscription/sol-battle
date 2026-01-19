import { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Connection, PublicKey, TransactionInstruction, Transaction, SystemProgram } from '@solana/web3.js';
import { useNavigate } from 'react-router-dom';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { useToast } from '../hooks/useToast';

import { RPC_ENDPOINT, COMMITMENT, PROGRAM_ID } from '../config/network';

const connection = new Connection(RPC_ENDPOINT, COMMITMENT);
const PROGRAM_ID_PUBKEY = new PublicKey(PROGRAM_ID);

type BattleState = 'WaitingForChallenger' | 'WaitingCreatorReveal' | 'BothRevealed' | 'Settled';
type GameType = 'CoinFlip' | 'DiceRoll';

interface HistoryBattle {
  battlePda: string;
  battleId: BN;
  creator: string;
  challenger: string | null;
  betAmountSol: number;
  gameType: GameType;
  state: BattleState;
  winner: string | null;
  createdAtSlot: BN;
  joinedAtSlot: BN | null;
  noChallengerTimeoutSlots: BN;
  revealTimeoutSlots: BN;
  isCreator: boolean;
  result?: 'Won' | 'Lost' | 'In Progress' | 'Refunded';
}

const gameStateLabels: Record<BattleState, string> = {
  WaitingForChallenger: 'Waiting for Challenger',
  WaitingCreatorReveal: 'Waiting Reveal',
  BothRevealed: 'Both Revealed',
  Settled: 'Settled',
};

const gameTypeLabels: Record<GameType, string> = {
  CoinFlip: 'Flip Card',
  DiceRoll: 'Dice Roll',
};

export default function History() {
  const navigate = useNavigate();
  const { publicKey, signTransaction } = useWallet();
  const toast = useToast();
  const [battles, setBattles] = useState<HistoryBattle[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedFilter, setSelectedFilter] = useState<string>('All');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [refundableBattles, setRefundableBattles] = useState<Set<string>>(new Set());
  const [timeoutWins, setTimeoutWins] = useState<Set<string>>(new Set());

  const filters = ['All', 'Created', 'Joined', 'Won', 'Lost'];

  useEffect(() => {
    if (publicKey) {
      fetchHistory();
    }
  }, [publicKey]);

  const fetchHistory = async () => {
    if (!publicKey) return;

    try {
      setLoading(true);

      console.log('🔍 Fetching battle history for:', publicKey.toBase58());

      // 获取所有 program accounts
      const accounts = await connection.getProgramAccounts(PROGRAM_ID_PUBKEY);
      console.log('📊 Total program accounts:', accounts.length);

      const historyBattles: HistoryBattle[] = [];

      for (const account of accounts) {
        const data = account.account.data;
        const pubkey = account.pubkey;

        // 检查是否是 Battle 账户 (检查 discriminator 和 creator/challenger)
        const discriminator = data.subarray(0, 8);
        const battleDiscriminator = Buffer.from([81, 148, 121, 71, 63, 166, 116, 24]);

        if (!discriminator.equals(battleDiscriminator)) continue;

        // 使用动态 offset 解析
        let offset = 8; // 跳过 discriminator

        // battle_id (u64 = 8 bytes)
        const battleId = new BN(data.subarray(offset, offset + 8), 'le');
        offset += 8;

        // creator (pubkey = 32 bytes)
        const creator = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
        offset += 32;

        // challenger (option pubkey = 1 byte tag + 32 bytes)
        const challengerTag = data.readUInt8(offset);
        offset += 1;
        let challenger = null;
        if (challengerTag !== 0) {
          challenger = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
          offset += 32;
        }

        // 检查是否与当前用户相关
        const isCreator = creator === publicKey.toBase58();
        const isChallenger = challenger === publicKey.toBase58();

        if (!isCreator && !isChallenger) continue;

        // bet_amount (u64 = 8 bytes)
        const betAmountLamports = new BN(data.subarray(offset, offset + 8), 'le');
        const betAmountSol = parseFloat(betAmountLamports.toString()) / LAMPORTS_PER_SOL;
        offset += 8;

        // 跳过 commit_creator (32 bytes)
        offset += 32;

        // 跳过 commit_challenger (1 byte tag + 32 bytes if present)
        const commitChallengerTag = data.readUInt8(offset);
        offset += 1;
        if (commitChallengerTag !== 0) {
          offset += 32;
        }

        // 跳过 seed_creator (1 byte tag + 32 bytes if present)
        const seedCreatorTag = data.readUInt8(offset);
        offset += 1;
        if (seedCreatorTag !== 0) {
          offset += 32;
        }

        // 跳过 seed_challenger (1 byte tag + 32 bytes if present)
        const seedChallengerTag = data.readUInt8(offset);
        offset += 1;
        if (seedChallengerTag !== 0) {
          offset += 32;
        }

        // game_type (enum = 1 byte)
        const gameTypeValue = data.readUInt8(offset);
        offset += 1;
        const gameType: GameType = gameTypeValue === 0 ? 'CoinFlip' : 'DiceRoll';

        // state (enum = 1 byte)
        const stateValue = data.readUInt8(offset);
        offset += 1;
        const state: BattleState = ['WaitingForChallenger', 'WaitingCreatorReveal', 'BothRevealed', 'Settled'][stateValue] as BattleState;

        // winner (option pubkey = 1 byte tag + 32 bytes)
        const winnerTag = data.readUInt8(offset);
        offset += 1;
        let winner: string | null = null;
        if (winnerTag !== 0) {
          winner = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
          offset += 32;
        }

        // created_at_slot (u64 = 8 bytes)
        const createdAtSlot = new BN(data.subarray(offset, offset + 8), 'le');
        offset += 8;

        // joined_at_slot (option u64 = 1 byte tag + 8 bytes)
        const joinedAtTag = data.readUInt8(offset);
        offset += 1;
        let joinedAtSlot = null;
        if (joinedAtTag !== 0) {
          joinedAtSlot = new BN(data.subarray(offset, offset + 8), 'le');
          offset += 8;
        }

        // config_snapshot (struct: fee_bps(u16) + reveal_timeout_slots(u64) + no_challenger_timeout_slots(u64))
        // fee_bps (u16 = 2 bytes)
        offset += 2;

        // reveal_timeout_slots (u64 = 8 bytes)
        const revealTimeoutSlots = new BN(data.subarray(offset, offset + 8), 'le');
        offset += 8;

        // no_challenger_timeout_slots (u64 = 8 bytes)
        const noChallengerTimeoutSlots = new BN(data.subarray(offset, offset + 8), 'le');
        offset += 8;

        // bump (1 byte) - 跳过
        offset += 1;

        // 计算结果
        let result: 'Won' | 'Lost' | 'In Progress' | 'Refunded' | undefined;
        if (state === 'Settled') {
          if (winner === publicKey.toBase58()) {
            result = 'Won';
          } else {
            result = 'Lost';
          }
        } else if (state === 'WaitingForChallenger' && isCreator) {
          result = 'Refunded';
        } else {
          result = 'In Progress';
        }

        historyBattles.push({
          battlePda: pubkey.toBase58(),
          battleId,
          creator,
          challenger,
          betAmountSol: betAmountSol,
          gameType,
          state,
          winner,
          createdAtSlot,
          joinedAtSlot,
          noChallengerTimeoutSlots,
          revealTimeoutSlots,
          isCreator,
          result,
        });
      }

      // 按 battleId 降序排序
      historyBattles.sort((a, b) => b.battleId.sub(a.battleId).toNumber());

      setBattles(historyBattles);

      // 异步检查哪些 battle 可以执行操作
      const checkActions = async () => {
        const refundable = new Set<string>();
        const timeoutWin = new Set<string>();

        for (const battle of historyBattles) {
          // 检查是否可以退款
          const canRefund = battle.isCreator && battle.state === 'WaitingForChallenger';
          if (canRefund) {
            try {
              const currentSlot = await connection.getSlot();
              const deadlineSlot = battle.createdAtSlot.toNumber() + battle.noChallengerTimeoutSlots.toNumber();
              if (currentSlot >= deadlineSlot) {
                refundable.add(battle.battlePda);
              }
            } catch (e) {
              console.error('Error checking refund:', e);
            }
          }

          // 检查是否可以超时获胜
          const canWin = !battle.isCreator && battle.state === 'WaitingCreatorReveal' && battle.joinedAtSlot;
          if (canWin) {
            try {
              const currentSlot = await connection.getSlot();
              const deadlineSlot = battle.joinedAtSlot!.toNumber() + battle.revealTimeoutSlots.toNumber();
              if (currentSlot >= deadlineSlot) {
                timeoutWin.add(battle.battlePda);
              }
            } catch (e) {
              console.error('Error checking timeout win:', e);
            }
          }
        }

        setRefundableBattles(refundable);
        setTimeoutWins(timeoutWin);
      };

      checkActions();
    } catch (error) {
      console.error('Failed to fetch history:', error);
    } finally {
      setLoading(false);
    }
  };

  // 获取指令 discriminator
  const getRefundNoChallengerDiscriminator = () => Buffer.from([72, 82, 83, 129, 67, 12, 17, 26]);
  const getClaimCreatorTimeoutWinDiscriminator = () => Buffer.from([58, 123, 123, 193, 154, 220, 27, 146]);

  // 1. 退款（没人加入）
  const handleClaimRefund = async (battle: HistoryBattle) => {
    if (!publicKey || !signTransaction) {
      toast.warning('Please connect your wallet first');
      return;
    }

    try {
      setActionLoading(battle.battlePda);

      const [configPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('config')],
        PROGRAM_ID_PUBKEY
      );

      const [battlePda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('battle'),
          new PublicKey(battle.creator).toBuffer(),
          Buffer.from(battle.battleId.toArray('le', 8)),
        ],
        PROGRAM_ID_PUBKEY
      );

      // 构建指令数据
      const data = Buffer.alloc(8);
      getRefundNoChallengerDiscriminator().copy(data, 0);

      const instruction = new TransactionInstruction({
        keys: [
          { pubkey: configPda, isSigner: false, isWritable: true },
          { pubkey: battlePda, isSigner: false, isWritable: true },
          { pubkey: publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: PROGRAM_ID_PUBKEY,
        data,
      });

      const transaction = new Transaction();
      transaction.feePayer = publicKey;
      transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      transaction.add(instruction);

      const signedTx = await signTransaction(transaction);
      await connection.sendRawTransaction(signedTx.serialize());

      toast.success('Refund successful!', 3000);
      setTimeout(() => fetchHistory(), 2000);
    } catch (error) {
      console.error('Refund failed:', error);
      const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
      toast.error(`Refund failed: ${errorMessage}`, 5000);
    } finally {
      setActionLoading(null);
    }
  };

  // 2. 挑战者超时获胜（创建者未揭示）
  const handleClaimTimeoutWin = async (battle: HistoryBattle) => {
    if (!publicKey || !signTransaction) {
      toast.warning('Please connect your wallet first');
      return;
    }

    try {
      setActionLoading(battle.battlePda);

      const [configPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('config')],
        PROGRAM_ID_PUBKEY
      );

      const [battlePda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('battle'),
          new PublicKey(battle.creator).toBuffer(),
          Buffer.from(battle.battleId.toArray('le', 8)),
        ],
        PROGRAM_ID_PUBKEY
      );

      // 获取 fee_recipient (config authority)
      const configAccount = await connection.getAccountInfo(configPda);
      if (!configAccount) throw new Error('Config account not found');
      const feeRecipient = new PublicKey(configAccount.data.subarray(8, 40));

      // 构建指令数据
      const data = Buffer.alloc(8);
      getClaimCreatorTimeoutWinDiscriminator().copy(data, 0);

      const instruction = new TransactionInstruction({
        keys: [
          { pubkey: configPda, isSigner: false, isWritable: true },
          { pubkey: battlePda, isSigner: false, isWritable: true },
          { pubkey: publicKey, isSigner: true, isWritable: true },
          { pubkey: feeRecipient, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: PROGRAM_ID_PUBKEY,
        data,
      });

      const transaction = new Transaction();
      transaction.feePayer = publicKey;
      transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      transaction.add(instruction);

      const signedTx = await signTransaction(transaction);
      await connection.sendRawTransaction(signedTx.serialize());

      toast.success('Claimed timeout win!', 3000);
      setTimeout(() => fetchHistory(), 2000);
    } catch (error) {
      console.error('Claim timeout win failed:', error);
      const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
      toast.error(`Failed: ${errorMessage}`, 5000);
    } finally {
      setActionLoading(null);
    }
  };

  const filteredBattles = battles.filter(battle => {
    if (selectedFilter === 'All') return true;
    if (selectedFilter === 'Created') return battle.isCreator;
    if (selectedFilter === 'Joined') return !battle.isCreator;
    if (selectedFilter === 'Won') return battle.result === 'Won';
    if (selectedFilter === 'Lost') return battle.result === 'Lost';
    return true;
  });

  return (
    <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden bg-background-dark">
      {/* Header */}
      <header className="sticky top-0 z-50 flex items-center bg-background-dark/80 backdrop-blur-md p-4 border-b border-white/5 justify-between max-w-7xl mx-auto w-full px-4">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-[#9db4b9] hover:text-white transition-colors"
        >
          <span className="material-symbols-outlined">arrow_back</span>
          <span className="text-sm font-medium">Back</span>
        </button>
        <h2 className="text-white text-base font-bold leading-tight tracking-tight">Battle History</h2>
        <div className="w-20"></div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-8">
        {/* Filters */}
        <div className="mb-6">
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
            {filters.map((filter) => (
              <button
                key={filter}
                onClick={() => setSelectedFilter(filter)}
                className={`flex h-9 shrink-0 items-center justify-center gap-x-2 rounded-full px-4 cursor-pointer transition-colors ${
                  selectedFilter === filter ? 'bg-primary' : 'bg-[#283639] hover:bg-[#34464a]'
                }`}
              >
                <p
                  className={`text-sm ${selectedFilter === filter ? 'text-background-dark font-bold' : 'text-white font-medium'}`}
                >
                  {filter}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* Battle List */}
        {loading ? (
          <div className="text-center py-12">
            <p className="text-[#9db4b9]">Loading history...</p>
          </div>
        ) : filteredBattles.length === 0 ? (
          <div className="text-center py-12">
            <div className="flex items-center justify-center mb-4">
              <div className="text-[#9db4b9] flex items-center justify-center rounded-lg bg-[#283639] shrink-0 size-16">
                <span className="material-symbols-outlined text-3xl">history</span>
              </div>
            </div>
            <p className="text-[#9db4b9]">No battle history found</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredBattles.map((battle) => (
              <div
                key={battle.battlePda}
                onClick={() => {
                  if (battle.state !== 'Settled') {
                    navigate(`/battle/${battle.battlePda}`);
                  }
                }}
                className={`bg-[#1c2527] rounded-xl p-4 border border-white/5 transition-colors ${
                  battle.state !== 'Settled'
                    ? 'hover:border-primary/50 cursor-pointer hover:shadow-lg'
                    : 'cursor-default opacity-70'
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`flex items-center justify-center rounded-lg shrink-0 size-10 ${
                      battle.result === 'Won' ? 'bg-green-500/10' :
                      battle.result === 'Lost' ? 'bg-red-500/10' :
                      battle.result === 'In Progress' ? 'bg-blue-500/10' :
                      'bg-yellow-500/10'
                    }`}>
                      <span className={`material-symbols-outlined text-xl ${
                        battle.result === 'Won' ? 'text-green-500' :
                        battle.result === 'Lost' ? 'text-red-500' :
                        battle.result === 'In Progress' ? 'text-blue-500' :
                        'text-yellow-500'
                      }`}>
                        {battle.result === 'Won' ? 'emoji_events' :
                         battle.result === 'Lost' ? 'cancel' :
                         battle.result === 'In Progress' ? 'pending' :
                         'autorenew'}
                      </span>
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-white font-bold">#{battle.battleId.toNumber()}</span>
                        <span className="text-[#9db4b9] text-xs">•</span>
                        <span className="text-[#9db4b9] text-xs">{gameTypeLabels[battle.gameType]}</span>
                      </div>
                      <p className="text-[#9db4b9] text-xs">
                        {battle.isCreator ? 'Created' : 'Joined'}
                      </p>
                    </div>
                  </div>

                  <div className="text-right">
                    <p className="text-white text-lg font-bold">{battle.betAmountSol} SOL</p>
                    <p className={`text-xs font-medium ${
                      battle.result === 'Won' ? 'text-green-500' :
                      battle.result === 'Lost' ? 'text-red-500' :
                      battle.result === 'In Progress' ? 'text-blue-500' :
                      'text-yellow-500'
                    }`}>
                      {battle.result || 'In Progress'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-[#9db4b9] pt-3 border-t border-white/5">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-sm">person</span>
                    <span className="font-mono">{battle.creator.slice(0, 4)}...{battle.creator.slice(-4)}</span>
                  </div>
                  <span>vs</span>
                  <div className="flex items-center gap-2">
                    {battle.challenger ? (
                      <>
                        <span className="font-mono">{battle.challenger.slice(0, 4)}...{battle.challenger.slice(-4)}</span>
                      </>
                    ) : (
                      <span>Waiting for challenger</span>
                    )}
                  </div>
                </div>

                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className="text-[#9db4b9]">{gameStateLabels[battle.state]}</span>
                  {battle.winner && (
                    <span className="text-primary">Winner: {battle.winner.slice(0, 4)}...{battle.winner.slice(-4)}</span>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="mt-3 pt-3 border-t border-white/5">
                  {refundableBattles.has(battle.battlePda) && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleClaimRefund(battle);
                      }}
                      disabled={actionLoading === battle.battlePda}
                      className="w-full flex items-center justify-center gap-2 rounded-lg h-10 text-sm font-medium transition-all active:scale-95 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-500 border border-yellow-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {actionLoading === battle.battlePda ? (
                        <>
                          <span className="material-symbols-outlined animate-spin text-sm">sync</span>
                          <span>Processing...</span>
                        </>
                      ) : (
                        <>
                          <span className="material-symbols-outlined text-sm">autorenew</span>
                          <span>Claim Refund (Timeout)</span>
                        </>
                      )}
                    </button>
                  )}

                  {timeoutWins.has(battle.battlePda) && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleClaimTimeoutWin(battle);
                      }}
                      disabled={actionLoading === battle.battlePda}
                      className="w-full flex items-center justify-center gap-2 rounded-lg h-10 text-sm font-medium transition-all active:scale-95 bg-green-500/10 hover:bg-green-500/20 text-green-500 border border-green-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {actionLoading === battle.battlePda ? (
                        <>
                          <span className="material-symbols-outlined animate-spin text-sm">sync</span>
                          <span>Processing...</span>
                        </>
                      ) : (
                        <>
                          <span className="material-symbols-outlined text-sm">emoji_events</span>
                          <span>Claim Timeout Win</span>
                        </>
                      )}
                    </button>
                  )}

                  {battle.state === 'Settled' && !battle.winner && (
                    <div className="text-center text-xs text-[#9db4b9]">
                      Battle settled
                    </div>
                  )}

                  {battle.state === 'BothRevealed' && (
                    <div className="text-center text-xs text-[#9db4b9]">
                      Waiting for settlement
                    </div>
                  )}

                  {battle.state === 'WaitingForChallenger' && !battle.isCreator && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/`);
                      }}
                      className="w-full flex items-center justify-center gap-2 rounded-lg h-10 text-sm font-medium transition-all active:scale-95 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30"
                    >
                      <span className="material-symbols-outlined text-sm">search</span>
                      <span>Find Battles</span>
                    </button>
                  )}

                  {battle.state === 'WaitingForChallenger' && battle.isCreator && !refundableBattles.has(battle.battlePda) && (
                    <div className="text-center text-xs text-[#9db4b9]">
                      Waiting for challenger or timeout
                    </div>
                  )}

                  {battle.state === 'WaitingCreatorReveal' && !battle.isCreator && !timeoutWins.has(battle.battlePda) && (
                    <div className="text-center text-xs text-[#9db4b9]">
                      Waiting for creator to reveal
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
