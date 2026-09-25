import React, { useState, useEffect } from 'react';
import {
  Gamepad2,
  Trophy,
  Users,
  User,
  Bomb,
  RotateCw,
  Dices,
  Coins,
} from 'lucide-react';
import { Header } from './components/Header.tsx';
import { MinesGame } from './components/MinesGame.tsx';
import { RouletteGame } from './components/RouletteGame.tsx';
import { DiceGame } from './components/DiceGame.tsx';
import { CoinflipGame } from './components/CoinflipGame.tsx';
import { WalletModal } from './components/WalletModal.tsx';
import { LeaderboardTab } from './components/LeaderboardTab.tsx';
import { ReferralsTab } from './components/ReferralsTab.tsx';
import { ProfileTab } from './components/ProfileTab.tsx';
import { ProvablyFairModal } from './components/ProvablyFairModal.tsx';
import { initTelegramApp, getTelegramUser, triggerHaptic } from './utils/telegram.ts';

type NavigationTab = 'games' | 'leaderboard' | 'referrals' | 'profile';
type GameType = 'mines' | 'roulette' | 'dice' | 'coinflip';

interface GameItem {
  id: GameType;
  title: string;
  icon: React.ReactNode;
  badge?: string;
}

const GAMES: GameItem[] = [
  { id: 'mines', title: 'Мины', icon: '💣', badge: 'HOT' },
  { id: 'roulette', title: 'Рулетка', icon: '🎡' },
  { id: 'dice', title: 'Кубик', icon: '🎲' },
  {
    id: 'coinflip',
    title: 'Монетка',
    icon: (
      <svg className="w-4 h-4 text-amber-400" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" fill="url(#appCoinGrad)" stroke="#f59e0b" strokeWidth="2" />
        <circle cx="12" cy="12" r="6.5" stroke="#78350f" strokeWidth="1" strokeDasharray="2 2" />
        <text x="12" y="15" textAnchor="middle" fill="#78350f" fontSize="8" fontWeight="900" fontFamily="sans-serif">$</text>
        <defs>
          <linearGradient id="appCoinGrad" x1="4" y1="4" x2="20" y2="20" gradientUnits="userSpaceOnUse">
            <stop stopColor="#fef08a" />
            <stop offset="0.5" stopColor="#fbbf24" />
            <stop offset="1" stopColor="#d97706" />
          </linearGradient>
        </defs>
      </svg>
    ),
  },
];

export default function App() {
  const [currentTab, setCurrentTab] = useState<NavigationTab>('games');
  const [activeGame, setActiveGame] = useState<GameType>('mines');
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Modals state
  const [isWalletOpen, setIsWalletOpen] = useState(false);
  const [walletTab, setWalletTab] = useState<'deposit' | 'withdraw' | 'promo' | 'bonus'>('deposit');
  const [isFairnessOpen, setIsFairnessOpen] = useState(false);
  const [fairnessData, setFairnessData] = useState<any>(null);

  // Initialize Telegram WebApp SDK & load user data
  useEffect(() => {
    initTelegramApp();
    const tgUser = getTelegramUser();
    loadUser(tgUser.id, tgUser.username);
  }, []);

  const loadUser = async (userId: number, username: string = '') => {
    try {
      const res = await fetch(`/api/user?userId=${userId}&username=${encodeURIComponent(username)}`);
      const data = await res.json();
      if (data.ok && data.user) {
        setUser(data.user);
      }
    } catch (err) {
      console.error('Failed to load user:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleBalanceChange = (newBalance: number) => {
    setUser((prev: any) => (prev ? { ...prev, balance: newBalance } : prev));
  };

  const openWalletWithTab = (tab: 'deposit' | 'withdraw' | 'promo' | 'bonus' = 'deposit') => {
    setWalletTab(tab);
    setIsWalletOpen(true);
  };

  const handleOpenFairness = (data: any) => {
    setFairnessData(data);
    setIsFairnessOpen(true);
  };

  return (
    <div className="min-h-screen bg-[#090c15] text-slate-100 flex flex-col font-sans pb-20 selection:bg-amber-500/30 selection:text-amber-200">
      {/* Sticky Header */}
      <Header
        user={user}
        onOpenWallet={openWalletWithTab}
        onNavigateToProfile={() => setCurrentTab('profile')}
      />

      {/* Main Content Body */}
      <main className="flex-1 w-full max-w-2xl mx-auto">
        {loading ? (
          <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 animate-spin">
              ⚡
            </div>
            <p className="text-xs font-bold text-slate-400">Загрузка данных...</p>
          </div>
        ) : (
          <>
            {currentTab === 'games' && (
              <div>
                {/* Modern Responsive Game Switcher (100% visible on all phones) */}
                <div className="sticky top-0 z-30 bg-[#0d121f]/95 backdrop-blur-md border-b border-slate-800/80 px-2 py-2">
                  <div className="grid grid-cols-4 gap-1.5 p-1 bg-slate-900/90 rounded-2xl border border-slate-800 shadow-md">
                    {GAMES.map((game) => {
                      const isActive = activeGame === game.id;
                      return (
                        <button
                          key={game.id}
                          onClick={() => {
                            triggerHaptic('selection');
                            setActiveGame(game.id);
                          }}
                          className={`relative flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 py-2 px-1 rounded-xl transition-all cursor-pointer ${
                            isActive
                              ? 'bg-gradient-to-b from-amber-400 via-amber-500 to-yellow-500 text-slate-950 font-black shadow-md shadow-amber-500/25 ring-1 ring-amber-300'
                              : 'bg-slate-800/40 hover:bg-slate-800/80 text-slate-300 font-bold border border-slate-700/40'
                          }`}
                        >
                          <span className="text-base sm:text-sm leading-none flex items-center justify-center">{game.icon}</span>
                          <span className="text-[11px] sm:text-xs leading-none tracking-tight">{game.title}</span>
                          {game.badge && (
                            <span
                              className={`absolute -top-1.5 -right-1 text-[8px] px-1 py-0.2 rounded-full font-black uppercase shadow-sm ${
                                isActive
                                  ? 'bg-slate-950 text-amber-300 border border-amber-400/40'
                                  : 'bg-rose-500 text-white'
                              }`}
                            >
                              {game.badge}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Active Game Component */}
                <div className="mt-1">
                  {activeGame === 'mines' && (
                    <MinesGame
                      userId={user?.user_id || 7505000952}
                      balance={Number(user?.balance || 0)}
                      onBalanceChange={handleBalanceChange}
                      onOpenFairness={handleOpenFairness}
                    />
                  )}

                  {activeGame === 'roulette' && (
                    <RouletteGame
                      userId={user?.user_id || 7505000952}
                      balance={Number(user?.balance || 0)}
                      onBalanceChange={handleBalanceChange}
                      onOpenFairness={handleOpenFairness}
                    />
                  )}

                  {activeGame === 'dice' && (
                    <DiceGame
                      userId={user?.user_id || 7505000952}
                      balance={Number(user?.balance || 0)}
                      onBalanceChange={handleBalanceChange}
                      onOpenFairness={handleOpenFairness}
                    />
                  )}

                  {activeGame === 'coinflip' && (
                    <CoinflipGame
                      userId={user?.user_id || 7505000952}
                      balance={Number(user?.balance || 0)}
                      onBalanceChange={handleBalanceChange}
                      onOpenFairness={handleOpenFairness}
                    />
                  )}
                </div>
              </div>
            )}

            {currentTab === 'leaderboard' && <LeaderboardTab />}

            {currentTab === 'referrals' && (
              <ReferralsTab
                user={user}
                onOpenWithdraw={() => openWalletWithTab('withdraw')}
              />
            )}

            {currentTab === 'profile' && (
              <ProfileTab
                user={user}
                onOpenWallet={() => openWalletWithTab('deposit')}
              />
            )}
          </>
        )}
      </main>

      {/* Floating / Bottom Navigation Bar */}
      <nav className="fixed bottom-0 inset-x-0 z-40 bg-[#0d121f]/95 backdrop-blur-lg border-t border-slate-800/80 px-2 py-1.5 safe-area-pb">
        <div className="max-w-md mx-auto grid grid-cols-4 gap-1">
          {/* 1. Games Tab */}
          <button
            onClick={() => {
              triggerHaptic('selection');
              setCurrentTab('games');
            }}
            className={`flex flex-col items-center justify-center py-1.5 px-1 rounded-xl transition-all cursor-pointer ${
              currentTab === 'games'
                ? 'text-amber-400 font-black'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <div className={`p-1 rounded-lg ${currentTab === 'games' ? 'bg-amber-500/15' : ''}`}>
              <Gamepad2 size={20} className={currentTab === 'games' ? 'stroke-[2.5]' : ''} />
            </div>
            <span className="text-[10px] mt-0.5 tracking-tight font-bold">Игры</span>
          </button>

          {/* 2. Leaderboard Tab */}
          <button
            onClick={() => {
              triggerHaptic('selection');
              setCurrentTab('leaderboard');
            }}
            className={`flex flex-col items-center justify-center py-1.5 px-1 rounded-xl transition-all cursor-pointer ${
              currentTab === 'leaderboard'
                ? 'text-amber-400 font-black'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <div className={`p-1 rounded-lg ${currentTab === 'leaderboard' ? 'bg-amber-500/15' : ''}`}>
              <Trophy size={20} className={currentTab === 'leaderboard' ? 'stroke-[2.5]' : ''} />
            </div>
            <span className="text-[10px] mt-0.5 tracking-tight font-bold">Топ</span>
          </button>

          {/* 3. Referrals Tab */}
          <button
            onClick={() => {
              triggerHaptic('selection');
              setCurrentTab('referrals');
            }}
            className={`flex flex-col items-center justify-center py-1.5 px-1 rounded-xl transition-all cursor-pointer ${
              currentTab === 'referrals'
                ? 'text-amber-400 font-black'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <div className={`p-1 rounded-lg ${currentTab === 'referrals' ? 'bg-amber-500/15' : ''}`}>
              <Users size={20} className={currentTab === 'referrals' ? 'stroke-[2.5]' : ''} />
            </div>
            <span className="text-[10px] mt-0.5 tracking-tight font-bold">Рефералы</span>
          </button>

          {/* 4. Profile Tab */}
          <button
            onClick={() => {
              triggerHaptic('selection');
              setCurrentTab('profile');
            }}
            className={`flex flex-col items-center justify-center py-1.5 px-1 rounded-xl transition-all cursor-pointer ${
              currentTab === 'profile'
                ? 'text-amber-400 font-black'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <div className={`p-1 rounded-lg ${currentTab === 'profile' ? 'bg-amber-500/15' : ''}`}>
              <User size={20} className={currentTab === 'profile' ? 'stroke-[2.5]' : ''} />
            </div>
            <span className="text-[10px] mt-0.5 tracking-tight font-bold">Профиль</span>
          </button>
        </div>
      </nav>

      {/* Modals */}
      <WalletModal
        isOpen={isWalletOpen}
        onClose={() => setIsWalletOpen(false)}
        user={user}
        onBalanceChange={handleBalanceChange}
        initialTab={walletTab}
      />

      <ProvablyFairModal
        isOpen={isFairnessOpen}
        onClose={() => setIsFairnessOpen(false)}
        fairnessData={fairnessData}
      />
    </div>
  );
}
