from config import CRYPTO_BOT_TOKEN, DB_PATH
from database import save_withdrawal, update_user_balance_main, update_user_balance_ref, confirm_deposit

import requests
import time
import logging
import asyncio
import sqlite3
import hashlib
import traceback
import json


class CryptoBotAPI:
    """Интеграция с CryptoBot для вывода через чеки"""
    def __init__(self, token):
        self.token = token
        self.base_url = "https://pay.crypt.bot/api"
        self.headers = {"Crypto-Pay-API-Token": token}
    
    def create_invoice(self, amount, currency="USDT"):
        """Создать инвойс для депозита"""
        try:
            response = requests.post(
                f"{self.base_url}/createInvoice",
                headers=self.headers,
                json={"asset": currency, "amount": amount}
            )
            return response.json()
        except Exception as e:
            logging.error(f"Ошибка создания invoice: {e}")
            return None
    
    def create_check(self, amount, asset="USDT"):
        """Создать чек для вывода"""
        try:
            response = requests.post(
                f"{self.base_url}/createCheck",
                headers=self.headers,
                json={"asset": asset, "amount": amount}
            )
            result = response.json()
            
            if "error" in result:
                logging.error(f"Ошибка создания чека: {result['error']}")
                return None
            
            return result
        except Exception as e:
            logging.error(f"Ошибка создания чека: {e}")
            return None
    
    def get_invoices(self, invoice_ids=None):
        """Получить статус инвойсов"""
        try:
            params = {}
            if invoice_ids:
                params["invoice_ids"] = ",".join(map(str, invoice_ids))
            
            response = requests.get(
                f"{self.base_url}/getInvoices",
                headers=self.headers,
                params=params
            )
            return response.json()
        except Exception as e:
            logging.error(f"Ошибка получения invoices: {e}")
            return None

    def get_balance(self):
        """Получить баланс кошелька"""
        try:
            response = requests.get(
                f"{self.base_url}/getBalance",
                headers=self.headers
            )
            return response.json()
        except Exception as e:
            logging.error(f"Ошибка получения баланса: {e}")
            return None

    def get_checks(self):
        """Получить список чеков"""
        try:
            # Попробуем получить все чеки
            params = {}
            response = requests.get(
                f"{self.base_url}/getChecks",
                headers=self.headers,
                params=params
            )
            result = response.json()
            return result
        except Exception as e:
            logging.error(f"Ошибка получения чеков: {e}")
            return None

    def delete_check(self, check_id):
        """Удалить чек"""
        try:
            response = requests.post(
                f"{self.base_url}/deleteCheck",
                headers=self.headers,
                json={"check_id": check_id}
            )
            return response.json()
        except Exception as e:
            logging.error(f"Ошибка удаления чека: {e}")
            return None  

def check_pending_deposits():
    """Проверяем оплаченные invoices CryptoBot и заказы 1Plat"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    # --- Проверка CryptoBot ---
    try:
        c.execute("SELECT invoice_id FROM deposits WHERE status = 'pending' AND payment_system = 'cryptobot'")
        pending_crypto = c.fetchall()
        
        if pending_crypto:
            api = CryptoBotAPI(CRYPTO_BOT_TOKEN)
            invoice_ids = [p[0] for p in pending_crypto]
            
            invoices = api.get_invoices(invoice_ids)
            if invoices and invoices.get("result"):
                for invoice in invoices["result"].get("items", []):
                    if invoice["status"] == "paid":
                        # ВАЖНО: Сначала подтверждаем депозит в БД
                        user_id, amount = confirm_deposit(invoice_id=invoice["invoice_id"])
                        
                        # Только если подтверждение успешно, пополняем баланс
                        if user_id is not None and amount is not None:
                            update_user_balance_main(user_id, amount)
                            logging.info(f"✅ CryptoBot deposit confirmed: User {user_id}, ${amount}")
    except sqlite3.OperationalError as e:
        logging.error(f"DB error (CryptoBot): {e}")
        conn.close()

# Вывод с ОСНОВНОГО баланса
def create_withdrawal_check_main(user_id, amount):
    """Вывод с ОСНОВНОГО баланса через чек"""
    api = CryptoBotAPI(CRYPTO_BOT_TOKEN)
    check = api.create_check(amount, "USDT")
    
    if check and check.get("result"):
        check_data = check["result"]
        save_withdrawal(user_id, amount, "USDT", check_data["check_id"])
        update_user_balance_main(user_id, -amount)
        return True, check_data["bot_check_url"]
    else:
        error = check.get("error", {}).get("message", "Неизвестная ошибка") if check else "API недоступен"
        logging.error(f"Ошибка вывода: {error}")
        return False, error

# Вывод с РЕФЕРАЛЬНОГО баланса
def create_withdrawal_check_ref(user_id, amount):
    """Вывод с РЕФЕРАЛЬНОГО баланса через чек"""
    api = CryptoBotAPI(CRYPTO_BOT_TOKEN)
    check = api.create_check(amount, "USDT")
    
    if check and check.get("result"):
        check_data = check["result"]
        save_withdrawal(user_id, amount, "USDT", check_data["check_id"])
        update_user_balance_ref(user_id, -amount)
        return True, check_data["bot_check_url"]
    else:
        error = check.get("error", {}).get("message", "Неизвестная ошибка") if check else "API недоступен"
        logging.error(f"Ошибка вывода: {error}")
        return False, error

async def check_deposits_loop():
    """Фоновая задача для проверки депозитов"""
    while True:
        try:
            check_pending_deposits()
        except Exception as e:
            logging.error(f"Ошибка в цикле проверки: {e}")
            logging.error(f"Traceback: {traceback.format_exc()}")
        await asyncio.sleep(30)
