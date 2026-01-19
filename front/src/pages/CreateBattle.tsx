import { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useNavigate } from 'react-router-dom';
import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createBattleManual } from '../utils/createBattleManual';
import { useToast } from '../hooks/useToast';

import { RPC_ENDPOINT, COMMITMENT } from '../config/network';

const connection = new Connection(RPC_ENDPOINT, COMMITMENT);

type GameType = 'coinFlip' | 'diceRoll';

interface GameTypeOption {
  id: GameType;
  name: string;
  description: string;
  icon: string;
  gradient: string;
}

const gameTypes: GameTypeOption[] = [
  {
    id: 'coinFlip',
    name: 'Flip Card Game',
    description: 'Randomly reveals a card. Even number wins for creator, odd for challenger.',
    icon: 'style',
    gradient: 'linear-gradient(135deg, #101f22 0%, #1a3a40 100%)',
  }
];

const presets = [
  { label: '0.1 SOL', value: 0.1 },
  { label: '1 SOL', value: 1 },
  { label: '5 SOL', value: 5 },
];

export default function CreateBattle() {
  const { publicKey, connected, signTransaction } = useWallet();
  const navigate = useNavigate();
  const toast = useToast();

  const [selectedGame, setSelectedGame] = useState<GameType>('coinFlip');
  const [betAmount, setBetAmount] = useState<number>(0.1);
  const [customAmount, setCustomAmount] = useState<string>('');
  const [balance, setBalance] = useState<string>('0.00');
  const [loading, setLoading] = useState<boolean>(false);
  const [showSeedModal, setShowSeedModal] = useState<boolean>(false);
  const [pendingSeed, setPendingSeed] = useState<Buffer | null>(null);
  const [pendingBattle, setPendingBattle] = useState<any>(null);
  const [seedCopied, setSeedCopied] = useState<boolean>(false);

  useEffect(() => {
    if (publicKey) {
      connection.getBalance(publicKey).then((bal) => {
        setBalance((bal / LAMPORTS_PER_SOL).toFixed(2));
      });
    }
  }, [publicKey]);

  const handleCreateBattle = async () => {
    if (!publicKey || !signTransaction) {
      toast.warning('Please connect your wallet first');
      return;
    }

    const finalAmount = customAmount ? parseFloat(customAmount) : betAmount;
    if (finalAmount < 0.001 || isNaN(finalAmount)) {
      toast.error('Minimum bet amount is 0.001 SOL');
      return;
    }

    const balanceNum = parseFloat(balance);
    if (finalAmount > balanceNum) {
      toast.error(`Insufficient balance. You have ${balanceNum} SOL`);
      return;
    }

    // 1. 先生成种子
    try {
      // 正确的随机种子生成方式
      const seedArray = new Uint8Array(32);
      crypto.getRandomValues(seedArray);
      const seed = Buffer.from(seedArray);

      console.log('Generated seed:', seed.toString('hex'));

      setPendingSeed(seed);
      setPendingBattle({ amount: finalAmount, gameType: selectedGame });
      setShowSeedModal(true);
      setSeedCopied(false);
    } catch (error) {
      console.error('Failed to generate seed:', error);
      toast.error('Failed to generate seed');
    }
  };

  const confirmCreateBattle = async () => {
    if (!seedCopied) {
      toast.warning('Please copy and save your seed first!');
      return;
    }

    if (!publicKey || !signTransaction || !pendingSeed || !pendingBattle) {
      return;
    }

    setShowSeedModal(false);
    setLoading(true);

    try {
      const result = await createBattleManual(
        connection,
        publicKey,
        signTransaction,
        pendingBattle.gameType,
        pendingBattle.amount,
        pendingSeed // 传入预生成的种子
      );

      localStorage.setItem(`battle_tx_${result.battlePda.toBase58()}`, result.signature);

      toast.success(
        `Battle created successfully!\n\nTransaction: ${result.signature}\n\nBattle PDA: ${result.battlePda.toBase58()}\n\nIMPORTANT: Save your seed securely! You'll need it to reveal.`,
        10000
      );

      setTimeout(() => navigate('/'), 1000);
    } catch (error) {
      console.error('Failed to create battle:', error);
      const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
      toast.error(`Failed to create battle: ${errorMessage}`, 6000);
    } finally {
      setLoading(false);
      setPendingSeed(null);
      setPendingBattle(null);
    }
  };

  const copySeedToClipboard = () => {
    if (pendingSeed) {
      navigator.clipboard.writeText(pendingSeed.toString('hex'));
      setSeedCopied(true);
      toast.success('Seed copied to clipboard!');
    }
  };

  const selectedGameOption = gameTypes.find(g => g.id === selectedGame);

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
        <h2 className="text-white text-base font-bold leading-tight tracking-tight">Create Battle</h2>
        <div className="w-20"></div>
      </header>

      {/* Seed Modal */}
      {showSeedModal && pendingSeed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-[#1c2527] rounded-2xl p-6 max-w-md w-full border-2 border-primary shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex items-center justify-center rounded-lg bg-[#facc15]/10 shrink-0 size-12">
                <span className="material-symbols-outlined text-[#facc15] text-2xl">key</span>
              </div>
              <div>
                <h3 className="text-white text-xl font-bold">Save Your Seed!</h3>
                <p className="text-[#9db4b9] text-sm">This is required to reveal your battle later</p>
              </div>
            </div>

            <div className="mb-4">
              <label className="text-[#9db4b9] text-xs uppercase tracking-wider mb-2 block">
                Your Secret Seed (32 bytes hex)
              </label>
              <div className="relative">
                <div className="bg-[#283639] border border-white/10 rounded-lg p-4 font-mono text-sm text-primary break-all leading-relaxed">
                  {pendingSeed.toString('hex')}
                </div>
                <button
                  onClick={copySeedToClipboard}
                  className="absolute top-2 right-2 p-2 bg-primary/10 hover:bg-primary/20 rounded-lg transition-colors"
                  title="Copy to clipboard"
                >
                  <span className="material-symbols-outlined text-primary">
                    {seedCopied ? 'check' : 'content_copy'}
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
                  setShowSeedModal(false);
                  setPendingSeed(null);
                  setPendingBattle(null);
                  setSeedCopied(false);
                }}
                className="flex-1 flex items-center justify-center gap-2 rounded-lg h-12 text-sm font-medium transition-all bg-[#283639] hover:bg-[#34464a] text-white"
              >
                <span className="material-symbols-outlined">cancel</span>
                <span>Cancel</span>
              </button>
              <button
                onClick={confirmCreateBattle}
                disabled={!seedCopied}
                className={`flex-1 flex items-center justify-center gap-2 rounded-lg h-12 text-sm font-medium transition-all ${
                  seedCopied
                    ? 'bg-primary hover:bg-primary/90 text-background-dark shadow-[0_0_20px_rgba(19,200,236,0.3)]'
                    : 'bg-[#283639] text-[#9db4b9] cursor-not-allowed'
                }`}
              >
                <span className="material-symbols-outlined">check_circle</span>
                <span>{seedCopied ? 'I\'ve Saved It' : 'Copy First'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-8">
        <div className="max-w-2xl mx-auto">
          {/* Game Type Selection */}
          <div className="mb-8">
            <h3 className="text-white text-lg font-bold mb-4">Select Game Type</h3>
            <div className="grid grid-cols-1 gap-4">
              {gameTypes.map((game) => (
                <button
                  key={game.id}
                  onClick={() => setSelectedGame(game.id)}
                  className={`relative overflow-hidden rounded-xl p-6 text-left transition-all ${
                    selectedGame === game.id
                      ? 'ring-2 ring-primary bg-[#1c2527]'
                      : 'hover:bg-[#1c2527]/50 bg-[#1c2527]/30'
                  }`}
                  style={{
                    backgroundImage: selectedGame === game.id ? game.gradient : 'none',
                  }}
                >
                  {selectedGame === game.id && (
                    <div className="absolute top-4 right-4">
                      <div className="size-6 rounded-full bg-primary flex items-center justify-center">
                        <span className="material-symbols-outlined text-background-dark text-sm">check</span>
                      </div>
                    </div>
                  )}
                  <div className="flex items-start gap-4">
                    <div className={`flex items-center justify-center rounded-lg shrink-0 size-12 ${
                      selectedGame === game.id
                        ? 'bg-background-dark/20'
                        : 'bg-primary/10'
                    }`}>
                      <span className={`material-symbols-outlined text-2xl ${
                        selectedGame === game.id ? 'text-white' : 'text-primary'
                      }`}>
                        {game.icon}
                      </span>
                    </div>
                    <div>
                      <h4 className={`text-base font-bold mb-1 ${
                        selectedGame === game.id ? 'text-white' : 'text-[#9db4b9]'
                      }`}>
                        {game.name}
                      </h4>
                      <p className="text-xs text-[#9db4b9] leading-relaxed">
                        {game.description}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Bet Amount */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white text-lg font-bold">Bet Amount</h3>
              <div className="text-right">
                <p className="text-[#9db4b9] text-xs">Your Balance</p>
                <p className="text-white text-lg font-bold">{balance} SOL</p>
              </div>
            </div>

            {/* Presets */}
            <div className="flex gap-2 mb-4 overflow-x-auto pb-2 scrollbar-hide">
              {presets.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => {
                    setBetAmount(preset.value);
                    setCustomAmount('');
                  }}
                  className={`shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    betAmount === preset.value && !customAmount
                      ? 'bg-primary text-background-dark'
                      : 'bg-[#1c2527] text-white hover:bg-[#283639]'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            {/* Custom Input */}
            <div className="relative">
              <input
                type="number"
                step="0.001"
                min="0.001"
                placeholder="Custom amount (e.g., 0.5)"
                value={customAmount}
                onChange={(e) => {
                  setCustomAmount(e.target.value);
                  if (e.target.value) {
                    setBetAmount(parseFloat(e.target.value));
                  }
                }}
                className="w-full bg-[#1c2527] border border-white/10 rounded-lg px-4 py-3 text-white placeholder-[#9db4b9] focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[#9db4b9] text-sm">
                SOL
              </span>
            </div>
          </div>

          {/* Game Rules */}
          <div className="mb-8 glass-card rounded-xl p-4">
            <div className="flex items-start gap-3">
              <div className="flex items-center justify-center rounded-lg bg-[#facc15]/10 shrink-0 size-10">
                <span className="material-symbols-outlined text-[#facc15] text-lg">info</span>
              </div>
              <div>
                <h4 className="text-white text-sm font-bold mb-1">Game Rules</h4>
                <p className="text-xs text-[#9db4b9] leading-relaxed">
                  {selectedGameOption?.description}
                </p>
              </div>
            </div>
          </div>

          {/* Create Button */}
          <button
            onClick={handleCreateBattle}
            disabled={!connected || loading}
            className={`w-full flex items-center justify-center gap-2 rounded-lg h-14 text-base font-bold transition-all active:scale-95 ${
              loading || !connected
                ? 'bg-[#283639] text-[#9db4b9] cursor-not-allowed'
                : 'bg-primary hover:bg-primary/90 text-background-dark shadow-[0_0_20px_rgba(19,200,236,0.3)]'
            }`}
          >
            {loading ? (
              <>
                <span className="material-symbols-outlined animate-spin">sync</span>
                <span>Creating...</span>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined">play_arrow</span>
                <span>Create Battle</span>
              </>
            )}
          </button>

          {/* Info */}
          <div className="mt-6 text-center">
            <p className="text-xs text-[#9db4b9]">
              By creating a battle, you agree to lock {customAmount || betAmount} SOL until the battle is settled
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
