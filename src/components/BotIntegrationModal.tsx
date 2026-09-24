import React, { useState } from 'react';
import { X, Copy, Check, Send, Terminal, Bot, ExternalLink, ShieldCheck } from 'lucide-react';
import { triggerHaptic } from '../utils/telegram.ts';

interface BotIntegrationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const BotIntegrationModal: React.FC<BotIntegrationModalProps> = ({ isOpen, onClose }) => {
  const [copiedCode1, setCopiedCode1] = useState(false);
  const [copiedCode2, setCopiedCode2] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  if (!isOpen) return null;

  const currentAppUrl = typeof window !== 'undefined' ? window.location.origin : 'https://your-mini-app-url.com';

  const aiogramCode = `# 1. В main.py вашего бота добавьте WebAppInfo:
from aiogram.types import WebAppInfo, InlineKeyboardButton

# 2. В функции get_games_menu() или get_main_menu():
# Замените или добавьте кнопку запуска Mini App:
def get_games_menu():
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(
            text="💣 Mines (Mini App)", 
            web_app=WebAppInfo(url="${currentAppUrl}")
        )],
        [InlineKeyboardButton(text="🎲 Dice", callback_data="game_dice")],
        [InlineKeyboardButton(text="🏀 Баскетбол", callback_data="game_basketball")],
        # ... остальные игры
    ])`;

  const menuButtonCode = `# Или настройте кнопку меню Telegram WebApp при /start:
from aiogram.types import MenuButtonWebApp, WebAppInfo

await bot.set_chat_menu_button(
    chat_id=message.chat.id,
    menu_button=MenuButtonWebApp(
        text="🎰 SpindBet App",
        web_app=WebAppInfo(url="${currentAppUrl}")
    )
)`;

  const handleCopy = (text: string, setter: (val: boolean) => void) => {
    triggerHaptic('light');
    navigator.clipboard.writeText(text);
    setter(true);
    setTimeout(() => setter(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 animate-in fade-in duration-200">
      <div className="bg-[#121826] border border-slate-700 rounded-3xl w-full max-w-lg p-5 shadow-2xl relative max-h-[90vh] overflow-y-auto no-scrollbar space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold">
              <Bot size={18} />
            </div>
            <div>
              <h3 className="text-base font-black text-white leading-tight">Подключение к Telegram боту</h3>
              <p className="text-[11px] text-slate-400">Связка Mini App с @SPIND_BET_BOT</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Current URL Box */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 space-y-1.5">
          <span className="text-[11px] font-bold text-slate-400">URL вашего Mini App:</span>
          <div className="flex items-center justify-between bg-slate-950 p-2 rounded-xl border border-slate-800 text-xs font-mono text-amber-400">
            <span className="truncate mr-2">{currentAppUrl}</span>
            <button
              onClick={() => handleCopy(currentAppUrl, setCopiedUrl)}
              className="flex-shrink-0 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-sans font-bold flex items-center gap-1"
            >
              {copiedUrl ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
              <span>{copiedUrl ? 'Скопировано' : 'Копировать'}</span>
            </button>
          </div>
        </div>

        {/* Step 1: In Bot Code */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-slate-200">
            <span className="flex items-center gap-1.5">
              <Terminal size={14} className="text-amber-400" />
              <span>Способ 1: Кнопка в меню бота (main.py)</span>
            </span>
            <button
              onClick={() => handleCopy(aiogramCode, setCopiedCode1)}
              className="text-amber-400 hover:underline flex items-center gap-1 text-[11px]"
            >
              {copiedCode1 ? <Check size={12} /> : <Copy size={12} />}
              <span>{copiedCode1 ? 'Скопировано!' : 'Копировать код'}</span>
            </button>
          </div>
          <pre className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-[11px] font-mono text-slate-300 overflow-x-auto leading-relaxed">
            {aiogramCode}
          </pre>
        </div>

        {/* Step 2: Menu Button */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-slate-200">
            <span className="flex items-center gap-1.5">
              <Send size={14} className="text-blue-400" />
              <span>Способ 2: Главная кнопка Menu Button</span>
            </span>
            <button
              onClick={() => handleCopy(menuButtonCode, setCopiedCode2)}
              className="text-amber-400 hover:underline flex items-center gap-1 text-[11px]"
            >
              {copiedCode2 ? <Check size={12} /> : <Copy size={12} />}
              <span>{copiedCode2 ? 'Скопировано!' : 'Копировать код'}</span>
            </button>
          </div>
          <pre className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-[11px] font-mono text-slate-300 overflow-x-auto leading-relaxed">
            {menuButtonCode}
          </pre>
        </div>

        {/* Step 3: BotFather */}
        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-xs space-y-1">
          <div className="font-bold text-amber-400 flex items-center gap-1.5">
            <ShieldCheck size={14} />
            <span>Настройка через @BotFather:</span>
          </div>
          <p className="text-[11px] text-slate-300 leading-relaxed">
            1. Откройте <b className="text-white">@BotFather</b> в Telegram.
            <br />
            2. Напишите <code className="text-amber-300">/newapp</code> или <code className="text-amber-300">/setmenubutton</code>.
            <br />
            3. Выберите вашего бота <b className="text-white">@SPIND_BET_BOT</b>.
            <br />
            4. Вставьте ссылку на этот Mini App: <code className="text-amber-300">{currentAppUrl}</code>.
          </p>
        </div>
      </div>
    </div>
  );
};
