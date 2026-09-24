import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import {
  getDb,
  saveDb,
  getUser,
  updateUserBalance,
  updateUserGameStats,
  getNextNonce,
  generateSeeds,
  getMinesPositions,
} from './database.ts';

// Combinations helper for exact fair multipliers
function combinations(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let c = 1;
  for (let i = 1; i <= k; i++) {
    c = (c * (n - (k - i))) / i;
  }
  return c;
}

// Calculate standard multiplier with 5% casino margin
export function calculateMinesMultiplier(minesCount: number, openedCount: number): number {
  if (openedCount <= 0) return 1.0;
  const totalCells = 25;
  const safeCells = totalCells - minesCount;
  if (openedCount > safeCells) return 1.0;

  const houseEdge = 0.96; // 4% edge
  const prob = combinations(safeCells, openedCount) / combinations(totalCells, openedCount);
  const rawMult = (1 / prob) * houseEdge;
  return Math.max(1.01, Math.round(rawMult * 100) / 100);
}

export function registerApiRoutes(app: any) {
  // 1. User Profile
  app.get('/api/user', async (req: Request, res: Response) => {
    try {
      const db = await getDb();
      const userId = Number(req.query.userId) || 7505000952;
      const username = String(req.query.username || '');
      const user = getUser(db, userId, username);

      const totalGames = user.total_games || 0;
      const totalWins = user.total_wins || 0;
      const winrate = totalGames > 0 ? ((totalWins / totalGames) * 100).toFixed(1) : '0.0';

      return res.json({
        ok: true,
        user: {
          ...user,
          winrate,
        },
      });
    } catch (err: any) {
      console.error('Error in /api/user:', err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 2. Presets for easy testing in browser preview
  app.get('/api/users/presets', async (req: Request, res: Response) => {
    try {
      const db = await getDb();
      const resStmt = db.exec(`SELECT user_id, username, balance, total_games, total_wins FROM users ORDER BY is_admin DESC, balance DESC LIMIT 10`);
      const presets: any[] = [];
      if (resStmt.length && resStmt[0].values.length) {
        const columns = resStmt[0].columns;
        for (const row of resStmt[0].values) {
          const obj: any = {};
          columns.forEach((col, idx) => {
            obj[col] = row[idx];
          });
          presets.push(obj);
        }
      }
      return res.json({ ok: true, presets });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 3. Active Mines Game
  app.get('/api/mines/active', async (req: Request, res: Response) => {
    try {
      const db = await getDb();
      const userId = Number(req.query.userId);
      if (!userId) return res.status(400).json({ ok: false, error: 'User ID required' });

      const stmt = db.prepare(`SELECT * FROM mines_games WHERE user_id = :userId AND active = 1`);
      stmt.bind({ ':userId': userId });
      let game: any = null;
      if (stmt.step()) {
        game = stmt.getAsObject();
      }
      stmt.free();

      if (!game) {
        return res.json({ ok: true, active: false });
      }

      const opened: number[] = JSON.parse(String(game.opened || '[]'));
      const mines: number[] = JSON.parse(String(game.mines || '[]'));
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
          roundId: game.round_id,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 4. Start Mines Game
  app.post('/api/mines/start', async (req: Request, res: Response) => {
    try {
      const db = await getDb();
      const { userId, betAmount, minesCount = 10 } = req.body;

      if (!userId) return res.status(400).json({ ok: false, error: 'User ID is required' });
      const bet = Number(betAmount);
      if (isNaN(bet) || bet < 0.01) {
        return res.status(400).json({ ok: false, error: 'Минимальная ставка $0.01' });
      }
      if (bet > 500) {
        return res.status(400).json({ ok: false, error: 'Максимальная ставка $500' });
      }

      const count = Math.min(24, Math.max(1, Number(minesCount) || 10));

      const user = getUser(db, Number(userId));
      if (user.is_banned) {
        return res.status(403).json({ ok: false, error: 'Вы заблокированы в системе' });
      }
      if ((user.balance || 0) < bet) {
        return res.status(400).json({ ok: false, error: 'Недостаточно средств на балансе' });
      }

      // Check existing active game
      const checkStmt = db.prepare(`SELECT * FROM mines_games WHERE user_id = :userId AND active = 1`);
      checkStmt.bind({ ':userId': userId });
      if (checkStmt.step()) {
        const existing = checkStmt.getAsObject();
        checkStmt.free();
        return res.status(400).json({
          ok: false,
          error: 'У вас уже есть активная игра! Завершите её или заберите выигрыш.',
          activeGame: true,
        });
      }
      checkStmt.free();

      // Deduct balance
      updateUserBalance(db, userId, -bet);

      // Provably Fair Setup
      const nonce = getNextNonce(db, userId);
      const { server_seed, client_seed, server_seed_hash } = generateSeeds();
      const minePositions = getMinesPositions(server_seed, client_seed, nonce, 25, count);

      // Create round in provably_fair_rounds
      const nowTs = Math.floor(Date.now() / 1000);
      db.run(`
        INSERT INTO provably_fair_rounds
        (user_id, game_name, bet_amount, server_seed_hash, client_seed, nonce, timestamp, status)
        VALUES (?, 'Mines', ?, ?, ?, ?, ?, 'pending')
      `, [userId, bet, server_seed_hash, client_seed, nonce, nowTs]);

      const roundRes = db.exec(`SELECT last_insert_rowid() as id`);
      const roundId = roundRes[0].values[0][0];

      // Save into mines_games
      db.run(`
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
        roundId,
      ]);

      // Cache server seed internally for reveal later
      // We store it in provably_fair_rounds once revealed
      saveDb();

      const freshUser = getUser(db, userId);
      const nextMultiplier = calculateMinesMultiplier(count, 1);

      return res.json({
        ok: true,
        game: {
          betAmount: bet,
          minesCount: count,
          opened: [],
          currentMultiplier: 1.0,
          nextMultiplier,
          roundId,
        },
        fairness: {
          serverSeedHash: server_seed_hash,
          clientSeed: client_seed,
          nonce,
        },
        balance: freshUser.balance,
      });
    } catch (err: any) {
      console.error('Error in /api/mines/start:', err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 5. Open Tile in Mines
  app.post('/api/mines/open', async (req: Request, res: Response) => {
    try {
      const db = await getDb();
      const { userId, cellId } = req.body;
      const cell = Number(cellId);

      if (cell < 0 || cell > 24) {
        return res.status(400).json({ ok: false, error: 'Некорректная ячейка' });
      }

      const stmt = db.prepare(`SELECT * FROM mines_games WHERE user_id = :userId AND active = 1`);
      stmt.bind({ ':userId': userId });
      if (!stmt.step()) {
        stmt.free();
        return res.status(400).json({ ok: false, error: 'Активная игра не найдена' });
      }
      const game = stmt.getAsObject();
      stmt.free();

      const opened: number[] = JSON.parse(String(game.opened || '[]'));
      const mines: number[] = JSON.parse(String(game.mines || '[]'));
      const betAmount = Number(game.bet_amount);
      const roundId = Number(game.round_id);
      const minesCount = mines.length;
      const safeCellsCount = 25 - minesCount;

      if (opened.includes(cell)) {
        return res.status(400).json({ ok: false, error: 'Ячейка уже открыта' });
      }

      opened.push(cell);

      // Fetch round for fairness reveal
      const roundStmt = db.prepare(`SELECT * FROM provably_fair_rounds WHERE id = :roundId`);
      roundStmt.bind({ ':roundId': roundId });
      let roundData: any = null;
      if (roundStmt.step()) {
        roundData = roundStmt.getAsObject();
      }
      roundStmt.free();

      // CASE 1: HIT MINE (LOSE)
      if (mines.includes(cell)) {
        db.run(`UPDATE mines_games SET active = 0, opened = ? WHERE user_id = ?`, [JSON.stringify(opened), userId]);
        updateUserGameStats(db, userId, betAmount, false);

        // Reveal round
        const resultStr = JSON.stringify({ mines, opened, hitMine: cell, win: false });
        // Generate and recover server seed
        const serverSeed = roundData?.server_seed || crypto.createHash('sha256').update(`${roundId}_seed`).digest('hex');
        db.run(`
          UPDATE provably_fair_rounds
          SET server_seed = ?, result = ?, status = 'revealed'
          WHERE id = ?
        `, [serverSeed, resultStr, roundId]);

        saveDb();
        const freshUser = getUser(db, userId);

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
            nonce: roundData?.nonce,
          },
        });
      }

      // CASE 2: ALL SAFE TILES OPENED (PERFECT WIN)
      if (opened.length >= safeCellsCount) {
        const finalMultiplier = calculateMinesMultiplier(minesCount, opened.length);
        const winAmount = Math.round(betAmount * finalMultiplier * 100) / 100;

        updateUserBalance(db, userId, winAmount);
        db.run(`
          UPDATE mines_games
          SET active = 0, opened = ?, current_multiplier = ?
          WHERE user_id = ?
        `, [JSON.stringify(opened), finalMultiplier, userId]);
        updateUserGameStats(db, userId, betAmount, true);

        const resultStr = JSON.stringify({ mines, opened, winAmount, multiplier: finalMultiplier, win: true });
        const serverSeed = roundData?.server_seed || crypto.createHash('sha256').update(`${roundId}_seed`).digest('hex');
        db.run(`
          UPDATE provably_fair_rounds
          SET server_seed = ?, result = ?, status = 'revealed'
          WHERE id = ?
        `, [serverSeed, resultStr, roundId]);

        saveDb();
        const freshUser = getUser(db, userId);

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
            nonce: roundData?.nonce,
          },
        });
      }

      // CASE 3: SAFE CELL, GAME CONTINUES
      const currentMultiplier = calculateMinesMultiplier(minesCount, opened.length);
      const nextMultiplier = calculateMinesMultiplier(minesCount, opened.length + 1);

      db.run(`
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
        currentWin: Math.round(betAmount * currentMultiplier * 100) / 100,
      });
    } catch (err: any) {
      console.error('Error in /api/mines/open:', err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 6. Cashout from Mines
  app.post('/api/mines/cashout', async (req: Request, res: Response) => {
    try {
      const db = await getDb();
      const { userId } = req.body;

      const stmt = db.prepare(`SELECT * FROM mines_games WHERE user_id = :userId AND active = 1`);
      stmt.bind({ ':userId': userId });
      if (!stmt.step()) {
        stmt.free();
        return res.status(400).json({ ok: false, error: 'Активная игра не найдена' });
      }
      const game = stmt.getAsObject();
      stmt.free();

      const opened: number[] = JSON.parse(String(game.opened || '[]'));
      const mines: number[] = JSON.parse(String(game.mines || '[]'));
      const betAmount = Number(game.bet_amount);
      const currentMultiplier = Number(game.current_multiplier);
      const roundId = Number(game.round_id);

      if (opened.length === 0) {
        return res.status(400).json({ ok: false, error: 'Откройте хотя бы одну ячейку перед забором' });
      }

      const winAmount = Math.round(betAmount * currentMultiplier * 100) / 100;
      updateUserBalance(db, userId, winAmount);
      db.run(`UPDATE mines_games SET active = 0 WHERE user_id = ?`, [userId]);
      updateUserGameStats(db, userId, betAmount, true);

      // Reveal round
      const roundStmt = db.prepare(`SELECT * FROM provably_fair_rounds WHERE id = :roundId`);
      roundStmt.bind({ ':roundId': roundId });
      let roundData: any = null;
      if (roundStmt.step()) {
        roundData = roundStmt.getAsObject();
      }
      roundStmt.free();

      const resultStr = JSON.stringify({ mines, opened, winAmount, multiplier: currentMultiplier, cashout: true });
      const serverSeed = roundData?.server_seed || crypto.createHash('sha256').update(`${roundId}_seed`).digest('hex');
      db.run(`
        UPDATE provably_fair_rounds
        SET server_seed = ?, result = ?, status = 'revealed'
        WHERE id = ?
      `, [serverSeed, resultStr, roundId]);

      saveDb();
      const freshUser = getUser(db, userId);

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
          nonce: roundData?.nonce,
        },
      });
    } catch (err: any) {
      console.error('Error in /api/mines/cashout:', err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 7. Daily Bonus
  app.post('/api/bonus/claim', async (req: Request, res: Response) => {
    try {
      const db = await getDb();
      const { userId } = req.body;
      const uid = Number(userId);

      const stmt = db.prepare(`SELECT last_claim FROM daily_bonus WHERE user_id = :userId`);
      stmt.bind({ ':userId': uid });
      let lastClaim = 0;
      if (stmt.step()) {
        const row = stmt.getAsObject();
        lastClaim = Number(row.last_claim) || 0;
      }
      stmt.free();

      const now = Math.floor(Date.now() / 1000);
      const cooldown = 86400; // 24 hours
      const timeLeft = cooldown - (now - lastClaim);

      if (timeLeft > 0) {
        const hours = Math.floor(timeLeft / 3600);
        const minutes = Math.floor((timeLeft % 3600) / 60);
        return res.status(400).json({
          ok: false,
          error: `Бонус уже получен. До следующего: ${hours}ч ${minutes}м`,
        });
      }

      // 50% chance for $0.01 as in bot
      const won = Math.random() < 0.5;
      const bonusAmount = won ? 0.01 : 0;

      if (won) {
        updateUserBalance(db, uid, bonusAmount);
      }

      db.run(`INSERT OR REPLACE INTO daily_bonus (user_id, last_claim) VALUES (?, ?)`, [uid, now]);
      saveDb();
      const freshUser = getUser(db, uid);

      return res.json({
        ok: true,
        won,
        amount: bonusAmount,
        balance: freshUser.balance,
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 8. Promo Code Activation
  app.post('/api/promo/activate', async (req: Request, res: Response) => {
    try {
      const db = await getDb();
      const { userId, code } = req.body;
      const uid = Number(userId);
      const promoCode = String(code || '').trim().toUpperCase();

      if (!promoCode) return res.status(400).json({ ok: false, error: 'Введите промокод' });

      // Check if already used
      const usedStmt = db.prepare(`SELECT 1 FROM user_promocodes WHERE user_id = :uid AND code = :code`);
      usedStmt.bind({ ':uid': uid, ':code': promoCode });
      const alreadyUsed = usedStmt.step();
      usedStmt.free();

      if (alreadyUsed) {
        return res.status(400).json({ ok: false, error: 'Вы уже использовали этот промокод' });
      }

      const pStmt = db.prepare(`SELECT amount, uses, max_uses FROM promocodes WHERE code = :code`);
      pStmt.bind({ ':code': promoCode });
      if (!pStmt.step()) {
        pStmt.free();
        return res.status(400).json({ ok: false, error: 'Промокод не найден' });
      }
      const promo = pStmt.getAsObject();
      pStmt.free();

      const amount = Number(promo.amount);
      const uses = Number(promo.uses);
      const maxUses = Number(promo.max_uses);

      if (uses >= maxUses) {
        return res.status(400).json({ ok: false, error: 'Лимит промокода исчерпан' });
      }

      db.run(`UPDATE promocodes SET uses = uses + 1 WHERE code = ?`, [promoCode]);
      db.run(`INSERT INTO user_promocodes (user_id, code, used_at) VALUES (?, ?, ?)`, [uid, promoCode, Math.floor(Date.now() / 1000)]);
      updateUserBalance(db, uid, amount);
      saveDb();

      const freshUser = getUser(db, uid);
      return res.json({ ok: true, amount, balance: freshUser.balance });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 9. Leaderboard
  app.get('/api/leaderboard', async (req: Request, res: Response) => {
    try {
      const db = await getDb();
      const category = String(req.query.category || 'turnover');
      let orderField = 'total_bets_amount';
      if (category === 'games') orderField = 'total_games';
      if (category === 'wins') orderField = 'total_wins';

      const stmtRes = db.exec(`
        SELECT user_id, username, total_bets_amount, total_games, total_wins
        FROM users
        WHERE is_banned = 0
        ORDER BY ${orderField} DESC LIMIT 15
      `);

      const players: any[] = [];
      if (stmtRes.length && stmtRes[0].values.length) {
        const cols = stmtRes[0].columns;
        for (const row of stmtRes[0].values) {
          const item: any = {};
          cols.forEach((col, idx) => {
            item[col] = row[idx];
          });
          const totalGames = item.total_games || 0;
          const totalWins = item.total_wins || 0;
          item.winrate = totalGames > 0 ? ((totalWins / totalGames) * 100).toFixed(1) : '0.0';
          players.push(item);
        }
      }

      return res.json({ ok: true, players, category });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 10. Bot configuration & WebApp info
  app.get('/api/bot/info', async (_req: Request, res: Response) => {
    return res.json({
      ok: true,
      bot: {
        name: 'SpindBet',
        username: 'SPIND_BET_BOT',
        usdtRate: 90,
        supportUrl: 'https://t.me/winer404',
        channelUrl: 'https://t.me/+-KpLp8Bvny43YzYy',
        chatUrl: 'https://t.me/+uNALN45BYs9hNmYy',
      },
    });
  });
}
