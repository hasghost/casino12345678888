import React, { useState, useRef } from 'react';
import confetti from 'canvas-confetti';
import {
  ShieldCheck,
  History,
  Sparkles,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import {
  playClickSound,
  playCoinTossSound,
  playCoinLandSound,
  playCashoutSound,
} from '../utils/sound.ts';
import { triggerHaptic } from '../utils/telegram.ts';

interface CoinflipGameProps {
  userId: number;
  balance: number;
  onBalanceChange: (newBalance: number) => void;
  onOpenFairness: (data: any) => void;
}

const QUICK_BETS = [0.1, 0.5, 1.0, 2.0, 5.0, 10.0];

// Custom High-Detail Vector SVG for the "SpindBet" Heads Face
export const CoinHeadsFace: React.FC<{ size?: number; className?: string }> = ({
  size = 144,
  className = '',
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 160 160"
    className={`select-none ${className}`}
  >
    <defs>
      {/* Outer Rim Gold Gradient */}
      <radialGradient id="headsRimGrad" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#fef08a" />
        <stop offset="60%" stopColor="#f59e0b" />
        <stop offset="90%" stopColor="#d97706" />
        <stop offset="100%" stopColor="#92400e" />
      </radialGradient>
      {/* Inner Face Radiant Gold Gradient */}
      <radialGradient id="headsFaceGrad" cx="35%" cy="30%" r="65%">
        <stop offset="0%" stopColor="#fffbeb" />
        <stop offset="35%" stopColor="#fde047" />
        <stop offset="70%" stopColor="#d97706" />
        <stop offset="100%" stopColor="#78350f" />
      </radialGradient>
      {/* Metallic Eagle Gold Gradient */}
      <linearGradient id="eagleGoldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#78350f" />
        <stop offset="50%" stopColor="#451a03" />
        <stop offset="100%" stopColor="#78350f" />
      </linearGradient>
      <filter id="headsGlow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodColor="#000" floodOpacity="0.4" />
      </filter>
    </defs>

    {/* Outer Edge & Ring */}
    <circle cx="80" cy="80" r="78" fill="url(#headsRimGrad)" stroke="#fef08a" strokeWidth="2.5" />
    {/* Milled Notches Border */}
    <circle
      cx="80"
      cy="80"
      r="72"
      fill="none"
      stroke="#78350f"
      strokeWidth="2.5"
      strokeDasharray="3 3"
      opacity="0.85"
    />
    {/* Main Core Coin Surface */}
    <circle cx="80" cy="80" r="68" fill="url(#headsFaceGrad)" />
    <circle cx="80" cy="80" r="67" fill="none" stroke="#fef08a" strokeWidth="1" opacity="0.6" />

    {/* Top Curved Text / Inscription: SPIND BET */}
    <path id="headsTextArcTop" d="M 30,80 A 50,50 0 0,1 130,80" fill="none" />
    <text className="font-black uppercase tracking-widest text-[11px]" fill="#451a03" filter="url(#headsGlow)">
      <textPath href="#headsTextArcTop" startOffset="50%" textAnchor="middle">
        ★ SPIND BET ★
      </textPath>
    </text>

    {/* Center Emblem: Stylized Imperial Casino Eagle */}
    <g transform="translate(80, 78) scale(0.92)" filter="url(#headsGlow)">
      {/* Crown */}
      <path
        d="M -9,-26 L -11,-19 L -5,-21 L 0,-27 L 5,-21 L 11,-19 L 9,-26 L 0,-24 Z"
        fill="#451a03"
      />
      {/* Eagle Body & Head */}
      <path
        d="M 0,-18 C -3,-18 -4,-15 -3,-12 C -6,-10 -9,-6 -8,0 C -7,6 -3,14 0,16 C 3,14 7,6 8,0 C 9,-6 6,-10 3,-12 C 4,-15 3,-18 0,-18 Z"
        fill="url(#eagleGoldGrad)"
      />
      {/* Left Wing */}
      <path
        d="M -6,-11 C -18,-18 -32,-14 -35,-3 C -30,0 -20,2 -13,0 C -22,6 -29,14 -25,20 C -19,16 -13,10 -7,4 C -10,12 -12,19 -7,22 C -4,18 -3,11 -2,7 Z"
        fill="#451a03"
      />
      {/* Right Wing */}
      <path
        d="M 6,-11 C 18,-18 32,-14 35,-3 C 30,0 20,2 13,0 C 22,6 29,14 25,20 C 19,16 13,10 7,4 C 10,12 12,19 7,22 C 4,18 3,11 2,7 Z"
        fill="#451a03"
      />
      {/* Tail Feathers */}
      <path
        d="M -5,16 L -7,26 L 0,23 L 7,26 L 5,16 Z"
        fill="#451a03"
      />
    </g>

    {/* Center Title Badge */}
    <rect x="52" y="104" width="56" height="15" rx="7.5" fill="#451a03" opacity="0.9" />
    <text
      x="80"
      y="115"
      textAnchor="middle"
      fill="#fef08a"
      fontSize="10"
      fontWeight="900"
      letterSpacing="1.5"
      fontFamily="sans-serif"
    >
      ОРЁЛ
    </text>

    {/* Bottom Inscription */}
    <text
      x="80"
      y="134"
      textAnchor="middle"
      fill="#78350f"
      fontSize="7.5"
      fontWeight="900"
      letterSpacing="1.2"
      fontFamily="sans-serif"
    >
      CASINO TOKEN
    </text>
  </svg>
);

// Custom High-Detail Vector SVG for the "SpindBet" Tails Face
export const CoinTailsFace: React.FC<{ size?: number; className?: string }> = ({
  size = 144,
  className = '',
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 160 160"
    className={`select-none ${className}`}
  >
    <defs>
      <radialGradient id="tailsRimGrad" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#fef08a" />
        <stop offset="60%" stopColor="#f59e0b" />
        <stop offset="90%" stopColor="#d97706" />
        <stop offset="100%" stopColor="#92400e" />
      </radialGradient>
      <radialGradient id="tailsFaceGrad" cx="35%" cy="30%" r="65%">
        <stop offset="0%" stopColor="#fffbeb" />
        <stop offset="30%" stopColor="#fde047" />
        <stop offset="75%" stopColor="#b45309" />
        <stop offset="100%" stopColor="#78350f" />
      </radialGradient>
      <filter id="tailsGlow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodColor="#000" floodOpacity="0.4" />
      </filter>
    </defs>

    {/* Outer Edge & Ring */}
    <circle cx="80" cy="80" r="78" fill="url(#tailsRimGrad)" stroke="#fef08a" strokeWidth="2.5" />
    {/* Milled Grooves Border */}
    <circle
      cx="80"
      cy="80"
      r="72"
      fill="none"
      stroke="#78350f"
      strokeWidth="2.5"
      strokeDasharray="3 3"
      opacity="0.85"
    />
    {/* Main Core Coin Surface */}
    <circle cx="80" cy="80" r="68" fill="url(#tailsFaceGrad)" />
    <circle cx="80" cy="80" r="67" fill="none" stroke="#fef08a" strokeWidth="1" opacity="0.6" />

    {/* Top Curved Text / Inscription: SPIND BET */}
    <path id="tailsTextArcTop" d="M 30,80 A 50,50 0 0,1 130,80" fill="none" />
    <text className="font-black uppercase tracking-widest text-[11px]" fill="#451a03" filter="url(#tailsGlow)">
      <textPath href="#tailsTextArcTop" startOffset="50%" textAnchor="middle">
        ★ SPIND BET ★
      </textPath>
    </text>

    {/* Central Laurel Wreath */}
    <g transform="translate(80, 75)" opacity="0.9">
      {/* Left Laurel Sprig */}
      <path
        d="M -30,15 C -36,-5 -28,-22 -14,-30 C -18,-24 -18,-15 -14,-8 C -22,-6 -25,2 -22,8 C -24,14 -22,20 -18,22 Z"
        fill="#78350f"
      />
      {/* Right Laurel Sprig */}
      <path
        d="M 30,15 C 36,-5 28,-22 14,-30 C 18,-24 18,-15 14,-8 C 22,-6 25,2 22,8 C 24,14 22,20 18,22 Z"
        fill="#78350f"
      />
    </g>

    {/* Large Bold Nominal Value: 100 */}
    <text
      x="80"
      y="78"
      textAnchor="middle"
      fill="#451a03"
      fontSize="36"
      fontWeight="900"
      fontFamily="serif"
      letterSpacing="-1"
      filter="url(#tailsGlow)"
    >
      100
    </text>

    {/* Center Title Badge */}
    <rect x="48" y="104" width="64" height="15" rx="7.5" fill="#451a03" opacity="0.9" />
    <text
      x="80"
      y="115"
      textAnchor="middle"
      fill="#fef08a"
      fontSize="10"
      fontWeight="900"
      letterSpacing="1.5"
      fontFamily="sans-serif"
    >
      РЕШКА
    </text>

    {/* Bottom Inscription */}
    <text
      x="80"
      y="134"
      textAnchor="middle"
      fill="#78350f"
      fontSize="7.5"
      fontWeight="900"
      letterSpacing="1.2"
      fontFamily="sans-serif"
    >
      LUCKY COIN
    </text>
  </svg>
);

export const CoinflipGame: React.FC<CoinflipGameProps> = ({
  userId,
  balance,
  onBalanceChange,
  onOpenFairness,
}) => {
  const [betAmount, setBetAmount] = useState<number>(1.0);
  const [chosenSide, setChosenSide] = useState<'heads' | 'tails'>('heads');

  // Smooth Animation and Game States
  const [isFlipping, setIsFlipping] = useState<boolean>(false);
  const [currentSide, setCurrentSide] = useState<'heads' | 'tails'>('heads');
  const [flipRotation, setFlipRotation] = useState<number>(0);
  const currentRotationRef = useRef<number>(0);
  const animationTimerRef = useRef<any>(null);

  const [lastWinInfo, setLastWinInfo] = useState<{
    amount: number;
    won: boolean;
    side: 'heads' | 'tails';
  } | null>(null);
  const [history, setHistory] = useState<Array<'heads' | 'tails'>>([
    'heads',
    'tails',
    'heads',
    'heads',
    'tails',
  ]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fairnessData, setFairnessData] = useState<any>(null);

  const handleFlip = async () => {
    if (isFlipping) return;
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
    playCoinTossSound();
    triggerHaptic('medium');
    setIsFlipping(true);
    setErrorMsg(null);
    setLastWinInfo(null);

    // Call server endpoint
    try {
      const res = await fetch('/api/coinflip/flip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          betAmount: cleanBet,
          chosenSide,
        }),
      });

      const data = await res.json();
      if (!data.ok) {
        setIsFlipping(false);
        setErrorMsg(data.error || 'Ошибка подброса монеты');
        return;
      }

      // Calculate smooth forward landing rotation (NO rewind, NO snapping)
      // 5 full turns (1800deg) + alignment to target face
      const curAngle = currentRotationRef.current;
      const minExtraTurns = 1800; // 5 full 360-degree spins
      const baseCandidate = curAngle + minExtraTurns;

      let targetAngle: number;
      if (data.resultSide === 'heads') {
        // Heads is 0 mod 360
        targetAngle = Math.ceil(baseCandidate / 360) * 360;
      } else {
        // Tails is 180 mod 360
        targetAngle = Math.ceil((baseCandidate - 180) / 360) * 360 + 180;
      }

      // Start buttery smooth forward rotation and toss
      setFlipRotation(targetAngle);
      currentRotationRef.current = targetAngle;

      // The animation duration is exactly 2000ms
      // Schedule metallic landing clink slightly before completion (t = 1800ms)
      setTimeout(() => {
        playCoinLandSound();
      }, 1780);

      // Finish toss cleanly at 2000ms
      if (animationTimerRef.current) clearTimeout(animationTimerRef.current);
      animationTimerRef.current = setTimeout(() => {
        setCurrentSide(data.resultSide);
        setIsFlipping(false);
        setFairnessData(data.fairness);
        onBalanceChange(data.balance);

        setHistory((prev) => [data.resultSide, ...prev.slice(0, 14)]);
        setLastWinInfo({ amount: data.winAmount, won: data.won, side: data.resultSide });

        if (data.won) {
          playCashoutSound();
          triggerHaptic('success');
          confetti({
            particleCount: 60,
            spread: 60,
            origin: { y: 0.62 },
          });
        } else {
          triggerHaptic('error');
        }
      }, 2000);
    } catch {
      setIsFlipping(false);
      setErrorMsg('Ошибка связи с сервером');
    }
  };

  return (
    <div className="max-w-xl mx-auto px-3.5 py-4 space-y-4">
      {/* 1. Header Banner & Fairness */}
      <div className="bg-[#121826] border border-slate-800 rounded-3xl p-3.5 shadow-xl flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-400 via-yellow-500 to-amber-600 flex items-center justify-center text-slate-950 shadow-lg shadow-amber-500/20 border border-amber-300">
            <CoinHeadsFace size={24} />
          </div>
          <div>
            <h2 className="text-base font-black text-white leading-tight">
              ОРЁЛ И РЕШКА
            </h2>
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

      {/* 2. History Ribbon (Clean Vector Coins, No Broken Emojis) */}
      <div className="bg-[#0f1422] border border-slate-800 rounded-2xl p-2.5 shadow-md flex items-center gap-2">
        <span className="text-slate-400 font-bold text-[11px] flex-shrink-0 flex items-center gap-1 pl-0.5">
          <History size={12} className="text-amber-400" />
          <span>Раунды:</span>
        </span>
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-2 px-1 flex-1">
          {history.map((side, idx) => {
            const isLatest = idx === 0;
            return (
              <div
                key={idx}
                className={`px-2.5 py-1.5 rounded-lg border font-black text-[11px] flex items-center gap-1.5 flex-shrink-0 shadow-sm transition-all ${
                  side === 'heads'
                    ? 'bg-amber-500/15 border-amber-500/50 text-amber-300'
                    : 'bg-yellow-500/15 border-yellow-500/50 text-yellow-300'
                } ${
                  isLatest
                    ? 'ring-2 ring-amber-400 shadow-md shadow-amber-500/30 scale-105 mx-1 bg-amber-500/25 border-amber-300'
                    : 'opacity-85'
                }`}
              >
                {side === 'heads' ? (
                  <>
                    <CoinHeadsFace size={15} />
                    <span>Орёл</span>
                  </>
                ) : (
                  <>
                    <CoinTailsFace size={15} />
                    <span>Решка</span>
                  </>
                )}
                {isLatest && (
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse ml-0.5" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. 3D COIN ARENA WITH EMBOSSED "SPINDBET" MODEL (SPINS IN PLACE) */}
      <div className="relative bg-gradient-to-b from-[#111728] via-[#0d121f] to-[#090d16] border-2 border-slate-800 rounded-3xl p-6 shadow-2xl flex flex-col items-center justify-center min-h-[300px] overflow-hidden">
        {/* 3D Coin Flipping Container (STATIONARY ON THE SPOT, DOES NOT RISE UP) */}
        <div
          style={{
            transform: 'translateY(0px)',
            perspective: '1200px',
          }}
          className="w-40 h-40 my-3 relative flex items-center justify-center will-change-transform"
        >
          {/* Rotating Coin Core (Smooth in-place spin on spot) */}
          <div
            style={{
              transform: `rotateY(${flipRotation}deg)`,
              transformStyle: 'preserve-3d',
              transition: isFlipping
                ? 'transform 2s cubic-bezier(0.2, 0.85, 0.25, 1)'
                : 'transform 0.4s ease-out',
            }}
            className="w-full h-full relative will-change-transform"
          >
            {/* FRONT FACE: HEADS / ОРЁЛ WITH "SPINDBET" */}
            <div
              style={{
                backfaceVisibility: 'hidden',
                WebkitBackfaceVisibility: 'hidden',
              }}
              className="absolute inset-0 rounded-full flex items-center justify-center drop-shadow-[0_4px_20px_rgba(245,158,11,0.5)]"
            >
              <CoinHeadsFace size={160} />
            </div>

            {/* BACK FACE: TAILS / РЕШКА WITH "SPINDBET" */}
            <div
              style={{
                transform: 'rotateY(180deg)',
                backfaceVisibility: 'hidden',
                WebkitBackfaceVisibility: 'hidden',
              }}
              className="absolute inset-0 rounded-full flex items-center justify-center drop-shadow-[0_4px_20px_rgba(245,158,11,0.5)]"
            >
              <CoinTailsFace size={160} />
            </div>
          </div>
        </div>

        {/* Outcome Display */}
        <div className="mt-3 text-center min-h-[30px] flex items-center justify-center">
          {isFlipping ? (
            <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5 animate-pulse">
              <Sparkles size={14} className="animate-spin" />
              <span>Монетка в воздухе...</span>
            </div>
          ) : lastWinInfo ? (
            <div
              className={`px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-wider inline-flex items-center gap-1.5 shadow-md ${
                lastWinInfo.won
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 animate-in zoom-in-95'
                  : 'bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-in zoom-in-95'
              }`}
            >
              {lastWinInfo.won ? (
                <>
                  <span>🎉</span>
                  <span>Победа +${lastWinInfo.amount.toFixed(2)}!</span>
                </>
              ) : (
                <>
                  <span>Выпало: {lastWinInfo.side === 'heads' ? 'Орёл' : 'Решка'}</span>
                </>
              )}
            </div>
          ) : (
            <span className="text-xs font-bold text-slate-400">
              Текущая сторона:{' '}
              <b className="text-amber-300 text-sm">
                {currentSide === 'heads' ? 'Орёл' : 'Решка'}
              </b>
            </span>
          )}
        </div>
      </div>

      {/* 4. ERROR ALERT */}
      {errorMsg && (
        <div className="p-3 rounded-xl bg-red-950/80 border border-red-500/50 text-red-200 text-xs font-bold flex items-center justify-between">
          <span>{errorMsg}</span>
          <button
            onClick={() => setErrorMsg(null)}
            className="text-red-400 hover:text-white ml-2 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* 5. GORGEOUS OUTCOME SELECTION & BETTING CONTROLS */}
      <div className="bg-[#121826] border border-slate-800 rounded-3xl p-4 shadow-xl space-y-4">
        {/* Choice: Heads or Tails (Luxury Styled Casino Buttons) */}
        <div>
          <div className="flex items-center justify-between text-xs font-bold text-slate-400 mb-2 px-0.5">
            <span>Выберите исход раунда:</span>
            <span className="text-amber-400 font-extrabold">Коэффициент x1.96</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* ОРЁЛ BUTTON */}
            <button
              disabled={isFlipping}
              onClick={() => {
                triggerHaptic('selection');
                playClickSound();
                setChosenSide('heads');
              }}
              className={`p-3.5 rounded-2xl flex items-center justify-between border-2 transition-all cursor-pointer relative overflow-hidden group ${
                chosenSide === 'heads'
                  ? 'bg-gradient-to-br from-amber-500/25 via-amber-600/20 to-yellow-600/30 border-amber-400 text-white shadow-xl shadow-amber-500/20 scale-[1.02]'
                  : 'bg-slate-850/80 hover:bg-slate-800 text-slate-300 border-slate-700/80 hover:border-slate-600'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center p-0.5 transition-transform group-hover:scale-110 ${
                    chosenSide === 'heads'
                      ? 'bg-amber-400/20 border border-amber-300/60 shadow-md'
                      : 'bg-slate-800 border border-slate-700'
                  }`}
                >
                  <CoinHeadsFace size={30} />
                </div>
                <div className="text-left">
                  <div className="font-black text-sm text-white tracking-wide">ОРЁЛ</div>
                  <div className="text-[10px] font-bold text-amber-400/90">Выплата x1.96</div>
                </div>
              </div>

              {/* Active Selection Indicator */}
              <div
                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                  chosenSide === 'heads'
                    ? 'border-amber-400 bg-amber-400 text-slate-950'
                    : 'border-slate-600 bg-transparent'
                }`}
              >
                {chosenSide === 'heads' && <CheckCircle2 size={13} className="stroke-[3]" />}
              </div>
            </button>

            {/* РЕШКА BUTTON (GORGEOUS, VECTOR EMBLEM, NO BROKEN EMOJI) */}
            <button
              disabled={isFlipping}
              onClick={() => {
                triggerHaptic('selection');
                playClickSound();
                setChosenSide('tails');
              }}
              className={`p-3.5 rounded-2xl flex items-center justify-between border-2 transition-all cursor-pointer relative overflow-hidden group ${
                chosenSide === 'tails'
                  ? 'bg-gradient-to-br from-amber-500/25 via-amber-600/20 to-yellow-600/30 border-amber-400 text-white shadow-xl shadow-amber-500/20 scale-[1.02]'
                  : 'bg-slate-850/80 hover:bg-slate-800 text-slate-300 border-slate-700/80 hover:border-slate-600'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center p-0.5 transition-transform group-hover:scale-110 ${
                    chosenSide === 'tails'
                      ? 'bg-amber-400/20 border border-amber-300/60 shadow-md'
                      : 'bg-slate-800 border border-slate-700'
                  }`}
                >
                  <CoinTailsFace size={30} />
                </div>
                <div className="text-left">
                  <div className="font-black text-sm text-white tracking-wide">РЕШКА</div>
                  <div className="text-[10px] font-bold text-amber-400/90">Выплата x1.96</div>
                </div>
              </div>

              {/* Active Selection Indicator */}
              <div
                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                  chosenSide === 'tails'
                    ? 'border-amber-400 bg-amber-400 text-slate-950'
                    : 'border-slate-600 bg-transparent'
                }`}
              >
                {chosenSide === 'tails' && <CheckCircle2 size={13} className="stroke-[3]" />}
              </div>
            </button>
          </div>
        </div>

        {/* Bet Input */}
        <div>
          <div className="flex items-center justify-between text-xs mb-1.5 px-0.5">
            <span className="font-bold text-slate-300">Сумма ставки ($):</span>
            <span className="text-slate-400 text-[11px]">
              Баланс: <b className="text-white">${balance.toFixed(2)}</b>
            </span>
          </div>

          <div className="relative flex items-center">
            <span className="absolute left-3.5 text-amber-400 font-black text-base">$</span>
            <input
              disabled={isFlipping}
              type="number"
              step="0.01"
              min="0.01"
              max="500"
              value={betAmount || ''}
              onChange={(e) => setBetAmount(parseFloat(e.target.value) || 0)}
              className="w-full bg-slate-900 border border-slate-700/80 rounded-2xl py-3 pl-8 pr-3 text-white font-black text-base focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all shadow-inner"
            />
          </div>

          {/* Quick Bet Buttons */}
          <div className="flex gap-1.5 mt-2.5 overflow-x-auto no-scrollbar py-0.5">
            {QUICK_BETS.map((chip) => (
              <button
                key={chip}
                disabled={isFlipping}
                onClick={() => {
                  triggerHaptic('selection');
                  playClickSound();
                  setBetAmount(chip);
                }}
                className={`flex-1 py-1.5 px-1 rounded-xl text-xs font-black transition-all cursor-pointer ${
                  betAmount === chip
                    ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/30 scale-105'
                    : 'bg-slate-800/80 hover:bg-slate-750 text-slate-300 border border-slate-700/60'
                }`}
              >
                ${chip >= 1 ? chip : chip.toFixed(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Primary Flip Action Button */}
        <button
          disabled={isFlipping || betAmount <= 0}
          onClick={handleFlip}
          className={`w-full py-4 px-4 rounded-2xl font-black text-base uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-xl cursor-pointer ${
            isFlipping
              ? 'bg-slate-800 text-slate-400 border border-slate-700 cursor-not-allowed'
              : 'bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-500 hover:from-amber-400 hover:to-yellow-300 text-slate-950 shadow-amber-500/25 active:scale-[0.99]'
          }`}
        >
          {isFlipping ? (
            <div className="flex items-center gap-2">
              <Sparkles size={18} className="animate-spin text-amber-400" />
              <span>Подбрасываем монетку...</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Sparkles size={18} />
              <span>
                Подбросить на {chosenSide === 'heads' ? 'Орла' : 'Решку'} ($
                {betAmount.toFixed(2)})
              </span>
            </div>
          )}
        </button>
      </div>
    </div>
  );
};
