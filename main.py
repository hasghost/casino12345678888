import sqlite3
import asyncio
import logging
import random
import json
import os
import time
from datetime import datetime
from aiogram import Bot, Dispatcher, types, F, BaseMiddleware
from aiogram.filters import Command
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, FSInputFile,LabeledPrice, PreCheckoutQuery
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.context import FSMContext
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types.error_event import ErrorEvent
from cases import CasesGame, get_cases_menu_text, simulate_opening_animation
from leaderboard import get_top_players, format_leaderboard
from duels import register_duel_handlers

from config import *
from database import *
from fairness import *
from payment import *

class DepositStates(StatesGroup):
    waiting_amount = State()

class DepositStarsStates(StatesGroup):
    waiting_amount = State()

class WithdrawStates(StatesGroup):
    waiting_amount = State()

class PromoStates(StatesGroup):
    waiting_code = State()

class SubscribeStates(StatesGroup):
    waiting_subscription = State()

class AdminStates(StatesGroup):
    waiting_promo_code = State()
    waiting_promo_amount = State()
    waiting_promo_uses = State()
    waiting_user_id = State()
    waiting_user_amount = State()
    waiting_broadcast_content = State()      # Ожидание контента (текст/медиа)
    waiting_broadcast_caption = State()      # Ожидание подписи (если нужно)
    waiting_broadcast_button_text = State()  # Текст кнопки
    waiting_broadcast_button_url = State()   # URL кнопки
    waiting_broadcast_preview = State()      # Предпросмотр
    waiting_broadcast_confirm = State()
    waiting_partner_add = State()
    waiting_partner_manage_id = State()
    waiting_partner_freeze_reason = State()
    waiting_check_delete_confirm = State()
    check_page_index = State() 

class AdminGiftStates(StatesGroup):
    waiting_for_user_id = State()
    waiting_for_gift_id = State()
    waiting_for_comment = State()

class AdminNFTStates(StatesGroup):
    waiting_user_id = State()
    waiting_amount = State()
    waiting_confirm = State()

class AdminRaffleStates(StatesGroup):
    waiting_nft_link = State()
    waiting_duration = State()

class DiceStates(StatesGroup):
    waiting_bet_type = State()
    waiting_bet_value = State()
    waiting_amount = State()

class MinesStates(StatesGroup):
    waiting_bet_amount = State()
    playing = State()

class BasketballStates(StatesGroup):
    waiting_amount = State()
    waiting_choice = State()

class HeartsStates(StatesGroup):
    waiting_amount = State()
    waiting_color = State()

class RussianRouletteStates(StatesGroup):
    waiting_amount = State()
    waiting_bullets = State()

class CaseStates(StatesGroup):
    waiting_payment = State()

class RouletteStates(StatesGroup):
    waiting_amount = State()
    waiting_number = State()

class BoxesStates(StatesGroup):
    waiting_bet_amount = State()

class RPSStates(StatesGroup):
    waiting_amount = State()

class CoinflipStates(StatesGroup):
    waiting_amount = State()

class RainbowStates(StatesGroup):
    waiting_amount = State()

class X3States(StatesGroup):
    waiting_amount = State()
    
class X5States(StatesGroup):
    waiting_amount = State()
    
class X10States(StatesGroup):
    waiting_amount = State()
    
class X20States(StatesGroup):
    waiting_amount = State()
    
class X30States(StatesGroup):
    waiting_amount = State()
    
class X50States(StatesGroup):
    waiting_amount = State()
    
class X100States(StatesGroup):
    waiting_amount = State()

logging.basicConfig(level=logging.INFO)
bot = Bot(token=TELEGRAM_BOT_TOKEN)
dp = Dispatcher(storage=MemoryStorage())
cases_game = CasesGame(bot)
dp["bot"] = bot
register_duel_handlers(dp)

# ============================================================
# ===== MIDDLEWARE: БЛОКИРОВКА ЗАБАНЕННЫХ =====
# ============================================================

class BannedMiddleware(BaseMiddleware):
    async def __call__(self, handler, event, data):
        user_id = None
        
        if isinstance(event, types.CallbackQuery):
            user_id = event.from_user.id
            if is_user_banned(user_id):
                await event.answer("❌ Вы заблокированы в боте", show_alert=True)
                return None
                
        elif isinstance(event, types.Message):
            # Игнорируем сообщения в группах (чат-активность обрабатывается отдельно)
            if event.chat.type == "private":
                user_id = event.from_user.id
                if is_user_banned(user_id):
                    await event.answer("❌ <b>Вы заблокированы в боте</b>", parse_mode="HTML")
                    return None
        
        # Пользователь не забанен — пропускаем дальше
        return await handler(event, data)

# Регистрируем ПЕРЕД всеми хендлерами (outer_middleware = до фильтров)
dp.callback_query.outer_middleware(BannedMiddleware())
dp.message.outer_middleware(BannedMiddleware())


async def check_subscriptions(user_id: int):
    """Проверить подписки на канал и чат"""
    try:
        # Проверка подписки на канал новостей
        channel_member = await bot.get_chat_member(
            chat_id=NEWS_CHANNEL_ID, 
            user_id=user_id
        )
        is_subscribed_channel = channel_member.status in ["member", "administrator", "creator"]
        
        # Проверка подписки на чат
        chat_member = await bot.get_chat_member(
            chat_id=CHAT_ID, 
            user_id=user_id
        )
        is_subscribed_chat = chat_member.status in ["member", "administrator", "creator"]
        
        return is_subscribed_channel and is_subscribed_chat
        
    except Exception as e:
        logging.error(f"Subscription check error: {e}")
        return False

# ДепRECATED: старая функция для совместимости
async def check_subscription(user_id: int):
    """Старая функция (удалить после полной замены)"""
    return await check_subscriptions(user_id)

async def delete_previous_messages(call: types.CallbackQuery, count: int = 5):
    """Удаляет предыдущие сообщения бота в чате"""
    try:
        for i in range(count):
            try:
                await bot.delete_message(call.message.chat.id, call.message.message_id - i)
            except:
                pass
    except:
        pass

async def navigate_check(call: types.CallbackQuery, state: FSMContext, direction: int):
    """Навигация по чекам: -1 для предыдущего, +1 для следующего"""
    try:
        if not is_admin(call.from_user.id):
            await call.answer("❌ Доступ запрещен", show_alert=True)
            return
        
        data = await state.get_data()
        page_index = data.get("check_page_index", 0)
        checks = data.get("checks_list", [])
        
        if not isinstance(checks, list) or not checks:
            await call.answer("❌ Список чеков пуст", show_alert=True)
            return
        
        # Вычисляем новый индекс
        new_index = page_index + direction
        new_index = max(0, min(new_index, len(checks) - 1))
        
        # Если индекс не изменился, показываем сообщение
        if new_index == page_index:
            border = "начале" if direction == -1 else "конце"
            await call.answer(f"📍 Вы в {border} списка", show_alert=True)
            return
        
        await show_check_page(call, checks, new_index, state)
        
    except Exception as e:
        logging.error(f"Error in navigate_check: {e}", exc_info=True)
        await call.answer("❌ Ошибка навигации", show_alert=True)

async def notify_admin(message_text: str):
    """Отправить уведомление в админ-группу"""
    try:
        if ADMIN_GROUP_ID:
            await bot.send_message(
                chat_id=ADMIN_GROUP_ID,
                text=message_text,
                parse_mode="HTML"
            )
    except Exception as e:
        logging.error(f"Failed to send admin notification: {e}")

async def notify_game_result(username: str, user_id: int, game_name: str, bet_amount: float, win: bool, win_amount: float = 0):
    """Отправить уведомление о результате игры в админ-группу"""
    try:
        if ADMIN_GROUP_ID:
            if win:
                outcome_text = f'<tg-emoji emoji-id="5424792515188397051">🎉</tg-emoji> Выигрыш: +${win_amount:.2f}'
                profit_text = f"Прибыль: +{win_amount - bet_amount:.2f}"
            else:
                outcome_text = f'<tg-emoji emoji-id="5427125073272147164">💥</tg-emoji> Проигрыш: -{bet_amount:.2f}'
                profit_text = f"Убыток: -{bet_amount:.2f}"
            
            message_text = f"""
<tg-emoji emoji-id="5426842047812240711">🔥</tg-emoji> <b>Новая ставка</b>

<blockquote>├ Игра: <b>{game_name}</b>
├ Игрок: @{username or 'скрыт'}
├ Ставка: <b>${bet_amount:.2f}</b>
└ {outcome_text}</blockquote>

<i><tg-emoji emoji-id="5426995996619999058">📊</tg-emoji> {profit_text}<tg-emoji emoji-id="5426913374334122021">💸</tg-emoji></i>
            """
            
            await bot.send_message(
                chat_id=ADMIN_GROUP_ID,
                text=message_text,
                parse_mode="HTML"
            )
    except Exception as e:
        logging.error(f"Failed to send game result notification: {e}")

def get_back_to_main_button():
    return InlineKeyboardButton.model_construct(
        text="Назад в меню",
        callback_data="menu_main_full",
        icon_custom_emoji_id="5875082500023258804"
    )


def get_back_to_profile_button():
    return InlineKeyboardButton.model_construct(
        text="Назад в профиль",
        callback_data="menu_profile",
        icon_custom_emoji_id="5875082500023258804"
    )

def get_main_menu(is_admin=False, is_partner=False):
    keyboard = [
        [
            InlineKeyboardButton.model_construct(
                text="Игры",
                callback_data="menu_games",
                icon_custom_emoji_id="5258508428212445001"
            )
        ],
        [
            InlineKeyboardButton.model_construct(
                text="Профиль",
                callback_data="menu_profile",
                icon_custom_emoji_id="5260399854500191689"
            )
        ],
        [
            InlineKeyboardButton.model_construct(
                text="Рефералы",
                callback_data="menu_referrals",
                icon_custom_emoji_id="5258362837411045098"
            )
        ],
        [
            InlineKeyboardButton.model_construct(
                text="О проекте",
                callback_data="menu_about",
                icon_custom_emoji_id="5258474669769497337"
            )
        ]
    ]

    if is_partner:
        keyboard.append([
            InlineKeyboardButton.model_construct(
                text="Партнёрская панель",
                callback_data="partner_panel",
                icon_custom_emoji_id="5427047789630619730"  # можно заменить на любой
            )
        ])

    if is_admin:
        keyboard.append([
            InlineKeyboardButton.model_construct(
                text="Админ-панель",
                callback_data="admin_panel",
                icon_custom_emoji_id="5258096772776991776"
            )
        ])

    return InlineKeyboardMarkup(inline_keyboard=keyboard)

def get_games_menu():
    """Меню выбора игры"""
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🎲 Dice", callback_data="game_dice")],
        [InlineKeyboardButton(text="🏀 Баскетбол", callback_data="game_basketball")], 
        [InlineKeyboardButton(text="💣 Mines", callback_data="game_mines")],
        [InlineKeyboardButton(text="🎰 Рулетка", callback_data="game_roulette")],
        [InlineKeyboardButton(text="📦 Сундучки ", callback_data="game_boxes")],
        [InlineKeyboardButton(text="✊ КНБ", callback_data="game_rps")],
        [InlineKeyboardButton(text="🪙 Монетка", callback_data="game_coinflip")],
        [InlineKeyboardButton(text="❤️ Сердца", callback_data="game_hearts")],
        [InlineKeyboardButton(text="🔫 Русская рулетка", callback_data="game_russian_roulette")],
        [InlineKeyboardButton(text="🎁 Кейсы", callback_data="menu_cases")],
        [get_back_to_main_button()]
    ])

def get_admin_menu():
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="📊 Статистика бота", callback_data="admin_stats")],
        [InlineKeyboardButton(text="📋 Управление чеками", callback_data="admin_checks")],
        [InlineKeyboardButton(text="➕ Создать промокод", callback_data="admin_create_promo")],
        [InlineKeyboardButton(text="🎟 Розыгрыши", callback_data="admin_raffles")],
        [InlineKeyboardButton(text="🔍 Поиск пользователя", callback_data="admin_find_user")],
        [InlineKeyboardButton(text="📢 Рассылка", callback_data="admin_broadcast")],
        [InlineKeyboardButton(text="🤝 Управление партнерами", callback_data="admin_partners")],
        [InlineKeyboardButton(text="🎁 Отправить подарок", callback_data="admin_gift")],
        [InlineKeyboardButton(text="💬 Статистика чата", callback_data="admin_chat_activity")],
        [InlineKeyboardButton(text="🎁 NFT Пополнение", callback_data="admin_nft_deposit")],  
        [get_back_to_main_button()]
    ])

def get_user_management_menu(user_id: int):
    """Меню управления конкретным пользователем (динамические кнопки)"""
    user = get_user(user_id)
    is_banned = user[8] if user and len(user) > 8 else 0
    is_chat_off = is_chat_activity_disabled(user_id)

    # Динамические подписи в зависимости от статуса
    ban_btn = InlineKeyboardButton(
        text="🔓 Разблокировать" if is_banned else "🔒 Заблокировать",
        callback_data=f"admin_user_unban_{user_id}" if is_banned else f"admin_user_ban_{user_id}"
    )
    chat_btn = InlineKeyboardButton(
        text="✅ Включить чат" if is_chat_off else "🚫 Отключить чат",
        callback_data=f"admin_user_chaton_{user_id}" if is_chat_off else f"admin_user_chatoff_{user_id}"
    )

    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="➕ Выдать баланс", callback_data=f"admin_user_addbal_{user_id}")],
        [InlineKeyboardButton(text="➖ Забрать баланс", callback_data=f"admin_user_subbal_{user_id}")],
        [ban_btn, chat_btn],
        [InlineKeyboardButton(text="🔙 Назад", callback_data="admin_panel")]
    ])

@dp.errors()
async def errors_handler(event: ErrorEvent):
    logging.error(f"Event: {event.update}\nException: {event.exception}")
    
    event_obj = event.update.callback_query or event.update.message
    if event_obj:
        user_id = event_obj.from_user.id if event_obj.from_user else None
        is_admin_user = user_id and is_admin(user_id)
        
        try:
            if hasattr(event_obj, 'answer'):
                await event_obj.answer(
                    "❌ <b>Произошла ошибка</b>\n\nПопробуйте вернуться в главное меню:",
                    reply_markup=get_main_menu(is_admin_user),
                    parse_mode="HTML"
                )
            elif hasattr(event_obj, 'reply'):
                await event_obj.reply(
                    "❌ <b>Произошла ошибка</b>\n\nПопробуйте вернуться в главное меню:",
                    reply_markup=get_main_menu(is_admin_user),
                    parse_mode="HTML"
                )
        except:
            pass
    
    return True

# ============================================================
# ===== ЕДИНЫЙ ОБРАБОТЧИК ЧАТА (активность + триггеры) =====
# ============================================================

@dp.message(F.chat.type.in_({"group", "supergroup"}))
async def handle_chat_message(message: types.Message):
    """
    Единый обработчик для чата:
    1. Начисляет активность (молча)
    2. Реагирует на триггер-слова (ответом в чат)
    """
    try:
        # --- Базовые проверки ---
        if not message.from_user or message.from_user.is_bot:
            return
        
        chat_id = message.chat.id
        user_id = message.from_user.id
        
        # Лог для отладки — убрать после проверки
        logging.info(f"CHAT MSG from {user_id} in {chat_id}: {message.text!r}")
        
        # Если чат не наш — игнорируем (можно закомментить для теста)
        # if chat_id != CHAT_ID and chat_id != ADMIN_GROUP_ID:
        #     return
        
        if is_user_banned(user_id):
            return
        
        text = (message.text or "").lower().strip()
        
        # Пропускаем дуэль-триггеры (обрабатываются в duels.py)
        if "дуэль" in text or "битва" in text or "pvp" in text:
            return
        
        if is_chat_activity_disabled(user_id):
            return
        
        # --- 1. АКТИВНОСТЬ (молча, без ответа в чат) ---
        activity = get_user_activity(user_id)
        current_time = int(time.time())
        last_time = activity.get("last_message_time", 0)
        
        if current_time - last_time >= CHAT_ACTIVITY_COOLDOWN:
            count, earned, bonus = increment_chat_message(user_id)
            
            if earned:
                user = get_user(user_id)
                username = user[1] if user else "Unknown"
                
                # Уведомление админам
                await notify_admin(
                    f"💬 <b>Активность в чате</b>\n\n"
                    f"<blockquote>├ Пользователь: @{username} (ID: <code>{user_id}</code>)\n"
                    f"├ Сообщений: <b>{count}</b>\n"
                    f"├ Начислено: <b>${bonus:.2f}</b>\n"
                    f"└ Всего заработано: <b>${activity.get('total_earned', 0) + bonus:.2f}</b></blockquote>"
                )
                
                # ЛС уведомление (тихо)
                try:
                    await bot.send_message(
                        user_id,
                        f"💬 <b>Бонус за активность!</b>\n\n"
                        f"<blockquote>├ Сообщений: <b>{count}</b>\n"
                        f"├ Начислено: <b>${bonus:.2f}</b></blockquote>\n\n"
                        f"<i>Продолжайте общаться и зарабатывать!</i>",
                        parse_mode="HTML"
                    )
                except Exception:
                    pass
        
        # --- 2. ТРИГГЕР-СЛОВА (ответ в чат) ---
        text = (message.text or "").lower().strip()
        if not text:
            return
        
        # Триггеры для статистики
        stats_triggers = [
            "стата", "статистика", "статы", "активность", 
            "моя статистика", "моя активность", "моя стата"
        ]
        
        # Триггеры для топа
        top_triggers = [
            "топ", "топ чата", "лидеры", "топ активных", 
            "рейтинг", "топчик", "кто топ"
        ]
        
        # Проверяем статистику
        for trigger in stats_triggers:
            if trigger in text:
                await reply_chat_stats(message, user_id)
                return
        
        # Проверяем топ
        for trigger in top_triggers:
            if trigger in text:
                await reply_chat_top(message)
                return
                
    except Exception as e:
        logging.error(f"Error in handle_chat_message: {e}", exc_info=True)


async def reply_chat_stats(message: types.Message, user_id: int):
    """Ответ статистикой в чат (reply)"""
    try:
        activity = get_chat_activity_stats(user_id)
        user = get_user(user_id)
        balance = user[2] if user else 0.0
        
        text = (
            f"💬 <b>Активность @{message.from_user.username or message.from_user.first_name}</b>\n\n"
            f"<blockquote>├ Сообщений: <b>{activity['message_count']}</b>\n"
            f"├ Заработано: <b>${activity['total_earned']:.4f}</b>\n"
            f"└ Баланс: <b>${balance:.2f}</b></blockquote>\n\n"
            f"<i>За каждые {CHAT_ACTIVITY_THRESHOLD} сообщений — ${CHAT_ACTIVITY_BONUS:.2f}</i>"
        )
        await message.reply(text, parse_mode="HTML")
        
    except Exception as e:
        logging.error(f"reply_chat_stats error: {e}")


async def reply_chat_top(message: types.Message):
    """Ответ топом в чат (reply)"""
    try:
        top_users = get_top_chat_users(limit=10)
        
        if not top_users:
            await message.reply("📊 <b>Топ активности</b>\n\nПока нет данных.", parse_mode="HTML")
            return
        
        text = "🏆 <b>Топ активности в чате</b>\n\n"
        
        for i, user_data in enumerate(top_users, 1):
            user = get_user(user_data['user_id'])
            username = user[1] if user else str(user_data['user_id'])
            
            medal = "🥇" if i == 1 else "🥈" if i == 2 else "🥉" if i == 3 else f"{i}."
            text += (
                f"{medal} @{username} — "
                f"<b>{user_data['message_count']}</b> сообщ., "
                f"заработал <b>${user_data['total_earned']:.4f}</b>\n"
            )
        
        global_stats = get_chat_activity_global_stats()
        text += f"\n<i>Всего: {global_stats['total_messages']} сообщ., выплачено ${global_stats['total_earned']:.4f}</i>"
        
        await message.reply(text, parse_mode="HTML")
        
    except Exception as e:
        logging.error(f"reply_chat_top error: {e}")

@dp.message(Command("start"))
async def cmd_start(message: types.Message, state: FSMContext):
    try:
        await state.clear()
        
        user = get_user(message.from_user.id, message.from_user.username)
        
        if user is None:
            user = get_user(message.from_user.id, message.from_user.username or f"user_{message.from_user.id}")
        
        if is_user_banned(message.from_user.id):
            await message.answer("❌ <b>Вы заблокированы в боте</b>", parse_mode="HTML")
            return
        
        # Проверка подписок на канал и чат
        is_subscribed = await check_subscriptions(message.from_user.id)
        if not is_subscribed:
            # Клавиатура с двумя кнопками
            subscribe_kb = InlineKeyboardMarkup(inline_keyboard=[
                [
                    InlineKeyboardButton(text="📢 Канал", url=f"https://t.me/{NEWS_CHANNEL_USERNAME}"),
                    InlineKeyboardButton(text="💬 Чат", url=f"https://t.me/{CHAT_USERNAME}")
                ],
                [InlineKeyboardButton(text="✅ Проверить подписки", callback_data="check_subscribe")]
            ])
            
            await message.answer(
                f"📢 <b>Требуется подписка</b>\n\n"
                f"<blockquote>├ Подпишитесь на канал новостей</blockquote>\n"
                f"<blockquote>└ И присоединитесь к чату</blockquote>\n\n"
                f"<i>После подписок нажмите кнопку проверки</i>",
                reply_markup=subscribe_kb,
                parse_mode="HTML"
            )
            await state.set_state(SubscribeStates.waiting_subscription)
            return
        
        args = message.text.split()[1] if len(message.text.split()) > 1 else None
        if args and args.isdigit():
            referrer_id = int(args)
            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            c.execute("SELECT user_id FROM users WHERE user_id = ?", (referrer_id,))
            ref_data = c.fetchone()
            
            if ref_data and referrer_id != message.from_user.id:
                c.execute("SELECT referrer_id FROM users WHERE user_id = ?", (message.from_user.id,))
                current_referrer = c.fetchone()
                if not current_referrer or current_referrer[0] is None:
                    c.execute("UPDATE users SET referrer_id = ? WHERE user_id = ?", 
                             (referrer_id, message.from_user.id))
                    c.execute("UPDATE users SET referral_count = referral_count + 1 WHERE user_id = ?", 
                             (referrer_id,))
                    conn.commit()
                    await message.answer("🎁 <b>Вы зарегистрировались по реферальной ссылке!</b>", parse_mode="HTML")
            conn.close()
        
        
        user = get_user(message.from_user.id)
        user_id = message.from_user.id
        balance = user[2] if user and user[2] is not None else 0.0
        
        welcome_text = f"""
<tg-emoji emoji-id="5199552030615558774">🪙</tg-emoji> <b>Добро пожаловать в {PROJECT_NAME}!</b>

<blockquote>├ <tg-emoji emoji-id="5445284980978621387">🚀</tg-emoji> Крипто-бот в Telegram
├ <tg-emoji emoji-id="5471952986970267163">💎</tg-emoji> Мгновенные выплаты через чеки
└ <tg-emoji emoji-id="5199749070830197566">🎁</tg-emoji> Щедрые бонусы и промокоды</blockquote>

<b>• Ваш игровой ID:</b> <code>{user_id}</code>
<b>• Баланс:</b> {format_amount(balance)}

<b>Что вы хотите сделать?</b>
        """
        
        is_admin_user = is_admin(message.from_user.id)
        is_partner_user = is_partner(message.from_user.id)
        await message.answer(welcome_text, reply_markup=get_main_menu(is_admin_user), parse_mode="HTML")
    except Exception as e:
        logging.error(f"Error in cmd_start: {e}")
        await message.answer(
            "❌ <b>Произошла ошибка</b>\n\nПопробуйте вернуться в главное меню:",
            reply_markup=get_main_menu(is_admin(message.from_user.id)),
            parse_mode="HTML"
        )

async def show_main_menu(message, user_id):
    """Показать красивое главное меню (всегда редактирует сообщение)"""
    user = get_user(user_id)
    balance = user[2] if user and user[2] is not None else 0.0
    
    welcome_text = f"""
<tg-emoji emoji-id="5199552030615558774">🪙</tg-emoji> <b>Добро пожаловать в {PROJECT_NAME}!</b>

<blockquote>├ <tg-emoji emoji-id="5445284980978621387">🚀</tg-emoji> Крипто-бот в Telegram
├ <tg-emoji emoji-id="5471952986970267163">💎</tg-emoji> Мгновенные выплаты через чеки
└ <tg-emoji emoji-id="5199749070830197566">🎁</tg-emoji> Щедрые бонусы и промокоды</blockquote>

<b>• Ваш игровой ID:</b> <code>{user_id}</code>
<b>• Баланс:</b> {format_amount(balance)}

<b>Что вы хотите сделать?</b>
        """
    
    is_admin_user = is_admin(user_id)
    await message.edit_text(welcome_text, reply_markup=get_main_menu(is_admin_user), parse_mode="HTML")

@dp.callback_query(F.data == "menu_main_full")
async def menu_main_full_callback(call: types.CallbackQuery):
    try:
        await show_main_menu(call.message, call.from_user.id)
    except Exception as e:
        logging.error(f"Error in menu_main_full_callback: {e}")

@dp.callback_query(F.data == "check_subscribe")
async def check_sub_callback(call: types.CallbackQuery, state: FSMContext):
    try:
        user = get_user(call.from_user.id, call.from_user.username)
        
        if is_user_banned(call.from_user.id):
            await call.answer("❌ Вы заблокированы в боте", show_alert=True)
            return
        
        # Проверка обеих подписок
        is_subscribed = await check_subscriptions(call.from_user.id)
        
        if is_subscribed:
            await state.clear()
            await call.answer("✅ Подписки подтверждены!", show_alert=True)
            await show_main_menu(call.message, call.from_user.id)
        else:
            # Показываем, что именно не подписано
            try:
                channel_member = await bot.get_chat_member(
                    chat_id=NEWS_CHANNEL_ID, 
                    user_id=call.from_user.id
                )
                chat_member = await bot.get_chat_member(
                    chat_id=CHAT_ID, 
                    user_id=call.from_user.id
                )
                
                is_channel_ok = channel_member.status in ["member", "administrator", "creator"]
                is_chat_ok = chat_member.status in ["member", "administrator", "creator"]
                
                missing = []
                if not is_channel_ok:
                    missing.append("канал")
                if not is_chat_ok:
                    missing.append("чат")
                
                missing_text = " и ".join(missing)
                await call.answer(f"❌ Вы не подписаны на {missing_text}!", show_alert=True)
            except:
                await call.answer("❌ Подписки не подтверждены!", show_alert=True)
    except Exception as e:
        logging.error(f"Error in check_sub_callback: {e}")
        await call.message.answer("❌ <b>Произошла ошибка</b>", parse_mode="HTML")


@dp.callback_query(F.data == "menu_main")
async def menu_main_callback(call: types.CallbackQuery):
    try:
        is_admin_user = is_admin(call.from_user.id)
        await call.message.edit_text("Выберите действие:", reply_markup=get_main_menu(is_admin_user))
    except Exception as e:
        logging.error(f"Error in menu_main_callback: {e}")
        await call.message.answer(
            "❌ <b>Произошла ошибка</b>",
            reply_markup=get_main_menu(is_admin(call.from_user.id)),
            parse_mode="HTML"
        )

@dp.callback_query(F.data == "menu_profile")
async def menu_profile_callback(call: types.CallbackQuery):
    try:
        user = get_user(call.from_user.id)
        if not user:
            await call.answer("❌ Ошибка: пользователь не найден", show_alert=True)
            return
        
        balance = user[2] if user[2] is not None else 0.0
        ref_balance = user[4] if len(user) > 4 and user[4] is not None else 0.0
        ref_count = get_user_referrals(call.from_user.id)
        total_games = user[9] if len(user) > 9 and user[9] is not None else 0
        total_wins = user[10] if len(user) > 10 and user[10] is not None else 0
        total_bets = user[11] if len(user) > 11 and user[11] is not None else 0.0
        
        winrate = (total_wins / total_games * 100) if total_games > 0 else 0
        
        profile_text = f"""
<tg-emoji emoji-id="5386399931378440814">😎</tg-emoji> <b>Ваш профиль</b>

<blockquote>├ <b>ID:</b> <code>{call.from_user.id}</code>
├ <b>Регистрация:</b> {user[3]}
└ <b>Баланс:</b> <b>{format_amount(balance)}</b></blockquote>

<blockquote>├ Реф. баланс: <b>${ref_balance:.2f}</b>
└ Приглашено: <b>{ref_count}</b> игроков</blockquote>

<blockquote>├ Игр сыграно: <b>{total_games}</b>
├ Побед: <b>{total_wins}</b>
├ Винрейт: <b>{winrate:.1f}%</b>
└ Ставок всего: <b>{format_amount(total_bets)}</b></blockquote>
        """
        
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [
                InlineKeyboardButton.model_construct(
                    text="Управление балансом",
                    callback_data="menu_balance",
                    icon_custom_emoji_id="5769403330761593044"
                )
            ],
            [
                InlineKeyboardButton.model_construct(
                    text="Активировать промокод",
                    callback_data="promo",
                    icon_custom_emoji_id="5985433648810171091"
                )
            ],
            [
                InlineKeyboardButton.model_construct(
                    text="Ежедневный бонус",
                    callback_data="daily_bonus",
                    icon_custom_emoji_id="5875180111744995604"
                )
            ],
            [
        InlineKeyboardButton.model_construct(
            text="Активность в чате",
            callback_data="chat_activity_stats",
            icon_custom_emoji_id="5992430854909989581"  # замените на нужный эмодзи
                )
            ],
            [
                get_back_to_main_button()
            ]
        ])
        
        await call.message.edit_text(profile_text, reply_markup=kb, parse_mode="HTML")
    except Exception as e:
        logging.error(f"Error in menu_profile_callback: {e}")
        await call.message.answer(
            "❌ <b>Произошла ошибка</b>",
            reply_markup=get_back_to_main_button(),
            parse_mode="HTML"
        )

@dp.callback_query(F.data == "chat_activity_stats")
async def chat_activity_stats_callback(call: types.CallbackQuery):
    """Показать статистику активности в чате через callback"""
    try:
        user_id = call.from_user.id
        activity = get_chat_activity_stats(user_id)
        user = get_user(user_id)
        balance = user[2] if user else 0.0
        
        text = (
            f"💬 <b>Ваша активность в чате</b>\n\n"
            f"<blockquote>├ Сообщений отправлено: <b>{activity['message_count']}</b>\n"
            f"├ Заработано за активность: <b>${activity['total_earned']:.4f}</b>\n"
            f"└ Текущий баланс: <b>${balance:.2f}</b></blockquote>\n\n"
            f"<i>За каждые {CHAT_ACTIVITY_THRESHOLD} сообщений в чате "
            f"вы получаете ${CHAT_ACTIVITY_BONUS:.2f} на баланс!</i>\n\n"
            f"<b>📊 Команды для чата:</b>\n"
            f"<code>/chatstats</code> — ваша статистика\n"
            f"<code>/chattop</code> — топ пользователей"
        )
        
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="👥 Посмотреть топ чата", url=f"https://t.me/{CHAT_USERNAME}")],
            [get_back_to_profile_button()]
        ])
        
        await call.message.edit_text(text, reply_markup=kb, parse_mode="HTML")
        await call.answer()
        
    except Exception as e:
        logging.error(f"Error in chat_activity_stats_callback: {e}")
        await call.message.answer("❌ <b>Произошла ошибка</b>", parse_mode="HTML")

@dp.callback_query(F.data == "menu_balance")
async def menu_balance_callback(call: types.CallbackQuery):
    try:
        user = get_user(call.from_user.id)
        
        if not user:
            await call.answer("❌ Ошибка: пользователь не найден", show_alert=True)
            return
        
        balance = user[2] if user[2] is not None else 0.0
        ref_balance = user[4] if len(user) > 4 and user[4] is not None else 0.0
        total_balance = balance + ref_balance
        
        balance_text = f"""
<tg-emoji emoji-id="5426913374334122021">💸</tg-emoji> <b>Управление балансом</b>

<blockquote>├ Основной: <b>{format_amount(balance)}</b>
├ Реферальный: <b>{format_amount(ref_balance)}</b>
└ Всего: <b>{format_amount(total_balance)}</b></blockquote>

<b>Что вы хотите сделать?</b>
        """
        
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [
                InlineKeyboardButton.model_construct(
                    text="Пополнить",
                    callback_data="deposit",
                    icon_custom_emoji_id="5201747935724868779"
                ),
                InlineKeyboardButton.model_construct(
                    text="Вывести",
                    callback_data="withdraw",
                    icon_custom_emoji_id="5201966012689322495"
                )
            ],
            [
                get_back_to_profile_button()
            ]
        ])
        
        await call.message.edit_text(balance_text, reply_markup=kb, parse_mode="HTML")
    except Exception as e:
        logging.error(f"Error in menu_balance_callback: {e}")
        await call.message.answer(
            "❌ <b>Произошла ошибка</b>",
            reply_markup=get_back_to_main_button(),
            parse_mode="HTML"
        )

@dp.callback_query(F.data == "menu_referrals")
async def menu_referrals_callback(call: types.CallbackQuery):
    try:
        user = get_user(call.from_user.id)
        
        if not user:
            await call.answer("❌ Ошибка: пользователь не найден", show_alert=True)
            return
        
        ref_balance = user[4] if len(user) > 4 and user[4] is not None else 0.0
        ref_count = get_user_referrals(call.from_user.id)
        ref_link = f"https://t.me/{BOT_USERNAME}?start={call.from_user.id}"
        
        ref_text = f"""
<tg-emoji emoji-id="5427135677546399985">📊</tg-emoji> <b>Реферальная программа</b>

<blockquote>├ Ваш доход: <b>${ref_balance:.2f}</b>
└ Приглашено: <b>{ref_count}</b> игроков</blockquote>

<b><tg-emoji emoji-id="5202084785714925763">🛍</tg-emoji> Условия:</b>
<blockquote>├ 7% от проигрышей рефералов
├ Мгновенные начисления
└ Без ограничений</blockquote>

<b><tg-emoji emoji-id="5427279464461532406">🔗</tg-emoji> Ваша реферальная ссылка:</b>
<code>{ref_link}</code>
        """
        
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [
                InlineKeyboardButton.model_construct(
                    text="Поделиться ссылкой",
                    url=f"https://t.me/share/url?url={ref_link}",
                    callback_data=None,
                    icon_custom_emoji_id="5201966012689322495"
                )
            ],
            [
                InlineKeyboardButton.model_construct(
                    text="Вывести реф. баланс",
                    callback_data="withdraw_ref",
                    icon_custom_emoji_id="5429190797922696151"
                )
            ],
            [
                get_back_to_main_button()
            ]
        ])
        
        await call.message.edit_text(ref_text, reply_markup=kb, parse_mode="HTML")
    except Exception as e:
        logging.error(f"Error in menu_referrals_callback: {e}")
        await call.message.answer(
            "❌ <b>Произошла ошибка</b>",
            reply_markup=get_back_to_main_button(),
            parse_mode="HTML"
        )



@dp.callback_query(F.data == "menu_about")
async def menu_about_callback(call: types.CallbackQuery):
    try:
        stats = get_global_stats()
        total_players = get_total_players()
        
        about_text = (
            f'<tg-emoji emoji-id="5426885684679967615">ℹ️</tg-emoji> <b>О {PROJECT_NAME}</b>\n\n'
            '<blockquote><b>Крипто-бот №1 в Telegram</b></blockquote>\n\n'
    
            '<b><tg-emoji emoji-id="5426995996619999058">📊</tg-emoji> Статистика проекта:</b>\n'
            '<blockquote>'
            f'├ Игроков: <b>{total_players}</b>\n'
            f'├ Депозитов: <b>${stats.get("total_deposits", 0):.2f}</b>\n'
            f'├ Выводов: <b>${stats.get("total_withdrawals", 0):.2f}</b>\n'
            f'└ Реферальных выплат: <b>${stats.get("total_referral_payouts", 0):.2f}</b>'
            '</blockquote>\n\n'
    
            '<b><tg-emoji emoji-id="5427195403361611725">💎</tg-emoji> Преимущества:</b>\n'
            '<blockquote>'
            '├ Мгновенные депозиты\n'
            '├ Выводы через чеки\n'
            '├ Щедрые бонусы\n'
            '└ 24/7 поддержка'
            '</blockquote>'
        )
        
        # Новая клавиатура с кнопками поддержки и переходника
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [
                InlineKeyboardButton.model_construct(
                    text="Поддержка",
                    url=SUPPORT_URL,
                    callback_data=None,
                    icon_custom_emoji_id="5427325751324083925"
                ),
                InlineKeyboardButton.model_construct(
                    text="Переходник",
                    url=MIRROR_URL,
                    callback_data=None,
                    icon_custom_emoji_id="5427279464461532406"
                )
            ],
            [
                InlineKeyboardButton.model_construct(
                    text="Лидерборд",
                    callback_data="menu_leaderboard",
                    icon_custom_emoji_id="5424673694918151633"
                )
            ],
            [
                InlineKeyboardButton.model_construct(
                    text="Запасной бот",
                    url=REZERV_URL,
                    callback_data=None,
                    icon_custom_emoji_id="5427047789630619730"
                )
            ],
            [
                get_back_to_main_button()
            ]
        ])
        
        await call.message.edit_text(about_text, reply_markup=kb, parse_mode="HTML")
    except Exception as e:
        logging.error(f"Error in menu_about_callback: {e}")
        await call.message.answer(
            "❌ <b>Произошла ошибка</b>",
            reply_markup=get_back_to_main_button(),
            parse_mode="HTML"
        )

## ========== ЛИДЕРБОРД / ТОП ==========

@dp.callback_query(F.data == "menu_leaderboard")
async def menu_leaderboard(call: types.CallbackQuery, state: FSMContext):
    """Главное меню лидерборда — выбор категории"""
    try:
        await call.answer()
        
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="💰 По обороту", callback_data="lb_turnover")],
            [InlineKeyboardButton(text="🎮 По ставкам", callback_data="lb_games")],
            [InlineKeyboardButton(text="🏆 По победам", callback_data="lb_wins")],
            [InlineKeyboardButton(text="🔙 Назад в меню", callback_data="menu_main_full")]
        ])

        await call.message.edit_text(
            "🏆 <b>Лидерборд</b>\n\n"
            "Выберите категорию:",
            reply_markup=kb,
            parse_mode="HTML"
        )
        
    except Exception as e:
        logging.error(f"Leaderboard menu error: {e}", exc_info=True)
        await call.answer("❌ Ошибка", show_alert=True)


@dp.callback_query(lambda c: c.data in ["lb_turnover", "lb_games", "lb_wins"])
async def show_leaderboard_categories(call: types.CallbackQuery):
    """Выбор периода после выбора категории"""
    try:
        await call.answer()
        
        category_map = {
            "lb_turnover": "turnover",
            "lb_games": "games",
            "lb_wins": "wins"
        }
        category = category_map.get(call.data, "turnover")

        kb = InlineKeyboardMarkup(inline_keyboard=[
            [
                InlineKeyboardButton(text="📅 Сегодня", callback_data=f"lb_{category}_day"),
                InlineKeyboardButton(text="📆 Неделя", callback_data=f"lb_{category}_week")
            ],
            [InlineKeyboardButton(text="🌍 За всё время", callback_data=f"lb_{category}_all")],
            [InlineKeyboardButton(text="🔙 Назад", callback_data="menu_leaderboard")]
        ])

        category_names = {
            "turnover": "Оборот",
            "games": "Количество ставок",
            "wins": "Победы"
        }

        await call.message.edit_text(
            f"🏆 <b>Топ — {category_names[category]}</b>\n\n"
            "Выберите период:",
            reply_markup=kb,
            parse_mode="HTML"
        )
        
    except Exception as e:
        logging.error(f"Show leaderboard categories error: {e}")
        await call.answer("❌ Ошибка", show_alert=True)


@dp.callback_query(lambda c: c.data and c.data.startswith("lb_") and any(c.data.endswith(s) for s in ["_day", "_week", "_all"]))
async def show_leaderboard_period(call: types.CallbackQuery):
    """Показать топ за выбранный период"""
    try:
        await call.answer("⏳ Загрузка...")
        
        parts = call.data.split("_")
        category = parts[1]
        period = parts[2]

        # Получаем свежие данные из БД
        data = get_top_players(period=period, category=category, limit=15)
        text = format_leaderboard(data)

        # Уникальный callback_data для кнопки обновить
        # Используем случайное число чтобы избежать кэширования
        import random
        refresh_id = random.randint(100000, 999999)
        refresh_callback = f"lb_{category}_{period}_refresh_{refresh_id}"

        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🏆 К лидерборду", callback_data="menu_leaderboard")],
            [get_back_to_main_button()]
        ])

        await call.message.edit_text(text, reply_markup=kb, parse_mode="HTML")
        
    except Exception as e:
        logging.error(f"Leaderboard period error: {e}", exc_info=True)
        await call.answer("❌ Ошибка загрузки топа", show_alert=True)

@dp.callback_query(F.data == "daily_bonus")
async def daily_bonus_callback(call: types.CallbackQuery):
    try:
        can_claim, time_left = get_daily_bonus_status(call.from_user.id)
        
        if can_claim:
            kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="🎯 Получить бонус", callback_data="daily_bonus_claim")],
                [get_back_to_main_button()]
            ])
            await call.message.edit_text(
                '<tg-emoji emoji-id="5427069925892060473">📆</tg-emoji> <b>Ежедневный бонус</b>\n\n'
                '<blockquote>└ Шанс 50% выиграть $0.01</blockquote>\n\n'
                'Получайте бонус один раз в 24 часа!',
                reply_markup=kb,
                parse_mode="HTML"
            )
        else:
            await call.answer(f"❌ Бонус уже получен. Осталось: {time_left}", show_alert=True)
    except Exception as e:
        logging.error(f"Error in daily_bonus_callback: {e}")
        await call.message.answer(
            "❌ <b>Произошла ошибка</b>",
            reply_markup=get_back_to_main_button(),
            parse_mode="HTML"
        )

@dp.callback_query(F.data == "daily_bonus_claim")
async def daily_bonus_claim(call: types.CallbackQuery):
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        
        now = int(time.time())
        if random.random() < 0.5:
            bonus = DAILY_BONUS_AMOUNT
            update_user_balance(call.from_user.id, bonus)
            c.execute("INSERT OR REPLACE INTO daily_bonus (user_id, last_claim) VALUES (?, ?)", (call.from_user.id, now))
            conn.commit()
            conn.close()
            
            kb = InlineKeyboardMarkup(inline_keyboard=[
                [get_back_to_profile_button()]
            ])
            
            await call.message.edit_text(
                f"🎉 <b>Поздравляем!</b>\n\n"
                f"<blockquote>└ Вы выиграли: <b>${bonus:.2f}</b></blockquote>",
                reply_markup=kb,
                parse_mode="HTML"
            )
        else:
            c.execute("INSERT OR REPLACE INTO daily_bonus (user_id, last_claim) VALUES (?, ?)", (call.from_user.id, now))
            conn.commit()
            conn.close()
            
            kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="🎁 Попробовать завтра", callback_data="daily_bonus")],
                [get_back_to_main_button()]
            ])
            
            await call.message.edit_text(
                "😔 <b>Не повезло</b>\n\n"
                "<blockquote>└ Попробуйте завтра!</blockquote>",
                reply_markup=kb,
                parse_mode="HTML"
            )
    except Exception as e:
        logging.error(f"Error in daily_bonus_claim: {e}")
        await call.message.answer(
            "❌ <b>Произошла ошибка</b>",
            reply_markup=get_back_to_main_button(),
            parse_mode="HTML"
        )

@dp.callback_query(F.data.startswith("fair_"))
async def fair_check_callback(call: types.CallbackQuery):
    """Показать данные для проверки честности"""
    round_id = int(call.data.split("_")[1])
    round_data = get_round(round_id)
    
    if not round_data:
        await call.answer("Раунд не найден", show_alert=True)
        return
    
    if round_data['user_id'] != call.from_user.id:
        await call.answer("Это не ваш раунд", show_alert=True)
        return
    
    if round_data['status'] != 'revealed':
        await call.answer("Результат ещё не раскрыт", show_alert=True)
        return
    
    # Формируем сообщение с деталями
    text = (
        f"🎲 <b>Проверка честности</b>\n\n"
        f"<b>Игра:</b> {round_data['game_name']}\n"
        f"<b>Ставка:</b> ${round_data['bet_amount']:.2f}\n"
        f"<b>Результат:</b> <code>{round_data['result']}</code>\n\n"
        f"<b>Серверный сид (SHA-256):</b>\n<code>{round_data['server_seed_hash']}</code>\n"
        f"<b>Клиентский сид:</b>\n<code>{round_data['client_seed']}</code>\n"
        f"<b>Nonce:</b> {round_data['nonce']}\n"
        f"<b>Раскрытый серверный сид:</b>\n<code>{round_data['server_seed']}</code>\n\n"
        f"<i>Проверить можно, вычислив SHA-256 от серверного сида и сравнив с хэшем выше, "
        f"а затем повторив расчёт результата с помощью комбинации сидов и nonce.</i>"
    )
    
    # Кнопка закрыть
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="❌ Закрыть", callback_data="delete_this_message")]
    ])
    
    await call.message.answer(text, reply_markup=kb, parse_mode="HTML")
    await call.answer()

@dp.callback_query(F.data == "delete_this_message")
async def delete_message_callback(call: types.CallbackQuery):
    try:
        await call.message.delete()
    except:
        pass
    await call.answer()

@dp.callback_query(F.data == "menu_games")
async def menu_games_callback(call: types.CallbackQuery):
    try:
        await call.message.delete()
        user_id = call.from_user.id
        user = get_user(user_id)
        balance = user[2] if user else 0.0
        formatted_balance = format_amount(balance)
        text = (f"🎮 <b>Выберите категорию игр</b>\n\n"
                f"💰 Баланс: {formatted_balance}\n\n"
                f"<i>Выберите раздел:</i>")
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🌈 X2", callback_data="game_rainbow"),
            InlineKeyboardButton(text="🔥 X3", callback_data="game_x3"),
            InlineKeyboardButton(text="🎈 X5", callback_data="game_x5"),
            InlineKeyboardButton(text="🥚 X10", callback_data="game_x10")],
        
            [InlineKeyboardButton(text="🎰 X20", callback_data="game_x20"),
            InlineKeyboardButton(text="🐸 X30", callback_data="game_x30"),
            InlineKeyboardButton(text="🌵 X50", callback_data="game_x50"),
            InlineKeyboardButton(text="🐳 X100", callback_data="game_x100")],
            
            [InlineKeyboardButton(text="📱 Telegram", callback_data="telegram_games"),
            InlineKeyboardButton(text="🎲 Авторские", callback_data="custom_games"),
            InlineKeyboardButton(text="🎁 Кейсы", callback_data="menu_cases")],
            [get_back_to_main_button()]
        ])
        await call.message.answer(text, reply_markup=kb, parse_mode="HTML")
        await call.answer()
    except Exception as e:
        logging.error(f"Error in menu_games_callback: {e}")

@dp.callback_query(F.data == "telegram_games")
async def telegram_games_menu(call: types.CallbackQuery):
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🎲 Dice", callback_data="game_dice")],
        [InlineKeyboardButton(text="🏀 Баскетбол", callback_data="game_basketball")],
        [InlineKeyboardButton(text="🔙 Назад", callback_data="menu_games")]
    ])
    await call.message.edit_text("🎮 <b>Telegram игры</b>\n\nВыберите игру:", 
                                  reply_markup=kb, parse_mode="HTML")
    await call.answer()

@dp.callback_query(F.data == "custom_games")
async def custom_games_menu(call: types.CallbackQuery):
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🌈 Rainbow", callback_data="game_rainbow")],
        [InlineKeyboardButton(text="💣 Mines", callback_data="game_mines")],
        [InlineKeyboardButton(text="🎰 Рулетка", callback_data="game_roulette")],
        [InlineKeyboardButton(text="📦 Сундучки", callback_data="game_boxes")],
        #[InlineKeyboardButton(text="✊ КНБ", callback_data="game_rps")], переделать
        [InlineKeyboardButton(text="🪙 Монетка", callback_data="game_coinflip")],
        [InlineKeyboardButton(text="❤️ Сердца", callback_data="game_hearts")],
        [InlineKeyboardButton(text="🔫 Русская рулетка", callback_data="game_russian_roulette")],
        [InlineKeyboardButton(text="🔙 Назад", callback_data="menu_games")]
    ])
    await call.message.edit_text("🎮 <b>Авторские игры</b>\n\nВыберите игру:", 
                                 reply_markup=kb, parse_mode="HTML")
    await call.answer()

@dp.callback_query(F.data == "game_dice")
async def game_dice_start(call: types.CallbackQuery, state: FSMContext):
    try:
        await state.clear()
        await call.message.delete()
        
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="⚫️ Четное (2,4,6)", callback_data="dice_type_even")],
            [InlineKeyboardButton(text="🔴 Нечетное (1,3,5)", callback_data="dice_type_odd")],
            [InlineKeyboardButton(text="🔢 Конкретное число", callback_data="dice_type_exact")],
            [InlineKeyboardButton(text="⬇️ Меньше (1-3)", callback_data="dice_type_low")],
            [InlineKeyboardButton(text="⬆️ Больше (4-6)", callback_data="dice_type_high")],
            [get_back_to_main_button()]
        ])
        
        await call.message.answer(
            "🎲 <b>Игра Dice - Выберите тип ставки:</b>\n\n"
            "<blockquote>└ После выбора введите сумму ставки</blockquote>\n\n"

            "<blockquote>ℹ️ Результаты броска генерируются Telegram и не могут быть изменены "
            "(<a href=\"https://core.telegram.org/bots/api#dice\">официальная документация</a>)</blockquote>\n\n"

            "<b>Введите сумму ставки:</b>",
            reply_markup=kb,
            parse_mode="HTML",
            disable_web_page_preview=True
        )
        await call.answer()
    except Exception as e:
        logging.error(f"Error in game_dice_start: {e}")
        await call.message.answer("❌ <b>Произошла ошибка</b>", parse_mode="HTML")

@dp.callback_query(F.data.startswith("dice_type_"))
async def game_dice_type_selected(call: types.CallbackQuery, state: FSMContext):
    try:
        bet_type = call.data.split("_")[2]
        await state.update_data(dice_bet_type=bet_type)
        await call.message.delete()
        
        if bet_type == "exact":
            kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="1️⃣", callback_data="dice_num_1"),
                 InlineKeyboardButton(text="2️⃣", callback_data="dice_num_2"),
                 InlineKeyboardButton(text="3️⃣", callback_data="dice_num_3")],
                [InlineKeyboardButton(text="4️⃣", callback_data="dice_num_4"),
                 InlineKeyboardButton(text="5️⃣", callback_data="dice_num_5"),
                 InlineKeyboardButton(text="6️⃣", callback_data="dice_num_6")],
                [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
            ])
            await call.message.answer("🎲 <b>Выберите число:</b>", reply_markup=kb, parse_mode="HTML")
            await state.set_state(DiceStates.waiting_bet_value)
        else:
            cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
            ])
            await call.message.answer(
                "💰 <b>Введите сумму ставки:</b>\n"
                f"<blockquote>└ Минимум: ${MIN_BET:.2f}</blockquote>",
                reply_markup=cancel_kb,
                parse_mode="HTML"
            )
            await state.set_state(DiceStates.waiting_amount)
        
        await call.answer()
    except Exception as e:
        logging.error(f"Error in game_dice_type_selected: {e}")
        await call.message.answer("❌ <b>Произошла ошибка</b>", parse_mode="HTML")

@dp.callback_query(F.data.startswith("dice_num_"))
async def game_dice_number_selected(call: types.CallbackQuery, state: FSMContext):
    try:
        number = call.data.split("_")[2]
        await state.update_data(dice_bet_value=number)
        
        cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
        ])
        
        await call.message.answer(
            "💰 <b>Введите сумму ставки:</b>\n"
            f"<blockquote>└ Минимум: ${MIN_BET:.2f}</blockquote>",
            reply_markup=cancel_kb,
            parse_mode="HTML"
        )
        await call.message.delete()
        await state.set_state(DiceStates.waiting_amount)
        await call.answer()
    except Exception as e:
        logging.error(f"Error in game_dice_number_selected: {e}")
        await call.message.answer("❌ <b>Произошла ошибка</b>", parse_mode="HTML")

@dp.message(DiceStates.waiting_amount)
async def game_dice_amount(message: types.Message, state: FSMContext):
    try:
        amount = float(message.text)
        
        if amount < MIN_BET:
            cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
            ])
            await message.answer(f"❌ <b>Минимальная ставка:</b> ${MIN_BET:.2f}", reply_markup=cancel_kb, parse_mode="HTML")
            return
        
        user = get_user(message.from_user.id)
        if not user:
            await message.answer("❌ <b>Ошибка: пользователь не найден</b>", parse_mode="HTML")
            return
        
        balance = user[2] if user[2] is not None else 0.0
        
        if amount > balance:
            cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
            ])
            await message.answer("❌ <b>Недостаточно средств</b>", reply_markup=cancel_kb, parse_mode="HTML")
            return
        
        update_user_balance_main(message.from_user.id, -amount)
        
        dice_msg = await message.answer_dice(emoji="🎲")
        await asyncio.sleep(3)  
        
        dice_result = dice_msg.dice.value
        
        data = await state.get_data()
        bet_type = data['dice_bet_type']
        bet_value = data.get('dice_bet_value', None)
        
        win = False
        multiplier = 0
        
        if bet_type == "even":
            win = dice_result % 2 == 0
            multiplier = DICE_EVEN_ODD_MULTIPLIER
        elif bet_type == "odd":
            win = dice_result % 2 == 1
            multiplier = DICE_EVEN_ODD_MULTIPLIER
        
        elif bet_type == "low":
            win = 1 <= dice_result <= 3
            multiplier = DICE_HI_LO_MULTIPLIER
        elif bet_type == "high":
            win = 4 <= dice_result <= 6
            multiplier = DICE_HI_LO_MULTIPLIER
        
        elif bet_type == "exact":
            win = int(bet_value) == dice_result
            multiplier = DICE_EXACT_MULTIPLIER
        
        # Update stats
        update_user_game_stats(message.from_user.id, amount, win)
        add_raffle_bet(message.from_user.id)
        
        # NOTIFICATION
        await notify_game_result(
            username=user[1],
            user_id=message.from_user.id,
            game_name="Dice",
            bet_amount=amount,
            win=win,
            win_amount=amount * multiplier if win else 0
        )
        
        if win:
            win_amount = amount * multiplier
            update_user_balance_main(message.from_user.id, win_amount)
            
            kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="🎲 Еще раз", callback_data="game_dice")],
                [get_back_to_main_button()]
            ])
            
            await message.answer(
                f"🎉 <b>Победа!</b>\n\n"
                f"<blockquote>├ Выпало: <b>{dice_result}</b>\n"
                f"├ Ваша ставка: <b>{format_amount(amount)}</b>\n"
                f"├ Множитель: <b>x{multiplier:.2f}</b>\n"
                f"└ Выигрыш: <b>${win_amount:.2f}</b></blockquote>",
                reply_markup=kb,
                parse_mode="HTML",
                message_effect_id="5046509860389126442"  # пример эффекта 🎉
            )
        else:
            kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="🎲 Попробовать снова", callback_data="game_dice")],
                [get_back_to_main_button()]
            ])

            await message.answer(
                f"😔 <b>Проигрыш</b>\n\n"
                f"<blockquote>├ Выпало: <b>{dice_result}</b>\n"
                f"└ Ваша ставка: <b>${amount:.2f}</b></blockquote>\n\n"
                f"<i>Попробуйте еще раз!</i>",
                reply_markup=kb,
                parse_mode="HTML",
                message_effect_id="5046589136895476101" # пример эффекта 💩
            )
        
        await state.clear()
    except ValueError:
        cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
        ])
        await message.answer("❌ <b>Введите корректную сумму</b>", reply_markup=cancel_kb, parse_mode="HTML")
    except Exception as e:
        logging.error(f"Dice error: {e}")
        kb = InlineKeyboardMarkup(inline_keyboard=[[get_back_to_main_button()]])
        await message.answer("❌ <b>Произошла ошибка</b>", reply_markup=kb, parse_mode="HTML")

@dp.callback_query(F.data == "game_mines")
async def game_mines_start(call: types.CallbackQuery, state: FSMContext):
    try:
        await state.clear()
        await call.message.delete()
        
        cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
        ])
        
        await call.message.answer(
            f"💣 <b>Игра Mines</b>\n\n"
            "<blockquote>├ Поле: <b>5×5 (25 клеток)</b>\n"
            "├ Мин: <b>10</b>\n"
            "├ Множитель: <b>растет с каждой клеткой</b>\n"
            "└ Cashout в любой момент!</blockquote>\n\n"
            f"<blockquote>ℹ️ Все исходы определяются через "
            f"(<a href=\"{PYTHON_RANDOM_URL}\">Python</a>)</blockquote>\n\n"
            "<b>Введите сумму ставки:</b>",
            reply_markup=cancel_kb,
            parse_mode="HTML",
            disable_web_page_preview=True
        )
        await state.set_state(MinesStates.waiting_bet_amount)
        await call.answer()
    except Exception as e:
        logging.error(f"Error in game_mines_start: {e}")
        await call.message.answer("❌ <b>Произошла ошибка</b>", parse_mode="HTML")

@dp.message(MinesStates.waiting_bet_amount)
async def game_mines_bet(message: types.Message, state: FSMContext):
    try:
        amount = float(message.text)
        
        if amount < MIN_BET:
            cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
            ])
            await message.answer(f"❌ <b>Минимальная ставка:</b> {format_amount(MIN_BET)}", 
                    reply_markup=cancel_kb, parse_mode="HTML")
            return
        
        user = get_user(message.from_user.id)
        if not user:
            await message.answer("❌ <b>Ошибка: пользователь не найден</b>", parse_mode="HTML")
            return
        
        balance = user[2] if user[2] is not None else 0.0
        
        if amount > balance:
            cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
            ])
            await message.answer("❌ <b>Недостаточно средств</b>", reply_markup=cancel_kb, parse_mode="HTML")
            return
        
        # Списание ставки
        update_user_balance_main(message.from_user.id, -amount)
        
        # ========== PROVABLY FAIR ==========
        nonce = get_next_nonce(message.from_user.id)
        server_seed, client_seed = generate_seeds()
        server_seed_hash = hash_server_seed(server_seed)
        round_id = create_round(message.from_user.id, "Mines", amount,
                                server_seed_hash, client_seed, nonce)
        
        field_size = MINES_FIELD_SIZE
        mines_count = MINES_MINES_COUNT
        mine_positions = get_mines_positions(server_seed, client_seed, nonce, field_size, mines_count)
        
        save_mines_game(message.from_user.id, 
                       field=list(range(field_size)),
                       mines=mine_positions,
                       opened=[],
                       bet_amount=amount,
                       multiplier=1.0,
                       round_id=round_id)
        
        # Сохраняем данные в состоянии для быстрого доступа
        await state.update_data(mines_bet_amount=amount, 
                                mines_round_id=round_id,
                                mines_server_seed=server_seed)
        await state.set_state(MinesStates.playing)
        
        await show_mines_field(message, message.from_user.id)
        
    except ValueError:
        cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
        ])
        await message.answer("❌ <b>Введите корректную сумму</b>", reply_markup=cancel_kb, parse_mode="HTML")
    except Exception as e:
        logging.error(f"Mines bet error: {e}")
        kb = InlineKeyboardMarkup(inline_keyboard=[[get_back_to_main_button()]])
        await message.answer("❌ <b>Произошла ошибка</b>", reply_markup=kb, parse_mode="HTML")

async def show_mines_field(event, user_id):
    """event может быть types.Message или types.CallbackQuery"""
    try:
        game = get_mines_game(user_id)
        if not game:
            return
        
        field, mines, opened_str, bet_amount, multiplier, round_id = game
        field = eval(field)
        mines = eval(mines)
        opened = eval(opened_str)
        
        kb = []
        row = []
        for i in range(25):
            if i in opened:
                if i in mines:
                    row.append(InlineKeyboardButton(text="💣", callback_data=f"mines_open_{i}"))
                else:
                    row.append(InlineKeyboardButton(text="💎", callback_data=f"mines_open_{i}"))
            else:
                row.append(InlineKeyboardButton(text="🔳", callback_data=f"mines_open_{i}"))
            if (i + 1) % 5 == 0:
                kb.append(row)
                row = []
        
        kb.append([InlineKeyboardButton(text=f"💰 Cashout x{multiplier:.2f}", callback_data="mines_cashout")])
        
        text = (f"💣 <b>Mines - Играем</b>\n\n"
                f"<blockquote>├ Ставка: <b>${bet_amount:.2f}</b>\n"
                f"├ Открыто: <b>{len(opened)}</b> клеток\n"
                f"└ Множитель: <b>x{multiplier:.2f}</b></blockquote>\n\n"
                f"<i>Выберите клетку:</i>")
        
        # Определяем тип объекта
        if isinstance(event, types.Message):
            # Если это Message – отправляем новое сообщение
            await event.answer(text, reply_markup=InlineKeyboardMarkup(inline_keyboard=kb), parse_mode="HTML")
        elif hasattr(event, 'message') and hasattr(event, 'answer'):
            # Если это CallbackQuery – редактируем его сообщение
            await event.message.edit_text(text, reply_markup=InlineKeyboardMarkup(inline_keyboard=kb), parse_mode="HTML")
        else:
            # fallback (если что-то другое)
            await event.answer(text, reply_markup=InlineKeyboardMarkup(inline_keyboard=kb), parse_mode="HTML")
            
    except Exception as e:
        logging.error(f"Show mines field error: {e}")

@dp.callback_query(F.data.startswith("mines_open_"))
async def mines_open_cell(call: types.CallbackQuery, state: FSMContext):
    try:
        cell_id = int(call.data.split("_")[2])
        
        game = get_mines_game(call.from_user.id)
        if not game:
            await call.answer("❌ Игра не найдена", show_alert=True)
            return
        
        field, mines, opened_str, bet_amount, current_multiplier, round_id = game
        field = eval(field)
        mines = eval(mines)
        opened = eval(opened_str)
        
        if cell_id in opened:
            await call.answer("❌ Клетка уже открыта", show_alert=True)
            return
        
        opened.append(cell_id)
        
        if cell_id in mines:
            # Проигрыш
            end_mines_game(call.from_user.id, win=False)
            update_user_game_stats(call.from_user.id, bet_amount, win=False)
            add_raffle_bet(call.from_user.id)
            
            # Раскрываем раунд
            data = await state.get_data()
            server_seed = data.get('mines_server_seed')
            if round_id and server_seed:
                result_str = f"mines={mines}, opened={opened}, hit_mine=True"
                reveal_round(round_id, server_seed, result_str)
            
            await notify_game_result(
                username=call.from_user.username,
                user_id=call.from_user.id,
                game_name="Mines",
                bet_amount=bet_amount,
                win=False,
                win_amount=0
            )
            
            kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="💣 Новая игра", callback_data="game_mines")],
                [InlineKeyboardButton(text="🔍 Проверить честность", callback_data=f"fair_{round_id}")],
                [get_back_to_main_button()]
            ])
            
            await call.message.answer(
                "💥 <b>БУМ! Мина!</b>\n\n"
                f"<blockquote>├ Ставка: <b>${bet_amount:.2f}</b>\n"
                f"└ Результат: <b>Проигрыш</b></blockquote>",
                reply_markup=kb,
                parse_mode="HTML",
                message_effect_id="5046589136895476101" # пример эффекта 💩
            )
            await state.clear()
        else:
            safe_cells = len(field) - len(mines)
            opened_safe = [c for c in opened if c not in mines]
            if len(opened_safe) == safe_cells:
                # Выигрыш всех клеток
                win_amount = bet_amount * current_multiplier
                update_user_balance_main(call.from_user.id, win_amount)
                end_mines_game(call.from_user.id, win=True)
                update_user_game_stats(call.from_user.id, bet_amount, win=True)
                add_raffle_bet(call.from_user.id)
                
                # Раскрываем раунд
                data = await state.get_data()
                server_seed = data.get('mines_server_seed')
                if round_id and server_seed:
                    result_str = f"mines={mines}, opened={opened}, all_opened=True, multiplier={current_multiplier}"
                    reveal_round(round_id, server_seed, result_str)
                
                await notify_game_result(
                    username=call.from_user.username,
                    user_id=call.from_user.id,
                    game_name="Mines (Full)",
                    bet_amount=bet_amount,
                    win=True,
                    win_amount=win_amount
                )
                
                kb = InlineKeyboardMarkup(inline_keyboard=[
                    [InlineKeyboardButton(text="💎 Новая игра", callback_data="game_mines")],
                    [InlineKeyboardButton(text="🔍 Проверить честность", callback_data=f"fair_{round_id}")],
                    [get_back_to_main_button()]
                ])
                
                await call.message.answer(
                    "🎉 <b>Все клетки открыты!</b>\n\n"
                    f"<blockquote>├ Ставка: <b>${bet_amount:.2f}</b>\n"
                    f"├ Множитель: <b>x{current_multiplier:.2f}</b>\n"
                    f"└ Выигрыш: <b>${win_amount:.2f}</b></blockquote>",
                    reply_markup=kb,
                    parse_mode="HTML",
                    message_effect_id="5046509860389126442"  # пример эффекта 🎉
                )
                await state.clear()
            else:
                # Продолжаем игру
                current_multiplier = 1.0 + (len(opened_safe) / safe_cells) * 3.5
                update_mines_game(call.from_user.id, opened, current_multiplier)
                await call.answer(f"✅ Безопасно! x{current_multiplier:.2f}", show_alert=True)
                await show_mines_field(call, call.from_user.id)
    except Exception as e:
        logging.error(f"Mines open error: {e}")
        await call.message.answer("❌ <b>Произошла ошибка</b>", parse_mode="HTML")

@dp.callback_query(F.data == "mines_cashout")
async def mines_cashout(call: types.CallbackQuery, state: FSMContext):
    try:
        game = get_mines_game(call.from_user.id)
        if not game:
            await call.answer("❌ Игра не найдена", show_alert=True)
            return
        
        field, mines, opened_str, bet_amount, multiplier, round_id = game
        opened = eval(opened_str)
        mines = eval(mines)
        
        win_amount = bet_amount * multiplier
        update_user_balance_main(call.from_user.id, win_amount)
        end_mines_game(call.from_user.id, win=True)
        update_user_game_stats(call.from_user.id, bet_amount, win=True)
        add_raffle_bet(call.from_user.id)
        
        # Раскрываем раунд
        data = await state.get_data()
        server_seed = data.get('mines_server_seed')
        if round_id and server_seed:
            result_str = f"mines={mines}, opened={opened}, cashout=True, multiplier={multiplier}"
            reveal_round(round_id, server_seed, result_str)
        
        await notify_game_result(
            username=call.from_user.username,
            user_id=call.from_user.id,
            game_name="Mines (Cashout)",
            bet_amount=bet_amount,
            win=True,
            win_amount=win_amount
        )
        
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="💰 Новая игра", callback_data="game_mines")],
            [InlineKeyboardButton(text="🔍 Проверить честность", callback_data=f"fair_{round_id}")],
            [get_back_to_main_button()]
        ])
        
        await call.message.answer(
            "💰 <b>Cashout!</b>\n\n"
            f"<blockquote>├ Ставка: <b>${bet_amount:.2f}</b>\n"
            f"├ Множитель: <b>x{multiplier:.2f}</b>\n"
            f"└ Выигрыш: <b>${win_amount:.2f}</b></blockquote>",
            reply_markup=kb,
            parse_mode="HTML",
            message_effect_id="5046509860389126442"  # пример эффекта 🎉
        )
        await state.clear()
    except Exception as e:
        logging.error(f"Mines cashout error: {e}")
        await call.message.answer("❌ <b>Произошла ошибка</b>", parse_mode="HTML")

@dp.callback_query(F.data == "game_boxes")
async def game_boxes_start(call: types.CallbackQuery, state: FSMContext):
    try:
        await state.clear()
        await call.message.delete()
        
        cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
        ])
        
        await call.message.answer(
            f"📦 <b>Игра Сундучки</b>\n\n"
            "<blockquote>├ 3 сундучка, один выигрышный\n"
            "└ Множитель: <b>x2.0</b></blockquote>\n\n"
    
            f"<blockquote>ℹ️ Все исходы определяются через "
            f"(<a href=\"{PYTHON_RANDOM_URL}\">Python</a>)</blockquote>\n\n"
    
            "<b>Введите сумму ставки:</b>",
            reply_markup=cancel_kb,
            parse_mode="HTML",
            disable_web_page_preview=True
        )
        await state.set_state(BoxesStates.waiting_bet_amount)
        await call.answer()
    except Exception as e:
        logging.error(f"Error in game_boxes_start: {e}")
        await call.message.answer("❌ <b>Произошла ошибка</b>", parse_mode="HTML")

@dp.message(BoxesStates.waiting_bet_amount)
async def game_boxes_amount(message: types.Message, state: FSMContext):
    try:
        amount = float(message.text)
        
        if amount < MIN_BET:
            cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
            ])
            await message.answer(f"❌ <b>Минимальная ставка:</b> ${MIN_BET:.2f}", reply_markup=cancel_kb, parse_mode="HTML")
            return
        
        user = get_user(message.from_user.id)
        if not user:
            await message.answer("❌ <b>Ошибка: пользователь не найден</b>", parse_mode="HTML")
            return
        
        balance = user[2] if user[2] is not None else 0.0
        
        if amount > balance:
            cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
            ])
            await message.answer("❌ <b>Недостаточно средств</b>", reply_markup=cancel_kb, parse_mode="HTML")
            return
        
        update_user_balance_main(message.from_user.id, -amount)
        await state.update_data(boxes_bet_amount=amount)
        
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="📦 Сундук 1", callback_data="box_open_1"),
             InlineKeyboardButton(text="📦 Сундук 2", callback_data="box_open_2"),
             InlineKeyboardButton(text="📦 Сундук 3", callback_data="box_open_3")],
            [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
        ])
        
        await message.answer(
            "📦 <b>Выберите сундук:</b>\n\n"
            f"<blockquote>└ Ставка: <b>${amount:.2f}</b></blockquote>\n",
            reply_markup=kb,
            parse_mode="HTML"
        )
    except ValueError:
        cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
        ])
        await message.answer("❌ <b>Введите корректную сумму</b>", reply_markup=cancel_kb, parse_mode="HTML")
    except Exception as e:
        logging.error(f"Boxes error: {e}")
        kb = InlineKeyboardMarkup(inline_keyboard=[[get_back_to_main_button()]])
        await message.answer("❌ <b>Произошла ошибка</b>", reply_markup=kb, parse_mode="HTML")

@dp.callback_query(F.data.startswith("box_open_"))
async def game_boxes_open(call: types.CallbackQuery, state: FSMContext):
    try:
        box_id = int(call.data.split("_")[2])
        data = await state.get_data()
        amount = data['boxes_bet_amount']
        
        win = random.random() < 0.37
        
        if win:
            win_amount = amount * 2.0
            update_user_balance_main(call.from_user.id, win_amount)
            update_user_game_stats(call.from_user.id, amount, win=True)
            add_raffle_bet(call.from_user.id)
            
            # NOTIFICATION
            await notify_game_result(
                username=call.from_user.username,
                user_id=call.from_user.id,
                game_name=f"Boxes #{box_id}",
                bet_amount=amount,
                win=True,
                win_amount=win_amount
            )
            
            kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="📦 Еще раз", callback_data="game_boxes")],
                [get_back_to_main_button()]
            ])
            
            await call.message.answer(
                f"🎉 <b>Победа!</b>\n\n"
                f"<blockquote>├ Вы выбрали сундук <b>#{box_id}</b>\n"
                f"├ Ставка: <b>${amount:.2f}</b>\n"
                f"├ Множитель: <b>x2.0</b>\n"
                f"└ Выигрыш: <b>${win_amount:.2f}</b></blockquote>",
                reply_markup=kb,
                parse_mode="HTML",
                message_effect_id="5046509860389126442"  # пример эффекта 🎉
            )
        else:
            update_user_game_stats(call.from_user.id, amount, win=False)
            add_raffle_bet(call.from_user.id)
            
            # NOTIFICATION
            await notify_game_result(
                username=call.from_user.username,
                user_id=call.from_user.id,
                game_name=f"Boxes #{box_id}",
                bet_amount=amount,
                win=False,
                win_amount=0
            )
            
            kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="📦 Попробовать снова", callback_data="game_boxes")],
                [get_back_to_main_button()]
            ])
            
            await call.message.answer(
                f"😔 <b>Проигрыш</b>\n\n"
                f"<blockquote>├ Вы выбрали сундук <b>#{box_id}</b>\n"
                f"└ Ваша ставка: <b>${amount:.2f}</b></blockquote>\n\n"
                f"<i>Попробуйте еще раз!</i>",
                reply_markup=kb,
                parse_mode="HTML",
                message_effect_id="5046589136895476101" # пример эффекта 💩
            )
        
        await state.clear()
        await call.answer()
    except Exception as e:
        logging.error(f"Boxes open error: {e}")
        await call.message.answer("❌ <b>Произошла ошибка</b>", parse_mode="HTML")

@dp.callback_query(F.data == "game_rps")
async def game_rps_start(call: types.CallbackQuery, state: FSMContext):
    try:
        await state.clear()
        await call.message.delete()
        
        cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
        ])
        
        await call.message.answer(
            "✊ <b>Игра Камень-Ножницы-Бумага</b>\n\n"
            "<blockquote>├ Выбор против бота\n"
            "└ Множитель: <b>x2.0</b></blockquote>\n\n"
            
            f"<blockquote>ℹ️ Все исходы определяются через "
            f"(<a href=\"{PYTHON_RANDOM_URL}\">Python</a>)</blockquote>\n\n"
    
            "<b>Введите сумму ставки:</b>",
            reply_markup=cancel_kb,
            parse_mode="HTML",
            disable_web_page_preview=True
        )

        await state.set_state(RPSStates.waiting_amount)
        await call.answer()
    except Exception as e:
        logging.error(f"Error in game_rps_start: {e}")
        await call.message.answer("❌ <b>Произошла ошибка</b>", parse_mode="HTML")

@dp.message(RPSStates.waiting_amount)
async def game_rps_choice(message: types.Message, state: FSMContext):
    try:
        amount = float(message.text)
        
        if amount < MIN_BET:
            cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
            ])
            await message.answer(f"❌ <b>Минимальная ставка:</b> ${MIN_BET:.2f}", reply_markup=cancel_kb, parse_mode="HTML")
            return
        
        user = get_user(message.from_user.id)
        if not user:
            await message.answer("❌ <b>Ошибка: пользователь не найден</b>", parse_mode="HTML")
            return
        
        balance = user[2] if user[2] is not None else 0.0
        
        if amount > balance:
            cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
            ])
            await message.answer("❌ <b>Недостаточно средств</b>", reply_markup=cancel_kb, parse_mode="HTML")
            return
        
        update_user_balance_main(message.from_user.id, -amount)
        await state.update_data(rps_bet_amount=amount)
        
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="✊ Камень", callback_data="rps_choice_rock")],
            [InlineKeyboardButton(text="✌️ Ножницы", callback_data="rps_choice_scissors")],
            [InlineKeyboardButton(text="✋ Бумага", callback_data="rps_choice_paper")],
            [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
        ])
        
        await message.answer("✊ <b>Выберите свой вариант:</b>", reply_markup=kb, parse_mode="HTML")
    except ValueError:
        cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
        ])
        await message.answer("❌ <b>Введите корректную сумму</b>", reply_markup=cancel_kb, parse_mode="HTML")
    except Exception as e:
        logging.error(f"RPS error: {e}")
        kb = InlineKeyboardMarkup(inline_keyboard=[[get_back_to_main_button()]])
        await message.answer("❌ <b>Произошла ошибка</b>", reply_markup=kb, parse_mode="HTML")

@dp.callback_query(F.data.startswith("rps_choice_"))
async def game_rps_result(call: types.CallbackQuery, state: FSMContext):
    try:
        user_choice = call.data.split("_")[2]  
        data = await state.get_data()
        amount = data['rps_bet_amount']
        
        bot_choice = random.choice(['rock', 'scissors', 'paper'])
        
        sticker_map = {
            'rock': STICKER_ROCK,
            'paper': STICKER_PAPER,
            'scissors': STICKER_SCISSORS
        }
        
        await call.message.answer_sticker(sticker=sticker_map[bot_choice])
        await asyncio.sleep(2)  
        
        beats = {
            'rock': 'scissors',
            'scissors': 'paper',
            'paper': 'rock'
        }
        
        if user_choice == bot_choice:
            real_result = 'draw'
        elif beats[user_choice] == bot_choice:
            real_result = 'win'
        else:
            real_result = 'lose'
        
        final_win = False
        
        if real_result == 'lose':
            final_win = random.random() < 0.37
        elif real_result == 'win':
            final_win = random.random() < 0.37
        else:
            final_win = random.random() < 0.5
        
        choice_map = {
            'rock': '✊ Камень',
            'scissors': '✌️ Ножницы',
            'paper': '✋ Бумага'
        }
        
        if final_win:
            if real_result != 'win':
                result_text = f"Вы победили! ({choice_map[user_choice]} vs {choice_map[beats[user_choice]]})"
            else:
                result_text = f"Вы победили! ({choice_map[user_choice]} vs {choice_map[bot_choice]})"
        else:
            if real_result != 'lose':
                result_text = f"Вы проиграли! ({choice_map[user_choice]} vs {choice_map[bot_choice]})"
            else:
                result_text = f"Вы проиграли! ({choice_map[user_choice]} vs {choice_map[bot_choice]})"
        
        if final_win:
            win_amount = amount * RPS_MULTIPLIER
            update_user_balance_main(call.from_user.id, win_amount)
            update_user_game_stats(call.from_user.id, amount, win=True)
            add_raffle_bet(call.from_user.id)
            
            # NOTIFICATION
            await notify_game_result(
                username=call.from_user.username,
                user_id=call.from_user.id,
                game_name="RPS",
                bet_amount=amount,
                win=True,
                win_amount=win_amount
            )
            
            kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="✊ Еще раз", callback_data="game_rps")],
                [get_back_to_main_button()]
            ])
            
            await call.message.answer(
                f"🎉 <b>{result_text}</b>\n\n"
                f"<blockquote>├ Ваша ставка: <b>${amount:.2f}</b>\n"
                f"├ Множитель: <b>x{RPS_MULTIPLIER:.1f}</b>\n"
                f"└ Выигрыш: <b>${win_amount:.2f}</b></blockquote>",
                reply_markup=kb,
                parse_mode="HTML",
                message_effect_id="5046509860389126442"  # пример эффекта 🎉
            )
        else:
            update_user_game_stats(call.from_user.id, amount, win=False)
            add_raffle_bet(call.from_user.id)
            
            # NOTIFICATION
            await notify_game_result(
                username=call.from_user.username,
                user_id=call.from_user.id,
                game_name="RPS",
                bet_amount=amount,
                win=False,
                win_amount=0
            )
            
            kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="✊ Попробовать снова", callback_data="game_rps")],
                [get_back_to_main_button()]
            ])
            
            await call.message.answer(
                f"😔 <b>{result_text}</b>\n\n"
                f"<blockquote>└ Ваша ставка: <b>${amount:.2f}</b></blockquote>\n\n"
                f"<i>Попробуйте еще раз!</i>",
                reply_markup=kb,
                parse_mode="HTML",
                message_effect_id="5046589136895476101" # пример эффекта 💩
            )
        
        await state.clear()
        await call.answer()
    except Exception as e:
        logging.error(f"RPS result error: {e}")
        await call.message.answer("❌ <b>Произошла ошибка</b>", parse_mode="HTML")

@dp.callback_query(F.data == "game_coinflip")
async def game_coinflip_start(call: types.CallbackQuery, state: FSMContext):
    try:
        await state.clear()
        await call.message.delete()
        
        cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
        ])
        
        await call.message.answer(
            "🪙 <b>Игра Монетка</b>\n\n"
            "<blockquote>├ Орел или Решка\n"
            "└ Множитель: <b>x1.9</b></blockquote>\n\n"

           f"<blockquote>ℹ️ Все исходы определяются через "
           f"(<a href=\"{PYTHON_RANDOM_URL}\">Python</a>)</blockquote>\n\n"
    
           "<b>Введите сумму ставки:</b>",
           reply_markup=cancel_kb,
           parse_mode="HTML",
           disable_web_page_preview=True
        )
        await state.set_state(CoinflipStates.waiting_amount)
        await call.answer()
    except Exception as e:
        logging.error(f"Error in game_coinflip_start: {e}")
        await call.message.answer("❌ <b>Произошла ошибка</b>", parse_mode="HTML")

@dp.message(CoinflipStates.waiting_amount)
async def game_coinflip_choice(message: types.Message, state: FSMContext):
    try:
        amount = float(message.text)
        
        if amount < MIN_BET:
            cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
            ])
            await message.answer(f"❌ <b>Минимальная ставка:</b> ${MIN_BET:.2f}", reply_markup=cancel_kb, parse_mode="HTML")
            return
        
        user = get_user(message.from_user.id)
        if not user:
            await message.answer("❌ <b>Ошибка: пользователь не найден</b>", parse_mode="HTML")
            return
        
        balance = user[2] if user[2] is not None else 0.0
        
        if amount > balance:
            cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
            ])
            await message.answer("❌ <b>Недостаточно средств</b>", reply_markup=cancel_kb, parse_mode="HTML")
            return
        
        update_user_balance_main(message.from_user.id, -amount)
        await state.update_data(coinflip_bet_amount=amount)
        
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🦅 Орел", callback_data="coinflip_choice_heads"),
             InlineKeyboardButton(text="🦫 Решка", callback_data="coinflip_choice_tails")],
            [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
        ])
        
        await message.answer("🪙 <b>Выберите сторону:</b>", reply_markup=kb, parse_mode="HTML")
    except ValueError:
        cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
        ])
        await message.answer("❌ <b>Введите корректную сумму</b>", reply_markup=cancel_kb, parse_mode="HTML")
    except Exception as e:
        logging.error(f"Coinflip error: {e}")
        kb = InlineKeyboardMarkup(inline_keyboard=[[get_back_to_main_button()]])
        await message.answer("❌ <b>Произошла ошибка</b>", reply_markup=kb, parse_mode="HTML")

@dp.callback_query(F.data.startswith("coinflip_choice_"))
async def game_coinflip_result(call: types.CallbackQuery, state: FSMContext):
    try:
        user_choice = call.data.split("_")[2]  
        data = await state.get_data()
        amount = data['coinflip_bet_amount']
        
        win = random.random() < 0.37
        
        if win:
            result = user_choice
        else:
            result = 'tails' if user_choice == 'heads' else 'heads'
        
        sticker_map = {
            'heads': STICKER_COIN_HEADS,
            'tails': STICKER_COIN_TAILS
        }
        
        await call.message.answer_sticker(sticker=sticker_map[result])
        await asyncio.sleep(2)  
        
        result_emoji = "🦅" if result == "heads" else "🦫"
        result_text = "Орел" if result == "heads" else "Решка"
        
        if win:
            win_amount = amount * COINFLIP_MULTIPLIER
            update_user_balance_main(call.from_user.id, win_amount)
            update_user_game_stats(call.from_user.id, amount, win=True)
            add_raffle_bet(call.from_user.id)
            
            # NOTIFICATION
            await notify_game_result(
                username=call.from_user.username,
                user_id=call.from_user.id,
                game_name="Coinflip",
                bet_amount=amount,
                win=True,
                win_amount=win_amount
            )
            
            kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="🪙 Еще раз", callback_data="game_coinflip")],
                [get_back_to_main_button()]
            ])
            
            await call.message.answer(
                f"🎉 <b>Победа!</b>\n\n"
                f"<blockquote>├ Ваш выбор: <b>{'Орел' if user_choice == 'heads' else 'Решка'}</b>\n"
                f"├ Выпало: <b>{result_text} {result_emoji}</b>\n"
                f"├ Ваша ставка: <b>${amount:.2f}</b>\n"
                f"├ Множитель: <b>x{COINFLIP_MULTIPLIER:.1f}</b>\n"
                f"└ Выигрыш: <b>${win_amount:.2f}</b></blockquote>",
                reply_markup=kb,
                parse_mode="HTML",
                message_effect_id="5046509860389126442"  # пример эффекта 🎉
            )
        else:
            update_user_game_stats(call.from_user.id, amount, win=False)
            add_raffle_bet(call.from_user.id)
            
            # NOTIFICATION
            await notify_game_result(
                username=call.from_user.username,
                user_id=call.from_user.id,
                game_name="Coinflip",
                bet_amount=amount,
                win=False,
                win_amount=0
            )
            
            kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="🪙 Попробовать снова", callback_data="game_coinflip")],
                [get_back_to_main_button()]
            ])
            
            await call.message.answer(
                f"😔 <b>Проигрыш</b>\n\n"
                f"<blockquote>├ Ваш выбор: <b>{'Орел' if user_choice == 'heads' else 'Решка'}</b>\n"
                f"├ Выпало: <b>{result_text} {result_emoji}</b>\n"
                f"└ Ваша ставка: <b>${amount:.2f}</b></blockquote>\n\n"
                f"<i>Попробуйте еще раз!</i>",
                reply_markup=kb,
                parse_mode="HTML",
                message_effect_id="5046589136895476101" # пример эффекта 💩
            )
        
        await state.clear()
        await call.answer()
    except Exception as e:
        logging.error(f"Coinflip result error: {e}")
        await call.message.answer("❌ <b>Произошла ошибка</b>", parse_mode="HTML")

@dp.callback_query(F.data == "game_hearts")
async def game_hearts_start(call: types.CallbackQuery, state: FSMContext):
    try:
        await state.clear()
        await call.message.delete()
        
        cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
        ])
        
        await call.message.answer(
            "❤️ <b>Игра Сердца</b>\n\n"
            "<blockquote>├ Угадайте цвет сердца\n"
            f"└ Множитель: <b>x{HEARTS_MULTIPLIER:.1f}</b></blockquote>\n\n"

            f"<blockquote>ℹ️ Все исходы определяются через "
            f"(<a href=\"{PYTHON_RANDOM_URL}\">Python</a>)</blockquote>\n\n"
    
            "<b>Введите сумму ставки:</b>",
            reply_markup=cancel_kb,
            parse_mode="HTML",
            disable_web_page_preview=True
        )
        await state.set_state(HeartsStates.waiting_amount)
        await call.answer()
    except Exception as e:
        logging.error(f"Error in game_hearts_start: {e}")
        await call.message.answer("❌ <b>Произошла ошибка</b>", parse_mode="HTML")

@dp.message(HeartsStates.waiting_amount)
async def game_hearts_amount(message: types.Message, state: FSMContext):
    try:
        amount = float(message.text)
        
        if amount < MIN_BET:
            cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
            ])
            await message.answer(f"❌ <b>Минимальная ставка:</b> ${MIN_BET:.2f}", reply_markup=cancel_kb, parse_mode="HTML")
            return
        
        user = get_user(message.from_user.id)
        if not user:
            await message.answer("❌ <b>Ошибка: пользователь не найден</b>", parse_mode="HTML")
            return
        
        balance = user[2] if user[2] is not None else 0.0
        
        if amount > balance:
            cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
            ])
            await message.answer("❌ <b>Недостаточно средств</b>", reply_markup=cancel_kb, parse_mode="HTML")
            return
        
        update_user_balance_main(message.from_user.id, -amount)
        await state.update_data(hearts_bet_amount=amount)
        
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🔵 Синее сердце", callback_data="hearts_color_blue")],
            [InlineKeyboardButton(text="🔴 Красное сердце", callback_data="hearts_color_red")],
            [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
        ])
        
        await message.answer(
            "❤️ <b>Выберите цвет сердца:</b>\n\n"
            f"<blockquote>└ Ваша ставка: <b>${amount:.2f}</b></blockquote>",
            reply_markup=kb,
            parse_mode="HTML"
        )
        await state.set_state(HeartsStates.waiting_color)
        
    except ValueError:
        cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
        ])
        await message.answer("❌ <b>Введите корректную сумму</b>", reply_markup=cancel_kb, parse_mode="HTML")
    except Exception as e:
        logging.error(f"Hearts amount error: {e}")
        kb = InlineKeyboardMarkup(inline_keyboard=[[get_back_to_main_button()]])
        await message.answer("❌ <b>Произошла ошибка</b>", reply_markup=kb, parse_mode="HTML")

@dp.callback_query(F.data.startswith("hearts_color_"))
async def game_hearts_result(call: types.CallbackQuery, state: FSMContext):
    try:
        user_color = call.data.split("_")[2]
        data = await state.get_data()
        amount = data['hearts_bet_amount']
        
        win = random.random() < 0.37
        
        if win:
            result_color = user_color
        else:
            result_color = 'red' if user_color == 'blue' else 'blue'
        
        sticker_map = {
            'blue': STICKER_BLUE_HEART,
            'red': STICKER_RED_HEART
        }
        
        await call.message.answer_sticker(sticker=sticker_map[result_color])
        await asyncio.sleep(2)
        
        color_emoji = "🔵" if result_color == "blue" else "🔴"
        color_text = "Синее" if result_color == "blue" else "Красное"
        user_color_text = "🔵 Синее" if user_color == "blue" else "🔴 Красное"
        
        if win:
            win_amount = amount * HEARTS_MULTIPLIER
            update_user_balance_main(call.from_user.id, win_amount)
            update_user_game_stats(call.from_user.id, amount, win=True)
            add_raffle_bet(call.from_user.id)
            
            # NOTIFICATION
            await notify_game_result(
                username=call.from_user.username,
                user_id=call.from_user.id,
                game_name="Hearts",
                bet_amount=amount,
                win=True,
                win_amount=win_amount
            )
            
            kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="❤️ Еще раз", callback_data="game_hearts")],
                [get_back_to_main_button()]
            ])
            
            await call.message.answer(
                f"🎉 <b>Победа!</b>\n\n"
                f"<blockquote>├ Ваш выбор: <b>{user_color_text}</b>\n"
                f"├ Выпало: <b>{color_text} {color_emoji}</b>\n"
                f"├ Ваша ставка: <b>${amount:.2f}</b>\n"
                f"├ Множитель: <b>x{HEARTS_MULTIPLIER:.1f}</b>\n"
                f"└ Выигрыш: <b>${win_amount:.2f}</b></blockquote>",
                reply_markup=kb,
                parse_mode="HTML",
                message_effect_id="5046509860389126442"  # пример эффекта 🎉
            )
        else:
            update_user_game_stats(call.from_user.id, amount, win=False)
            add_raffle_bet(call.from_user.id)
            
            # NOTIFICATION
            await notify_game_result(
                username=call.from_user.username,
                user_id=call.from_user.id,
                game_name="Hearts",
                bet_amount=amount,
                win=False,
                win_amount=0
            )
            
            kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="❤️ Попробовать снова", callback_data="game_hearts")],
                [get_back_to_main_button()]
            ])
            
            await call.message.answer(
                f"😔 <b>Проигрыш</b>\n\n"
                f"<blockquote>├ Ваш выбор: <b>{user_color_text}</b>\n"
                f"├ Выпало: <b>{color_text} {color_emoji}</b>\n"
                f"└ Ваша ставка: <b>${amount:.2f}</b></blockquote>\n\n"
                f"<i>Попробуйте еще раз!</i>",
                reply_markup=kb,
                parse_mode="HTML",
                message_effect_id="5046589136895476101" # пример эффекта 💩
            )
        
        await state.clear()
        await call.answer()
        
    except Exception as e:
        logging.error(f"Hearts result error: {e}")
        await call.message.answer("❌ <b>Произошла ошибка</b>", parse_mode="HTML")

@dp.callback_query(F.data == "game_basketball")
async def game_basketball_start(call: types.CallbackQuery, state: FSMContext):
    try:
        await state.clear()
        await call.message.delete()
        
        cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
        ])
        
        await call.message.answer(
            f"🏀 <b>Игра Баскетбол</b>\n\n"
            "<blockquote>├ Угадайте попадет мяч в кольцо или нет\n"
            f"└ Множитель: <b>x{BASKETBALL_MULTIPLIER:.1f}</b></blockquote>\n\n"

            f"<blockquote>🎲 Результаты генерируются Telegram и не могут быть изменены "
            f"(<a href=\"https://core.telegram.org/bots/api#dice\">официальная документация</a>)</blockquote>\n\n"

            "<b>Введите сумму ставки:</b>",
            reply_markup=cancel_kb,
            parse_mode="HTML",
            disable_web_page_preview=True
        )
        await state.set_state(BasketballStates.waiting_amount)
        await call.answer()
    except Exception as e:
        logging.error(f"Error in game_basketball_start: {e}")
        await call.message.answer("❌ <b>Произошла ошибка</b>", parse_mode="HTML")

@dp.message(BasketballStates.waiting_amount)
async def game_basketball_amount(message: types.Message, state: FSMContext):
    try:
        amount = float(message.text)
        
        if amount < MIN_BET:
            cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
            ])
            await message.answer(f"❌ <b>Минимальная ставка:</b> ${MIN_BET:.2f}", reply_markup=cancel_kb, parse_mode="HTML")
            return
        
        user = get_user(message.from_user.id)
        if not user:
            await message.answer("❌ <b>Ошибка: пользователь не найден</b>", parse_mode="HTML")
            return
        
        balance = user[2] if user[2] is not None else 0.0
        
        if amount > balance:
            cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
            ])
            await message.answer("❌ <b>Недостаточно средств</b>", reply_markup=cancel_kb, parse_mode="HTML")
            return
        
        update_user_balance_main(message.from_user.id, -amount)
        await state.update_data(basketball_bet_amount=amount)
        
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🏀 Гол", callback_data="basketball_choice_goal")],
            [InlineKeyboardButton(text="💨 Мимо", callback_data="basketball_choice_miss")],
            [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
        ])
        
        await message.answer(
            "🏀 <b>Выберите исход:</b>\n\n"
            f"<blockquote>└ Ваша ставка: <b>${amount:.2f}</b></blockquote>",
            reply_markup=kb,
            parse_mode="HTML"
        )
        await state.set_state(BasketballStates.waiting_choice)
        
    except ValueError:
        cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
        ])
        await message.answer("❌ <b>Введите корректную сумму</b>", reply_markup=cancel_kb, parse_mode="HTML")
    except Exception as e:
        logging.error(f"Basketball amount error: {e}")
        kb = InlineKeyboardMarkup(inline_keyboard=[[get_back_to_main_button()]])
        await message.answer("❌ <b>Произошла ошибка</b>", reply_markup=kb, parse_mode="HTML")

@dp.callback_query(F.data.startswith("basketball_choice_"))
async def game_basketball_result(call: types.CallbackQuery, state: FSMContext):
    try:
        user_choice = call.data.split("_")[2]  # goal или miss
        data = await state.get_data()
        amount = data['basketball_bet_amount']
        
        basketball_msg = await call.message.answer_dice(emoji="🏀")
        await asyncio.sleep(4)  # Ожидание анимации
        
        basketball_value = basketball_msg.dice.value
        
        outcomes = {
            1: "miss", 2: "miss", 3: "miss",
            4: "goal", 5: "goal"
        }
        result = outcomes.get(basketball_value, "miss")
        
        is_win = result == user_choice
        winnings = amount * BASKETBALL_MULTIPLIER if is_win else 0
        
        if is_win:
            update_user_balance_main(call.from_user.id, winnings)
        
        update_user_game_stats(call.from_user.id, amount, win=is_win)
        add_raffle_bet(call.from_user.id)
        
        # NOTIFICATION
        await notify_game_result(
            username=call.from_user.username,
            user_id=call.from_user.id,
            game_name="Basketball",
            bet_amount=amount,
            win=is_win,
            win_amount=winnings if is_win else 0
        )
        
        result_emoji = "🏀✅" if result == "goal" else "🏀💨"
        result_text = "Гол" if result == "goal" else "Мимо"
        user_choice_text = "Гол" if user_choice == "goal" else "Мимо"
        
        if is_win:
            kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="🏀 Еще раз", callback_data="game_basketball")],
                [get_back_to_main_button()]
            ])
            
            await call.message.answer(
                f"🎉 <b>Победа!</b>\n\n"
                f"<blockquote>├ Ваш выбор: <b>{user_choice_text}</b>\n"
                f"├ Результат: <b>{result_text} {result_emoji}</b>\n"
                f"├ Ваша ставка: <b>${amount:.2f}</b>\n"
                f"├ Множитель: <b>x{BASKETBALL_MULTIPLIER:.1f}</b>\n"
                f"└ Выигрыш: <b>${winnings:.2f}</b></blockquote>",
                reply_markup=kb,
                parse_mode="HTML",
                message_effect_id="5046509860389126442"  # пример эффекта 🎉
            )
        else:
            kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="🏀 Попробовать снова", callback_data="game_basketball")],
                [get_back_to_main_button()]
            ])
            
            await call.message.answer(
                f"😔 <b>Проигрыш</b>\n\n"
                f"<blockquote>├ Ваш выбор: <b>{user_choice_text}</b>\n"
                f"├ Результат: <b>{result_text} {result_emoji}</b>\n"
                f"└ Ваша ставка: <b>${amount:.2f}</b></blockquote>\n\n"
                f"<i>Попробуйте еще раз!</i>",
                reply_markup=kb,
                parse_mode="HTML",
                message_effect_id="5046589136895476101" # пример эффекта 💩
            )
        
        await state.clear()
        await call.answer()
        
    except Exception as e:
        logging.error(f"Basketball result error: {e}")
        await call.message.answer("❌ <b>Произошла ошибка</b>", parse_mode="HTML")

@dp.callback_query(F.data == "game_russian_roulette")
async def game_russian_roulette_start(call: types.CallbackQuery, state: FSMContext):
    try:
        await state.clear()
        await call.message.delete()
        
        cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
        ])
        
        await call.message.answer(
            f"🔫 <b>Русская рулетка</b>\n\n"
            "<blockquote>├ Выберите количество пуль в барабане\n"
            "└ Шанс выжить: <b>зависит от пуль</b></blockquote>\n\n"
    
            f"<blockquote>ℹ️ Все исходы генерируются с помощью "
            f"(<a href=\"{PYTHON_RANDOM_URL}\">Python</a>) </blockquote>\n\n"
    
            "<b>Введите сумму ставки:</b>",
            reply_markup=cancel_kb,
            parse_mode="HTML",
            disable_web_page_preview=True
        )
        await state.set_state(RussianRouletteStates.waiting_amount)
        await call.answer()
    except Exception as e:
        logging.error(f"Error in game_russian_roulette_start: {e}")
        await call.message.answer("❌ <b>Произошла ошибка</b>", parse_mode="HTML")

@dp.message(RussianRouletteStates.waiting_amount)
async def game_russian_roulette_amount(message: types.Message, state: FSMContext):
    try:
        amount = float(message.text)
        
        if amount < MIN_BET:
            cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
            ])
            await message.answer(f"❌ <b>Минимальная ставка:</b> ${MIN_BET:.2f}", reply_markup=cancel_kb, parse_mode="HTML")
            return
        
        if amount > 200:
            cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
            ])
            await message.answer("❌ <b>Максимальная ставка:</b> $200", reply_markup=cancel_kb, parse_mode="HTML")
            return
        
        user = get_user(message.from_user.id)
        if not user:
            await message.answer("❌ <b>Ошибка: пользователь не найден</b>", parse_mode="HTML")
            return
        
        balance = user[2] if user[2] is not None else 0.0
        
        if amount > balance:
            cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
            ])
            await message.answer("❌ <b>Недостаточно средств</b>", reply_markup=cancel_kb, parse_mode="HTML")
            return
        
        update_user_balance_main(message.from_user.id, -amount)
        await state.update_data(roulette_bet_amount=amount)
        
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="3 пули (x1.9)", callback_data="roulette_bullets_3")],
            [InlineKeyboardButton(text="4 пули (x2.8)", callback_data="roulette_bullets_4")],
            [InlineKeyboardButton(text="5 пуль (x5.7)", callback_data="roulette_bullets_5")],
            [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
        ])
        
        await message.answer(
            "🔫 <b>Выберите количество пуль:</b>\n\n"
            f"<blockquote>└ Ваша ставка: <b>${amount:.2f}</b></blockquote>",
            reply_markup=kb,
            parse_mode="HTML"
        )
        await state.set_state(RussianRouletteStates.waiting_bullets)
        
    except ValueError:
        cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
        ])
        await message.answer("❌ <b>Введите корректную сумму</b>", reply_markup=cancel_kb, parse_mode="HTML")
    except Exception as e:
        logging.error(f"Roulette amount error: {e}")
        kb = InlineKeyboardMarkup(inline_keyboard=[[get_back_to_main_button()]])
        await message.answer("❌ <b>Произошла ошибка</b>", reply_markup=kb, parse_mode="HTML")

@dp.callback_query(F.data.startswith("roulette_bullets_"))
async def game_russian_roulette_result(call: types.CallbackQuery, state: FSMContext):
    try:
        bullet_count = int(call.data.split("_")[2])
        data = await state.get_data()
        amount = data['roulette_bet_amount']
        
        chambers = [True] * bullet_count + [False] * (6 - bullet_count)
        random.shuffle(chambers)
        is_win = not chambers[0]
        
        multiplier = RUSSIAN_ROULETTE_MULTIPLIERS.get(bullet_count, 1.0)
        winnings = amount * multiplier if is_win else 0
        
        if is_win:
            update_user_balance_main(call.from_user.id, winnings)
        
        update_user_game_stats(call.from_user.id, amount, win=is_win)
        add_raffle_bet(call.from_user.id)
        
        # NOTIFICATION
        choice_display = {3: "3 пули", 4: "4 пули", 5: "5 пуль"}
        await notify_game_result(
            username=call.from_user.username,
            user_id=call.from_user.id,
            game_name=f"Roulette {choice_display.get(bullet_count, 'Неизвестно')}",
            bet_amount=amount,
            win=is_win,
            win_amount=winnings if is_win else 0
        )
        
        # Отправка стикера
        sticker_map = {
            3: {
                "win": [f"{STICKERS_PATH}/win3_bullets_1.tgs", f"{STICKERS_PATH}/win3_bullets_2.tgs", f"{STICKERS_PATH}/win3_bullets_3.tgs"],
                "lose": [f"{STICKERS_PATH}/lose3_bullets_1.tgs", f"{STICKERS_PATH}/lose3_bullets_2.tgs", f"{STICKERS_PATH}/lose3_bullets_3.tgs"]
            },
            4: {
                "win": [f"{STICKERS_PATH}/win4_bullets_1.tgs"],
                "lose": [f"{STICKERS_PATH}/lose4_bullets_1.tgs", f"{STICKERS_PATH}/lose4_bullets_2.tgs"]
            },
            5: {
                "win": [f"{STICKERS_PATH}/win5_bullets_1.tgs"],
                "lose": [f"{STICKERS_PATH}/lose5_bullets_1.tgs", f"{STICKERS_PATH}/lose5_bullets_2.tgs", f"{STICKERS_PATH}/lose5_bullets_3.tgs", f"{STICKERS_PATH}/lose5_bullets_4.tgs"]
            }
        }
        
        outcome_type = "win" if is_win else "lose"
        available_stickers = sticker_map.get(bullet_count, {}).get(outcome_type, [])
        
        if available_stickers:
            sticker_path = random.choice(available_stickers)
            if os.path.exists(sticker_path):
                sticker_file = FSInputFile(sticker_path)
                await call.message.answer_sticker(sticker=sticker_file)
                await asyncio.sleep(1.5)
        
        if is_win:
            kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="🔫 Еще раз", callback_data="game_russian_roulette")],
                [get_back_to_main_button()]
            ])
            
            await call.message.answer(
                f"🎉 <b>Победа!</b>\n\n"
                f"<blockquote>├ Ваш выбор: <b>{choice_display.get(bullet_count, 'Неизвестно')}</b>\n"
                f"├ Ваша ставка: <b>${amount:.2f}</b>\n"
                f"├ Множитель: <b>x{multiplier:.2f}</b>\n"
                f"└ Выигрыш: <b>${winnings:.2f}</b></blockquote>",
                reply_markup=kb,
                parse_mode="HTML",
                message_effect_id="5046509860389126442"  # пример эффекта 🎉
            )
        else:
            kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="🔫 Попробовать снова", callback_data="game_russian_roulette")],
                [get_back_to_main_button()]
            ])
            
            await call.message.answer(
                f"💀 <b>Проигрыш</b>\n\n"
                f"<blockquote>├ Ваш выбор: <b>{choice_display.get(bullet_count, 'Неизвестно')}</b>\n"
                f"└ Ваша ставка: <b>${amount:.2f}</b></blockquote>\n\n"
                f"<i>Попробуйте еще раз!</i>",
                reply_markup=kb,
                parse_mode="HTML",
                message_effect_id="5046589136895476101" # пример эффекта 💩
            )
        
        await state.clear()
        await call.answer()
        
    except Exception as e:
        logging.error(f"Roulette result error: {e}")
        await call.message.answer("❌ <b>Произошла ошибка</b>", parse_mode="HTML")

@dp.callback_query(F.data == "game_roulette")
async def game_roulette_start(call: types.CallbackQuery, state: FSMContext):
    try:
        await state.clear()
        await call.message.delete()
        
        cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
        ])
        
        await call.message.answer(
            "🎰 <b>Рулетка (0-14)</b>\n\n"
            "<blockquote>├ Угадайте число от 0 до 14\n"
            f"└ Множитель: <b>x{ROULETTE_MULTIPLIER:.1f}</b></blockquote>\n\n"

            "<blockquote>ℹ️ Все исходы генерируются с помощью "
            "<a href=\"https://docs.python.org/3/library/random.html\">(Python)</a></blockquote>\n\n"

            "<b>Введите сумму ставки:</b>",
            reply_markup=cancel_kb,
            parse_mode="HTML",
            disable_web_page_preview=True
        )
        await state.set_state(RouletteStates.waiting_amount)
        await call.answer()
    except Exception as e:
        logging.error(f"Error in game_roulette_start: {e}")
        await call.message.answer("❌ <b>Произошла ошибка</b>", parse_mode="HTML")

@dp.message(RouletteStates.waiting_amount)
async def game_roulette_amount(message: types.Message, state: FSMContext):
    try:
        amount = float(message.text)
        
        if amount < MIN_BET:
            cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
            ])
            await message.answer(f"❌ <b>Минимальная ставка:</b> ${MIN_BET:.2f}", reply_markup=cancel_kb, parse_mode="HTML")
            return
        
        user = get_user(message.from_user.id)
        if not user:
            await message.answer("❌ <b>Ошибка: пользователь не найден</b>", parse_mode="HTML")
            return
        
        balance = user[2] if user[2] is not None else 0.0
        
        if amount > balance:
            cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
            ])
            await message.answer("❌ <b>Недостаточно средств</b>", reply_markup=cancel_kb, parse_mode="HTML")
            return
        
        update_user_balance_main(message.from_user.id, -amount)
        await state.update_data(roulette_bet_amount=amount)
        
        number_buttons = []
        row = []
        for i in range(15):
            row.append(InlineKeyboardButton(text=str(i), callback_data=f"roulette_num_{i}"))
            if (i + 1) % 4 == 0 or i == 14:
                number_buttons.append(row)
                row = []
        
        number_buttons.append([InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")])
        kb = InlineKeyboardMarkup(inline_keyboard=number_buttons)
        
        await message.answer(
            "🎰 <b>Выберите число:</b>\n\n"
            f"<blockquote>└ Ваша ставка: <b>${amount:.2f}</b></blockquote>",
            reply_markup=kb,
            parse_mode="HTML"
        )
        await state.set_state(RouletteStates.waiting_number)
        
    except ValueError:
        cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
        ])
        await message.answer("❌ <b>Введите корректную сумму</b>", reply_markup=cancel_kb, parse_mode="HTML")
    except Exception as e:
        logging.error(f"Roulette amount error: {e}")
        kb = InlineKeyboardMarkup(inline_keyboard=[[get_back_to_main_button()]])
        await message.answer("❌ <b>Произошла ошибка</b>", reply_markup=kb, parse_mode="HTML")

@dp.callback_query(F.data.startswith("roulette_num_"))
async def game_roulette_result(call: types.CallbackQuery, state: FSMContext):
    try:
        user_number = int(call.data.split("_")[2])
        data = await state.get_data()
        amount = data['roulette_bet_amount']
        
        result_number = random.randint(0, 14)
        is_win = user_number == result_number
        winnings = amount * ROULETTE_MULTIPLIER if is_win else 0
        
        if is_win:
            update_user_balance_main(call.from_user.id, winnings)
        
        update_user_game_stats(call.from_user.id, amount, win=is_win)
        add_raffle_bet(call.from_user.id)
        
        # NOTIFICATION
        await notify_game_result(
            username=call.from_user.username,
            user_id=call.from_user.id,
            game_name="Roulette",
            bet_amount=amount,
            win=is_win,
            win_amount=winnings if is_win else 0
        )
        
        video_path = f"{VIDEO_PATH}/{result_number}"
        possible_extensions = ['.mp4', '.gif', '.MOV', '.avi', '.mkv']
        video_file = None
        for ext in possible_extensions:
            if os.path.exists(f"{video_path}{ext}"):
                video_file = FSInputFile(f"{video_path}{ext}")
                break
        
        if video_file:
            await call.message.answer_video(video=video_file)
            await asyncio.sleep(4)
        
        if is_win:
            kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="🎰 Еще раз", callback_data="game_roulette")],
                [get_back_to_main_button()]
            ])
            
            await call.message.answer(
                f"🎉 <b>Победа!</b>\n\n"
                f"<blockquote>├ Ваше число: <b>{user_number}</b>\n"
                f"├ Выпало: <b>{result_number}</b>\n"
                f"├ Ваша ставка: <b>${amount:.2f}</b>\n"
                f"├ Множитель: <b>x{ROULETTE_MULTIPLIER:.1f}</b>\n"
                f"└ Выигрыш: <b>${winnings:.2f}</b></blockquote>",
                reply_markup=kb,
                parse_mode="HTML",
                message_effect_id="5046509860389126442"  # пример эффекта 🎉
            )
        else:
            kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="🎰 Попробовать снова", callback_data="game_roulette")],
                [get_back_to_main_button()]
            ])
            
            await call.message.answer(
                f"😔 <b>Проигрыш</b>\n\n"
                f"<blockquote>├ Ваше число: <b>{user_number}</b>\n"
                f"├ Выпало: <b>{result_number}</b>\n"
                f"└ Ваша ставка: <b>${amount:.2f}</b></blockquote>\n\n"
                f"<i>Попробуйте еще раз!</i>",
                reply_markup=kb,
                parse_mode="HTML",
                message_effect_id="5046589136895476101" # пример эффекта 💩
            )
        
        await state.clear()
        await call.answer()
        
    except Exception as e:
        logging.error(f"Roulette result error: {e}")
        await call.message.answer("❌ <b>Произошла ошибка</b>", parse_mode="HTML")

@dp.callback_query(F.data == "menu_cases")
async def menu_cases_callback(call: types.CallbackQuery, state: FSMContext):
    """Меню кейсов"""
    try:
        await state.clear()
        text = get_cases_menu_text()
        kb = cases_game.get_case_menu_keyboard()
        await call.message.edit_text(text, reply_markup=kb, parse_mode="HTML")
        await call.answer()
    except Exception as e:
        logging.error(f"Error in menu_cases: {e}")
        await call.message.answer("❌ <b>Произошла ошибка</b>", parse_mode="HTML")

@dp.callback_query(F.data == "case_odds")
async def case_odds_callback(call: types.CallbackQuery):
    """Показать шансы"""
    try:
        text = cases_game.get_odds_text()
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🔙 Назад", callback_data="menu_cases")]
        ])
        await call.message.edit_text(text, reply_markup=kb, parse_mode="HTML")
        await call.answer()
    except Exception as e:
        logging.error(f"Error in case_odds: {e}")

@dp.callback_query(F.data == "case_inventory")
async def case_inventory_callback(call: types.CallbackQuery):
    """История открытий"""
    try:
        stats = get_user_case_stats(call.from_user.id)
        text = f"""
🎒 <b>История кейсов</b>

<blockquote>├ Открыто кейсов: <b>{stats['total_opened']}</b>
├ Побед: <b>{stats['wins']}</b>
├ Потрачено: <b>{stats['total_spent']} ⭐</b>
└ Выиграно на: <b>{stats['total_won']} ⭐</b></blockquote>

<i>Подарки отправляются автоматически</i>
"""
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🔙 Назад", callback_data="menu_cases")]
        ])
        await call.message.edit_text(text, reply_markup=kb, parse_mode="HTML")
        await call.answer()
    except Exception as e:
        logging.error(f"Error in case_inventory: {e}")

@dp.callback_query(F.data == "case_open")
async def case_open_callback(call: types.CallbackQuery, state: FSMContext):
    """Создание инвойса для оплаты"""
    try:
        price = cases_game.get_case_price()
        prices = [LabeledPrice(label=f"🎁 Кейс", amount=price)]
        
        await bot.send_invoice(
            chat_id=call.message.chat.id,
            title="🎁 Открытие кейса",
            description=f"Оплатите {price} Stars для открытия кейса",
            payload=f"case_open_{call.from_user.id}_{int(time.time())}_{random.randint(1000, 9999)}",
            provider_token="",
            currency="XTR",
            prices=prices,
            start_parameter="case_payment"
        )
        await call.answer()
    except Exception as e:
        logging.error(f"Error in case_open: {e}")
        await call.answer("❌ Ошибка создания платежа", show_alert=True)

@dp.pre_checkout_query()
async def case_pre_checkout_handler(pre_checkout_query: PreCheckoutQuery):
    """Подтверждение оплаты"""
    try:
        if pre_checkout_query.invoice_payload.startswith("case_open_"):
            await bot.answer_pre_checkout_query(pre_checkout_query.id, ok=True)
    except Exception as e:
        logging.error(f"Pre-checkout error: {e}")

@dp.message(F.successful_payment)
async def case_successful_payment(message: types.Message, state: FSMContext):
    """Обработка оплаты и открытие кейса"""
    try:
        payment = message.successful_payment
        
        if not payment.invoice_payload.startswith("case_open_"):
            return
        
        # Анимация открытия
        msg = await message.answer("🎁 <b>Кейс открывается...</b>", parse_mode="HTML")
        await simulate_opening_animation(bot, message.chat.id, msg.message_id)
        
        # Определяем выигрыш
        result = cases_game.open_case()
        
        # Генерируем комментарий для подарка
        win_comment = cases_game.get_random_comment()
        
        # Сохраняем в БД
        save_case_opening(
            user_id=message.from_user.id,
            item_id=result["item_id"],
            item_name=result["name"],
            stars_spent=CASE_PRICE_STARS,
            stars_won=result["value_stars"],
            gift_id=result["gift_id"]
        )
        
        # Получаем данные пользователя
        user = get_user(message.from_user.id)
        username = user[1] if user else "Unknown"
        
        if result["is_empty"]:
            # ПРОИГРЫШ - НЕ отправляем уведомление админу
            text = f"""
❌ <b>Пусто!</b>

<blockquote>├ Кейс оказался пустым
└ Попробуйте еще раз!</blockquote>

<i>Удача отвернулась... но следующий кейс может быть счастливым! 🍀</i>
"""
        else:
            # ВЫИГРЫШ - Отправляем уведомление админу ТОЛЬКО сейчас
            profit = result["value_stars"] - CASE_PRICE_STARS
            
            # УВЕДОМЛЕНИЕ АДМИНУ (только выигрыш, без суммы ставки, с подарком)
            if not result["gift_id"] or result["gift_id"].startswith("YOUR_"):
                # Gift ID не настроен - просим отправить вручную
                await notify_admin(
                    f"🎁 <b>ВЫИГРЫШ В КЕЙСЕ</b>\n\n"
                    f"<blockquote>├ Игрок: @{username} (ID: <code>{message.from_user.id}</code>)\n"
                    f"├ Выиграл: <b>{result['name']}</b> 🎉\n"
                    f"└ Комментарий: <i>{win_comment}</i></blockquote>\n\n"
                )
            else:
                # Пытаемся отправить автоматически
                success, sent_comment = await cases_game.send_gift(
                    message.from_user.id, 
                    result["gift_id"],
                    comment=win_comment
                )
                
                if success:
                    # Успешно отправлено
                    await notify_admin(
                        f"✅ <b>ПОДАРОК ОТПРАВЛЕН</b>\n\n"
                        f"<blockquote>├ Игрок: @{username}\n"
                        f"├ Подарок: <b>{result['name']}</b>\n"
                        f"└ Статус: <b>Автоматически</b></blockquote>"
                    )
                else:
                    # Не удалось отправить автоматически
                    await notify_admin(
                        f"⚠️ <b>ВЫИГРЫШ (Требуется ручная отправка)</b>\n\n"
                        f"<blockquote>├ Игрок: @{username} (ID: <code>{message.from_user.id}</code>)\n"
                    f"├ Выиграл: <b>{result['name']}</b>\n"
                    f"├ Gift ID: <code>{result['gift_id']}</code>\n"
                        f"└ Комментарий: <i>{win_comment}</i></blockquote>\n\n"
                        f"<b>⚡ Действие:</b> Обратитесь в поддержку "
                    )
            
            # Текст для пользователя
            text = f"""
🎉 <b>ВЫИГРЫШ!</b> {result['emoji']}

<blockquote>├ Выпало: <b>{result['name']}</b>
├ Стоимость: <b>{result['value_stars']} ⭐</b>
└ Прибыль: <b>+{profit} ⭐</b></blockquote>

<i>{win_comment}</i>
"""
        
        # Показываем результат пользователю
        kb = cases_game.get_result_keyboard(is_empty=result["is_empty"])
        
        await bot.edit_message_text(
            chat_id=message.chat.id,
            message_id=msg.message_id,
            text=text,
            reply_markup=kb,
            parse_mode="HTML"
        )
        
    except Exception as e:
        logging.error(f"Error in case payment: {e}")
        await message.answer("❌ <b>Ошибка открытия кейса</b>", parse_mode="HTML")

@dp.callback_query(F.data == "game_rainbow")
async def game_rainbow_start(call: types.CallbackQuery, state: FSMContext):
    await state.clear()
    await call.message.delete()
    cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
    ])
    await call.message.answer(
        "🌈 <b>Игра Rainbow</b>\n\n"
        "<blockquote>├ Множитель: <b>x2</b>\n"
        f"├ Шанс выигрыша: <b>{RAINBOW_DISPLAY_CHANCE}</b>\n"
        "└ Ставка списывается сразу</blockquote>\n\n"
        "<b>Введите сумму ставки:</b>",
        reply_markup=cancel_kb,
        parse_mode="HTML"
    )
    await state.set_state(RainbowStates.waiting_amount)
    await call.answer()

@dp.message(RainbowStates.waiting_amount)
async def game_rainbow_amount(message: types.Message, state: FSMContext):
    try:
        amount = float(message.text)
        if amount < MIN_BET:
            cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
            ])
            await message.answer(f"❌ Минимальная ставка: ${MIN_BET:.2f}", reply_markup=cancel_kb, parse_mode="HTML")
            return
        user = get_user(message.from_user.id)
        if not user:
            await message.answer("❌ Ошибка: пользователь не найден")
            return
        balance = user[2] if user[2] is not None else 0.0
        if amount > balance:
            cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
            ])
            await message.answer("❌ Недостаточно средств", reply_markup=cancel_kb, parse_mode="HTML")
            return
        update_user_balance_main(message.from_user.id, -amount)
        await state.update_data(rainbow_bet_amount=amount)
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🌈 Крутить!", callback_data="rainbow_play")],
            [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
        ])
        await message.answer(
            f"🌈 <b>Ваша ставка: ${amount:.2f}</b>\n"
            "Нажмите кнопку, чтобы сыграть:",
            reply_markup=kb,
            parse_mode="HTML"
        )
    except ValueError:
        await message.answer("❌ Введите корректную сумму")

@dp.callback_query(F.data == "rainbow_play")
async def game_rainbow_play(call: types.CallbackQuery, state: FSMContext):
    data = await state.get_data()
    amount = data.get('rainbow_bet_amount')
    if not amount:
        await call.answer("Ошибка, начните заново", show_alert=True)
        return
    # Отправляем стикер
    try:
        await call.message.answer_sticker(sticker=STICKER_RAINBOW)
    except:
        pass
    await asyncio.sleep(1.5)
    # Определяем результат
    import random
    win = random.random() < RAINBOW_WIN_CHANCE
    if win:
        win_amount = amount * RAINBOW_MULTIPLIER
        update_user_balance_main(call.from_user.id, win_amount)
        update_user_game_stats(call.from_user.id, amount, win=True)
        add_raffle_bet(call.from_user.id)
        await notify_game_result(
            username=call.from_user.username,
            user_id=call.from_user.id,
            game_name="Rainbow",
            bet_amount=amount,
            win=True,
            win_amount=win_amount
        )
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🌈 Ещё раз", callback_data="game_rainbow")],
            [get_back_to_main_button()]
        ])
        await call.message.answer(
            f"🎉 <b>Победа!</b>\n\n"
            f"<blockquote>├ Ставка: ${amount:.2f}\n"
            f"├ Множитель: x{RAINBOW_MULTIPLIER}\n"
            f"└ Выигрыш: ${win_amount:.2f}</blockquote>",
            reply_markup=kb,
            parse_mode="HTML",
            message_effect_id="5046509860389126442"  # пример эффекта 🎉
        )
    else:
        update_user_game_stats(call.from_user.id, amount, win=False)
        add_raffle_bet(call.from_user.id)
        await notify_game_result(
            username=call.from_user.username,
            user_id=call.from_user.id,
            game_name="Rainbow",
            bet_amount=amount,
            win=False,
            win_amount=0
        )
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🌈 Попробовать снова", callback_data="game_rainbow")],
            [get_back_to_main_button()]
        ])
        await call.message.answer(
            f"😔 <b>Проигрыш</b>\n\n"
            f"<blockquote>└ Ставка: ${amount:.2f}</blockquote>",
            reply_markup=kb,
            parse_mode="HTML",
            message_effect_id="5046589136895476101" # пример эффекта 💩
        )
    await state.clear()

@dp.callback_query(F.data == "game_x3")
async def game_x3_start(call: types.CallbackQuery, state: FSMContext):
    await state.clear()
    await call.message.delete()
    cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
    ])
    await call.message.answer(
        "🔥 <b>Игра X3</b>\n\n"
        "<blockquote>├ Множитель: <b>x3</b>\n"
        f"├ Шанс выигрыша: <b>{GAMES_MULTIPLIER['x3']['display']}</b>\n"
        "└ Ставка списывается сразу</blockquote>\n\n"
        "<b>Введите сумму ставки:</b>",
        reply_markup=cancel_kb,
        parse_mode="HTML"
    )
    await state.set_state(X3States.waiting_amount)
    await call.answer()

@dp.message(X3States.waiting_amount)
async def game_x3_amount(message: types.Message, state: FSMContext):
    try:
        amount = float(message.text)
        if amount < MIN_BET:
            cancel_kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]])
            await message.answer(f"❌ Минимальная ставка: ${MIN_BET:.2f}", reply_markup=cancel_kb, parse_mode="HTML")
            return
        user = get_user(message.from_user.id)
        if not user:
            await message.answer("❌ Ошибка: пользователь не найден")
            return
        balance = user[2] if user[2] is not None else 0.0
        if amount > balance:
            cancel_kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]])
            await message.answer("❌ Недостаточно средств", reply_markup=cancel_kb, parse_mode="HTML")
            return
        update_user_balance_main(message.from_user.id, -amount)
        await state.update_data(x3_bet_amount=amount)
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🔥 Крутить!", callback_data="x3_play")],
            [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
        ])
        await message.answer(f"🔥 <b>Ваша ставка: ${amount:.2f}</b>\nНажмите кнопку, чтобы сыграть:", reply_markup=kb, parse_mode="HTML")
    except ValueError:
        await message.answer("❌ Введите корректную сумму")

@dp.callback_query(F.data == "x3_play")
async def game_x3_play(call: types.CallbackQuery, state: FSMContext):
    data = await state.get_data()
    amount = data.get('x3_bet_amount')
    if not amount:
        await call.answer("Ошибка, начните заново", show_alert=True)
        return
    try:
        await call.message.answer_sticker(sticker=STICKER_X3)
    except:
        pass
    await asyncio.sleep(1.5)
    win = random.random() < GAMES_MULTIPLIER['x3']['win_chance']
    if win:
        win_amount = amount * GAMES_MULTIPLIER['x3']['multiplier']
        update_user_balance_main(call.from_user.id, win_amount)
        update_user_game_stats(call.from_user.id, amount, win=True)
        add_raffle_bet(call.from_user.id)
        await notify_game_result(
            username=call.from_user.username,
            user_id=call.from_user.id,
            game_name="X3",
            bet_amount=amount,
            win=True,
            win_amount=win_amount
        )
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🔥 Ещё раз", callback_data="game_x3")],
            [get_back_to_main_button()]
        ])
        await call.message.answer(
            f"🎉 <b>Победа!</b>\n\n"
            f"<blockquote>├ Ставка: ${amount:.2f}\n"
            f"├ Множитель: x{GAMES_MULTIPLIER['x3']['multiplier']}\n"
            f"└ Выигрыш: ${win_amount:.2f}</blockquote>",
            reply_markup=kb,
            parse_mode="HTML",
            message_effect_id="5046509860389126442"  # пример эффекта 🎉
        )
    else:
        update_user_game_stats(call.from_user.id, amount, win=False)
        add_raffle_bet(call.from_user.id)
        await notify_game_result(
            username=call.from_user.username,
            user_id=call.from_user.id,
            game_name="X3",
            bet_amount=amount,
            win=False,
            win_amount=0
        )
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🔥 Попробовать снова", callback_data="game_x3")],
            [get_back_to_main_button()]
        ])
        await call.message.answer(
            f"😔 <b>Проигрыш</b>\n\n<blockquote>└ Ставка: ${amount:.2f}</blockquote>",
            reply_markup=kb,
            parse_mode="HTML",
            message_effect_id="5046589136895476101" # пример эффекта 💩
        )
    await state.clear()

@dp.callback_query(F.data == "game_x5")
async def game_x5_start(call: types.CallbackQuery, state: FSMContext):
    await state.clear()
    await call.message.delete()
    cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
    ])
    await call.message.answer(
        "🎈 <b>Игра X5</b>\n\n"
        "<blockquote>├ Множитель: <b>x5</b>\n"
        f"├ Шанс выигрыша: <b>{GAMES_MULTIPLIER['x5']['display']}</b>\n"
        "└ Ставка списывается сразу</blockquote>\n\n"
        "<b>Введите сумму ставки:</b>",
        reply_markup=cancel_kb,
        parse_mode="HTML"
    )
    await state.set_state(X5States.waiting_amount)
    await call.answer()

@dp.message(X5States.waiting_amount)
async def game_x5_amount(message: types.Message, state: FSMContext):
    try:
        amount = float(message.text)
        if amount < MIN_BET:
            cancel_kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]])
            await message.answer(f"❌ Минимальная ставка: ${MIN_BET:.2f}", reply_markup=cancel_kb, parse_mode="HTML")
            return
        user = get_user(message.from_user.id)
        if not user:
            await message.answer("❌ Ошибка: пользователь не найден")
            return
        balance = user[2] if user[2] is not None else 0.0
        if amount > balance:
            cancel_kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]])
            await message.answer("❌ Недостаточно средств", reply_markup=cancel_kb, parse_mode="HTML")
            return
        update_user_balance_main(message.from_user.id, -amount)
        await state.update_data(x5_bet_amount=amount)
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🎈 Крутить!", callback_data="x5_play")],
            [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
        ])
        await message.answer(f"🎈 <b>Ваша ставка: ${amount:.2f}</b>\nНажмите кнопку, чтобы сыграть:", reply_markup=kb, parse_mode="HTML")
    except ValueError:
        await message.answer("❌ Введите корректную сумму")

@dp.callback_query(F.data == "x5_play")
async def game_x5_play(call: types.CallbackQuery, state: FSMContext):
    data = await state.get_data()
    amount = data.get('x5_bet_amount')
    if not amount:
        await call.answer("Ошибка, начните заново", show_alert=True)
        return
    try:
        await call.message.answer_sticker(sticker=STICKER_X5)
    except:
        pass
    await asyncio.sleep(1.5)
    win = random.random() < GAMES_MULTIPLIER['x5']['win_chance']
    if win:
        win_amount = amount * GAMES_MULTIPLIER['x5']['multiplier']
        update_user_balance_main(call.from_user.id, win_amount)
        update_user_game_stats(call.from_user.id, amount, win=True)
        add_raffle_bet(call.from_user.id)
        await notify_game_result(
            username=call.from_user.username,
            user_id=call.from_user.id,
            game_name="X5",
            bet_amount=amount,
            win=True,
            win_amount=win_amount
        )
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🎈 Ещё раз", callback_data="game_x5")],
            [get_back_to_main_button()]
        ])
        await call.message.answer(
            f"🎉 <b>Победа!</b>\n\n"
            f"<blockquote>├ Ставка: ${amount:.2f}\n"
            f"├ Множитель: x{GAMES_MULTIPLIER['x5']['multiplier']}\n"
            f"└ Выигрыш: ${win_amount:.2f}</blockquote>",
            reply_markup=kb,
            parse_mode="HTML",
            message_effect_id="5046509860389126442"  # пример эффекта 🎉
        )
    else:
        update_user_game_stats(call.from_user.id, amount, win=False)
        add_raffle_bet(call.from_user.id)
        await notify_game_result(
            username=call.from_user.username,
            user_id=call.from_user.id,
            game_name="X5",
            bet_amount=amount,
            win=False,
            win_amount=0
        )
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🎈 Попробовать снова", callback_data="game_x5")],
            [get_back_to_main_button()]
        ])
        await call.message.answer(
            f"😔 <b>Проигрыш</b>\n\n<blockquote>└ Ставка: ${amount:.2f}</blockquote>",
            reply_markup=kb,
            parse_mode="HTML",
            message_effect_id="5046589136895476101" # пример эффекта 💩
        )
    await state.clear()

@dp.callback_query(F.data == "game_x10")
async def game_x10_start(call: types.CallbackQuery, state: FSMContext):
    await state.clear()
    await call.message.delete()
    cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
    ])
    await call.message.answer(
        "🥚 <b>Игра X10</b>\n\n"
        "<blockquote>├ Множитель: <b>x10</b>\n"
        f"├ Шанс выигрыша: <b>{GAMES_MULTIPLIER['x10']['display']}</b>\n"
        "└ Ставка списывается сразу</blockquote>\n\n"
        "<b>Введите сумму ставки:</b>",
        reply_markup=cancel_kb,
        parse_mode="HTML"
    )
    await state.set_state(X10States.waiting_amount)
    await call.answer()

@dp.message(X10States.waiting_amount)
async def game_x10_amount(message: types.Message, state: FSMContext):
    try:
        amount = float(message.text)
        if amount < MIN_BET:
            cancel_kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]])
            await message.answer(f"❌ Минимальная ставка: ${MIN_BET:.2f}", reply_markup=cancel_kb, parse_mode="HTML")
            return
        user = get_user(message.from_user.id)
        if not user:
            await message.answer("❌ Ошибка: пользователь не найден")
            return
        balance = user[2] if user[2] is not None else 0.0
        if amount > balance:
            cancel_kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]])
            await message.answer("❌ Недостаточно средств", reply_markup=cancel_kb, parse_mode="HTML")
            return
        update_user_balance_main(message.from_user.id, -amount)
        await state.update_data(x10_bet_amount=amount)
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🥚 Крутить!", callback_data="x10_play")],
            [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
        ])
        await message.answer(f"🥚 <b>Ваша ставка: ${amount:.2f}</b>\nНажмите кнопку, чтобы сыграть:", reply_markup=kb, parse_mode="HTML")
    except ValueError:
        await message.answer("❌ Введите корректную сумму")

@dp.callback_query(F.data == "x10_play")
async def game_x10_play(call: types.CallbackQuery, state: FSMContext):
    data = await state.get_data()
    amount = data.get('x10_bet_amount')
    if not amount:
        await call.answer("Ошибка, начните заново", show_alert=True)
        return
    try:
        await call.message.answer_sticker(sticker=STICKER_X10)
    except:
        pass
    await asyncio.sleep(1.5)
    win = random.random() < GAMES_MULTIPLIER['x10']['win_chance']
    if win:
        win_amount = amount * GAMES_MULTIPLIER['x10']['multiplier']
        update_user_balance_main(call.from_user.id, win_amount)
        update_user_game_stats(call.from_user.id, amount, win=True)
        add_raffle_bet(call.from_user.id)
        await notify_game_result(
            username=call.from_user.username,
            user_id=call.from_user.id,
            game_name="X10",
            bet_amount=amount,
            win=True,
            win_amount=win_amount
        )
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🥚 Ещё раз", callback_data="game_x10")],
            [get_back_to_main_button()]
        ])
        await call.message.answer(
            f"🎉 <b>Победа!</b>\n\n"
            f"<blockquote>├ Ставка: ${amount:.2f}\n"
            f"├ Множитель: x{GAMES_MULTIPLIER['x10']['multiplier']}\n"
            f"└ Выигрыш: ${win_amount:.2f}</blockquote>",
            reply_markup=kb,
            parse_mode="HTML",
            message_effect_id="5046509860389126442"  # пример эффекта 🎉
        )
    else:
        update_user_game_stats(call.from_user.id, amount, win=False)
        add_raffle_bet(call.from_user.id)
        await notify_game_result(
            username=call.from_user.username,
            user_id=call.from_user.id,
            game_name="X10",
            bet_amount=amount,
            win=False,
            win_amount=0
        )
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🥚 Попробовать снова", callback_data="game_x10")],
            [get_back_to_main_button()]
        ])
        await call.message.answer(
            f"😔 <b>Проигрыш</b>\n\n<blockquote>└ Ставка: ${amount:.2f}</blockquote>",
            reply_markup=kb,
            parse_mode="HTML",
            message_effect_id="5046589136895476101" # пример эффекта 💩
        )
    await state.clear()

@dp.callback_query(F.data == "game_x20")
async def game_x20_start(call: types.CallbackQuery, state: FSMContext):
    await state.clear()
    await call.message.delete()
    cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
    ])
    await call.message.answer(
        "🎰 <b>Игра X20</b>\n\n"
        "<blockquote>├ Множитель: <b>x20</b>\n"
        f"├ Шанс выигрыша: <b>{GAMES_MULTIPLIER['x20']['display']}</b>\n"
        "└ Ставка списывается сразу</blockquote>\n\n"
        "<b>Введите сумму ставки:</b>",
        reply_markup=cancel_kb,
        parse_mode="HTML"
    )
    await state.set_state(X20States.waiting_amount)
    await call.answer()

@dp.message(X20States.waiting_amount)
async def game_x20_amount(message: types.Message, state: FSMContext):
    try:
        amount = float(message.text)
        if amount < MIN_BET:
            cancel_kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]])
            await message.answer(f"❌ Минимальная ставка: ${MIN_BET:.2f}", reply_markup=cancel_kb, parse_mode="HTML")
            return
        user = get_user(message.from_user.id)
        if not user:
            await message.answer("❌ Ошибка: пользователь не найден")
            return
        balance = user[2] if user[2] is not None else 0.0
        if amount > balance:
            cancel_kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]])
            await message.answer("❌ Недостаточно средств", reply_markup=cancel_kb, parse_mode="HTML")
            return
        update_user_balance_main(message.from_user.id, -amount)
        await state.update_data(x20_bet_amount=amount)
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🎰 Крутить!", callback_data="x20_play")],
            [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
        ])
        await message.answer(f"🎰 <b>Ваша ставка: ${amount:.2f}</b>\nНажмите кнопку, чтобы сыграть:", reply_markup=kb, parse_mode="HTML")
    except ValueError:
        await message.answer("❌ Введите корректную сумму")

@dp.callback_query(F.data == "x20_play")
async def game_x20_play(call: types.CallbackQuery, state: FSMContext):
    data = await state.get_data()
    amount = data.get('x20_bet_amount')
    if not amount:
        await call.answer("Ошибка, начните заново", show_alert=True)
        return
    try:
        await call.message.answer_sticker(sticker=STICKER_X20)
    except:
        pass
    await asyncio.sleep(1.5)
    win = random.random() < GAMES_MULTIPLIER['x20']['win_chance']
    if win:
        win_amount = amount * GAMES_MULTIPLIER['x20']['multiplier']
        update_user_balance_main(call.from_user.id, win_amount)
        update_user_game_stats(call.from_user.id, amount, win=True)
        add_raffle_bet(call.from_user.id)
        await notify_game_result(
            username=call.from_user.username,
            user_id=call.from_user.id,
            game_name="X20",
            bet_amount=amount,
            win=True,
            win_amount=win_amount
        )
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🎰 Ещё раз", callback_data="game_x20")],
            [get_back_to_main_button()]
        ])
        await call.message.answer(
            f"🎉 <b>Победа!</b>\n\n"
            f"<blockquote>├ Ставка: ${amount:.2f}\n"
            f"├ Множитель: x{GAMES_MULTIPLIER['x20']['multiplier']}\n"
            f"└ Выигрыш: ${win_amount:.2f}</blockquote>",
            reply_markup=kb,
            parse_mode="HTML",
            message_effect_id="5046509860389126442"  # пример эффекта 🎉
        )
    else:
        update_user_game_stats(call.from_user.id, amount, win=False)
        add_raffle_bet(call.from_user.id)
        await notify_game_result(
            username=call.from_user.username,
            user_id=call.from_user.id,
            game_name="X20",
            bet_amount=amount,
            win=False,
            win_amount=0
        )
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🎰 Попробовать снова", callback_data="game_x20")],
            [get_back_to_main_button()]
        ])
        await call.message.answer(
            f"😔 <b>Проигрыш</b>\n\n<blockquote>└ Ставка: ${amount:.2f}</blockquote>",
            reply_markup=kb,
            parse_mode="HTML",
            message_effect_id="5046589136895476101" # пример эффекта 💩
        )
    await state.clear()

@dp.callback_query(F.data == "game_x30")
async def game_x30_start(call: types.CallbackQuery, state: FSMContext):
    await state.clear()
    await call.message.delete()
    cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
    ])
    await call.message.answer(
        "🐸 <b>Игра X30</b>\n\n"
        "<blockquote>├ Множитель: <b>x30</b>\n"
        f"├ Шанс выигрыша: <b>{GAMES_MULTIPLIER['x30']['display']}</b>\n"
        "└ Ставка списывается сразу</blockquote>\n\n"
        "<b>Введите сумму ставки:</b>",
        reply_markup=cancel_kb,
        parse_mode="HTML"
    )
    await state.set_state(X30States.waiting_amount)
    await call.answer()

@dp.message(X30States.waiting_amount)
async def game_x30_amount(message: types.Message, state: FSMContext):
    try:
        amount = float(message.text)
        if amount < MIN_BET:
            cancel_kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]])
            await message.answer(f"❌ Минимальная ставка: ${MIN_BET:.2f}", reply_markup=cancel_kb, parse_mode="HTML")
            return
        user = get_user(message.from_user.id)
        if not user:
            await message.answer("❌ Ошибка: пользователь не найден")
            return
        balance = user[2] if user[2] is not None else 0.0
        if amount > balance:
            cancel_kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]])
            await message.answer("❌ Недостаточно средств", reply_markup=cancel_kb, parse_mode="HTML")
            return
        update_user_balance_main(message.from_user.id, -amount)
        await state.update_data(x30_bet_amount=amount)
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🐸 Крутить!", callback_data="x30_play")],
            [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
        ])
        await message.answer(f"🐸 <b>Ваша ставка: ${amount:.2f}</b>\nНажмите кнопку, чтобы сыграть:", reply_markup=kb, parse_mode="HTML")
    except ValueError:
        await message.answer("❌ Введите корректную сумму")

@dp.callback_query(F.data == "x30_play")
async def game_x30_play(call: types.CallbackQuery, state: FSMContext):
    data = await state.get_data()
    amount = data.get('x30_bet_amount')
    if not amount:
        await call.answer("Ошибка, начните заново", show_alert=True)
        return
    try:
        await call.message.answer_sticker(sticker=STICKER_X30)
    except:
        pass
    await asyncio.sleep(1.5)
    win = random.random() < GAMES_MULTIPLIER['x30']['win_chance']
    if win:
        win_amount = amount * GAMES_MULTIPLIER['x30']['multiplier']
        update_user_balance_main(call.from_user.id, win_amount)
        update_user_game_stats(call.from_user.id, amount, win=True)
        add_raffle_bet(call.from_user.id)
        await notify_game_result(
            username=call.from_user.username,
            user_id=call.from_user.id,
            game_name="X30",
            bet_amount=amount,
            win=True,
            win_amount=win_amount
        )
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🐸 Ещё раз", callback_data="game_x30")],
            [get_back_to_main_button()]
        ])
        await call.message.answer(
            f"🎉 <b>Победа!</b>\n\n"
            f"<blockquote>├ Ставка: ${amount:.2f}\n"
            f"├ Множитель: x{GAMES_MULTIPLIER['x30']['multiplier']}\n"
            f"└ Выигрыш: ${win_amount:.2f}</blockquote>",
            reply_markup=kb,
            parse_mode="HTML",
            message_effect_id="5046509860389126442"  # пример эффекта 🎉
        )
    else:
        update_user_game_stats(call.from_user.id, amount, win=False)
        add_raffle_bet(call.from_user.id)
        await notify_game_result(
            username=call.from_user.username,
            user_id=call.from_user.id,
            game_name="X30",
            bet_amount=amount,
            win=False,
            win_amount=0
        )
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🐸 Попробовать снова", callback_data="game_x30")],
            [get_back_to_main_button()]
        ])
        await call.message.answer(
            f"😔 <b>Проигрыш</b>\n\n<blockquote>└ Ставка: ${amount:.2f}</blockquote>",
            reply_markup=kb,
            parse_mode="HTML",
            message_effect_id="5046589136895476101" # пример эффекта 💩
        )
    await state.clear()

@dp.callback_query(F.data == "game_x50")
async def game_x50_start(call: types.CallbackQuery, state: FSMContext):
    await state.clear()
    await call.message.delete()
    cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
    ])
    await call.message.answer(
        "🌵 <b>Игра X50</b>\n\n"
        "<blockquote>├ Множитель: <b>x50</b>\n"
        f"├ Шанс выигрыша: <b>{GAMES_MULTIPLIER['x50']['display']}</b>\n"
        "└ Ставка списывается сразу</blockquote>\n\n"
        "<b>Введите сумму ставки:</b>",
        reply_markup=cancel_kb,
        parse_mode="HTML"
    )
    await state.set_state(X50States.waiting_amount)
    await call.answer()

@dp.message(X50States.waiting_amount)
async def game_x50_amount(message: types.Message, state: FSMContext):
    try:
        amount = float(message.text)
        if amount < MIN_BET:
            cancel_kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]])
            await message.answer(f"❌ Минимальная ставка: ${MIN_BET:.2f}", reply_markup=cancel_kb, parse_mode="HTML")
            return
        user = get_user(message.from_user.id)
        if not user:
            await message.answer("❌ Ошибка: пользователь не найден")
            return
        balance = user[2] if user[2] is not None else 0.0
        if amount > balance:
            cancel_kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]])
            await message.answer("❌ Недостаточно средств", reply_markup=cancel_kb, parse_mode="HTML")
            return
        update_user_balance_main(message.from_user.id, -amount)
        await state.update_data(x50_bet_amount=amount)
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🌵 Крутить!", callback_data="x50_play")],
            [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
        ])
        await message.answer(f"🌵 <b>Ваша ставка: ${amount:.2f}</b>\nНажмите кнопку, чтобы сыграть:", reply_markup=kb, parse_mode="HTML")
    except ValueError:
        await message.answer("❌ Введите корректную сумму")

@dp.callback_query(F.data == "x50_play")
async def game_x50_play(call: types.CallbackQuery, state: FSMContext):
    data = await state.get_data()
    amount = data.get('x50_bet_amount')
    if not amount:
        await call.answer("Ошибка, начните заново", show_alert=True)
        return
    try:
        await call.message.answer_sticker(sticker=STICKER_X50)
    except:
        pass
    await asyncio.sleep(1.5)
    win = random.random() < GAMES_MULTIPLIER['x50']['win_chance']
    if win:
        win_amount = amount * GAMES_MULTIPLIER['x50']['multiplier']
        update_user_balance_main(call.from_user.id, win_amount)
        update_user_game_stats(call.from_user.id, amount, win=True)
        add_raffle_bet(call.from_user.id)
        await notify_game_result(
            username=call.from_user.username,
            user_id=call.from_user.id,
            game_name="X50",
            bet_amount=amount,
            win=True,
            win_amount=win_amount
        )
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🌵 Ещё раз", callback_data="game_x50")],
            [get_back_to_main_button()]
        ])
        await call.message.answer(
            f"🎉 <b>Победа!</b>\n\n"
            f"<blockquote>├ Ставка: ${amount:.2f}\n"
            f"├ Множитель: x{GAMES_MULTIPLIER['x50']['multiplier']}\n"
            f"└ Выигрыш: ${win_amount:.2f}</blockquote>",
            reply_markup=kb,
            parse_mode="HTML",
            message_effect_id="5046509860389126442"  # пример эффекта 🎉
        )
    else:
        update_user_game_stats(call.from_user.id, amount, win=False)
        add_raffle_bet(call.from_user.id)
        await notify_game_result(
            username=call.from_user.username,
            user_id=call.from_user.id,
            game_name="X50",
            bet_amount=amount,
            win=False,
            win_amount=0
        )
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🌵 Попробовать снова", callback_data="game_x50")],
            [get_back_to_main_button()]
        ])
        await call.message.answer(
            f"😔 <b>Проигрыш</b>\n\n<blockquote>└ Ставка: ${amount:.2f}</blockquote>",
            reply_markup=kb,
            parse_mode="HTML",
            message_effect_id="5046589136895476101" # пример эффекта 💩
        )
    await state.clear()

@dp.callback_query(F.data == "game_x100")
async def game_x100_start(call: types.CallbackQuery, state: FSMContext):
    await state.clear()
    await call.message.delete()
    cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
    ])
    await call.message.answer(
        "🐳 <b>Игра X100</b>\n\n"
        "<blockquote>├ Множитель: <b>x100</b>\n"
        f"├ Шанс выигрыша: <b>{GAMES_MULTIPLIER['x100']['display']}</b>\n"
        "└ Ставка списывается сразу</blockquote>\n\n"
        "<b>Введите сумму ставки:</b>",
        reply_markup=cancel_kb,
        parse_mode="HTML"
    )
    await state.set_state(X100States.waiting_amount)
    await call.answer()

@dp.message(X100States.waiting_amount)
async def game_x100_amount(message: types.Message, state: FSMContext):
    try:
        amount = float(message.text)
        if amount < MIN_BET:
            cancel_kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]])
            await message.answer(f"❌ Минимальная ставка: ${MIN_BET:.2f}", reply_markup=cancel_kb, parse_mode="HTML")
            return
        user = get_user(message.from_user.id)
        if not user:
            await message.answer("❌ Ошибка: пользователь не найден")
            return
        balance = user[2] if user[2] is not None else 0.0
        if amount > balance:
            cancel_kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]])
            await message.answer("❌ Недостаточно средств", reply_markup=cancel_kb, parse_mode="HTML")
            return
        update_user_balance_main(message.from_user.id, -amount)
        await state.update_data(x100_bet_amount=amount)
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🐳 Крутить!", callback_data="x100_play")],
            [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_games")]
        ])
        await message.answer(f"🐳 <b>Ваша ставка: ${amount:.2f}</b>\nНажмите кнопку, чтобы сыграть:", reply_markup=kb, parse_mode="HTML")
    except ValueError:
        await message.answer("❌ Введите корректную сумму")

@dp.callback_query(F.data == "x100_play")
async def game_x100_play(call: types.CallbackQuery, state: FSMContext):
    data = await state.get_data()
    amount = data.get('x100_bet_amount')
    if not amount:
        await call.answer("Ошибка, начните заново", show_alert=True)
        return
    try:
        await call.message.answer_sticker(sticker=STICKER_X100)
    except:
        pass
    await asyncio.sleep(1.5)
    win = random.random() < GAMES_MULTIPLIER['x100']['win_chance']
    if win:
        win_amount = amount * GAMES_MULTIPLIER['x100']['multiplier']
        update_user_balance_main(call.from_user.id, win_amount)
        update_user_game_stats(call.from_user.id, amount, win=True)
        add_raffle_bet(call.from_user.id)
        await notify_game_result(
            username=call.from_user.username,
            user_id=call.from_user.id,
            game_name="X100",
            bet_amount=amount,
            win=True,
            win_amount=win_amount
        )
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🐳 Ещё раз", callback_data="game_x100")],
            [get_back_to_main_button()]
        ])
        await call.message.answer(
            f"🎉 <b>Победа!</b>\n\n"
            f"<blockquote>├ Ставка: ${amount:.2f}\n"
            f"├ Множитель: x{GAMES_MULTIPLIER['x100']['multiplier']}\n"
            f"└ Выигрыш: ${win_amount:.2f}</blockquote>",
            reply_markup=kb,
            parse_mode="HTML",
            message_effect_id="5046509860389126442"  # пример эффекта 🎉
        )
    else:
        update_user_game_stats(call.from_user.id, amount, win=False)
        add_raffle_bet(call.from_user.id)
        await notify_game_result(
            username=call.from_user.username,
            user_id=call.from_user.id,
            game_name="X100",
            bet_amount=amount,
            win=False,
            win_amount=0
        )
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🐳 Попробовать снова", callback_data="game_x100")],
            [get_back_to_main_button()]
        ])
        await call.message.answer(
            f"😔 <b>Проигрыш</b>\n\n<blockquote>└ Ставка: ${amount:.2f}</blockquote>",
            reply_markup=kb,
            parse_mode="HTML",
            message_effect_id="5046589136895476101" # пример эффекта 💩
        )
    await state.clear()

@dp.callback_query(F.data == "deposit")
async def deposit_menu(call: types.CallbackQuery):
    try:
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="💎 CryptoBot", callback_data="deposit_crypto")],
            [InlineKeyboardButton(text="⭐ Stars", callback_data="deposit_stars")],
            [InlineKeyboardButton(text="🎁 NFT Gifts", callback_data="deposit_nft")],
            [InlineKeyboardButton(text="💳 СБП (Через тп)", url=CARD_DEPOSIT_URL)],
            [get_back_to_profile_button()]
        ])
        await call.message.edit_text("💳 <b>Выберите способ:</b>", reply_markup=kb, parse_mode="HTML")
    except Exception as e:
        logging.error(f"Error in deposit_menu: {e}")
        await call.message.answer(
            "❌ <b>Произошла ошибка</b>",
            reply_markup=get_back_to_main_button(),
            parse_mode="HTML"
        )

@dp.callback_query(F.data == "deposit_crypto")
async def deposit_crypto(call: types.CallbackQuery, state: FSMContext):
    try:
        cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_balance")]
        ])
        
        await call.message.answer("💎 <b>CryptoBot</b>\nВведите сумму в USDT (мин. $0.05):", reply_markup=cancel_kb, parse_mode="HTML")
        await state.set_state(DepositStates.waiting_amount)
        await call.answer()
    except Exception as e:
        logging.error(f"Error in deposit_crypto: {e}")
        await call.message.answer(
            "❌ <b>Произошла ошибка</b>",
            reply_markup=get_back_to_main_button(),
            parse_mode="HTML"
        )


@dp.message(DepositStates.waiting_amount)
async def process_deposit_amount(message: types.Message, state: FSMContext):
    try:
        amount = float(message.text)
        if amount < MIN_DEPOSIT:
            await message.answer(f"❌ Минимум: ${MIN_DEPOSIT}")
            return
        
        api = CryptoBotAPI(CRYPTO_BOT_TOKEN)
        invoice = api.create_invoice(amount, "USDT")
        
        if invoice and invoice.get("result"):
            invoice_data = invoice["result"]
            save_deposit(message.from_user.id, amount, amount, "USDT", invoice_data["invoice_id"], payment_system='cryptobot')
            
            kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="💎 Оплатить", url=invoice_data["pay_url"])],
                [InlineKeyboardButton(text="✅ Проверить", callback_data=f"check_deposit_{invoice_data['invoice_id']}")],
                [get_back_to_profile_button()]
            ])
            
            await message.answer(
                f"💳 <b>Счет создан</b>\n"
                f"<blockquote>├ Сумма: <b>{format_amount(amount)}</b>\n"
                f"└ Валюта: <b>USDT</b></blockquote>",
                reply_markup=kb,
                parse_mode="HTML"
            )
            await state.clear()
        else:
            kb = InlineKeyboardMarkup(inline_keyboard=[[get_back_to_profile_button()]])
            await message.answer("❌ Ошибка создания счетa")
    except ValueError:
        cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_balance")]
        ])
        await message.answer("❌ Введите корректную сумму")
    except Exception as e:
        logging.error(f"Deposit error: {e}")
        kb = InlineKeyboardMarkup(inline_keyboard=[[get_back_to_profile_button()]])
        await message.answer("❌ Произошла ошибка")

@dp.callback_query(F.data.startswith("check_deposit_"))
async def check_deposit(call: types.CallbackQuery):
    """Проверка и атомарное подтверждение депозита CryptoBot"""
    try:
        invoice_id = call.data.split("_")[2]
        api = CryptoBotAPI(CRYPTO_BOT_TOKEN)
        invoices = api.get_invoices([invoice_id])
        
        if not (invoices and invoices.get("result")):
            await call.answer("❌ Ошибка проверки", show_alert=True)
            return
        
        invoice = invoices["result"]["items"][0]
        if invoice["status"] != "paid":
            await call.answer("⏳ Ожидание оплаты...", show_alert=True)
            return
        
        # Атомарное подтверждение
        user_id, amount = confirm_deposit(invoice_id=invoice["invoice_id"])
        
        if user_id is None:
            await call.answer("✅ Депозит уже был обработан", show_alert=True)
            return
        
        # Зачисляем баланс (только если подтверждение успешно)
        update_user_balance_main(user_id, amount)
        
        # Уведомление админу
        user = get_user(user_id)
        username = user[1] if user else "Unknown"
        await notify_admin(
            f"💰 <b>Новое пополнение</b>\n\n"
            f"<blockquote>├ Пользователь: @{username} (ID: {user_id})\n"
            f"├ Система: <b>CryptoBot</b>\n"
            f"└ Сумма: <b>{format_amount(amount)}</b></blockquote>"
        )
        
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [get_back_to_profile_button()]
        ])
        
        await call.message.answer(
            f"✅ <b>Депозит подтвержден!</b>\n\n"
            f"<blockquote>└ Сумма: <b>{format_amount(amount)}</b></blockquote>",
            reply_markup=kb,
            parse_mode="HTML"
        )
        
    except Exception as e:
        logging.error(f"Error in check_deposit: {e}", exc_info=True)
        await call.message.answer("❌ <b>Произошла ошибка</b>", parse_mode="HTML")


@dp.callback_query(F.data == "deposit_stars")
async def deposit_stars(call: types.CallbackQuery, state: FSMContext):
    """Начало депозита через Telegram Stars"""
    try:
        cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_balance")]
        ])
        
        await call.message.answer(
            "⭐ <b>Telegram Stars</b>\n\n"
            f"<blockquote>├ Курс: <b>10 Stars ≈ 0.09 USDT</b>\n"
            f"└ Минимум: <b>{MIN_STARS_DEPOSIT} Stars</b></blockquote>\n\n"
            "<b>Введите количество Stars:</b>",
            reply_markup=cancel_kb,
            parse_mode="HTML"
        )
        await state.set_state(DepositStarsStates.waiting_amount)
        await call.answer()
    except Exception as e:
        logging.error(f"Error in deposit_stars: {e}")
        await call.message.answer(
            "❌ <b>Произошла ошибка</b>",
            reply_markup=get_back_to_main_button(),
            parse_mode="HTML"
        )

@dp.message(DepositStarsStates.waiting_amount)
async def process_stars_amount(message: types.Message, state: FSMContext):
    """Обработка суммы и создание инвойса Stars"""
    try:
        stars_amount = int(message.text)
        
        if stars_amount < MIN_STARS_DEPOSIT:
            cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_balance")]
            ])
            await message.answer(
                f"❌ <b>Минимальная сумма:</b> {MIN_STARS_DEPOSIT} Stars",
                reply_markup=cancel_kb,
                parse_mode="HTML"
            )
            return
        
        # Конвертация Stars в USDT
        usdt_amount = stars_amount * STARS_TO_USDT_RATE
        
        # Генерация уникального payload для отслеживания
        payload = f"stars_deposit_{message.from_user.id}_{int(time.time())}_{random.randint(1000, 9999)}"
        
        # Сохраняем депозит в БД (статус pending)
        save_deposit(
            user_id=message.from_user.id,
            amount_usd=usdt_amount,
            amount_crypto=stars_amount,
            currency="XTR",
            order_id=payload,
            payment_system='stars'
        )
        
        # Создание инвойса Stars
        prices = [LabeledPrice(label=f"Пополнение на {usdt_amount:.4f} USDT", amount=stars_amount)]
        
        await bot.send_invoice(
            chat_id=message.chat.id,
            title="SpindBet",
            description=f"Пополнение баланса на {usdt_amount:.4f} USDT",
            payload=payload,
            provider_token="",  # Для Stars оставить пустым
            currency="XTR",
            prices=prices,
            start_parameter="stars_deposit",
            need_name=False,
            need_phone_number=False,
            need_email=False,
            is_flexible=False
        )
        
        await state.clear()
        
    except ValueError:
        cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_balance")]
        ])
        await message.answer("❌ <b>Введите целое число</b>", reply_markup=cancel_kb, parse_mode="HTML")
    except Exception as e:
        logging.error(f"Stars deposit error: {e}", exc_info=True)
        kb = InlineKeyboardMarkup(inline_keyboard=[[get_back_to_profile_button()]])
        await message.answer("❌ <b>Произошла ошибка</b>", reply_markup=kb, parse_mode="HTML")
        await state.clear()

@dp.pre_checkout_query()
async def pre_checkout_handler(pre_checkout_query: PreCheckoutQuery):
    """Подтверждение оплаты Telegram"""
    try:
        # Можно добавить дополнительную валидацию здесь
        await bot.answer_pre_checkout_query(pre_checkout_query.id, ok=True)
    except Exception as e:
        logging.error(f"Pre-checkout error: {e}")
        await bot.answer_pre_checkout_query(
            pre_checkout_query.id, 
            ok=False, 
            error_message="Ошибка обработки платежа"
        )

@dp.message(F.successful_payment)
async def successful_payment_handler(message: types.Message, state: FSMContext):
    """Обработка успешного платежа Stars с защитой от дублирования"""
    try:
        successful_payment = message.successful_payment
        payload = successful_payment.invoice_payload
        
        if not payload.startswith("stars_deposit_"):
            logging.warning(f"Unknown payment payload: {payload}")
            return
        
        stars_amount = successful_payment.total_amount
        usdt_amount = stars_amount * STARS_TO_USDT_RATE
        
        # Атомарное подтверждение
        user_id, amount = confirm_deposit(order_id=payload)
        
        if user_id is None:
            logging.warning(f"Stars deposit already processed: {payload}")
            return
        
        # Зачисляем баланс
        update_user_balance_main(user_id, amount)
        
        # Уведомление админу
        user = get_user(user_id)
        username = user[1] if user else "Unknown"
        await notify_admin(
            f"💰 <b>Новое пополнение</b>\n\n"
            f"<blockquote>├ Пользователь: @{username} (ID: {user_id})\n"
            f"├ Система: <b>Telegram Stars</b>\n"
            f"├ Сумма Stars: <b>{stars_amount}</b>\n"
            f"└ Зачислено: <b>{format_amount(amount)}</b></blockquote>"
        )
        
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [get_back_to_profile_button()]
        ])
        
        await message.answer(
            f"✅ <b>Пополнение успешно!</b>\n\n"
            f"<blockquote>├ Сумма Stars: <b>{stars_amount}</b>\n"
            f"└ Зачислено: <b>{format_amount(amount)}</b></blockquote>",
            reply_markup=kb,
            parse_mode="HTML"
        )
        
    except Exception as e:
        logging.error(f"Successful payment error: {e}", exc_info=True)
        kb = InlineKeyboardMarkup(inline_keyboard=[[get_back_to_main_button()]])
        await message.answer("❌ <b>Ошибка обработки платежа</b>", reply_markup=kb, parse_mode="HTML")

@dp.callback_query(F.data == "deposit_nft")
async def deposit_nft(call: types.CallbackQuery):
    """Информация о пополнении через NFT-подарок"""
    try:
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="📊 Узнать стоимость NFT", url="https://www.spindbet.com/faq/nft-payment/")],
            [get_back_to_main_button()]
        ])
        
        text = (
            "🎁 <b>Пополнение через NFT-подарок</b>\n\n"
            "📌 <b>Как это работает:</b>\n"
            "<blockquote>├ 1. Передайте NFT <b>@winer404</b>\n"
            "├ 2. Укажите свой ID: <code>{}</code>\n"
            "└ 3. Баланс будет начислен в течение 5 минут</blockquote>\n\n"
            ).format(call.from_user.id)
        
        await call.message.edit_text(text, reply_markup=kb, parse_mode="HTML", disable_web_page_preview=True)
        await call.answer()
        
    except Exception as e:
        logging.error(f"Error in deposit_nft: {e}")
        await call.message.answer("❌ <b>Произошла ошибка</b>", parse_mode="HTML")

@dp.callback_query(F.data == "withdraw")
async def withdraw_menu(call: types.CallbackQuery, state: FSMContext):
    try:
        user = get_user(call.from_user.id)
        if not user:
            await call.answer("❌ Ошибка: пользователь не найден", show_alert=True)
            return
        
        balance = user[2] if user[2] is not None else 0.0
        total_games = user[9] if len(user) > 9 and user[9] is not None else 0
        
        # Проверка минимального количества ставок
        if total_games < MIN_GAMES_FOR_WITHDRAW:
            kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="🎮 Играть", callback_data="menu_games")],
                [InlineKeyboardButton(text="🔙 Назад", callback_data="menu_balance")]
            ])
            
            await call.message.answer(
                f"❌ <b>Требование к выводу</b>\n\n"
                f"<blockquote>├ Сыграно игр: <b>{total_games}/{MIN_GAMES_FOR_WITHDRAW}</b>\n"
                f"└ Нужно сделать еще: <b>{MIN_GAMES_FOR_WITHDRAW - total_games} ставки</b></blockquote>\n\n"
                f"<i>Вы должны сделать минимум {MIN_GAMES_FOR_WITHDRAW} ставки перед выводом</i>",
                reply_markup=kb,
                parse_mode="HTML"
            )
            return
        
        cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="Вывести на карту [спб]", callback_data="withdraw_sbp")],
            [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_balance")]
        ])
        
        await call.message.answer(
            f"💸 <b>Вывод с основного баланса</b>\n"
            f"<blockquote>├ Доступно: <b>${balance:.2f}</b>\n"
            f"└ Минимум: <b>${MIN_WITHDRAW}</b></blockquote>\n\n"
            f"<b>Введите сумму:</b>",
            reply_markup=cancel_kb,
            parse_mode="HTML"
        )
        await state.set_state(WithdrawStates.waiting_amount)
        await call.answer()
    except Exception as e:
        logging.error(f"Error in withdraw_menu: {e}")
        await call.message.answer("❌ <b>Произошла ошибка</b>", reply_markup=get_back_to_main_button(), parse_mode="HTML")

@dp.message(WithdrawStates.waiting_amount)
async def process_withdrawal(message: types.Message, state: FSMContext):
    try:
        amount = float(message.text)
        balance, _ = get_user_balances(message.from_user.id)
        
        if amount < MIN_WITHDRAW:
            cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_balance")]
            ])
            await message.answer(f"❌ <b>Минимум:</b> ${MIN_WITHDRAW:.2f}", reply_markup=cancel_kb, parse_mode="HTML")
            return
        
        if amount > balance:
            cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_balance")]
            ])
            await message.answer("❌ <b>Недостаточно средств на основном балансе</b>", reply_markup=cancel_kb, parse_mode="HTML")
            return
        
        success, result = create_withdrawal_check_main(message.from_user.id, amount)
        
        if success:
            # 🔔 УВЕДОМЛЕНИЕ АДМИНУ
            user = get_user(message.from_user.id)
            username = user[1] if user else "Unknown"
            await notify_admin(
                f"💸 <b>Новый вывод</b>\n\n"
                f"<blockquote>├ Пользователь: @{username} (ID: {message.from_user.id})\n"
                f"├ Баланс: <b>Основной</b>\n"
                f"└ Сумма: <b>{format_amount(amount)}</b></blockquote>"
            )
            
            kb = InlineKeyboardMarkup(inline_keyboard=[[get_back_to_profile_button()]])
            await message.answer(
                f"✅ <b>Вывод успешен!</b>\n"
                f"<blockquote>├ Сумма: <b>{format_amount(amount)}</b>\n"
                f"└ Чек: <a href='{result}'>Нажмите для получения</a></blockquote>\n\n"
                f"<i>⚠️ Откройте ссылку в Crypto Bot для получения средств</i>",
                reply_markup=kb,
                parse_mode="HTML"
            )
            await state.clear()
        else:
            await message.answer(f"❌ <b>Ошибка вывода</b>\n<code>{result}</code>", parse_mode="HTML")
    except ValueError:
        cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_balance")]
        ])
        await message.answer("❌ <b>Введите корректную сумму</b>", reply_markup=cancel_kb, parse_mode="HTML")
    except Exception as e:
        logging.error(f"Withdrawal error: {e}")
        kb = InlineKeyboardMarkup(inline_keyboard=[[get_back_to_profile_button()]])
        await message.answer("❌ <b>Произошла ошибка</b>", reply_markup=kb, parse_mode="HTML")

@dp.callback_query(F.data == "withdraw_ref")
async def withdraw_ref(call: types.CallbackQuery):
    try:
        user = get_user(call.from_user.id)
        
        if not user:
            await call.answer("❌ Ошибка: пользователь не найден", show_alert=True)
            return
        
        ref_balance = user[4] if len(user) > 4 and user[4] is not None else 0.0
        total_games = user[9] if len(user) > 9 and user[9] is not None else 0
        
        # Проверка минимального количества ставок
        if total_games < MIN_GAMES_FOR_WITHDRAW:
            await call.answer(
                f"❌ Требуется {MIN_GAMES_FOR_WITHDRAW} ставки! Вы сделали: {total_games}",
                show_alert=True
            )
            return
        
        if ref_balance < MIN_WITHDRAW:
            await call.answer(f"❌ Минимум: ${MIN_WITHDRAW}", show_alert=True)
            return
        
        success, result = create_withdrawal_check_ref(call.from_user.id, ref_balance)
        
        if success:
            update_user_balance_ref(call.from_user.id, -ref_balance)
            
            # Уведомление админу
            username = user[1] if user else "Unknown"
            await notify_admin(
                f"💸 <b>Новый вывод</b>\n\n"
                f"<blockquote>├ Пользователь: @{username} (ID: {call.from_user.id})\n"
                f"├ Баланс: <b>Реферальный</b>\n"
                f"└ Сумма: <b>{format_amount(ref_balance)}</b></blockquote>"
            )
            
            kb = InlineKeyboardMarkup(inline_keyboard=[
                [get_back_to_profile_button()]
            ])
            
            await call.message.answer(
                f"✅ <b>Реферальный баланс выведен</b>\n"
                f"<blockquote>├ Сумма: <b>${ref_balance:.2f}</b>\n"
                f"└ Чек: <a href='{result}'>Нажмите для получения</a></blockquote>\n\n"
                f"<i>⚠️ Откройте ссылку в Crypto Bot для получения средств</i>",
                reply_markup=kb,
                parse_mode="HTML"
            )
        else:
            await call.answer(f"❌ Ошибка: {result}", show_alert=True)
    except Exception as e:
        logging.error(f"Error in withdraw_ref: {e}")
        await call.message.answer("❌ <b>Произошла ошибка</b>", parse_mode="HTML")

@dp.callback_query(F.data == "withdraw_sbp")
async def withdraw_sbp(call: types.CallbackQuery):
    """Вывод в рублях через администратора (только при обороте >= $10)"""
    try:
        user = get_user(call.from_user.id)
        if not user:
            await call.answer("❌ Ошибка: пользователь не найден", show_alert=True)
            return

        total_bets = user[11] if len(user) > 11 and user[11] is not None else 0.0

        if total_bets < 10.0:
            # Оборот меньше 10$ – отказ
            kb = InlineKeyboardMarkup(inline_keyboard=[
                [get_back_to_profile_button()]
            ])
            await call.message.edit_text(
                f"❌ <b>Вывод через СБП недоступен</b>\n\n"
                f"<blockquote>├ Минимальный оборот: <b>$10</b>\n"
                f"└ Ваш оборот ставок: <b>${total_bets:.2f}</b></blockquote>\n\n"
                f"<i>Вы можете вывести средства через CryptoBot без ограничений</i>",
                reply_markup=kb,
                parse_mode="HTML"
            )
            return

        # Оборот >= 10$ – показываем контакты администратора
        admin_username = ADMIN_USERNAME if 'ADMIN_USERNAME' in globals() else "администратор"
        admin_id = ADMIN_IDS[0] if ADMIN_IDS else None

        contact_text = (
            f"✅ <b>Вывод через СБП доступен</b>\n\n"
            f"<blockquote>├ Оборот ставок: <b>${total_bets:.2f}</b>\n"
            f"├ Способ: <b>СБП (RUB)</b>\n"
            f"└ Контакты: {admin_username}</blockquote>\n\n"
            f"📩 <b>Напишите администратору в личные сообщения для оформления вывода.</b>\n"
            f"Укажите ваш ID: <code>{call.from_user.id}</code>, желаемую сумму и реквизиты."
        )

        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="📩 Написать администратору", url=f"tg://user?id={admin_id}")] if admin_id else None,
            [get_back_to_profile_button()]
        ])
        # Убираем None из списка кнопок
        kb.inline_keyboard = [row for row in kb.inline_keyboard if row[0] is not None]

        await call.message.edit_text(contact_text, reply_markup=kb, parse_mode="HTML")
        await call.answer()

    except Exception as e:
        logging.error(f"Error in withdraw_sbp: {e}")
        await call.message.answer(
            "❌ <b>Произошла ошибка</b>",
            reply_markup=get_back_to_main_button(),
            parse_mode="HTML"
        )

@dp.callback_query(F.data == "promo")
async def activate_promo(call: types.CallbackQuery, state: FSMContext):
    try:
        cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_profile")]
        ])
        
        await call.message.answer("🎁 <b>Активация промокода</b>\nВведите код:", reply_markup=cancel_kb, parse_mode="HTML")
        await state.set_state(PromoStates.waiting_code)
        await call.answer()
    except Exception as e:
        logging.error(f"Error in activate_promo: {e}")
        await call.message.answer(
            "❌ <b>Произошла ошибка</b>",
            parse_mode="HTML"
        )

@dp.message(PromoStates.waiting_code)
async def process_promo(message: types.Message, state: FSMContext):
    try:
        code = message.text.upper()
        
        if is_promocode_used(message.from_user.id, code):
            await message.answer("❌ <b>Вы уже использовали этот промокод</b>", parse_mode="HTML")
            await state.clear()
            return
        
        promo = get_promocode(code)
        
        if promo:
            amount, uses, max_uses = promo
            if uses < max_uses:
                conn = sqlite3.connect(DB_PATH)
                c = conn.cursor()
                c.execute("UPDATE promocodes SET uses = uses + 1 WHERE code = ?", (code,))
                c.execute("UPDATE users SET balance = balance + ? WHERE user_id = ?", 
                         (amount, message.from_user.id))
                conn.commit()
                conn.close()
                
                use_promocode(message.from_user.id, code)
                
                kb = InlineKeyboardMarkup(inline_keyboard=[
                    [get_back_to_profile_button()]
                ])
                
                await message.answer(
                    f"🎉 <b>Промокод активирован!</b>\n"
                    f"<blockquote>├ Код: <code>{code}</code>\n"
                    f"└ Бонус: <b>{format_amount(amount)}</b></blockquote>",
                    reply_markup=kb,
                    parse_mode="HTML"
                )
            else:
                await message.answer("❌ <b>Промокод истек</b>", parse_mode="HTML")
        else:
            await message.answer("❌ <b>Промокод не найден</b>", parse_mode="HTML")
        
        await state.clear()
    except Exception as e:
        logging.error(f"Error in process_promo: {e}")
        await message.answer(
            "❌ <b>Произошла ошибка</b>",
            parse_mode="HTML"
        )
        await state.clear()

@dp.callback_query(F.data == "admin_panel")
async def admin_panel(call: types.CallbackQuery):
    try:
        if not is_admin(call.from_user.id):
            await call.answer("❌ Доступ запрещен", show_alert=True)
            return
        
        await call.message.edit_text("🔧 <b>Админ-панель</b>", reply_markup=get_admin_menu(), parse_mode="HTML")
    except Exception as e:
        logging.error(f"Error in admin_panel: {e}")
        await call.message.answer(
            "❌ <b>Произошла ошибка</b>",
            parse_mode="HTML"
        )

@dp.callback_query(F.data == "admin_stats")
async def admin_stats(call: types.CallbackQuery):
    """Админ-статистика с балансом бота"""
    try:
        if not is_admin(call.from_user.id):
            await call.answer("❌ Доступ запрещен", show_alert=True)
            return
        
        stats = get_global_stats()
        total_players = get_total_players()
        
        # Получаем баланс бота
        api = CryptoBotAPI(CRYPTO_BOT_TOKEN)
        balance_data = api.get_balance()
        
        bot_balance = "❌ Ошибка"
        if balance_data and balance_data.get("ok"):
            balances = balance_data.get("result", [])
            for bal in balances:
                if bal.get("currency_code") == "USDT":
                    # КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: преобразуем значение в float
                    available = float(bal.get('available', 0))
                    bot_balance = f"${available:.2f}"
                    break
        
        stats_text = f"""
📊 <b>Статистика бота</b>

<blockquote>├ Баланс бота: <b>{bot_balance}</b>
├ Игроков: <b>{total_players}</b>
├ Депозитов: <b>${stats.get('total_deposits', 0):,.2f}</b>
├ Выводов: <b>${stats.get('total_withdrawals', 0):,.2f}</b>
└ Реф. выплат: <b>${stats.get('total_referral_payouts', 0):,.2f}</b>
</blockquote>
        """
        
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🔙 Назад", callback_data="admin_panel")]
        ])
        
        await call.message.edit_text(stats_text, reply_markup=kb, parse_mode="HTML")
        
    except Exception as e:
        logging.error(f"Error in admin_stats: {e}", exc_info=True)
        await call.message.answer("❌ <b>Произошла ошибка</b>", parse_mode="HTML")

@dp.callback_query(F.data == "admin_create_promo")
async def admin_create_promo(call: types.CallbackQuery, state: FSMContext):
    try:
        if not is_admin(call.from_user.id):
            await call.answer("❌ Доступ запрещен", show_alert=True)
            return
        
        cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="❌ Отмена", callback_data="admin_panel")]
        ])
        
        await call.message.answer("🎁 <b>Создание промокода</b>\n\nВведите код:", reply_markup=cancel_kb, parse_mode="HTML")
        await state.set_state(AdminStates.waiting_promo_code)
    except Exception as e:
        logging.error(f"Error in admin_create_promo: {e}")
        await call.message.answer(
            "❌ <b>Произошла ошибка</b>",
            parse_mode="HTML"
        )

@dp.message(AdminStates.waiting_promo_code)
async def admin_promo_code(message: types.Message, state: FSMContext):
    try:
        await state.update_data(promo_code=message.text.upper())
        cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="❌ Отмена", callback_data="admin_panel")]
        ])
        await message.answer("Введите сумму бонуса:", reply_markup=cancel_kb, parse_mode="HTML")
        await state.set_state(AdminStates.waiting_promo_amount)
    except Exception as e:
        logging.error(f"Error in admin_promo_code: {e}")
        await message.answer(
            "❌ <b>Произошла ошибка</b>",
            parse_mode="HTML"
        )

@dp.message(AdminStates.waiting_promo_amount)
async def admin_promo_amount(message: types.Message, state: FSMContext):
    try:
        amount = float(message.text)
        await state.update_data(promo_amount=amount)
        cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="❌ Отмена", callback_data="admin_panel")]
        ])
        await message.answer("Введите количество использований:", reply_markup=cancel_kb, parse_mode="HTML")
        await state.set_state(AdminStates.waiting_promo_uses)
    except ValueError:
        await message.answer("❌ Введите число")
    except Exception as e:
        logging.error(f"Error in admin_promo_amount: {e}")
        await message.answer(
            "❌ <b>Произошла ошибка</b>",
            parse_mode="HTML"
        )

@dp.message(AdminStates.waiting_promo_uses)
async def admin_promo_uses(message: types.Message, state: FSMContext):
    try:
        max_uses = int(message.text)
        data = await state.get_data()
        
        success = create_promocode(data['promo_code'], data['promo_amount'], max_uses)
        
        if success:
            kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="🔙 Назад", callback_data="admin_panel")]
            ])
            await message.answer(
                f"✅ Промокод создан!\n\n"
                f"Код: <code>{data['promo_code']}</code>\n"
                f"Сумма: ${data['promo_amount']:.2f}\n"
                f"Использований: {max_uses}",
                reply_markup=kb,
                parse_mode="HTML"
            )
        else:
            await message.answer("❌ Такой промокод уже существует")
        
        await state.clear()
    except ValueError:
        await message.answer("❌ Введите целое число")
    except Exception as e:
        logging.error(f"Error in admin_promo_uses: {e}")
        await message.answer(
            "❌ <b>Произошла ошибка</b>",
            parse_mode="HTML"
        )

@dp.callback_query(F.data == "admin_checks")
async def admin_checks(call: types.CallbackQuery, state: FSMContext):
    """Показать список чеков CryptoBot с пагинацией"""
    try:
        if not is_admin(call.from_user.id):
            await call.answer("❌ Доступ запрещен", show_alert=True)
            return
        
        # Сбрасываем пагинацию
        await state.update_data(check_page_index=0, checks_list=[])
        
        api = CryptoBotAPI(CRYPTO_BOT_TOKEN)
        checks_data = api.get_checks()
        
        if not checks_data or not checks_data.get("ok"):
            error = checks_data.get("error", {}).get("message", "API недоступен") if checks_data else "Ошибка подключения"
            kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="🔙 Назад", callback_data="admin_panel")]
            ])
            await call.message.edit_text(
                f"📋 <b>Управление чеками</b>\n\n"
                f"<blockquote>└ Ошибка: {error}</blockquote>",
                reply_markup=kb,
                parse_mode="HTML"
            )
            return
        
        # Безопасное извлечение списка чеков
        checks = []
        if "result" in checks_data:
            if isinstance(checks_data["result"], dict):
                checks = checks_data["result"].get("items", [])
            elif isinstance(checks_data["result"], list):
                checks = checks_data["result"]
        
        # Дополнительная проверка и нормализация данных
        if isinstance(checks, int):
            logging.warning(f"API вернуло целое число вместо списка: {checks}")
            checks = []
        elif not isinstance(checks, list):
            logging.error(f"Неверный тип чеков: {type(checks)}, data: {checks_data}")
            checks = []
        
        if not checks:
            kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="🔙 Назад", callback_data="admin_panel")]
            ])
            await call.message.edit_text(
                "📋 <b>Управление чеками</b>\n\n"
                "<blockquote>└ Чеков не найдено</blockquote>",
                reply_markup=kb,
                parse_mode="HTML"
            )
            return
        
        # Сохраняем в состоянии
        await state.update_data(checks_list=checks)
        
        # Показываем первый чек
        await show_check_page(call, checks, 0, state)
        
    except Exception as e:
        logging.error(f"Error in admin_checks: {e}", exc_info=True)
        await call.message.answer("❌ <b>Произошла ошибка</b>", parse_mode="HTML")

async def show_check_page(call: types.CallbackQuery, checks: list, page_index: int, state: FSMContext):
    """Показать конкретную страницу чека"""
    try:
        if not isinstance(checks, list):
            logging.error(f"CRITICAL: checks is {type(checks)}, not list")
            await call.answer("❌ Ошибка данных: список недоступен", show_alert=True)
            return
        
        if not checks:
            await call.answer("❌ Список чеков пуст", show_alert=True)
            return
        
        if page_index < 0 or page_index >= len(checks):
            logging.error(f"Page index {page_index} out of bounds for {len(checks)} checks")
            await call.answer("❌ Ошибка индекса", show_alert=True)
            return
        
        await state.update_data(check_page_index=page_index)
        
        check = checks[page_index]
        check_id = check.get("check_id", "")
        amount = check.get("amount", 0)
        asset = check.get("asset", "USDT")
        status = check.get("status", "unknown")
        
        # КРИТИЧЕСКИЕ ИСПРАВЛЕНИЯ:
        # 1. Преобразуем check_id в строку
        check_id_str = str(check_id)
        display_id = (check_id_str[:12] + "...") if len(check_id_str) > 12 else check_id_str
        
        # 2. Преобразуем amount в строку для отображения
        amount_str = str(amount)
        
        text = f"📋 <b>Чек #{page_index + 1} из {len(checks)}</b>\n\n"
        text += f"<blockquote>├ ID: <code>{display_id}</code>\n"
        text += f"├ Сумма: <b>{amount_str} {asset}</b>\n"
        text += f"├ Статус: <b>{status}</b>\n"
        
        # Проверяем наличие URL
        bot_url = check.get('bot_check_url')
        if bot_url:
            text += f"└ <a href='{bot_url}'>Открыть чек</a></blockquote>\n"
        else:
            text += "└ <i>URL недоступен</i></blockquote>\n"
        
        # Кнопки навигации
        keyboard = []
        nav_row = []
        
        if page_index > 0:
            nav_row.append(InlineKeyboardButton(text="⬅️ Предыдущий", callback_data="admin_check_prev"))
        
        if page_index < len(checks) - 1:
            nav_row.append(InlineKeyboardButton(text="➡️ Следующий", callback_data="admin_check_next"))
        
        if nav_row:
            keyboard.append(nav_row)
        
        keyboard.append([
            InlineKeyboardButton(text="❌ Удалить чек", callback_data=f"admin_delete_check_{check_id_str}")
        ])
        keyboard.append([InlineKeyboardButton(text="🔙 Назад", callback_data="admin_panel")])
        
        kb = InlineKeyboardMarkup(inline_keyboard=keyboard)
        
        try:
            await call.message.edit_text(text, reply_markup=kb, parse_mode="HTML")
        except Exception as e:
            logging.warning(f"Failed to edit message: {e}")
            await call.message.answer(text, reply_markup=kb, parse_mode="HTML")
            
    except Exception as e:
        logging.error(f"Error in show_check_page: {e}", exc_info=True)
        await call.message.answer("❌ <b>Ошибка отображения чека</b>", parse_mode="HTML")

@dp.callback_query(F.data == "admin_check_prev")
async def admin_check_prev(call: types.CallbackQuery, state: FSMContext):
    """Листание на предыдущий чек"""
    try:
        if not is_admin(call.from_user.id):
            await call.answer("❌ Доступ запрещен", show_alert=True)
            return
        
        data = await state.get_data()
        page_index = data.get("check_page_index", 0)
        checks = data.get("checks_list", [])
        
        if not isinstance(checks, list):
            logging.error("checks_list is not list in state")
            await call.answer("❌ Ошибка данных", show_alert=True)
            return
        
        if not checks:
            await call.answer("❌ Список пуст", show_alert=True)
            return
        
        new_index = max(0, page_index - 1)
        await show_check_page(call, checks, new_index, state)
        
    except Exception as e:
        logging.error(f"Error in admin_check_prev: {e}", exc_info=True)

@dp.callback_query(F.data == "admin_check_next")
async def admin_check_next(call: types.CallbackQuery, state: FSMContext):
    """Листание на следующий чек"""
    try:
        if not is_admin(call.from_user.id):
            await call.answer("❌ Доступ запрещен", show_alert=True)
            return
        
        data = await state.get_data()
        page_index = data.get("check_page_index", 0)
        checks = data.get("checks_list", [])
        
        if not isinstance(checks, list):
            logging.error("checks_list is not list in state")
            await call.answer("❌ Ошибка данных", show_alert=True)
            return
        
        if not checks:
            await call.answer("❌ Список пуст", show_alert=True)
            return
        
        new_index = min(len(checks) - 1, page_index + 1)
        await show_check_page(call, checks, new_index, state)
        
    except Exception as e:
        logging.error(f"Error in admin_check_next: {e}", exc_info=True)


@dp.callback_query(F.data.startswith("admin_delete_check_"))
async def admin_delete_check(call: types.CallbackQuery, state: FSMContext):
    """Запрос подтверждения удаления чека"""
    try:
        if not is_admin(call.from_user.id):
            await call.answer("❌ Доступ запрещен", show_alert=True)
            return
        
        parts = call.data.split("_", 3)
        if len(parts) < 4:
            logging.error(f"Invalid callback data: {call.data}")
            await call.answer("❌ Ошибка ID чека", show_alert=True)
            return
        
        check_id = parts[3]
        await state.update_data(check_id_to_delete=check_id)
        
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="✅ Да, удалить", callback_data="admin_delete_check_confirm")],
            [InlineKeyboardButton(text="❌ Отмена", callback_data="admin_checks")]
        ])
        
        await call.message.edit_text(
            "⚠️ <b>Удалить чек?</b>\n\n"
            f"<blockquote>ID: <code>{str(check_id)[:20]}</code></blockquote>",
            reply_markup=kb,
            parse_mode="HTML"
        )
        
    except Exception as e:
        logging.error(f"Error in admin_delete_check: {e}", exc_info=True)

@dp.callback_query(F.data == "admin_delete_check_confirm")
async def admin_delete_check_confirm(call: types.CallbackQuery, state: FSMContext):
    """Подтверждённое удаление чека"""
    try:
        if not is_admin(call.from_user.id):
            await call.answer("❌ Доступ запрещен", show_alert=True)
            return
        
        data = await state.get_data()
        check_id = data.get("check_id_to_delete")
        
        if not check_id:
            logging.error("No check_id_to_delete in state")
            await call.answer("❌ Ошибка ID", show_alert=True)
            return
        
        api = CryptoBotAPI(CRYPTO_BOT_TOKEN)
        result = api.delete_check(check_id)
        
        if result and result.get("ok"):
            await call.answer("✅ Чек удален", show_alert=True)
        else:
            error = result.get("error", {}).get("message", "Ошибка API") if result else "API недоступен"
            await call.answer(f"❌ {error}", show_alert=True)
        
        await admin_checks(call)
        
    except Exception as e:
        logging.error(f"Error in admin_delete_check_confirm: {e}", exc_info=True)
        await call.answer("❌ Ошибка удаления", show_alert=True)
    finally:
        await state.update_data(check_id_to_delete=None)


@dp.callback_query(F.data == "admin_nft_deposit")
async def admin_nft_deposit_start(call: types.CallbackQuery, state: FSMContext):
    """Начало процесса пополнения через NFT-подарок"""
    try:
        if not is_admin(call.from_user.id):
            await call.answer("❌ Доступ запрещен", show_alert=True)
            return
        
        await state.clear()
        cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="❌ Отмена", callback_data="admin_panel")]
        ])
        
        text = (
            "🎁 <b>Пополнение через NFT-подарок</b>\n\n"
            "💰 <b>Инструкция для администратора:</b>\n"
            "<blockquote>├ 1. Пользователь отправляет NFT-подарок @winer404\n"
            "├ 2. Проверьте полученный подарок\n"
            "├ 3. Введите ID пользователя для начисления\n"
            "└ 4. Укажите сумму в USDT</blockquote>\n\n"
            "📌 <b>Введите Telegram ID пользователя:</b>"
        )
        
        await call.message.edit_text(text, reply_markup=cancel_kb, parse_mode="HTML")
        await state.set_state(AdminNFTStates.waiting_user_id)
        await call.answer()
        
    except Exception as e:
        logging.error(f"Error in admin_nft_deposit_start: {e}")
        await call.message.answer("❌ <b>Произошла ошибка</b>", parse_mode="HTML")

@dp.message(AdminNFTStates.waiting_user_id)
async def admin_nft_get_user_id(message: types.Message, state: FSMContext):
    """Получение ID пользователя"""
    try:
        if not is_admin(message.from_user.id):
            await message.answer("❌ <b>Доступ запрещен</b>", parse_mode="HTML")
            await state.clear()
            return
        
        if message.text == "/cancel":
            await state.clear()
            await message.answer("❌ <b>Операция отменена</b>", reply_markup=get_admin_menu(), parse_mode="HTML")
            return
        
        try:
            user_id = int(message.text.strip())
        except ValueError:
            await message.answer(
                "❌ <b>Неверный формат!</b>\n\n"
                "Введите числовой Telegram ID пользователя.\n"
                "Или напишите /cancel для отмены.",
                parse_mode="HTML"
            )
            return
        
        user = get_user(user_id)
        if not user:
            await message.answer(
                f"❌ <b>Пользователь с ID {user_id} не найден!</b>\n\n"
                "Убедитесь, что пользователь запускал бота.\n"
                "Попробуйте другой ID или /cancel для отмены.",
                parse_mode="HTML"
            )
            return
        
        await state.update_data(nft_user_id=user_id)
        await state.set_state(AdminNFTStates.waiting_amount)
        
        username = user[1] if user[1] else "Нет username"
        balance = user[2] if user[2] is not None else 0.0
        
        cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="❌ Отмена", callback_data="admin_panel")]
        ])
        
        await message.answer(
            f"👤 <b>Пользователь найден</b>\n\n"
            f"<blockquote>├ ID: <code>{user_id}</code>\n"
            f"├ Username: @{username}\n"
            f"└ Текущий баланс: <b>${balance:.2f}</b></blockquote>\n\n"
            "💰 <b>Введите сумму для начисления в USDT:</b>\n"
            "<i>Например: 0.5, 1.0, 2.5</i>",
            reply_markup=cancel_kb,
            parse_mode="HTML"
        )
        
    except Exception as e:
        logging.error(f"Error in admin_nft_get_user_id: {e}")
        await message.answer("❌ <b>Произошла ошибка</b>", parse_mode="HTML")
        await state.clear()

@dp.message(AdminNFTStates.waiting_amount)
async def admin_nft_get_amount(message: types.Message, state: FSMContext):
    """Получение суммы для начисления"""
    try:
        if not is_admin(message.from_user.id):
            await message.answer("❌ <b>Доступ запрещен</b>", parse_mode="HTML")
            await state.clear()
            return
        
        if message.text == "/cancel":
            await state.clear()
            await message.answer("❌ <b>Операция отменена</b>", reply_markup=get_admin_menu(), parse_mode="HTML")
            return
        
        try:
            amount = float(message.text.strip().replace(',', '.'))
        except ValueError:
            await message.answer(
                "❌ <b>Неверный формат суммы!</b>\n\n"
                "Введите число, например: 0.5, 1.0, 2.5\n"
                "Или напишите /cancel для отмены.",
                parse_mode="HTML"
            )
            return
        
        if amount <= 0:
            await message.answer(
                "❌ <b>Сумма должна быть больше 0!</b>\n\n"
                "Введите корректную сумму или /cancel для отмены.",
                parse_mode="HTML"
            )
            return
        
        await state.update_data(nft_amount=amount)
        await state.set_state(AdminNFTStates.waiting_confirm)
        
        data = await state.get_data()
        user_id = data.get('nft_user_id')
        user = get_user(user_id)
        username = user[1] if user else "Unknown"
        
        confirm_kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="✅ Подтвердить", callback_data="admin_nft_confirm")],
            [InlineKeyboardButton(text="❌ Отмена", callback_data="admin_panel")]
        ])
        
        await message.answer(
            f"📋 <b>Проверьте данные</b>\n\n"
            f"<blockquote>├ Пользователь: @{username} (ID: <code>{user_id}</code>)\n"
            f"├ Сумма: <b>${amount:.2f}</b>\n"
            f"├ Способ: <b>NFT-подарок</b>\n"
            f"└ Админ: @{message.from_user.username}</blockquote>\n\n"
            "✅ <b>Подтвердите начисление:</b>",
            reply_markup=confirm_kb,
            parse_mode="HTML"
        )
        
    except Exception as e:
        logging.error(f"Error in admin_nft_get_amount: {e}")
        await message.answer("❌ <b>Произошла ошибка</b>", parse_mode="HTML")
        await state.clear()

@dp.callback_query(F.data == "admin_nft_confirm")
async def admin_nft_confirm(call: types.CallbackQuery, state: FSMContext):
    """Подтверждение и начисление баланса"""
    try:
        if not is_admin(call.from_user.id):
            await call.answer("❌ Доступ запрещен", show_alert=True)
            return
        
        data = await state.get_data()
        user_id = data.get('nft_user_id')
        amount = data.get('nft_amount')
        
        if not user_id or not amount:
            await call.answer("❌ Ошибка: данные потеряны", show_alert=True)
            await state.clear()
            return
        
        # Начисляем баланс
        update_user_balance_main(user_id, amount)
        
        # Обновляем статистику депозитов
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("UPDATE stats SET value = value + ? WHERE key = 'total_deposits'", (amount,))
        conn.commit()
        conn.close()
        
        # Получаем данные пользователя
        user = get_user(user_id)
        username = user[1] if user else "Unknown"
        new_balance = user[2] if user else 0.0
        
        # Уведомление в канал логов
        await notify_admin(
            f"🎁 <b>Пополнение через NFT-подарок</b>\n\n"
            f"<blockquote>├ Пользователь: @{username} (ID: <code>{user_id}</code>)\n"
            f"├ Сумма: <b>${amount:.2f}</b>\n"
            f"├ Новый баланс: <b>${new_balance:.2f}</b>\n"
            f"└ Админ: @{call.from_user.username}</blockquote>"
        )
        
        # Уведомление пользователю
        try:
            await bot.send_message(
                user_id,
                f"🎉 <b>Ваш баланс пополнен!</b>\n\n"
                f"<blockquote>├ Способ: <b>NFT-подарок</b>\n"
                f"├ Сумма: <b>${amount:.2f}</b>\n"
                f"└ Баланс: <b>${new_balance:.2f}</b></blockquote>\n\n"
                f"<i>Спасибо за использование NFT-подарков для пополнения!</i>",
                parse_mode="HTML"
            )
        except Exception as e:
            logging.warning(f"Could not notify user {user_id}: {e}")
        
        # Ответ админу
        result_kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🔄 Еще одно пополнение", callback_data="admin_nft_deposit")],
            [InlineKeyboardButton(text="🔙 Назад в админку", callback_data="admin_panel")]
        ])
        
        await call.message.edit_text(
            f"✅ <b>Баланс успешно начислен!</b>\n\n"
            f"<blockquote>├ Пользователь: @{username} (ID: <code>{user_id}</code>)\n"
            f"├ Сумма: <b>${amount:.2f}</b>\n"
            f"└ Новый баланс: <b>${new_balance:.2f}</b></blockquote>",
            reply_markup=result_kb,
            parse_mode="HTML"
        )
        
        await state.clear()
        await call.answer("✅ Готово!")
        
    except Exception as e:
        logging.error(f"Error in admin_nft_confirm: {e}")
        await call.message.answer("❌ <b>Произошла ошибка</b>", parse_mode="HTML")
        await state.clear()

@dp.callback_query(F.data == "admin_find_user")
async def admin_find_user(call: types.CallbackQuery, state: FSMContext):
    try:
        if not is_admin(call.from_user.id):
            await call.answer("❌ Доступ запрещен", show_alert=True)
            return
        
        cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="❌ Отмена", callback_data="admin_panel")]
        ])
        
        await call.message.answer("🔍 <b>Поиск пользователя</b>\n\nВведите ID пользователя:", reply_markup=cancel_kb, parse_mode="HTML")
        await state.set_state(AdminStates.waiting_user_id)
    except Exception as e:
        logging.error(f"Error in admin_find_user: {e}")
        await call.message.answer(
            "❌ <b>Произошла ошибка</b>",
            parse_mode="HTML"
        )

@dp.message(AdminStates.waiting_user_id)
async def admin_show_user(message: types.Message, state: FSMContext):
    try:
        user_id = int(message.text)
        user = get_user(user_id)
        
        if not user:
            await message.answer("❌ Пользователь не найден")
            return
        
        await state.clear()
        await refresh_user_card(message, user_id)
        
    except ValueError:
        await message.answer("❌ Введите числовой ID")
    except Exception as e:
        logging.error(f"Error in admin_show_user: {e}")
        await message.answer("❌ <b>Произошла ошибка</b>", parse_mode="HTML")

async def refresh_user_card(message_or_call, user_id: int):
    """Полностью обновить карточку пользователя (текст + кнопки)"""
    user = get_user(user_id)
    if not user:
        text = "❌ Пользователь не найден"
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🔙 Назад", callback_data="admin_panel")]
        ])
        if isinstance(message_or_call, types.CallbackQuery):
            await message_or_call.message.edit_text(text, reply_markup=kb, parse_mode="HTML")
            await message_or_call.answer()
        else:
            await message_or_call.answer(text, reply_markup=kb, parse_mode="HTML")
        return

    balance = user[2] if user[2] is not None else 0.0
    ref_balance = user[4] if len(user) > 4 and user[4] is not None else 0.0
    is_banned = user[8] if len(user) > 8 else 0
    is_chat_off = is_chat_activity_disabled(user_id)

    status = "🔒 Заблокирован" if is_banned else "✅ Активен"
    chat_status = "🚫 Отключен" if is_chat_off else "✅ Работает"

    user_text = f"""
👤 <b>Пользователь {user_id}</b>

<blockquote>├ Username: @{user[1] or 'Нет'}
├ Статус: <b>{status}</b>
├ Чат-активность: <b>{chat_status}</b>
├ Баланс: <b>${balance:.2f}</b>
├ Реф. баланс: <b>${ref_balance:.2f}</b>
└ Регистрация: {user[3]}</blockquote>
    """

    kb = get_user_management_menu(user_id)

    try:
        if isinstance(message_or_call, types.CallbackQuery):
            # Редактируем сообщение из callback
            await message_or_call.message.edit_text(user_text, reply_markup=kb, parse_mode="HTML")
            await message_or_call.answer()  # убираем "часики" с кнопки
        else:
            # Обычное сообщение — отправляем новое
            await message_or_call.answer(user_text, reply_markup=kb, parse_mode="HTML")
    except Exception as e:
        logging.warning(f"refresh_user_card edit failed: {e}")
        # Если редактирование не удалось — отправляем новым сообщением
        if isinstance(message_or_call, types.CallbackQuery):
            await message_or_call.message.answer(user_text, reply_markup=kb, parse_mode="HTML")
            await message_or_call.answer()
        else:
            await message_or_call.answer(user_text, reply_markup=kb, parse_mode="HTML")

@dp.callback_query(F.data.startswith("admin_user_"))
async def admin_user_action(call: types.CallbackQuery, state: FSMContext):
    try:
        if not is_admin(call.from_user.id):
            await call.answer("❌ Доступ запрещен", show_alert=True)
            return
        
        # Парсим: admin_user_ACTION_userid
        parts = call.data.split("_")
        if len(parts) < 4:
            await call.answer("❌ Неверный формат", show_alert=True)
            return
        
        action = parts[2]
        user_id = int(parts[3])
        
        if action == "addbal":
            await state.update_data(target_user=user_id, action="add")
            cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="❌ Отмена", callback_data=f"admin_user_back_{user_id}")]
            ])
            await call.message.answer("💰 Введите сумму для начисления:", reply_markup=cancel_kb, parse_mode="HTML")
            await state.set_state(AdminStates.waiting_user_amount)
            
        elif action == "subbal":
            await state.update_data(target_user=user_id, action="sub")
            cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="❌ Отмена", callback_data=f"admin_user_back_{user_id}")]
            ])
            await call.message.answer("💰 Введите сумму для списания:", reply_markup=cancel_kb, parse_mode="HTML")
            await state.set_state(AdminStates.waiting_user_amount)
            
        elif action == "ban":
            ban_user(user_id)
            await call.answer(f"✅ Пользователь {user_id} заблокирован", show_alert=True)
            await refresh_user_card(call, user_id)
            
        elif action == "unban":
            unban_user(user_id)
            await call.answer(f"✅ Пользователь {user_id} разблокирован", show_alert=True)
            await refresh_user_card(call, user_id)
            
        elif action == "chatoff":
            toggle_chat_activity(user_id, True)
            await call.answer(f"🚫 Чат-активность отключена", show_alert=True)
            await refresh_user_card(call, user_id)
            
        elif action == "chaton":
            toggle_chat_activity(user_id, False)
            await call.answer(f"✅ Чат-активность включена", show_alert=True)
            await refresh_user_card(call, user_id)
            
        elif action == "back":
            await call.message.delete()
            await state.clear()
            
    except Exception as e:
        logging.error(f"Error in admin_user_action: {e}")
        await call.answer("❌ Ошибка", show_alert=True)

@dp.message(AdminStates.waiting_user_amount)
async def admin_balance_action(message: types.Message, state: FSMContext):
    try:
        amount = float(message.text)
        data = await state.get_data()
        user_id = data['target_user']
        action = data['action']
        
        if action == "add":
            update_user_balance(user_id, amount)
            action_text = "начислен"
        elif action == "sub":
            update_user_balance(user_id, -amount)
            action_text = "списан"
        
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🔙 Назад", callback_data=f"admin_user_back_{user_id}")]
        ])
        
        await message.answer(
            f"✅ {format_amount(amount)} {action_text} пользователю {user_id}",
            reply_markup=kb,
            parse_mode="HTML"
        )
        
        try:
            await bot.send_message(user_id, f"💰 Ваш баланс изменен на ${amount:.2f} ({action_text})")
        except:
            pass
        
        await state.clear()
    except ValueError:
        await message.answer("❌ Введите число")
    except Exception as e:
        logging.error(f"Error in admin_balance_action: {e}")
        await message.answer(
            "❌ <b>Произошла ошибка</b>",
            parse_mode="HTML"
        )

# 📢 Начало рассылки
@dp.callback_query(F.data == "admin_broadcast")
async def admin_broadcast(call: types.CallbackQuery, state: FSMContext):
    try:
        if not is_admin(call.from_user.id):
            await call.answer("❌ Доступ запрещен", show_alert=True)
            return
        
        # Сбрасываем сохраненные данные
        await state.update_data(
            broadcast_media_type=None,
            broadcast_file_id=None,
            broadcast_caption=None,
            broadcast_buttons=[]
        )
        
        cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="❌ Отмена", callback_data="admin_panel")]
        ])
        
        await call.message.answer(
            "📢 <b>Новая рассылка</b>\n\n"
            "Вы можете отправить:\n"
            "• Только текст\n"
            "• Фото с подписью\n"
            "• Видео с подписью\n"
            "• Гифку с подписью\n\n"
            "<b>Отправьте сообщение для рассылки:</b>",
            reply_markup=cancel_kb,
            parse_mode="HTML"
        )
        await state.set_state(AdminStates.waiting_broadcast_content)
        await call.answer()
    except Exception as e:
        logging.error(f"Error in admin_broadcast: {e}")
        await call.message.answer("❌ <b>Произошла ошибка</b>", parse_mode="HTML")

# 📨 Обработка контента (текст/медиа)
@dp.message(AdminStates.waiting_broadcast_content)
async def admin_broadcast_content(message: types.Message, state: FSMContext):
    try:
        # Проверяем тип контента
        if message.photo:
            await state.update_data(
                broadcast_media_type='photo',
                broadcast_file_id=message.photo[-1].file_id,
                broadcast_caption=message.caption or ""
            )
        elif message.video:
            await state.update_data(
                broadcast_media_type='video',
                broadcast_file_id=message.video.file_id,
                broadcast_caption=message.caption or ""
            )
        elif message.animation:  # GIF
            await state.update_data(
                broadcast_media_type='animation',
                broadcast_file_id=message.animation.file_id,
                broadcast_caption=message.caption or ""
            )
        elif message.text:
            await state.update_data(
                broadcast_media_type='text',
                broadcast_file_id=None,
                broadcast_caption=message.text
            )
        else:
            await message.answer("❌ <b>Неподдерживаемый тип контента</b>", parse_mode="HTML")
            return
        
        # Переходим к управлению кнопками
        await admin_broadcast_manage_buttons(message, state)
        
    except Exception as e:
        logging.error(f"Error in admin_broadcast_content: {e}")
        await message.answer("❌ <b>Произошла ошибка</b>", parse_mode="HTML")

# 🔘 Меню управления кнопками
async def admin_broadcast_manage_buttons(message, state: FSMContext):
    """Показать меню управления кнопками"""
    data = await state.get_data()
    buttons = data.get('broadcast_buttons', [])
    
    # Формируем список кнопок
    buttons_text = ""
    if buttons:
        buttons_text = "\n\n<b>Текущие кнопки:</b>\n"
        for i, btn in enumerate(buttons, 1):
            buttons_text += f"{i}. {btn['text']} → {btn['url']}\n"
    
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="➕ Добавить кнопку", callback_data="broadcast_add_button")],
        [InlineKeyboardButton(text="➖ Удалить кнопку", callback_data="broadcast_remove_button")],
        [InlineKeyboardButton(text="👁 Предпросмотр", callback_data="broadcast_preview")],
        [InlineKeyboardButton(text="✅ Продолжить", callback_data="broadcast_confirm")],
        [InlineKeyboardButton(text="❌ Отмена", callback_data="admin_panel")]
    ])
    
    await message.answer(
        f"📢 <b>Управление кнопками</b>{buttons_text}\n\n"
        "Добавьте кнопки-ссылки к рассылке или продолжите без них.",
        reply_markup=kb,
        parse_mode="HTML"
    )

# ➕ Добавление кнопки
@dp.callback_query(F.data == "broadcast_add_button")
async def broadcast_add_button(call: types.CallbackQuery, state: FSMContext):
    try:
        cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="❌ Отмена", callback_data="broadcast_manage_buttons")]
        ])
        
        await call.message.answer(
            "📝 <b>Новая кнопка</b>\n\n"
            "Введите текст кнопки (макс 64 символа):",
            reply_markup=cancel_kb,
            parse_mode="HTML"
        )
        await state.set_state(AdminStates.waiting_broadcast_button_text)
        await call.answer()
    except Exception as e:
        logging.error(f"Error in broadcast_add_button: {e}")

# Ввод текста кнопки
@dp.message(AdminStates.waiting_broadcast_button_text)
async def broadcast_button_text(message: types.Message, state: FSMContext):
    try:
        text = message.text
        if len(text) > 64:
            await message.answer("❌ <b>Текст кнопки не может превышать 64 символа</b>", parse_mode="HTML")
            return
        
        await state.update_data(button_temp_text=text)
        
        cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="❌ Отмена", callback_data="broadcast_manage_buttons")]
        ])
        
        await message.answer(
            "🔗 <b>URL кнопки</b>\n\n"
            "Введите ссылку (начиная с http:// или https://):",
            reply_markup=cancel_kb,
            parse_mode="HTML"
        )
        await state.set_state(AdminStates.waiting_broadcast_button_url)
    except Exception as e:
        logging.error(f"Error in broadcast_button_text: {e}")

# Ввод URL кнопки
@dp.message(AdminStates.waiting_broadcast_button_url)
async def broadcast_button_url(message: types.Message, state: FSMContext):
    try:
        url = message.text
        if not (url.startswith('http://') or url.startswith('https://')):
            await message.answer("❌ <b>Неверный формат URL</b>", parse_mode="HTML")
            return
        
        data = await state.get_data()
        text = data['button_temp_text']
        
        # Добавляем кнопку
        buttons = data.get('broadcast_buttons', [])
        buttons.append({'text': text, 'url': url})
        await state.update_data(broadcast_buttons=buttons, button_temp_text=None)
        
        await message.answer(f"✅ Кнопка добавлена: <b>{text}</b>", parse_mode="HTML")
        await admin_broadcast_manage_buttons(message, state)
        
    except Exception as e:
        logging.error(f"Error in broadcast_button_url: {e}")

# ➖ Удаление кнопки
@dp.callback_query(F.data == "broadcast_remove_button")
async def broadcast_remove_button(call: types.CallbackQuery, state: FSMContext):
    try:
        data = await state.get_data()
        buttons = data.get('broadcast_buttons', [])
        
        if not buttons:
            await call.answer("❌ Нет кнопок для удаления", show_alert=True)
            return
        
        # Создаем клавиатуру для выбора кнопки
        kb = []
        for i, btn in enumerate(buttons, 1):
            kb.append([InlineKeyboardButton(text=f"{i}. {btn['text']}", callback_data=f"broadcast_remove_{i}")])
        
        kb.append([InlineKeyboardButton(text="❌ Отмена", callback_data="broadcast_manage_buttons")])
        
        await call.message.answer(
            "🗑 <b>Выберите кнопку для удаления:</b>",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=kb),
            parse_mode="HTML"
        )
        await call.answer()
    except Exception as e:
        logging.error(f"Error in broadcast_remove_button: {e}")

# Подтверждение удаления кнопки
@dp.callback_query(F.data.startswith("broadcast_remove_"))
async def broadcast_remove_button_confirm(call: types.CallbackQuery, state: FSMContext):
    try:
        index = int(call.data.split("_")[2]) - 1
        
        data = await state.get_data()
        buttons = data.get('broadcast_buttons', [])
        
        if 0 <= index < len(buttons):
            removed = buttons.pop(index)
            await state.update_data(broadcast_buttons=buttons)
            await call.answer(f"✅ Кнопка удалена: {removed['text']}", show_alert=True)
        
        await admin_broadcast_manage_buttons(call.message, state)
    except Exception as e:
        logging.error(f"Error in broadcast_remove_button_confirm: {e}")

# Возврат к управлению кнопками
@dp.callback_query(F.data == "broadcast_manage_buttons")
async def broadcast_return_to_buttons(call: types.CallbackQuery, state: FSMContext):
    await admin_broadcast_manage_buttons(call.message, state)
    await call.answer()

# 👁 Предпросмотр рассылки
@dp.callback_query(F.data == "broadcast_preview")
async def broadcast_preview(call: types.CallbackQuery, state: FSMContext):
    try:
        data = await state.get_data()
        media_type = data.get('broadcast_media_type')
        file_id = data.get('broadcast_file_id')
        caption = data.get('broadcast_caption', '')
        buttons = data.get('broadcast_buttons', [])
        
        # Создаем клавиатуру кнопок
        kb = []
        for btn in buttons:
            kb.append([InlineKeyboardButton(text=btn['text'], url=btn['url'])])
        
        # Добавляем кнопку закрытия превью
        kb.append([InlineKeyboardButton(text="❌ Закрыть превью", callback_data="broadcast_manage_buttons")])
        
        keyboard = InlineKeyboardMarkup(inline_keyboard=kb) if kb else None
        
        # Отправляем превью
        if media_type == 'photo':
            await call.message.answer_photo(
                photo=file_id,
                caption=caption,
                reply_markup=keyboard,
                parse_mode="HTML"
            )
        elif media_type == 'video':
            await call.message.answer_video(
                video=file_id,
                caption=caption,
                reply_markup=keyboard,
                parse_mode="HTML"
            )
        elif media_type == 'animation':
            await call.message.answer_animation(
                animation=file_id,
                caption=caption,
                reply_markup=keyboard,
                parse_mode="HTML"
            )
        elif media_type == 'text':
            await call.message.answer(
                caption,
                reply_markup=keyboard,
                parse_mode="HTML"
            )
        else:
            await call.answer("❌ Превью для этого типа не поддерживается", show_alert=True)
            return
        
        await call.answer()
    except Exception as e:
        logging.error(f"Error in broadcast_preview: {e}")
        await call.answer("❌ Ошибка превью", show_alert=True)

# ✅ Подтверждение и отправка рассылки
@dp.callback_query(F.data == "broadcast_confirm")
async def admin_broadcast_confirm(call: types.CallbackQuery, state: FSMContext):
    try:
        if not is_admin(call.from_user.id):
            await call.answer("❌ Доступ запрещен", show_alert=True)
            return
        
        # Получаем данные рассылки
        data = await state.get_data()
        media_type = data.get('broadcast_media_type')
        file_id = data.get('broadcast_file_id')
        caption = data.get('broadcast_caption', '')
        buttons = data.get('broadcast_buttons', [])
        
        # Создаем финальную клавиатуру
        kb = []
        for btn in buttons:
            kb.append([InlineKeyboardButton(text=btn['text'], url=btn['url'])])
        keyboard = InlineKeyboardMarkup(inline_keyboard=kb) if kb else None
        
        # Получаем список пользователей
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("SELECT user_id FROM users WHERE is_banned = 0")
        users = c.fetchall()
        conn.close()
        
        # Отправляем рассылку
        sent = 0
        blocked = 0
        
        reply_markup = InlineKeyboardMarkup(inline_keyboard=[[
            InlineKeyboardButton(text="🔙 Назад в админку", callback_data="admin_panel")
        ]])
        
        # Отправляем первое сообщение-отчет
        await call.message.answer(
            "⏳ <b>Рассылка запущена...</b>\n\n"
            "Пожалуйста, подождите.",
            parse_mode="HTML"
        )
        
        for user in users:
            try:
                user_id = user[0]
                
                if media_type == 'photo':
                    await bot.send_photo(
                        chat_id=user_id,
                        photo=file_id,
                        caption=caption,
                        reply_markup=keyboard,
                        parse_mode="HTML"
                    )
                elif media_type == 'video':
                    await bot.send_video(
                        chat_id=user_id,
                        video=file_id,
                        caption=caption,
                        reply_markup=keyboard,
                        parse_mode="HTML"
                    )
                elif media_type == 'animation':
                    await bot.send_animation(
                        chat_id=user_id,
                        animation=file_id,
                        caption=caption,
                        reply_markup=keyboard,
                        parse_mode="HTML"
                    )
                elif media_type == 'text':
                    await bot.send_message(
                        chat_id=user_id,
                        text=caption,
                        reply_markup=keyboard,
                        parse_mode="HTML"
                    )
                else:
                    continue
                
                sent += 1
                await asyncio.sleep(BROADCAST_COOLDOWN)  # Задержка чтобы не превысить лимиты
                
            except Exception as e:
                blocked += 1
                logging.error(f"Failed to send to {user_id}: {e}")
        
        # Отправляем финальный отчет
        await call.message.answer(
            f"✅ Рассылка завершена!\n\n"
            f"Доставлено: <b>{sent}</b>\n"
            f"Не доставлено: <b>{blocked}</b>",
            reply_markup=reply_markup,
            parse_mode="HTML"
        )
        
        await state.clear()
        
    except Exception as e:
        logging.error(f"Error in admin_broadcast_confirm: {e}", exc_info=True)
        await call.message.answer("❌ <b>Ошибка рассылки</b>", parse_mode="HTML")
        await state.clear()
        
@dp.callback_query(F.data == "admin_gift")
async def admin_gift_start(call: types.CallbackQuery, state: FSMContext):
    """Начало процесса отправки подарка"""
    try:
        if not is_admin(call.from_user.id):
            await call.answer("❌ Доступ запрещен", show_alert=True)
            return
        
        # Получаем список подарков из конфига (GIFTS или CASE_ITEMS)
        gifts = GIFTS if 'GIFTS' in globals() else {}
        
        if not gifts:
            # Fallback на CASE_ITEMS если GIFTS не определен
            gifts = {}
            for item in CASE_ITEMS:
                if item.get("gift_id") and not item["gift_id"].startswith("YOUR_"):
                    gifts[item["gift_id"]] = f"{item['emoji']} {item['name']}"
        
        if not gifts:
            await call.answer("❌ Нет доступных подарков в конфиге!", show_alert=True)
            return
        
        cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="❌ Отмена", callback_data="admin_panel")]
        ])
        
        await call.message.edit_text(
            "🎁 <b>Отправка подарка</b>\n\n"
            "Введите ID пользователя (Telegram ID), которому хотите отправить подарок:\n\n"
            "<i>Напишите /cancel для отмены</i>",
            reply_markup=cancel_kb,
            parse_mode="HTML"
        )
        await state.set_state(AdminGiftStates.waiting_for_user_id)
        await call.answer()
        
    except Exception as e:
        logging.error(f"Error in admin_gift_start: {e}")
        await call.message.answer("❌ <b>Произошла ошибка</b>", parse_mode="HTML")

@dp.message(AdminGiftStates.waiting_for_user_id)
async def admin_gift_get_user_id(message: types.Message, state: FSMContext):
    """Получение ID пользователя"""
    try:
        if message.text == "/cancel":
            await state.clear()
            await message.answer("❌ Отправка подарка отменена.", reply_markup=get_admin_menu())
            return
        
        try:
            user_id = int(message.text)
        except ValueError:
            await message.answer(
                "❌ <b>Неверный формат ID!</b>\nВведите числовой Telegram ID:\n\n"
                "<i>Напишите /cancel для отмены</i>",
                parse_mode="HTML"
            )
            return
        
        # Проверяем существование пользователя в БД
        user = get_user(user_id)
        if not user:
            await message.answer(
                "❌ <b>Пользователь с таким ID не найден в базе!</b>\n"
                "Возможно, он еще не запускал бота.\n"
                "Попробуйте другой ID:",
                parse_mode="HTML"
            )
            return
        
        await state.update_data(user_id=user_id)
        
        # Получаем список подарков
        gifts = GIFTS if 'GIFTS' in globals() else {}
        if not gifts:
            gifts = {}
            for item in CASE_ITEMS:
                if item.get("gift_id") and not item["gift_id"].startswith("YOUR_"):
                    gifts[item["gift_id"]] = f"{item['emoji']} {item['name']}"
        
        # Создаем кнопки для подарков
        inline_keyboard = []
        row = []
        
        for i, (gift_id_str, gift_name) in enumerate(gifts.items(), 1):
            button = InlineKeyboardButton(
                text=gift_name,
                callback_data=f"gift_id_{gift_id_str}"
            )
            row.append(button)
            
            # Размещаем по 2 кнопки в ряд
            if i % 2 == 0:
                inline_keyboard.append(row)
                row = []
        
        # Добавляем оставшиеся кнопки
        if row:
            inline_keyboard.append(row)
        
        # Добавляем кнопку для ввода кастомного ID
        inline_keyboard.append([
            InlineKeyboardButton(text="📝 Ввести другой ID", callback_data="gift_custom")
        ])
        inline_keyboard.append([
            InlineKeyboardButton(text="❌ Отмена", callback_data="admin_panel")
        ])
        
        markup = InlineKeyboardMarkup(inline_keyboard=inline_keyboard)
        
        username = user[1] if user[1] else "Нет username"
        
        await message.answer(
            f"👤 <b>Пользователь найден:</b>\n"
            f"├ ID: <code>{user_id}</code>\n"
            f"├ Username: @{username}\n"
            f"└ Баланс: <b>${user[2]:.2f}</b>\n\n"
            f"🎁 <b>Выберите подарок для отправки:</b>",
            reply_markup=markup,
            parse_mode="HTML"
        )
        
    except Exception as e:
        logging.error(f"Error in admin_gift_get_user_id: {e}")
        await message.answer("❌ <b>Произошла ошибка</b>", parse_mode="HTML")
        await state.clear()

@dp.callback_query(F.data.startswith("gift_id_"))
async def admin_gift_select_id(call: types.CallbackQuery, state: FSMContext):
    """Выбор подарка из списка"""
    try:
        # Извлекаем ID подарка
        gift_id_str = call.data.split("_")[2]
        
        await state.update_data(gift_id=gift_id_str)
        await state.set_state(AdminGiftStates.waiting_for_comment)
        
        # Получаем имя подарка
        gifts = GIFTS if 'GIFTS' in globals() else {}
        if not gifts:
            gifts = {}
            for item in CASE_ITEMS:
                if item.get("gift_id"):
                    gifts[item["gift_id"]] = f"{item['emoji']} {item['name']}"
        
        gift_name = gifts.get(gift_id_str, f"Подарок {gift_id_str}")
        
        markup = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="❌ Без комментария", callback_data="gift_no_comment")],
            [InlineKeyboardButton(text="🔙 Назад", callback_data="admin_gift")]
        ])
        
        await call.message.edit_text(
            f"🎁 <b>Выбран подарок:</b> {gift_name}\n"
            f"🔢 <b>ID:</b> <code>{gift_id_str}</code>\n\n"
            f"💬 <b>Введите комментарий для получателя:</b>\n\n"
            f"<i>Или нажмите кнопку ниже для отправки без комментария</i>",
            reply_markup=markup,
            parse_mode="HTML"
        )
        await call.answer()
        
    except Exception as e:
        logging.error(f"Error in admin_gift_select_id: {e}")
        await call.message.answer("❌ <b>Произошла ошибка</b>", parse_mode="HTML")
        await state.clear()

@dp.callback_query(F.data == "gift_custom")
async def admin_gift_custom_id(call: types.CallbackQuery, state: FSMContext):
    """Ввод кастомного ID подарка"""
    try:
        await state.set_state(AdminGiftStates.waiting_for_gift_id)
        
        cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="❌ Отмена", callback_data="admin_panel")]
        ])
        
        await call.message.edit_text(
            "📝 <b>Введите ID подарка</b>\n\n"
            "Введите ID подарка (только цифры):\n\n"
            "<i>Например: 5170145012310081615</i>",
            reply_markup=cancel_kb,
            parse_mode="HTML"
        )
        await call.answer()
        
    except Exception as e:
        logging.error(f"Error in admin_gift_custom_id: {e}")
        await call.message.answer("❌ <b>Произошла ошибка</b>", parse_mode="HTML")

@dp.message(AdminGiftStates.waiting_for_gift_id)
async def admin_gift_get_gift_id(message: types.Message, state: FSMContext):
    """Получение кастомного ID подарка"""
    try:
        if message.text == "/cancel":
            await state.clear()
            await message.answer("❌ Отправка подарка отменена.")
            return
        
        gift_id_str = message.text.strip()
        
        # Проверяем, что ID содержит только цифры
        if not gift_id_str.isdigit():
            await message.answer(
                "❌ <b>ID подарка должен содержать только цифры!</b>\n"
                "Попробуйте еще раз или напишите /cancel",
                parse_mode="HTML"
            )
            return
        
        await state.update_data(gift_id=gift_id_str)
        await state.set_state(AdminGiftStates.waiting_for_comment)
        
        markup = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="❌ Без комментария", callback_data="gift_no_comment")],
            [InlineKeyboardButton(text="🔙 Назад", callback_data="admin_gift")]
        ])
        
        await message.answer(
            f"🎁 <b>ID подарка:</b> <code>{gift_id_str}</code>\n\n"
            f"💬 <b>Введите комментарий для получателя:</b>\n\n"
            f"<i>Или нажмите кнопку ниже для отправки без комментария</i>",
            reply_markup=markup,
            parse_mode="HTML"
        )
        
    except Exception as e:
        logging.error(f"Error in admin_gift_get_gift_id: {e}")
        await message.answer("❌ <b>Произошла ошибка</b>", parse_mode="HTML")
        await state.clear()

@dp.message(AdminGiftStates.waiting_for_comment)
async def admin_gift_get_comment(message: types.Message, state: FSMContext):
    """Получение комментария и отправка подарка"""
    try:
        if message.text == "/cancel":
            await state.clear()
            await message.answer("❌ Отправка подарка отменена.")
            return
        
        comment = message.text.strip()
        data = await state.get_data()
        
        await process_gift_sending(message, state, data['gift_id'], comment)
        
    except Exception as e:
        logging.error(f"Error in admin_gift_get_comment: {e}")
        await message.answer("❌ <b>Произошла ошибка</b>", parse_mode="HTML")
        await state.clear()

@dp.callback_query(F.data == "gift_no_comment")
async def admin_gift_no_comment(call: types.CallbackQuery, state: FSMContext):
    """Отправка без комментария"""
    try:
        data = await state.get_data()
        await process_gift_sending(call.message, state, data['gift_id'], "")
        await call.answer()
        
    except Exception as e:
        logging.error(f"Error in admin_gift_no_comment: {e}")
        await call.message.answer("❌ <b>Произошла ошибка</b>", parse_mode="HTML")
        await state.clear()

async def process_gift_sending(update_or_message, state: FSMContext, gift_id_str: str, comment: str = ""):
    """Обработка отправки подарка"""
    try:
        data = await state.get_data()
        user_id = data.get('user_id')
        
        if not user_id:
            if hasattr(update_or_message, 'answer'):
                await update_or_message.answer("❌ <b>Ошибка: данные потеряны</b>", parse_mode="HTML")
            else:
                await update_or_message.answer("❌ <b>Ошибка: данные потеряны</b>", parse_mode="HTML")
            await state.clear()
            return
        
        # Получаем информацию о пользователе
        user = get_user(user_id)
        if not user:
            error_msg = "❌ <b>Пользователь не найден!</b>"
            if hasattr(update_or_message, 'answer'):
                await update_or_message.answer(error_msg, parse_mode="HTML")
            else:
                await update_or_message.edit_text(error_msg, parse_mode="HTML")
            await state.clear()
            return
        
        # Получаем имя подарка
        gifts = GIFTS if 'GIFTS' in globals() else {}
        if not gifts:
            gifts = {}
            for item in CASE_ITEMS:
                if item.get("gift_id"):
                    gifts[item["gift_id"]] = f"{item['emoji']} {item['name']}"
        
        gift_name = gifts.get(gift_id_str, f"Подарок {gift_id_str}")
        
        # Отправляем подарок через CasesGame (использует HTTP API)
        success, result = await cases_game.send_gift(user_id, gift_id_str, comment)
        
        if success:
            # Успешная отправка
            comment_text = f"\n💬 <b>Комментарий:</b> {comment}" if comment else ""
            
            success_text = (
                f"✅ <b>Подарок успешно отправлен!</b>\n\n"
                f"👤 <b>Получатель:</b> @{user[1] or 'Нет username'} (ID: <code>{user_id}</code>)\n"
                f"🎁 <b>Подарок:</b> {gift_name}\n"
                f"🔢 <b>ID:</b> <code>{gift_id_str}</code>"
                f"{comment_text}\n"
                f"⏰ <b>Время:</b> {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
            )
            
            # Отправляем подтверждение админу
            if hasattr(update_or_message, 'answer'):
                await update_or_message.answer(success_text, parse_mode="HTML", reply_markup=get_admin_menu())
            else:
                await update_or_message.edit_text(success_text, parse_mode="HTML", reply_markup=get_admin_menu())
            
            # Уведомляем пользователя
            try:
                user_notification = (
                    f"🎁 <b>Вы получили подарок от администратора!</b>\n\n"
                    f"🎁 <b>Подарок:</b> {gift_name}\n"
                )
                if comment:
                    user_notification += f"💬 <b>Сообщение:</b> <i>{comment}</i>\n"
                user_notification += f"\n<i>Подарок добавлен в вашу коллекцию Telegram Gifts!</i>"
                
                await bot.send_message(user_id, user_notification, parse_mode="HTML")
            except Exception as e:
                logging.warning(f"Не удалось отправить уведомление пользователю {user_id}: {e}")
            
            # Логируем в админ-группу
            admin_username = update_or_message.from_user.username if hasattr(update_or_message, 'from_user') else 'Unknown'
            await notify_admin(
                f"🎁 <b>Админ отправил подарок</b>\n\n"
                f"<blockquote>├ Админ: @{admin_username}\n"
                f"├ Получатель: @{user[1] or 'Нет username'} (ID: {user_id})\n"
                f"├ Подарок: <b>{gift_name}</b>\n"
                f"└ Комментарий: {comment or 'Нет'}</blockquote>"
            )
            
            logging.info(f"Admin sent gift {gift_id_str} to user {user_id}")
            
        else:
            # Ошибка отправки
            error_msg = f"❌ <b>Ошибка отправки подарка:</b>\n<code>{result}</code>"
            
            if hasattr(update_or_message, 'answer'):
                await update_or_message.answer(error_msg, parse_mode="HTML", reply_markup=get_admin_menu())
            else:
                await update_or_message.edit_text(error_msg, parse_mode="HTML", reply_markup=get_admin_menu())
        
        await state.clear()
        
    except Exception as e:
        logging.error(f"Error in process_gift_sending: {e}", exc_info=True)
        error_msg = "❌ <b>Произошла ошибка при отправке подарка</b>"
        
        if hasattr(update_or_message, 'answer'):
            await update_or_message.answer(error_msg, parse_mode="HTML")
        else:
            await update_or_message.edit_text(error_msg, parse_mode="HTML")
        
        await state.clear()

@dp.callback_query(F.data == "admin_raffles")
async def admin_raffles_menu(call: types.CallbackQuery):
    try:
        if not is_admin(call.from_user.id):
            await call.answer("❌ Доступ запрещен", show_alert=True)
            return
        
        active = get_active_raffle()
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="➕ Создать розыгрыш", callback_data="admin_raffle_create")],
            [InlineKeyboardButton(text="📜 Активные розыгрыши", callback_data="admin_raffle_active")],
            [InlineKeyboardButton(text="📊 История", callback_data="admin_raffle_history")],
            [InlineKeyboardButton(text="🔙 Назад", callback_data="admin_panel")]
        ])
        
        active_text = ""
        if active:
            end_dt = datetime.fromtimestamp(active['end_time']).strftime("%d.%m.%Y %H:%M")
            active_text = f"\n\n<b>Активный розыгрыш:</b>\n└ Завершится {end_dt}"
        
        await call.message.edit_text(
            f"🎟 <b>Управление розыгрышами</b>{active_text}",
            reply_markup=kb,
            parse_mode="HTML"
        )
    except Exception as e:
        logging.error(f"Error in admin_raffles_menu: {e}")

@dp.callback_query(F.data == "admin_raffle_create")
async def admin_raffle_create_start(call: types.CallbackQuery, state: FSMContext):
    try:
        if not is_admin(call.from_user.id):
            await call.answer("❌ Доступ запрещен", show_alert=True)
            return
        
        active = get_active_raffle()
        if active:
            await call.answer("❌ Уже есть активный розыгрыш. Завершите его сначала.", show_alert=True)
            return
        
        cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="❌ Отмена", callback_data="admin_raffles")]
        ])
        await call.message.answer(
            "🎟 <b>Создание розыгрыша</b>\n\n"
            "<b>Введите ссылку на NFT (подарок):</b>",
            reply_markup=cancel_kb,
            parse_mode="HTML"
        )
        await state.set_state(AdminRaffleStates.waiting_nft_link)
        await call.answer()
    except Exception as e:
        logging.error(f"Error in admin_raffle_create_start: {e}")

@dp.message(AdminRaffleStates.waiting_nft_link)
async def admin_raffle_get_link(message: types.Message, state: FSMContext):
    try:
        nft_link = message.text.strip()
        if not nft_link.startswith("http"):
            await message.answer("❌ <b>Ссылка должна начинаться с http:// или https://</b>", parse_mode="HTML")
            return
        
        await state.update_data(nft_link=nft_link)
        cancel_kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="❌ Отмена", callback_data="admin_raffles")]
        ])
        await message.answer(
            f"⏱ <b>Введите длительность розыгрыша в минутах</b>\n"
            f"<blockquote>└ От {MIN_RAFFLE_DURATION_MINUTES} до {MAX_RAFFLE_DURATION_MINUTES} минут</blockquote>",
            reply_markup=cancel_kb,
            parse_mode="HTML"
        )
        await state.set_state(AdminRaffleStates.waiting_duration)
    except Exception as e:
        logging.error(f"Error in admin_raffle_get_link: {e}")

@dp.message(AdminRaffleStates.waiting_duration)
async def admin_raffle_get_duration(message: types.Message, state: FSMContext):
    try:
        duration = int(message.text)
        if duration < MIN_RAFFLE_DURATION_MINUTES or duration > MAX_RAFFLE_DURATION_MINUTES:
            await message.answer(
                f"❌ <b>Длительность должна быть от {MIN_RAFFLE_DURATION_MINUTES} до {MAX_RAFFLE_DURATION_MINUTES} минут!</b>",
                parse_mode="HTML"
            )
            return
        
        data = await state.get_data()
        nft_link = data['nft_link']
        
        if create_raffle(message.from_user.id, duration, nft_link):
            end_time = datetime.fromtimestamp(int(time.time()) + duration*60).strftime("%d.%m.%Y %H:%M")
            kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="🔙 К розыгрышам", callback_data="admin_raffles")]
            ])
            await message.answer(
                f"✅ <b>Розыгрыш создан!</b>\n\n"
                f"<blockquote>├ NFT: <a href='{nft_link}'>ссылка</a>\n"
                f"├ Длительность: {duration} мин.\n"
                f"└ Завершится: {end_time}</blockquote>\n\n"
                f"<i>Ставки игроков начали учитываться.</i>",
                reply_markup=kb,
                parse_mode="HTML"
            )
            
            # ----- УВЕДОМЛЕНИЕ В КАНАЛ О НАЧАЛЕ РОЗЫГРЫША -----
            if RAFFLE_RESULTS_CHANNEL_ID:
                start_text = (
                    f"🎟 <b>НОВЫЙ РОЗЫГРЫШ NFT!</b>\n\n"
                    f"<blockquote>├ Приз: <a href='{nft_link}'>🎁 NFT-подарок</a>\n"
                    f"├ Длительность: <b>{duration} мин.</b>\n"
                    f"├ Окончание: <b>{end_time} (мск)</b>\n"
                    f"└ Условие: <b>наибольшее количество ставок</b> в любых играх бота</blockquote>\n\n"
                    f"🔥 <i>Делайте ставки – побеждает самый активный!</i>"
                )
                try:
                    await bot.send_message(RAFFLE_RESULTS_CHANNEL_ID, start_text, parse_mode="HTML")
                except Exception as e:
                    logging.error(f"Failed to send raffle start notification: {e}")
        else:
            await message.answer("❌ <b>Не удалось создать розыгрыш (возможно, уже есть активный).</b>", parse_mode="HTML")
        
        await state.clear()
    except ValueError:
        await message.answer("❌ <b>Введите целое число</b>", parse_mode="HTML")
    except Exception as e:
        logging.error(f"Error in admin_raffle_get_duration: {e}")
        await state.clear()

@dp.callback_query(F.data == "admin_raffle_active")
async def admin_raffle_show_active(call: types.CallbackQuery):
    if not is_admin(call.from_user.id):
        await call.answer("❌ Доступ запрещен", show_alert=True)
        return
    active = get_active_raffle()
    if not active:
        await call.answer("Нет активных розыгрышей", show_alert=True)
        return
    # Покажем детали и кнопку завершить/отменить
    end_dt = datetime.fromtimestamp(active['end_time']).strftime("%d.%m.%Y %H:%M")
    text = (
        f"🎟 <b>Активный розыгрыш</b>\n\n"
        f"├ ID: <code>{active['id']}</code>\n"
        f"├ NFT: <a href='{active['nft_link']}'>ссылка</a>\n"
        f"├ Длительность: {active['duration_minutes']} мин.\n"
        f"└ Завершится: {end_dt}"
    )
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="⏹ Завершить досрочно", callback_data=f"admin_raffle_cancel_{active['id']}")],
        [InlineKeyboardButton(text="🔙 Назад", callback_data="admin_raffles")]
    ])
    await call.message.edit_text(text, reply_markup=kb, parse_mode="HTML")
    await call.answer()

@dp.callback_query(F.data == "admin_raffle_history")
async def admin_raffle_history(call: types.CallbackQuery):
    if not is_admin(call.from_user.id):
        await call.answer("❌ Доступ запрещен", show_alert=True)
        return
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT id, start_time, end_time, nft_link, status, winner_user_id FROM raffles ORDER BY id DESC LIMIT 10")
    rows = c.fetchall()
    conn.close()
    if not rows:
        await call.answer("История пуста", show_alert=True)
        return
    text = "📊 <b>Последние розыгрыши</b>\n\n"
    for r in rows:
        r = dict(r)
        win = f"Победитель {r['winner_user_id']}" if r['winner_user_id'] else "нет участников"
        text += (
            f"<b>ID {r['id']}</b> | {r['status']}\n"
            f"{r['nft_link']}\n{win}\n\n"
        )
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🔙 Назад", callback_data="admin_raffles")]
    ])
    await call.message.edit_text(text, reply_markup=kb, parse_mode="HTML")
    await call.answer()

@dp.callback_query(F.data.startswith("admin_raffle_cancel_"))
async def admin_raffle_cancel(call: types.CallbackQuery):
    if not is_admin(call.from_user.id):
        await call.answer("❌ Доступ запрещен", show_alert=True)
        return
    raffle_id = int(call.data.split("_")[3])
    
    # Получаем данные розыгрыша до отмены для уведомления
    raffle = get_raffle_results(raffle_id)  # или отдельная функция, можно использовать get_active_raffle
    if raffle and raffle['status'] == 'active':
        cancel_raffle(raffle_id)
        if RAFFLE_RESULTS_CHANNEL_ID:
            cancel_text = (
                f"⚠️ <b>Розыгрыш отменён администратором</b>\n\n"
                f"<blockquote>├ ID розыгрыша: <code>{raffle_id}</code>\n"
                f"└ Приз: <a href='{raffle['nft_link']}'>NFT</a></blockquote>"
            )
            try:
                await bot.send_message(RAFFLE_RESULTS_CHANNEL_ID, cancel_text, parse_mode="HTML")
            except Exception as e:
                logging.error(f"Failed to send raffle cancel notification: {e}")
        
        await call.answer("Розыгрыш отменён", show_alert=True)
    else:
        await call.answer("Розыгрыш не найден или уже не активен", show_alert=True)
    
    await admin_raffles_menu(call)
async def process_expired_raffles():
    """Завершить все розыгрыши, время которых истекло."""
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        now = int(time.time())
        c.execute("SELECT id FROM raffles WHERE status = 'active' AND end_time <= ?", (now,))
        expired = c.fetchall()
        conn.close()
        
        for row in expired:
            raffle_id = row['id']
            result = finish_raffle(raffle_id)
            if result is None:
                continue
            
            if result['winner_user_id']:
                user = get_user(result['winner_user_id'])
                username = user[1] if user and user[1] else str(result['winner_user_id'])
                user_id = result['winner_user_id']
                bets = result['bets_count']
                nft_link = result['nft_link']
                
                # Текст для канала
                text = (
                    f"🏆 <b>РОЗЫГРЫШ ЗАВЕРШЁН!</b>\n\n"
                    f"<blockquote>├ Победитель: <b>@{username}</b> (ID: <code>{user_id}</code>)\n"
                    f"├ Всего ставок: <b>{bets}</b>\n"
                    f"└ Приз: <a href='{nft_link}'>🎁 NFT-подарок</a></blockquote>\n\n"
                    f"🎉 Поздравляем победителя! Следующий розыгрыш уже скоро."
                )
                
                # Клавиатура с кнопкой профиля победителя
                kb = InlineKeyboardMarkup(inline_keyboard=[
                    [InlineKeyboardButton(text="🔗 Профиль победителя", url=f"tg://user?id={user_id}")]
                ])
                
                # Личное уведомление победителю
                win_text = (
                    f"🏆 <b>Вы победили в розыгрыше NFT!</b>\n\n"
                    f"<blockquote>├ Ваш приз: <a href='{nft_link}'>открыть подарок</a>\n"
                    f"└ Ваши ставки: <b>{bets}</b></blockquote>\n\n"
                    f"🎉 Поздравляем!"
                )
                try:
                    await bot.send_message(user_id, win_text, parse_mode="HTML")
                except Exception as e:
                    logging.error(f"Notify winner error: {e}")
            else:
                # Нет участников
                text = (
                    f"🎟 <b>РОЗЫГРЫШ ЗАВЕРШЁН</b>\n\n"
                    f"<blockquote>└ Участников не было :(</blockquote>\n\n"
                    f"Приз: <a href='{nft_link}'>NFT</a> остаётся в банке."
                )
                kb = None
            
            # Отправка в канал
            if RAFFLE_RESULTS_CHANNEL_ID:
                try:
                    await bot.send_message(
                        RAFFLE_RESULTS_CHANNEL_ID,
                        text,
                        reply_markup=kb,
                        parse_mode="HTML"
                    )
                except Exception as e:
                    logging.error(f"Failed to send raffle results: {e}")
                    
    except Exception as e:
        logging.error(f"process_expired_raffles error: {e}")

async def check_raffles_loop():
    """Фоновый цикл проверки розыгрышей."""
    while True:
        try:
            await process_expired_raffles()
        except Exception as e:
            logging.error(f"check_raffles_loop error: {e}")
        await asyncio.sleep(60)   # проверка каждые 60 секунд
  
@dp.message(Command("q"))
async def cmd_db_backup(message: types.Message):
    """Создать резервную копию БД и отправить в канал логов"""
    try:
        # Проверка прав администратора
        if not is_admin(message.from_user.id):
            await message.answer("❌ <b>Доступ запрещен</b>", parse_mode="HTML")
            return
        
        # Проверка существования файла БД
        if not os.path.exists(DB_PATH):
            await message.answer("❌ <b>Файл базы данных не найден</b>", parse_mode="HTML")
            return
        
        # Информация о файле
        file_size = os.path.getsize(DB_PATH)
        size_mb = file_size / (1024 * 1024)
        current_time = datetime.now().strftime("%d.%m.%Y %H:%M:%S")
        
        # Подпись к файлу
        caption = f"📊 <b>Резервная копия БД</b>\n\n" \
                  f"<blockquote>├ Размер: <b>{size_mb:.2f} MB</b>\n" \
                  f"├ Админ: <b>@{message.from_user.username}</b>\n" \
                  f"└ Время: <b>{current_time}</b></blockquote>"
        
        # Отправка в канал логов
        if LOGS_CHANNEL_ID:
            try:
                document = FSInputFile(DB_PATH, filename=f"casino_backup_{int(time.time())}.db")
                await bot.send_document(
                    chat_id=LOGS_CHANNEL_ID,
                    document=document,
                    caption=caption,
                    parse_mode="HTML"
                )
                
                await message.answer(
                    f"✅ <b>Бэкап успешно создан!</b>\n\n"
                    f"<blockquote>└ Размер: <b>{size_mb:.2f} MB</b>\n"
                    f"└ Отправлен в канал логов</blockquote>",
                    parse_mode="HTML"
                )
            except Exception as e:
                logging.error(f"Failed to send backup to logs channel: {e}")
                await message.answer(
                    "⚠️ <b>Бэкап создан, но не удалось отправить</b>\n\n"
                    f"<blockquote>└ Ошибка: {str(e)[:100]}</blockquote>\n"
                    "Проверьте, что бот администратор в канале.",
                    parse_mode="HTML"
                )
        else:
            await message.answer(
                "❌ <b>Канал логов не настроен</b>\n\n"
                "Добавьте <code>LOGS_CHANNEL_ID</code> в config.py\n"
                "Например: <code>LOGS_CHANNEL_ID = -1001234567890</code>",
                parse_mode="HTML"
            )
        
        logging.info(f"DB backup created by admin {message.from_user.id}: {size_mb:.2f} MB")
        
    except Exception as e:
        logging.error(f"DB backup error: {e}", exc_info=True)
        await message.answer("❌ <b>Ошибка при создании бэкапа</b>", parse_mode="HTML")

@dp.callback_query(F.data == "partner_panel")
async def partner_panel(call: types.CallbackQuery):
    try:
        user_id = call.from_user.id
        if not is_partner(user_id):
            await call.answer("❌ Вы не являетесь партнером", show_alert=True)
            return
        info = get_partner_info(user_id)
        referrals = get_partner_referrals(user_id)
        total_referrals = len(referrals)
        balance = info["referral_balance"]
        frozen = info["frozen"]
        freeze_reason = info["freeze_reason"]

        text = f"""
🤝 <b>Партнерская панель</b>

<blockquote>├ Баланс: <b>${balance:.2f}</b>
├ Рефералов: <b>{total_referrals}</b>
└ Статус вывода: {"❌ Заморожен" if frozen else "✅ Активен"}</blockquote>
"""
        if frozen and freeze_reason:
            text += f"\n<i>Причина заморозки: {freeze_reason}</i>"

        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="📊 Статистика рефералов", callback_data="partner_stats")],
            [InlineKeyboardButton(text="💸 Вывести средства", callback_data="partner_withdraw")] if not frozen else [],
            [InlineKeyboardButton(text="🔙 Назад", callback_data="menu_main_full")]
        ])
        await call.message.edit_text(text, reply_markup=kb, parse_mode="HTML")
        await call.answer()
    except Exception as e:
        logging.error(f"partner_panel error: {e}")

@dp.callback_query(F.data == "partner_stats")
async def partner_stats(call: types.CallbackQuery):
    try:
        user_id = call.from_user.id
        if not is_partner(user_id):
            await call.answer("❌ Доступ запрещен", show_alert=True)
            return
        referrals = get_partner_referrals(user_id)
        if not referrals:
            text = "📊 У вас пока нет рефералов."
        else:
            text = "📊 <b>Ваши рефералы:</b>\n\n"
            for ref in referrals:
                text += f"├ ID: <code>{ref['user_id']}</code> | @{ref['username'] or 'Нет'} | {ref['registered']}\n"
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🔙 Назад", callback_data="partner_panel")]
        ])
        await call.message.edit_text(text, reply_markup=kb, parse_mode="HTML")
        await call.answer()
    except Exception as e:
        logging.error(f"partner_stats error: {e}")

@dp.callback_query(F.data == "partner_withdraw")
async def partner_withdraw(call: types.CallbackQuery):
    try:
        user_id = call.from_user.id
        info = get_partner_info(user_id)
        if info["frozen"]:
            await call.answer(f"❌ Вывод заморожен: {info['freeze_reason']}", show_alert=True)
            return
        balance = info["referral_balance"]
        if balance < MIN_WITHDRAW:
            await call.answer(f"❌ Минимальная сумма вывода: ${MIN_WITHDRAW:.2f}", show_alert=True)
            return
        success, result = create_withdrawal_check_ref(user_id, balance)
        if success:
            await call.message.answer(
                f"✅ <b>Вывод успешен!</b>\n"
                f"<blockquote>├ Сумма: <b>${balance:.2f}</b>\n"
                f"└ Чек: <a href='{result}'>Нажмите для получения</a></blockquote>",
                reply_markup=get_back_to_main_button(),
                parse_mode="HTML"
            )
        else:
            await call.answer(f"❌ Ошибка: {result}", show_alert=True)
    except Exception as e:
        logging.error(f"partner_withdraw error: {e}")

@dp.callback_query(F.data == "admin_partners")
async def admin_partners_menu(call: types.CallbackQuery):
    if not is_admin(call.from_user.id):
        await call.answer("❌ Доступ запрещен", show_alert=True)
        return
    partners = get_all_partners()
    text = "🤝 <b>Список партнеров</b>\n\n"
    if not partners:
        text += "Партнеров нет."
    else:
        for p in partners:
            text += f"ID: <code>{p['user_id']}</code> | @{p['username'] or 'Нет'} | Баланс: ${p['balance']:.2f} | {'🔒 Заморожен' if p['frozen'] else '✅ Активен'}\n"
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="➕ Добавить партнера", callback_data="admin_partner_add")],
        [InlineKeyboardButton(text="🔧 Управление партнером", callback_data="admin_partner_manage")],
        [InlineKeyboardButton(text="🔙 Назад", callback_data="admin_panel")]
    ])
    await call.message.edit_text(text, reply_markup=kb, parse_mode="HTML")
    await call.answer()

@dp.callback_query(F.data == "admin_partner_add")
async def admin_partner_add(call: types.CallbackQuery, state: FSMContext):
    if not is_admin(call.from_user.id):
        await call.answer("❌ Доступ запрещен", show_alert=True)
        return
    await call.message.answer("Введите ID пользователя для добавления в партнеры:")
    await state.set_state(AdminStates.waiting_partner_add)

@dp.message(AdminStates.waiting_partner_add)
async def process_admin_partner_add(message: types.Message, state: FSMContext):
    try:
        user_id = int(message.text.strip())
        if is_partner(user_id):
            await message.answer("❌ Пользователь уже является партнером.")
        else:
            set_partner(user_id, True)
            await message.answer(f"✅ Пользователь {user_id} добавлен в партнеры.")
        await state.clear()
    except ValueError:
        await message.answer("❌ Введите корректный ID (число).")
    except Exception as e:
        logging.error(f"add partner error: {e}")
        await message.answer("❌ Ошибка")

@dp.callback_query(F.data == "admin_partner_manage")
async def admin_partner_manage(call: types.CallbackQuery, state: FSMContext):
    if not is_admin(call.from_user.id):
        await call.answer("❌ Доступ запрещен", show_alert=True)
        return
    await call.message.answer("Введите ID партнера для управления:")
    await state.set_state(AdminStates.waiting_partner_manage_id)

@dp.message(AdminStates.waiting_partner_manage_id)
async def process_admin_partner_manage_id(message: types.Message, state: FSMContext):
    try:
        user_id = int(message.text.strip())
        if not is_partner(user_id):
            await message.answer("❌ Пользователь не является партнером.")
            await state.clear()
            return
        await state.update_data(partner_id=user_id)
        info = get_partner_info(user_id)
        text = f"👤 <b>Управление партнером {user_id}</b>\n\n"
        text += f"Баланс: ${info['referral_balance']:.2f}\n"
        text += f"Заморожен: {'Да' if info['frozen'] else 'Нет'}\n"
        if info['frozen']:
            text += f"Причина: {info['freeze_reason']}\n"
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="❌ Удалить из партнеров", callback_data="admin_partner_remove")],
            [InlineKeyboardButton(text="🔒 Заморозить вывод", callback_data="admin_partner_freeze")],
            [InlineKeyboardButton(text="🔓 Разморозить вывод", callback_data="admin_partner_unfreeze")],
            [InlineKeyboardButton(text="🔙 Назад", callback_data="admin_partners")]
        ])
        await message.answer(text, reply_markup=kb, parse_mode="HTML")
        await state.clear()
    except ValueError:
        await message.answer("❌ Введите корректный ID.")
    except Exception as e:
        logging.error(f"manage partner error: {e}")

@dp.callback_query(F.data == "admin_partner_remove")
async def admin_partner_remove(call: types.CallbackQuery, state: FSMContext):
    if not is_admin(call.from_user.id):
        await call.answer("❌ Доступ запрещен", show_alert=True)
        return
    data = await state.get_data()
    user_id = data.get("partner_id")
    if not user_id:
        await call.answer("Ошибка: не найден ID", show_alert=True)
        return
    set_partner(user_id, False)
    await call.answer("✅ Партнер удален", show_alert=True)
    await admin_partners_menu(call)

@dp.callback_query(F.data == "admin_partner_freeze")
async def admin_partner_freeze(call: types.CallbackQuery, state: FSMContext):
    if not is_admin(call.from_user.id):
        await call.answer("❌ Доступ запрещен", show_alert=True)
        return
    await call.message.answer("Введите причину заморозки вывода:")
    await state.set_state(AdminStates.waiting_partner_freeze_reason)

@dp.message(AdminStates.waiting_partner_freeze_reason)
async def process_partner_freeze_reason(message: types.Message, state: FSMContext):
    try:
        reason = message.text.strip()
        data = await state.get_data()
        user_id = data.get("partner_id")
        if not user_id:
            await message.answer("Ошибка: не найден ID")
            await state.clear()
            return
        freeze_partner_withdrawal(user_id, reason)
        await message.answer(f"✅ Вывод для партнера {user_id} заморожен. Причина: {reason}")
        await state.clear()
    except Exception as e:
        logging.error(f"freeze reason error: {e}")

@dp.callback_query(F.data == "admin_partner_unfreeze")
async def admin_partner_unfreeze(call: types.CallbackQuery, state: FSMContext):
    if not is_admin(call.from_user.id):
        await call.answer("❌ Доступ запрещен", show_alert=True)
        return
    data = await state.get_data()
    user_id = data.get("partner_id")
    if not user_id:
        await call.answer("Ошибка: не найден ID", show_alert=True)
        return
    unfreeze_partner_withdrawal(user_id)
    await call.answer("✅ Вывод разморожен", show_alert=True)
    await admin_partners_menu(call)

@dp.callback_query(F.data == "admin_chat_activity")
async def admin_chat_activity_stats(call: types.CallbackQuery):
    """Админ-статистика активности в чате"""
    if not is_admin(call.from_user.id):
        await call.answer("❌ Доступ запрещен", show_alert=True)
        return
    
    global_stats = get_chat_activity_global_stats()
    top_users = get_top_chat_users(limit=5)
    
    text = (
        f"💬 <b>Статистика активности в чате</b>\n\n"
        f"<blockquote>├ Всего сообщений: <b>{global_stats['total_messages']}</b>\n"
        f"└ Всего выплачено: <b>${global_stats['total_earned']:.4f}</b></blockquote>\n\n"
        f"<b>🏆 Топ-5 активных:</b>\n"
    )
    
    for i, user_data in enumerate(top_users, 1):
        user = get_user(user_data['user_id'])
        username = user[1] if user else str(user_data['user_id'])
        medal = "🥇" if i == 1 else "🥈" if i == 2 else "🥉" if i == 3 else f"{i}."
        text += (
            f"{medal} @{username} — "
            f"<b>{user_data['message_count']}</b> сообщ., "
            f"${user_data['total_earned']:.4f}\n"
        )
    
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🔙 Назад", callback_data="admin_panel")]
    ])
    
    await call.message.edit_text(text, reply_markup=kb, parse_mode="HTML")

async def main():
    # При старте обработать истекшие розыгрыши (на случай простоя)
    await process_expired_raffles()
    # Запуск фоновых задач
    asyncio.create_task(check_deposits_loop())
    asyncio.create_task(check_raffles_loop())
    await dp.start_polling(bot, skip_updates=True)

if __name__ == "__main__":
    asyncio.run(main())
