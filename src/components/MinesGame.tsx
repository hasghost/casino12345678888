import React, { useState, useEffect } from 'react';
import confetti from 'canvas-confetti';
import {
  Bomb,
  Sparkles,
  ShieldCheck,
  Dices,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Info,
  ChevronRight,
  TrendingUp,
} from 'lucide-react';
import { playClickSound, playGemSound, playBombSound, playCashoutSound } from '../utils/sound.ts';
import { triggerHaptic } from '../utils/telegram.ts';
import { calculateMinesMultiplier } from '../utils/minesMath.ts';

interface MinesGameProps {
  userId: number;
  balance: number;
  onBalanceChange: (newBalance: number) => void;
  onOpenFairness: (data: any) => void;
}

interface ActiveGameState {
  betAmount: number;
  minesCount: number;
  opened: number[];
  currentMultiplier: number;
  nextMultiplier: number;
  roundId?: number;
}

const MINES_OPTIONS = [1, 2, 3, 5, 10, 15, 20, 24];
const QUICK_BETS = [0.05, 0.1, 0.5, 1.0, 5.0, 10.0];

export const MinesGame: React.FC<MinesGameProps> = ({
  userId,
  balance,
  onBalanceChange,
  onOpenFairness,
}) => {
  const [betAmount, setBetAmount] = useState<number>(0.5);
  const [minesCount, setMinesCount] = useState<number>(10); // Default in bot
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [activeGame, setActiveGame] = useState<ActiveGameState | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  // Grid results after game finishes
  const [revealedMines, setRevealedMines] = useState<number[] | null>(null);
  const [lastHitCell, setLastHitCell] = useState<number | null>(null);
  const [lastWinInfo, setLastWinInfo] = useState<{ amount: number; multiplier: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Provably Fair data for current/last round
  const [fairnessData, setFairnessData] = useState<any>(null);

  // Check active game on load or userId change
  useEffect(() => {
    checkActiveGame();
  }, [userId]);

  const checkActiveGame = async () => {
    try {
      const res = await fetch(`/api/mines/active?userId=${userId}`);
      const data = await res.json();
      if (data.ok && data.active && data.game) {
        setIsPlaying(true);
        setActiveGame(data.game);
        setMinesCount(data.game.minesCount);
        setBetAmount(data.game.betAmount);
        setRevealedMines(null);
        setLastHitCell(null);
        setLastWinInfo(null);
      } else {
        setIsPlaying(false);
        setActiveGame(null);
      }
    } catch (err) {
      console.error('Failed to check active game:', err);
    }
  };

  const handleStartGame = async () => {
    if (betAmount < 0.01) {
      setErrorMsg('Минимальная ставка $0.01');
      return;
    }
    if (betAmount > balance) {
      setErrorMsg('Недостаточно средств на балансе!');
      return;
    }

    playClickSound();
    triggerHaptic('medium');
    setLoading(true);
    setErrorMsg(null);
    setRevealedMines(null);
    setLastHitCell(null);
    setLastWinInfo(null);

    try {
      const res = await fetch('/api/mines/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          betAmount,
          minesCount,
        }),
      });

      const data = await res.json();
      if (!data.ok) {
        setErrorMsg(data.error || 'Ошибка при начале игры');
        if (data.activeGame) {
          checkActiveGame();
        }
        return;
      }

      setIsPlaying(true);
      setActiveGame(data.game);
      setFairnessData(data.fairness);
      onBalanceChange(data.balance);
    } catch (err: any) {
      setErrorMsg('Сетевая ошибка сервера');
    } finally {
      setLoading(false);
    }
  };

  const handleCellClick = async (cellId: number) => {
    if (!isPlaying || loading || !activeGame) return;
    if (activeGame.opened.includes(cellId)) return;

    playClickSound();
    triggerHaptic('light');
    setLoading(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/mines/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, cellId }),
      });

      const data = await res.json();
      if (!data.ok) {
        setErrorMsg(data.error || 'Ошибка открытия ячейки');
        return;
      }

      // 1. Hit a mine (Defeat)
      if (data.hitMine) {
        playBombSound();
        triggerHaptic('error');
        setIsPlaying(false);
        setRevealedMines(data.mines);
        setLastHitCell(cellId);
        setActiveGame((prev) => (prev ? { ...prev, opened: data.opened } : null));
        onBalanceChange(data.balance);
        setFairnessData(data.fairness);
        return;
      }

      // 2. Opened all safe tiles (Ultimate Victory)
      if (data.allCleared) {
        playCashoutSound();
        triggerHaptic('success');
        confetti({
          particleCount: 80,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#f59e0b', '#10b981', '#3b82f6', '#ec4899'],
        });
        setIsPlaying(false);
        setRevealedMines(data.mines);
        setLastWinInfo({ amount: data.winAmount, multiplier: data.currentMultiplier });
        onBalanceChange(data.balance);
        setFairnessData(data.fairness);
        return;
      }

      // 3. Safe tile revealed (Continue game)
      playGemSound(data.opened.length);
      triggerHaptic('selection');
      setActiveGame((prev) =>
        prev
          ? {
              ...prev,
              opened: data.opened,
              currentMultiplier: data.currentMultiplier,
              nextMultiplier: data.nextMultiplier,
            }
          : null
      );
    } catch (err: any) {
      setErrorMsg('Ошибка соединения с сервером');
    } finally {
      setLoading(false);
    }
  };

  const handleCashout = async () => {
    if (!isPlaying || loading || !activeGame || activeGame.opened.length === 0) return;

    playCashoutSound();
    triggerHaptic('success');
    setLoading(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/mines/cashout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });

      const data = await res.json();
      if (!data.ok) {
        setErrorMsg(data.error || 'Ошибка при заборе выигрыша');
        return;
      }

      confetti({
        particleCount: 60,
        spread: 60,
        origin: { y: 0.65 },
        colors: ['#f59e0b', '#10b981', '#fbbf24'],
      });

      setIsPlaying(false);
      setRevealedMines(data.mines);
      setLastWinInfo({ amount: data.winAmount, multiplier: data.multiplier });
      onBalanceChange(data.balance);
      setFairnessData(data.fairness);
    } catch (err) {
      setErrorMsg('Ошибка сервера при выводе');
    } finally {
      setLoading(false);
    }
  };

  const handleRandomPick = () => {
    if (!isPlaying || !activeGame) return;
    const unopened: number[] = [];
    for (let i = 0; i < 25; i++) {
      if (!activeGame.opened.includes(i)) {
        unopened.push(i);
      }
    }
    if (unopened.length > 0) {
      const randomCell = unopened[Math.floor(Math.random() * unopened.length)];
      handleCellClick(randomCell);
    }
  };

  const openedCount = activeGame?.opened?.length || 0;
  const currentMultiplier = activeGame?.currentMultiplier || 1.0;
  const nextMultiplier = activeGame?.nextMultiplier || calculateMinesMultiplier(minesCount, openedCount + 1);
  const potentialWin = Math.round(betAmount * currentMultiplier * 100) / 100;
  const safeRemaining = 25 - minesCount - openedCount;

  // Build multiplier roadmap array for current settings
  const roadmapSteps = [];
  const maxRoadmap = Math.min(10, 25 - minesCount);
  for (let i = 1; i <= maxRoadmap; i++) {
    roadmapSteps.push({
      step: i,
      mult: calculateMinesMultiplier(minesCount, i),
    });
  }

  return (
    <div className="max-w-xl mx-auto px-3.5 py-4 space-y-4">
      {/* Top Banner & Multiplier Roadmap */}
      <div className="bg-[#121826] border border-slate-800/90 rounded-2xl p-3 shadow-lg relative overflow-hidden">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Bomb size={16} />
            </div>
            <div>
              <h2 className="text-sm font-black text-white leading-none flex items-center gap-1.5">
                МИНЫ <span className="text-amber-400">SPINDBET</span>
              </h2>
              <span className="text-[10px] text-slate-400">5×5 Поле • Выбор от 1 до 24 мин</span>
            </div>
          </div>

          {/* Provably Fair Badge */}
          <button
            onClick={() => onOpenFairness(fairnessData)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-750 border border-slate-700/80 text-[11px] text-slate-300 hover:text-white transition-colors"
          >
            <ShieldCheck size={13} className="text-emerald-400" />
            <span className="font-semibold">Fairness</span>
          </button>
        </div>

        {/* Multipliers Roadmap Strip */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
          {roadmapSteps.map((step) => {
            const isCompleted = isPlaying && openedCount >= step.step;
            const isNext = isPlaying && openedCount + 1 === step.step;

            return (
              <div
                key={step.step}
                className={`flex-shrink-0 px-2 py-1 rounded-lg text-center transition-all ${
                  isCompleted
                    ? 'bg-emerald-500/20 border border-emerald-500/50 text-emerald-300 font-extrabold shadow-sm shadow-emerald-500/20'
                    : isNext
                    ? 'bg-amber-500/25 border border-amber-500/80 text-amber-300 font-black scale-105 shadow-md shadow-amber-500/30 animate-pulse'
                    : 'bg-slate-800/60 border border-slate-700/40 text-slate-400 text-[11px]'
                }`}
              >
                <div className="text-[9px] uppercase tracking-wider text-slate-400 leading-none">
                  {step.step} {step.step === 1 ? 'шаг' : 'шаг'}
                </div>
                <div className="text-xs font-bold mt-0.5 leading-none">x{step.mult.toFixed(2)}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* WIN BANNER ALERT */}
      {lastWinInfo && (
        <div className="bg-gradient-to-r from-emerald-950/80 via-emerald-900/60 to-slate-900 border border-emerald-500/40 rounded-2xl p-3.5 shadow-xl shadow-emerald-500/10 flex items-center justify-between animate-in fade-in zoom-in-95 duration-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500 text-slate-950 flex items-center justify-center font-black text-xl shadow-lg shadow-emerald-500/30">
              💎
            </div>
            <div>
              <div className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Победа! Выигрыш зачислен</div>
              <div className="text-lg font-black text-white leading-tight">
                +${lastWinInfo.amount.toFixed(2)}{' '}
                <span className="text-xs font-bold text-emerald-400">(x{lastWinInfo.multiplier.toFixed(2)})</span>
              </div>
            </div>
          </div>
          <button
            onClick={() => setLastWinInfo(null)}
            className="text-xs text-slate-400 hover:text-white px-2 py-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* ERROR MESSAGE ALERT */}
      {errorMsg && (
        <div className="bg-red-500/15 border border-red-500/40 rounded-xl p-2.5 text-xs font-semibold text-red-300 flex items-center gap-2 animate-in fade-in">
          <AlertTriangle size={16} className="text-red-400 flex-shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* 5x5 MINES BOARD */}
      <div className="bg-gradient-to-b from-[#131929] to-[#0d121f] border border-slate-800 rounded-3xl p-3 sm:p-4 shadow-2xl relative">
        {/* Active game header badge */}
        {isPlaying && (
          <div className="flex items-center justify-between mb-3 px-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-400">Множитель:</span>
              <span className="text-sm font-black text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-lg">
                x{currentMultiplier.toFixed(2)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-400">Текущий куш:</span>
              <span className="text-sm font-black text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-lg">
                ${potentialWin.toFixed(2)}
              </span>
            </div>
          </div>
        )}

        {/* 5x5 Grid */}
        <div className="grid grid-cols-5 gap-2 sm:gap-2.5 aspect-square">
          {Array.from({ length: 25 }, (_, idx) => {
            const isOpened = activeGame?.opened?.includes(idx);
            const isMine = revealedMines?.includes(idx);
            const isLastHit = lastHitCell === idx;

            // Tile styling
            let cellContent = null;
            let cellClass =
              'relative rounded-xl flex items-center justify-center font-black transition-all duration-200 select-none shadow-md overflow-hidden cursor-pointer ';

            if (isOpened) {
              // Opened Gem
              cellClass += 'bg-gradient-to-b from-sky-400 via-blue-600 to-indigo-700 text-white shadow-lg shadow-blue-500/30 border border-blue-300/40';
              cellContent = (
                <div className="flex flex-col items-center justify-center animate-gem">
                  <span className="text-2xl sm:text-3xl filter drop-shadow">💎</span>
                </div>
              );
            } else if (isLastHit) {
              // The exact mine player hit
              cellClass += 'bg-gradient-to-b from-red-500 via-red-600 to-rose-800 text-white shadow-xl shadow-red-500/50 border-2 border-red-300 animate-bomb';
              cellContent = (
                <div className="flex flex-col items-center justify-center">
                  <span className="text-2xl sm:text-3xl">💥</span>
                </div>
              );
            } else if (revealedMines && isMine) {
              // Revealed remaining mine after defeat
              cellClass += 'bg-slate-800/80 border border-red-500/30 text-red-400 opacity-75';
              cellContent = <span className="text-xl sm:text-2xl opacity-90">💣</span>;
            } else if (revealedMines && !isMine) {
              // Revealed remaining safe tile after defeat
              cellClass += 'bg-slate-800/60 border border-emerald-500/20 text-emerald-400 opacity-60';
              cellContent = <span className="text-lg opacity-60">💎</span>;
            } else {
              // Unopened tile ready to click
              if (isPlaying) {
                cellClass +=
                  'bg-gradient-to-b from-slate-700/80 via-slate-800/90 to-slate-900 border border-slate-600/50 hover:border-amber-400/80 hover:from-slate-700 hover:to-slate-800 active:scale-95 hover:shadow-lg hover:shadow-amber-500/20';
                cellContent = (
                  <div className="w-2.5 h-2.5 rounded-full bg-slate-600/50 group-hover:bg-amber-400/50 transition-colors"></div>
                );
              } else {
                cellClass +=
                  'bg-gradient-to-b from-slate-800/60 via-slate-850 to-slate-900/90 border border-slate-700/40 opacity-90';
                cellContent = <div className="w-2 h-2 rounded-full bg-slate-700/50"></div>;
              }
            }

            return (
              <button
                key={idx}
                disabled={!isPlaying || loading || isOpened}
                onClick={() => handleCellClick(idx)}
                className={cellClass}
              >
                {cellContent}
              </button>
            );
          })}
        </div>
      </div>

      {/* GAME CONTROLS & BETTINGS */}
      <div className="bg-[#121826] border border-slate-800 rounded-3xl p-4 shadow-xl space-y-3.5">
        {/* If Game is Active: Action buttons (Cashout or Random Pick) */}
        {isPlaying ? (
          <div className="space-y-2">
            <button
              disabled={loading || openedCount === 0}
              onClick={handleCashout}
              className={`w-full py-4 px-4 rounded-2xl font-black text-base uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-xl ${
                openedCount > 0
                  ? 'bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-500 text-slate-950 shadow-amber-500/30 hover:brightness-110 active:scale-[0.99] pulse-glow-amber cursor-pointer'
                  : 'bg-slate-800 text-slate-500 border border-slate-700/60 cursor-not-allowed'
              }`}
            >
              {openedCount > 0 ? (
                <>
                  <span>Забрать ${(betAmount * currentMultiplier).toFixed(2)}</span>
                  <span className="text-xs bg-slate-950/20 px-2 py-0.5 rounded-md font-extrabold">
                    x{currentMultiplier.toFixed(2)}
                  </span>
                </>
              ) : (
                <span>Откройте ячейку</span>
              )}
            </button>

            <div className="flex gap-2">
              <button
                disabled={loading}
                onClick={handleRandomPick}
                className="flex-1 py-2.5 px-3 rounded-xl bg-slate-800/80 hover:bg-slate-750 border border-slate-700 text-xs font-bold text-slate-200 hover:text-white flex items-center justify-center gap-1.5 transition-colors"
              >
                <Dices size={15} className="text-amber-400" />
                <span>Случайный выбор</span>
              </button>
              <div className="flex items-center justify-center px-3 py-2 rounded-xl bg-slate-800/40 border border-slate-700/50 text-xs text-slate-400">
                Осталось: <span className="text-emerald-400 font-bold ml-1">{safeRemaining}</span>
              </div>
            </div>
          </div>
        ) : (
          /* If Game is Inactive: Bet input, quick chips & Start Button */
          <div className="space-y-3">
            {/* Mines Count Selector */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1.5 px-0.5">
                <span className="font-bold text-slate-300 flex items-center gap-1">
                  <Bomb size={13} className="text-red-400" /> Количество мин:
                </span>
                <span className="text-amber-400 font-black bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-500/20 text-xs">
                  {minesCount} мин
                </span>
              </div>
              <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
                {MINES_OPTIONS.map((count) => (
                  <button
                    key={count}
                    onClick={() => {
                      triggerHaptic('selection');
                      playClickSound();
                      setMinesCount(count);
                    }}
                    className={`py-1.5 text-xs font-black rounded-xl transition-all ${
                      minesCount === count
                        ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20 scale-[1.03]'
                        : 'bg-slate-800/90 hover:bg-slate-750 text-slate-300 border border-slate-700/60'
                    }`}
                  >
                    {count}
                  </button>
                ))}
              </div>
            </div>

            {/* Bet Amount Input */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1.5 px-0.5">
                <span className="font-bold text-slate-300">Сумма ставки ($):</span>
                <span className="text-slate-400 text-[11px]">
                  Баланс: <b className="text-white">${balance.toFixed(2)}</b>
                </span>
              </div>
              <div className="relative flex items-center">
                <span className="absolute left-3.5 text-amber-400 font-black text-sm">$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max="500"
                  value={betAmount || ''}
                  onChange={(e) => setBetAmount(Math.max(0, parseFloat(e.target.value) || 0))}
                  className="w-full bg-slate-900 border border-slate-700/80 rounded-xl py-2.5 pl-8 pr-28 text-white font-extrabold text-sm focus:outline-none focus:border-amber-500 transition-colors shadow-inner"
                />
                <div className="absolute right-1.5 flex gap-1">
                  <button
                    onClick={() => {
                      triggerHaptic('light');
                      setBetAmount((prev) => Math.max(0.01, Math.round((prev / 2) * 100) / 100));
                    }}
                    className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-750 text-[10px] font-bold text-slate-300 hover:text-white border border-slate-700"
                  >
                    ½
                  </button>
                  <button
                    onClick={() => {
                      triggerHaptic('light');
                      setBetAmount((prev) => Math.min(500, Math.round(prev * 2 * 100) / 100));
                    }}
                    className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-750 text-[10px] font-bold text-slate-300 hover:text-white border border-slate-700"
                  >
                    2X
                  </button>
                  <button
                    onClick={() => {
                      triggerHaptic('light');
                      setBetAmount(Math.min(500, Math.max(0.01, balance)));
                    }}
                    className="px-2 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-[10px] font-black text-amber-300 border border-amber-500/40"
                  >
                    MAX
                  </button>
                </div>
              </div>

              {/* Quick Chip Row */}
              <div className="flex gap-1.5 mt-2 overflow-x-auto no-scrollbar py-0.5">
                {QUICK_BETS.map((chip) => (
                  <button
                    key={chip}
                    onClick={() => {
                      triggerHaptic('selection');
                      playClickSound();
                      setBetAmount(chip);
                    }}
                    className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition-colors ${
                      betAmount === chip
                        ? 'bg-amber-500/30 text-amber-300 border border-amber-500/60'
                        : 'bg-slate-800/60 hover:bg-slate-800 text-slate-400 border border-slate-700/50'
                    }`}
                  >
                    ${chip >= 1 ? chip : chip.toFixed(2)}
                  </button>
                ))}
              </div>
            </div>

            {/* Play Button */}
            <button
              disabled={loading || betAmount <= 0}
              onClick={handleStartGame}
              className="w-full py-4 px-4 rounded-2xl bg-gradient-to-r from-amber-500 via-amber-400 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-slate-950 font-black text-base uppercase tracking-wider shadow-xl shadow-amber-500/20 hover:brightness-105 active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <Sparkles size={18} />
              <span>Играть ${betAmount.toFixed(2)}</span>
            </button>
          </div>
        )}
      </div>

      {/* FOOTER INFO: Bot Rules & Provably Fair Note */}
      <div className="bg-slate-900/60 border border-slate-800/60 rounded-2xl p-3 text-[11px] text-slate-400 space-y-1">
        <div className="flex items-center justify-between text-slate-300 font-bold mb-1">
          <span className="flex items-center gap-1.5">
            <Info size={13} className="text-amber-400" />
            <span>Особенности Mines SpindBet</span>
          </span>
          <span className="text-[10px] text-emerald-400 font-semibold">96% RTP • SHA-256</span>
        </div>
        <p>
          Баланс и выигрыши в Mini App на 100% синхронизированы с ботом <b className="text-slate-200">@SPIND_BET_BOT</b>.
          Любой заработок можно мгновенно вывести через Telegram чеки CryptoBot или СБП.
        </p>
      </div>
    </div>
  );
};
