import React, { useState, useEffect } from 'react';
import {
  X,
  Gift,
  Calendar,
  Copy,
  Check,
  ExternalLink,
  ShieldCheck,
  AlertCircle,
  Coins,
  RefreshCw,
  Zap,
  ArrowDownLeft,
  ArrowUpRight,
  Bot,
  Sparkles,
} from 'lucide-react';
import { triggerHaptic, openExternalUrl } from '../utils/telegram.ts';

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: any;
  onBalanceChange: (newBalance: number) => void;
  initialTab?: 'deposit' | 'withdraw' | 'promo' | 'bonus';
}

const DEFAULT_BOT_USERNAME = 'SPIND_BET_BOT';

export const WalletModal: React.FC<WalletModalProps> = ({
  isOpen,
  onClose,
  user,
  onBalanceChange,
  initialTab = 'deposit',
}) => {
  // Normalize tabs: 'deposit' and 'withdraw' map to 'operations'
  const getNormalizedTab = (tab: string): 'operations' | 'promo' | 'bonus' => {
    if (tab === 'promo') return 'promo';
    if (tab === 'bonus') return 'bonus';
    return 'operations';
  };

  const [activeTab, setActiveTab] = useState<'operations' | 'promo' | 'bonus'>(getNormalizedTab(initialTab));
  const [botUsername, setBotUsername] = useState(DEFAULT_BOT_USERNAME);
  const [botDepositUrl, setBotDepositUrl] = useState(`https://t.me/${DEFAULT_BOT_USERNAME}?start=deposit`);
  const [botWithdrawUrl, setBotWithdrawUrl] = useState(`https://t.me/${DEFAULT_BOT_USERNAME}?start=withdraw`);
  const [promoCode, setPromoCode] = useState('');
  const [promoStatus, setPromoStatus] = useState<{ success: boolean; msg: string } | null>(null);
  const [promoLoading, setPromoLoading] = useState(false);
  const [bonusStatus, setBonusStatus] = useState<{ success: boolean; msg: string } | null>(null);
  const [bonusLoading, setBonusLoading] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [refreshingBalance, setRefreshingBalance] = useState(false);

  useEffect(() => {
    setActiveTab(getNormalizedTab(initialTab));
  }, [initialTab, isOpen]);

  // Fetch bot info from server
  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/bot/info')
      .then((res) => res.json())
      .then((data) => {
        if (data.ok && data.bot) {
          if (data.bot.username) setBotUsername(data.bot.username);
          if (data.bot.depositUrl) setBotDepositUrl(data.bot.depositUrl);
          if (data.bot.withdrawUrl) setBotWithdrawUrl(data.bot.withdrawUrl);
        }
      })
      .catch(() => {});
  }, [isOpen]);

  if (!isOpen) return null;

  const balance = Number(user?.balance || 0);
  const rubBalance = Math.round(balance * 90);
  const refBalance = Number(user?.referral_balance || 0);

  const handleCopyId = () => {
    triggerHaptic('light');
    if (user?.user_id) {
      navigator.clipboard.writeText(String(user.user_id));
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    }
  };

  const handleRefreshBalance = async () => {
    if (refreshingBalance || !user?.user_id) return;
    triggerHaptic('light');
    setRefreshingBalance(true);
    try {
      const res = await fetch(`/api/user?userId=${user.user_id}`);
      const data = await res.json();
      if (data.ok && data.user) {
        onBalanceChange(Number(data.user.balance || 0));
        triggerHaptic('success');
      }
    } catch {
      // ignore
    } finally {
      setTimeout(() => setRefreshingBalance(false), 500);
    }
  };

  const handleOpenBotDeposit = () => {
    triggerHaptic('medium');
    openExternalUrl(botDepositUrl);
  };

  const handleOpenBotWithdraw = () => {
    triggerHaptic('light');
    openExternalUrl(botWithdrawUrl);
  };

  const handleActivatePromo = async () => {
    const trimmed = promoCode.trim();
    if (!trimmed || promoLoading) return;
    triggerHaptic('medium');
    setPromoLoading(true);
    setPromoStatus(null);

    try {
      const res = await fetch('/api/promo/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user?.user_id, code: trimmed }),
      });
      const data = await res.json();
      if (data.ok) {
        setPromoStatus({ success: true, msg: `Успешно! Начислено $${data.amount.toFixed(2)}` });
        onBalanceChange(data.balance);
        setPromoCode('');
        triggerHaptic('success');
      } else {
        setPromoStatus({ success: false, msg: data.error || 'Ошибка активации' });
        triggerHaptic('error');
      }
    } catch {
      setPromoStatus({ success: false, msg: 'Ошибка связи с сервером' });
    } finally {
      setPromoLoading(false);
    }
  };

  const handleClaimBonus = async () => {
    if (bonusLoading) return;
    triggerHaptic('medium');
    setBonusLoading(true);
    setBonusStatus(null);

    try {
      const res = await fetch('/api/bonus/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user?.user_id }),
      });
      const data = await res.json();
      if (data.ok) {
        if (data.won) {
          setBonusStatus({ success: true, msg: `Ура! Вы получили ежедневный бонус +$${data.amount.toFixed(2)}!` });
          onBalanceChange(data.balance);
          triggerHaptic('success');
        } else {
          setBonusStatus({ success: false, msg: 'Увы, в этот раз не выпало. Попробуйте снова завтра!' });
          triggerHaptic('light');
        }
      } else {
        setBonusStatus({ success: false, msg: data.error || 'Бонус пока недоступен' });
        triggerHaptic('error');
      }
    } catch {
      setBonusStatus({ success: false, msg: 'Ошибка соединения с сервером' });
    } finally {
      setBonusLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3.5 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-[#101524] border border-slate-800 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-800/80 bg-slate-900/60">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Coins size={18} />
            </div>
            <div>
              <h3 className="text-sm font-black text-white leading-tight">Баланс и операции</h3>
              <p className="text-[10px] text-slate-400">Управление счетом SpindBet</p>
            </div>
          </div>
          <button
            onClick={() => {
              triggerHaptic('light');
              onClose();
            }}
            className="w-8 h-8 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Balance Card */}
        <div className="p-4 bg-gradient-to-b from-[#141b2e] to-[#101524] border-b border-slate-800/80 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Текущий баланс</span>
            <button
              onClick={handleRefreshBalance}
              disabled={refreshingBalance}
              className="text-[11px] font-bold text-amber-400 hover:text-amber-300 flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw size={12} className={refreshingBalance ? 'animate-spin' : ''} />
              <span>Обновить</span>
            </button>
          </div>

          <div className="flex items-baseline justify-between">
            <div>
              <div className="text-3xl font-black text-amber-400 tracking-tight">
                ${balance.toFixed(2)}
              </div>
              <div className="text-xs font-semibold text-slate-400 mt-0.5">
                ~{rubBalance.toLocaleString('ru-RU')} ₽ (по курсу 1$ = 90₽)
              </div>
            </div>

            <div className="text-right">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Реф. счет</span>
              <span className="text-sm font-black text-slate-300">${refBalance.toFixed(2)}</span>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-slate-800/60 text-[11px]">
            <span className="text-slate-400">Telegram ID:</span>
            <button
              onClick={handleCopyId}
              className="font-mono text-slate-300 hover:text-amber-400 flex items-center gap-1 transition-colors cursor-pointer"
            >
              <span>{user?.user_id || '—'}</span>
              {copiedId ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
            </button>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-slate-800 bg-[#0d121f] p-1.5 gap-1">
          <button
            onClick={() => {
              triggerHaptic('selection');
              setActiveTab('operations');
            }}
            className={`flex-1 py-2 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'operations'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
            }`}
          >
            <Bot size={14} />
            <span>Пополнение и вывод</span>
          </button>

          <button
            onClick={() => {
              triggerHaptic('selection');
              setActiveTab('promo');
            }}
            className={`flex-1 py-2 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'promo'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
            }`}
          >
            <Gift size={14} />
            <span>Промокод</span>
          </button>

          <button
            onClick={() => {
              triggerHaptic('selection');
              setActiveTab('bonus');
            }}
            className={`flex-1 py-2 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'bonus'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
            }`}
          >
            <Calendar size={14} />
            <span>Бонус</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 overflow-y-auto flex-1 space-y-4">
          {/* TAB 1: OPERATIONS VIA BOT (REPLACES OLD FORMS) */}
          {activeTab === 'operations' && (
            <div className="space-y-4 animate-in fade-in">
              {/* Bot Info Banner */}
              <div className="p-4 rounded-2xl bg-gradient-to-br from-amber-500/10 via-slate-900 to-emerald-500/10 border border-amber-500/30 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 flex-shrink-0 mt-0.5">
                    <ShieldCheck size={22} />
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-white leading-tight">
                      Пополнение и вывод через бота
                    </h4>
                    <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                      Баланс пополняется и выводится через официального бота <b className="text-amber-400">@{botUsername}</b>.
                      Все операции защищены и обрабатываются моментально.
                    </p>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-800/60 grid grid-cols-2 gap-2 text-[11px] text-slate-300">
                  <div className="flex items-center gap-1.5">
                    <Zap size={13} className="text-amber-400 flex-shrink-0" />
                    <span>Мгновенное зачисление</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <ShieldCheck size={13} className="text-emerald-400 flex-shrink-0" />
                    <span>CryptoBot / СБП / Карты</span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="space-y-2.5">
                {/* Main Action: Go to Bot Top-up */}
                <button
                  onClick={handleOpenBotDeposit}
                  className="w-full py-3.5 px-4 bg-gradient-to-r from-amber-500 via-yellow-500 to-amber-500 hover:brightness-110 active:scale-[0.99] text-slate-950 font-black text-sm uppercase tracking-wider rounded-2xl shadow-xl shadow-amber-500/25 flex items-center justify-center gap-2.5 transition-all cursor-pointer"
                >
                  <ArrowDownLeft size={20} className="stroke-[2.5]" />
                  <span>Перейти в бота (Пополнить баланс)</span>
                  <ExternalLink size={16} />
                </button>

                {/* Secondary Action: Go to Bot Withdrawal */}
                <button
                  onClick={handleOpenBotWithdraw}
                  className="w-full py-3 px-4 bg-slate-900 hover:bg-slate-800 border border-slate-700/80 active:scale-[0.99] text-slate-200 hover:text-white font-bold text-xs uppercase tracking-wider rounded-2xl flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  <ArrowUpRight size={16} className="text-amber-400" />
                  <span>Вывести средства через бота</span>
                  <ExternalLink size={14} className="text-slate-400" />
                </button>
              </div>

              {/* Real-time synchronization note */}
              <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800/80 text-[11px] text-slate-400 space-y-1.5">
                <div className="flex items-center gap-1.5 text-slate-300 font-bold">
                  <Sparkles size={13} className="text-amber-400" />
                  <span>Синхронизация баланса:</span>
                </div>
                <p>
                  После пополнения или вывода в боте ваш баланс в мини-аппе обновляется сразу. Если мини-апп уже открыт, нажмите кнопку <b>«Обновить»</b> выше.
                </p>
              </div>
            </div>
          )}

          {/* TAB 2: PROMOCODE */}
          {activeTab === 'promo' && (
            <div className="space-y-3.5 animate-in fade-in">
              <p className="text-xs text-slate-300 leading-relaxed">
                Введите промокод от администрации или партнеров для мгновенного зачисления бонусного баланса:
              </p>

              <div className="space-y-2">
                <div className="relative">
                  <input
                    type="text"
                    value={promoCode}
                    onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                    placeholder="SPIND2026"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-mono text-white placeholder-slate-600 focus:outline-none focus:border-amber-400 transition-colors uppercase"
                  />
                </div>

                <button
                  onClick={handleActivatePromo}
                  disabled={promoLoading || !promoCode.trim()}
                  className="w-full py-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-black text-xs uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {promoLoading ? (
                    <RefreshCw size={14} className="animate-spin" />
                  ) : (
                    <Check size={14} className="stroke-[3]" />
                  )}
                  <span>Активировать промокод</span>
                </button>
              </div>

              {promoStatus && (
                <div
                  className={`p-3 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
                    promoStatus.success
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                      : 'bg-red-500/10 border-red-500/30 text-red-400'
                  }`}
                >
                  {promoStatus.success ? <Check size={14} /> : <AlertCircle size={14} />}
                  <span>{promoStatus.msg}</span>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: DAILY BONUS */}
          {activeTab === 'bonus' && (
            <div className="space-y-3.5 animate-in fade-in text-center">
              <div className="w-14 h-14 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 mx-auto">
                <Gift size={28} />
              </div>

              <div>
                <h4 className="text-sm font-black text-white">Ежедневный бонус</h4>
                <p className="text-xs text-slate-400 mt-1">
                  Забирайте бесплатный бонус раз в 24 часа!
                </p>
              </div>

              <button
                onClick={handleClaimBonus}
                disabled={bonusLoading}
                className="w-full py-3 bg-gradient-to-r from-amber-500 to-yellow-500 hover:brightness-110 disabled:opacity-50 text-slate-950 font-black text-xs uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-amber-500/20"
              >
                {bonusLoading ? (
                  <RefreshCw size={14} className="animate-spin" />
                ) : (
                  <Sparkles size={14} />
                )}
                <span>Получить бонус</span>
              </button>

              {bonusStatus && (
                <div
                  className={`p-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 text-left ${
                    bonusStatus.success
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                      : 'bg-slate-800 border-slate-700 text-slate-300'
                  }`}
                >
                  <AlertCircle size={14} className="flex-shrink-0" />
                  <span>{bonusStatus.msg}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
