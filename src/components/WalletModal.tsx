import React, { useState } from 'react';
import {
  X,
  ArrowDownLeft,
  ArrowUpRight,
  Gift,
  Calendar,
  Copy,
  Check,
  ExternalLink,
  ShieldCheck,
  AlertCircle,
  Coins,
} from 'lucide-react';
import { triggerHaptic } from '../utils/telegram.ts';
import { openExternalUrl } from '../utils/telegram.ts';

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: any;
  onBalanceChange: (newBalance: number) => void;
  initialTab?: 'deposit' | 'withdraw' | 'promo' | 'bonus';
}

export const WalletModal: React.FC<WalletModalProps> = ({
  isOpen,
  onClose,
  user,
  onBalanceChange,
  initialTab = 'deposit',
}) => {
  const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw' | 'promo' | 'bonus'>(initialTab);
  const [promoCode, setPromoCode] = useState('');
  const [promoStatus, setPromoStatus] = useState<{ success: boolean; msg: string } | null>(null);
  const [bonusStatus, setBonusStatus] = useState<{ success: boolean; msg: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Deposit state
  const [depositAmount, setDepositAmount] = useState('1.00');
  const [depositLoading, setDepositLoading] = useState(false);
  const [invoiceUrl, setInvoiceUrl] = useState<string | null>(null);

  // Withdraw state
  const [withdrawAmount, setWithdrawAmount] = useState('0.50');
  const [withdrawMsg, setWithdrawMsg] = useState<{ success: boolean; text: string; url?: string } | null>(null);

  if (!isOpen) return null;

  const balance = Number(user?.balance || 0);
  const refBalance = Number(user?.referral_balance || 0);
  const totalGames = Number(user?.total_games || 0);
  const totalBets = Number(user?.total_bets_amount || 0);

  const handleCopyId = () => {
    triggerHaptic('light');
    navigator.clipboard.writeText(String(user?.user_id));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleActivatePromo = async () => {
    if (!promoCode.trim()) return;
    triggerHaptic('medium');
    try {
      const res = await fetch('/api/promo/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user?.user_id, code: promoCode }),
      });
      const data = await res.json();
      if (data.ok) {
        setPromoStatus({ success: true, msg: `Успешно! Начислено $${data.amount.toFixed(2)}` });
        onBalanceChange(data.balance);
        setPromoCode('');
      } else {
        setPromoStatus({ success: false, msg: data.error || 'Ошибка активации' });
      }
    } catch {
      setPromoStatus({ success: false, msg: 'Ошибка связи с сервером' });
    }
  };

  const handleClaimBonus = async () => {
    triggerHaptic('medium');
    try {
      const res = await fetch('/api/bonus/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user?.user_id }),
      });
      const data = await res.json();
      if (data.ok) {
        if (data.won) {
          setBonusStatus({ success: true, msg: `Поздравляем! Вы выиграли $${data.amount.toFixed(2)} на баланс!` });
          onBalanceChange(data.balance);
        } else {
          setBonusStatus({ success: false, msg: 'Не повезло! Попробуйте завтра через 24 часа.' });
        }
      } else {
        setBonusStatus({ success: false, msg: data.error || 'Ошибка получения бонуса' });
      }
    } catch {
      setBonusStatus({ success: false, msg: 'Ошибка запроса' });
    }
  };

  const handleCreateCryptoInvoice = () => {
    triggerHaptic('medium');
    setDepositLoading(true);
    // In production, CryptoBot creates direct invoice. We open bot's deposit or CryptoBot pay link:
    setTimeout(() => {
      setDepositLoading(false);
      const url = `https://t.me/CryptoBot?start=pay_${user?.user_id}`;
      setInvoiceUrl(url);
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 animate-in fade-in duration-200">
      <div className="bg-[#121826] border border-slate-700/80 rounded-3xl w-full max-w-md p-4 sm:p-5 shadow-2xl relative max-h-[90vh] overflow-y-auto no-scrollbar">
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div>
            <h3 className="text-base font-black text-white flex items-center gap-1.5">
              <span>Касса & Бонусы</span>
              <span className="text-amber-400">SpindBet</span>
            </h3>
            <p className="text-[11px] text-slate-400">Управление балансом и мгновенные выплаты</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Balance Card Summary */}
        <div className="my-3.5 bg-gradient-to-br from-slate-900 to-slate-800/80 border border-slate-700/60 rounded-2xl p-3.5 flex items-center justify-between">
          <div>
            <span className="text-[10px] uppercase font-extrabold tracking-wider text-slate-400">Основной баланс</span>
            <div className="text-2xl font-black text-amber-400 tracking-tight leading-none mt-1">
              ${balance.toFixed(2)}
            </div>
            <div className="text-[11px] font-semibold text-slate-400 mt-1">
              ~{(balance * 90).toLocaleString('ru-RU')} ₽ (курс 90₽)
            </div>
          </div>
          <div className="text-right">
            <span className="text-[10px] uppercase font-extrabold tracking-wider text-slate-400">Реферальный</span>
            <div className="text-base font-bold text-slate-200 mt-1">
              ${refBalance.toFixed(2)}
            </div>
            <div className="text-[10px] text-emerald-400 font-semibold mt-1">
              7% от проигрышей
            </div>
          </div>
        </div>

        {/* Tab Buttons */}
        <div className="grid grid-cols-4 gap-1 p-1 bg-slate-900 rounded-xl mb-4 text-xs font-bold">
          <button
            onClick={() => {
              triggerHaptic('selection');
              setActiveTab('deposit');
            }}
            className={`py-2 rounded-lg transition-colors flex items-center justify-center gap-1 ${
              activeTab === 'deposit'
                ? 'bg-amber-500 text-slate-950 shadow-md font-black'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <ArrowDownLeft size={13} />
            <span>Ввод</span>
          </button>
          <button
            onClick={() => {
              triggerHaptic('selection');
              setActiveTab('withdraw');
            }}
            className={`py-2 rounded-lg transition-colors flex items-center justify-center gap-1 ${
              activeTab === 'withdraw'
                ? 'bg-amber-500 text-slate-950 shadow-md font-black'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <ArrowUpRight size={13} />
            <span>Вывод</span>
          </button>
          <button
            onClick={() => {
              triggerHaptic('selection');
              setActiveTab('promo');
            }}
            className={`py-2 rounded-lg transition-colors flex items-center justify-center gap-1 ${
              activeTab === 'promo'
                ? 'bg-amber-500 text-slate-950 shadow-md font-black'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Gift size={13} />
            <span>Промо</span>
          </button>
          <button
            onClick={() => {
              triggerHaptic('selection');
              setActiveTab('bonus');
            }}
            className={`py-2 rounded-lg transition-colors flex items-center justify-center gap-1 ${
              activeTab === 'bonus'
                ? 'bg-amber-500 text-slate-950 shadow-md font-black'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Calendar size={13} />
            <span>Бонус</span>
          </button>
        </div>

        {/* TAB 1: DEPOSIT */}
        {activeTab === 'deposit' && (
          <div className="space-y-3 animate-in fade-in">
            {/* Method 1: CryptoBot */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center font-black text-sm">
                    💎
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-white leading-tight">CryptoBot (USDT)</h4>
                    <span className="text-[10px] text-slate-400">Мгновенно, без комиссии • Мин. $0.05</span>
                  </div>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-bold border border-emerald-500/30">
                  Авто
                </span>
              </div>

              <div className="flex gap-2 pt-1">
                <input
                  type="number"
                  step="0.1"
                  min="0.05"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  placeholder="Сумма в USDT"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-bold focus:outline-none focus:border-amber-500"
                />
                <button
                  disabled={depositLoading}
                  onClick={handleCreateCryptoInvoice}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs transition-colors flex-shrink-0"
                >
                  {depositLoading ? 'Создание...' : 'Оплатить'}
                </button>
              </div>

              {invoiceUrl && (
                <div className="p-2.5 bg-blue-500/10 border border-blue-500/30 rounded-xl text-xs flex items-center justify-between">
                  <span className="text-blue-300">Счет готов к оплате в боте</span>
                  <button
                    onClick={() => openExternalUrl('https://t.me/SPIND_BET_BOT')}
                    className="text-xs font-bold text-amber-400 hover:underline flex items-center gap-1"
                  >
                    <span>Открыть в боте</span>
                    <ExternalLink size={12} />
                  </button>
                </div>
              )}
            </div>

            {/* Method 2: Telegram Stars */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center font-black text-sm">
                    ⭐
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-white leading-tight">Telegram Stars</h4>
                    <span className="text-[10px] text-slate-400">10 Stars ≈ 0.09 USDT • Мин. 10 ⭐</span>
                  </div>
                </div>
                <button
                  onClick={() => openExternalUrl('https://t.me/SPIND_BET_BOT')}
                  className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg text-xs transition-colors"
                >
                  Купить в боте
                </button>
              </div>
            </div>

            {/* Method 3: NFT Gifts */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-purple-500/20 text-purple-400 flex items-center justify-center font-black text-sm">
                    🎁
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-white leading-tight">NFT Подарки</h4>
                    <span className="text-[10px] text-slate-400">Отправьте подарок @winer404 с вашим ID</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between bg-slate-950 p-2 rounded-xl border border-slate-800 text-xs">
                <span className="text-slate-400">
                  Ваш ID: <b className="text-white font-mono">{user?.user_id}</b>
                </span>
                <button
                  onClick={handleCopyId}
                  className="flex items-center gap-1 text-amber-400 hover:text-amber-300 font-bold"
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  <span>{copied ? 'Скопировано!' : 'Копировать'}</span>
                </button>
              </div>
            </div>

            {/* Method 4: SBP */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-black text-sm">
                  💳
                </div>
                <div>
                  <h4 className="text-xs font-bold text-white leading-tight">СБП (Карты РФ)</h4>
                  <span className="text-[10px] text-slate-400">Через администратора @winer404</span>
                </div>
              </div>
              <button
                onClick={() => openExternalUrl('https://t.me/winer404')}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl text-xs transition-colors border border-slate-700"
              >
                Написать
              </button>
            </div>
          </div>
        )}

        {/* TAB 2: WITHDRAW */}
        {activeTab === 'withdraw' && (
          <div className="space-y-3.5 animate-in fade-in">
            {/* Turn & Games condition info */}
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-xs space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-amber-400">
                <ShieldCheck size={15} />
                <span>Условия вывода (согласно боту)</span>
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                • Минимум сыграно ставок: <b className="text-white">{totalGames}/2</b>
                <br />• Минимальный вывод: <b className="text-white">$0.20</b>
              </p>
            </div>

            {/* CryptoBot Check Withdrawal */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3.5 space-y-2">
              <h4 className="text-xs font-bold text-white flex items-center justify-between">
                <span>Вывод через CryptoBot чек</span>
                <span className="text-[10px] text-emerald-400 font-semibold">Мгновенно</span>
              </h4>
              <div className="flex gap-2">
                <input
                  type="number"
                  step="0.1"
                  min="0.2"
                  max={balance}
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  placeholder="Сумма ($)"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-bold focus:outline-none focus:border-amber-500"
                />
                <button
                  onClick={() => {
                    const amt = Number(withdrawAmount);
                    if (totalGames < 2) {
                      setWithdrawMsg({
                        success: false,
                        text: `Требуется минимум 2 сыгранные ставки перед выводом! (У вас: ${totalGames})`,
                      });
                      return;
                    }
                    if (amt < 0.2) {
                      setWithdrawMsg({ success: false, text: 'Минимальный вывод: $0.20' });
                      return;
                    }
                    if (amt > balance) {
                      setWithdrawMsg({ success: false, text: 'Недостаточно средств на балансе!' });
                      return;
                    }

                    // Success - deduct balance and show receipt
                    onBalanceChange(balance - amt);
                    const mockCheckUrl = `https://t.me/CryptoBot?start=check_${Math.random().toString(36).substring(7)}`;
                    setWithdrawMsg({
                      success: true,
                      text: `Вывод $${amt.toFixed(2)} успешно сформирован! Чек готов к получению.`,
                      url: mockCheckUrl,
                    });
                  }}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black rounded-xl text-xs transition-colors flex-shrink-0"
                >
                  Вывести
                </button>
              </div>

              {withdrawMsg && (
                <div
                  className={`p-2.5 rounded-xl text-xs ${
                    withdrawMsg.success
                      ? 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-300'
                      : 'bg-red-500/15 border border-red-500/40 text-red-300'
                  }`}
                >
                  <div>{withdrawMsg.text}</div>
                  {withdrawMsg.url && (
                    <button
                      onClick={() => openExternalUrl(withdrawMsg.url!)}
                      className="mt-2 w-full py-1.5 bg-emerald-500 text-slate-950 font-bold rounded-lg text-center flex items-center justify-center gap-1"
                    >
                      <span>Забрать чек в Telegram</span>
                      <ExternalLink size={12} />
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* SBP Withdrawal */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-white">Вывод на СБП (Рубли)</h4>
                  <span className="text-[10px] text-slate-400">
                    Требуется оборот ставок: <b className="text-white">${totalBets.toFixed(2)} / $10.00</b>
                  </span>
                </div>
                {totalBets >= 10.0 ? (
                  <button
                    onClick={() => openExternalUrl('https://t.me/winer404')}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs transition-colors"
                  >
                    Запросить
                  </button>
                ) : (
                  <span className="text-[10px] text-red-400 font-bold bg-red-500/10 px-2 py-1 rounded-lg">
                    Недоступно
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: PROMO CODE */}
        {activeTab === 'promo' && (
          <div className="space-y-3.5 animate-in fade-in">
            <div className="p-3 bg-slate-900/90 border border-slate-800 rounded-2xl space-y-2">
              <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                <Gift size={14} className="text-amber-400" />
                <span>Активация промокода</span>
              </h4>
              <p className="text-[11px] text-slate-400">
                Введите секретный промокод из нашего официального канала или розыгрыша:
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={promoCode}
                  onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                  placeholder="SPIND2026..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono uppercase text-white font-bold focus:outline-none focus:border-amber-500"
                />
                <button
                  onClick={handleActivatePromo}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black rounded-xl text-xs transition-colors flex-shrink-0"
                >
                  Применить
                </button>
              </div>

              {promoStatus && (
                <div
                  className={`p-2 rounded-xl text-xs font-semibold ${
                    promoStatus.success
                      ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                      : 'bg-red-500/15 text-red-300 border border-red-500/30'
                  }`}
                >
                  {promoStatus.msg}
                </div>
              )}
            </div>

            <div className="p-3 bg-slate-900/50 border border-slate-800 rounded-2xl text-[11px] text-slate-400">
              💡 Промокоды регулярно публикуются в Telegram канале новостей казино.
            </div>
          </div>
        )}

        {/* TAB 4: DAILY BONUS */}
        {activeTab === 'bonus' && (
          <div className="space-y-3.5 animate-in fade-in text-center p-3">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 to-yellow-600 flex items-center justify-center text-3xl mx-auto shadow-xl shadow-amber-500/20">
              🎁
            </div>
            <div>
              <h4 className="text-sm font-black text-white">Ежедневный бонус SpindBet</h4>
              <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
                Получайте бонус 1 раз в 24 часа. Шанс 50% выиграть $0.01 прямо на основной баланс!
              </p>
            </div>

            <button
              onClick={handleClaimBonus}
              className="w-full py-3 bg-gradient-to-r from-amber-500 to-yellow-400 hover:brightness-110 text-slate-950 font-black rounded-2xl text-xs uppercase tracking-wider transition-all shadow-lg shadow-amber-500/20"
            >
              Крутить колесо удачи
            </button>

            {bonusStatus && (
              <div
                className={`p-3 rounded-2xl text-xs font-semibold ${
                  bonusStatus.success
                    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                    : 'bg-red-500/15 text-red-300 border border-red-500/30'
                }`}
              >
                {bonusStatus.msg}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
