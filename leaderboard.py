import sqlite3
from datetime import datetime, timedelta
from database import DB_PATH
import logging

def get_top_players(period: str = "all", category: str = "turnover", limit: int = 10):
    """
    Получить топ игроков.
    
    period: "day", "week", "all"
    category: "turnover", "games", "wins"
    """
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    now = datetime.now()
    timestamp_from = None
    
    if period == "day":
        timestamp_from = int((now - timedelta(days=1)).timestamp())
        period_text = "за сегодня"
    elif period == "week":
        timestamp_from = int((now - timedelta(days=7)).timestamp())
        period_text = "за неделю"
    else:
        period_text = "за всё время"

    category_map = {
        "turnover": ("total_bets_amount", "💰 Топ по обороту"),
        "games": ("total_games", "🎮 Топ по ставкам"),
        "wins": ("total_wins", "🏆 Топ по победам")
    }
    order_field, title = category_map.get(category, ("total_bets_amount", "💰 Топ по обороту"))

    if timestamp_from:
        c.execute(f"""
            SELECT user_id, username, total_bets_amount, total_games, total_wins,
                   COALESCE(total_wins * 1.0 / NULLIF(total_games, 0), 0) as winrate
            FROM users 
            WHERE is_banned = 0 AND reg_timestamp >= ?
            ORDER BY {order_field} DESC LIMIT ?
        """, (timestamp_from, limit))
    else:
        c.execute(f"""
            SELECT user_id, username, total_bets_amount, total_games, total_wins,
                   COALESCE(total_wins * 1.0 / NULLIF(total_games, 0), 0) as winrate
            FROM users 
            WHERE is_banned = 0
            ORDER BY {order_field} DESC LIMIT ?
        """, (limit,))

    results = c.fetchall()
    conn.close()

    players = []
    for row in results:
        p = dict(row)
        p["total_bets_amount"] = p["total_bets_amount"] or 0.0
        p["total_games"] = p["total_games"] or 0
        p["total_wins"] = p["total_wins"] or 0
        players.append(p)

    return {
        "title": title,
        "period": period_text,
        "category": category,
        "players": players
    }


def format_leaderboard(data):
    """Форматировать топ в красивый текст."""
    if not data["players"]:
        return (
            "🏆 <b>" + data["title"] + "</b>\n"
            "<blockquote>└ " + data["period"].upper() + "</blockquote>\n\n"
            "<i>😔 Пока нет данных для этого периода.</i>"
        )

    text = (
        "🏆 <b>" + data["title"] + "</b>\n"
        "<blockquote>└ " + data["period"].upper() + "</blockquote>\n\n"
    )
    
    for i, p in enumerate(data["players"], 1):
        username = f"@{p['username']}" if p["username"] else f"ID: <code>{p['user_id']}</code>"
        emoji = ["🥇", "🥈", "🥉"][i-1] if i <= 3 else f"{i}."
        
        if data["category"] == "turnover":
            value = f"${p['total_bets_amount'] * 100:.2f}"
            value_name = "Оборот"
        elif data["category"] == "games":
            value = p["total_games"]
            value_name = "Ставок"
        else:
            value = p["total_wins"]
            value_name = "Побед"
        
        winrate = f"{p['winrate']:.1f}%"
        text += (
            "\n" + emoji + " <b>" + username + "</b>\n"
            "<blockquote>├ " + value_name + ": <b>" + str(value) + "</b>\n"
            "└ Винрейт: <b>" + winrate + "</b></blockquote>"
        )
    
    return text.strip()
