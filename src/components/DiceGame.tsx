import React, { useState, useRef, useEffect } from 'react';
import confetti from 'canvas-confetti';
import {
  Dices,
  ShieldCheck,
  History,
  Sparkles,
  ChevronRight,
  Sliders,
} from 'lucide-react';
import { playClickSound, playDiceRollSound, playCashoutSound } from '../utils/sound.ts';
import { triggerHaptic } from '../utils/telegram.ts';

interface DiceGameProps {
  userId: number;
  balance: number;
  onBalanceChange: (newBalance: number) => void;
  onOpenFairness: (data: any) => void;
}

const QUICK_BETS = [0.1, 0.5, 1.0, 2.0, 5.0, 10.0];

export const DiceGame: React.FC<DiceGameProps> = ({
  userId,
  balance,
  onBalanceChange,
  onOpenFairness,
}) => {
  const [betAmount, setBetAmount] = useState<number>(1.0);
  const [betType, setBetType] = useState<'over' | 'under' | 'even' | 'odd' | 'exact'>('over');
  const [exactTarget, setExactTarget] = useState<number>(6);

  // Animation and roll state
  const [isRolling, setIsRolling] = useState<boolean>(false);
  const [diceValue, setDiceValue] = useState<number>(5);
  const [rotationStyle, setRotationStyle] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const currentRotationRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const rollTimerRef = useRef<any>(null);

  const [lastWinInfo, setLastWinInfo] = useState<{ amount: number; won: boolean } | null>(null);
  const [history, setHistory] = useState<number[]>([4, 6, 2, 5, 1, 3, 6]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fairnessData, setFairnessData] = useState<any>(null);

  // Rotation angles for 3D cube faces (1 to 6)
  const faceRotations: { [key: number]: { x: number; y: number } } = {
    1: { x: 0, y: 0 },
    2: { x: 0, y: 180 },
    3: { x: 0, y: -90 },
    4: { x: 0, y: 90 },
    5: { x: -90, y: 0 },
    6: { x: 90, y: 0 },
  };

  useEffect(() => {
    return () => {
      if (rollTimerRef.current) clearTimeout(rollTimerRef.current);
    };
  }, []);

  const handleRoll = async () => {
    if (isRolling) return;
    const cleanBet = Math.round(betAmount * 100) / 100;
    if (cleanBet < 0.01) {
      setErrorMsg('Минимальная ставка $0.01');
      return;
    }
    if (cleanBet > balance) {
      setErrorMsg('Недостаточно средств на балансе!');
      return;
    }

    playClickSound();
    playDiceRollSound();
    triggerHaptic('medium');
    setIsRolling(true);
    setErrorMsg(null);
    setLastWinInfo(null);

    try {
      const res = await fetch('/api/dice/roll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          betAmount: cleanBet,
          betType,
          targetNumber: exactTarget,
        }),
      });

      const data = await res.json();
      if (!data.ok) {
        setIsRolling(false);
        setErrorMsg(data.error || 'Ошибка броска');
        return;
      }

      // Smooth physics roll calculation:
      // Continues forward from current angle with steady physical deceleration
      const cur = currentRotationRef.current;
      const baseRot = faceRotations[data.diceValue] || { x: 0, y: 0 };

      // 4 full revolutions in X and 5 in Y for rich 3D tumbling physics
      const minTurnsX = 4 * 360; // 1440
      const minTurnsY = 5 * 360; // 1800

      const targetX = Math.ceil((cur.x + minTurnsX - baseRot.x) / 360) * 360 + baseRot.x;
      const targetY = Math.ceil((cur.y + minTurnsY - baseRot.y) / 360) * 360 + baseRot.y;

      currentRotationRef.current = { x: targetX, y: targetY };
      setRotationStyle({ x: targetX, y: targetY });

      // Settles smoothly over 1600ms in a single fluid deceleration curve
      if (rollTimerRef.current) clearTimeout(rollTimerRef.current);
      rollTimerRef.current = setTimeout(() => {
        setDiceValue(data.diceValue);
        setFairnessData(data.fairness);
        setIsRolling(false);
        onBalanceChange(data.balance);

        setHistory((prev) => [data.diceValue, ...prev.slice(0, 14)]);
        setLastWinInfo({ amount: data.winAmount, won: data.won });

        if (data.won) {
          playCashoutSound();
          triggerHaptic('success');
          confetti({ particleCount: 50, spread: 50, origin: { y: 0.6 } });
        } else {
          triggerHaptic('error');
        }
      }, 1600);
    } catch {
      setIsRolling(false);
      setErrorMsg('Ошибка связи с сервером');
    }
  };

  const getMultiplier = () => {
    if (betType === 'exact') return 5.85;
    return 1.96;
  };

  return (
    <div className="max-w-xl mx-auto px-3.5 py-4 space-y-4">
      {/* 1. Header Banner & Fairness */}
      <div className="bg-[#121826] border border-slate-800 rounded-3xl p-3.5 shadow-xl flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-600 to-pink-600 flex items-center justify-center text-white shadow-lg shadow-purple-600/20 border border-purple-400/40">
            <Dices size={20} className={isRolling ? 'animate-bounce' : ''} />
          </div>
          <div>
            <h2 className="text-base font-black text-white leading-tight flex items-center gap-1.5">
              КОСТИ / КУБИК
              <span className="text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/30 px-1.5 py-0.5 rounded font-black">
                3D КУБ
              </span>
            </h2>
            <p className="text-[11px] text-slate-400">
              Выбирай исход или точное число с выплатой x5.85!
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

      {/* 2. History ribbon */}
      <div className="bg-[#0f1422] border border-slate-800 rounded-2xl p-2.5 shadow-md flex items-center gap-2">
        <span className="text-slate-400 font-bold text-[11px] flex-shrink-0 flex items-center gap-1 pl-0.5">
          <History size={12} className="text-purple-400" />
          <span>Броски:</span>
        </span>
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-2 px-1 flex-1">
          {history.map((val, idx) => {
            const isLatest = idx === 0;
            return (
              <div
                key={idx}
                className={`w-7 h-7 rounded-lg border font-black text-xs flex items-center justify-center flex-shrink-0 shadow-sm transition-all ${
                  val >= 4
                    ? 'bg-purple-500/20 border-purple-500/50 text-purple-300'
                    : 'bg-slate-800 border-slate-700 text-slate-300'
                } ${
                  isLatest
                    ? 'ring-2 ring-purple-400 shadow-md shadow-purple-500/30 scale-105 mx-1 bg-purple-500/35 border-purple-300'
                    : 'opacity-85'
                }`}
              >
                {val}
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. 3D DICE ARENA */}
      <div className="relative bg-gradient-to-b from-[#111728] via-[#0d121f] to-[#090d16] border-2 border-slate-800 rounded-3xl p-6 shadow-2xl flex flex-col items-center justify-center min-h-[260px] overflow-hidden">
        {/* 3D Dice Container with CSS Perspective */}
        <div className="perspective-1000 w-24 h-24 my-4">
          <div
            style={{
              transform: `rotateX(${rotationStyle.x}deg) rotateY(${rotationStyle.y}deg)`,
              transformStyle: 'preserve-3d',
              transition: isRolling
                ? 'transform 1.6s cubic-bezier(0.12, 0.85, 0.25, 1)'
                : 'transform 0.4s ease-out',
            }}
            className="w-full h-full relative will-change-transform"
          >
            {/* Face 1 */}
            <div
              style={{ transform: 'translateZ(48px)' }}
              className="absolute inset-0 bg-gradient-to-br from-white to-slate-200 border-2 border-slate-300 rounded-2xl flex items-center justify-center shadow-lg"
            >
              <div className="w-4 h-4 rounded-full bg-rose-600 shadow-inner" />
            </div>

            {/* Face 2 */}
            <div
              style={{ transform: 'rotateY(180deg) translateZ(48px)' }}
              className="absolute inset-0 bg-gradient-to-br from-white to-slate-200 border-2 border-slate-300 rounded-2xl flex justify-between p-3.5 shadow-lg"
            >
              <div className="w-3.5 h-3.5 rounded-full bg-slate-900 self-start" />
              <div className="w-3.5 h-3.5 rounded-full bg-slate-900 self-end" />
            </div>

            {/* Face 3 */}
            <div
              style={{ transform: 'rotateY(90deg) translateZ(48px)' }}
              className="absolute inset-0 bg-gradient-to-br from-white to-slate-200 border-2 border-slate-300 rounded-2xl flex justify-between p-3 shadow-lg"
            >
              <div className="w-3 h-3 rounded-full bg-slate-900 self-start" />
              <div className="w-3 h-3 rounded-full bg-slate-900 self-center" />
              <div className="w-3 h-3 rounded-full bg-slate-900 self-end" />
            </div>

            {/* Face 4 */}
            <div
              style={{ transform: 'rotateY(-90deg) translateZ(48px)' }}
              className="absolute inset-0 bg-gradient-to-br from-white to-slate-200 border-2 border-slate-300 rounded-2xl grid grid-cols-2 p-3 gap-2 shadow-lg"
            >
              <div className="w-3 h-3 rounded-full bg-slate-900" />
              <div className="w-3 h-3 rounded-full bg-slate-900 justify-self-end" />
              <div className="w-3 h-3 rounded-full bg-slate-900 self-end" />
              <div className="w-3 h-3 rounded-full bg-slate-900 justify-self-end self-end" />
            </div>

            {/* Face 5 */}
            <div
              style={{ transform: 'rotateX(90deg) translateZ(48px)' }}
              className="absolute inset-0 bg-gradient-to-br from-white to-slate-200 border-2 border-slate-300 rounded-2xl flex flex-col justify-between p-2.5 shadow-lg"
            >
              <div className="flex justify-between">
                <div className="w-3 h-3 rounded-full bg-slate-900" />
                <div className="w-3 h-3 rounded-full bg-slate-900" />
              </div>
              <div className="w-3 h-3 rounded-full bg-slate-900 self-center" />
              <div className="flex justify-between">
                <div className="w-3 h-3 rounded-full bg-slate-900" />
                <div className="w-3 h-3 rounded-full bg-slate-900" />
              </div>
            </div>

            {/* Face 6 */}
            <div
              style={{ transform: 'rotateX(-90deg) translateZ(48px)' }}
              className="absolute inset-0 bg-gradient-to-br from-white to-slate-200 border-2 border-slate-300 rounded-2xl grid grid-cols-2 p-2.5 gap-2 shadow-lg"
            >
              <div className="w-3 h-3 rounded-full bg-slate-900" />
              <div className="w-3 h-3 rounded-full bg-slate-900 justify-self-end" />
              <div className="w-3 h-3 rounded-full bg-slate-900" />
              <div className="w-3 h-3 rounded-full bg-slate-900 justify-self-end" />
              <div className="w-3 h-3 rounded-full bg-slate-900" />
              <div className="w-3 h-3 rounded-full bg-slate-900 justify-self-end" />
            </div>
          </div>
        </div>

        {/* Result Callout */}
        <div className="mt-3 text-center">
          {lastWinInfo ? (
            <div
              className={`px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider inline-block ${
                lastWinInfo.won
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
              }`}
            >
              {lastWinInfo.won ? `Выигрыш +$${lastWinInfo.amount.toFixed(2)}!` : 'Не угадали'}
            </div>
          ) : (
            <span className="text-xs font-bold text-slate-400">
              Выпало: <b className="text-white text-sm">{diceValue}</b>
            </span>
          )}
        </div>
      </div>

      {/* 4. ERROR ALERT */}
      {errorMsg && (
        <div className="p-3 rounded-xl bg-red-950/80 border border-red-500/50 text-red-200 text-xs font-bold flex items-center justify-between">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="text-red-400 hover:text-white ml-2 cursor-pointer">
            ✕
          </button>
        </div>
      )}

      {/* 5. BETTING CONTROLS */}
      <div className="bg-[#121826] border border-slate-800 rounded-3xl p-4 shadow-xl space-y-3.5">
        {/* Outcome Selector */}
        <div>
          <div className="flex items-center justify-between text-xs font-bold text-slate-400 mb-2 px-0.5">
            <span>Выберите исход:</span>
            <span className="text-purple-400">Множитель: x{getMultiplier().toFixed(2)}</span>
          </div>

          <div className="grid grid-cols-4 gap-1.5">
            <button
              disabled={isRolling}
              onClick={() => {
                triggerHaptic('selection');
                setBetType('over');
              }}
              className={`py-2 px-1 rounded-xl text-center font-bold text-xs transition-all border cursor-pointer ${
                betType === 'over'
                  ? 'bg-purple-600 border-purple-400 text-white shadow-md shadow-purple-600/30'
                  : 'bg-slate-800 border-slate-700 text-slate-300'
              }`}
            >
              Больше 3 (4-6)
            </button>

            <button
              disabled={isRolling}
              onClick={() => {
                triggerHaptic('selection');
                setBetType('under');
              }}
              className={`py-2 px-1 rounded-xl text-center font-bold text-xs transition-all border cursor-pointer ${
                betType === 'under'
                  ? 'bg-purple-600 border-purple-400 text-white shadow-md shadow-purple-600/30'
                  : 'bg-slate-800 border-slate-700 text-slate-300'
              }`}
            >
              Меньше 4 (1-3)
            </button>

            <button
              disabled={isRolling}
              onClick={() => {
                triggerHaptic('selection');
                setBetType('even');
              }}
              className={`py-2 px-1 rounded-xl text-center font-bold text-xs transition-all border cursor-pointer ${
                betType === 'even'
                  ? 'bg-purple-600 border-purple-400 text-white shadow-md shadow-purple-600/30'
                  : 'bg-slate-800 border-slate-700 text-slate-300'
              }`}
            >
              Чётное
            </button>

            <button
              disabled={isRolling}
              onClick={() => {
                triggerHaptic('selection');
                setBetType('odd');
              }}
              className={`py-2 px-1 rounded-xl text-center font-bold text-xs transition-all border cursor-pointer ${
                betType === 'odd'
                  ? 'bg-purple-600 border-purple-400 text-white shadow-md shadow-purple-600/30'
                  : 'bg-slate-800 border-slate-700 text-slate-300'
              }`}
            >
              Нечётное
            </button>
          </div>

          {/* Exact Face Selector (x5.85) */}
          <div className="mt-2 p-2 bg-slate-950/80 border border-slate-800 rounded-2xl">
            <div className="flex items-center justify-between text-[11px] font-bold text-slate-400 mb-1.5 px-1">
              <span>Точное число (Выигрыш x5.85):</span>
            </div>
            <div className="grid grid-cols-6 gap-1">
              {[1, 2, 3, 4, 5, 6].map((num) => (
                <button
                  key={num}
                  disabled={isRolling}
                  onClick={() => {
                    triggerHaptic('selection');
                    setBetType('exact');
                    setExactTarget(num);
                  }}
                  className={`py-1.5 rounded-lg text-xs font-black transition-all border cursor-pointer ${
                    betType === 'exact' && exactTarget === num
                      ? 'bg-amber-500 border-amber-300 text-slate-950 shadow-md scale-105'
                      : 'bg-slate-800/80 border-slate-700 text-slate-200'
                  }`}
                >
                  {num}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Bet Input */}
        <div>
          <div className="flex items-center justify-between text-xs mb-1.5 px-0.5">
            <span className="font-bold text-slate-300">Ставка ($):</span>
            <span className="text-slate-400 text-[10px]">Баланс: ${balance.toFixed(2)}</span>
          </div>
          <div className="relative flex items-center">
            <span className="absolute left-3 text-purple-400 font-black text-sm">$</span>
            <input
              disabled={isRolling}
              type="number"
              step="0.01"
              min="0.01"
              max="500"
              value={betAmount || ''}
              onChange={(e) => setBetAmount(parseFloat(e.target.value) || 0)}
              className="w-full bg-slate-900 border border-slate-700/80 rounded-xl py-2 pl-7 pr-2 text-white font-extrabold text-sm focus:outline-none focus:border-purple-500"
            />
          </div>

          <div className="flex gap-1.5 mt-2 overflow-x-auto no-scrollbar py-0.5">
            {QUICK_BETS.map((chip) => (
              <button
                key={chip}
                disabled={isRolling}
                onClick={() => {
                  triggerHaptic('selection');
                  playClickSound();
                  setBetAmount(chip);
                }}
                className={`flex-1 py-1 px-1 rounded-xl text-xs font-black transition-all cursor-pointer ${
                  betAmount === chip
                    ? 'bg-purple-600 text-white shadow-md'
                    : 'bg-slate-800/80 hover:bg-slate-750 text-slate-300 border border-slate-700/60'
                }`}
              >
                ${chip >= 1 ? chip : chip.toFixed(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Roll Button */}
        <button
          disabled={isRolling || betAmount <= 0}
          onClick={handleRoll}
          className="w-full py-4 px-4 rounded-2xl bg-gradient-to-r from-purple-600 via-pink-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-black text-base uppercase tracking-wider flex items-center justify-center gap-2 shadow-xl shadow-purple-600/20 active:scale-[0.99] cursor-pointer"
        >
          {isRolling ? (
            <span>Бросок кубика...</span>
          ) : (
            <>
              <Sparkles size={18} />
              <span>Бросить кубик за ${betAmount.toFixed(2)}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
