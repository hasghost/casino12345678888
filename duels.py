import asyncio
import random
import logging
import sqlite3
import time

from aiogram import Dispatcher, types, F, Bot
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton

from database import (
    get_user,
    update_user_balance_main,
    is_admin,
    is_user_banned,
    create_duel_db,
    get_duel_db,
    update_duel_opponent,
    finish_duel_db,
    cancel_duel_db,
    get_pending_duel_in_chat,
    update_duel_choices,
    get_user_balances
)

from config import (
    DUEL_COMMISSION,
    MIN_DUEL_BET,
    MAX_DUEL_BET,
    format_amount,
    DB_PATH
)


logger = logging.getLogger(__name__)


# ============================================================
# ЗАЩИТА ОТ ДВОЙНОГО ЗАПУСКА ЧЕТ/НЕЧЕТ
# ============================================================

resolving_evenodd_duels = set()


# ============================================================
# КАТАЛОГ ИГР ДУЭЛЕЙ
# ============================================================

DUEL_GAMES = {
    "dice": {
        "name": "Dice Battle",
        "desc": "Бот бросает кубик для каждого. Большее число — победа!",
        "emoji": "🎲",
    },

    "basketball": {
        "name": "Basketball Battle",
        "desc": "Бот бросает мяч. Гол (4-5) побеждает промах (1-3)!",
        "emoji": "🏀",
    },

    "evenodd": {
        "name": "Чет/Нечет",
        "desc": "Кто угадает Чет или Нечет — тот забирает банк!",
        "emoji": "🎯"
    }
}


# ============================================================
# FSM
# ============================================================

class DuelCreationStates(StatesGroup):
    waiting_bet = State()


# ============================================================
# БЕЗОПАСНОЕ РЕДАКТИРОВАНИЕ СООБЩЕНИЯ
# ============================================================

async def safe_edit_message(
    bot: Bot,
    chat_id: int,
    message_id: int,
    text: str,
    reply_markup=None
):
    """
    Безопасное редактирование сообщения.

    Если Telegram отвечает:
    - message can't be edited
    - message is not modified
    - message to edit not found

    бот не падает.
    """

    try:
        return await bot.edit_message_text(
            chat_id=chat_id,
            message_id=message_id,
            text=text,
            reply_markup=reply_markup,
            parse_mode="HTML"
        )

    except Exception as e:
        error_text = str(e).lower()

        if (
            "message can't be edited" in error_text
            or "message is not modified" in error_text
            or "message to edit not found" in error_text
        ):
            logger.warning(
                f"Не удалось изменить сообщение "
                f"{chat_id}:{message_id}: {e}"
            )
            return None

        raise


# ============================================================
# ИНТЕРФЕЙС
# ============================================================

def games_menu():
    kb = [
        [
            InlineKeyboardButton(
                text=g["name"],
                callback_data=f"duel_create_{k}"
            )
        ]
        for k, g in DUEL_GAMES.items()
    ]

    kb.append([
        InlineKeyboardButton(
            text="❌ Отмена",
            callback_data="duel_cancel"
        )
    ])

    return InlineKeyboardMarkup(inline_keyboard=kb)


def duel_text(
    creator,
    game_key,
    bet,
    status="pending",
    opponent=None,
    creator_bal=None,
    opp_bal=None,
    creator_choice=None,
    opp_choice=None
):
    g = DUEL_GAMES[game_key]

    bank = bet * 2
    prize = bank * (1 - DUEL_COMMISSION)
    comm = bank * DUEL_COMMISSION

    lines = [
        f'<tg-emoji emoji-id="5235989068570977490">⚔</tg-emoji> '
        f'<b>{g["emoji"]} ДУЭЛЬ — {g["name"]}</b>',
        "",
        f'<tg-emoji emoji-id="5974038293120027938">👤</tg-emoji> '
        f'<b>Создатель:</b> @{creator}',
    ]

    if opponent:
        lines.append(
            f'<tg-emoji emoji-id="5242442819573927209">⚔</tg-emoji> '
            f'<b>Противник:</b> @{opponent}'
        )

    lines.extend([
        f'<tg-emoji emoji-id="5956500159239032673">🎮</tg-emoji> <b>Игра:</b> {g["desc"]}',
        f'<tg-emoji emoji-id="5426913374334122021">💰</tg-emoji> <b>Ставка:</b> {format_amount(bet)}',
        f'<tg-emoji emoji-id="5427383372605327673">🏦</tg-emoji> <b>Банк:</b> {format_amount(bank)}',
        f'<tg-emoji emoji-id="5890953718441970824">🏆</tg-emoji> <b>Приз:</b> {format_amount(prize)}',
        (
            f'<tg-emoji emoji-id="5426995996619999058">📊</tg-emoji> '
            f'<b>Комиссия казино:</b> {format_amount(comm)} '
            f'({int(DUEL_COMMISSION * 100)}%)'
        ),
        ""
    ])

    if creator_bal is not None:
        lines.append(
            f'<tg-emoji emoji-id="5426913374334122021">💵</tg-emoji> '
            f'<b>Баланс @{creator}:</b> '
            f'{format_amount(creator_bal)}'
        )

    if opp_bal is not None and opponent:
        lines.append(
            f'<tg-emoji emoji-id="5426913374334122021">💵</tg-emoji> '
            f'<b>Баланс @{opponent}:</b> '
            f'{format_amount(opp_bal)}'
        )

    # --------------------------------------------------------
    # ЧЕТ / НЕЧЕТ
    # --------------------------------------------------------

    if game_key == "evenodd" and status == "active":

        if creator_choice:
            lines.append(
                f"<b>@{creator} выбрал:</b> "
                f"{creator_choice}"
            )
        else:
            lines.append(
                f"<b>@{creator}</b> еще не выбрал ⏳"
            )

        if opponent:
            if opp_choice:
                lines.append(
                    f"<b>@{opponent} выбрал:</b> "
                    f"{opp_choice}"
                )
            else:
                lines.append(
                    f"<b>@{opponent}</b> еще не выбрал ⏳"
                )

    # --------------------------------------------------------
    # СТАТУС
    # --------------------------------------------------------

    if status == "pending":
        lines.append(
            '<i><tg-emoji emoji-id="5386367538735104399">⏳</tg-emoji> Ожидание противника...</i>'
        )

    elif status == "active":
        lines.append(
            '<i><tg-emoji emoji-id="5426842047812240711">🔥</tg-emoji> Дуэль началась!</i>'
        )

    elif status == "finished":
        lines.append(
            '<i><tg-emoji emoji-id="5424926264764958094">✅</tg-emoji> Дуэль завершена</i>'
        )

    return "\n".join(lines)


# ============================================================
# КНОПКИ ПРИНЯТИЯ
# ============================================================

def accept_kb(duel_id, creator_id):
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="⚔️ Принять вызов",
                    callback_data=(
                        f"duel_accept_{duel_id}_{creator_id}"
                    )
                )
            ],
            [
                InlineKeyboardButton(
                    text="❌ Отменить",
                    callback_data=f"duel_cancel_{duel_id}"
                )
            ]
        ]
    )


# ============================================================
# КНОПКИ ЧЕТ / НЕЧЕТ
# ============================================================

def evenodd_kb(duel_id, duel_message_id):
    """
    ВАЖНО:

    Теперь ID сообщения дуэли передаётся прямо
    в callback_data.

    Старый вариант:
        call.message.message_id - 1

    полностью убран.
    """

    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="🔵 Чет",
                    callback_data=(
                        f"duel_evenodd_"
                        f"{duel_id}_"
                        f"{duel_message_id}_"
                        f"even"
                    )
                ),

                InlineKeyboardButton(
                    text="🔴 Нечет",
                    callback_data=(
                        f"duel_evenodd_"
                        f"{duel_id}_"
                        f"{duel_message_id}_"
                        f"odd"
                    )
                )
            ]
        ]
    )


# ============================================================
# РЕГИСТРАЦИЯ ХЕНДЛЕРОВ
# ============================================================

def register_duel_handlers(dp: Dispatcher):

    bot: Bot = dp["bot"]

    # ========================================================
    # ТРИГГЕР В ЧАТЕ
    # ========================================================

    @dp.message(
        F.chat.type.in_({"group", "supergroup"}),
        F.text.lower().contains("дуэль")
    )
    async def duel_trigger(
        msg: types.Message,
        state: FSMContext
    ):

        if is_user_banned(msg.from_user.id):
            return

        await state.clear()

        pending = get_pending_duel_in_chat(msg.chat.id)

        if pending:
            await msg.reply(
                "⏳ <b>В этом чате уже есть активная дуэль!</b>",
                parse_mode="HTML"
            )
            return

        await msg.reply(
            '<tg-emoji emoji-id="5235989068570977490">⚔</tg-emoji> <b>Режим дуэлей</b>\n\n'
            'Выберите игру для поединка:',
            reply_markup=games_menu(),
            parse_mode="HTML"
        )

    # ========================================================
    # ОТМЕНА СОЗДАНИЯ
    # ========================================================

    @dp.callback_query(F.data == "duel_cancel")
    async def duel_cancel_cb(
        call: types.CallbackQuery,
        state: FSMContext
    ):

        await state.clear()

        try:
            await call.message.delete()
        except Exception:
            pass

        await call.answer("Отменено")

    # ========================================================
    # ВЫБОР ИГРЫ
    # ========================================================

    @dp.callback_query(
        F.data.startswith("duel_create_")
    )
    async def duel_create_cb(
        call: types.CallbackQuery,
        state: FSMContext
    ):

        game_type = call.data.split("_")[2]

        if game_type not in DUEL_GAMES:
            await call.answer(
                "❌ Игра не найдена",
                show_alert=True
            )
            return

        await state.update_data(
            duel_game=game_type
        )

        await call.message.edit_text(
            f'<tg-emoji emoji-id="5235989068570977490">⚔</tg-emoji>️ <b>{DUEL_GAMES[game_type]["name"]}</b>\n\n'
            f'💰 Введите сумму ставки ',
            parse_mode="HTML"
        )

        await state.set_state(
            DuelCreationStates.waiting_bet
        )

        await call.answer()

    # ========================================================
    # ВВОД СТАВКИ
    # ========================================================

    @dp.message(
        DuelCreationStates.waiting_bet
    )
    async def duel_bet_input(
        msg: types.Message,
        state: FSMContext
    ):

        if is_user_banned(msg.from_user.id):
            return

        try:
            bet = float(
                msg.text.replace(",", ".")
            )
        except (ValueError, AttributeError):
            await msg.reply(
                "❌ Введите число!",
                parse_mode="HTML"
            )
            return

        if bet < MIN_DUEL_BET:
            await msg.reply(
                f"❌ Минимум: "
                f"{format_amount(MIN_DUEL_BET)}",
                parse_mode="HTML"
            )
            return

        if bet > MAX_DUEL_BET:
            await msg.reply(
                f"❌ Максимум: "
                f"{format_amount(MAX_DUEL_BET)}",
                parse_mode="HTML"
            )
            return

        user = get_user(msg.from_user.id)

        if not user or (user[2] or 0) < bet:
            await msg.reply(
                "❌ Недостаточно средств на балансе!",
                parse_mode="HTML"
            )
            return

        data = await state.get_data()

        game_type = data.get("duel_game")

        if not game_type:
            return

        # ----------------------------------------------------
        # Списываем ставку создателя
        # ----------------------------------------------------

        update_user_balance_main(
            msg.from_user.id,
            -bet
        )

        creator_name = (
            msg.from_user.username
            or msg.from_user.first_name
        )

        duel_id = create_duel_db(
            msg.chat.id,
            None,
            msg.from_user.id,
            game_type,
            bet
        )

        duel_msg = await msg.answer(
            duel_text(
                creator_name,
                game_type,
                bet,
                creator_bal=user[2] - bet
            ),
            reply_markup=accept_kb(
                duel_id,
                msg.from_user.id
            ),
            parse_mode="HTML"
        )

        # ----------------------------------------------------
        # СОХРАНЯЕМ MESSAGE ID
        # ----------------------------------------------------

        conn = sqlite3.connect(DB_PATH)

        try:
            c = conn.cursor()

            c.execute(
                """
                UPDATE duels
                SET message_id = ?
                WHERE duel_id = ?
                """,
                (
                    duel_msg.message_id,
                    duel_id
                )
            )

            conn.commit()

        finally:
            conn.close()

        await state.clear()

    # ========================================================
    # ПРИНЯТИЕ ДУЭЛИ
    # ========================================================

    @dp.callback_query(
        F.data.startswith("duel_accept_")
    )
    async def duel_accept_cb(
        call: types.CallbackQuery
    ):

        try:
            parts = call.data.split("_")

            duel_id = int(parts[2])
            creator_id = int(parts[3])

        except (ValueError, IndexError):

            await call.answer(
                "❌ Некорректная дуэль",
                show_alert=True
            )
            return

        if call.from_user.id == creator_id:
            await call.answer(
                "❌ Нельзя принять свою дуэль!",
                show_alert=True
            )
            return

        duel = get_duel_db(duel_id)

        if not duel:
            await call.answer(
                "❌ Дуэль уже недоступна",
                show_alert=True
            )
            return

        if duel["status"] != "pending":
            await call.answer(
                "❌ Дуэль уже недоступна",
                show_alert=True
            )
            return

        # ----------------------------------------------------
        # ПРОВЕРКА БАЛАНСА
        # ----------------------------------------------------

        opp = get_user(call.from_user.id)

        if not opp or (opp[2] or 0) < duel["bet_amount"]:

            await call.answer(
                "❌ Недостаточно средств! "
                f"Нужно: {format_amount(duel['bet_amount'])}",
                show_alert=True
            )
            return

        # ----------------------------------------------------
        # СПИСЫВАЕМ СТАВКУ
        # ----------------------------------------------------

        update_user_balance_main(
            call.from_user.id,
            -duel["bet_amount"]
        )

        update_duel_opponent(
            duel_id,
            call.from_user.id
        )

        # Получаем свежие данные
        duel = get_duel_db(duel_id)

        if not duel:
            logger.error(
                f"Duel {duel_id} disappeared after accepting"
            )

            # Возвращаем ставку противнику
            update_user_balance_main(
                call.from_user.id,
                duel["bet_amount"]
            )

            await call.answer(
                "❌ Ошибка при принятии дуэли",
                show_alert=True
            )
            return

        creator = get_user(
            duel["creator_id"]
        )

        if not creator:
            await call.answer(
                "❌ Создатель дуэли не найден",
                show_alert=True
            )
            return

        c_name = (
            creator[1]
            or str(duel["creator_id"])
        )

        o_name = (
            call.from_user.username
            or call.from_user.first_name
        )

        # ====================================================
        # ЧЕТ / НЕЧЕТ
        # ====================================================

        if duel["game_type"] == "evenodd":

            # ID сообщения самой дуэли
            duel_message_id = (
                duel.get("message_id")
                or call.message.message_id
            )

            # Обновляем сообщение самой дуэли
            await safe_edit_message(
                bot,
                call.message.chat.id,
                duel_message_id,
                duel_text(
                    c_name,
                    duel["game_type"],
                    duel["bet_amount"],
                    status="active",
                    opponent=o_name,
                    creator_bal=get_user_balances(
                        duel["creator_id"]
                    )[0],
                    opp_bal=get_user_balances(
                        call.from_user.id
                    )[0]
                )
            )

            await call.answer(
                "✅ Вы приняли дуэль! "
                "Сделайте выбор Чет/Нечет."
            )

            # ------------------------------------------------
            # СОЗДАЁМ ОТДЕЛЬНОЕ СООБЩЕНИЕ ВЫБОРА
            # ------------------------------------------------

            await call.message.answer(
                "🎯 <b>Сделайте выбор:</b>\n\n"
                "Нажмите кнопку, чтобы выбрать "
                "Чет или Нечет.\n\n"
                "Оба игрока должны сделать выбор.",
                reply_markup=evenodd_kb(
                    duel_id,
                    duel_message_id
                ),
                parse_mode="HTML"
            )

            return

        # ====================================================
        # ОСТАЛЬНЫЕ ИГРЫ
        # ====================================================

        await safe_edit_message(
            bot,
            call.message.chat.id,
            call.message.message_id,
            duel_text(
                c_name,
                duel["game_type"],
                duel["bet_amount"],
                status="active",
                opponent=o_name,
                creator_bal=get_user_balances(
                    duel["creator_id"]
                )[0],
                opp_bal=get_user_balances(
                    call.from_user.id
                )[0]
            )
        )

        await call.answer(
            "✅ Вы приняли дуэль!"
        )

        await run_duel(
            bot,
            call.message.chat.id,
            duel_id,
            call.message.message_id,
            c_name,
            o_name
        )

    # ========================================================
    # ВЫБОР ЧЕТ / НЕЧЕТ
    # ========================================================

    @dp.callback_query(
        F.data.startswith("duel_evenodd_")
    )
    async def duel_evenodd_choice(
        call: types.CallbackQuery
    ):

        try:

            parts = call.data.split("_")

            # Формат:
            #
            # duel_evenodd_DUEL_ID_MESSAGE_ID_even
            #
            # parts:
            # 0 = duel
            # 1 = evenodd
            # 2 = duel_id
            # 3 = message_id
            # 4 = choice

            duel_id = int(parts[2])
            duel_message_id = int(parts[3])
            choice = parts[4]

            if choice not in ("even", "odd"):
                await call.answer(
                    "❌ Некорректный выбор",
                    show_alert=True
                )
                return

        except (ValueError, IndexError):

            await call.answer(
                "❌ Некорректная кнопка",
                show_alert=True
            )
            return

        # ----------------------------------------------------
        # ПОЛУЧАЕМ ДУЭЛЬ
        # ----------------------------------------------------

        duel = get_duel_db(duel_id)

        if not duel:

            await call.answer(
                "❌ Дуэль не найдена",
                show_alert=True
            )
            return

        # ----------------------------------------------------
        # ПРОВЕРКА СТАТУСА
        # ----------------------------------------------------

        if duel["status"] != "active":

            await call.answer(
                "❌ Дуэль уже завершена",
                show_alert=True
            )
            return

        # ----------------------------------------------------
        # ПРОВЕРКА ИГРОКА
        # ----------------------------------------------------

        uid = call.from_user.id

        if uid not in (
            duel["creator_id"],
            duel["opponent_id"]
        ):

            await call.answer(
                "❌ Это не ваша дуэль!",
                show_alert=True
            )
            return

        is_creator = (
            uid == duel["creator_id"]
        )

        # ----------------------------------------------------
        # ПРОВЕРКА ПОВТОРНОГО ВЫБОРА
        # ----------------------------------------------------

        if is_creator:

            if duel.get("creator_choice"):

                await call.answer(
                    "❌ Вы уже выбрали!",
                    show_alert=True
                )
                return

        else:

            if duel.get("opponent_choice"):

                await call.answer(
                    "❌ Вы уже выбрали!",
                    show_alert=True
                )
                return

        # ----------------------------------------------------
        # ЧЕЛОВЕЧЕСКОЕ НАЗВАНИЕ
        # ----------------------------------------------------

        choice_name = (
            "Чет"
            if choice == "even"
            else "Нечет"
        )

        # ----------------------------------------------------
        # СОХРАНЯЕМ ВЫБОР
        # ----------------------------------------------------

        if is_creator:

            update_duel_choices(
                duel_id,
                creator_choice=choice_name
            )

        else:

            update_duel_choices(
                duel_id,
                opponent_choice=choice_name
            )

        await call.answer(
            f"✅ Вы выбрали: {choice_name}"
        )

        # ----------------------------------------------------
        # ПОЛУЧАЕМ ОБНОВЛЁННУЮ ДУЭЛЬ
        # ----------------------------------------------------

        duel = get_duel_db(duel_id)

        if not duel:

            logger.error(
                f"Duel {duel_id} not found "
                "after saving choice"
            )

            return

        # ----------------------------------------------------
        # ИГРОКИ
        # ----------------------------------------------------

        creator = get_user(
            duel["creator_id"]
        )

        opponent = get_user(
            duel["opponent_id"]
        )

        if not creator or not opponent:

            logger.error(
                f"Players not found for duel {duel_id}"
            )

            return

        c_name = (
            creator[1]
            or str(duel["creator_id"])
        )

        o_name = (
            opponent[1]
            or str(duel["opponent_id"])
        )

        # ====================================================
        # ТЕКСТ ВЫБОРА
        # ====================================================

        choice_text = (
            "🎯 <b>Выбор игроков</b>\n\n"
        )

        if duel.get("creator_choice"):

            choice_text += (
                f"✅ @{c_name} выбрал: "
                f"<b>{duel['creator_choice']}</b>\n"
            )

        else:

            choice_text += (
                f"⏳ @{c_name} еще не выбрал\n"
            )

        if duel.get("opponent_choice"):

            choice_text += (
                f"✅ @{o_name} выбрал: "
                f"<b>{duel['opponent_choice']}</b>\n"
            )

        else:

            choice_text += (
                f"⏳ @{o_name} еще не выбрал\n"
            )

        # ====================================================
        # ОБА ВЫБРАЛИ
        # ====================================================

        if (
            duel.get("creator_choice")
            and duel.get("opponent_choice")
        ):

            choice_text += (
                "\n🎯 <b>Оба игрока сделали выбор!</b>\n"
                "🎲 Результат определяется..."
            )

            # Убираем кнопки
            await safe_edit_message(
                bot,
                call.message.chat.id,
                call.message.message_id,
                choice_text
            )

            # ------------------------------------------------
            # ЗАЩИТА ОТ ДВОЙНОГО ЗАПУСКА
            # ------------------------------------------------

            if duel_id in resolving_evenodd_duels:
                return

            resolving_evenodd_duels.add(duel_id)

            try:

                await asyncio.sleep(1.5)

                await resolve_evenodd_duel(
                    bot,
                    call.message.chat.id,
                    duel_message_id,
                    duel_id
                )

            finally:

                resolving_evenodd_duels.discard(
                    duel_id
                )

        else:

            # ------------------------------------------------
            # ТОЛЬКО ОДИН ИГРОК ВЫБРАЛ
            # ------------------------------------------------

            await safe_edit_message(
                bot,
                call.message.chat.id,
                call.message.message_id,
                choice_text,
                reply_markup=evenodd_kb(
                    duel_id,
                    duel_message_id
                )
            )

        # ====================================================
        # ВАЖНО:
        #
        # СТАРОГО БЛОКА С message_id - 1 ЗДЕСЬ БОЛЬШЕ НЕТ.
        # ====================================================


    # ========================================================
    # ОТМЕНА ДУЭЛИ
    # ========================================================

    @dp.callback_query(
        F.data.startswith("duel_cancel_")
    )
    async def duel_cancel_id_cb(
        call: types.CallbackQuery
    ):

        try:

            duel_id = int(
                call.data.split("_")[2]
            )

        except (ValueError, IndexError):

            await call.answer(
                "❌ Некорректная дуэль",
                show_alert=True
            )
            return

        duel = get_duel_db(duel_id)

        if not duel:

            await call.answer(
                "❌ Дуэль не найдена",
                show_alert=True
            )
            return

        if (
            call.from_user.id != duel["creator_id"]
            and not is_admin(call.from_user.id)
        ):

            await call.answer(
                "❌ Только создатель может отменить",
                show_alert=True
            )
            return

        if duel["status"] != "pending":

            await call.answer(
                "❌ Дуэль уже началась",
                show_alert=True
            )
            return

        # ----------------------------------------------------
        # ВОЗВРАЩАЕМ СТАВКУ
        # ----------------------------------------------------

        update_user_balance_main(
            duel["creator_id"],
            duel["bet_amount"]
        )

        cancel_duel_db(
            duel_id
        )

        await safe_edit_message(
            bot,
            call.message.chat.id,
            call.message.message_id,
            (
                "❌ <b>Дуэль отменена</b>\n\n"
                f"Ставка "
                f"{format_amount(duel['bet_amount'])} "
                "возвращена создателю."
            )
        )

        await call.answer(
            "Дуэль отменена"
        )


# ============================================================
# ИГРОВЫЕ МЕХАНИКИ
# ============================================================

async def run_duel(
    bot,
    chat_id,
    duel_id,
    msg_id,
    c_name,
    o_name
):

    duel = get_duel_db(
        duel_id
    )

    if not duel:

        logger.error(
            f"run_duel: Duel {duel_id} not found"
        )

        return

    gtype = duel["game_type"]

    await safe_edit_message(
        bot,
        chat_id,
        msg_id,
        (
            "🔥 <b>Дуэль начинается!</b>\n\n"
            f"@{c_name} ⚔️ @{o_name}\n\n"
            "<i>3... 2... 1...</i>"
        )
    )

    await asyncio.sleep(2)

    if gtype == "dice":

        await run_dice(
            bot,
            chat_id,
            msg_id,
            duel,
            c_name,
            o_name
        )

    elif gtype == "basketball":

        await run_basketball(
            bot,
            chat_id,
            msg_id,
            duel,
            c_name,
            o_name
        )


# ============================================================
# DICE
# ============================================================

async def run_dice(
    bot,
    cid,
    mid,
    duel,
    c_name,
    o_name
):

    await safe_edit_message(
        bot,
        cid,
        mid,
        f"🎲 <b>@{c_name} бросает кубик...</b>"
    )

    d1 = await bot.send_dice(
        chat_id=cid,
        emoji="🎲"
    )

    await asyncio.sleep(3)

    v1 = d1.dice.value

    await safe_edit_message(
        bot,
        cid,
        mid,
        (
            f"🎲 <b>@{c_name}</b> "
            f"выбросил <b>{v1}</b>\n\n"
            f"🎲 <b>@{o_name} бросает кубик...</b>"
        )
    )

    d2 = await bot.send_dice(
        chat_id=cid,
        emoji="🎲"
    )

    await asyncio.sleep(3)

    v2 = d2.dice.value

    # --------------------------------------------------------
    # ПОБЕДИТЕЛЬ
    # --------------------------------------------------------

    if v1 > v2:

        wid = duel["creator_id"]
        wname = c_name

    elif v2 > v1:

        wid = duel["opponent_id"]
        wname = o_name

    else:

        await finish_draw(
            bot,
            cid,
            mid,
            duel,
            c_name,
            o_name,
            f"🎲 {v1} vs {v2} — Ничья!"
        )

        return

    await finish_duel(
        bot,
        cid,
        mid,
        duel,
        wid,
        wname,
        (
            f"🎲 <b>@{c_name}:</b> {v1}\n"
            f"🎲 <b>@{o_name}:</b> {v2}"
        )
    )


# ============================================================
# BASKETBALL
# ============================================================

async def run_basketball(
    bot,
    cid,
    mid,
    duel,
    c_name,
    o_name
):

    await safe_edit_message(
        bot,
        cid,
        mid,
        f"🏀 <b>@{c_name} бросает...</b>"
    )

    d1 = await bot.send_dice(
        chat_id=cid,
        emoji="🏀"
    )

    await asyncio.sleep(4)

    g1 = d1.dice.value in (4, 5)

    await safe_edit_message(
        bot,
        cid,
        mid,
        (
            f"🏀 <b>@{c_name}</b>: "
            f"{'🟢 Гол!' if g1 else '🔴 Мимо'}\n\n"
            f"🏀 <b>@{o_name} бросает...</b>"
        )
    )

    d2 = await bot.send_dice(
        chat_id=cid,
        emoji="🏀"
    )

    await asyncio.sleep(4)

    g2 = d2.dice.value in (4, 5)

    # --------------------------------------------------------
    # ПОБЕДИТЕЛЬ
    # --------------------------------------------------------

    if g1 and not g2:

        wid = duel["creator_id"]
        wname = c_name

    elif g2 and not g1:

        wid = duel["opponent_id"]
        wname = o_name

    else:

        await finish_draw(
            bot,
            cid,
            mid,
            duel,
            c_name,
            o_name,
            (
                f"🏀 Оба "
                f"{'забили' if g1 else 'промахнулись'} "
                "— Ничья!"
            )
        )

        return

    await finish_duel(
        bot,
        cid,
        mid,
        duel,
        wid,
        wname,
        (
            f"🏀 <b>@{c_name}:</b> "
            f"{'Гол' if g1 else 'Мимо'}\n"
            f"🏀 <b>@{o_name}:</b> "
            f"{'Гол' if g2 else 'Мимо'}"
        )
    )


# ============================================================
# РАЗРЕШЕНИЕ ЧЕТ / НЕЧЕТ
# ============================================================

async def resolve_evenodd_duel(
    bot,
    cid,
    mid,
    duel_id
):

    """
    Определяет результат игры Чет/Нечет.

    ВАЖНО:
    mid — это реальный message_id сообщения дуэли.

    Больше нигде не используется:
        message_id - 1
    """

    try:

        # ----------------------------------------------------
        # ПОЛУЧАЕМ ДУЭЛЬ
        # ----------------------------------------------------

        duel = get_duel_db(
            duel_id
        )

        if not duel:

            # НИЧЕГО НЕ РЕДАКТИРУЕМ.
            #
            # Именно здесь раньше появлялась:
            #
            # Duel 7797 not found
            # message can't be edited
            #
            logger.error(
                f"Duel {duel_id} not found "
                f"while resolving even/odd"
            )

            return

        # ----------------------------------------------------
        # ПРОВЕРКА СТАТУСА
        # ----------------------------------------------------

        if duel["status"] != "active":

            logger.warning(
                f"Duel {duel_id} is not active. "
                f"Status: {duel['status']}"
            )

            return

        # ----------------------------------------------------
        # ПОЛУЧАЕМ ВЫБОРЫ
        # ----------------------------------------------------

        creator_choice = duel.get(
            "creator_choice"
        )

        opponent_choice = duel.get(
            "opponent_choice"
        )

        # ----------------------------------------------------
        # ОБА ДОЛЖНЫ ВЫБРАТЬ
        # ----------------------------------------------------

        if (
            not creator_choice
            or not opponent_choice
        ):

            logger.warning(
                f"Duel {duel_id}: "
                "not both choices are present"
            )

            return

        # ----------------------------------------------------
        # ИГРОКИ
        # ----------------------------------------------------

        creator = get_user(
            duel["creator_id"]
        )

        opponent = get_user(
            duel["opponent_id"]
        )

        if not creator or not opponent:

            logger.error(
                f"Duel {duel_id}: "
                "players not found"
            )

            return

        c_name = (
            creator[1]
            or str(duel["creator_id"])
        )

        o_name = (
            opponent[1]
            or str(duel["opponent_id"])
        )

        # ----------------------------------------------------
        # БРОСОК КУБИКА
        # ----------------------------------------------------

        await safe_edit_message(
            bot,
            cid,
            mid,
            "🎯 <b>Бот бросает кубик...</b>"
        )

        dice_msg = await bot.send_dice(
            chat_id=cid,
            emoji="🎲"
        )

        await asyncio.sleep(3)

        result = dice_msg.dice.value

        is_even = (
            result % 2 == 0
        )

        result_text = (
            "Чет"
            if is_even
            else "Нечет"
        )

        # ----------------------------------------------------
        # ОПРЕДЕЛЯЕМ ПОБЕДИТЕЛЯ
        # ----------------------------------------------------

        if (
            creator_choice == result_text
            and opponent_choice != result_text
        ):

            wid = duel["creator_id"]
            wname = c_name

            win_text = (
                f"@{c_name} угадал!"
            )

        elif (
            opponent_choice == result_text
            and creator_choice != result_text
        ):

            wid = duel["opponent_id"]
            wname = o_name

            win_text = (
                f"@{o_name} угадал!"
            )

        elif (
            creator_choice == result_text
            and opponent_choice == result_text
        ):

            await finish_draw(
                bot,
                cid,
                mid,
                duel,
                c_name,
                o_name,
                (
                    f"🎯 Выпало: <b>{result}</b> "
                    f"({result_text})\n"
                    "Оба угадали — Ничья!"
                )
            )

            return

        else:

            await finish_draw(
                bot,
                cid,
                mid,
                duel,
                c_name,
                o_name,
                (
                    f"🎯 Выпало: <b>{result}</b> "
                    f"({result_text})\n"
                    "Никто не угадал — Ничья!"
                )
            )

            return

        # ----------------------------------------------------
        # ПОБЕДА
        # ----------------------------------------------------

        await finish_duel(
            bot,
            cid,
            mid,
            duel,
            wid,
            wname,
            (
                f"🎯 Выпало: <b>{result}</b> "
                f"({result_text})\n"
                f"{win_text}"
            )
        )

    except Exception as e:

        logger.error(
            f"Error in resolve_evenodd_duel: {e}",
            exc_info=True
        )

        # ВАЖНО:
        #
        # Ошибку больше не пытаемся обязательно
        # выводить через edit_message_text.
        #
        # Потому что именно это раньше создавало:
        #
        # TelegramBadRequest:
        # message can't be edited

        try:

            await safe_edit_message(
                bot,
                cid,
                mid,
                (
                    "❌ <b>Ошибка при "
                    "определении результата</b>"
                )
            )

        except Exception as edit_error:

            logger.error(
                f"Could not show error message "
                f"for duel {duel_id}: "
                f"{edit_error}"
            )


# ============================================================
# ФИНАЛЬНЫЕ РАСЧЁТЫ
# ============================================================

async def finish_duel(
    bot,
    cid,
    mid,
    duel,
    winner_id,
    winner_name,
    result_text
):

    # --------------------------------------------------------
    # ЗАЩИТА ОТ ПОВТОРНОЙ ВЫПЛАТЫ
    # --------------------------------------------------------

    current_duel = get_duel_db(
        duel["duel_id"]
    )

    if not current_duel:

        logger.error(
            f"finish_duel: Duel "
            f"{duel['duel_id']} not found"
        )

        return

    if current_duel["status"] != "active":

        logger.warning(
            f"finish_duel: Duel "
            f"{duel['duel_id']} already has "
            f"status {current_duel['status']}"
        )

        return

    # --------------------------------------------------------
    # РАСЧЁТ
    # --------------------------------------------------------

    bet = duel["bet_amount"]

    bank = bet * 2

    commission = (
        bank * DUEL_COMMISSION
    )

    prize = (
        bank - commission
    )

    # --------------------------------------------------------
    # ВЫПЛАТА
    # --------------------------------------------------------

    update_user_balance_main(
        winner_id,
        prize
    )

    # --------------------------------------------------------
    # СТАТИСТИКА
    # --------------------------------------------------------

    conn = sqlite3.connect(
        DB_PATH
    )

    try:

        c = conn.cursor()

        c.execute(
            """
            INSERT OR IGNORE INTO stats
            (key, value)
            VALUES ('duel_commission', 0)
            """
        )

        c.execute(
            """
            UPDATE stats
            SET value = value + ?
            WHERE key = 'duel_commission'
            """,
            (commission,)
        )

        conn.commit()

    finally:

        conn.close()

    # --------------------------------------------------------
    # ЗАВЕРШАЕМ ДУЭЛЬ В БД
    # --------------------------------------------------------

    finish_duel_db(
        duel["duel_id"],
        winner_id,
        result_text
    )

    # --------------------------------------------------------
    # ФИНАЛЬНОЕ СООБЩЕНИЕ
    # --------------------------------------------------------

    text = (
        "🏆 <b>ДУЭЛЬ ЗАВЕРШЕНА!</b>\n\n"
        f"{result_text}\n\n"
        f"⚔️ <b>Победитель:</b> "
        f"@{winner_name}\n"
        f"💰 <b>Приз:</b> "
        f"{format_amount(prize)}\n"
        f"📊 <b>Комиссия казино:</b> "
        f"{format_amount(commission)}\n\n"
        "<i>Напишите «дуэль», "
        "чтобы бросить новый вызов!</i>"
    )

    await safe_edit_message(
        bot,
        cid,
        mid,
        text
    )

    # --------------------------------------------------------
    # АДМИН-ЛОГ
    # --------------------------------------------------------

    try:

        from main import notify_admin

        await notify_admin(
            "⚔️ <b>Дуэль завершена</b>\n\n"
            f"<blockquote>"
            f"├ Победитель: @{winner_name} "
            f"(ID: {winner_id})\n"
            f"├ Приз: {format_amount(prize)}\n"
            f"├ Комиссия: "
            f"{format_amount(commission)}\n"
            f"└ Игра: "
            f"{DUEL_GAMES[duel['game_type']]['name']}"
            f"</blockquote>"
        )

    except Exception as e:

        logger.warning(
            f"Admin notify failed: {e}"
        )


# ============================================================
# НИЧЬЯ
# ============================================================

async def finish_draw(
    bot,
    cid,
    mid,
    duel,
    c_name,
    o_name,
    reason
):

    # --------------------------------------------------------
    # ПРОВЕРКА, ЧТО ДУЭЛЬ ЕЩЁ АКТИВНА
    # --------------------------------------------------------

    current_duel = get_duel_db(
        duel["duel_id"]
    )

    if not current_duel:

        logger.error(
            f"finish_draw: Duel "
            f"{duel['duel_id']} not found"
        )

        return

    if current_duel["status"] != "active":

        logger.warning(
            f"finish_draw: Duel "
            f"{duel['duel_id']} already finished"
        )

        return

    # --------------------------------------------------------
    # ВОЗВРАТ СТАВОК
    # --------------------------------------------------------

    bet = duel["bet_amount"]

    update_user_balance_main(
        duel["creator_id"],
        bet
    )

    update_user_balance_main(
        duel["opponent_id"],
        bet
    )

    # --------------------------------------------------------
    # ПОМЕЧАЕМ ДУЭЛЬ ЗАВЕРШЁННОЙ
    #
    # Здесь оставляем cancel_duel_db,
    # потому что это существующая функция
    # твоего database.py.
    # --------------------------------------------------------

    cancel_duel_db(
        duel["duel_id"]
    )

    # --------------------------------------------------------
    # СООБЩЕНИЕ
    # --------------------------------------------------------

    text = (
        "🤝 <b>НИЧЬЯ!</b>\n\n"
        f"{reason}\n\n"
        "💰 <b>Ставки возвращены:</b>\n"
        f"├ @{c_name}: "
        f"{format_amount(bet)}\n"
        f"└ @{o_name}: "
        f"{format_amount(bet)}"
    )

    await safe_edit_message(
        bot,
        cid,
        mid,
        text
    )
