import React, { useState, useEffect } from 'react';
import {
  Bomb,
  Wallet,
  Trophy,
  Users,
  User,
  Sparkles,
  Info,
  Gift,
  Flame,
} from 'lucide-react';
import { Header } from './components/Header.tsx';
import { MinesGame } from './components/MinesGame.tsx';
import { WalletModal } from './components/WalletModal.tsx';
import { LeaderboardTab } from './components/LeaderboardTab.tsx';
import { ReferralsTab } from './components/ReferralsTab.tsx';
import { ProfileTab } from './components/ProfileTab.tsx';
import { BotIntegrationModal } from './components/BotIntegrationModal.tsx';
import { ProvablyFairModal } from './components/ProvablyFairModal.tsx';
import { initTelegramApp, getTelegramUser, setCustomUser, triggerHaptic } from './utils/telegram.ts';

export default function App() {
  const [currentTab, setCurrentTab] = useState<'mines' | 'wallet' | 'leaderboard' | 'referrals' | 'profile'>('mines');
  const [user, setUser] = useState<any>(null);
  const [presets, setPresets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals state
  const [isWalletOpen, setIsWalletOpen] = useState(false);
  const [walletTab, setWalletTab] = useState<'deposit' | 'withdraw' | 'promo' | 'bonus'>('deposit');
  const [isBotInfoOpen, setIsBotInfoOpen] = useState(false);
  const [isFairnessOpen, setIsFairnessOpen] = useState(false);
  const [fairnessData, setFairnessData] = useState<any>(null);

  // Initialize Telegram WebApp SDK & load user data
  useEffect(() => {
    initTelegramApp();
    const tgUser = getTelegramUser();
    loadUser(tgUser.id, tgUser.username);
    loadPresets();
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

  const loadPresets = async () => {
    try {
      const res = await fetch('/api/users/presets');
      const data = await res.json();
      if (data.ok) {
        setPresets(data.presets || []);
      }
    } catch (err) {
      console.error('Failed to load presets:', err);
    }
  };

  const handleSwitchUser = (userId: number, username: string) => {
    setCustomUser({ id: userId, username });
    loadUser(userId, username);
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
        onOpenBotInfo={() => setIsBotInfoOpen(true)}
        onRefreshUser={() => user && loadUser(user.user_id, user.username)}
        onSwitchUser={handleSwitchUser}
        presets={presets}
      />

      {/* Main Content Body */}
      <main className="flex-1 w-full max-w-2xl mx-auto">
        {loading ? (
          <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 animate-spin">
              ⚡
            </div>
            <p className="text-xs font-bold text-slate-400">Синхронизация со SpindBet...</p>
          </div>
        ) : (
          <>
            {currentTab === 'mines' && (
              <MinesGame
                userId={user?.user_id || 7505000952}
                balance={Number(user?.balance || 0)}
                onBalanceChange={handleBalanceChange}
                onOpenFairness={handleOpenFairness}
              />
            )}

            {currentTab === 'wallet' && (
              <div className="p-3">
                <WalletModal
                  isOpen={true}
                  onClose={() => setCurrentTab('mines')}
                  user={user}
                  onBalanceChange={handleBalanceChange}
                  initialTab="deposit"
                />
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
                onOpenBotInfo={() => setIsBotInfoOpen(true)}
              />
            )}
          </>
        )}
      </main>

      {/* Floating / Bottom Navigation Bar */}
      <nav className="fixed bottom-0 inset-x-0 z-40 bg-[#0d121f]/95 backdrop-blur-lg border-t border-slate-800/80 px-2 py-1.5 safe-area-pb">
        <div className="max-w-md mx-auto grid grid-cols-5 gap-1">
          {/* 1. Mines Tab */}
          <button
            onClick={() => {
              triggerHaptic('selection');
              setCurrentTab('mines');
            }}
            className={`flex flex-col items-center justify-center py-1.5 px-1 rounded-xl transition-all ${
              currentTab === 'mines'
                ? 'text-amber-400 font-black'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <div className={`p-1 rounded-lg ${currentTab === 'mines' ? 'bg-amber-500/15' : ''}`}>
              <Bomb size={20} className={currentTab === 'mines' ? 'stroke-[2.5]' : ''} />
            </div>
            <span className="text-[10px] mt-0.5 tracking-tight font-bold">Мины</span>
          </button>

          {/* 2. Wallet Tab */}
          <button
            onClick={() => {
              triggerHaptic('selection');
              openWalletWithTab('deposit');
            }}
            className={`flex flex-col items-center justify-center py-1.5 px-1 rounded-xl transition-all ${
              currentTab === 'wallet'
                ? 'text-amber-400 font-black'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <div className={`p-1 rounded-lg ${currentTab === 'wallet' ? 'bg-amber-500/15' : ''}`}>
              <Wallet size={20} className={currentTab === 'wallet' ? 'stroke-[2.5]' : ''} />
            </div>
            <span className="text-[10px] mt-0.5 tracking-tight font-bold">Касса</span>
          </button>

          {/* 3. Leaderboard Tab */}
          <button
            onClick={() => {
              triggerHaptic('selection');
              setCurrentTab('leaderboard');
            }}
            className={`flex flex-col items-center justify-center py-1.5 px-1 rounded-xl transition-all ${
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

          {/* 4. Referrals Tab */}
          <button
            onClick={() => {
              triggerHaptic('selection');
              setCurrentTab('referrals');
            }}
            className={`flex flex-col items-center justify-center py-1.5 px-1 rounded-xl transition-all ${
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

          {/* 5. Profile Tab */}
          <button
            onClick={() => {
              triggerHaptic('selection');
              setCurrentTab('profile');
            }}
            className={`flex flex-col items-center justify-center py-1.5 px-1 rounded-xl transition-all ${
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

      <BotIntegrationModal
        isOpen={isBotInfoOpen}
        onClose={() => setIsBotInfoOpen(false)}
      />

      <ProvablyFairModal
        isOpen={isFairnessOpen}
        onClose={() => setIsFairnessOpen(false)}
        fairnessData={fairnessData}
      />
    </div>
  );
}
