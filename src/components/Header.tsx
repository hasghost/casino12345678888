import React, { useState } from 'react';
import { Volume2, VolumeX, User, Shield } from 'lucide-react';
import { isSoundEnabled, toggleSound } from '../utils/sound.ts';
import { triggerHaptic } from '../utils/telegram.ts';

interface HeaderProps {
  user: any;
  onOpenWallet: (tab?: 'deposit' | 'withdraw' | 'promo' | 'bonus') => void;
  onNavigateToProfile: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  user,
  onOpenWallet,
  onNavigateToProfile,
}) => {
  const [soundOn, setSoundOn] = useState(isSoundEnabled());

  const handleToggleSound = () => {
    triggerHaptic('light');
    const newState = toggleSound();
    setSoundOn(newState);
  };

  const balance = Number(user?.balance || 0);
  const rubBalance = Math.round(balance * 90);

  return (
    <header className="relative bg-[#0d121f]/95 backdrop-blur-md border-b border-slate-800/80 sticky top-0 z-30 px-3.5 py-2.5">
      <div className="max-w-2xl mx-auto flex items-center justify-between gap-2">
        {/* Brand / Logo */}
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 via-amber-500 to-yellow-600 p-[1px] shadow-lg shadow-amber-500/20 flex-shrink-0">
            <div className="w-full h-full bg-[#0d121f] rounded-[11px] flex items-center justify-center">
              <span className="text-lg font-black text-amber-400 tracking-tighter">⚡</span>
            </div>
          </div>
          <div>
            <div className="flex items-center leading-none">
              <span className="font-black text-lg tracking-tight text-white">
                SPIND<span className="text-amber-400">BET</span>
              </span>
            </div>
          </div>
        </div>

        {/* Right Controls: Balance + Sound + Profile */}
        <div className="flex items-center gap-1.5">
          {/* Balance Pill */}
          <button
            onClick={() => {
              triggerHaptic('medium');
              onOpenWallet('deposit');
            }}
            className="group flex items-center bg-gradient-to-r from-slate-900 to-slate-800/90 hover:from-slate-800 hover:to-slate-750 border border-amber-500/30 hover:border-amber-500/60 rounded-xl px-2.5 py-1.5 transition-all shadow-md shadow-black/40 cursor-pointer"
          >
            <div className="text-right mr-2">
              <div className="text-xs font-black text-amber-400 tracking-tight leading-none group-hover:text-amber-300">
                ${balance.toFixed(2)}
              </div>
              <div className="text-[10px] font-semibold text-slate-400 leading-none mt-0.5">
                ~{rubBalance.toLocaleString('ru-RU')} ₽
              </div>
            </div>
            <div className="w-6 h-6 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 flex items-center justify-center shadow-sm font-bold text-sm transition-transform group-hover:scale-105">
              +
            </div>
          </button>

          {/* Sound Toggle */}
          <button
            onClick={handleToggleSound}
            aria-label="Переключить звук"
            className="w-8 h-8 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700/60 flex items-center justify-center text-slate-300 hover:text-white transition-colors cursor-pointer"
          >
            {soundOn ? <Volume2 size={16} /> : <VolumeX size={16} className="text-slate-500" />}
          </button>

          {/* User Profile Shortcut */}
          <button
            onClick={() => {
              triggerHaptic('selection');
              onNavigateToProfile();
            }}
            aria-label="Открыть профиль"
            className="w-8 h-8 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700/60 flex items-center justify-center text-slate-300 hover:text-white transition-colors relative cursor-pointer"
          >
            <User size={16} />
            {user?.is_admin === 1 && (
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 border border-slate-900 rounded-full" title="Администратор"></span>
            )}
          </button>
        </div>
      </div>
    </header>
  );
};
