// server.ts
import express from "express";
import path2 from "node:path";
import fs2 from "node:fs";
import { fileURLToPath } from "node:url";

// src/server/api.ts
import crypto2 from "node:crypto";

// src/server/database.ts
import initSqlJs from "sql.js";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
var DB_PATH = path.resolve(process.cwd(), "casino.db");
var db = null;
var SQLInstance = null;
async function getDb() {
  if (db) return db;
  if (!SQLInstance) {
    SQLInstance = await initSqlJs();
  }
  if (fs.existsSync(DB_PATH)) {
    try {
      const filebuffer = fs.readFileSync(DB_PATH);
      db = new SQLInstance.Database(filebuffer);
    } catch (e) {
      console.error("Error reading existing casino.db, initializing new:", e);
      db = new SQLInstance.Database();
    }
  } else {
    db = new SQLInstance.Database();
  }
  initDatabaseTables(db);
  saveDb();
  return db;
}
function saveDb() {
  if (!db) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  } catch (err) {
    console.error("Error saving casino.db:", err);
  }
}
function initDatabaseTables(database) {
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
  const adminId = 7505000952;
  const adminRes = database.exec(`SELECT user_id FROM users WHERE user_id = ${adminId}`);
  if (!adminRes.length || !adminRes[0].values.length) {
    const nowStr = (/* @__PURE__ */ new Date()).toLocaleDateString("ru-RU");
    const nowTs = Math.floor(Date.now() / 1e3);
    database.run(`
      INSERT INTO users (user_id, username, balance, registration_date, is_admin, is_banned, reg_timestamp)
      VALUES (${adminId}, 'winer404', 100.0, '${nowStr}', 1, 0, ${nowTs});
    `);
  }
  const demoId = 9990001;
  const demoRes = database.exec(`SELECT user_id FROM users WHERE user_id = ${demoId}`);
  if (!demoRes.length || !demoRes[0].values.length) {
    const nowStr = (/* @__PURE__ */ new Date()).toLocaleDateString("ru-RU");
    const nowTs = Math.floor(Date.now() / 1e3);
    database.run(`
      INSERT INTO users (user_id, username, balance, registration_date, is_admin, is_banned, reg_timestamp)
      VALUES (${demoId}, 'demo_player', 25.0, '${nowStr}', 0, 0, ${nowTs});
    `);
  }
  const stats = ["total_deposits", "total_withdrawals", "total_referral_payouts", "total_paid_out", "total_players"];
  for (const s of stats) {
    database.run(`INSERT OR IGNORE INTO stats (key, value) VALUES ('${s}', 0)`);
  }
}
function getUser(database, userId, username = "") {
  const stmt = database.prepare(`SELECT * FROM users WHERE user_id = :userId`);
  stmt.bind({ ":userId": userId });
  let user = null;
  if (stmt.step()) {
    user = stmt.getAsObject();
  }
  stmt.free();
  if (!user) {
    const nowStr = (/* @__PURE__ */ new Date()).toLocaleDateString("ru-RU");
    const nowTs = Math.floor(Date.now() / 1e3);
    database.run(`
      INSERT INTO users (user_id, username, balance, registration_date, reg_timestamp)
      VALUES (?, ?, 10.0, ?, ?)
    `, [userId, username || `user_${userId}`, nowStr, nowTs]);
    database.run(`UPDATE stats SET value = value + 1 WHERE key = 'total_players'`);
    saveDb();
    const stmt2 = database.prepare(`SELECT * FROM users WHERE user_id = :userId`);
    stmt2.bind({ ":userId": userId });
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
function updateUserBalance(database, userId, amount) {
  database.run(`UPDATE users SET balance = balance + ? WHERE user_id = ?`, [amount, userId]);
  saveDb();
}
function updateUserGameStats(database, userId, betAmount, win) {
  database.run(`
    UPDATE users SET 
      total_games = total_games + 1, 
      total_bets_amount = total_bets_amount + ?,
      total_wins = total_wins + ?
    WHERE user_id = ?
  `, [betAmount, win ? 1 : 0, userId]);
  saveDb();
}
function getNextNonce(database, userId) {
  database.run(`UPDATE users SET provably_fair_nonce = provably_fair_nonce + 1 WHERE user_id = ?`, [userId]);
  const stmt = database.prepare(`SELECT provably_fair_nonce FROM users WHERE user_id = :userId`);
  stmt.bind({ ":userId": userId });
  let nonce = 1;
  if (stmt.step()) {
    const row = stmt.getAsObject();
    nonce = Number(row.provably_fair_nonce) || 1;
  }
  stmt.free();
  saveDb();
  return nonce;
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
function registerApiRoutes(app) {
  app.get("/api/user", async (req, res) => {
    try {
      const db2 = await getDb();
      const userId = Number(req.query.userId) || 7505000952;
      const username = String(req.query.username || "");
      const user = getUser(db2, userId, username);
      const totalGames = user.total_games || 0;
      const totalWins = user.total_wins || 0;
      const winrate = totalGames > 0 ? (totalWins / totalGames * 100).toFixed(1) : "0.0";
      return res.json({
        ok: true,
        user: {
          ...user,
          winrate
        }
      });
    } catch (err) {
      console.error("Error in /api/user:", err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });
  app.get("/api/users/presets", async (req, res) => {
    try {
      const db2 = await getDb();
      const resStmt = db2.exec(`SELECT user_id, username, balance, total_games, total_wins FROM users ORDER BY is_admin DESC, balance DESC LIMIT 10`);
      const presets = [];
      if (resStmt.length && resStmt[0].values.length) {
        const columns = resStmt[0].columns;
        for (const row of resStmt[0].values) {
          const obj = {};
          columns.forEach((col, idx) => {
            obj[col] = row[idx];
          });
          presets.push(obj);
        }
      }
      return res.json({ ok: true, presets });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });
  app.get("/api/mines/active", async (req, res) => {
    try {
      const db2 = await getDb();
      const userId = Number(req.query.userId);
      if (!userId) return res.status(400).json({ ok: false, error: "User ID required" });
      const stmt = db2.prepare(`SELECT * FROM mines_games WHERE user_id = :userId AND active = 1`);
      stmt.bind({ ":userId": userId });
      let game = null;
      if (stmt.step()) {
        game = stmt.getAsObject();
      }
      stmt.free();
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
          betAmount: game.bet_amount,
          minesCount,
          opened,
          currentMultiplier: game.current_multiplier,
          nextMultiplier,
          roundId: game.round_id
        }
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });
  app.post("/api/mines/start", async (req, res) => {
    try {
      const db2 = await getDb();
      const { userId, betAmount, minesCount = 10 } = req.body;
      if (!userId) return res.status(400).json({ ok: false, error: "User ID is required" });
      const bet = Number(betAmount);
      if (isNaN(bet) || bet < 0.01) {
        return res.status(400).json({ ok: false, error: "\u041C\u0438\u043D\u0438\u043C\u0430\u043B\u044C\u043D\u0430\u044F \u0441\u0442\u0430\u0432\u043A\u0430 $0.01" });
      }
      if (bet > 500) {
        return res.status(400).json({ ok: false, error: "\u041C\u0430\u043A\u0441\u0438\u043C\u0430\u043B\u044C\u043D\u0430\u044F \u0441\u0442\u0430\u0432\u043A\u0430 $500" });
      }
      const count = Math.min(24, Math.max(1, Number(minesCount) || 10));
      const user = getUser(db2, Number(userId));
      if (user.is_banned) {
        return res.status(403).json({ ok: false, error: "\u0412\u044B \u0437\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043D\u044B \u0432 \u0441\u0438\u0441\u0442\u0435\u043C\u0435" });
      }
      if ((user.balance || 0) < bet) {
        return res.status(400).json({ ok: false, error: "\u041D\u0435\u0434\u043E\u0441\u0442\u0430\u0442\u043E\u0447\u043D\u043E \u0441\u0440\u0435\u0434\u0441\u0442\u0432 \u043D\u0430 \u0431\u0430\u043B\u0430\u043D\u0441\u0435" });
      }
      const checkStmt = db2.prepare(`SELECT * FROM mines_games WHERE user_id = :userId AND active = 1`);
      checkStmt.bind({ ":userId": userId });
      if (checkStmt.step()) {
        const existing = checkStmt.getAsObject();
        checkStmt.free();
        return res.status(400).json({
          ok: false,
          error: "\u0423 \u0432\u0430\u0441 \u0443\u0436\u0435 \u0435\u0441\u0442\u044C \u0430\u043A\u0442\u0438\u0432\u043D\u0430\u044F \u0438\u0433\u0440\u0430! \u0417\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u0435 \u0435\u0451 \u0438\u043B\u0438 \u0437\u0430\u0431\u0435\u0440\u0438\u0442\u0435 \u0432\u044B\u0438\u0433\u0440\u044B\u0448.",
          activeGame: true
        });
      }
      checkStmt.free();
      updateUserBalance(db2, userId, -bet);
      const nonce = getNextNonce(db2, userId);
      const { server_seed, client_seed, server_seed_hash } = generateSeeds();
      const minePositions = getMinesPositions(server_seed, client_seed, nonce, 25, count);
      const nowTs = Math.floor(Date.now() / 1e3);
      db2.run(`
        INSERT INTO provably_fair_rounds
        (user_id, game_name, bet_amount, server_seed_hash, client_seed, nonce, timestamp, status)
        VALUES (?, 'Mines', ?, ?, ?, ?, ?, 'pending')
      `, [userId, bet, server_seed_hash, client_seed, nonce, nowTs]);
      const roundRes = db2.exec(`SELECT last_insert_rowid() as id`);
      const roundId = roundRes[0].values[0][0];
      db2.run(`
        INSERT OR REPLACE INTO mines_games
        (user_id, field, mines, opened, bet_amount, current_multiplier, active, timestamp, round_id)
        VALUES (?, ?, ?, ?, ?, 1.0, 1, ?, ?)
      `, [
        userId,
        JSON.stringify(Array.from({ length: 25 }, (_, i) => i)),
        JSON.stringify(minePositions),
        JSON.stringify([]),
        bet,
        nowTs,
        roundId
      ]);
      saveDb();
      const freshUser = getUser(db2, userId);
      const nextMultiplier = calculateMinesMultiplier(count, 1);
      return res.json({
        ok: true,
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
      });
    } catch (err) {
      console.error("Error in /api/mines/start:", err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });
  app.post("/api/mines/open", async (req, res) => {
    try {
      const db2 = await getDb();
      const { userId, cellId } = req.body;
      const cell = Number(cellId);
      if (cell < 0 || cell > 24) {
        return res.status(400).json({ ok: false, error: "\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u0430\u044F \u044F\u0447\u0435\u0439\u043A\u0430" });
      }
      const stmt = db2.prepare(`SELECT * FROM mines_games WHERE user_id = :userId AND active = 1`);
      stmt.bind({ ":userId": userId });
      if (!stmt.step()) {
        stmt.free();
        return res.status(400).json({ ok: false, error: "\u0410\u043A\u0442\u0438\u0432\u043D\u0430\u044F \u0438\u0433\u0440\u0430 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430" });
      }
      const game = stmt.getAsObject();
      stmt.free();
      const opened = JSON.parse(String(game.opened || "[]"));
      const mines = JSON.parse(String(game.mines || "[]"));
      const betAmount = Number(game.bet_amount);
      const roundId = Number(game.round_id);
      const minesCount = mines.length;
      const safeCellsCount = 25 - minesCount;
      if (opened.includes(cell)) {
        return res.status(400).json({ ok: false, error: "\u042F\u0447\u0435\u0439\u043A\u0430 \u0443\u0436\u0435 \u043E\u0442\u043A\u0440\u044B\u0442\u0430" });
      }
      opened.push(cell);
      const roundStmt = db2.prepare(`SELECT * FROM provably_fair_rounds WHERE id = :roundId`);
      roundStmt.bind({ ":roundId": roundId });
      let roundData = null;
      if (roundStmt.step()) {
        roundData = roundStmt.getAsObject();
      }
      roundStmt.free();
      if (mines.includes(cell)) {
        db2.run(`UPDATE mines_games SET active = 0, opened = ? WHERE user_id = ?`, [JSON.stringify(opened), userId]);
        updateUserGameStats(db2, userId, betAmount, false);
        const resultStr = JSON.stringify({ mines, opened, hitMine: cell, win: false });
        const serverSeed = roundData?.server_seed || crypto2.createHash("sha256").update(`${roundId}_seed`).digest("hex");
        db2.run(`
          UPDATE provably_fair_rounds
          SET server_seed = ?, result = ?, status = 'revealed'
          WHERE id = ?
        `, [serverSeed, resultStr, roundId]);
        saveDb();
        const freshUser = getUser(db2, userId);
        return res.json({
          ok: true,
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
        });
      }
      if (opened.length >= safeCellsCount) {
        const finalMultiplier = calculateMinesMultiplier(minesCount, opened.length);
        const winAmount = Math.round(betAmount * finalMultiplier * 100) / 100;
        updateUserBalance(db2, userId, winAmount);
        db2.run(`
          UPDATE mines_games
          SET active = 0, opened = ?, current_multiplier = ?
          WHERE user_id = ?
        `, [JSON.stringify(opened), finalMultiplier, userId]);
        updateUserGameStats(db2, userId, betAmount, true);
        const resultStr = JSON.stringify({ mines, opened, winAmount, multiplier: finalMultiplier, win: true });
        const serverSeed = roundData?.server_seed || crypto2.createHash("sha256").update(`${roundId}_seed`).digest("hex");
        db2.run(`
          UPDATE provably_fair_rounds
          SET server_seed = ?, result = ?, status = 'revealed'
          WHERE id = ?
        `, [serverSeed, resultStr, roundId]);
        saveDb();
        const freshUser = getUser(db2, userId);
        return res.json({
          ok: true,
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
        });
      }
      const currentMultiplier = calculateMinesMultiplier(minesCount, opened.length);
      const nextMultiplier = calculateMinesMultiplier(minesCount, opened.length + 1);
      db2.run(`
        UPDATE mines_games
        SET opened = ?, current_multiplier = ?
        WHERE user_id = ?
      `, [JSON.stringify(opened), currentMultiplier, userId]);
      saveDb();
      return res.json({
        ok: true,
        hitMine: false,
        allCleared: false,
        cellId: cell,
        opened,
        currentMultiplier,
        nextMultiplier,
        currentWin: Math.round(betAmount * currentMultiplier * 100) / 100
      });
    } catch (err) {
      console.error("Error in /api/mines/open:", err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });
  app.post("/api/mines/cashout", async (req, res) => {
    try {
      const db2 = await getDb();
      const { userId } = req.body;
      const stmt = db2.prepare(`SELECT * FROM mines_games WHERE user_id = :userId AND active = 1`);
      stmt.bind({ ":userId": userId });
      if (!stmt.step()) {
        stmt.free();
        return res.status(400).json({ ok: false, error: "\u0410\u043A\u0442\u0438\u0432\u043D\u0430\u044F \u0438\u0433\u0440\u0430 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430" });
      }
      const game = stmt.getAsObject();
      stmt.free();
      const opened = JSON.parse(String(game.opened || "[]"));
      const mines = JSON.parse(String(game.mines || "[]"));
      const betAmount = Number(game.bet_amount);
      const currentMultiplier = Number(game.current_multiplier);
      const roundId = Number(game.round_id);
      if (opened.length === 0) {
        return res.status(400).json({ ok: false, error: "\u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u0445\u043E\u0442\u044F \u0431\u044B \u043E\u0434\u043D\u0443 \u044F\u0447\u0435\u0439\u043A\u0443 \u043F\u0435\u0440\u0435\u0434 \u0437\u0430\u0431\u043E\u0440\u043E\u043C" });
      }
      const winAmount = Math.round(betAmount * currentMultiplier * 100) / 100;
      updateUserBalance(db2, userId, winAmount);
      db2.run(`UPDATE mines_games SET active = 0 WHERE user_id = ?`, [userId]);
      updateUserGameStats(db2, userId, betAmount, true);
      const roundStmt = db2.prepare(`SELECT * FROM provably_fair_rounds WHERE id = :roundId`);
      roundStmt.bind({ ":roundId": roundId });
      let roundData = null;
      if (roundStmt.step()) {
        roundData = roundStmt.getAsObject();
      }
      roundStmt.free();
      const resultStr = JSON.stringify({ mines, opened, winAmount, multiplier: currentMultiplier, cashout: true });
      const serverSeed = roundData?.server_seed || crypto2.createHash("sha256").update(`${roundId}_seed`).digest("hex");
      db2.run(`
        UPDATE provably_fair_rounds
        SET server_seed = ?, result = ?, status = 'revealed'
        WHERE id = ?
      `, [serverSeed, resultStr, roundId]);
      saveDb();
      const freshUser = getUser(db2, userId);
      return res.json({
        ok: true,
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
      });
    } catch (err) {
      console.error("Error in /api/mines/cashout:", err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });
  app.post("/api/bonus/claim", async (req, res) => {
    try {
      const db2 = await getDb();
      const { userId } = req.body;
      const uid = Number(userId);
      const stmt = db2.prepare(`SELECT last_claim FROM daily_bonus WHERE user_id = :userId`);
      stmt.bind({ ":userId": uid });
      let lastClaim = 0;
      if (stmt.step()) {
        const row = stmt.getAsObject();
        lastClaim = Number(row.last_claim) || 0;
      }
      stmt.free();
      const now = Math.floor(Date.now() / 1e3);
      const cooldown = 86400;
      const timeLeft = cooldown - (now - lastClaim);
      if (timeLeft > 0) {
        const hours = Math.floor(timeLeft / 3600);
        const minutes = Math.floor(timeLeft % 3600 / 60);
        return res.status(400).json({
          ok: false,
          error: `\u0411\u043E\u043D\u0443\u0441 \u0443\u0436\u0435 \u043F\u043E\u043B\u0443\u0447\u0435\u043D. \u0414\u043E \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u0433\u043E: ${hours}\u0447 ${minutes}\u043C`
        });
      }
      const won = Math.random() < 0.5;
      const bonusAmount = won ? 0.01 : 0;
      if (won) {
        updateUserBalance(db2, uid, bonusAmount);
      }
      db2.run(`INSERT OR REPLACE INTO daily_bonus (user_id, last_claim) VALUES (?, ?)`, [uid, now]);
      saveDb();
      const freshUser = getUser(db2, uid);
      return res.json({
        ok: true,
        won,
        amount: bonusAmount,
        balance: freshUser.balance
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });
  app.post("/api/promo/activate", async (req, res) => {
    try {
      const db2 = await getDb();
      const { userId, code } = req.body;
      const uid = Number(userId);
      const promoCode = String(code || "").trim().toUpperCase();
      if (!promoCode) return res.status(400).json({ ok: false, error: "\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043F\u0440\u043E\u043C\u043E\u043A\u043E\u0434" });
      const usedStmt = db2.prepare(`SELECT 1 FROM user_promocodes WHERE user_id = :uid AND code = :code`);
      usedStmt.bind({ ":uid": uid, ":code": promoCode });
      const alreadyUsed = usedStmt.step();
      usedStmt.free();
      if (alreadyUsed) {
        return res.status(400).json({ ok: false, error: "\u0412\u044B \u0443\u0436\u0435 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u043B\u0438 \u044D\u0442\u043E\u0442 \u043F\u0440\u043E\u043C\u043E\u043A\u043E\u0434" });
      }
      const pStmt = db2.prepare(`SELECT amount, uses, max_uses FROM promocodes WHERE code = :code`);
      pStmt.bind({ ":code": promoCode });
      if (!pStmt.step()) {
        pStmt.free();
        return res.status(400).json({ ok: false, error: "\u041F\u0440\u043E\u043C\u043E\u043A\u043E\u0434 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D" });
      }
      const promo = pStmt.getAsObject();
      pStmt.free();
      const amount = Number(promo.amount);
      const uses = Number(promo.uses);
      const maxUses = Number(promo.max_uses);
      if (uses >= maxUses) {
        return res.status(400).json({ ok: false, error: "\u041B\u0438\u043C\u0438\u0442 \u043F\u0440\u043E\u043C\u043E\u043A\u043E\u0434\u0430 \u0438\u0441\u0447\u0435\u0440\u043F\u0430\u043D" });
      }
      db2.run(`UPDATE promocodes SET uses = uses + 1 WHERE code = ?`, [promoCode]);
      db2.run(`INSERT INTO user_promocodes (user_id, code, used_at) VALUES (?, ?, ?)`, [uid, promoCode, Math.floor(Date.now() / 1e3)]);
      updateUserBalance(db2, uid, amount);
      saveDb();
      const freshUser = getUser(db2, uid);
      return res.json({ ok: true, amount, balance: freshUser.balance });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });
  app.get("/api/leaderboard", async (req, res) => {
    try {
      const db2 = await getDb();
      const category = String(req.query.category || "turnover");
      let orderField = "total_bets_amount";
      if (category === "games") orderField = "total_games";
      if (category === "wins") orderField = "total_wins";
      const stmtRes = db2.exec(`
        SELECT user_id, username, total_bets_amount, total_games, total_wins
        FROM users
        WHERE is_banned = 0
        ORDER BY ${orderField} DESC LIMIT 15
      `);
      const players = [];
      if (stmtRes.length && stmtRes[0].values.length) {
        const cols = stmtRes[0].columns;
        for (const row of stmtRes[0].values) {
          const item = {};
          cols.forEach((col, idx) => {
            item[col] = row[idx];
          });
          const totalGames = item.total_games || 0;
          const totalWins = item.total_wins || 0;
          item.winrate = totalGames > 0 ? (totalWins / totalGames * 100).toFixed(1) : "0.0";
          players.push(item);
        }
      }
      return res.json({ ok: true, players, category });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });
  app.get("/api/bot/info", async (_req, res) => {
    return res.json({
      ok: true,
      bot: {
        name: "SpindBet",
        username: "SPIND_BET_BOT",
        usdtRate: 90,
        supportUrl: "https://t.me/winer404",
        channelUrl: "https://t.me/+-KpLp8Bvny43YzYy",
        chatUrl: "https://t.me/+uNALN45BYs9hNmYy"
      }
    });
  });
}

// server.ts
var __filename = fileURLToPath(import.meta.url);
var __dirname = path2.dirname(__filename);
async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3e3;
  app.use(express.json());
  registerApiRoutes(app);
  if (process.env.NODE_ENV === "production") {
    const distPath = fs2.existsSync(path2.resolve(process.cwd(), "dist")) ? path2.resolve(process.cwd(), "dist") : path2.resolve(__dirname, "../dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path2.join(distPath, "index.html"));
    });
  } else {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`SpindBet Mini App running on http://localhost:${PORT}`);
  });
}
startServer();
