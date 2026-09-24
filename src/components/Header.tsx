import React, { useState } from 'react';
import { Wallet, Volume2, VolumeX, Sparkles, User, RefreshCw, Send, ShieldCheck, ChevronDown } from 'lucide-react';
import { isSoundEnabled, toggleSound } from '../utils/sound.ts';
import { triggerHaptic } from '../utils/telegram.ts';

interface HeaderProps {
  user: any;
  onOpenWallet: (tab?: 'deposit' | 'withdraw' | 'promo' | 'bonus') => void;
  onOpenBotInfo: () => void;
  onRefreshUser: () => void;
  onSwitchUser: (userId: number, username: string) => void;
  presets: any[];
}

export const Header: React.FC<HeaderProps> = ({
  user,
  onOpenWallet,
  onOpenBotInfo,
  onRefreshUser,
  onSwitchUser,
  presets,
}) => {
  const [soundOn, setSoundOn] = useState(isSoundEnabled());
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [customInputId, setCustomInputId] = useState('');

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
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 via-amber-500 to-yellow-600 p-[1px] shadow-lg shadow-amber-500/20 flex-shrink-0">
            <div className="w-full h-full bg-[#0d121f] rounded-[11px] flex items-center justify-center">
              <span className="text-lg font-black text-amber-400 tracking-tighter">⚡</span>
            </div>
          </div>
          <div>
            <div className="flex items-center gap-1.5 leading-none">
              <span className="font-extrabold text-base tracking-tight text-white">
                SPIND<span className="text-amber-400">BET</span>
              </span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30 uppercase tracking-wider">
                MINI APP
              </span>
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-[11px] font-medium text-slate-400">Синхрон с @SPIND_BET_BOT</span>
            </div>
          </div>
        </div>

        {/* Right Controls: Balance + Sound + Menu */}
        <div className="flex items-center gap-1.5">
          {/* Balance Pill */}
          <button
            onClick={() => {
              triggerHaptic('medium');
              onOpenWallet();
            }}
            className="group flex items-center bg-gradient-to-r from-slate-900 to-slate-800/90 hover:from-slate-800 hover:to-slate-750 border border-amber-500/30 hover:border-amber-500/60 rounded-xl px-2.5 py-1.5 transition-all shadow-md shadow-black/40"
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
            className="w-8 h-8 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700/60 flex items-center justify-center text-slate-300 hover:text-white transition-colors"
          >
            {soundOn ? <Volume2 size={16} /> : <VolumeX size={16} className="text-slate-500" />}
          </button>

          {/* User Profile / Switcher Dropdown */}
          <div className="relative">
            <button
              onClick={() => {
                triggerHaptic('selection');
                setShowUserDropdown(!showUserDropdown);
              }}
              className="w-8 h-8 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700/60 flex items-center justify-center text-slate-300 hover:text-white transition-colors relative"
            >
              <User size={16} />
              {user?.is_admin === 1 && (
                <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 border border-slate-900 rounded-full" title="Администратор"></span>
              )}
            </button>

            {/* Switch User Dropdown */}
            {showUserDropdown && (
              <div className="absolute right-0 mt-2 w-72 bg-[#121826] border border-slate-700 rounded-2xl p-3 shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-150">
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold text-xs">
                      {user?.username ? user.username[0]?.toUpperCase() : 'U'}
                    </div>
                    <div>
                      <div className="text-xs font-bold text-white leading-tight flex items-center gap-1">
                        @{user?.username || 'user'}
                        {user?.is_admin === 1 && (
                          <span className="text-[9px] px-1 py-0.2 bg-red-500/20 text-red-400 rounded font-semibold">
                            ADMIN
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400">ID: {user?.user_id}</div>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      triggerHaptic('light');
                      onRefreshUser();
                    }}
                    className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
                    title="Обновить данные"
                  >
                    <RefreshCw size={14} />
                  </button>
                </div>

                <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 px-1">
                  Сменить аккаунт для теста:
                </div>
                <div className="space-y-1 max-h-36 overflow-y-auto no-scrollbar">
                  {presets.map((p) => (
                    <button
                      key={p.user_id}
                      onClick={() => {
                        triggerHaptic('medium');
                        onSwitchUser(p.user_id, p.username);
                        setShowUserDropdown(false);
                      }}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                        user?.user_id === p.user_id
                          ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30'
                          : 'hover:bg-slate-800 text-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <span>@{p.username || p.user_id}</span>
                      </div>
                      <span className="text-amber-400 font-semibold">${Number(p.balance || 0).toFixed(2)}</span>
                    </button>
                  ))}
                </div>

                {/* Custom ID Input */}
                <div className="mt-2 pt-2 border-t border-slate-800 flex gap-1">
                  <input
                    type="number"
                    value={customInputId}
                    onChange={(e) => setCustomInputId(e.target.value)}
                    placeholder="Ввести ID..."
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                  />
                  <button
                    onClick={() => {
                      if (customInputId.trim()) {
                        triggerHaptic('medium');
                        onSwitchUser(Number(customInputId), `user_${customInputId}`);
                        setCustomInputId('');
                        setShowUserDropdown(false);
                      }
                    }}
                    className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg text-xs transition-colors"
                  >
                    Войти
                  </button>
                </div>

                <div className="mt-2 pt-2 border-t border-slate-800">
                  <button
                    onClick={() => {
                      setShowUserDropdown(false);
                      onOpenBotInfo();
                    }}
                    className="w-full text-center text-[11px] text-amber-400 hover:text-amber-300 font-semibold flex items-center justify-center gap-1 py-1"
                  >
                    <Send size={12} />
                    Как подключить к своему боту
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
