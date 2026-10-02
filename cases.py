import random
import logging
import asyncio
import aiohttp
from typing import Optional, Dict, Any, Tuple
from aiogram import Bot
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
from config import CASE_PRICE_STARS, CASE_ITEMS, PROJECT_NAME, TELEGRAM_BOT_TOKEN

# Комментарии для подарков
WIN_COMMENTS = [
    f"🎉 Поздравляем с победой в {PROJECT_NAME}!",
    f"✨ Джекпот от {PROJECT_NAME}!",
    f"🍀 Удача улыбнулась тебе в {PROJECT_NAME}!",
    f"🎁 Выигрыш в {PROJECT_NAME}!",
    f"💎 Редкий выигрыш от {PROJECT_NAME}!",
    f"🔥 {PROJECT_NAME} дарит тебе подарок!",
    f"🌟 Счастливый билет от {PROJECT_NAME}!",
    f"🎯 Приз от {PROJECT_NAME}!",
    f"💰 Крупный выигрыш в {PROJECT_NAME}!",
    f"🏆 Чемпион! {PROJECT_NAME} поздравляет!"
]

class CasesGame:
    def __init__(self, bot: Bot):
        self.bot = bot
        self.price = CASE_PRICE_STARS
        self.items = CASE_ITEMS
        self.token = TELEGRAM_BOT_TOKEN
        
    def get_case_price(self) -> int:
        return self.price
    
    def open_case(self) -> Dict[str, Any]:
        items = self.items
        chances = [item["chance"] for item in items]
        result = random.choices(items, weights=chances, k=1)[0]
        
        return {
            "item_id": result["id"],
            "name": result["name"],
            "emoji": result["emoji"],
            "gift_id": result.get("gift_id"),
            "value_stars": result["value_stars"],
            "is_empty": result["id"] == "empty"
        }
    
    def get_random_comment(self) -> str:
        return random.choice(WIN_COMMENTS)
    
    async def send_gift(self, user_id: int, gift_id: str, comment: str = None) -> Tuple[bool, str]:
        """
        РЕАЛЬНАЯ отправка подарка через HTTP API Telegram
        Работает в любой версии aiogram!
        """
        try:
            # Проверяем что gift_id настроен
            if not gift_id or gift_id.startswith("YOUR_") or gift_id == "None":
                return False, "Gift ID не настроен в конфиге"
            
            # Генерируем комментарий
            if not comment:
                comment = self.get_random_comment()
            
            # ПРЯМОЙ HTTP ЗАПРОС К API TELEGRAM
            url = f"https://api.telegram.org/bot{self.token}/sendGift"
            
            payload = {
                "user_id": user_id,
                "gift_id": gift_id,
                "text": comment
            }
            
            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=payload) as response:
                    data = await response.json()
                    
                    if data.get("ok"):
                        logging.info(f"✅ Подарок отправлен пользователю {user_id}, gift_id: {gift_id}")
                        return True, comment
                    else:
                        error = data.get("description", "Unknown error")
                        logging.error(f"❌ API Error: {error}")
                        return False, f"API Error: {error}"
                        
        except Exception as e:
            error_msg = str(e)
            logging.error(f"❌ Ошибка отправки подарка: {error_msg}")
            return False, error_msg
    
    def get_case_menu_keyboard(self) -> InlineKeyboardMarkup:
        return InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text=f"🎁 Открыть кейс ({self.price}⭐)", callback_data="case_open")],
            [InlineKeyboardButton(text="🎒 История", callback_data="case_inventory")],
            [InlineKeyboardButton(text="🔙 Назад в меню", callback_data="menu_games")]
        ])
    
    def get_result_keyboard(self, is_empty: bool) -> InlineKeyboardMarkup:
        return InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text=f"🎁 Открыть еще ({self.price}⭐)", callback_data="case_open")],
            [InlineKeyboardButton(text="🔙 Назад", callback_data="menu_cases")]
        ])
    
    def get_odds_text(self) -> str:
        text = "📊 <b>Шансы выпадения:</b>\n\n"
        for item in self.items:
            if item["id"] == "empty":
                continue
            bar_length = max(1, int(item["chance"] * 10))
            bar = "█" * bar_length + "░" * (20 - bar_length)
            rarity = "💎" if item["chance"] <= 1 else "🥈"
            text += f"{rarity} {item['emoji']} <b>{item['name']}</b>: <code>{item['chance']}%</code>\n"
            text += f"<code>{bar}</code>\n\n"
        
        text += f"\n❌ <b>Пусто</b>: <code>97.5%</code>\n"
        text += f"<i>Кейс окупается только при выпадении Мишки или Кольца!</i>"
        return text

def get_cases_menu_text() -> str:
    return f"""
🎁 <b>Кейсы с подарками</b>

<blockquote>├ Цена кейса: <b>{CASE_PRICE_STARS} ⭐</b>
└ Оплата через Telegram Stars</blockquote>

<b>🎯 Может выпасть:</b>
💍 Кольцо (100⭐)
🧸 Мишка (15⭐)
❤️ Сердце (15⭐)
❌ Пусто 

<i>Нажмите кнопку ниже для оплаты и открытия кейса...</i>
"""

async def simulate_opening_animation(bot, chat_id: int, message_id: Optional[int] = None):
    frames = [
        "🎁 <b>Открываем кейс...</b>",
        "✨ <b>Удача на вашей стороне?</b> ✨", 
        "🎲 <b>Разыгрываем приз...</b> 🎲",
        "💎 <b>Проверяем результат...</b> 💎"
    ]
    
    final_message_id = message_id
    
    for text in frames:
        try:
            if final_message_id:
                await bot.edit_message_text(
                    chat_id=chat_id,
                    message_id=final_message_id,
                    text=text,
                    parse_mode="HTML"
                )
            else:
                msg = await bot.send_message(chat_id, text, parse_mode="HTML")
                final_message_id = msg.message_id
            
            await asyncio.sleep(0.8)
        except Exception as e:
            logging.error(f"Animation error: {e}")
            break
    
    return final_message_id