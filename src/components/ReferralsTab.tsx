import React, { useState } from 'react';
import { Users, Copy, Check, Share2, Sparkles, DollarSign, Award, ArrowUpRight } from 'lucide-react';
import { triggerHaptic, openExternalUrl } from '../utils/telegram.ts';

interface ReferralsTabProps {
  user: any;
  onOpenWithdraw: () => void;
}

export const ReferralsTab: React.FC<ReferralsTabProps> = ({ user, onOpenWithdraw }) => {
  const [copied, setCopied] = useState(false);

  const userId = user?.user_id || 7505000952;
  const refLink = `https://t.me/SPIND_BET_BOT?start=${userId}`;
  const refBalance = Number(user?.referral_balance || 0);
  const refCount = Number(user?.referral_count || 0);

  const handleCopy = () => {
    triggerHaptic('light');
    navigator.clipboard.writeText(refLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = () => {
    triggerHaptic('medium');
    const shareText = encodeURIComponent(
      `🔥 Играй в Мины и другие игры в SpindBet Casino прямо в Telegram с мгновенными выплатами!\nПрисоединяйся по моей ссылке:`
    );
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${shareText}`;
    openExternalUrl(shareUrl);
  };

  return (
    <div className="max-w-xl mx-auto px-3.5 py-4 space-y-4 animate-in fade-in">
      {/* Title */}
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400">
          <Users size={18} />
        </div>
        <div>
          <h2 className="text-base font-black text-white leading-tight">Партнёрская программа</h2>
          <p className="text-[11px] text-slate-400">Приглашай друзей и получай пожизненный пассивный доход</p>
        </div>
      </div>

      {/* Referral Stats Cards */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="bg-[#121826] border border-slate-800 rounded-2xl p-3.5">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Реф. баланс</span>
          <div className="text-xl font-black text-amber-400 mt-1">${refBalance.toFixed(2)}</div>
          <button
            onClick={onOpenWithdraw}
            className="mt-2 w-full py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg text-xs flex items-center justify-center gap-1 transition-colors"
          >
            <span>Вывести</span>
            <ArrowUpRight size={13} />
          </button>
        </div>

        <div className="bg-[#121826] border border-slate-800 rounded-2xl p-3.5">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Приглашено игроков</span>
          <div className="text-xl font-black text-white mt-1">{refCount}</div>
          <span className="text-[10px] text-emerald-400 font-semibold block mt-3">Без ограничений</span>
        </div>
      </div>

      {/* Referral Link Box */}
      <div className="bg-[#121826] border border-slate-800 rounded-2xl p-4 space-y-2.5">
        <span className="text-xs font-bold text-slate-300">Ваша реферальная ссылка:</span>
        <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl p-2 font-mono text-xs text-slate-300 overflow-hidden">
          <span className="truncate flex-1">{refLink}</span>
          <button
            onClick={handleCopy}
            className="flex-shrink-0 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-amber-400 rounded-lg font-bold flex items-center gap-1 transition-colors"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            <span>{copied ? 'Скопировано' : 'Копия'}</span>
          </button>
        </div>

        <button
          onClick={handleShare}
          className="w-full py-3 bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-600 hover:brightness-110 text-white font-black rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20 transition-all"
        >
          <Share2 size={15} />
          <span>Поделиться в Telegram</span>
        </button>
      </div>

      {/* Conditions list */}
      <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-3.5 space-y-2">
        <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
          <Sparkles size={14} className="text-amber-400" />
          <span>Условия программы:</span>
        </h4>
        <ul className="text-xs text-slate-400 space-y-1.5 list-disc list-inside">
          <li>
            <b className="text-slate-200">7% от проигрышей</b> всех приглашенных вами игроков
          </li>
          <li>Мгновенное автоматическое зачисление на отдельный реферальный счёт</li>
          <li>Вывод на CryptoBot чек или карту без верификации</li>
        </ul>
      </div>
    </div>
  );
};
