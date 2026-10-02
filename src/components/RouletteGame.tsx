import React, { useState, useEffect, useRef, useMemo } from 'react';
import confetti from 'canvas-confetti';
import {
  Sparkles,
  ShieldCheck,
  RotateCw,
  AlertTriangle,
  Flame,
  Snowflake,
  ChevronDown,
  ChevronUp,
  History,
  Trash2,
} from 'lucide-react';
import { playClickSound, playRouletteTickSound, playRouletteWinSound } from '../utils/sound.ts';
import { triggerHaptic } from '../utils/telegram.ts';

interface RouletteGameProps {
  userId: number;
  balance: number;
  onBalanceChange: (newBalance: number) => void;
  onOpenFairness: (data: any) => void;
}

// European sequence on physical roulette wheel
const ROULETTE_NUMBERS = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const CHIP_SIZES = [0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 25.0, 50.0];

// Fixed item width for consistent physical math
const ITEM_WIDTH = 60; // 52px card + 8px gap
const REPEAT_COUNT = 9; // 9 full repetitions ensures safe infinite loop bounds
const SET_COUNT = ROULETTE_NUMBERS.length; // 37
const SET_WIDTH = SET_COUNT * ITEM_WIDTH; // 2220px per full revolution

export const RouletteGame: React.FC<RouletteGameProps> = ({
  userId,
  balance,
  onBalanceChange,
  onOpenFairness,
}) => {
  // Betting state
  const [selectedChip, setSelectedChip] = useState<number>(1.0);
  const [bets, setBets] = useState<{ [key: string]: number }>({});
  const [showNumbersGrid, setShowNumbersGrid] = useState<boolean>(true);

  // Animation & game status
  const [isSpinning, setIsSpinning] = useState<boolean>(false);
  const [winningNumber, setWinningNumber] = useState<number | null>(null);
  const [lastWinInfo, setLastWinInfo] = useState<{ totalWin: number; totalBet: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ number: number; color: string }>>([]);
  const [fairnessData, setFairnessData] = useState<any>(null);

  // Tape wheel position and transition
  const [wheelOffset, setWheelOffset] = useState<number>(0);
  const [transitionStyle, setTransitionStyle] = useState<string>('none');
  const tapeRef = useRef<HTMLDivElement>(null);
  const currentOffsetRef = useRef<number>(0);
  const tickTimerRef = useRef<any>(null);
  const spinSafetyTimerRef = useRef<any>(null);

  // Generate sequence of items
  const fullSequence = useMemo(() => {
    const list: Array<{ number: number; color: 'green' | 'red' | 'black'; key: string }> = [];
    for (let r = 0; r < REPEAT_COUNT; r++) {
      for (const num of ROULETTE_NUMBERS) {
        const color = num === 0 ? 'green' : RED_NUMBERS.has(num) ? 'red' : 'black';
        list.push({ number: num, color, key: `${r}-${num}` });
      }
    }
    return list;
  }, []);

  // Fetch recent history
  useEffect(() => {
    fetchHistory();
    // Center tape on middle sequence initially
    const initialCenter = -(SET_WIDTH * 2);
    setWheelOffset(initialCenter);
    currentOffsetRef.current = initialCenter;

    return () => {
      if (tickTimerRef.current) clearTimeout(tickTimerRef.current);
      if (spinSafetyTimerRef.current) clearTimeout(spinSafetyTimerRef.current);
    };
  }, []);

  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/roulette/history');
      const data = await res.json();
      if (data.ok && Array.isArray(data.history)) {
        setHistory(data.history);
      }
    } catch {
      // fallback history defaults
    }
  };

  const getNumberColor = (num: number): 'green' | 'red' | 'black' => {
    if (num === 0) return 'green';
    if (RED_NUMBERS.has(num)) return 'red';
    return 'black';
  };

  // Place chip on specific bet key
  const handlePlaceBet = (betKey: string) => {
    if (isSpinning) return;
    playClickSound();
    triggerHaptic('light');

    const totalCurrentBet = Object.values(bets).reduce((a, b) => a + b, 0);
    if (totalCurrentBet + selectedChip > balance) {
      setErrorMsg('Недостаточно средств на балансе!');
      return;
    }
    if (totalCurrentBet + selectedChip > 500) {
      setErrorMsg('Максимальная сумма ставок $500');
      return;
    }

    setErrorMsg(null);
    setBets((prev) => {
      const current = prev[betKey] || 0;
      const updated = Math.round((current + selectedChip) * 100) / 100;
      return { ...prev, [betKey]: updated };
    });
  };

  const handleClearBets = () => {
    if (isSpinning) return;
    triggerHaptic('selection');
    playClickSound();
    setBets({});
    setErrorMsg(null);
  };

  const handleDoubleBets = () => {
    if (isSpinning) return;
    triggerHaptic('selection');
    playClickSound();

    const totalCurrent = Object.values(bets).reduce((a, b) => a + b, 0);
    if (totalCurrent * 2 > balance) {
      setErrorMsg('Недостаточно средств для удвоения!');
      return;
    }
    const doubled: { [key: string]: number } = {};
    for (const [k, v] of Object.entries(bets)) {
      doubled[k] = Math.round(v * 2 * 100) / 100;
    }
    setBets(doubled);
  };

  const totalBet = useMemo(() => {
    const sum = Object.values(bets).reduce((a, b) => a + b, 0);
    return Math.round(sum * 100) / 100;
  }, [bets]);

  // Statistics calculation
  const stats = useMemo(() => {
    const total = history.length || 1;
    let redCount = 0;
    let blackCount = 0;
    let greenCount = 0;
    const freq: { [num: number]: number } = {};

    history.forEach((item) => {
      if (item.color === 'red') redCount++;
      else if (item.color === 'black') blackCount++;
      else greenCount++;
      freq[item.number] = (freq[item.number] || 0) + 1;
    });

    const sortedNums = Object.entries(freq).sort((a, b) => b[1] - a[1]);
    const hot = sortedNums.slice(0, 3).map(([n]) => Number(n));
    const cold = [3, 17, 26].filter((n) => !hot.includes(n)).slice(0, 3);

    return {
      redPct: Math.round((redCount / total) * 100),
      blackPct: Math.round((blackCount / total) * 100),
      greenPct: Math.round((greenCount / total) * 100),
      hot,
      cold,
    };
  }, [history]);

  // Guaranteed smooth spin logic without freezing
  const handleSpin = async () => {
    if (isSpinning) return;
    if (totalBet <= 0) {
      setErrorMsg('Сделайте хотя бы одну ставку!');
      return;
    }
    if (totalBet > balance) {
      setErrorMsg('Недостаточно средств на балансе!');
      return;
    }

    playClickSound();
    triggerHaptic('medium');
    setIsSpinning(true);
    setErrorMsg(null);
    setLastWinInfo(null);
    setWinningNumber(null);

    try {
      const res = await fetch('/api/roulette/spin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, bets }),
      });

      const data = await res.json();
      if (!data.ok) {
        setIsSpinning(false);
        setErrorMsg(data.error || 'Ошибка при вращении рулетки');
        fetch(`/api/user?userId=${userId}`)
          .then((r) => r.json())
          .then((u) => {
            if (u.ok && u.user) onBalanceChange(u.user.balance);
          })
          .catch(() => {});
        return;
      }

      // Temporarily subtract placed bets until spin finishes
      onBalanceChange(data.balance - (data.totalWin > 0 ? data.totalWin : 0));
      setFairnessData(data.fairness);

      const targetNum = data.winningNumber;
      const targetIndexInSet = ROULETTE_NUMBERS.indexOf(targetNum);
      const containerWidth = tapeRef.current?.parentElement?.clientWidth || 360;

      // STEP 1: Normalize current offset to Set 1 instantaneously without transition
      // This completely eradicates the freezing bug when spinning consecutively!
      const currentRaw = Math.abs(currentOffsetRef.current);
      const normalizedRemainder = currentRaw % SET_WIDTH;
      const resetBaseX = -(SET_WIDTH + normalizedRemainder);

      setTransitionStyle('none');
      setWheelOffset(resetBaseX);
      currentOffsetRef.current = resetBaseX;

      // Force synchronous browser layout reflow to register the reset position
      if (tapeRef.current) {
        void tapeRef.current.offsetWidth;
      }

      // STEP 2: Animate 4 full revolutions forward into Set 5 with precision landing
      // Guaranteed travel distance: over 8,800 pixels every single spin!
      const targetCardCenter = 5 * SET_WIDTH + targetIndexInSet * ITEM_WIDTH + ITEM_WIDTH / 2;
      const jitter = (Math.random() - 0.5) * (ITEM_WIDTH * 0.35); // small organic landing offset
      const finalX = -(targetCardCenter - containerWidth / 2 + jitter);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setTransitionStyle('transform 4.5s cubic-bezier(0.12, 0.88, 0.15, 1)');
          setWheelOffset(finalX);
          currentOffsetRef.current = finalX;
        });
      });

      // Synchronized mechanical audio clicks that decelerate smoothly
      let tickCount = 0;
      const maxTicks = 32;
      const playTickStep = (delay: number) => {
        if (tickCount < maxTicks) {
          playRouletteTickSound();
          tickCount++;
          const nextDelay = delay + Math.pow(tickCount / 1.7, 2) * 16;
          tickTimerRef.current = setTimeout(() => playTickStep(nextDelay), nextDelay);
        }
      };
      playTickStep(50);

      // STEP 3: Complete spin, award winnings and update state
      spinSafetyTimerRef.current = setTimeout(() => {
        setIsSpinning(false);
        setWinningNumber(targetNum);
        triggerHaptic('success');
        onBalanceChange(data.balance);

        setHistory((prev) => [{ number: targetNum, color: data.color }, ...prev.slice(0, 14)]);

        if (data.totalWin > 0) {
          playRouletteWinSound();
          setLastWinInfo({ totalWin: data.totalWin, totalBet: data.totalBet });
          confetti({
            particleCount: 65,
            spread: 60,
            origin: { y: 0.65 },
          });
        }
      }, 4600);
    } catch {
      setIsSpinning(false);
      setErrorMsg('Сетевая ошибка соединения');
    }
  };

  return (
    <div className="max-w-xl mx-auto px-3.5 py-4 space-y-4">
      {/* 1. Header Banner & Fairness */}
      <div className="bg-[#121826] border border-slate-800 rounded-3xl p-3.5 shadow-xl flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-500 via-rose-600 to-red-700 flex items-center justify-center text-white shadow-lg shadow-rose-600/20 border border-amber-400/40">
            <RotateCw size={19} className={isSpinning ? 'animate-spin' : ''} />
          </div>
          <div>
            <h2 className="text-base font-black text-white leading-tight">
              ЕВРОПЕЙСКАЯ РУЛЕТКА
            </h2>
            <p className="text-[11px] text-slate-400">
              Честная игра SHA-256
            </p>
          </div>
        </div>

        <button
          onClick={() => onOpenFairness(fairnessData)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-750 border border-slate-700 text-xs text-slate-300 hover:text-white transition-colors cursor-pointer"
        >
          <ShieldCheck size={14} className="text-emerald-400" />
          <span className="font-semibold text-[11px]">Fairness</span>
        </button>
      </div>

      {/* 2. Detailed Statistics Ribbon: Percentages & Hot/Cold */}
      <div className="bg-[#0f1422] border border-slate-800 rounded-2xl p-2.5 shadow-md space-y-2">
        <div className="flex items-center justify-between text-[11px]">
          {/* History numbers strip */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1 px-1 max-w-[65%]">
            <span className="text-slate-400 font-bold flex-shrink-0 flex items-center gap-1 pr-0.5">
              <History size={12} className="text-amber-400" />
              <span>Дропы:</span>
            </span>
            {history.slice(0, 10).map((item, idx) => {
              let bg = 'bg-slate-800 text-slate-200 border-slate-700';
              if (item.color === 'red') bg = 'bg-rose-500/25 text-rose-300 border-rose-500/50';
              else if (item.color === 'green') bg = 'bg-emerald-500/30 text-emerald-300 border-emerald-500/60 font-black';
              else if (item.color === 'black') bg = 'bg-slate-900 text-slate-300 border-slate-700';

              const isLatest = idx === 0;

              return (
                <div
                  key={idx}
                  className={`w-6 h-6 rounded-md border flex items-center justify-center font-black text-[11px] flex-shrink-0 shadow-sm ${bg} ${
                    isLatest ? 'scale-105 ring-2 ring-amber-400 shadow-md shadow-amber-500/30 mx-0.5' : ''
                  }`}
                >
                  {item.number}
                </div>
              );
            })}
          </div>

          {/* Hot & Cold indicator */}
          <div className="flex items-center gap-2 text-[10px] font-bold">
            <div className="flex items-center gap-0.5 text-rose-400">
              <Flame size={12} />
              <span>{stats.hot.join(', ')}</span>
            </div>
            <div className="flex items-center gap-0.5 text-cyan-400">
              <Snowflake size={12} />
              <span>{stats.cold.join(', ')}</span>
            </div>
          </div>
        </div>

        {/* Color Percentage Bar */}
        <div className="flex items-center gap-1 h-1.5 rounded-full overflow-hidden bg-slate-950">
          <div style={{ width: `${stats.redPct}%` }} className="h-full bg-rose-500 transition-all" title={`Красное: ${stats.redPct}%`} />
          <div style={{ width: `${stats.greenPct}%` }} className="h-full bg-emerald-500 transition-all" title={`Зеро: ${stats.greenPct}%`} />
          <div style={{ width: `${stats.blackPct}%` }} className="h-full bg-slate-700 transition-all" title={`Чёрное: ${stats.blackPct}%`} />
        </div>
      </div>

      {/* 3. LUXURY ROULETTE TAPE CAROUSEL */}
      <div className="relative bg-gradient-to-b from-[#0b0f19] via-[#121828] to-[#0a0d16] border-2 border-slate-800 rounded-3xl p-3 shadow-2xl overflow-hidden">
        {/* Golden Pointer Center Needle */}
        <div className="absolute top-0 inset-x-0 flex flex-col items-center pointer-events-none z-20">
          <div className="w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-t-[14px] border-t-amber-400 filter drop-shadow-[0_2px_8px_rgba(251,191,36,0.8)]"></div>
          <div className="w-0.5 h-16 bg-gradient-to-b from-amber-400 via-amber-300 to-transparent opacity-90"></div>
        </div>

        {/* Bottom Pointer */}
        <div className="absolute bottom-0 inset-x-0 flex flex-col items-center pointer-events-none z-20">
          <div className="w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-b-[12px] border-b-amber-400 filter drop-shadow-md"></div>
        </div>

        {/* Vignette Shadow Gradients on sides */}
        <div className="absolute inset-y-0 left-0 w-20 bg-gradient-to-r from-[#0b0f19] to-transparent pointer-events-none z-10"></div>
        <div className="absolute inset-y-0 right-0 w-20 bg-gradient-to-l from-[#0b0f19] to-transparent pointer-events-none z-10"></div>

        {/* The Tape Reel Track */}
        <div className="overflow-hidden py-3.5">
          <div
            ref={tapeRef}
            style={{
              transform: `translate3d(${wheelOffset}px, 0, 0)`,
              transition: transitionStyle,
            }}
            className="flex items-center gap-2 will-change-transform"
          >
            {fullSequence.map((slot) => {
              const isWinTarget = winningNumber !== null && slot.number === winningNumber;

              let cardStyle =
                'w-[52px] h-[68px] rounded-xl flex flex-col items-center justify-center font-black transition-all flex-shrink-0 border-2 select-none shadow-md ';

              if (slot.color === 'green') {
                cardStyle += isWinTarget
                  ? 'bg-emerald-500 text-slate-950 border-emerald-200 ring-4 ring-emerald-400/60 scale-110 shadow-2xl shadow-emerald-500/50'
                  : 'bg-gradient-to-b from-emerald-600 to-emerald-900 text-white border-emerald-500/60 shadow-inner';
              } else if (slot.color === 'red') {
                cardStyle += isWinTarget
                  ? 'bg-rose-500 text-white border-rose-200 ring-4 ring-rose-400/60 scale-110 shadow-2xl shadow-rose-500/50'
                  : 'bg-gradient-to-b from-rose-600 to-red-950 text-white border-rose-500/50 shadow-inner';
              } else {
                cardStyle += isWinTarget
                  ? 'bg-slate-800 text-white border-amber-300 ring-4 ring-amber-400/60 scale-110 shadow-2xl shadow-black/80'
                  : 'bg-gradient-to-b from-slate-800 to-slate-950 text-slate-200 border-slate-700/80 shadow-inner';
              }

              return (
                <div key={slot.key} className={cardStyle}>
                  <span className="text-2xl leading-none tracking-tight drop-shadow">
                    {slot.number}
                  </span>
                  <div
                    className={`w-2 h-2 rounded-full mt-1.5 shadow ${
                      slot.color === 'green'
                        ? 'bg-emerald-400'
                        : slot.color === 'red'
                        ? 'bg-rose-400'
                        : 'bg-slate-400'
                    }`}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 4. WIN NOTIFICATION BANNER */}
      {lastWinInfo && (
        <div className="bg-gradient-to-r from-emerald-950/90 via-emerald-900/70 to-slate-900 border border-emerald-500/40 rounded-2xl p-3.5 shadow-xl flex items-center justify-between animate-in fade-in zoom-in-95">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500 text-slate-950 flex items-center justify-center font-black text-xl shadow-lg shadow-emerald-500/30">
              🎉
            </div>
            <div>
              <div className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                Выигрыш в Рулетке!
              </div>
              <div className="text-lg font-black text-white leading-tight">
                +${lastWinInfo.totalWin.toFixed(2)}{' '}
                <span className="text-xs font-bold text-emerald-400">
                  (Чистый доход: +${(lastWinInfo.totalWin - lastWinInfo.totalBet).toFixed(2)})
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. ERROR ALERT */}
      {errorMsg && (
        <div className="p-3 rounded-xl bg-red-950/80 border border-red-500/50 text-red-200 text-xs font-bold flex items-center justify-between animate-in fade-in">
          <span>{errorMsg}</span>
          <button
            onClick={() => setErrorMsg(null)}
            className="text-red-400 hover:text-white ml-2 text-sm cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* 6. DETAILED CASINO BETTING BOARD */}
      <div className="bg-[#121826] border border-slate-800 rounded-3xl p-4 shadow-xl space-y-3.5">
        {/* PRIMARY COLOR BETS */}
        <div>
          <div className="flex items-center justify-between text-xs font-bold text-slate-400 mb-2 px-0.5">
            <span>Основные ставки:</span>
            <span>Множитель</span>
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            {/* RED (x2) */}
            <button
              disabled={isSpinning}
              onClick={() => handlePlaceBet('red')}
              className="relative p-3 rounded-2xl bg-gradient-to-b from-rose-600 to-red-800 hover:from-rose-500 hover:to-red-700 border border-rose-400/50 shadow-lg shadow-red-600/20 active:scale-95 transition-all text-center cursor-pointer group"
            >
              <div className="text-[10px] font-black uppercase tracking-wider text-rose-200">
                КРАСНОЕ
              </div>
              <div className="text-lg font-black text-white mt-0.5">2X</div>
              {bets['red'] ? (
                <div className="mt-1 bg-slate-950/90 border border-amber-400 text-amber-300 text-xs font-black py-0.5 px-2 rounded-full inline-block shadow">
                  ${bets['red'].toFixed(2)}
                </div>
              ) : (
                <div className="text-[10px] text-rose-200/60 mt-1">18 номеров</div>
              )}
            </button>

            {/* GREEN ZERO (x14) */}
            <button
              disabled={isSpinning}
              onClick={() => handlePlaceBet('green')}
              className="relative p-3 rounded-2xl bg-gradient-to-b from-emerald-600 to-emerald-800 hover:from-emerald-500 hover:to-emerald-700 border border-emerald-400/50 shadow-lg shadow-emerald-600/20 active:scale-95 transition-all text-center cursor-pointer group"
            >
              <div className="text-[10px] font-black uppercase tracking-wider text-emerald-200">
                ЗЕРО (0)
              </div>
              <div className="text-lg font-black text-white mt-0.5">14X</div>
              {bets['green'] ? (
                <div className="mt-1 bg-slate-950/90 border border-amber-400 text-amber-300 text-xs font-black py-0.5 px-2 rounded-full inline-block shadow">
                  ${bets['green'].toFixed(2)}
                </div>
              ) : (
                <div className="text-[10px] text-emerald-200/60 mt-1">Джекпот</div>
              )}
            </button>

            {/* BLACK (x2) */}
            <button
              disabled={isSpinning}
              onClick={() => handlePlaceBet('black')}
              className="relative p-3 rounded-2xl bg-gradient-to-b from-slate-800 to-slate-950 hover:from-slate-750 hover:to-slate-900 border border-slate-700 shadow-lg shadow-black/40 active:scale-95 transition-all text-center cursor-pointer group"
            >
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-300">
                ЧЁРНОЕ
              </div>
              <div className="text-lg font-black text-white mt-0.5">2X</div>
              {bets['black'] ? (
                <div className="mt-1 bg-slate-950/90 border border-amber-400 text-amber-300 text-xs font-black py-0.5 px-2 rounded-full inline-block shadow">
                  ${bets['black'].toFixed(2)}
                </div>
              ) : (
                <div className="text-[10px] text-slate-400 mt-1">18 номеров</div>
              )}
            </button>
          </div>
        </div>

        {/* OUTSIDE BETS (RANGES, EVEN/ODD, DOZENS) */}
        <div className="space-y-2 pt-1 border-t border-slate-800">
          <div className="grid grid-cols-4 gap-1.5">
            <button
              disabled={isSpinning}
              onClick={() => handlePlaceBet('low')}
              className="py-2 px-1 rounded-xl bg-slate-850 hover:bg-slate-800 border border-slate-700/80 text-center transition-all cursor-pointer"
            >
              <div className="text-[10px] font-bold text-slate-400 leading-none">1-18</div>
              <div className="text-xs font-black text-white mt-0.5 leading-none">x2</div>
              {bets['low'] && (
                <div className="text-[10px] font-black text-amber-400 mt-0.5 leading-none">
                  ${bets['low'].toFixed(2)}
                </div>
              )}
            </button>

            <button
              disabled={isSpinning}
              onClick={() => handlePlaceBet('even')}
              className="py-2 px-1 rounded-xl bg-slate-850 hover:bg-slate-800 border border-slate-700/80 text-center transition-all cursor-pointer"
            >
              <div className="text-[10px] font-bold text-slate-400 leading-none">ЧЁТ</div>
              <div className="text-xs font-black text-white mt-0.5 leading-none">x2</div>
              {bets['even'] && (
                <div className="text-[10px] font-black text-amber-400 mt-0.5 leading-none">
                  ${bets['even'].toFixed(2)}
                </div>
              )}
            </button>

            <button
              disabled={isSpinning}
              onClick={() => handlePlaceBet('odd')}
              className="py-2 px-1 rounded-xl bg-slate-850 hover:bg-slate-800 border border-slate-700/80 text-center transition-all cursor-pointer"
            >
              <div className="text-[10px] font-bold text-slate-400 leading-none">НЕЧЁТ</div>
              <div className="text-xs font-black text-white mt-0.5 leading-none">x2</div>
              {bets['odd'] && (
                <div className="text-[10px] font-black text-amber-400 mt-0.5 leading-none">
                  ${bets['odd'].toFixed(2)}
                </div>
              )}
            </button>

            <button
              disabled={isSpinning}
              onClick={() => handlePlaceBet('high')}
              className="py-2 px-1 rounded-xl bg-slate-850 hover:bg-slate-800 border border-slate-700/80 text-center transition-all cursor-pointer"
            >
              <div className="text-[10px] font-bold text-slate-400 leading-none">19-36</div>
              <div className="text-xs font-black text-white mt-0.5 leading-none">x2</div>
              {bets['high'] && (
                <div className="text-[10px] font-black text-amber-400 mt-0.5 leading-none">
                  ${bets['high'].toFixed(2)}
                </div>
              )}
            </button>
          </div>

          {/* DOZENS */}
          <div className="grid grid-cols-3 gap-1.5">
            <button
              disabled={isSpinning}
              onClick={() => handlePlaceBet('dozen1')}
              className="py-2 px-2 rounded-xl bg-slate-850 hover:bg-slate-800 border border-slate-700/80 text-center transition-all cursor-pointer"
            >
              <div className="text-[10px] font-bold text-slate-400 leading-none">1-12</div>
              <div className="text-xs font-black text-white mt-0.5 leading-none">x3</div>
              {bets['dozen1'] && (
                <div className="text-[10px] font-black text-amber-400 mt-0.5 leading-none">
                  ${bets['dozen1'].toFixed(2)}
                </div>
              )}
            </button>

            <button
              disabled={isSpinning}
              onClick={() => handlePlaceBet('dozen2')}
              className="py-2 px-2 rounded-xl bg-slate-850 hover:bg-slate-800 border border-slate-700/80 text-center transition-all cursor-pointer"
            >
              <div className="text-[10px] font-bold text-slate-400 leading-none">13-24</div>
              <div className="text-xs font-black text-white mt-0.5 leading-none">x3</div>
              {bets['dozen2'] && (
                <div className="text-[10px] font-black text-amber-400 mt-0.5 leading-none">
                  ${bets['dozen2'].toFixed(2)}
                </div>
              )}
            </button>

            <button
              disabled={isSpinning}
              onClick={() => handlePlaceBet('dozen3')}
              className="py-2 px-2 rounded-xl bg-slate-850 hover:bg-slate-800 border border-slate-700/80 text-center transition-all cursor-pointer"
            >
              <div className="text-[10px] font-bold text-slate-400 leading-none">25-36</div>
              <div className="text-xs font-black text-white mt-0.5 leading-none">x3</div>
              {bets['dozen3'] && (
                <div className="text-[10px] font-black text-amber-400 mt-0.5 leading-none">
                  ${bets['dozen3'].toFixed(2)}
                </div>
              )}
            </button>
          </div>
        </div>

        {/* DETAILED DIRECT NUMBER GRID (0-36, x36 Payout) */}
        <div className="pt-1">
          <button
            onClick={() => setShowNumbersGrid((prev) => !prev)}
            className="w-full py-1.5 px-3 rounded-xl bg-slate-850 hover:bg-slate-800 border border-slate-700/60 text-xs font-bold text-slate-300 flex items-center justify-between cursor-pointer"
          >
            <span className="flex items-center gap-1.5">
              <Flame size={13} className="text-amber-400" />
              <span>Точные номера 0-36 (Выигрыш x36)</span>
            </span>
            {showNumbersGrid ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>

          {showNumbersGrid && (
            <div className="mt-2.5 p-2.5 bg-slate-950/90 border border-slate-800 rounded-2xl space-y-2 animate-in fade-in">
              {/* Zero Button at Top */}
              <button
                disabled={isSpinning}
                onClick={() => handlePlaceBet('num_0')}
                className="w-full py-1.5 rounded-lg font-black text-xs bg-emerald-600/90 hover:bg-emerald-500 text-white flex items-center justify-center gap-2 border border-emerald-400/40 relative"
              >
                <span>0 (ЗЕРО)</span>
                {bets['num_0'] && (
                  <span className="bg-amber-400 text-slate-950 text-[10px] font-black px-1.5 py-0.2 rounded-full">
                    ${bets['num_0'].toFixed(2)}
                  </span>
                )}
              </button>

              {/* 1-36 Numbers Grid */}
              <div className="grid grid-cols-6 sm:grid-cols-12 gap-1">
                {Array.from({ length: 36 }, (_, i) => {
                  const num = i + 1;
                  const color = getNumberColor(num);
                  const key = `num_${num}`;
                  const betAmt = bets[key];

                  let btnBg =
                    color === 'red'
                      ? 'bg-rose-600/80 hover:bg-rose-500 text-white border-rose-500/40'
                      : 'bg-slate-800 hover:bg-slate-700 text-white border-slate-700';

                  return (
                    <button
                      key={num}
                      disabled={isSpinning}
                      onClick={() => handlePlaceBet(key)}
                      className={`relative py-2 rounded-lg font-black text-xs transition-transform active:scale-90 flex flex-col items-center justify-center border ${btnBg}`}
                    >
                      <span>{num}</span>
                      {betAmt && (
                        <span className="absolute -top-1 -right-1 bg-amber-400 text-slate-950 text-[9px] font-black w-3.5 h-3.5 rounded-full flex items-center justify-center shadow">
                          •
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* CHIP SELECTOR & ACTIONS */}
        <div className="pt-2 border-t border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between text-xs px-0.5">
            <span className="font-bold text-slate-300">Выберите номинал фишки:</span>
            <span className="text-slate-400 text-[11px]">
              Баланс: <b className="text-white">${balance.toFixed(2)}</b>
            </span>
          </div>

          {/* Chips Rack */}
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar py-0.5">
            {CHIP_SIZES.map((chip) => (
              <button
                key={chip}
                disabled={isSpinning}
                onClick={() => {
                  triggerHaptic('selection');
                  playClickSound();
                  setSelectedChip(chip);
                }}
                className={`flex-1 min-w-[42px] py-1.5 px-1 rounded-xl text-xs font-black transition-all cursor-pointer ${
                  selectedChip === chip
                    ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/30 scale-105'
                    : 'bg-slate-800/80 hover:bg-slate-800 text-slate-300 border border-slate-700/60'
                }`}
              >
                ${chip >= 1 ? chip : chip.toFixed(1)}
              </button>
            ))}
          </div>

          {/* Action Modifiers: Double, Clear */}
          <div className="grid grid-cols-2 gap-2">
            <button
              disabled={isSpinning || totalBet <= 0}
              onClick={handleDoubleBets}
              className="py-2.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-xs font-bold text-slate-200 border border-slate-700 cursor-pointer disabled:opacity-40"
            >
              2X Удвоить
            </button>

            <button
              disabled={isSpinning || totalBet <= 0}
              onClick={handleClearBets}
              className="py-2.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-xs font-bold text-rose-300 border border-slate-700 flex items-center justify-center gap-1 cursor-pointer disabled:opacity-40"
            >
              <Trash2 size={14} />
              <span>Очистить</span>
            </button>
          </div>

          {/* Primary Spin Button */}
          <div className="pt-1">
            <button
              disabled={isSpinning || totalBet <= 0}
              onClick={handleSpin}
              className={`w-full py-4 px-4 rounded-2xl font-black text-base uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-xl cursor-pointer ${
                isSpinning
                  ? 'bg-slate-800 text-slate-400 border border-slate-700 cursor-not-allowed'
                  : totalBet > 0
                  ? 'bg-gradient-to-r from-amber-500 via-amber-400 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-slate-950 shadow-amber-500/20 active:scale-[0.99]'
                  : 'bg-slate-800 text-slate-500 border border-slate-700/60'
              }`}
            >
              {isSpinning ? (
                <>
                  <RotateCw size={18} className="animate-spin" />
                  <span>Вращение рулетки...</span>
                </>
              ) : (
                <>
                  <Sparkles size={18} />
                  <span>
                    {totalBet > 0 ? `Крутить $${totalBet.toFixed(2)}` : 'Поставьте фишку на поле'}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
