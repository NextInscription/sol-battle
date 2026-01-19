import { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { useNavigate } from 'react-router-dom';
import BattleCard from '../components/BattleCard';
import { getActiveBattles, type ActiveBattle, formatTimeRemaining } from '../utils/battles';

import { RPC_ENDPOINT, COMMITMENT } from '../config/network';
const connection = new Connection(RPC_ENDPOINT, COMMITMENT);

export default function Lobby() {
  const navigate = useNavigate();
  const { publicKey, connected } = useWallet();
  const [balance, setBalance] = useState<string>('0.00');
  const [battles, setBattles] = useState<ActiveBattle[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [selectedFilter, setSelectedFilter] = useState<'WaitingForChallenger' | 'WaitingCreatorReveal'>('WaitingForChallenger');

  // 获取余额
  useEffect(() => {
    if (publicKey) {
      connection.getBalance(publicKey).then((bal) => {
        setBalance((bal / LAMPORTS_PER_SOL).toFixed(2));
      });
    }
  }, [publicKey]);

  // 获取所有对战
  const fetchBattles = async (showLoading = false) => {
    try {
      // 只在初始加载时显示 loading
      if (showLoading) {
        setLoading(true);
      } else {
        // 后台刷新时，设置刷新指示器
        setIsRefreshing(true);
      }

      const activeBattles = await getActiveBattles(connection);
      console.log('activeBattles:', activeBattles);

      // 按剩余时间排序，即将过期的排在最前面
      const sortedBattles = activeBattles.sort((a, b) => {
        return a.expiresInSeconds - b.expiresInSeconds;
      });

      setBattles(sortedBattles);
    } catch (error) {
      console.error('Failed to fetch battles:', error);
    } finally {
      if (showLoading) {
        setLoading(false);
      } else {
        setIsRefreshing(false);
      }
    }
  };

  // 初始加载（显示 loading）
  useEffect(() => {
    fetchBattles(true);
  }, []);

  // 自动刷新battle列表（每20秒，不显示 loading）
  useEffect(() => {
    const refreshInterval = setInterval(() => {
      console.log('🔄 Auto refreshing battles...');
      fetchBattles(false); // 不显示 loading，后台刷新
    }, 20000); // 20秒刷新一次

    return () => clearInterval(refreshInterval);
  }, []); // 只在组件挂载时设置一次

  // 实时更新倒计时
  useEffect(() => {
    if (battles.length === 0) return;

    const updateTimer = setInterval(() => {
      setBattles(prevBattles => {
        const updated = prevBattles.map(battle => {
          const remainingSeconds = Math.max(0, battle.expiresInSeconds - 1);
          const timeRemaining = formatTimeRemaining(remainingSeconds);

          return {
            ...battle,
            expiresInSeconds: remainingSeconds,
            timeRemaining,
          };
        });

        // 保持排序：即将过期的排在最前面
        return updated.sort((a, b) => a.expiresInSeconds - b.expiresInSeconds);
      });
    }, 1000);

    return () => clearInterval(updateTimer);
  }, [battles.length > 0]);

  return (
    <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden bg-background-dark">
      <header className="sticky top-0 z-50 flex items-center bg-background-dark/80 backdrop-blur-md p-4 border-b border-white/5 justify-between max-w-7xl mx-auto w-full px-4">
        <div className="flex items-center gap-2">
          <img src="/icon-128x128.ico" alt="Battle Arena" className="size-8 rounded-lg" />
          <h2  className="text-white text-sm font-bold leading-tight tracking-tight">Battle Arena(testnet)</h2>
        </div>
        <div className="flex items-center gap-3">
          {connected && (
            <div className="hidden sm:flex items-center">
              <p className="text-primary text-xs font-bold leading-normal tracking-wide bg-primary/10 px-2 py-1 rounded">
                CONNECTED
              </p>
            </div>
          )}
          <WalletMultiButton className="!bg-[#283639] hover:!bg-[#34464a] !text-white !text-sm !font-medium !border-none !h-8 !px-3" />
        </div>
      </header>

      <main className="flex-1">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-4 bg-[#1c2527]/40 px-4 py-4 justify-between border-b border-white/5">
            <div className="flex items-center gap-3">
              <div className="text-primary flex items-center justify-center rounded-lg bg-primary/10 shrink-0 size-10">
                <span className="material-symbols-outlined">account_balance_wallet</span>
              </div>
              <div>
                <p className="text-[#9db4b9] text-xs font-medium uppercase tracking-wider">Your Balance</p>
                <p className="text-white text-lg font-bold leading-none">{balance} SOL</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => fetchBattles(false)}
                disabled={isRefreshing}
                className="flex items-center gap-1 cursor-pointer overflow-hidden rounded-lg h-8 px-3 bg-[#283639] hover:bg-[#34464a] text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className={`material-symbols-outlined text-sm ${isRefreshing ? 'animate-spin' : ''}`}>refresh</span>
                <span className="truncate">{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
              </button>
              <button
                onClick={() => navigate('/history')}
                className="flex items-center gap-1 cursor-pointer overflow-hidden rounded-lg h-9 px-4 bg-[#283639] hover:bg-[#34464a] text-white text-sm font-medium transition-colors"
              >
                <span className="material-symbols-outlined text-sm">history</span>
                <span className="truncate">History</span>
              </button>
            </div>
          </div>
        </div>

        <div className="px-4 pt-6 max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white text-xl font-bold tracking-tight">Active Battles</h3>
            <div className="flex items-center gap-2">
              <span className="text-primary text-xs font-bold bg-primary/10 px-2 py-1 rounded-full">
                {battles.length} Online
              </span>
            </div>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
            <button
              onClick={() => setSelectedFilter('WaitingForChallenger')}
              className={`flex h-9 shrink-0 items-center justify-center gap-x-2 rounded-full px-4 cursor-pointer transition-colors ${
                selectedFilter === 'WaitingForChallenger' ? 'bg-primary' : 'bg-[#283639] hover:bg-[#34464a]'
              }`}
            >
              <span
                className={`material-symbols-outlined text-lg ${
                  selectedFilter === 'WaitingForChallenger' ? 'text-background-dark' : 'text-white'
                }`}
              >
                person_add
              </span>
              <p
                className={`text-sm ${selectedFilter === 'WaitingForChallenger' ? 'text-background-dark font-bold' : 'text-white font-medium'}`}
              >
                Waiting
              </p>
            </button>
            <button
              onClick={() => setSelectedFilter('WaitingCreatorReveal')}
              className={`flex h-9 shrink-0 items-center justify-center gap-x-2 rounded-full px-4 cursor-pointer transition-colors ${
                selectedFilter === 'WaitingCreatorReveal' ? 'bg-primary' : 'bg-[#283639] hover:bg-[#34464a]'
              }`}
            >
              <span
                className={`material-symbols-outlined text-lg ${
                  selectedFilter === 'WaitingCreatorReveal' ? 'text-background-dark' : 'text-white'
                }`}
              >
                visibility
              </span>
              <p
                className={`text-sm ${selectedFilter === 'WaitingCreatorReveal' ? 'text-background-dark font-bold' : 'text-white font-medium'}`}
              >
                Reveal
              </p>
            </button>
          </div>
        </div>

        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
            {loading ? (
              <div className="col-span-full text-center py-12">
                <p className="text-[#9db4b9]">Loading battles...</p>
              </div>
            ) : battles.filter(b => b.state === selectedFilter).length === 0 ? (
              <div className="col-span-full text-center py-12">
                <p className="text-[#9db4b9]">No {selectedFilter === 'WaitingForChallenger' ? 'waiting' : 'revealing'} battles found</p>
              </div>
            ) : (
              battles
                .filter(b => b.state === selectedFilter)
                .map((battle) => (
                  <BattleCard
                    key={battle.battlePda}
                    id={battle.battlePda}
                    gameType={battle.gameTypeDisplay}
                    betAmount={battle.betAmountSol}
                    creator={battle.creator}
                    timeRemaining={battle.timeRemaining}
                    gradient={battle.gradient}
                  />
                ))
            )}
          </div>
        </div>
      </main>

      <div className="fixed bottom-6 right-6">
        <button
          onClick={() => navigate('/create')}
          className="flex size-14 items-center justify-center rounded-full bg-primary text-background-dark shadow-[0_8px_30px_rgb(19,200,236,0.4)] transition-transform hover:scale-110 active:scale-95"
        >
          <span className="material-symbols-outlined text-3xl font-bold">add</span>
        </button>
      </div>
    </div>
  );
}
