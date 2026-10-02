import React from 'react';
import { Send, ShieldAlert, Sparkles, ExternalLink } from 'lucide-react';

interface BrowserBlockScreenProps {
  botUsername: string;
}

export const BrowserBlockScreen: React.FC<BrowserBlockScreenProps> = ({ botUsername }) => {
  const cleanUsername = botUsername.replace(/^@/, '');
  const botUrl = `https://t.me/${cleanUsername}`;

  const handleOpenTelegram = () => {
    try {
      const a = document.createElement('a');
      a.href = botUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {
      window.location.href = botUrl;
    }
  };

  return (
    <div className="min-h-screen bg-[#090c15] text-slate-100 flex flex-col justify-between items-center p-4 sm:p-6 font-sans selection:bg-amber-500/30 selection:text-amber-200">
      {/* Top Branding */}
      <div className="w-full max-w-md flex items-center justify-between pt-2">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 via-amber-500 to-yellow-600 p-[1px] shadow-lg shadow-amber-500/20">
            <div className="w-full h-full bg-[#0d121f] rounded-[11px] flex items-center justify-center">
              <span className="text-lg font-black text-amber-400">⚡</span>
            </div>
          </div>
          <span className="font-black text-lg tracking-tight text-white">
            SPIND<span className="text-amber-400">BET</span>
          </span>
        </div>
        <span className="text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400">
          Mini App Only
        </span>
      </div>

      {/* Center Notice Card */}
      <div className="w-full max-w-md my-auto py-8">
        <div className="relative bg-gradient-to-b from-[#111728] via-[#0d121f] to-[#0a0e17] border-2 border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl text-center overflow-hidden">
          {/* Background Ambient Glow */}
          <div className="absolute -top-20 -left-20 w-44 h-44 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-20 -right-20 w-44 h-44 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

          {/* Icon Badge */}
          <div className="relative mx-auto w-20 h-20 mb-5 rounded-2xl bg-gradient-to-tr from-amber-500/20 to-blue-500/20 border-2 border-amber-500/40 flex items-center justify-center shadow-xl shadow-amber-500/10">
            <Send className="w-10 h-10 text-amber-400 -rotate-12 translate-x-0.5 -translate-y-0.5" />
          </div>

          {/* Heading */}
          <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight mb-2">
            Вход только через Telegram-бота
          </h1>

          <p className="text-sm text-slate-300 font-medium leading-relaxed mb-6">
            Для гарантии безопасности депозитов, моментальных выплат и привязки вашего игрового баланса запускайте SpindBet через официального бота в Telegram.
          </p>

          {/* Feature Highlights */}
          <div className="space-y-2 mb-6 text-left">
            <div className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-900/80 border border-slate-800/80">
              <span className="text-base">💎</span>
              <div className="text-xs">
                <span className="font-bold text-white">Моментальный баланс:</span>
                <span className="text-slate-400 ml-1">привязан к вашему Telegram ID</span>
              </div>
            </div>
            <div className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-900/80 border border-slate-800/80">
              <span className="text-base">⚡</span>
              <div className="text-xs">
                <span className="font-bold text-white">Результаты раундов:</span>
                <span className="text-slate-400 ml-1">приходят прямо в личный чат с ботом</span>
              </div>
            </div>
            <div className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-900/80 border border-slate-800/80">
              <span className="text-base">🛡️</span>
              <div className="text-xs">
                <span className="font-bold text-white">Provably Fair:</span>
                <span className="text-slate-400 ml-1">криптографическая честность каждого раунда</span>
              </div>
            </div>
          </div>

          {/* CTA Launch Button */}
          <button
            onClick={handleOpenTelegram}
            className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-amber-400 via-amber-500 to-yellow-500 hover:from-amber-300 hover:to-yellow-400 text-slate-950 font-black text-base tracking-wide flex items-center justify-center gap-2 shadow-lg shadow-amber-500/25 transition-transform active:scale-98 cursor-pointer"
          >
            <Send className="w-5 h-5 -rotate-12" />
            <span>Открыть в Telegram</span>
            <ExternalLink className="w-4 h-4 ml-0.5 opacity-80" />
          </button>

          <p className="text-[11px] text-slate-400 mt-3 font-semibold">
            Бот: <span className="text-amber-400 font-bold">@{cleanUsername}</span>
          </p>
        </div>
      </div>

      {/* Footer Info */}
      <div className="w-full max-w-md text-center py-2 text-[11px] text-slate-400">
        SpindBet Provably Fair Casino • 2026
      </div>
    </div>
  );
};
