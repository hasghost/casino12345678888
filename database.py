import sqlite3
import time
import random
from datetime import datetime
from config import ADMIN_IDS, DAILY_BONUS_AMOUNT, DB_PATH, CHAT_ACTIVITY_BONUS, CHAT_ACTIVITY_THRESHOLD
import logging

def init_db():
    """Инициализация базы данных"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    # Таблица пользователей (с игровой статистикой)
    c.execute('''
        CREATE TABLE IF NOT EXISTS users (
            user_id INTEGER PRIMARY KEY,
            username TEXT,
            balance REAL DEFAULT 0,
            registration_date TEXT,
            referral_balance REAL DEFAULT 0,
            referrer_id INTEGER,
            referral_count INTEGER DEFAULT 0,
            is_admin INTEGER DEFAULT 0,
            is_banned INTEGER DEFAULT 0,
            total_games INTEGER DEFAULT 0,
            total_wins INTEGER DEFAULT 0,
            total_bets_amount REAL DEFAULT 0
        )
    ''')
    
    # Таблица открытий кейсов
    c.execute('''
        CREATE TABLE IF NOT EXISTS case_openings (
            opening_id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            item_id TEXT,
            item_name TEXT,
            stars_spent INTEGER DEFAULT 25,
            stars_won INTEGER DEFAULT 0,
            gift_id TEXT,
            status TEXT DEFAULT 'completed',
            opened_at INTEGER
        )
    ''')
    
    c.execute('''
        CREATE TABLE IF NOT EXISTS provably_fair_rounds (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            game_name TEXT,
            bet_amount REAL,
            result TEXT,
            server_seed_hash TEXT,
            server_seed TEXT,
            client_seed TEXT,
            nonce INTEGER,
            timestamp INTEGER,
            status TEXT  -- 'pending' or 'revealed'
        )
    ''')
    # Таблица депозитов
    c.execute('''
        CREATE TABLE IF NOT EXISTS deposits (
            deposit_id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            amount_usd REAL,
            amount_crypto REAL,
            currency TEXT,
            invoice_id TEXT,
            order_id TEXT,
            guid TEXT,
            payment_system TEXT DEFAULT 'cryptobot',
            status TEXT,
            timestamp INTEGER
        )
    ''')
    
    # Добавляем guid если его нет
    try:
        c.execute("ALTER TABLE deposits ADD COLUMN guid TEXT")
        conn.commit()
        logging.info("Added guid column to deposits table")
    except sqlite3.OperationalError:
        pass
    
    try:
        c.execute("ALTER TABLE users ADD COLUMN provably_fair_nonce INTEGER DEFAULT 0")
        conn.commit()
        logging.info("Added provably_fair_nonce column")
    except sqlite3.OperationalError:
        pass
    
    # Добавляем payment_system если его нет
    try:
        c.execute("ALTER TABLE deposits ADD COLUMN payment_system TEXT DEFAULT 'cryptobot'")
        conn.commit()
        logging.info("Added payment_system column to deposits table")
    except sqlite3.OperationalError:
        pass
    
    # Таблица выводов
    c.execute('''
        CREATE TABLE IF NOT EXISTS withdrawals (
            withdrawal_id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            amount REAL,
            asset TEXT,
            transfer_id TEXT,
            status TEXT,
            timestamp INTEGER
        )
    ''')
    
    # Таблица промокодов
    c.execute('''
        CREATE TABLE IF NOT EXISTS promocodes (
            code TEXT PRIMARY KEY,
            amount REAL,
            uses INTEGER DEFAULT 0,
            max_uses INTEGER
        )
    ''')
    
    # Таблица использованных промокодов пользователями
    c.execute('''
        CREATE TABLE IF NOT EXISTS user_promocodes (
            user_id INTEGER,
            code TEXT,
            used_at INTEGER,
            PRIMARY KEY (user_id, code)
        )
    ''')
    
    # Таблица ежедневных бонусов
    c.execute('''
        CREATE TABLE IF NOT EXISTS daily_bonus (
            user_id INTEGER PRIMARY KEY,
            last_claim INTEGER DEFAULT 0
        )
    ''')
    
    # Глобальная статистика
    c.execute('''
        CREATE TABLE IF NOT EXISTS stats (
            key TEXT PRIMARY KEY,
            value REAL
        )
    ''')
    
    # Таблица активных игр Mines
    c.execute('''
        CREATE TABLE IF NOT EXISTS mines_games (
            user_id INTEGER PRIMARY KEY,
            field TEXT,
            mines TEXT,
            opened TEXT,
            bet_amount REAL,
            current_multiplier REAL,
            active INTEGER DEFAULT 1,
            timestamp INTEGER
        )
    ''')
    
    # Таблица розыгрышей
    c.execute('''
        CREATE TABLE IF NOT EXISTS raffles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            creator_admin_id INTEGER,
            start_time INTEGER,
            end_time INTEGER,
            duration_minutes INTEGER,
            nft_link TEXT,
            status TEXT DEFAULT 'active',
            winner_user_id INTEGER,
            created_at INTEGER
        )
    ''')

        # Таблица дуэлей
    c.execute('''
        CREATE TABLE IF NOT EXISTS duels (
            duel_id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id INTEGER,
            message_id INTEGER,
            creator_id INTEGER,
            opponent_id INTEGER,
            game_type TEXT,
            bet_amount REAL,
            creator_choice TEXT,
            opponent_choice TEXT,
            status TEXT DEFAULT 'pending',
            winner_id INTEGER,
            result_data TEXT,
            created_at INTEGER,
            finished_at INTEGER
        )
    ''')
    
    # Участники розыгрышей
    c.execute('''
        CREATE TABLE IF NOT EXISTS raffle_participants (
            raffle_id INTEGER,
            user_id INTEGER,
            bets_count INTEGER DEFAULT 1,
            PRIMARY KEY (raffle_id, user_id)
        )
    ''')
    
    # ===== НОВЫЕ КОЛОНКИ ДЛЯ ПАРТНЁРОВ =====
    try:
        c.execute("ALTER TABLE users ADD COLUMN is_partner INTEGER DEFAULT 0")
        conn.commit()
        logging.info("Added is_partner column")
    except sqlite3.OperationalError:
        pass

    try:
        c.execute("ALTER TABLE users ADD COLUMN partner_frozen INTEGER DEFAULT 0")
        conn.commit()
        logging.info("Added partner_frozen column")
    except sqlite3.OperationalError:
        pass

    try:
        c.execute("ALTER TABLE users ADD COLUMN partner_freeze_reason TEXT")
        conn.commit()
        logging.info("Added partner_freeze_reason column")
    except sqlite3.OperationalError:
        pass

    # ===== КОНЕЦ НОВЫХ КОЛОНОК =====

    # Инициализация статистики
    stats_defaults = [
        ('total_deposits', 0),
        ('total_withdrawals', 0),
        ('total_referral_payouts', 0),
        ('total_paid_out', 0),
        ('total_players', 0)
    ]
    
    for key, value in stats_defaults:
        c.execute("INSERT OR IGNORE INTO stats (key, value) VALUES (?, ?)", (key, value))
    
    # Добавить админов
    for admin_id in ADMIN_IDS:
        c.execute("INSERT OR IGNORE INTO users (user_id, username, registration_date, is_admin, is_banned) VALUES (?, ?, ?, 1, 0)", 
                 (admin_id, "Admin", datetime.now().strftime("%d.%m.%Y")))
        c.execute("UPDATE users SET is_admin = 1 WHERE user_id = ?", (admin_id,))

    # ===== КОЛОНКА: отключение чат-активности =====
    try:
        c.execute("ALTER TABLE users ADD COLUMN chat_activity_disabled INTEGER DEFAULT 0")
        conn.commit()
        logging.info("Added chat_activity_disabled column")
    except sqlite3.OperationalError:
        pass
    
    # ========== ДОБАВЛЕНИЕ reg_timestamp ==========
    try:
        c.execute("ALTER TABLE users ADD COLUMN reg_timestamp INTEGER")
        conn.commit()
        logging.info("Added reg_timestamp column to users table")
    except sqlite3.OperationalError:
        pass
    
    # Конвертируем старые registration_date (формат dd.mm.yyyy) в timestamp
    c.execute("SELECT user_id, registration_date FROM users WHERE reg_timestamp IS NULL")
    rows = c.fetchall()
    for user_id, date_str in rows:
        try:
            dt = datetime.strptime(date_str, "%d.%m.%Y")
            ts = int(dt.timestamp())
            c.execute("UPDATE users SET reg_timestamp = ? WHERE user_id = ?", (ts, user_id))
        except Exception:
            # Если не удалось распарсить, ставим текущее время
            c.execute("UPDATE users SET reg_timestamp = ? WHERE user_id = ?", (int(time.time()), user_id))
    conn.commit()
    init_activity_table()
    conn.close()

def get_user(user_id, username=None):
    """Получить/создать пользователя"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    c.execute("SELECT * FROM users WHERE user_id = ?", (user_id,))
    user = c.fetchone()
    
    if not user:
        reg_date = datetime.now().strftime("%d.%m.%Y")
        reg_timestamp = int(time.time())
        c.execute('''
            INSERT INTO users (user_id, username, registration_date, reg_timestamp)
            VALUES (?, ?, ?, ?)
        ''', (user_id, username, reg_date, reg_timestamp))
        conn.commit()
        
        c.execute("UPDATE stats SET value = value + 1 WHERE key = 'total_players'")
        conn.commit()
        
        c.execute("SELECT * FROM users WHERE user_id = ?", (user_id,))
        user = c.fetchone()
    elif user:
        c.execute("""
            UPDATE users SET 
                balance = COALESCE(balance, 0),
                referral_balance = COALESCE(referral_balance, 0),
                referral_count = COALESCE(referral_count, 0),
                is_banned = COALESCE(is_banned, 0),
                total_games = COALESCE(total_games, 0),
                total_wins = COALESCE(total_wins, 0),
                total_bets_amount = COALESCE(total_bets_amount, 0)
            WHERE user_id = ?
        """, (user_id,))
        conn.commit()
        
        c.execute("SELECT * FROM users WHERE user_id = ?", (user_id,))
        user = c.fetchone()
    
    conn.close()
    
    if user:
        user = list(user)
        numeric_defaults = {
            2: 0.0,   # balance
            4: 0.0,   # referral_balance
            6: 0,     # referral_count
            7: 0,     # is_admin
            8: 0,     # is_banned
            9: 0,     # total_games
            10: 0,    # total_wins
            11: 0.0,  # total_bets_amount
            12: 0,    # reg_timestamp
            13: 0,    # is_partner
            14: 0,    # partner_frozen
            15: "",   # partner_freeze_reason
            16: 0,    # chat_activity_disabled
        }
        
        for index, default_value in numeric_defaults.items():
            if len(user) > index and user[index] is None:
                user[index] = default_value
        
        user = tuple(user)
    
    return user

def update_user_balance(user_id, amount):
    """Обновить баланс пользователя (общий)"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("UPDATE users SET balance = balance + ? WHERE user_id = ?", (amount, user_id))
    conn.commit()
    conn.close()

def update_user_balance_main(user_id, amount):
    """Обновить ТОЛЬКО основной баланс"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("UPDATE users SET balance = balance + ? WHERE user_id = ?", (amount, user_id))
    conn.commit()
    conn.close()

def update_user_balance_ref(user_id, amount):
    """Обновить ТОЛЬКО реферальный баланс"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("UPDATE users SET referral_balance = referral_balance + ? WHERE user_id = ?", (amount, user_id))
    conn.commit()
    conn.close()

def get_user_balances(user_id):
    """Получить оба баланса отдельно"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT balance, referral_balance FROM users WHERE user_id = ?", (user_id,))
    result = c.fetchone()
    conn.close()
    return result if result else (0.0, 0.0)

def update_user_game_stats(user_id, amount, win=False):
    """Обновить игровую статистику пользователя"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("UPDATE users SET total_games = total_games + 1, total_bets_amount = total_bets_amount + ? WHERE user_id = ?", 
             (amount, user_id))
    if win:
        c.execute("UPDATE users SET total_wins = total_wins + 1 WHERE user_id = ?", (user_id,))
    conn.commit()
    conn.close()

def get_global_stats():
    """Получить глобальную статистику"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    stats = {}
    c.execute("SELECT key, value FROM stats")
    for row in c.fetchall():
        stats[row[0]] = row[1]
    
    conn.close()
    return stats

def get_total_players():
    """Получить общее количество игроков"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM users")
    count = c.fetchone()[0]
    conn.close()
    return count

def get_user_referrals(user_id):
    """Получить количество рефералов"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM users WHERE referrer_id = ?", (user_id,))
    count = c.fetchone()[0]
    conn.close()
    return count

def save_deposit(user_id, amount_usd, amount_crypto, currency, invoice_id=None, order_id=None, guid=None, payment_system='cryptobot'):
    """Сохранить депозит"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''
        INSERT INTO deposits (user_id, amount_usd, amount_crypto, currency, invoice_id, order_id, guid, payment_system, status, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (user_id, amount_usd, amount_crypto, currency, invoice_id, order_id, guid, payment_system, 'pending', int(time.time())))
    conn.commit()
    conn.close()

def confirm_deposit(invoice_id=None, order_id=None, guid=None):
    """
    Подтвердить депозит атомарно
    Возвращает (user_id, amount_usd) если успешно подтвержден
    Возвращает (None, None) если уже подтвержден или не найден
    """
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    try:
        conn.execute("BEGIN IMMEDIATE")
        
        if invoice_id:
            c.execute("""
                SELECT user_id, amount_usd 
                FROM deposits 
                WHERE invoice_id = ? AND status = 'pending'
            """, (invoice_id,))
        elif order_id:
            c.execute("""
                SELECT user_id, amount_usd 
                FROM deposits 
                WHERE order_id = ? AND status = 'pending'
            """, (order_id,))
        elif guid:
            c.execute("""
                SELECT user_id, amount_usd 
                FROM deposits 
                WHERE guid = ? AND status = 'pending'
            """, (guid,))
        
        result = c.fetchone()
        
        if not result:
            conn.rollback()
            return None, None
        
        user_id, amount = result
        
        if invoice_id:
            c.execute("UPDATE deposits SET status = 'confirmed' WHERE invoice_id = ? AND status = 'pending'", (invoice_id,))
        elif order_id:
            c.execute("UPDATE deposits SET status = 'confirmed' WHERE order_id = ? AND status = 'pending'", (order_id,))
        elif guid:
            c.execute("UPDATE deposits SET status = 'confirmed' WHERE guid = ? AND status = 'pending'", (guid,))
        
        if c.rowcount == 0:
            conn.rollback()
            return None, None
        
        c.execute("UPDATE stats SET value = value + ? WHERE key = 'total_deposits'", (amount,))
        
        conn.commit()
        return user_id, amount
        
    except Exception as e:
        conn.rollback()
        logging.error(f"Error in confirm_deposit: {e}")
        return None, None
    finally:
        conn.close()

def save_withdrawal(user_id, amount, asset, transfer_id):
    """Сохранить вывод"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''
        INSERT INTO withdrawals (user_id, amount, asset, transfer_id, status, timestamp)
        VALUES (?, ?, ?, ?, ?, ?)
    ''', (user_id, amount, asset, transfer_id, 'completed', int(time.time())))
    
    c.execute("UPDATE stats SET value = value + ? WHERE key = 'total_withdrawals'", (amount,))
    c.execute("UPDATE stats SET value = value + ? WHERE key = 'total_paid_out'", (amount,))
    conn.commit()
    conn.close()

def create_promocode(code, amount, max_uses):
    """Создать промокод"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    try:
        c.execute('''
            INSERT INTO promocodes (code, amount, max_uses)
            VALUES (?, ?, ?)
        ''', (code.upper(), amount, max_uses))
        conn.commit()
        success = True
    except sqlite3.IntegrityError:
        success = False
    conn.close()
    return success

def get_promocode(code):
    """Получить промокод"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT amount, uses, max_uses FROM promocodes WHERE code = ?", (code.upper(),))
    promo = c.fetchone()
    conn.close()
    return promo

def is_promocode_used(user_id, code):
    """Проверить использовал ли пользователь промокод"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT 1 FROM user_promocodes WHERE user_id = ? AND code = ?", (user_id, code.upper()))
    result = c.fetchone()
    conn.close()
    return result is not None

def use_promocode(user_id, code):
    """Отметить промокод как использованный пользователем"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("INSERT INTO user_promocodes (user_id, code, used_at) VALUES (?, ?, ?)", 
             (user_id, code.upper(), int(time.time())))
    conn.commit()
    conn.close()

def is_admin(user_id):
    """Проверить является ли пользователь админом"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT is_admin FROM users WHERE user_id = ?", (user_id,))
    result = c.fetchone()
    conn.close()
    return result and result[0] == 1

def is_user_banned(user_id):
    """Проверить забанен ли пользователь"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT is_banned FROM users WHERE user_id = ?", (user_id,))
    result = c.fetchone()
    conn.close()
    return result and result[0] == 1

def ban_user(user_id):
    """Забанить пользователя"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("UPDATE users SET is_banned = 1 WHERE user_id = ?", (user_id,))
    conn.commit()
    conn.close()

def unban_user(user_id):
    """Разбанить пользователя"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("UPDATE users SET is_banned = 0 WHERE user_id = ?", (user_id,))
    conn.commit()
    conn.close()

def get_daily_bonus_status(user_id):
    """Проверить статус ежедневного бонуса"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT last_claim FROM daily_bonus WHERE user_id = ?", (user_id,))
    result = c.fetchone()
    conn.close()
    
    if not result:
        return True, 0
    
    last_claim = result[0]
    now = int(time.time())
    time_left = 86400 - (now - last_claim)
    
    if time_left > 0:
        hours = time_left // 3600
        minutes = (time_left % 3600) // 60
        return False, f"{hours}ч {minutes}м"
    
    return True, 0

def claim_daily_bonus(user_id):
    """Получить ежедневный бонус"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    now = int(time.time())
    if random.random() < 0.5:
        bonus = DAILY_BONUS_AMOUNT
        update_user_balance(user_id, bonus)
        c.execute("INSERT OR REPLACE INTO daily_bonus (user_id, last_claim) VALUES (?, ?)", (user_id, now))
        conn.commit()
        conn.close()
        return True, bonus
    else:
        c.execute("INSERT OR REPLACE INTO daily_bonus (user_id, last_claim) VALUES (?, ?)", (user_id, now))
        conn.commit()
        conn.close()
        return False, 0

# Mines game functions
def save_mines_game(user_id, field, mines, opened, bet_amount, multiplier, round_id=None):
    """Сохранить активную игру Mines, включая round_id для provably fair"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''
        INSERT OR REPLACE INTO mines_games 
        (user_id, field, mines, opened, bet_amount, current_multiplier, timestamp, round_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ''', (user_id, str(field), str(mines), str(opened), bet_amount, multiplier, int(time.time()), round_id))
    conn.commit()
    conn.close()

def get_mines_game(user_id):
    """Получить активную игру Mines, включая round_id"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT field, mines, opened, bet_amount, current_multiplier, round_id FROM mines_games WHERE user_id = ? AND active = 1", (user_id,))
    game = c.fetchone()
    conn.close()
    return game

def update_mines_game(user_id, opened, multiplier):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("UPDATE mines_games SET opened = ?, current_multiplier = ? WHERE user_id = ? AND active = 1", 
             (str(opened), multiplier, user_id))
    conn.commit()
    conn.close()

def end_mines_game(user_id, win=False):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("UPDATE mines_games SET active = 0 WHERE user_id = ?", (user_id,))
    conn.commit()
    conn.close()

def save_case_opening(user_id, item_id, item_name, stars_spent=25, stars_won=0, gift_id=None):
    """Сохранить открытие кейса"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''
        INSERT INTO case_openings (user_id, item_id, item_name, stars_spent, stars_won, gift_id, opened_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    ''', (user_id, item_id, item_name, stars_spent, stars_won, gift_id, int(time.time())))
    conn.commit()
    conn.close()

def get_user_case_stats(user_id):
    """Получить статистику открытий пользователя"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''
        SELECT 
            COUNT(*) as total_opened,
            SUM(CASE WHEN item_id != 'empty' THEN 1 ELSE 0 END) as wins,
            SUM(stars_spent) as total_spent,
            SUM(stars_won) as total_won
        FROM case_openings 
        WHERE user_id = ?
    ''', (user_id,))
    result = c.fetchone()
    conn.close()
    return {
        'total_opened': result[0] or 0,
        'wins': result[1] or 0,
        'total_spent': result[2] or 0,
        'total_won': result[3] or 0
    }

# ========== Розыгрыши NFT ==========

def create_raffle(admin_id, duration_minutes, nft_link):
    """Создать розыгрыш, если нет активного. Возвращает True/False."""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    # Проверяем, нет ли уже активного
    c.execute("SELECT id FROM raffles WHERE status = 'active' LIMIT 1")
    if c.fetchone():
        conn.close()
        return False
    
    now = int(time.time())
    end_time = now + duration_minutes * 60
    c.execute('''
        INSERT INTO raffles (creator_admin_id, start_time, end_time, duration_minutes, nft_link, status, created_at)
        VALUES (?, ?, ?, ?, ?, 'active', ?)
    ''', (admin_id, now, end_time, duration_minutes, nft_link, now))
    conn.commit()
    conn.close()
    return True

def get_active_raffle():
    """Возвращает словарь с данными активного розыгрыша или None."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT * FROM raffles WHERE status = 'active' LIMIT 1")
    row = c.fetchone()
    conn.close()
    return dict(row) if row else None

def add_raffle_bet(user_id):
    """Увеличить счётчик ставок пользователя в активном розыгрыше."""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT id FROM raffles WHERE status = 'active' LIMIT 1")
    raffle = c.fetchone()
    if not raffle:
        conn.close()
        return
    raffle_id = raffle[0]
    c.execute('''
        INSERT INTO raffle_participants (raffle_id, user_id, bets_count)
        VALUES (?, ?, 1)
        ON CONFLICT(raffle_id, user_id) DO UPDATE SET bets_count = bets_count + 1
    ''', (raffle_id, user_id))
    conn.commit()
    conn.close()

def finish_raffle(raffle_id):
    """
    Завершить розыгрыш и определить победителя.
    Возвращает словарь с результатами.
    """
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    
    c.execute("SELECT * FROM raffles WHERE id = ? AND status = 'active'", (raffle_id,))
    raffle = c.fetchone()
    if not raffle:
        conn.close()
        return None
    
    raffle = dict(raffle)
    
    c.execute('''
        SELECT user_id, bets_count FROM raffle_participants
        WHERE raffle_id = ?
        ORDER BY bets_count DESC
    ''', (raffle_id,))
    top = c.fetchall()
    
    if not top:
        c.execute("UPDATE raffles SET status = 'finished', winner_user_id = NULL WHERE id = ?", (raffle_id,))
        conn.commit()
        conn.close()
        return {
            'raffle_id': raffle_id,
            'winner_user_id': None,
            'bets_count': 0,
            'nft_link': raffle['nft_link'],
            'participants_count': 0
        }
    
    max_bets = top[0]['bets_count']
    top_users = [row for row in top if row['bets_count'] == max_bets]
    winner = random.choice(top_users)
    winner_id = winner['user_id']
    
    c.execute("UPDATE raffles SET status = 'finished', winner_user_id = ? WHERE id = ?", (winner_id, raffle_id))
    conn.commit()
    conn.close()
    
    return {
        'raffle_id': raffle_id,
        'winner_user_id': winner_id,
        'bets_count': winner['bets_count'],
        'nft_link': raffle['nft_link'],
        'participants_count': len(top)
    }

def get_raffle_results(raffle_id):
    """Получить полную информацию о розыгрыше (для админов)."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT * FROM raffles WHERE id = ?", (raffle_id,))
    raffle = c.fetchone()
    if not raffle:
        conn.close()
        return None
    raffle = dict(raffle)
    c.execute("SELECT user_id, bets_count FROM raffle_participants WHERE raffle_id = ? ORDER BY bets_count DESC", (raffle_id,))
    participants = [dict(row) for row in c.fetchall()]
    conn.close()
    raffle['participants'] = participants
    return raffle

def cancel_raffle(raffle_id):
    """Отменить активный розыгрыш без определения победителя."""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("UPDATE raffles SET status = 'cancelled', winner_user_id = NULL WHERE id = ? AND status = 'active'", (raffle_id,))
    conn.commit()
    conn.close()

def get_next_nonce(user_id: int) -> int:
    """Увеличить и вернуть следующий nonce для пользователя"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("UPDATE users SET provably_fair_nonce = provably_fair_nonce + 1 WHERE user_id = ?", (user_id,))
    c.execute("SELECT provably_fair_nonce FROM users WHERE user_id = ?", (user_id,))
    nonce = c.fetchone()[0]
    conn.commit()
    conn.close()
    return nonce

def create_round(user_id: int, game_name: str, bet_amount: float,
                 server_seed_hash: str, client_seed: str, nonce: int) -> int:
    """Сохранить раунд в статусе 'pending', вернуть round_id"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''
        INSERT INTO provably_fair_rounds
        (user_id, game_name, bet_amount, server_seed_hash, client_seed, nonce, timestamp, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ''', (user_id, game_name, bet_amount, server_seed_hash, client_seed, nonce, int(time.time()), 'pending'))
    round_id = c.lastrowid
    conn.commit()
    conn.close()
    return round_id

def reveal_round(round_id: int, server_seed: str, result: str):
    """Раскрыть серверный сид и сохранить результат"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''
        UPDATE provably_fair_rounds
        SET server_seed = ?, result = ?, status = 'revealed'
        WHERE id = ? AND status = 'pending'
    ''', (server_seed, result, round_id))
    conn.commit()
    conn.close()

def get_round(round_id: int):
    """Получить данные раунда"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT * FROM provably_fair_rounds WHERE id = ?", (round_id,))
    row = c.fetchone()
    conn.close()
    return dict(row) if row else None

# ============================================================
# ===== ПАРТНЁРСКИЕ ФУНКЦИИ =====
# ============================================================

def is_partner(user_id: int) -> bool:
    """Проверить, является ли пользователь партнером"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT is_partner FROM users WHERE user_id = ?", (user_id,))
    result = c.fetchone()
    conn.close()
    return result and result[0] == 1

def set_partner(user_id: int, status: bool) -> None:
    """Установить статус партнера"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("UPDATE users SET is_partner = ? WHERE user_id = ?", (1 if status else 0, user_id))
    conn.commit()
    conn.close()

def freeze_partner_withdrawal(user_id: int, reason: str = "") -> None:
    """Заморозить вывод для партнера"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("UPDATE users SET partner_frozen = 1, partner_freeze_reason = ? WHERE user_id = ?", (reason, user_id))
    conn.commit()
    conn.close()

def unfreeze_partner_withdrawal(user_id: int) -> None:
    """Разморозить вывод для партнера"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("UPDATE users SET partner_frozen = 0, partner_freeze_reason = NULL WHERE user_id = ?", (user_id,))
    conn.commit()
    conn.close()

def get_partner_info(user_id: int) -> dict:
    """Получить информацию о партнере"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT is_partner, referral_balance, partner_frozen, partner_freeze_reason FROM users WHERE user_id = ?", (user_id,))
    row = c.fetchone()
    conn.close()
    if not row:
        return {}
    return {
        "is_partner": row[0] == 1,
        "referral_balance": row[1] or 0.0,
        "frozen": row[2] == 1,
        "freeze_reason": row[3] or ""
    }

def get_partner_referrals(user_id: int) -> list:
    """Получить список рефералов партнера (пользователей, у которых referrer_id = user_id)"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT user_id, username, registration_date FROM users WHERE referrer_id = ?", (user_id,))
    rows = c.fetchall()
    conn.close()
    return [{"user_id": r[0], "username": r[1], "registered": r[2]} for r in rows]

def get_all_partners() -> list:
    """Получить список всех партнеров"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT user_id, username, referral_balance, partner_frozen, partner_freeze_reason FROM users WHERE is_partner = 1")
    rows = c.fetchall()
    conn.close()
    return [{"user_id": r[0], "username": r[1], "balance": r[2] or 0.0, "frozen": r[3] == 1, "reason": r[4] or ""} for r in rows]

def credit_partner_referral(player_id: int, loss_amount: float) -> None:
    """
    Начислить партнеру 50% от проигрыша игрока, если игрок привязан к партнёру.
    """
    if loss_amount <= 0:
        return
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    # Получаем referrer_id игрока
    c.execute("SELECT referrer_id FROM users WHERE user_id = ?", (player_id,))
    row = c.fetchone()
    if not row or row[0] is None:
        conn.close()
        return
    referrer_id = row[0]
    # Проверяем, является ли реферер партнером
    c.execute("SELECT is_partner FROM users WHERE user_id = ?", (referrer_id,))
    row2 = c.fetchone()
    if not row2 or row2[0] != 1:
        conn.close()
        return
    # Начисляем 50% от проигрыша
    bonus = loss_amount * 0.5
    c.execute("UPDATE users SET referral_balance = referral_balance + ? WHERE user_id = ?", (bonus, referrer_id))
    conn.commit()
    conn.close()
    logging.info(f"Partner {referrer_id} earned ${bonus:.2f} from player {player_id} loss ${loss_amount:.2f}")

def init_activity_table():
    """Инициализировать таблицу активности пользователей"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    # Таблица активности в чате
    c.execute('''
        CREATE TABLE IF NOT EXISTS chat_activity (
            user_id INTEGER PRIMARY KEY,
            message_count INTEGER DEFAULT 0,
            last_message_time INTEGER DEFAULT 0,
            total_earned REAL DEFAULT 0
        )
    ''')
    
    conn.commit()
    conn.close()

def get_user_activity(user_id: int) -> dict:
    """Получить данные активности пользователя"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(
        "SELECT message_count, last_message_time, total_earned FROM chat_activity WHERE user_id = ?",
        (user_id,)
    )
    row = c.fetchone()
    conn.close()
    
    if row:
        return {
            "message_count": row[0] or 0,
            "last_message_time": row[1] or 0,
            "total_earned": row[2] or 0.0
        }
    return {"message_count": 0, "last_message_time": 0, "total_earned": 0.0}

def increment_chat_message(user_id: int) -> tuple:
    """
    Увеличить счётчик сообщений пользователя.
    Возвращает (новый_счётчик, начислен_ли_бонус, сумма_бонуса)
    """
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    try:
        # Получаем текущие данные
        c.execute(
            "SELECT message_count, total_earned FROM chat_activity WHERE user_id = ?",
            (user_id,)
        )
        row = c.fetchone()
        
        if row:
            count = row[0] + 1
            total_earned = row[1] or 0.0
        else:
            count = 1
            total_earned = 0.0
        
        # Проверяем, нужно ли начислить бонус (каждые N сообщений)
        bonus_amount = 0.0
        earned = False
        
        if count % CHAT_ACTIVITY_THRESHOLD == 0:
            bonus_amount = CHAT_ACTIVITY_BONUS
            total_earned += bonus_amount
            earned = True
            
            # Атомарно начисляем бонус на основной баланс
            c.execute(
                "UPDATE users SET balance = COALESCE(balance, 0) + ? WHERE user_id = ?",
                (bonus_amount, user_id)
            )
        
        # Обновляем/создаём запись активности
        c.execute('''
            INSERT INTO chat_activity (user_id, message_count, last_message_time, total_earned)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                message_count = excluded.message_count,
                last_message_time = excluded.last_message_time,
                total_earned = excluded.total_earned
        ''', (user_id, count, int(time.time()), total_earned))
        
        conn.commit()
        return count, earned, bonus_amount
        
    except Exception as e:
        conn.rollback()
        logging.error(f"Error in increment_chat_message: {e}")
        return 0, False, 0.0
    finally:
        conn.close()

def get_chat_activity_stats(user_id: int) -> dict:
    """Получить статистику активности пользователя"""
    return get_user_activity(user_id)

def get_top_chat_users(limit: int = 10) -> list:
    """Получить топ пользователей по активности в чате"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute('''
        SELECT user_id, message_count, total_earned
        FROM chat_activity
        ORDER BY message_count DESC
        LIMIT ?
    ''', (limit,))
    rows = c.fetchall()
    conn.close()
    return [dict(row) for row in rows]

def get_chat_activity_global_stats() -> dict:
    """Получить глобальную статистику активности в чате"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT SUM(message_count), SUM(total_earned) FROM chat_activity")
    row = c.fetchone()
    conn.close()
    return {
        "total_messages": row[0] or 0,
        "total_earned": row[1] or 0.0
    }

def toggle_chat_activity(user_id: int, disabled: bool) -> None:
    """Включить/отключить заработок в чате для пользователя"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("UPDATE users SET chat_activity_disabled = ? WHERE user_id = ?",
              (1 if disabled else 0, user_id))
    conn.commit()
    conn.close()

def is_chat_activity_disabled(user_id: int) -> bool:
    """Проверить, отключена ли чат-активность"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT chat_activity_disabled FROM users WHERE user_id = ?", (user_id,))
    result = c.fetchone()
    conn.close()
    return result and result[0] == 1

def create_duel_db(chat_id, message_id, creator_id, game_type, bet_amount):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''
        INSERT INTO duels (chat_id, message_id, creator_id, game_type, bet_amount, status, created_at)
        VALUES (?, ?, ?, ?, ?, 'pending', ?)
    ''', (chat_id, message_id, creator_id, game_type, bet_amount, int(time.time())))
    duel_id = c.lastrowid
    conn.commit()
    conn.close()
    return duel_id

def get_duel_db(duel_id):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT * FROM duels WHERE duel_id = ?", (duel_id,))
    row = c.fetchone()
    conn.close()
    return dict(row) if row else None

def update_duel_opponent(duel_id, opponent_id):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("UPDATE duels SET opponent_id = ?, status = 'active' WHERE duel_id = ?",
              (opponent_id, duel_id))
    conn.commit()
    conn.close()

def update_duel_choices(duel_id, creator_choice=None, opponent_choice=None):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    if creator_choice:
        c.execute("UPDATE duels SET creator_choice = ? WHERE duel_id = ?",
                  (creator_choice, duel_id))
    if opponent_choice:
        c.execute("UPDATE duels SET opponent_choice = ? WHERE duel_id = ?",
                  (opponent_choice, duel_id))
    conn.commit()
    conn.close()

def finish_duel_db(duel_id, winner_id, result_data):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''
        UPDATE duels SET status = 'finished', winner_id = ?, result_data = ?, finished_at = ?
        WHERE duel_id = ?
    ''', (winner_id, result_data, int(time.time()), duel_id))
    conn.commit()
    conn.close()

def cancel_duel_db(duel_id):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("UPDATE duels SET status = 'cancelled' WHERE duel_id = ?", (duel_id,))
    conn.commit()
    conn.close()

def get_pending_duel_in_chat(chat_id):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT * FROM duels WHERE chat_id = ? AND status = 'pending' ORDER BY duel_id DESC LIMIT 1",
              (chat_id,))
    row = c.fetchone()
    conn.close()
    return dict(row) if row else None

# Инициализировать БД
init_db()
