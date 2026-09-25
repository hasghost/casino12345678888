import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DB_PATH = path.resolve(process.cwd(), 'casino.db');

let dbInstance: DatabaseSync | null = null;

/**
 * Direct file-backed SQLite database instance using Node.js native DatabaseSync.
 * Configured with WAL mode and busy_timeout so that the external Telegram bot
 * and this Mini App server both read and write directly to casino.db on disk
 * without in-memory buffering, out-of-sync states, or file locks.
 */
export function getDb(): DatabaseSync {
  if (dbInstance) return dbInstance;

  dbInstance = new DatabaseSync(DB_PATH);

  // WAL mode allows concurrent readers and writers without database locking errors
  dbInstance.exec('PRAGMA journal_mode = WAL;');
  dbInstance.exec('PRAGMA busy_timeout = 5000;');
  dbInstance.exec('PRAGMA synchronous = NORMAL;');
  dbInstance.exec('PRAGMA foreign_keys = ON;');

  initDatabaseTables(dbInstance);
  return dbInstance;
}

/**
 * Execute an atomic transaction using BEGIN IMMEDIATE to protect against
 * concurrent writes and race conditions (double crediting, double cashout, etc.)
 */
export function runTransaction<T>(fn: (db: DatabaseSync) => T): T {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(db);
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // rollback error ignored if already aborted
    }
    throw err;
  }
}

/**
 * No-op retained for backwards compatibility.
 * DatabaseSync writes directly and immediately to casino.db on disk.
 */
export function saveDb(): void {
  // Direct disk SQLite does not need in-memory export/save
}

function initDatabaseTables(database: DatabaseSync) {
  database.exec(`
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
      total_bets_amount REAL DEFAULT 0,
      provably_fair_nonce INTEGER DEFAULT 0,
      reg_timestamp INTEGER,
      is_partner INTEGER DEFAULT 0,
      partner_frozen INTEGER DEFAULT 0,
      partner_freeze_reason TEXT,
      chat_activity_disabled INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS mines_games (
      user_id INTEGER PRIMARY KEY,
      field TEXT,
      mines TEXT,
      opened TEXT,
      bet_amount REAL,
      current_multiplier REAL,
      active INTEGER DEFAULT 1,
      timestamp INTEGER,
      round_id INTEGER
    );

    CREATE TABLE IF NOT EXISTS crash_games (
      user_id INTEGER PRIMARY KEY,
      bet_amount REAL,
      crash_point REAL,
      start_timestamp INTEGER,
      active INTEGER DEFAULT 1,
      round_id INTEGER
    );

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
      status TEXT
    );

    CREATE TABLE IF NOT EXISTS stats (
      key TEXT PRIMARY KEY,
      value REAL
    );

    CREATE TABLE IF NOT EXISTS daily_bonus (
      user_id INTEGER PRIMARY KEY,
      last_claim INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS promocodes (
      code TEXT PRIMARY KEY,
      amount REAL,
      uses INTEGER DEFAULT 0,
      max_uses INTEGER
    );

    CREATE TABLE IF NOT EXISTS user_promocodes (
      user_id INTEGER,
      code TEXT,
      used_at INTEGER,
      PRIMARY KEY (user_id, code)
    );

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
    );

    CREATE TABLE IF NOT EXISTS withdrawals (
      withdrawal_id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      amount REAL,
      asset TEXT,
      transfer_id TEXT,
      status TEXT,
      timestamp INTEGER
    );
  `);

  // Default admin and stats if not present
  const adminId = 7505000952;
  const adminRow = database.prepare('SELECT user_id FROM users WHERE user_id = ?').get(adminId);
  if (!adminRow) {
    const nowStr = new Date().toLocaleDateString('ru-RU');
    const nowTs = Math.floor(Date.now() / 1000);
    database.prepare(`
      INSERT INTO users (user_id, username, balance, registration_date, is_admin, is_banned, reg_timestamp)
      VALUES (?, 'winer404', 100.0, ?, 1, 0, ?)
    `).run(adminId, nowStr, nowTs);
  }

  const stats = ['total_deposits', 'total_withdrawals', 'total_referral_payouts', 'total_paid_out', 'total_players'];
  for (const s of stats) {
    database.prepare(`INSERT OR IGNORE INTO stats (key, value) VALUES (?, 0)`).run(s);
  }
}

// User Helpers (Reads directly from disk, writes directly to disk)
export function getUser(database: DatabaseSync, userId: number, username: string = '') {
  let user = database.prepare('SELECT * FROM users WHERE user_id = ?').get(userId) as any;

  if (!user) {
    const nowStr = new Date().toLocaleDateString('ru-RU');
    const nowTs = Math.floor(Date.now() / 1000);
    database.prepare(`
      INSERT INTO users (user_id, username, balance, registration_date, reg_timestamp)
      VALUES (?, ?, 10.0, ?, ?)
    `).run(userId, username || `user_${userId}`, nowStr, nowTs);

    database.prepare(`UPDATE stats SET value = value + 1 WHERE key = 'total_players'`).run();

    user = database.prepare('SELECT * FROM users WHERE user_id = ?').get(userId) as any;
  } else if (username && user.username !== username) {
    database.prepare(`UPDATE users SET username = ? WHERE user_id = ?`).run(username, userId);
    user.username = username;
  }

  return user;
}

/**
 * Updates user balance immediately on disk.
 * Uses ROUND(..., 2) to maintain exact monetary precision.
 */
export function updateUserBalance(database: DatabaseSync, userId: number, amount: number): void {
  database.prepare(`UPDATE users SET balance = ROUND(balance + ?, 2) WHERE user_id = ?`).run(amount, userId);
}

/**
 * Atomically checks that user has enough balance and deducts it.
 * Returns true if balance was deducted, false if insufficient funds or user not found.
 * Protects against race conditions and negative balances.
 */
export function deductUserBalanceSafe(database: DatabaseSync, userId: number, amount: number): boolean {
  const cleanAmount = Math.round(amount * 100) / 100;
  const res = database.prepare(`
    UPDATE users 
    SET balance = ROUND(balance - ?, 2) 
    WHERE user_id = ? AND balance >= ?
  `).run(cleanAmount, userId, cleanAmount);
  return res.changes > 0;
}

export function updateUserGameStats(database: DatabaseSync, userId: number, betAmount: number, win: boolean): void {
  database.prepare(`
    UPDATE users SET 
      total_games = total_games + 1, 
      total_bets_amount = ROUND(total_bets_amount + ?, 2),
      total_wins = total_wins + ?
    WHERE user_id = ?
  `).run(betAmount, win ? 1 : 0, userId);
}

export function getNextNonce(database: DatabaseSync, userId: number): number {
  database.prepare(`UPDATE users SET provably_fair_nonce = provably_fair_nonce + 1 WHERE user_id = ?`).run(userId);
  const row = database.prepare('SELECT provably_fair_nonce FROM users WHERE user_id = ?').get(userId) as any;
  return row ? Number(row.provably_fair_nonce) || 1 : 1;
}

// Provably Fair Helpers
export function generateSeeds() {
  const server_seed = crypto.randomBytes(32).toString('hex');
  const client_seed = crypto.randomBytes(16).toString('hex');
  const server_seed_hash = crypto.createHash('sha256').update(server_seed).digest('hex');
  return { server_seed, client_seed, server_seed_hash };
}

export function getMinesPositions(
  server_seed: string,
  client_seed: string,
  nonce: number,
  field_size: number = 25,
  mines_count: number = 10
): number[] {
  // Deterministic seed generation matching Python's hashlib.sha256(f"{server_seed}:{client_seed}:{nonce}")
  const combined = `${server_seed}:${client_seed}:${nonce}`;
  const hash = crypto.createHash('sha256').update(combined).digest('hex');

  // Use pseudo-random number generator seeded with deterministic hash
  // Fisher-Yates shuffle algorithm
  const positions = Array.from({ length: field_size }, (_, i) => i);
  let hashNum = BigInt('0x' + hash.slice(0, 16));

  for (let i = positions.length - 1; i > 0; i--) {
    hashNum = (hashNum * 6364136223846793005n + 1442695040888963407n) & 0xFFFFFFFFFFFFFFFFn;
    const j = Number(hashNum % BigInt(i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }

  return positions.slice(0, mines_count);
}
