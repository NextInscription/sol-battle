import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { Connection, PublicKey, LAMPORTS_PER_SOL, Transaction } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { useToast } from '../hooks/useToast';
import { joinBattleManual } from '../utils/joinBattleManual';
import { settleBattleManual } from '../utils/settleBattleManual';

import { RPC_ENDPOINT, COMMITMENT, PROGRAM_ID } from '../config/network';

const PROGRAM_ID_PUBKEY = new PublicKey(PROGRAM_ID);

const connection = new Connection(RPC_ENDPOINT, COMMITMENT);

type GameState = 'WaitingChallenger' | 'WaitingCreatorReveal' | 'BothRevealed' | 'Settled';

interface BattleData {
  battlePda: string;
  battleId: number;
  creator: string;
  challenger: string | null;
  betAmountSol: number;
  gameType: string;
  state: GameState;
  winner: string | null;
  creatorRevealed: boolean;
  challengerRevealed: boolean;
  revealDeadline: string;
  createdAtSlot: number;
}

export default function BattleDetail() {
  const { battlePda } = useParams<{ battlePda: string }>();
  const navigate = useNavigate();
  const { publicKey, signTransaction } = useWallet();
  const toast = useToast();

  const [battle, setBattle] = useState<BattleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [revealLoading, setRevealLoading] = useState(false);
  const [seedInput, setSeedInput] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);
  const [showJoinSeedModal, setShowJoinSeedModal] = useState(false);
  const [pendingJoinSeed, setPendingJoinSeed] = useState<Buffer | null>(null);
  const [joinSeedCopied, setJoinSeedCopied] = useState(false);
  const [settleLoading, setSettleLoading] = useState(false);

  useEffect(() => {
    if (battlePda) {
      fetchBattleDetails();
    }
  }, [battlePda]);

  const fetchBattleDetails = async () => {
    if (!battlePda) return;

    try {
      setLoading(true);
      const battlePubkey = new PublicKey(battlePda);
      const accountInfo = await connection.getAccountInfo(battlePubkey);

      if (!accountInfo) {
        toast.error('Battle not found');
        navigate('/');
        return;
      }

      const data = accountInfo.data;
      // 解析数据（使用与 History.tsx 相同的逻辑）
      let offset = 8; // 跳过 discriminator

      const battleId = new BN(data.subarray(offset, offset + 8), 'le').toNumber();
      offset += 8;

      const creator = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
      offset += 32;

      const challengerTag = data.readUInt8(offset);
      offset += 1;
      let challenger = null;
      if (challengerTag !== 0) {
        challenger = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
        offset += 32;
      }

      const betAmountLamports = new BN(data.subarray(offset, offset + 8), 'le');
      const betAmountSol = parseFloat(betAmountLamports.toString()) / LAMPORTS_PER_SOL;
      offset += 8;

      offset += 32; // commit_creator

      const commitChallengerTag = data.readUInt8(offset);
      offset += 1;
      if (commitChallengerTag !== 0) offset += 32;

      const seedCreatorTag = data.readUInt8(offset);
      offset += 1;
      const creatorRevealed = seedCreatorTag === 1;

      const seedChallengerTag = data.readUInt8(offset);
      offset += 1;
      const challengerRevealed = seedChallengerTag === 1;

      if (seedChallengerTag !== 0) offset += 32;

      const gameTypeValue = data.readUInt8(offset);
      offset += 1;
      const gameType = gameTypeValue === 0 ? 'CoinFlip' : 'DiceRoll';

      const stateValue = data.readUInt8(offset);
      offset += 1;
      const state: GameState = ['WaitingChallenger', 'WaitingCreatorReveal', 'BothRevealed', 'Settled'][stateValue] as GameState;

      const winnerTag = data.readUInt8(offset);
      offset += 1;
      let winner = null;
      if (winnerTag !== 0) {
        winner = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
        offset += 32;
      }

      const createdAtSlot = new BN(data.subarray(offset, offset + 8), 'le').toNumber();
      offset += 8;

      // 计算揭示倒计时
      let revealDeadline = '';
      if (state === 'WaitingCreatorReveal') {
        const currentSlot = await connection.getSlot();
        const remainingSlots = 216000 - (currentSlot - createdAtSlot); // 1天 = 216000 slots
        const remainingSeconds = Math.max(0, remainingSlots * 0.4);
        const hours = Math.floor(remainingSeconds / 3600);
        const minutes = Math.floor((remainingSeconds % 3600) / 60);
        const seconds = Math.floor(remainingSeconds % 60);
        revealDeadline = `${hours}h ${minutes}m ${seconds}s`;
      }

      setBattle({
        battlePda: battlePda,
        battleId,
        creator,
        challenger,
        betAmountSol,
        gameType,
        state,
        winner,
        creatorRevealed,
        challengerRevealed,
        revealDeadline,
        createdAtSlot,
      });
    } catch (error) {
      console.error('Failed to fetch battle:', error);
      toast.error('Failed to load battle details');
    } finally {
      setLoading(false);
    }
  };

  const handleReveal = async () => {
    if (!publicKey || !signTransaction || !battle || !battlePda) return;

    if (publicKey.toBase58() !== battle.creator) {
      toast.error('Only the creator can reveal at this stage.');
      return;
    }

    // Validate seed format
    const cleanedInput = seedInput.trim().toLowerCase();
    if (cleanedInput.length !== 64) {
      toast.error('Seed must be exactly 64 hex characters.');
      return;
    }

    // Validate hex characters
    if (!/^[0-9a-f]{64}$/.test(cleanedInput)) {
      toast.error('Seed must contain only hexadecimal characters (0-9, a-f).');
      return;
    }

    setRevealLoading(true);

    try {
      // Get config PDA
      const [configPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('config')],
        PROGRAM_ID_PUBKEY
      );

      const seed = Buffer.from(cleanedInput, 'hex');

      // Build reveal instruction
      function getRevealSeedDiscriminator(): Buffer {
        return Buffer.from([196, 119, 194, 112, 156, 211, 239, 105]);
      }

      const revealData = Buffer.alloc(8 + 32);
      getRevealSeedDiscriminator().copy(revealData, 0);
      seed.copy(revealData, 8);

      const { TransactionInstruction } = await import('@solana/web3.js');
      const revealInstruction = new TransactionInstruction({
        keys: [
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: new PublicKey(battlePda), isSigner: false, isWritable: true },
          { pubkey: publicKey, isSigner: true, isWritable: false },
        ],
        programId: PROGRAM_ID_PUBKEY,
        data: revealData,
      });

      // Build settle instruction
      function getSettleBattleDiscriminator(): Buffer {
        return Buffer.from([4, 146, 32, 157, 82, 216, 214, 28]);
      }

      const settleData = Buffer.alloc(8);
      getSettleBattleDiscriminator().copy(settleData, 0);

      const settleInstruction = new TransactionInstruction({
        keys: [
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: new PublicKey(battlePda), isSigner: false, isWritable: true },
          { pubkey: new PublicKey(battle.creator), isSigner: false, isWritable: true },
          { pubkey: new PublicKey(battle.challenger || battle.creator), isSigner: false, isWritable: true },
          { pubkey: configPda, isSigner: false, isWritable: true },
          { pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: false, isWritable: false }, // System Program
        ],
        programId: PROGRAM_ID_PUBKEY,
        data: settleData,
      });

      // Create transaction with both instructions
      const transaction = new Transaction();
      transaction.feePayer = publicKey;
      transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      transaction.add(revealInstruction);
      transaction.add(settleInstruction);

      const signedTx = await signTransaction(transaction);
      const signature = await connection.sendRawTransaction(signedTx.serialize());

      toast.success(
        `Reveal and settle completed successfully!\n\nTransaction: ${signature}`,
        8000
      );

      // Clear input after success
      setSeedInput('');

      // Refresh battle details
      setTimeout(() => fetchBattleDetails(), 2000);
    } catch (error) {
      console.error('Failed to reveal and settle:', error);
      const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
      toast.error(`Failed to reveal and settle: ${errorMessage}`, 6000);
    } finally {
      setRevealLoading(false);
    }
  };

  const handleJoinBattle = async () => {
    if (!publicKey || !battle) return;

    const isCreator = publicKey.toBase58() === battle.creator;
    if (isCreator) {
      toast.error('You cannot join your own battle');
      return;
    }

    // Check if user has enough balance
    const balance = await connection.getBalance(publicKey);
    const requiredLamports = battle.betAmountSol * LAMPORTS_PER_SOL;

    if (balance < requiredLamports) {
      toast.error(`Insufficient balance. You need at least ${battle.betAmountSol} SOL to join.`);
      return;
    }

    // Generate seed for challenger
    try {
      const seedArray = new Uint8Array(32);
      crypto.getRandomValues(seedArray);
      const seed = Buffer.from(seedArray);

      setPendingJoinSeed(seed);
      setShowJoinSeedModal(true);
      setJoinSeedCopied(false);
    } catch (error) {
      console.error('Failed to generate seed:', error);
      toast.error('Failed to generate seed');
    }
  };

  const confirmJoinBattle = async () => {
    if (!publicKey || !signTransaction || !pendingJoinSeed || !battle || !battlePda) {
      return;
    }

    if (!joinSeedCopied) {
      toast.warning('Please copy and save your seed first!');
      return;
    }

    setShowJoinSeedModal(false);
    setJoinLoading(true);

    try {
      const result = await joinBattleManual(
        connection,
        publicKey,
        signTransaction,
        new PublicKey(battlePda),
        battle.betAmountSol,
        pendingJoinSeed // 传入预生成的种子
      );

      localStorage.setItem(`battle_tx_${battlePda}`, result.signature);

      toast.success(
        `Battle joined successfully!\n\nTransaction: ${result.signature}\n\nYour seed was revealed automatically when joining. Save it for your records.`,
        10000
      );

      // Refresh battle details after a short delay
      setTimeout(() => fetchBattleDetails(), 2000);
    } catch (error) {
      console.error('Failed to join battle:', error);
      const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
      toast.error(`Failed to join battle: ${errorMessage}`, 6000);
    } finally {
      setJoinLoading(false);
      setPendingJoinSeed(null);
    }
  };

  const copyJoinSeedToClipboard = () => {
    if (pendingJoinSeed) {
      navigator.clipboard.writeText(pendingJoinSeed.toString('hex'));
      setJoinSeedCopied(true);
      toast.success('Seed copied to clipboard!');
    }
  };

  const handleSettleBattle = async () => {
    if (!publicKey || !signTransaction || !battle || !battlePda) {
      toast.error('Please connect your wallet first');
      return;
    }

    if (battle.state !== 'BothRevealed') {
      toast.error('Battle can only be settled when both seeds are revealed');
      return;
    }

    setSettleLoading(true);

    try {
      const signature = await settleBattleManual(
        connection,
        publicKey,
        signTransaction,
        new PublicKey(battlePda),
        new PublicKey(battle.creator),
        new PublicKey(battle.challenger || battle.creator) // fallback to creator if no challenger
      );

      toast.success(
        `Battle settled successfully!\n\nTransaction: ${signature}`,
        6000
      );

      // Refresh battle details after a short delay
      setTimeout(() => fetchBattleDetails(), 2000);
    } catch (error) {
      console.error('Failed to settle battle:', error);
      const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
      toast.error(`Failed to settle battle: ${errorMessage}`, 6000);
    } finally {
      setSettleLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden bg-background-dark">
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[#9db4b9]">Loading battle details...</p>
        </div>
      </div>
    );
  }

  if (!battle) {
    return null;
  }

  const isCreator = publicKey?.toBase58() === battle.creator;
  const canReveal = isCreator && battle.state === 'WaitingCreatorReveal' && !battle.creatorRevealed;
  const canJoin = !isCreator && battle.state === 'WaitingChallenger';

  return (
    <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden bg-background-dark">
      {/* Header */}
      <header className="sticky top-0 z-50 flex items-center bg-background-dark/80 backdrop-blur-md p-4 border-b border-white/5">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-[#9db4b9] hover:text-white transition-colors"
        >
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <h2 className="text-white text-lg font-bold flex-1 text-center">Battle #{battle.battleId}</h2>
        <div className="w-8"></div>
      </header>

      <main className="flex-1 max-w-md mx-auto w-full pb-8 px-4">
        {/* Battle Card */}
        <div className="mt-6 bg-[#1c2527] rounded-2xl overflow-hidden border border-white/5 shadow-2xl">
          {/* Cover Image */}
          <div className="relative h-32 bg-gradient-to-br from-primary/20 to-accent-teal/20">
            <div className="absolute top-3 right-3">
              <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${
                battle.state === 'WaitingChallenger' ? 'bg-yellow-500/20 text-yellow-500 border border-yellow-500/30' :
                battle.state === 'WaitingCreatorReveal' ? 'bg-primary/20 text-primary border border-primary/30' :
                battle.state === 'BothRevealed' ? 'bg-blue-500/20 text-blue-500 border border-blue-500/30' :
                'bg-green-500/20 text-green-500 border border-green-500/30'
              }`}>
                {battle.state === 'WaitingChallenger' ? 'Waiting Challenger' :
                 battle.state === 'WaitingCreatorReveal' ? 'Waiting Reveal' :
                 battle.state === 'BothRevealed' ? 'Settling' : 'Settled'}
              </span>
            </div>
          </div>

          {/* Battle Info */}
          <div className="p-6">
            <div className="flex justify-between items-start mb-6">
              <div>
                <p className="text-[#9db4b9] text-xs font-semibold uppercase tracking-wider mb-1">Total Pot</p>
                <p className="text-white text-2xl font-bold">{(battle.betAmountSol * 2).toFixed(3)} SOL</p>
              </div>
              <div className="text-right">
                <p className="text-[#9db4b9] text-xs font-semibold uppercase tracking-wider mb-1">Your Wager</p>
                <p className="text-primary text-xl font-bold">{battle.betAmountSol} SOL</p>
              </div>
            </div>

            {/* Players */}
            <div className="space-y-3 mb-6">
              <div className="flex items-center justify-between p-3 bg-[#283639] rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <span className="material-symbols-outlined text-primary">person</span>
                  </div>
                  <div>
                    <p className="text-white text-sm font-medium">Creator</p>
                    <p className="text-[#9db4b9] text-xs font-mono">{battle.creator.slice(0, 4)}...{battle.creator.slice(-4)}</p>
                  </div>
                </div>
                {battle.creatorRevealed && (
                  <div className="flex items-center gap-1 px-2 py-1 bg-green-500/10 rounded-full">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div>
                    <span className="text-green-500 text-xs font-bold">Revealed</span>
                  </div>
                )}
              </div>

              {battle.challenger && (
                <div className="flex items-center justify-between p-3 bg-[#283639] rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-accent-teal/10 flex items-center justify-center">
                      <span className="material-symbols-outlined text-accent-teal">sports_martial_arts</span>
                    </div>
                    <div>
                      <p className="text-white text-sm font-medium">Challenger</p>
                      <p className="text-[#9db4b9] text-xs font-mono">{battle.challenger.slice(0, 4)}...{battle.challenger.slice(-4)}</p>
                    </div>
                  </div>
                  {battle.challengerRevealed && (
                    <div className="flex items-center gap-1 px-2 py-1 bg-green-500/10 rounded-full">
                      <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div>
                      <span className="text-green-500 text-xs font-bold">Revealed</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Join Battle Section */}
            {canJoin && (
              <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <span className="material-symbols-outlined text-primary">sports_martial_arts</span>
                  <p className="text-primary/90 text-xs font-medium">
                    Join this battle by matching the wager
                  </p>
                </div>

                <div className="bg-[#283639] rounded-lg p-4 mb-3">
                  <div className="flex justify-between items-center">
                    <span className="text-[#9db4b9] text-sm">Your Wager</span>
                    <span className="text-white text-lg font-bold">{battle.betAmountSol} SOL</span>
                  </div>
                  <div className="flex justify-between items-center mt-2">
                    <span className="text-[#9db4b9] text-sm">Potential Win</span>
                    <span className="text-primary text-lg font-bold">{(battle.betAmountSol * 2 * 0.97).toFixed(3)} SOL</span>
                  </div>
                </div>

                <button
                  onClick={handleJoinBattle}
                  disabled={joinLoading || !publicKey}
                  className={`w-full flex items-center justify-center gap-2 rounded-lg h-12 text-sm font-bold transition-all ${
                    joinLoading || !publicKey
                      ? 'bg-[#283639] text-[#9db4b9] cursor-not-allowed'
                      : 'bg-primary hover:bg-primary/90 text-background-dark shadow-[0_0_20px_rgba(19,200,236,0.3)]'
                  }`}
                >
                  {joinLoading ? (
                    <>
                      <span className="material-symbols-outlined animate-spin">sync</span>
                      <span>Joining...</span>
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined">play_arrow</span>
                      <span>Join Battle</span>
                    </>
                  )}
                </button>

                <div className="mt-3 flex items-start gap-2">
                  <span className="material-symbols-outlined text-primary text-sm">info</span>
                  <p className="text-[#9db4b9] text-xs leading-relaxed">
                    Your seed will be automatically revealed when you join. Save it for your records.
                  </p>
                </div>
              </div>
            )}

            {/* Reveal Section */}
            {canReveal && (
              <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <span className="material-symbols-outlined text-primary">lock</span>
                  <p className="text-primary/90 text-xs font-medium">
                    Reveal your seed to settle the battle
                  </p>
                </div>

                <input
                  type="text"
                  placeholder="Enter your seed (64 hex characters)"
                  value={seedInput}
                  onChange={(e) => setSeedInput(e.target.value.trim())}
                  onPaste={(e) => {
                    // Auto-clean on paste
                    const paste = e.clipboardData.getData('text');
                    const cleaned = paste.trim().toLowerCase();
                    e.preventDefault();
                    setSeedInput(cleaned);
                  }}
                  className="w-full bg-[#283639] border border-white/10 rounded-lg px-4 py-3 text-white placeholder-[#9db4b9] text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary mb-3"
                />

                <button
                  onClick={handleReveal}
                  disabled={revealLoading || seedInput.length !== 64}
                  className={`w-full flex items-center justify-center gap-2 rounded-lg h-12 text-sm font-bold transition-all ${
                    revealLoading || seedInput.length !== 64
                      ? 'bg-[#283639] text-[#9db4b9] cursor-not-allowed'
                      : 'bg-primary hover:bg-primary/90 text-background-dark shadow-[0_0_20px_rgba(19,200,236,0.3)]'
                  }`}
                >
                  {revealLoading ? (
                    <>
                      <span className="material-symbols-outlined animate-spin">sync</span>
                      <span>Revealing...</span>
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined">visibility</span>
                      <span>Reveal Seed</span>
                    </>
                  )}
                </button>

                <div className="mt-3 flex items-start gap-2">
                  <span className="material-symbols-outlined text-accent-teal text-sm">info</span>
                  <p className="text-[#9db4b9] text-xs leading-relaxed">
                    Enter the seed you saved when creating this battle. The seed should be exactly 64 hex characters.
                  </p>
                </div>
              </div>
            )}

            {/* Settle Battle Section */}
            {battle.state === 'BothRevealed' && (
              <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-4 mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <span className="material-symbols-outlined text-green-500">emoji_events</span>
                  <p className="text-green-500/90 text-xs font-medium">
                    Both seeds revealed! Ready to settle the battle.
                  </p>
                </div>

                <button
                  onClick={handleSettleBattle}
                  disabled={settleLoading || !publicKey}
                  className={`w-full flex items-center justify-center gap-2 rounded-lg h-12 text-sm font-bold transition-all ${
                    settleLoading || !publicKey
                      ? 'bg-[#283639] text-[#9db4b9] cursor-not-allowed'
                      : 'bg-green-500 hover:bg-green-500/90 text-background-dark shadow-[0_0_20px_rgba(34,197,94,0.3)]'
                  }`}
                >
                  {settleLoading ? (
                    <>
                      <span className="material-symbols-outlined animate-spin">sync</span>
                      <span>Settling...</span>
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined">military_tech</span>
                      <span>Settle Battle</span>
                    </>
                  )}
                </button>

                <div className="mt-3 flex items-start gap-2">
                  <span className="material-symbols-outlined text-green-500 text-sm">info</span>
                  <p className="text-[#9db4b9] text-xs leading-relaxed">
                    Calculate the winner and distribute the prize. Anyone can trigger settlement.
                  </p>
                </div>
              </div>
            )}

            {/* Timer */}
            {battle.state === 'WaitingCreatorReveal' && battle.revealDeadline && (
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-yellow-500">schedule</span>
                    <p className="text-yellow-500 text-sm font-medium">Reveal Deadline</p>
                  </div>
                  <p className="text-white font-bold text-sm">{battle.revealDeadline}</p>
                </div>
              </div>
            )}

            {/* Battle Progress */}
            <div className="mt-6">
              <h3 className="text-white text-sm font-bold uppercase tracking-wider mb-4">Battle Progress</h3>

              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center border-4 ${
                    battle.challenger ? 'bg-green-500 border-background-dark' : 'bg-[#283639] border-[#1c2527]'
                  }`}>
                    {battle.challenger && <span className="material-symbols-outlined text-white text-xs">check</span>}
                  </div>
                  <div className="flex-1">
                    <p className="text-white text-sm font-medium">Battle Created</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center border-4 ${
                    battle.challenger ? 'bg-green-500 border-background-dark' : 'bg-[#283639] border-[#1c2527]'
                  }`}>
                    {battle.challenger && <span className="material-symbols-outlined text-white text-xs">check</span>}
                  </div>
                  <div className="flex-1">
                    <p className="text-white text-sm font-medium">Challenger Joined</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center border-4 ${
                    battle.challengerRevealed && battle.creatorRevealed ? 'bg-green-500 border-background-dark' :
                    battle.challenger ? 'bg-primary border-background-dark animate-pulse ring-4 ring-primary/20' :
                    'bg-[#283639] border-[#1c2527]'
                  }`}>
                    {(battle.challengerRevealed && battle.creatorRevealed) && <span className="material-symbols-outlined text-white text-xs">check</span>}
                    {battle.challenger && !battle.creatorRevealed && (
                      <div className="w-2 h-2 rounded-full bg-white animate-pulse"></div>
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="text-white text-sm font-medium">Reveal Phase</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center border-4 ${
                    battle.state === 'Settled' ? 'bg-green-500 border-background-dark' : 'bg-[#283639] border-[#1c2527]'
                  }`}>
                    {battle.state === 'Settled' && <span className="material-symbols-outlined text-white text-xs">check</span>}
                  </div>
                  <div className="flex-1">
                    <p className="text-white text-sm font-medium">Settled</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Winner */}
            {battle.state === 'Settled' && battle.winner && (
              <div className="mt-6 bg-gradient-to-r from-primary/20 to-accent-teal/20 rounded-xl p-6 text-center border border-primary/30">
                <span className="material-symbols-outlined text-4xl text-primary">emoji_events</span>
                <p className="text-white text-lg font-bold mt-2">Winner</p>
                <p className="text-primary font-mono text-sm">{battle.winner.slice(0, 4)}...{battle.winner.slice(-4)}</p>
              </div>
            )}
          </div>
        </div>

        {/* On-chain Link */}
        <div className="mt-6 text-center">
          <button
            onClick={() => window.open(`https://solscan.io/account/${battlePda}?cluster=custom`, '_blank')}
            className="inline-flex items-center gap-2 text-primary hover:text-primary/80 transition-colors text-sm font-bold"
          >
            <span>View on Solscan</span>
            <span className="material-symbols-outlined text-sm">open_in_new</span>
          </button>
        </div>
      </main>

      {/* Join Seed Modal */}
      {showJoinSeedModal && pendingJoinSeed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-[#1c2527] rounded-2xl p-6 max-w-md w-full border-2 border-primary shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex items-center justify-center rounded-lg bg-primary/10 shrink-0 size-12">
                <span className="material-symbols-outlined text-primary text-2xl">key</span>
              </div>
              <div>
                <h3 className="text-white text-xl font-bold">Save Your Seed!</h3>
                <p className="text-[#9db4b9] text-sm">Your seed will be automatically revealed when you join</p>
              </div>
            </div>

            <div className="mb-4">
              <label className="text-[#9db4b9] text-xs uppercase tracking-wider mb-2 block">
                Your Secret Seed (32 bytes hex)
              </label>
              <div className="relative">
                <div className="bg-[#283639] border border-white/10 rounded-lg p-4 font-mono text-sm text-primary break-all leading-relaxed">
                  {pendingJoinSeed.toString('hex')}
                </div>
                <button
                  onClick={copyJoinSeedToClipboard}
                  className="absolute top-2 right-2 p-2 bg-primary/10 hover:bg-primary/20 rounded-lg transition-colors"
                  title="Copy to clipboard"
                >
                  <span className="material-symbols-outlined text-primary">
                    {joinSeedCopied ? 'check' : 'content_copy'}
                  </span>
                </button>
              </div>
            </div>

            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4">
              <div className="flex items-start gap-2">
                <span className="material-symbols-outlined text-red-500 text-sm shrink-0">warning</span>
                <div>
                  <p className="text-red-400 text-xs font-medium mb-1">⚠️ Important!</p>
                  <p className="text-[#9db4b9] text-xs leading-relaxed">
                    Save this seed securely in a password manager or safe place. <strong>We cannot recover lost seeds.</strong>
                  </p>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowJoinSeedModal(false);
                  setPendingJoinSeed(null);
                  setJoinSeedCopied(false);
                }}
                className="flex-1 flex items-center justify-center gap-2 rounded-lg h-12 text-sm font-medium transition-all bg-[#283639] hover:bg-[#34464a] text-white"
              >
                <span className="material-symbols-outlined">cancel</span>
                <span>Cancel</span>
              </button>
              <button
                onClick={confirmJoinBattle}
                disabled={!joinSeedCopied}
                className={`flex-1 flex items-center justify-center gap-2 rounded-lg h-12 text-sm font-medium transition-all ${
                  joinSeedCopied
                    ? 'bg-primary hover:bg-primary/90 text-background-dark shadow-[0_0_20px_rgba(19,200,236,0.3)]'
                    : 'bg-[#283639] text-[#9db4b9] cursor-not-allowed'
                }`}
              >
                <span className="material-symbols-outlined">check_circle</span>
                <span>{joinSeedCopied ? "I've Saved It" : 'Copy First'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
