import secrets
import hashlib
import random
import hmac

def generate_seeds():
    """Генерирует server_seed (32 байта) и client_seed (16 байт) в hex"""
    server_seed = secrets.token_hex(32)
    client_seed = secrets.token_hex(16)
    return server_seed, client_seed

def hash_server_seed(server_seed: str) -> str:
    """SHA256 хеш серверного сида (показывается до игры)"""
    return hashlib.sha256(server_seed.encode()).hexdigest()

def get_deterministic_random(server_seed: str, client_seed: str, nonce: int):
    """
    Классический алгоритм: HMAC_SHA256(server_seed, client_seed + nonce)
    или SHA256(server_seed + ':' + client_seed + ':' + str(nonce))
    Здесь используется SHA256, так как он проще для проверки на сторонних сайтах.
    """
    combined = f"{server_seed}:{client_seed}:{nonce}"
    hash_obj = hashlib.sha256(combined.encode())
    seed_int = int(hash_obj.hexdigest(), 16)
    return random.Random(seed_int)

# ------------------------------------------------------------
# ИГРА MINES (самая важная)
# ------------------------------------------------------------
def get_mines_positions(server_seed: str, client_seed: str, nonce: int, field_size: int = 25, mines_count: int = 10):
    """
    Возвращает список индексов мин (0..field_size-1).
    Алгоритм:
    1. Создаём массив [0,1,2,...,field_size-1]
    2. Перемешиваем с использованием детерминированного RNG.
    3. Берём первые mines_count элементов.
    Этот алгоритм легко воспроизвести на любом языке.
    """
    rng = get_deterministic_random(server_seed, client_seed, nonce)
    positions = list(range(field_size))
    rng.shuffle(positions)
    return positions[:mines_count]

# ------------------------------------------------------------
# ДРУГИЕ ИГРЫ (вероятности сохранены как в оригинале)
# ------------------------------------------------------------
def get_coinflip_result(server_seed: str, client_seed: str, nonce: int, user_choice: str):
    rng = get_deterministic_random(server_seed, client_seed, nonce)
    win = rng.random() < 0.37
    result = user_choice if win else ('tails' if user_choice == 'heads' else 'heads')
    return win, result

def get_boxes_result(server_seed: str, client_seed: str, nonce: int, box_id: int = 0):
    rng = get_deterministic_random(server_seed, client_seed, nonce)
    return rng.random() < 0.37

def get_hearts_result(server_seed: str, client_seed: str, nonce: int, user_color: str):
    rng = get_deterministic_random(server_seed, client_seed, nonce)
    win = rng.random() < 0.37
    result_color = user_color if win else ('red' if user_color == 'blue' else 'blue')
    return win, result_color

def get_rps_result(server_seed: str, client_seed: str, nonce: int, user_choice: str):
    rng = get_deterministic_random(server_seed, client_seed, nonce)
    choices = ['rock', 'scissors', 'paper']
    bot_choice = rng.choice(choices)
    beats = {'rock': 'scissors', 'scissors': 'paper', 'paper': 'rock'}
    if user_choice == bot_choice:
        real_result = 'draw'
    elif beats[user_choice] == bot_choice:
        real_result = 'win'
    else:
        real_result = 'lose'
    if real_result == 'lose':
        win = rng.random() < 0.37
    elif real_result == 'win':
        win = rng.random() < 0.37
    else:
        win = rng.random() < 0.5
    return win, bot_choice, real_result

def get_russian_roulette_result(server_seed: str, client_seed: str, nonce: int, bullet_count: int):
    rng = get_deterministic_random(server_seed, client_seed, nonce)
    chambers = [True] * bullet_count + [False] * (6 - bullet_count)
    rng.shuffle(chambers)
    return not chambers[0]  # True = выжил (победа)

def get_roulette_result(server_seed: str, client_seed: str, nonce: int, user_number: int):
    rng = get_deterministic_random(server_seed, client_seed, nonce)
    result_number = rng.randint(0, 14)
    return (user_number == result_number), result_number
