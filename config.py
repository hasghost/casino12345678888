TELEGRAM_BOT_TOKEN = "7368962343:AAGWmcvczpA_LJ_Qb8whxsGYpzOfPc4gWJs" #7368962343:AAGWmcvczpA_LJ_Qb8whxsGYpzOfPc4gWJs     8076671057:AAFSrC1hlsEq_vp4JY99D5DBqZ__TDQEk60
CRYPTO_BOT_TOKEN = "369197:AAC06ytgeDacntgpQNfOs3b7LomyOknLG3N"      

# 🎟 Розыгрыши NFT
MIN_RAFFLE_DURATION_MINUTES = 1         # минимальная длительность в минутах
MAX_RAFFLE_DURATION_MINUTES = 1440      # максимальная (1 день = 1440 минут)
RAFFLE_RESULTS_CHANNEL_ID = -1002409260613  # канал для публикации итогов (можно использовать тот же LOGS_CHANNEL_ID или создать отдельный)

# 💬 Активность в чате
CHAT_ACTIVITY_BONUS = 0.01                    # Бонус за каждые 10 сообщений в USDT
CHAT_ACTIVITY_THRESHOLD = 10                  # Количество сообщений для получения бонуса
CHAT_ACTIVITY_COOLDOWN = 5                    # Минимальное время между сообщениями (секунды) для защиты от спама

# Путь к базе данных
DB_PATH = "casino.db"

ADMIN_IDS = [7505000952]
ADMIN_USERNAME = "@winer404"      # юзернейм без собачки? можно и с ней, для ссылки
ADMIN_TELEGRAM_ID = 7505000952           # ID администратора (для ссылки tg://user?id=)

# 💰 Финансовые настройки
USDT_RUB_RATE = 90                                   # Курс USDT в рублях
MIN_BET = 0.01                                        # Минимальная ставка в USDT
MAX_BET = 100.0                                     # Максимальная ставка в USDT
MIN_DEPOSIT = 0.05                                    # Минимальный депозит в USDT
MIN_DEPOSIT_RUB = 100                                 # Минимальный депозит в рублях
MIN_WITHDRAW = 0.2                                   # Минимальный вывод
STARS_TO_USDT_RATE = 0.009                            # 1 Star = 0.009 USDT (10 Stars ≈ 0.09 USDT)
MIN_STARS_DEPOSIT = 10                              # Минимальное количество Stars
MIN_GAMES_FOR_WITHDRAW = 2

# 🎲 Стикеры для игр (замените на реальные ID из вашего пака)
STICKER_ROCK = "CAACAgIAAxkBAAEQLKJpW7GVbuvY2oZbkbMOi7QnGYM8FAACqoAAArMwiErGS5uhtwd-njgE"                 # Камень
STICKER_PAPER = "CAACAgIAAxkBAAEQLKdpW7GeHc65-vwCM2DdXBAfUiN1qwAChG0AAnetkUoDXVadbY08pTgE"                # Бумага
STICKER_SCISSORS = "CAACAgIAAxkBAAEQLKZpW7GeOXGK4jI_X-DaERdQu3T5RwACvHAAAvCbiEo5IWe3iP0i3DgE"             # Ножницы
STICKER_COIN_HEADS = "CAACAgIAAxkBAAEQLFtpW6kNqIX0UdyamhA1FGOr69EStgACqGcAAgZAiErDI93lpS9TizgE"          # Монетка орел
STICKER_COIN_TAILS = "CAACAgIAAxkBAAEQLF1pW6k0rqO51PDCrAGy7UXBsMnnzQACcHUAAhQDiUpMrXMX-NLPJTgE"           # Монетка решка
STICKER_BLUE_HEART = "CAACAgEAAxkBAAEQSU1pb9R4HfZJev-JwXHQIAXiHUsIyAACAgMAAlQmGESY5Nu6voFz0TgE"  # Синее сердце
STICKER_RED_HEART = "CAACAgEAAxkBAAEQSVBpb9SIYnPJUZUoL1itm4gHDjVGSwACyQcAAuN4BAABhEkOibFTmls4BA"   # Красное сердце

# 🔗 Ссылки
CARD_DEPOSIT_URL = "https://t.me/winer404"

# 🌐 API
BINANCE_API_URL = "https://api.binance.com/api/v3/ticker/price?symbol=USDTUSD"

BOT_USERNAME = "SPIND_BET_BOT"
PROJECT_NAME = "SpindBet"

# 🎨 Эмодзи для статусов
EMOJI_WIN = "🎉"
EMOJI_LOSE = "😔"
EMOJI_INFO = "💡"
EMOJI_WARNING = "⚠️"

# Дуэли
DUEL_COMMISSION = 0.10   # 10% комиссия казино
MIN_DUEL_BET = 0.05
MAX_DUEL_BET = 500.0

# Уведомления
ADMIN_GROUP_ID = -1002491370510  # группа админов (чат)
LOGS_CHANNEL_ID = -1003414639951 # Канал для логов 

# Канал новостей (основной публичный канал)
NEWS_CHANNEL_ID = -1002409260613  # ID канала новостей
NEWS_CHANNEL_USERNAME = "+-KpLp8Bvny43YzYy"      # Username без @

# Чат/группа (для комьюнити)
CHAT_ID = -1002491370510          # ID чата
CHAT_USERNAME = "+uNALN45BYs9hNmYy"   # Username чата без @

SUPPORT_URL = "https://t.me/winer404"  # Ссылка на поддержку
MIRROR_URL = "https://t.me/spindcas"  # Ссылка на переходник/зеркало
REZERV_URL = "https://spindbetlink.vercel.app/" 

#рассылка
BROADCAST_COOLDOWN = 0.3  # Задержка между сообщениями (секунды)
MAX_BROADCAST_BUTTONS = 10  # Максимум кнопок в рассылке

# Ежедневный бонус
DAILY_BONUS_AMOUNT = 0.01  # Сумма бонуса
DAILY_BONUS_COOLDOWN = 86400  # 24 часа в секундах

# 🎲 Настройки игр
DICE_EVEN_ODD_MULTIPLIER = 1.8
DICE_EXACT_MULTIPLIER = 5.8
DICE_HI_LO_MULTIPLIER = 1.9
MINES_MINES_COUNT = 10 
MINES_FIELD_SIZE = 25  # 5x5
BOXES_MULTIPLIER = 2.0  # сундучки
RPS_MULTIPLIER = 2.0    # КНБ
COINFLIP_MULTIPLIER = 1.9  # монетка
HEARTS_MULTIPLIER = 1.8 # сердца
BASKETBALL_MULTIPLIER = 1.8
ROULETTE_MULTIPLIER = 12.0  # рулетка


RUSSIAN_ROULETTE_MULTIPLIERS = {  # русская рулетка коэффициенты
    1: 1.14,
    2: 1.4,
    3: 1.9,
    4: 2.8,
    5: 5.7
}

CASE_PRICE_STARS = 10

CASE_ITEMS = [
    {
        "id": "empty",
        "name": "❌ Пусто",
        "chance": 97.9,
        "gift_id": None,
        "value_stars": 0,
        "emoji": "❌"
    },
    {
        "id": "heart",
        "name": "❤️ Сердце",
        "chance": 1.0,
        "gift_id": "5170145012310081615",
        "value_stars": 15,
        "emoji": "❤️"
    },
    {
        "id": "bear",
        "name": "🧸 Мишка",
        "chance": 1.0,
        "gift_id": "5170233102089322756",
        "value_stars": 15,
        "emoji": "🧸"
    },
    {
        "id": "ring",
        "name": "💍 Кольцо",
        "chance": 0.1,
        "gift_id": "5170690322832818290",
        "value_stars": 100,
        "emoji": "💍"
    }
]

GIFTS = {
    "5170145012310081615": "❤️ Сердце",
    "5170233102089322756": "🧸 Мишка", 
    "5170690322832818290": "💍 Кольцо",
}

STICKERS_PATH = "stickers" # Путь к папке со стикерами
VIDEO_PATH = "video"  # Папка с видео файлами

PYTHON_RANDOM_URL = "https://docs.python.org/3/library/random.html#random.choice"

# 🌈 
RAINBOW_MULTIPLIER = 2.0           # кэф
RAINBOW_WIN_CHANCE = 0.46          # 46% реальный шанс
RAINBOW_DISPLAY_CHANCE = "1/2"     # то, что увидит игрок
STICKER_RAINBOW = "CAACAgQAAxkBAAEdyGFp9xVK62isRk_2VDG-NTIfyGNI0gACexwAAqHx2VEgGh7ndR6q9zsE"  # замените на реальный ID стикера

GAMES_MULTIPLIER = {
    "x3": {"multiplier": 3.0, "win_chance": 0.305, "display": "1/3", "sticker": "STICKER_X3"},
    "x5": {"multiplier": 5.0, "win_chance": 0.185, "display": "1/5", "sticker": "STICKER_X5"},
    "x10": {"multiplier": 10.0, "win_chance": 0.092, "display": "1/10", "sticker": "STICKER_X10"},
    "x20": {"multiplier": 20.0, "win_chance": 0.046, "display": "1/20", "sticker": "STICKER_X20"},
    "x30": {"multiplier": 30.0, "win_chance": 0.031, "display": "1/30", "sticker": "STICKER_X30"},
    "x50": {"multiplier": 50.0, "win_chance": 0.0185, "display": "1/50", "sticker": "STICKER_X50"},
    "x100": {"multiplier": 100.0, "win_chance": 0.0092, "display": "1/100", "sticker": "STICKER_X100"}
}

# Стикеры для этих игр (замените на реальные ID)
STICKER_X3 = "CAACAgIAAxkBAAEdyIRp9xo2BzrXzsoswfZTjCqXk8CDFwACDJYAAnRLWUtUeqdZx1J9nTsE"  # 🔥 X3
STICKER_X5 = "CAACAgIAAxkBAAEdyIpp9xpkG4b89y1Svj6AmyRRbKJCkAACyogAAlgkYEvHKbrm232_iDsE"  # 🎈 X5
STICKER_X10 = "CAACAgIAAxkBAAEdyI5p9xppoSzLaIuJ-yLDVXfW39Jb8QAC4ZkAAtzMYUug_vp4GXtnDzsE" # 🥚 X10
STICKER_X20 = "CAACAgIAAxkBAAEdyJBp9xpqL3faBxZFnVjGuCsM9RC_hgACIKEAAtoNYUslHcXlJE1IXTsE" # 🎰 X20
STICKER_X30 = "CAACAgIAAxkBAAEdyJpp9xqlJAABPci2_ckoNbc08BjkizEAAkqTAALsXghKelyMcYAIvYw7BA" # 🐸 X30
STICKER_X50 = "CAACAgIAAxkBAAEdyJxp9xq2sWyQc_Db4s-z8W4bfCpYWAAC5JEAArbzGEixvW-9F5vyjTsE" # 🌵 X50
STICKER_X100 = "CAACAgIAAxkBAAEdyJ5p9xrLBN_fMHdNw3Gt5b0q68ucnwACb5MAAlWoaEvCrXfvT6WfYzsE" # 🐳 X100

def format_amount(amount_usd):
    """Форматировать сумму в долларах с отображением в рублях"""
    if amount_usd is None:
        amount_usd = 0
    rub_amount = amount_usd * USDT_RUB_RATE
    return f"${amount_usd:,.2f} [~{rub_amount:,.0f}rub]"
