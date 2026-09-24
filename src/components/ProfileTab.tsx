import React from 'react';
import { User, ShieldCheck, Gamepad2, Award, DollarSign, Calendar, MessageCircle, Send, ExternalLink } from 'lucide-react';
import { openExternalUrl } from '../utils/telegram.ts';

interface ProfileTabProps {
  user: any;
  onOpenWallet: () => void;
  onOpenBotInfo: () => void;
}

export const ProfileTab: React.FC<ProfileTabProps> = ({ user, onOpenWallet, onOpenBotInfo }) => {
  const balance = Number(user?.balance || 0);
  const refBalance = Number(user?.referral_balance || 0);
  const totalGames = Number(user?.total_games || 0);
  const totalWins = Number(user?.total_wins || 0);
  const totalBets = Number(user?.total_bets_amount || 0);
  const winrate = totalGames > 0 ? ((totalWins / totalGames) * 100).toFixed(1) : '0.0';

  return (
    <div className="max-w-xl mx-auto px-3.5 py-4 space-y-4 animate-in fade-in">
      {/* User Card */}
      <div className="bg-[#121826] border border-slate-800 rounded-3xl p-4 shadow-xl flex items-center gap-3.5 relative overflow-hidden">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 via-amber-500 to-yellow-600 flex items-center justify-center text-slate-950 font-black text-2xl shadow-lg shadow-amber-500/20 flex-shrink-0">
          {user?.username ? user.username[0]?.toUpperCase() : 'U'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-black text-white truncate">@{user?.username || 'user'}</h3>
            {user?.is_admin === 1 && (
              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/40">
                ADMIN
              </span>
            )}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">
            Telegram ID: <code className="text-amber-400 font-mono">{user?.user_id}</code>
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Регистрация: {user?.registration_date || 'Недавно'}
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="bg-[#121826] border border-slate-800 rounded-2xl p-3.5">
          <div className="flex items-center gap-1.5 text-xs text-slate-400 font-bold mb-1">
            <Gamepad2 size={15} className="text-blue-400" />
            <span>Сыграно игр</span>
          </div>
          <div className="text-xl font-black text-white">{totalGames}</div>
        </div>

        <div className="bg-[#121826] border border-slate-800 rounded-2xl p-3.5">
          <div className="flex items-center gap-1.5 text-xs text-slate-400 font-bold mb-1">
            <Award size={15} className="text-emerald-400" />
            <span>Побед (Винрейт)</span>
          </div>
          <div className="text-xl font-black text-emerald-400">
            {totalWins}{' '}
            <span className="text-xs font-bold text-slate-400">({winrate}%)</span>
          </div>
        </div>

        <div className="bg-[#121826] border border-slate-800 rounded-2xl p-3.5">
          <div className="flex items-center gap-1.5 text-xs text-slate-400 font-bold mb-1">
            <DollarSign size={15} className="text-amber-400" />
            <span>Общий оборот</span>
          </div>
          <div className="text-xl font-black text-amber-400">${totalBets.toFixed(2)}</div>
        </div>

        <div className="bg-[#121826] border border-slate-800 rounded-2xl p-3.5">
          <div className="flex items-center gap-1.5 text-xs text-slate-400 font-bold mb-1">
            <ShieldCheck size={15} className="text-purple-400" />
            <span>Статус честности</span>
          </div>
          <div className="text-sm font-black text-emerald-400 mt-1">Provably Fair SHA-256</div>
        </div>
      </div>

      {/* Action links */}
      <div className="bg-[#121826] border border-slate-800 rounded-2xl divide-y divide-slate-800/80 overflow-hidden shadow-xl text-xs font-bold">
        <button
          onClick={onOpenWallet}
          className="w-full p-3.5 flex items-center justify-between text-slate-200 hover:text-white hover:bg-slate-850 transition-colors"
        >
          <span>Управление балансом и выводами</span>
          <span className="text-amber-400 font-black">${balance.toFixed(2)} →</span>
        </button>

        <button
          onClick={onOpenBotInfo}
          className="w-full p-3.5 flex items-center justify-between text-slate-200 hover:text-white hover:bg-slate-850 transition-colors"
        >
          <span className="flex items-center gap-2">
            <Send size={14} className="text-amber-400" />
            <span>Как подключить Mini App к боту</span>
          </span>
          <span className="text-slate-500">Инструкция →</span>
        </button>

        <button
          onClick={() => openExternalUrl('https://t.me/winer404')}
          className="w-full p-3.5 flex items-center justify-between text-slate-200 hover:text-white hover:bg-slate-850 transition-colors"
        >
          <span className="flex items-center gap-2">
            <MessageCircle size={14} className="text-emerald-400" />
            <span>Служба поддержки (@winer404)</span>
          </span>
          <ExternalLink size={13} className="text-slate-500" />
        </button>
      </div>
    </div>
  );
};
