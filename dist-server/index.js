// server.ts
import express from "express";
import path2 from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// src/server/api.ts
import crypto2 from "node:crypto";

// src/server/database.ts
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import crypto from "node:crypto";
var DB_PATH = path.resolve(process.cwd(), "casino.db");
var dbInstance = null;
function getDb() {
  if (dbInstance) return dbInstance;
  dbInstance = new DatabaseSync(DB_PATH);
  dbInstance.exec("PRAGMA journal_mode = WAL;");
  dbInstance.exec("PRAGMA busy_timeout = 5000;");
  dbInstance.exec("PRAGMA synchronous = NORMAL;");
  dbInstance.exec("PRAGMA foreign_keys = ON;");
  initDatabaseTables(dbInstance);
  return dbInstance;
}
function runTransaction(fn) {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn(db);
    db.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
    }
    throw err;
  }
}
function initDatabaseTables(database) {
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
  const adminId = 7505000952;
  const adminRow = database.prepare("SELECT user_id FROM users WHERE user_id = ?").get(adminId);
  if (!adminRow) {
    const nowStr = (/* @__PURE__ */ new Date()).toLocaleDateString("ru-RU");
    const nowTs = Math.floor(Date.now() / 1e3);
    database.prepare(`
      INSERT INTO users (user_id, username, balance, registration_date, is_admin, is_banned, reg_timestamp)
      VALUES (?, 'winer404', 100.0, ?, 1, 0, ?)
    `).run(adminId, nowStr, nowTs);
  }
  const stats = ["total_deposits", "total_withdrawals", "total_referral_payouts", "total_paid_out", "total_players"];
  for (const s of stats) {
    database.prepare(`INSERT OR IGNORE INTO stats (key, value) VALUES (?, 0)`).run(s);
  }
}
function getUser(database, userId, username = "") {
  let user = database.prepare("SELECT * FROM users WHERE user_id = ?").get(userId);
  if (!user) {
    const nowStr = (/* @__PURE__ */ new Date()).toLocaleDateString("ru-RU");
    const nowTs = Math.floor(Date.now() / 1e3);
    database.prepare(`
      INSERT INTO users (user_id, username, balance, registration_date, reg_timestamp)
      VALUES (?, ?, 10.0, ?, ?)
    `).run(userId, username || `user_${userId}`, nowStr, nowTs);
    database.prepare(`UPDATE stats SET value = value + 1 WHERE key = 'total_players'`).run();
    user = database.prepare("SELECT * FROM users WHERE user_id = ?").get(userId);
  } else if (username && user.username !== username) {
    database.prepare(`UPDATE users SET username = ? WHERE user_id = ?`).run(username, userId);
    user.username = username;
  }
  return user;
}
function updateUserBalance(database, userId, amount) {
  database.prepare(`UPDATE users SET balance = ROUND(balance + ?, 2) WHERE user_id = ?`).run(amount, userId);
}
function deductUserBalanceSafe(database, userId, amount) {
  const cleanAmount = Math.round(amount * 100) / 100;
  const res = database.prepare(`
    UPDATE users 
    SET balance = ROUND(balance - ?, 2) 
    WHERE user_id = ? AND balance >= ?
  `).run(cleanAmount, userId, cleanAmount);
  return res.changes > 0;
}
function updateUserGameStats(database, userId, betAmount, win) {
  database.prepare(`
    UPDATE users SET 
      total_games = total_games + 1, 
      total_bets_amount = ROUND(total_bets_amount + ?, 2),
      total_wins = total_wins + ?
    WHERE user_id = ?
  `).run(betAmount, win ? 1 : 0, userId);
}
function getNextNonce(database, userId) {
  database.prepare(`UPDATE users SET provably_fair_nonce = provably_fair_nonce + 1 WHERE user_id = ?`).run(userId);
  const row = database.prepare("SELECT provably_fair_nonce FROM users WHERE user_id = ?").get(userId);
  return row ? Number(row.provably_fair_nonce) || 1 : 1;
}
function generateSeeds() {
  const server_seed = crypto.randomBytes(32).toString("hex");
  const client_seed = crypto.randomBytes(16).toString("hex");
  const server_seed_hash = crypto.createHash("sha256").update(server_seed).digest("hex");
  return { server_seed, client_seed, server_seed_hash };
}
function getMinesPositions(server_seed, client_seed, nonce, field_size = 25, mines_count = 10) {
  const combined = `${server_seed}:${client_seed}:${nonce}`;
  const hash = crypto.createHash("sha256").update(combined).digest("hex");
  const positions = Array.from({ length: field_size }, (_, i) => i);
  let hashNum = BigInt("0x" + hash.slice(0, 16));
  for (let i = positions.length - 1; i > 0; i--) {
    hashNum = hashNum * 6364136223846793005n + 1442695040888963407n & 0xFFFFFFFFFFFFFFFFn;
    const j = Number(hashNum % BigInt(i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }
  return positions.slice(0, mines_count);
}

// src/utils/minesMath.ts
function combinations(n, k) {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let c = 1;
  for (let i = 1; i <= k; i++) {
    c = c * (n - (k - i)) / i;
  }
  return c;
}
function calculateMinesMultiplier(minesCount, openedCount) {
  if (openedCount <= 0) return 1;
  const totalCells = 25;
  const safeCells = totalCells - minesCount;
  if (openedCount > safeCells) return 1;
  const houseEdge = 0.96;
  const prob = combinations(safeCells, openedCount) / combinations(totalCells, openedCount);
  const rawMult = 1 / prob * houseEdge;
  return Math.max(1.01, Math.round(rawMult * 100) / 100);
}

// src/server/api.ts
var BOT_USERNAME = process.env.BOT_USERNAME || "SPIND_BET_BOT";
function registerApiRoutes(app) {
  app.get("/api/user", async (req, res) => {
    try {
      const db = getDb();
      const userId = Number(req.query.userId) || 7505000952;
      const username = String(req.query.username || "");
      const user = getUser(db, userId, username);
      const totalGames = user.total_games || 0;
      const totalWins = user.total_wins || 0;
      const winrate = totalGames > 0 ? (totalWins / totalGames * 100).toFixed(1) : "0.0";
      return res.json({
        ok: true,
        user: {
          ...user,
          balance: Math.round(Number(user.balance || 0) * 100) / 100,
          referral_balance: Math.round(Number(user.referral_balance || 0) * 100) / 100,
          total_bets_amount: Math.round(Number(user.total_bets_amount || 0) * 100) / 100,
          winrate
        }
      });
    } catch (err) {
      console.error("Error in /api/user:", err);
      return res.status(500).json({ ok: false, error: err.message || "\u041E\u0448\u0438\u0431\u043A\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0438 \u043F\u0440\u043E\u0444\u0438\u043B\u044F" });
    }
  });
  app.get("/api/mines/active", async (req, res) => {
    try {
      const db = getDb();
      const userId = Number(req.query.userId);
      if (!userId) return res.status(400).json({ ok: false, error: "User ID required" });
      const game = db.prepare("SELECT * FROM mines_games WHERE user_id = ? AND active = 1").get(userId);
      if (!game) {
        return res.json({ ok: true, active: false });
      }
      const opened = JSON.parse(String(game.opened || "[]"));
      const mines = JSON.parse(String(game.mines || "[]"));
      const minesCount = mines.length;
      const nextMultiplier = calculateMinesMultiplier(minesCount, opened.length + 1);
      return res.json({
        ok: true,
        active: true,
        game: {
          betAmount: Number(game.bet_amount),
          minesCount,
          opened,
          currentMultiplier: Number(game.current_multiplier),
          nextMultiplier,
          roundId: Number(game.round_id)
        }
      });
    } catch (err) {
      console.error("Error in /api/mines/active:", err);
      return res.status(500).json({ ok: false, error: err.message || "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0438 \u0438\u0433\u0440\u044B" });
    }
  });
  app.post("/api/mines/start", async (req, res) => {
    try {
      const { userId, betAmount, minesCount = 10 } = req.body;
      if (!userId) return res.status(400).json({ ok: false, error: "User ID is required" });
      const bet = Math.round(Number(betAmount) * 100) / 100;
      if (isNaN(bet) || bet < 0.01) {
        return res.status(400).json({ ok: false, error: "\u041C\u0438\u043D\u0438\u043C\u0430\u043B\u044C\u043D\u0430\u044F \u0441\u0442\u0430\u0432\u043A\u0430 $0.01" });
      }
      if (bet > 500) {
        return res.status(400).json({ ok: false, error: "\u041C\u0430\u043A\u0441\u0438\u043C\u0430\u043B\u044C\u043D\u0430\u044F \u0441\u0442\u0430\u0432\u043A\u0430 $500" });
      }
      if (Number(minesCount) < 5) {
        return res.status(400).json({ ok: false, error: "\u041C\u0438\u043D\u0438\u043C\u0430\u043B\u044C\u043D\u043E\u0435 \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E \u043C\u0438\u043D: 5" });
      }
      const count = Math.min(24, Math.max(5, Number(minesCount) || 5));
      const gameResult = runTransaction((db) => {
        const user = getUser(db, Number(userId));
        if (user.is_banned) {
          throw new Error("\u0412\u044B \u0437\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043D\u044B \u0432 \u0441\u0438\u0441\u0442\u0435\u043C\u0435");
        }
        const existing = db.prepare("SELECT 1 FROM mines_games WHERE user_id = ? AND active = 1").get(userId);
        if (existing) {
          const err = new Error("\u0423 \u0432\u0430\u0441 \u0443\u0436\u0435 \u0435\u0441\u0442\u044C \u0430\u043A\u0442\u0438\u0432\u043D\u0430\u044F \u0438\u0433\u0440\u0430! \u0417\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u0435 \u0435\u0451 \u0438\u043B\u0438 \u0437\u0430\u0431\u0435\u0440\u0438\u0442\u0435 \u0432\u044B\u0438\u0433\u0440\u044B\u0448.");
          err.activeGame = true;
          throw err;
        }
        const deducted = deductUserBalanceSafe(db, Number(userId), bet);
        if (!deducted) {
          throw new Error("\u041D\u0435\u0434\u043E\u0441\u0442\u0430\u0442\u043E\u0447\u043D\u043E \u0441\u0440\u0435\u0434\u0441\u0442\u0432 \u043D\u0430 \u0431\u0430\u043B\u0430\u043D\u0441\u0435");
        }
        const nonce = getNextNonce(db, Number(userId));
        const { server_seed, client_seed, server_seed_hash } = generateSeeds();
        const minePositions = getMinesPositions(server_seed, client_seed, nonce, 25, count);
        const nowTs = Math.floor(Date.now() / 1e3);
        const roundInsert = db.prepare(`
          INSERT INTO provably_fair_rounds
          (user_id, game_name, bet_amount, server_seed_hash, server_seed, client_seed, nonce, timestamp, status)
          VALUES (?, 'Mines', ?, ?, ?, ?, ?, ?, 'pending')
        `).run(Number(userId), bet, server_seed_hash, server_seed, client_seed, nonce, nowTs);
        const roundId = Number(roundInsert.lastInsertRowid);
        db.prepare(`
          INSERT OR REPLACE INTO mines_games
          (user_id, field, mines, opened, bet_amount, current_multiplier, active, timestamp, round_id)
          VALUES (?, ?, ?, ?, ?, 1.0, 1, ?, ?)
        `).run(
          Number(userId),
          JSON.stringify(Array.from({ length: 25 }, (_, i) => i)),
          JSON.stringify(minePositions),
          JSON.stringify([]),
          bet,
          nowTs,
          roundId
        );
        const freshUser = getUser(db, Number(userId));
        const nextMultiplier = calculateMinesMultiplier(count, 1);
        return {
          game: {
            betAmount: bet,
            minesCount: count,
            opened: [],
            currentMultiplier: 1,
            nextMultiplier,
            roundId
          },
          fairness: {
            serverSeedHash: server_seed_hash,
            clientSeed: client_seed,
            nonce
          },
          balance: freshUser.balance
        };
      });
      return res.json({ ok: true, ...gameResult });
    } catch (err) {
      console.error("Error in /api/mines/start:", err);
      return res.status(400).json({
        ok: false,
        error: err.message || "\u041E\u0448\u0438\u0431\u043A\u0430 \u043D\u0430\u0447\u0430\u043B\u0430 \u0438\u0433\u0440\u044B",
        activeGame: err.activeGame || false
      });
    }
  });
  app.post("/api/mines/open", async (req, res) => {
    try {
      const { userId, cellId } = req.body;
      const cell = Number(cellId);
      const uid = Number(userId);
      if (cell < 0 || cell > 24 || isNaN(cell)) {
        return res.status(400).json({ ok: false, error: "\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u0430\u044F \u044F\u0447\u0435\u0439\u043A\u0430" });
      }
      const openResult = runTransaction((db) => {
        const game = db.prepare("SELECT * FROM mines_games WHERE user_id = ? AND active = 1").get(uid);
        if (!game) {
          throw new Error("\u0410\u043A\u0442\u0438\u0432\u043D\u0430\u044F \u0438\u0433\u0440\u0430 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430");
        }
        const opened = JSON.parse(String(game.opened || "[]"));
        const mines = JSON.parse(String(game.mines || "[]"));
        const betAmount = Number(game.bet_amount);
        const roundId = Number(game.round_id);
        const minesCount = mines.length;
        const safeCellsCount = 25 - minesCount;
        if (opened.includes(cell)) {
          throw new Error("\u042F\u0447\u0435\u0439\u043A\u0430 \u0443\u0436\u0435 \u043E\u0442\u043A\u0440\u044B\u0442\u0430");
        }
        opened.push(cell);
        const roundData = db.prepare("SELECT * FROM provably_fair_rounds WHERE id = ?").get(roundId);
        if (mines.includes(cell)) {
          const upd = db.prepare(`
            UPDATE mines_games 
            SET active = 0, opened = ? 
            WHERE user_id = ? AND active = 1
          `).run(JSON.stringify(opened), uid);
          if (upd.changes === 0) {
            throw new Error("\u0418\u0433\u0440\u0430 \u0443\u0436\u0435 \u0431\u044B\u043B\u0430 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0430");
          }
          updateUserGameStats(db, uid, betAmount, false);
          const resultStr = JSON.stringify({ mines, opened, hitMine: cell, win: false });
          const serverSeed = roundData?.server_seed || crypto2.createHash("sha256").update(`${roundId}_seed`).digest("hex");
          db.prepare(`
            UPDATE provably_fair_rounds
            SET server_seed = ?, result = ?, status = 'revealed'
            WHERE id = ?
          `).run(serverSeed, resultStr, roundId);
          const freshUser = getUser(db, uid);
          return {
            hitMine: true,
            cellId: cell,
            mines,
            opened,
            balance: freshUser.balance,
            fairness: {
              serverSeed,
              serverSeedHash: roundData?.server_seed_hash,
              clientSeed: roundData?.client_seed,
              nonce: roundData?.nonce
            }
          };
        }
        if (opened.length >= safeCellsCount) {
          const finalMultiplier = calculateMinesMultiplier(minesCount, opened.length);
          const winAmount = Math.round(betAmount * finalMultiplier * 100) / 100;
          const upd = db.prepare(`
            UPDATE mines_games
            SET active = 0, opened = ?, current_multiplier = ?
            WHERE user_id = ? AND active = 1
          `).run(JSON.stringify(opened), finalMultiplier, uid);
          if (upd.changes === 0) {
            throw new Error("\u0418\u0433\u0440\u0430 \u0443\u0436\u0435 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0430");
          }
          updateUserBalance(db, uid, winAmount);
          updateUserGameStats(db, uid, betAmount, true);
          const resultStr = JSON.stringify({ mines, opened, winAmount, multiplier: finalMultiplier, win: true });
          const serverSeed = roundData?.server_seed || crypto2.createHash("sha256").update(`${roundId}_seed`).digest("hex");
          db.prepare(`
            UPDATE provably_fair_rounds
            SET server_seed = ?, result = ?, status = 'revealed'
            WHERE id = ?
          `).run(serverSeed, resultStr, roundId);
          const freshUser = getUser(db, uid);
          return {
            hitMine: false,
            allCleared: true,
            cellId: cell,
            opened,
            mines,
            currentMultiplier: finalMultiplier,
            winAmount,
            balance: freshUser.balance,
            fairness: {
              serverSeed,
              serverSeedHash: roundData?.server_seed_hash,
              clientSeed: roundData?.client_seed,
              nonce: roundData?.nonce
            }
          };
        }
        const currentMultiplier = calculateMinesMultiplier(minesCount, opened.length);
        const nextMultiplier = calculateMinesMultiplier(minesCount, opened.length + 1);
        db.prepare(`
          UPDATE mines_games
          SET opened = ?, current_multiplier = ?
          WHERE user_id = ? AND active = 1
        `).run(JSON.stringify(opened), currentMultiplier, uid);
        return {
          hitMine: false,
          allCleared: false,
          cellId: cell,
          opened,
          currentMultiplier,
          nextMultiplier,
          currentWin: Math.round(betAmount * currentMultiplier * 100) / 100
        };
      });
      return res.json({ ok: true, ...openResult });
    } catch (err) {
      console.error("Error in /api/mines/open:", err);
      return res.status(400).json({ ok: false, error: err.message || "\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0442\u043A\u0440\u044B\u0442\u0438\u044F \u044F\u0447\u0435\u0439\u043A\u0438" });
    }
  });
  app.post("/api/mines/cashout", async (req, res) => {
    try {
      const { userId } = req.body;
      const uid = Number(userId);
      if (!uid) {
        return res.status(400).json({ ok: false, error: "User ID is required" });
      }
      const cashoutResult = runTransaction((db) => {
        const game = db.prepare("SELECT * FROM mines_games WHERE user_id = ? AND active = 1").get(uid);
        if (!game) {
          throw new Error("\u0410\u043A\u0442\u0438\u0432\u043D\u0430\u044F \u0438\u0433\u0440\u0430 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430 \u0438\u043B\u0438 \u0443\u0436\u0435 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0430");
        }
        const opened = JSON.parse(String(game.opened || "[]"));
        const mines = JSON.parse(String(game.mines || "[]"));
        const betAmount = Number(game.bet_amount);
        const currentMultiplier = Number(game.current_multiplier);
        const roundId = Number(game.round_id);
        if (opened.length === 0) {
          throw new Error("\u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u0445\u043E\u0442\u044F \u0431\u044B \u043E\u0434\u043D\u0443 \u044F\u0447\u0435\u0439\u043A\u0443 \u043F\u0435\u0440\u0435\u0434 \u0437\u0430\u0431\u043E\u0440\u043E\u043C");
        }
        const lockRes = db.prepare(`
          UPDATE mines_games 
          SET active = 0 
          WHERE user_id = ? AND active = 1
        `).run(uid);
        if (lockRes.changes === 0) {
          throw new Error("\u0412\u044B\u0438\u0433\u0440\u044B\u0448 \u0443\u0436\u0435 \u0431\u044B\u043B \u0437\u0430\u0447\u0438\u0441\u043B\u0435\u043D");
        }
        const winAmount = Math.round(betAmount * currentMultiplier * 100) / 100;
        updateUserBalance(db, uid, winAmount);
        updateUserGameStats(db, uid, betAmount, true);
        const roundData = db.prepare("SELECT * FROM provably_fair_rounds WHERE id = ?").get(roundId);
        const resultStr = JSON.stringify({ mines, opened, winAmount, multiplier: currentMultiplier, cashout: true });
        const serverSeed = roundData?.server_seed || crypto2.createHash("sha256").update(`${roundId}_seed`).digest("hex");
        db.prepare(`
          UPDATE provably_fair_rounds
          SET server_seed = ?, result = ?, status = 'revealed'
          WHERE id = ?
        `).run(serverSeed, resultStr, roundId);
        const freshUser = getUser(db, uid);
        return {
          winAmount,
          multiplier: currentMultiplier,
          mines,
          opened,
          balance: freshUser.balance,
          fairness: {
            serverSeed,
            serverSeedHash: roundData?.server_seed_hash,
            clientSeed: roundData?.client_seed,
            nonce: roundData?.nonce
          }
        };
      });
      return res.json({ ok: true, ...cashoutResult });
    } catch (err) {
      console.error("Error in /api/mines/cashout:", err);
      return res.status(400).json({ ok: false, error: err.message || "\u041E\u0448\u0438\u0431\u043A\u0430 \u0437\u0430\u0431\u043E\u0440\u0430 \u0432\u044B\u0438\u0433\u0440\u044B\u0448\u0430" });
    }
  });
  app.post("/api/bonus/claim", async (req, res) => {
    try {
      const { userId } = req.body;
      const uid = Number(userId);
      if (!uid) {
        return res.status(400).json({ ok: false, error: "User ID is required" });
      }
      const claimResult = runTransaction((db) => {
        const row = db.prepare("SELECT last_claim FROM daily_bonus WHERE user_id = ?").get(uid);
        const lastClaim = row ? Number(row.last_claim) : 0;
        const now = Math.floor(Date.now() / 1e3);
        const cooldown = 86400;
        const timeLeft = cooldown - (now - lastClaim);
        if (timeLeft > 0) {
          const hours = Math.floor(timeLeft / 3600);
          const minutes = Math.floor(timeLeft % 3600 / 60);
          throw new Error(`\u0411\u043E\u043D\u0443\u0441 \u0443\u0436\u0435 \u043F\u043E\u043B\u0443\u0447\u0435\u043D. \u0414\u043E \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u0433\u043E: ${hours}\u0447 ${minutes}\u043C`);
        }
        if (row) {
          const upd = db.prepare(`
            UPDATE daily_bonus 
            SET last_claim = ? 
            WHERE user_id = ? AND (? - last_claim) >= ?
          `).run(now, uid, now, cooldown);
          if (upd.changes === 0) {
            throw new Error("\u0411\u043E\u043D\u0443\u0441 \u0443\u0436\u0435 \u043F\u043E\u043B\u0443\u0447\u0435\u043D");
          }
        } else {
          db.prepare("INSERT INTO daily_bonus (user_id, last_claim) VALUES (?, ?)").run(uid, now);
        }
        const won = Math.random() < 0.5;
        const bonusAmount = won ? 0.01 : 0;
        if (won) {
          updateUserBalance(db, uid, bonusAmount);
        }
        const freshUser = getUser(db, uid);
        return {
          won,
          amount: bonusAmount,
          balance: freshUser.balance
        };
      });
      return res.json({ ok: true, ...claimResult });
    } catch (err) {
      console.error("Error in /api/bonus/claim:", err);
      return res.status(400).json({ ok: false, error: err.message || "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u0438\u044F \u0431\u043E\u043D\u0443\u0441\u0430" });
    }
  });
  app.post("/api/promo/activate", async (req, res) => {
    try {
      const { userId, code } = req.body;
      const uid = Number(userId);
      const promoCode = String(code || "").trim().toUpperCase();
      if (!uid) return res.status(400).json({ ok: false, error: "User ID is required" });
      if (!promoCode) return res.status(400).json({ ok: false, error: "\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043F\u0440\u043E\u043C\u043E\u043A\u043E\u0434" });
      const promoResult = runTransaction((db) => {
        const alreadyUsed = db.prepare("SELECT 1 FROM user_promocodes WHERE user_id = ? AND code = ?").get(uid, promoCode);
        if (alreadyUsed) {
          throw new Error("\u0412\u044B \u0443\u0436\u0435 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u043B\u0438 \u044D\u0442\u043E\u0442 \u043F\u0440\u043E\u043C\u043E\u043A\u043E\u0434");
        }
        const promo = db.prepare("SELECT amount, uses, max_uses FROM promocodes WHERE code = ?").get(promoCode);
        if (!promo) {
          throw new Error("\u041F\u0440\u043E\u043C\u043E\u043A\u043E\u0434 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D");
        }
        const amount = Number(promo.amount);
        const uses = Number(promo.uses);
        const maxUses = Number(promo.max_uses);
        if (uses >= maxUses) {
          throw new Error("\u041B\u0438\u043C\u0438\u0442 \u043F\u0440\u043E\u043C\u043E\u043A\u043E\u0434\u0430 \u0438\u0441\u0447\u0435\u0440\u043F\u0430\u043D");
        }
        const upd = db.prepare("UPDATE promocodes SET uses = uses + 1 WHERE code = ? AND uses < max_uses").run(promoCode);
        if (upd.changes === 0) {
          throw new Error("\u041B\u0438\u043C\u0438\u0442 \u043F\u0440\u043E\u043C\u043E\u043A\u043E\u0434\u0430 \u0438\u0441\u0447\u0435\u0440\u043F\u0430\u043D");
        }
        db.prepare("INSERT INTO user_promocodes (user_id, code, used_at) VALUES (?, ?, ?)").run(
          uid,
          promoCode,
          Math.floor(Date.now() / 1e3)
        );
        updateUserBalance(db, uid, amount);
        const freshUser = getUser(db, uid);
        return { amount, balance: freshUser.balance };
      });
      return res.json({ ok: true, ...promoResult });
    } catch (err) {
      console.error("Error in /api/promo/activate:", err);
      return res.status(400).json({ ok: false, error: err.message || "\u041E\u0448\u0438\u0431\u043A\u0430 \u0430\u043A\u0442\u0438\u0432\u0430\u0446\u0438\u0438 \u043F\u0440\u043E\u043C\u043E\u043A\u043E\u0434\u0430" });
    }
  });
  app.get("/api/leaderboard", async (req, res) => {
    try {
      const db = getDb();
      const category = String(req.query.category || "turnover");
      let orderField = "total_bets_amount";
      if (category === "games") orderField = "total_games";
      if (category === "wins") orderField = "total_wins";
      const rows = db.prepare(`
        SELECT user_id, username, total_bets_amount, total_games, total_wins
        FROM users
        WHERE is_banned = 0
        ORDER BY ${orderField} DESC LIMIT 15
      `).all();
      const players = rows.map((item) => {
        const totalGames = item.total_games || 0;
        const totalWins = item.total_wins || 0;
        const winrate = totalGames > 0 ? (totalWins / totalGames * 100).toFixed(1) : "0.0";
        return {
          ...item,
          winrate
        };
      });
      return res.json({ ok: true, players, category });
    } catch (err) {
      console.error("Error in /api/leaderboard:", err);
      return res.status(500).json({ ok: false, error: err.message || "\u041E\u0448\u0438\u0431\u043A\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0438 \u0442\u0430\u0431\u043B\u0438\u0446\u044B \u043B\u0438\u0434\u0435\u0440\u043E\u0432" });
    }
  });
  app.get("/api/bot/info", async (_req, res) => {
    const depositUrl = `https://t.me/${BOT_USERNAME}?start=deposit`;
    const withdrawUrl = `https://t.me/${BOT_USERNAME}?start=withdraw`;
    const botUrl = `https://t.me/${BOT_USERNAME}`;
    return res.json({
      ok: true,
      bot: {
        name: "SpindBet",
        username: BOT_USERNAME,
        depositUrl,
        withdrawUrl,
        botUrl,
        usdtRate: 90,
        supportUrl: "https://t.me/winer404",
        channelUrl: "https://t.me/+-KpLp8Bvny43YzYy",
        chatUrl: "https://t.me/+uNALN45BYs9hNmYy",
        notice: "\u041F\u043E\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u0435 \u0438 \u0432\u044B\u0432\u043E\u0434 \u0431\u0430\u043B\u0430\u043D\u0441\u0430 \u043E\u0441\u0443\u0449\u0435\u0441\u0442\u0432\u043B\u044F\u044E\u0442\u0441\u044F \u0438\u0441\u043A\u043B\u044E\u0447\u0438\u0442\u0435\u043B\u044C\u043D\u043E \u0447\u0435\u0440\u0435\u0437 Telegram-\u0431\u043E\u0442\u0430 \u0434\u043B\u044F \u0433\u0430\u0440\u0430\u043D\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u043E\u0439 \u0431\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u043E\u0441\u0442\u0438 \u0438 \u043C\u0433\u043D\u043E\u0432\u0435\u043D\u043D\u044B\u0445 \u0432\u044B\u043F\u043B\u0430\u0442."
      }
    });
  });
  const RED_SET = /* @__PURE__ */ new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  const getNumberColor = (num) => {
    if (num === 0) return "green";
    if (RED_SET.has(num)) return "red";
    return "black";
  };
  app.get("/api/roulette/history", async (_req, res) => {
    try {
      const db = getDb();
      const rows = db.prepare(`
        SELECT result, timestamp FROM provably_fair_rounds 
        WHERE game_name = 'Roulette' AND status = 'revealed'
        ORDER BY id DESC LIMIT 15
      `).all();
      const history = [];
      for (const row of rows) {
        try {
          const parsed = JSON.parse(String(row.result));
          if (typeof parsed.number === "number") {
            history.push({
              number: parsed.number,
              color: parsed.color || getNumberColor(parsed.number)
            });
          }
        } catch {
        }
      }
      if (history.length === 0) {
        const defaults = [14, 2, 0, 19, 32, 7, 26, 11, 35, 17];
        defaults.forEach((num) => history.push({ number: num, color: getNumberColor(num) }));
      }
      return res.json({ ok: true, history });
    } catch (err) {
      console.error("Error in /api/roulette/history:", err);
      return res.status(500).json({ ok: false, error: err.message || "\u041E\u0448\u0438\u0431\u043A\u0430 \u0438\u0441\u0442\u043E\u0440\u0438\u0438 \u0440\u0443\u043B\u0435\u0442\u043A\u0438" });
    }
  });
  app.post("/api/roulette/spin", async (req, res) => {
    try {
      const { userId, bets } = req.body;
      const uid = Number(userId);
      if (!uid) return res.status(400).json({ ok: false, error: "User ID is required" });
      if (!bets || typeof bets !== "object" || Object.keys(bets).length === 0) {
        return res.status(400).json({ ok: false, error: "\u0421\u0434\u0435\u043B\u0430\u0439\u0442\u0435 \u0445\u043E\u0442\u044F \u0431\u044B \u043E\u0434\u043D\u0443 \u0441\u0442\u0430\u0432\u043A\u0443" });
      }
      let totalBet = 0;
      for (const amount of Object.values(bets)) {
        const num = Number(amount) || 0;
        if (num > 0) totalBet += num;
      }
      totalBet = Math.round(totalBet * 100) / 100;
      if (totalBet < 0.01) {
        return res.status(400).json({ ok: false, error: "\u041C\u0438\u043D\u0438\u043C\u0430\u043B\u044C\u043D\u0430\u044F \u0441\u0442\u0430\u0432\u043A\u0430 $0.01" });
      }
      if (totalBet > 500) {
        return res.status(400).json({ ok: false, error: "\u041C\u0430\u043A\u0441\u0438\u043C\u0430\u043B\u044C\u043D\u0430\u044F \u0441\u0443\u043C\u043C\u0430 \u0441\u0442\u0430\u0432\u043E\u043A $500" });
      }
      const spinResult = runTransaction((db) => {
        const user = getUser(db, uid);
        if (user.is_banned) {
          throw new Error("\u0412\u044B \u0437\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043D\u044B \u0432 \u0441\u0438\u0441\u0442\u0435\u043C\u0435");
        }
        const deducted = deductUserBalanceSafe(db, uid, totalBet);
        if (!deducted) {
          throw new Error("\u041D\u0435\u0434\u043E\u0441\u0442\u0430\u0442\u043E\u0447\u043D\u043E \u0441\u0440\u0435\u0434\u0441\u0442\u0432 \u043D\u0430 \u0431\u0430\u043B\u0430\u043D\u0441\u0435");
        }
        const nonce = getNextNonce(db, uid);
        const { server_seed, client_seed, server_seed_hash } = generateSeeds();
        const hmac = crypto2.createHmac("sha256", server_seed);
        hmac.update(`${client_seed}:${nonce}`);
        const hash = hmac.digest("hex");
        const winningNumber = parseInt(hash.substring(0, 8), 16) % 37;
        const winningColor = getNumberColor(winningNumber);
        let totalWin = 0;
        for (const [key, amount] of Object.entries(bets)) {
          const betAmt = Number(amount) || 0;
          if (betAmt <= 0) continue;
          if (key === "red" && winningColor === "red") totalWin += betAmt * 2;
          else if (key === "black" && winningColor === "black") totalWin += betAmt * 2;
          else if (key === "green" && winningNumber === 0) totalWin += betAmt * 14;
          else if (key === "low" && winningNumber >= 1 && winningNumber <= 18) totalWin += betAmt * 2;
          else if (key === "high" && winningNumber >= 19 && winningNumber <= 36) totalWin += betAmt * 2;
          else if (key === "even" && winningNumber > 0 && winningNumber % 2 === 0) totalWin += betAmt * 2;
          else if (key === "odd" && winningNumber > 0 && winningNumber % 2 === 1) totalWin += betAmt * 2;
          else if (key === "dozen1" && winningNumber >= 1 && winningNumber <= 12) totalWin += betAmt * 3;
          else if (key === "dozen2" && winningNumber >= 13 && winningNumber <= 24) totalWin += betAmt * 3;
          else if (key === "dozen3" && winningNumber >= 25 && winningNumber <= 36) totalWin += betAmt * 3;
          else if (key.startsWith("num_")) {
            const directNum = parseInt(key.replace("num_", ""), 10);
            if (directNum === winningNumber) totalWin += betAmt * 36;
          }
        }
        totalWin = Math.round(totalWin * 100) / 100;
        if (totalWin > 0) {
          updateUserBalance(db, uid, totalWin);
        }
        const isWin = totalWin > totalBet;
        updateUserGameStats(db, uid, totalBet, isWin);
        const nowTs = Math.floor(Date.now() / 1e3);
        const resultObj = {
          number: winningNumber,
          color: winningColor,
          totalBet,
          totalWin,
          win: totalWin > 0
        };
        db.prepare(`
          INSERT INTO provably_fair_rounds
          (user_id, game_name, bet_amount, result, server_seed_hash, server_seed, client_seed, nonce, timestamp, status)
          VALUES (?, 'Roulette', ?, ?, ?, ?, ?, ?, ?, 'revealed')
        `).run(
          uid,
          totalBet,
          JSON.stringify(resultObj),
          server_seed_hash,
          server_seed,
          client_seed,
          nonce,
          nowTs
        );
        const freshUser = getUser(db, uid);
        return {
          winningNumber,
          color: winningColor,
          totalBet,
          totalWin,
          balance: freshUser.balance,
          fairness: {
            serverSeed: server_seed,
            serverSeedHash: server_seed_hash,
            clientSeed: client_seed,
            nonce
          }
        };
      });
      return res.json({ ok: true, ...spinResult });
    } catch (err) {
      console.error("Error in /api/roulette/spin:", err);
      return res.status(400).json({ ok: false, error: err.message || "\u041E\u0448\u0438\u0431\u043A\u0430 \u0432\u0440\u0430\u0449\u0435\u043D\u0438\u044F \u0440\u0443\u043B\u0435\u0442\u043A\u0438" });
    }
  });
  const calculateCrashMultiplier = (serverSeed, clientSeed, nonce) => {
    const hmac = crypto2.createHmac("sha256", serverSeed);
    hmac.update(`${clientSeed}:${nonce}:crash`);
    const hash = hmac.digest("hex");
    const h = parseInt(hash.substring(0, 13), 16);
    const e = Math.pow(2, 52);
    if (h % 33 === 0) return 1;
    let point = Math.floor((100 * e - h) / (e - h)) / 100;
    point = Math.max(1, Math.min(500, point));
    return Math.round(point * 100) / 100;
  };
  app.get("/api/crash/history", async (_req, res) => {
    try {
      const db = getDb();
      const rows = db.prepare(`
        SELECT result, timestamp FROM provably_fair_rounds 
        WHERE game_name = 'Crash' AND status = 'revealed'
        ORDER BY id DESC LIMIT 15
      `).all();
      const history = [];
      for (const row of rows) {
        try {
          const parsed = JSON.parse(String(row.result));
          if (typeof parsed.crashPoint === "number") {
            history.push({ crashPoint: parsed.crashPoint });
          }
        } catch {
        }
      }
      if (history.length === 0) {
        [2.15, 1.45, 8.9, 1.02, 3.4, 1.88, 12.5, 1.15, 4.2, 2.05].forEach(
          (cp) => history.push({ crashPoint: cp })
        );
      }
      return res.json({ ok: true, history });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });
  app.post("/api/crash/start", async (req, res) => {
    try {
      const { userId, betAmount } = req.body;
      const uid = Number(userId);
      if (!uid) return res.status(400).json({ ok: false, error: "User ID is required" });
      const bet = Math.round(Number(betAmount) * 100) / 100;
      if (isNaN(bet) || bet < 0.01) return res.status(400).json({ ok: false, error: "\u041C\u0438\u043D\u0438\u043C\u0430\u043B\u044C\u043D\u0430\u044F \u0441\u0442\u0430\u0432\u043A\u0430 $0.01" });
      if (bet > 500) return res.status(400).json({ ok: false, error: "\u041C\u0430\u043A\u0441\u0438\u043C\u0430\u043B\u044C\u043D\u0430\u044F \u0441\u0442\u0430\u0432\u043A\u0430 $500" });
      const startResult = runTransaction((db) => {
        const user = getUser(db, uid);
        if (user.is_banned) throw new Error("\u0412\u044B \u0437\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043D\u044B \u0432 \u0441\u0438\u0441\u0442\u0435\u043C\u0435");
        const existing = db.prepare("SELECT 1 FROM crash_games WHERE user_id = ? AND active = 1").get(uid);
        if (existing) throw new Error("\u0423 \u0432\u0430\u0441 \u0443\u0436\u0435 \u0435\u0441\u0442\u044C \u0430\u043A\u0442\u0438\u0432\u043D\u044B\u0439 \u043F\u043E\u043B\u0451\u0442! \u0417\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u0435 \u0435\u0433\u043E.");
        const deducted = deductUserBalanceSafe(db, uid, bet);
        if (!deducted) throw new Error("\u041D\u0435\u0434\u043E\u0441\u0442\u0430\u0442\u043E\u0447\u043D\u043E \u0441\u0440\u0435\u0434\u0441\u0442\u0432 \u043D\u0430 \u0431\u0430\u043B\u0430\u043D\u0441\u0435");
        const nonce = getNextNonce(db, uid);
        const { server_seed, client_seed, server_seed_hash } = generateSeeds();
        const crashPoint = calculateCrashMultiplier(server_seed, client_seed, nonce);
        const nowTs = Math.floor(Date.now() / 1e3);
        const roundInsert = db.prepare(`
          INSERT INTO provably_fair_rounds
          (user_id, game_name, bet_amount, server_seed_hash, server_seed, client_seed, nonce, timestamp, status)
          VALUES (?, 'Crash', ?, ?, ?, ?, ?, ?, 'pending')
        `).run(uid, bet, server_seed_hash, server_seed, client_seed, nonce, nowTs);
        const roundId = Number(roundInsert.lastInsertRowid);
        db.prepare(`
          INSERT OR REPLACE INTO crash_games
          (user_id, bet_amount, crash_point, start_timestamp, active, round_id)
          VALUES (?, ?, ?, ?, 1, ?)
        `).run(uid, bet, crashPoint, nowTs, roundId);
        const freshUser = getUser(db, uid);
        return {
          roundId,
          betAmount: bet,
          balance: freshUser.balance,
          fairness: {
            serverSeedHash: server_seed_hash,
            clientSeed: client_seed,
            nonce
          }
        };
      });
      return res.json({ ok: true, ...startResult });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message || "\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u0442\u0430\u0440\u0442\u0430 Crash" });
    }
  });
  app.post("/api/crash/cashout", async (req, res) => {
    try {
      const { userId, multiplier } = req.body;
      const uid = Number(userId);
      const mult = Math.round(Number(multiplier) * 100) / 100;
      if (!uid || isNaN(mult) || mult < 1.01) return res.status(400).json({ ok: false, error: "\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 \u043C\u043D\u043E\u0436\u0438\u0442\u0435\u043B\u044C" });
      const cashoutResult = runTransaction((db) => {
        const game = db.prepare("SELECT * FROM crash_games WHERE user_id = ? AND active = 1").get(uid);
        if (!game) throw new Error("\u0410\u043A\u0442\u0438\u0432\u043D\u044B\u0439 \u0440\u0430\u0443\u043D\u0434 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u0438\u043B\u0438 \u0443\u0436\u0435 \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D");
        const betAmount = Number(game.bet_amount);
        const crashPoint = Number(game.crash_point);
        const roundId = Number(game.round_id);
        if (mult > crashPoint) {
          const upd2 = db.prepare("UPDATE crash_games SET active = 0 WHERE user_id = ? AND active = 1").run(uid);
          if (upd2.changes === 0) throw new Error("\u0420\u0430\u0443\u043D\u0434 \u0443\u0436\u0435 \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D");
          updateUserGameStats(db, uid, betAmount, false);
          const roundData2 = db.prepare("SELECT * FROM provably_fair_rounds WHERE id = ?").get(roundId);
          const resultStr2 = JSON.stringify({ crashPoint, win: false, cashedOut: false });
          db.prepare("UPDATE provably_fair_rounds SET result = ?, status = 'revealed' WHERE id = ?").run(resultStr2, roundId);
          const freshUser2 = getUser(db, uid);
          return {
            win: false,
            crashPoint,
            balance: freshUser2.balance,
            fairness: {
              serverSeed: roundData2?.server_seed,
              serverSeedHash: roundData2?.server_seed_hash,
              clientSeed: roundData2?.client_seed,
              nonce: roundData2?.nonce
            }
          };
        }
        const upd = db.prepare("UPDATE crash_games SET active = 0 WHERE user_id = ? AND active = 1").run(uid);
        if (upd.changes === 0) throw new Error("\u0412\u044B\u0438\u0433\u0440\u044B\u0448 \u0443\u0436\u0435 \u0431\u044B\u043B \u0437\u0430\u0447\u0438\u0441\u043B\u0435\u043D");
        const winAmount = Math.round(betAmount * mult * 100) / 100;
        updateUserBalance(db, uid, winAmount);
        updateUserGameStats(db, uid, betAmount, true);
        const roundData = db.prepare("SELECT * FROM provably_fair_rounds WHERE id = ?").get(roundId);
        const resultStr = JSON.stringify({ crashPoint, multiplier: mult, winAmount, win: true, cashedOut: true });
        db.prepare("UPDATE provably_fair_rounds SET result = ?, status = 'revealed' WHERE id = ?").run(resultStr, roundId);
        const freshUser = getUser(db, uid);
        return {
          win: true,
          winAmount,
          multiplier: mult,
          crashPoint,
          balance: freshUser.balance,
          fairness: {
            serverSeed: roundData?.server_seed,
            serverSeedHash: roundData?.server_seed_hash,
            clientSeed: roundData?.client_seed,
            nonce: roundData?.nonce
          }
        };
      });
      return res.json({ ok: true, ...cashoutResult });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message || "\u041E\u0448\u0438\u0431\u043A\u0430 \u0432\u044B\u0432\u043E\u0434\u0430 Crash" });
    }
  });
  app.post("/api/crash/finish", async (req, res) => {
    try {
      const { userId } = req.body;
      const uid = Number(userId);
      if (!uid) return res.status(400).json({ ok: false, error: "User ID required" });
      const finishResult = runTransaction((db) => {
        const game = db.prepare("SELECT * FROM crash_games WHERE user_id = ? AND active = 1").get(uid);
        if (!game) return { active: false };
        const betAmount = Number(game.bet_amount);
        const crashPoint = Number(game.crash_point);
        const roundId = Number(game.round_id);
        const upd = db.prepare("UPDATE crash_games SET active = 0 WHERE user_id = ? AND active = 1").run(uid);
        if (upd.changes > 0) {
          updateUserGameStats(db, uid, betAmount, false);
          const roundData = db.prepare("SELECT * FROM provably_fair_rounds WHERE id = ?").get(roundId);
          const resultStr = JSON.stringify({ crashPoint, win: false, cashedOut: false });
          db.prepare("UPDATE provably_fair_rounds SET result = ?, status = 'revealed' WHERE id = ?").run(resultStr, roundId);
          const freshUser = getUser(db, uid);
          return {
            crashPoint,
            balance: freshUser.balance,
            fairness: {
              serverSeed: roundData?.server_seed,
              serverSeedHash: roundData?.server_seed_hash,
              clientSeed: roundData?.client_seed,
              nonce: roundData?.nonce
            }
          };
        }
        return { active: false };
      });
      return res.json({ ok: true, ...finishResult });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  });
  app.post("/api/dice/roll", async (req, res) => {
    try {
      const { userId, betAmount, betType, targetNumber } = req.body;
      const uid = Number(userId);
      if (!uid) return res.status(400).json({ ok: false, error: "User ID is required" });
      const bet = Math.round(Number(betAmount) * 100) / 100;
      if (isNaN(bet) || bet < 0.01) return res.status(400).json({ ok: false, error: "\u041C\u0438\u043D\u0438\u043C\u0430\u043B\u044C\u043D\u0430\u044F \u0441\u0442\u0430\u0432\u043A\u0430 $0.01" });
      if (bet > 500) return res.status(400).json({ ok: false, error: "\u041C\u0430\u043A\u0441\u0438\u043C\u0430\u043B\u044C\u043D\u0430\u044F \u0441\u0442\u0430\u0432\u043A\u0430 $500" });
      const rollResult = runTransaction((db) => {
        const user = getUser(db, uid);
        if (user.is_banned) throw new Error("\u0412\u044B \u0437\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043D\u044B \u0432 \u0441\u0438\u0441\u0442\u0435\u043C\u0435");
        const deducted = deductUserBalanceSafe(db, uid, bet);
        if (!deducted) throw new Error("\u041D\u0435\u0434\u043E\u0441\u0442\u0430\u0442\u043E\u0447\u043D\u043E \u0441\u0440\u0435\u0434\u0441\u0442\u0432 \u043D\u0430 \u0431\u0430\u043B\u0430\u043D\u0441\u0435");
        const nonce = getNextNonce(db, uid);
        const { server_seed, client_seed, server_seed_hash } = generateSeeds();
        const hmac = crypto2.createHmac("sha256", server_seed);
        hmac.update(`${client_seed}:${nonce}:dice`);
        const hash = hmac.digest("hex");
        const diceValue = parseInt(hash.substring(0, 8), 16) % 6 + 1;
        const sliderValue = parseInt(hash.substring(8, 16), 16) % 100 + 1;
        let won = false;
        let multiplier = 0;
        if (betType === "exact") {
          const target = Number(targetNumber);
          multiplier = 5.85;
          won = diceValue === target;
        } else if (betType === "under") {
          multiplier = 1.96;
          won = diceValue <= 3;
        } else if (betType === "over") {
          multiplier = 1.96;
          won = diceValue >= 4;
        } else if (betType === "even") {
          multiplier = 1.96;
          won = diceValue % 2 === 0;
        } else if (betType === "odd") {
          multiplier = 1.96;
          won = diceValue % 2 === 1;
        } else {
          multiplier = 1.96;
          won = diceValue >= 4;
        }
        const winAmount = won ? Math.round(bet * multiplier * 100) / 100 : 0;
        if (won && winAmount > 0) {
          updateUserBalance(db, uid, winAmount);
          updateUserGameStats(db, uid, bet, true);
        } else {
          updateUserGameStats(db, uid, bet, false);
        }
        const nowTs = Math.floor(Date.now() / 1e3);
        const resultStr = JSON.stringify({ diceValue, sliderValue, betType, winAmount, won });
        db.prepare(`
          INSERT INTO provably_fair_rounds
          (user_id, game_name, bet_amount, result, server_seed_hash, server_seed, client_seed, nonce, timestamp, status)
          VALUES (?, 'Dice', ?, ?, ?, ?, ?, ?, ?, 'revealed')
        `).run(uid, bet, resultStr, server_seed_hash, server_seed, client_seed, nonce, nowTs);
        const freshUser = getUser(db, uid);
        return {
          diceValue,
          sliderValue,
          won,
          winAmount,
          multiplier,
          balance: freshUser.balance,
          fairness: {
            serverSeed: server_seed,
            serverSeedHash: server_seed_hash,
            clientSeed: client_seed,
            nonce
          }
        };
      });
      return res.json({ ok: true, ...rollResult });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message || "\u041E\u0448\u0438\u0431\u043A\u0430 \u0431\u0440\u043E\u0441\u043A\u0430 \u043A\u0443\u0431\u0438\u043A\u0430" });
    }
  });
  app.post("/api/coinflip/flip", async (req, res) => {
    try {
      const { userId, betAmount, chosenSide } = req.body;
      const uid = Number(userId);
      const side = String(chosenSide || "heads").toLowerCase();
      if (!uid) return res.status(400).json({ ok: false, error: "User ID is required" });
      if (side !== "heads" && side !== "tails") return res.status(400).json({ ok: false, error: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0441\u0442\u043E\u0440\u043E\u043D\u0443: \u041E\u0440\u0451\u043B \u0438\u043B\u0438 \u0420\u0435\u0448\u043A\u0430" });
      const bet = Math.round(Number(betAmount) * 100) / 100;
      if (isNaN(bet) || bet < 0.01) return res.status(400).json({ ok: false, error: "\u041C\u0438\u043D\u0438\u043C\u0430\u043B\u044C\u043D\u0430\u044F \u0441\u0442\u0430\u0432\u043A\u0430 $0.01" });
      if (bet > 500) return res.status(400).json({ ok: false, error: "\u041C\u0430\u043A\u0441\u0438\u043C\u0430\u043B\u044C\u043D\u0430\u044F \u0441\u0442\u0430\u0432\u043A\u0430 $500" });
      const flipResult = runTransaction((db) => {
        const user = getUser(db, uid);
        if (user.is_banned) throw new Error("\u0412\u044B \u0437\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043D\u044B \u0432 \u0441\u0438\u0441\u0442\u0435\u043C\u0435");
        const deducted = deductUserBalanceSafe(db, uid, bet);
        if (!deducted) throw new Error("\u041D\u0435\u0434\u043E\u0441\u0442\u0430\u0442\u043E\u0447\u043D\u043E \u0441\u0440\u0435\u0434\u0441\u0442\u0432 \u043D\u0430 \u0431\u0430\u043B\u0430\u043D\u0441\u0435");
        const nonce = getNextNonce(db, uid);
        const { server_seed, client_seed, server_seed_hash } = generateSeeds();
        const hmac = crypto2.createHmac("sha256", server_seed);
        hmac.update(`${client_seed}:${nonce}:coinflip`);
        const hash = hmac.digest("hex");
        const outcomeNumber = parseInt(hash.substring(0, 8), 16) % 2;
        const resultSide = outcomeNumber === 0 ? "heads" : "tails";
        const won = side === resultSide;
        const multiplier = 1.96;
        const winAmount = won ? Math.round(bet * multiplier * 100) / 100 : 0;
        if (won && winAmount > 0) {
          updateUserBalance(db, uid, winAmount);
          updateUserGameStats(db, uid, bet, true);
        } else {
          updateUserGameStats(db, uid, bet, false);
        }
        const nowTs = Math.floor(Date.now() / 1e3);
        const resultStr = JSON.stringify({ resultSide, chosenSide: side, winAmount, won });
        db.prepare(`
          INSERT INTO provably_fair_rounds
          (user_id, game_name, bet_amount, result, server_seed_hash, server_seed, client_seed, nonce, timestamp, status)
          VALUES (?, 'Coinflip', ?, ?, ?, ?, ?, ?, ?, 'revealed')
        `).run(uid, bet, resultStr, server_seed_hash, server_seed, client_seed, nonce, nowTs);
        const freshUser = getUser(db, uid);
        return {
          resultSide,
          chosenSide: side,
          won,
          winAmount,
          multiplier,
          balance: freshUser.balance,
          fairness: {
            serverSeed: server_seed,
            serverSeedHash: server_seed_hash,
            clientSeed: client_seed,
            nonce
          }
        };
      });
      return res.json({ ok: true, ...flipResult });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message || "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u043E\u0434\u0431\u0440\u043E\u0441\u0430 \u043C\u043E\u043D\u0435\u0442\u043A\u0438" });
    }
  });
}

// server.ts
var __filename = fileURLToPath(import.meta.url);
var __dirname = path2.dirname(__filename);
function findDistPath() {
  const possiblePaths = [
    path2.resolve(process.cwd(), "dist"),
    path2.resolve(__dirname, "dist"),
    path2.resolve(__dirname, "../dist"),
    path2.resolve(__dirname, "../../dist"),
    path2.resolve(process.cwd(), "build")
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p) && fs.existsSync(path2.join(p, "index.html"))) {
      return p;
    }
  }
  return null;
}
async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3e3;
  app.use(express.json());
  registerApiRoutes(app);
  const distPath = findDistPath();
  if (distPath) {
    console.log(`[SpindBet] Serving production frontend from: ${distPath}`);
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path2.join(distPath, "index.html"));
    });
  } else {
    console.log("[SpindBet] Production dist/index.html not found, starting Vite middleware...");
    try {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa"
      });
      app.use(vite.middlewares);
      console.log("[SpindBet] Vite dynamic middleware successfully mounted.");
    } catch (err) {
      console.error("[SpindBet] Could not start Vite fallback:", err);
      app.get("*", (_req, res) => {
        res.status(500).send(`
          <div style="font-family:system-ui,sans-serif;background:#0d121f;color:#e2e8f0;padding:40px;min-height:100vh;">
            <h2 style="color:#f59e0b;">\u0424\u0430\u0439\u043B\u044B \u0441\u0431\u043E\u0440\u043A\u0438 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B (dist/index.html)</h2>
            <p>\u0412\u044B \u0437\u0430\u043F\u0443\u0441\u0442\u0438\u043B\u0438 \u0441\u0435\u0440\u0432\u0435\u0440, \u043D\u043E \u043F\u0430\u043F\u043A\u0430 <code>dist</code> \u043D\u0435 \u0441\u043E\u0431\u0440\u0430\u043D\u0430.</p>
            <p><strong>\u0420\u0435\u0448\u0435\u043D\u0438\u0435:</strong> \u0432\u044B\u043F\u043E\u043B\u043D\u0438\u0442\u0435 \u0432 \u043A\u043E\u043D\u0441\u043E\u043B\u0438 \u043A\u043E\u043C\u0430\u043D\u0434\u0443 <code>npm run build</code> \u0438 \u043F\u0435\u0440\u0435\u0437\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u0435 \u0441\u0435\u0440\u0432\u0435\u0440.</p>
          </div>
        `);
      });
    }
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`SpindBet Mini App running on http://localhost:${PORT}`);
  });
}
startServer();
