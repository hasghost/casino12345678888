import React, { useState, useEffect } from 'react';
import { Trophy, Flame, Swords, Award, TrendingUp, RefreshCw } from 'lucide-react';
import { triggerHaptic } from '../utils/telegram.ts';

export const LeaderboardTab: React.FC = () => {
  const [category, setCategory] = useState<'turnover' | 'games' | 'wins'>('turnover');
  const [players, setPlayers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchLeaderboard = async (cat: 'turnover' | 'games' | 'wins') => {
    setLoading(true);
    try {
      const res = await fetch(`/api/leaderboard?category=${cat}`);
      const data = await res.json();
      if (data.ok) {
        setPlayers(data.players || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeaderboard(category);
  }, [category]);

  return (
    <div className="max-w-xl mx-auto px-3.5 py-4 space-y-3.5 animate-in fade-in">
      {/* Title */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <Trophy size={18} />
          </div>
          <div>
            <h2 className="text-base font-black text-white leading-tight">Лидерборд SpindBet</h2>
            <p className="text-[11px] text-slate-400">Топ самых успешных игроков казино</p>
          </div>
        </div>
        <button
          onClick={() => {
            triggerHaptic('light');
            fetchLeaderboard(category);
          }}
          disabled={loading}
          className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Category Pills */}
      <div className="grid grid-cols-3 gap-1 p-1 bg-[#121826] border border-slate-800 rounded-xl text-xs font-bold">
        <button
          onClick={() => {
            triggerHaptic('selection');
            setCategory('turnover');
          }}
          className={`py-2 rounded-lg transition-colors flex items-center justify-center gap-1 ${
            category === 'turnover'
              ? 'bg-amber-500 text-slate-950 shadow-md font-black'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Flame size={13} />
          <span>По обороту</span>
        </button>
        <button
          onClick={() => {
            triggerHaptic('selection');
            setCategory('games');
          }}
          className={`py-2 rounded-lg transition-colors flex items-center justify-center gap-1 ${
            category === 'games'
              ? 'bg-amber-500 text-slate-950 shadow-md font-black'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Swords size={13} />
          <span>По ставкам</span>
        </button>
        <button
          onClick={() => {
            triggerHaptic('selection');
            setCategory('wins');
          }}
          className={`py-2 rounded-lg transition-colors flex items-center justify-center gap-1 ${
            category === 'wins'
              ? 'bg-amber-500 text-slate-950 shadow-md font-black'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Award size={13} />
          <span>По победам</span>
        </button>
      </div>

      {/* Player List */}
      <div className="bg-[#121826] border border-slate-800 rounded-2xl overflow-hidden shadow-xl divide-y divide-slate-800/80">
        {loading ? (
          <div className="p-8 text-center text-xs text-slate-400">Загрузка рейтинга...</div>
        ) : players.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">Пока нет данных в таблице лидеров</div>
        ) : (
          players.map((p, idx) => {
            const medal =
              idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}.`;

            return (
              <div
                key={p.user_id}
                className="flex items-center justify-between p-3 hover:bg-slate-800/40 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="w-6 text-center font-black text-sm text-slate-400">{medal}</span>
                  <div>
                    <div className="text-xs font-bold text-white flex items-center gap-1.5">
                      <span>@{p.username || `ID ${p.user_id}`}</span>
                    </div>
                    <div className="text-[10px] text-slate-400">
                      Винрейт: <b className="text-emerald-400">{p.winrate}%</b> • Игр: {p.total_games}
                    </div>
                  </div>
                </div>

                <div className="text-right">
                  {category === 'turnover' && (
                    <div className="text-xs font-black text-amber-400">
                      ${Number(p.total_bets_amount || 0).toFixed(2)}
                    </div>
                  )}
                  {category === 'games' && (
                    <div className="text-xs font-black text-amber-400">{p.total_games} ставок</div>
                  )}
                  {category === 'wins' && (
                    <div className="text-xs font-black text-emerald-400">{p.total_wins} побед</div>
                  )}
                  <span className="text-[9px] text-slate-500 uppercase tracking-wider">
                    {category === 'turnover' ? 'Оборот' : category === 'games' ? 'Сыграно' : 'Победы'}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
