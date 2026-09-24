import initSqlJs, { Database } from 'sql.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DB_PATH = path.resolve(process.cwd(), 'casino.db');

let db: Database | null = null;
let SQLInstance: any = null;

export async function getDb(): Promise<Database> {
  if (db) return db;

  if (!SQLInstance) {
    SQLInstance = await initSqlJs();
  }

  if (fs.existsSync(DB_PATH)) {
    try {
      const filebuffer = fs.readFileSync(DB_PATH);
      db = new SQLInstance.Database(filebuffer);
    } catch (e) {
      console.error('Error reading existing casino.db, initializing new:', e);
      db = new SQLInstance.Database();
    }
  } else {
    db = new SQLInstance.Database();
  }

  initDatabaseTables(db!);
  saveDb();
  return db!;
}

export function saveDb() {
  if (!db) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  } catch (err) {
    console.error('Error saving casino.db:', err);
  }
}

function initDatabaseTables(database: Database) {
  database.run(`
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
  const adminRes = database.exec(`SELECT user_id FROM users WHERE user_id = ${adminId}`);
  if (!adminRes.length || !adminRes[0].values.length) {
    const nowStr = new Date().toLocaleDateString('ru-RU');
    const nowTs = Math.floor(Date.now() / 1000);
    database.run(`
      INSERT INTO users (user_id, username, balance, registration_date, is_admin, is_banned, reg_timestamp)
      VALUES (${adminId}, 'winer404', 100.0, '${nowStr}', 1, 0, ${nowTs});
    `);
  }

  // Ensure default demo user exists for browser testing
  const demoId = 9990001;
  const demoRes = database.exec(`SELECT user_id FROM users WHERE user_id = ${demoId}`);
  if (!demoRes.length || !demoRes[0].values.length) {
    const nowStr = new Date().toLocaleDateString('ru-RU');
    const nowTs = Math.floor(Date.now() / 1000);
    database.run(`
      INSERT INTO users (user_id, username, balance, registration_date, is_admin, is_banned, reg_timestamp)
      VALUES (${demoId}, 'demo_player', 25.0, '${nowStr}', 0, 0, ${nowTs});
    `);
  }

  const stats = ['total_deposits', 'total_withdrawals', 'total_referral_payouts', 'total_paid_out', 'total_players'];
  for (const s of stats) {
    database.run(`INSERT OR IGNORE INTO stats (key, value) VALUES ('${s}', 0)`);
  }
}

// User Helpers
export function getUser(database: Database, userId: number, username: string = '') {
  const stmt = database.prepare(`SELECT * FROM users WHERE user_id = :userId`);
  stmt.bind({ ':userId': userId });
  let user: any = null;
  if (stmt.step()) {
    user = stmt.getAsObject();
  }
  stmt.free();

  if (!user) {
    const nowStr = new Date().toLocaleDateString('ru-RU');
    const nowTs = Math.floor(Date.now() / 1000);
    database.run(`
      INSERT INTO users (user_id, username, balance, registration_date, reg_timestamp)
      VALUES (?, ?, 10.0, ?, ?)
    `, [userId, username || `user_${userId}`, nowStr, nowTs]);
    database.run(`UPDATE stats SET value = value + 1 WHERE key = 'total_players'`);
    saveDb();

    const stmt2 = database.prepare(`SELECT * FROM users WHERE user_id = :userId`);
    stmt2.bind({ ':userId': userId });
    if (stmt2.step()) {
      user = stmt2.getAsObject();
    }
    stmt2.free();
  } else if (username && user.username !== username) {
    database.run(`UPDATE users SET username = ? WHERE user_id = ?`, [username, userId]);
    user.username = username;
    saveDb();
  }

  return user;
}

export function updateUserBalance(database: Database, userId: number, amount: number) {
  database.run(`UPDATE users SET balance = balance + ? WHERE user_id = ?`, [amount, userId]);
  saveDb();
}

export function updateUserGameStats(database: Database, userId: number, betAmount: number, win: boolean) {
  database.run(`
    UPDATE users SET 
      total_games = total_games + 1, 
      total_bets_amount = total_bets_amount + ?,
      total_wins = total_wins + ?
    WHERE user_id = ?
  `, [betAmount, win ? 1 : 0, userId]);
  saveDb();
}

export function getNextNonce(database: Database, userId: number): number {
  database.run(`UPDATE users SET provably_fair_nonce = provably_fair_nonce + 1 WHERE user_id = ?`, [userId]);
  const stmt = database.prepare(`SELECT provably_fair_nonce FROM users WHERE user_id = :userId`);
  stmt.bind({ ':userId': userId });
  let nonce = 1;
  if (stmt.step()) {
    const row = stmt.getAsObject();
    nonce = Number(row.provably_fair_nonce) || 1;
  }
  stmt.free();
  saveDb();
  return nonce;
}

// Provably Fair Helpers
export function generateSeeds() {
  const server_seed = crypto.randomBytes(32).toString('hex');
  const client_seed = crypto.randomBytes(16).toString('hex');
  const server_seed_hash = crypto.createHash('sha256').update(server_seed).digest('hex');
  return { server_seed, client_seed, server_seed_hash };
}

export function getMinesPositions(server_seed: string, client_seed: string, nonce: number, field_size: number = 25, mines_count: number = 10): number[] {
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
