import { useWallet } from '@solana/wallet-adapter-react';
import { useNavigate } from 'react-router-dom';

interface BattleCardProps {
  id: string;
  gameType: 'Flip Card Game' | 'Dice Roll Battle';
  betAmount: string;
  creator: string;
  timeRemaining: string;
  gradient: string;
}

export function BattleCard({ id, gameType, betAmount, creator, timeRemaining, gradient }: BattleCardProps) {
  const navigate = useNavigate();
  const { publicKey } = useWallet();

  const handleJoin = () => {
    if (!publicKey) return;
    navigate(`/battle/${id}`);
  };

  const getGameIcon = (type: string) => {
    return type === 'Flip Card Game' ? 'style' : 'casino';
  };

  return (
    <div
      onClick={handleJoin}
      className={`flex flex-col items-stretch justify-start rounded-xl shadow-lg glass-card overflow-hidden transition-all ${
        publicKey ? 'cursor-pointer hover:scale-[1.02] hover:shadow-2xl' : ''
      }`}
    >
      <div
        className="relative w-full bg-center bg-no-repeat aspect-[16/7] bg-cover"
        style={{ backgroundImage: gradient }}
      >
        <div className="absolute inset-0 bg-black/20"></div>
        <div className="absolute top-3 left-3 flex items-center gap-2 bg-black/60 backdrop-blur-sm rounded-full px-3 py-1 border border-white/10">
          <span className="material-symbols-outlined text-primary text-sm">lock</span>
          <span className="text-white text-[10px] font-bold uppercase tracking-widest">Escrowed</span>
        </div>
        <div className="absolute bottom-3 left-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-white text-base">{getGameIcon(gameType)}</span>
            <span className="text-white text-xs font-bold uppercase">{gameType}</span>
          </div>
        </div>
      </div>
      <div className="flex w-full flex-col gap-4 p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-primary text-3xl font-black tracking-tight">{betAmount}</p>
            <p className="text-[#9db4b9] text-xs font-medium mt-1">
              Created by <span className="text-white font-mono">{creator}</span>
            </p>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-1 text-[#facc15]">
              <span className="material-symbols-outlined text-sm">timer</span>
              <p className="text-xs font-bold">{timeRemaining}</p>
            </div>
            <p className="text-[#9db4b9] text-[10px] font-medium uppercase mt-1">Waiting...</p>
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleJoin();
          }}
          disabled={!publicKey}
          className={`flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg h-12 bg-primary hover:bg-primary/90 text-background-dark text-base font-bold shadow-[0_0_15px_rgba(19,200,236,0.3)] transition-all active:scale-95 ${!publicKey ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <span className="material-symbols-outlined">play_arrow</span>
          <span>Join Battle</span>
        </button>
      </div>
    </div>
  );
}

export default BattleCard;
