import React, { useState, useEffect, useRef } from 'react';
import confetti from 'canvas-confetti';
import {
  Sparkles,
  ShieldCheck,
  RotateCw,
  AlertTriangle,
  Flame,
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

// European sequence on physical wheel
const ROULETTE_NUMBERS = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const CHIP_SIZES = [0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 25.0];

export const RouletteGame: React.FC<RouletteGameProps> = ({
  userId,
  balance,
  onBalanceChange,
  onOpenFairness,
}) => {
  // Betting state
  const [selectedChip, setSelectedChip] = useState<number>(1.0);
  const [bets, setBets] = useState<{ [key: string]: number }>({});
  const [showNumbersGrid, setShowNumbersGrid] = useState<boolean>(false);

  // Animation & game status
  const [isSpinning, setIsSpinning] = useState<boolean>(false);
  const [winningNumber, setWinningNumber] = useState<number | null>(null);
  const [lastWinInfo, setLastWinInfo] = useState<{ totalWin: number; totalBet: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ number: number; color: string }>>([]);
  const [fairnessData, setFairnessData] = useState<any>(null);

  // Tape wheel position
  const [wheelOffset, setWheelOffset] = useState<number>(0);
  const [transitionStyle, setTransitionStyle] = useState<string>('none');
  const tapeRef = useRef<HTMLDivElement>(null);
  const tickTimerRef = useRef<any>(null);

  // Repeat sequence 5 times for smooth infinite tape scrolling
  const REPEAT_COUNT = 5;
  const ITEM_WIDTH = 58; // width of each number card in px

  const fullSequence = React.useMemo(() => {
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
  }, []);

  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/roulette/history');
      const data = await res.json();
      if (data.ok && Array.isArray(data.history)) {
        setHistory(data.history);
      }
    } catch {
      // ignore
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
      setErrorMsg('Максимальная ставка $500');
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

  const totalBet = React.useMemo(() => {
    const sum = Object.values(bets).reduce((a, b) => a + b, 0);
    return Math.round(sum * 100) / 100;
  }, [bets]);

  // Spin Roulette
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
        return;
      }

      onBalanceChange(data.balance - (data.totalWin > 0 ? data.totalWin : 0));
      setFairnessData(data.fairness);

      // Spin tape calculation
      const targetNum = data.winningNumber;
      // Find position of winning number in iteration 3 (middle repetition)
      const targetIndexInOneSet = ROULETTE_NUMBERS.indexOf(targetNum);
      const targetIndex = 3 * ROULETTE_NUMBERS.length + targetIndexInOneSet;

      // Center calculation: container width / 2 minus item center
      const containerWidth = tapeRef.current?.parentElement?.clientWidth || 360;
      const targetX = targetIndex * ITEM_WIDTH + ITEM_WIDTH / 2 - containerWidth / 2;

      // Small jitter inside the slot for natural look
      const jitter = (Math.random() - 0.5) * (ITEM_WIDTH * 0.4);
      const finalOffset = -(targetX + jitter);

      // Start spinning animation
      setTransitionStyle('transform 4.2s cubic-bezier(0.12, 0.8, 0.15, 1)');
      setWheelOffset(finalOffset);

      // Tick sounds during rotation
      let tickCount = 0;
      const maxTicks = 28;
      const startInterval = 60;
      const playTickStep = () => {
        if (tickCount < maxTicks) {
          playRouletteTickSound();
          tickCount++;
          const nextDelay = startInterval + Math.pow(tickCount / 1.8, 2) * 15;
          tickTimerRef.current = setTimeout(playTickStep, nextDelay);
        }
      };
      playTickStep();

      // When spin finishes
      setTimeout(() => {
        setIsSpinning(false);
        setWinningNumber(targetNum);
        triggerHaptic('success');

        // Update balance to include win
        onBalanceChange(data.balance);

        // Update history strip
        setHistory((prev) => [{ number: targetNum, color: data.color }, ...prev.slice(0, 14)]);

        // Win result
        if (data.totalWin > 0) {
          playRouletteWinSound();
          setLastWinInfo({ totalWin: data.totalWin, totalBet: data.totalBet });
          confetti({
            particleCount: 50,
            spread: 60,
            origin: { y: 0.65 },
          });
        }
      }, 4300);
    } catch {
      setIsSpinning(false);
      setErrorMsg('Сетевая ошибка соединения');
    }
  };

  return (
    <div className="max-w-xl mx-auto px-3.5 py-4 space-y-4">
      {/* Top Banner & Fairness Header */}
      <div className="bg-[#121826] border border-slate-800 rounded-2xl p-3 shadow-lg flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-red-500 to-amber-500 flex items-center justify-center text-white shadow-md shadow-red-500/20">
            <RotateCw size={17} className={isSpinning ? 'animate-spin' : ''} />
          </div>
          <div>
            <h2 className="text-sm font-black text-white leading-tight flex items-center gap-1.5">
              РУЛЕТКА
              <span className="text-[10px] bg-red-500/20 text-red-400 border border-red-500/30 px-1.5 py-0.2 rounded font-bold">
                EUROPEAN
              </span>
            </h2>
            <p className="text-[10px] text-slate-400">37 секторов (0-36) • Честная игра SHA-256</p>
          </div>
        </div>

        {/* Provably Fair Modal trigger */}
        <button
          onClick={() => onOpenFairness(fairnessData)}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-750 border border-slate-700/80 text-[11px] text-slate-300 hover:text-white transition-colors cursor-pointer"
        >
          <ShieldCheck size={13} className="text-emerald-400" />
          <span className="font-semibold">Fairness</span>
        </button>
      </div>

      {/* Recent Drops History Ribbon */}
      <div className="bg-[#101522] border border-slate-800/90 rounded-2xl p-2.5 shadow-md flex items-center gap-2 overflow-hidden">
        <div className="flex items-center gap-1 text-[11px] font-extrabold text-slate-400 pl-1 flex-shrink-0">
          <History size={12} className="text-amber-400" />
          <span>История:</span>
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
          {history.map((item, idx) => {
            let bg = 'bg-slate-800 text-slate-200 border-slate-700';
            if (item.color === 'red') bg = 'bg-red-500/25 text-red-300 border-red-500/50';
            else if (item.color === 'green') bg = 'bg-emerald-500/30 text-emerald-300 border-emerald-500/60 font-black';
            else if (item.color === 'black') bg = 'bg-slate-900 text-slate-300 border-slate-700';

            return (
              <div
                key={idx}
                className={`w-7 h-7 rounded-lg border flex items-center justify-center font-black text-xs flex-shrink-0 shadow-sm transition-all ${bg} ${
                  idx === 0 ? 'scale-110 shadow-md ring-1 ring-amber-400/50' : ''
                }`}
              >
                {item.number}
              </div>
            );
          })}
        </div>
      </div>

      {/* ROULETTE HORIZONTAL WHEEL TAPE */}
      <div className="relative bg-gradient-to-b from-[#0e1320] via-[#131929] to-[#0d121f] border-2 border-slate-800 rounded-3xl p-3 shadow-2xl overflow-hidden">
        {/* Pointer needle centered */}
        <div className="absolute top-0 inset-x-0 flex flex-col items-center pointer-events-none z-20">
          <div className="w-0 h-0 border-l-[9px] border-l-transparent border-r-[9px] border-r-transparent border-t-[12px] border-t-amber-400 filter drop-shadow-md"></div>
          <div className="w-0.5 h-16 bg-gradient-to-b from-amber-400 to-transparent opacity-80"></div>
        </div>

        {/* Bottom indicator */}
        <div className="absolute bottom-0 inset-x-0 flex flex-col items-center pointer-events-none z-20">
          <div className="w-0 h-0 border-l-[7px] border-l-transparent border-r-[7px] border-r-transparent border-b-[10px] border-b-amber-400 filter drop-shadow-md"></div>
        </div>

        {/* Side Shadow Vignette */}
        <div className="absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-[#0d121f] to-transparent pointer-events-none z-10"></div>
        <div className="absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-[#0d121f] to-transparent pointer-events-none z-10"></div>

        {/* The Carousel Track */}
        <div className="overflow-hidden py-4">
          <div
            ref={tapeRef}
            style={{
              transform: `translateX(${wheelOffset}px)`,
              transition: transitionStyle,
            }}
            className="flex items-center gap-1.5 will-change-transform"
          >
            {fullSequence.map((slot) => {
              const isWinTarget = winningNumber !== null && slot.number === winningNumber;

              let tileClass =
                'w-[52px] h-[64px] rounded-xl flex flex-col items-center justify-center font-black transition-all flex-shrink-0 border select-none shadow-md ';

              if (slot.color === 'green') {
                tileClass += isWinTarget
                  ? 'bg-emerald-500 text-slate-950 border-emerald-300 ring-4 ring-emerald-400/50 scale-105 shadow-xl shadow-emerald-500/40'
                  : 'bg-gradient-to-b from-emerald-600 to-emerald-800 text-white border-emerald-400/50';
              } else if (slot.color === 'red') {
                tileClass += isWinTarget
                  ? 'bg-rose-500 text-white border-rose-300 ring-4 ring-rose-400/50 scale-105 shadow-xl shadow-rose-500/40'
                  : 'bg-gradient-to-b from-rose-600 to-red-800 text-white border-rose-500/40';
              } else {
                tileClass += isWinTarget
                  ? 'bg-slate-800 text-white border-amber-400 ring-4 ring-amber-400/50 scale-105 shadow-xl shadow-black/60'
                  : 'bg-gradient-to-b from-slate-900 to-slate-950 text-slate-200 border-slate-700/80';
              }

              return (
                <div key={slot.key} className={tileClass}>
                  <span className="text-xl leading-none tracking-tight">{slot.number}</span>
                  <div
                    className={`w-2 h-2 rounded-full mt-1.5 ${
                      slot.color === 'green' ? 'bg-emerald-400' : slot.color === 'red' ? 'bg-rose-400' : 'bg-slate-400'
                    }`}
                  ></div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* WIN BANNER ALERT */}
      {lastWinInfo && (
        <div className="bg-gradient-to-r from-emerald-950/90 via-emerald-900/70 to-slate-900 border border-emerald-500/40 rounded-2xl p-3.5 shadow-xl shadow-emerald-500/10 flex items-center justify-between animate-in fade-in zoom-in-95">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500 text-slate-950 flex items-center justify-center font-black text-xl shadow-lg shadow-emerald-500/30">
              🎉
            </div>
            <div>
              <div className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Выигрыш в Рулетке!</div>
              <div className="text-lg font-black text-white leading-tight">
                +${lastWinInfo.totalWin.toFixed(2)}{' '}
                <span className="text-xs font-bold text-emerald-400">
                  (Прибыль: +${(lastWinInfo.totalWin - lastWinInfo.totalBet).toFixed(2)})
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={() => setLastWinInfo(null)}
            className="text-xs text-slate-400 hover:text-white px-2 py-1 cursor-pointer"
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

      {/* BETTING BOARD */}
      <div className="bg-[#121826] border border-slate-800 rounded-3xl p-4 shadow-xl space-y-3.5">
        {/* 1. PRIMARY COLOR BETS (RED, GREEN 0, BLACK) */}
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
              className="relative p-3.5 rounded-2xl bg-gradient-to-b from-rose-600 to-red-800 hover:from-rose-500 hover:to-red-700 border border-rose-400/50 shadow-lg shadow-red-600/20 active:scale-95 transition-all text-center cursor-pointer group"
            >
              <div className="text-[10px] font-black uppercase tracking-wider text-rose-200">КРАСНОЕ</div>
              <div className="text-lg font-black text-white mt-0.5">2X</div>
              {bets['red'] ? (
                <div className="mt-1 bg-slate-950/80 border border-amber-400 text-amber-300 text-xs font-black py-0.5 px-2 rounded-full inline-block shadow">
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
              className="relative p-3.5 rounded-2xl bg-gradient-to-b from-emerald-600 to-emerald-800 hover:from-emerald-500 hover:to-emerald-700 border border-emerald-400/50 shadow-lg shadow-emerald-600/20 active:scale-95 transition-all text-center cursor-pointer group"
            >
              <div className="text-[10px] font-black uppercase tracking-wider text-emerald-200">ЗЕРО (0)</div>
              <div className="text-lg font-black text-white mt-0.5">14X</div>
              {bets['green'] ? (
                <div className="mt-1 bg-slate-950/80 border border-amber-400 text-amber-300 text-xs font-black py-0.5 px-2 rounded-full inline-block shadow">
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
              className="relative p-3.5 rounded-2xl bg-gradient-to-b from-slate-800 to-slate-950 hover:from-slate-750 hover:to-slate-900 border border-slate-700 shadow-lg shadow-black/40 active:scale-95 transition-all text-center cursor-pointer group"
            >
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-300">ЧЁРНОЕ</div>
              <div className="text-lg font-black text-white mt-0.5">2X</div>
              {bets['black'] ? (
                <div className="mt-1 bg-slate-950/80 border border-amber-400 text-amber-300 text-xs font-black py-0.5 px-2 rounded-full inline-block shadow">
                  ${bets['black'].toFixed(2)}
                </div>
              ) : (
                <div className="text-[10px] text-slate-400 mt-1">18 номеров</div>
              )}
            </button>
          </div>
        </div>

        {/* 2. OUTSIDE BETS (EVEN/ODD, RANGES, DOZENS) */}
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
                <div className="text-[10px] font-black text-amber-400 mt-0.5 leading-none">${bets['low'].toFixed(2)}</div>
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
                <div className="text-[10px] font-black text-amber-400 mt-0.5 leading-none">${bets['even'].toFixed(2)}</div>
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
                <div className="text-[10px] font-black text-amber-400 mt-0.5 leading-none">${bets['odd'].toFixed(2)}</div>
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
                <div className="text-[10px] font-black text-amber-400 mt-0.5 leading-none">${bets['high'].toFixed(2)}</div>
              )}
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            <button
              disabled={isSpinning}
              onClick={() => handlePlaceBet('dozen1')}
              className="py-2 px-2 rounded-xl bg-slate-850 hover:bg-slate-800 border border-slate-700/80 text-center transition-all cursor-pointer"
            >
              <div className="text-[10px] font-bold text-slate-400 leading-none">1st 12 (1-12)</div>
              <div className="text-xs font-black text-white mt-0.5 leading-none">x3</div>
              {bets['dozen1'] && (
                <div className="text-[10px] font-black text-amber-400 mt-0.5 leading-none">${bets['dozen1'].toFixed(2)}</div>
              )}
            </button>

            <button
              disabled={isSpinning}
              onClick={() => handlePlaceBet('dozen2')}
              className="py-2 px-2 rounded-xl bg-slate-850 hover:bg-slate-800 border border-slate-700/80 text-center transition-all cursor-pointer"
            >
              <div className="text-[10px] font-bold text-slate-400 leading-none">2nd 12 (13-24)</div>
              <div className="text-xs font-black text-white mt-0.5 leading-none">x3</div>
              {bets['dozen2'] && (
                <div className="text-[10px] font-black text-amber-400 mt-0.5 leading-none">${bets['dozen2'].toFixed(2)}</div>
              )}
            </button>

            <button
              disabled={isSpinning}
              onClick={() => handlePlaceBet('dozen3')}
              className="py-2 px-2 rounded-xl bg-slate-850 hover:bg-slate-800 border border-slate-700/80 text-center transition-all cursor-pointer"
            >
              <div className="text-[10px] font-bold text-slate-400 leading-none">3rd 12 (25-36)</div>
              <div className="text-xs font-black text-white mt-0.5 leading-none">x3</div>
              {bets['dozen3'] && (
                <div className="text-[10px] font-black text-amber-400 mt-0.5 leading-none">${bets['dozen3'].toFixed(2)}</div>
              )}
            </button>
          </div>
        </div>

        {/* 3. TOGGLE DIRECT NUMBER PICKER (0-36, x36 payout) */}
        <div className="pt-1">
          <button
            onClick={() => setShowNumbersGrid((prev) => !prev)}
            className="w-full py-1.5 px-3 rounded-xl bg-slate-850 hover:bg-slate-800 border border-slate-700/60 text-xs font-bold text-slate-300 flex items-center justify-between cursor-pointer"
          >
            <span className="flex items-center gap-1.5">
              <Flame size={13} className="text-amber-400" />
              <span>Точные числа 0-36 (Выигрыш x36)</span>
            </span>
            {showNumbersGrid ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>

          {showNumbersGrid && (
            <div className="mt-2.5 p-2 bg-slate-950/80 border border-slate-800 rounded-2xl space-y-1.5 animate-in fade-in">
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: 37 }, (_, i) => {
                  const num = i;
                  const color = getNumberColor(num);
                  const key = `num_${num}`;
                  const betAmt = bets[key];

                  let btnBg = 'bg-slate-800 hover:bg-slate-700 text-white';
                  if (color === 'green') btnBg = 'bg-emerald-600/80 hover:bg-emerald-500 text-white';
                  else if (color === 'red') btnBg = 'bg-rose-600/80 hover:bg-rose-500 text-white';

                  return (
                    <button
                      key={num}
                      disabled={isSpinning}
                      onClick={() => handlePlaceBet(key)}
                      className={`relative py-2 rounded-lg font-black text-xs transition-transform active:scale-90 flex flex-col items-center justify-center border border-white/10 ${btnBg}`}
                    >
                      <span>{num}</span>
                      {betAmt && (
                        <span className="absolute -top-1 -right-1 bg-amber-400 text-slate-950 text-[9px] font-black w-4 h-4 rounded-full flex items-center justify-center shadow">
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

        {/* 4. CHIP SELECTOR & ACTIONS */}
        <div className="pt-2 border-t border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between text-xs px-0.5">
            <span className="font-bold text-slate-300">Выберите фишку:</span>
            <span className="text-slate-400 text-[11px]">
              Баланс: <b className="text-white">${balance.toFixed(2)}</b>
            </span>
          </div>

          {/* Chip Buttons */}
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

          {/* Quick Bet Modifiers */}
          <div className="flex gap-1.5">
            <button
              disabled={isSpinning || totalBet <= 0}
              onClick={handleDoubleBets}
              className="flex-1 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-xs font-bold text-slate-200 border border-slate-700 cursor-pointer disabled:opacity-50"
            >
              2X Удвоить
            </button>
            <button
              disabled={isSpinning || totalBet <= 0}
              onClick={handleClearBets}
              className="flex-1 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-xs font-bold text-rose-300 border border-slate-700 flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
            >
              <Trash2 size={13} />
              <span>Очистить</span>
            </button>
          </div>

          {/* Total Bet & Spin Action */}
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
