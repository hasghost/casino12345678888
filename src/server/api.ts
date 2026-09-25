import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import {
  getDb,
  runTransaction,
  getUser,
  updateUserBalance,
  deductUserBalanceSafe,
  updateUserGameStats,
  getNextNonce,
  generateSeeds,
  getMinesPositions,
} from './database.ts';
import { calculateMinesMultiplier } from '../utils/minesMath.ts';
export { calculateMinesMultiplier };

const BOT_USERNAME = process.env.BOT_USERNAME || 'SPIND_BET_BOT';

export function registerApiRoutes(app: any) {
  // 1. User Profile
  app.get('/api/user', async (req: Request, res: Response) => {
    try {
      const db = getDb();
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
          balance: Math.round(Number(user.balance || 0) * 100) / 100,
          referral_balance: Math.round(Number(user.referral_balance || 0) * 100) / 100,
          total_bets_amount: Math.round(Number(user.total_bets_amount || 0) * 100) / 100,
          winrate,
        },
      });
    } catch (err: any) {
      console.error('Error in /api/user:', err);
      return res.status(500).json({ ok: false, error: err.message || 'Ошибка загрузки профиля' });
    }
  });

  // 2. Active Mines Game
  app.get('/api/mines/active', async (req: Request, res: Response) => {
    try {
      const db = getDb();
      const userId = Number(req.query.userId);
      if (!userId) return res.status(400).json({ ok: false, error: 'User ID required' });

      const game = db.prepare('SELECT * FROM mines_games WHERE user_id = ? AND active = 1').get(userId) as any;

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
          betAmount: Number(game.bet_amount),
          minesCount,
          opened,
          currentMultiplier: Number(game.current_multiplier),
          nextMultiplier,
          roundId: Number(game.round_id),
        },
      });
    } catch (err: any) {
      console.error('Error in /api/mines/active:', err);
      return res.status(500).json({ ok: false, error: err.message || 'Ошибка проверки игры' });
    }
  });

  // 3. Start Mines Game (Protected against double start & race conditions)
  app.post('/api/mines/start', async (req: Request, res: Response) => {
    try {
      const { userId, betAmount, minesCount = 10 } = req.body;

      if (!userId) return res.status(400).json({ ok: false, error: 'User ID is required' });
      const bet = Math.round(Number(betAmount) * 100) / 100;
      if (isNaN(bet) || bet < 0.01) {
        return res.status(400).json({ ok: false, error: 'Минимальная ставка $0.01' });
      }
      if (bet > 500) {
        return res.status(400).json({ ok: false, error: 'Максимальная ставка $500' });
      }

      if (Number(minesCount) < 5) {
        return res.status(400).json({ ok: false, error: 'Минимальное количество мин: 5' });
      }
      const count = Math.min(24, Math.max(5, Number(minesCount) || 5));

      const gameResult = runTransaction((db) => {
        const user = getUser(db, Number(userId));
        if (user.is_banned) {
          throw new Error('Вы заблокированы в системе');
        }

        // Check if there is already an active game
        const existing = db.prepare('SELECT 1 FROM mines_games WHERE user_id = ? AND active = 1').get(userId);
        if (existing) {
          const err: any = new Error('У вас уже есть активная игра! Завершите её или заберите выигрыш.');
          err.activeGame = true;
          throw err;
        }

        // Safe atomic balance deduction (checks balance >= bet in same statement)
        const deducted = deductUserBalanceSafe(db, Number(userId), bet);
        if (!deducted) {
          throw new Error('Недостаточно средств на балансе');
        }

        // Provably Fair Setup
        const nonce = getNextNonce(db, Number(userId));
        const { server_seed, client_seed, server_seed_hash } = generateSeeds();
        const minePositions = getMinesPositions(server_seed, client_seed, nonce, 25, count);

        // Create round in provably_fair_rounds
        const nowTs = Math.floor(Date.now() / 1000);
        const roundInsert = db.prepare(`
          INSERT INTO provably_fair_rounds
          (user_id, game_name, bet_amount, server_seed_hash, server_seed, client_seed, nonce, timestamp, status)
          VALUES (?, 'Mines', ?, ?, ?, ?, ?, ?, 'pending')
        `).run(Number(userId), bet, server_seed_hash, server_seed, client_seed, nonce, nowTs);

        const roundId = Number(roundInsert.lastInsertRowid);

        // Save into mines_games
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
        };
      });

      return res.json({ ok: true, ...gameResult });
    } catch (err: any) {
      console.error('Error in /api/mines/start:', err);
      return res.status(400).json({
        ok: false,
        error: err.message || 'Ошибка начала игры',
        activeGame: err.activeGame || false,
      });
    }
  });

  // 4. Open Tile in Mines (Protected against concurrent steps and double win triggers)
  app.post('/api/mines/open', async (req: Request, res: Response) => {
    try {
      const { userId, cellId } = req.body;
      const cell = Number(cellId);
      const uid = Number(userId);

      if (cell < 0 || cell > 24 || isNaN(cell)) {
        return res.status(400).json({ ok: false, error: 'Некорректная ячейка' });
      }

      const openResult = runTransaction((db) => {
        const game = db.prepare('SELECT * FROM mines_games WHERE user_id = ? AND active = 1').get(uid) as any;
        if (!game) {
          throw new Error('Активная игра не найдена');
        }

        const opened: number[] = JSON.parse(String(game.opened || '[]'));
        const mines: number[] = JSON.parse(String(game.mines || '[]'));
        const betAmount = Number(game.bet_amount);
        const roundId = Number(game.round_id);
        const minesCount = mines.length;
        const safeCellsCount = 25 - minesCount;

        if (opened.includes(cell)) {
          throw new Error('Ячейка уже открыта');
        }

        opened.push(cell);

        const roundData = db.prepare('SELECT * FROM provably_fair_rounds WHERE id = ?').get(roundId) as any;

        // CASE 1: HIT MINE (LOSE)
        if (mines.includes(cell)) {
          // Atomic lock: set active = 0
          const upd = db.prepare(`
            UPDATE mines_games 
            SET active = 0, opened = ? 
            WHERE user_id = ? AND active = 1
          `).run(JSON.stringify(opened), uid);

          if (upd.changes === 0) {
            throw new Error('Игра уже была завершена');
          }

          updateUserGameStats(db, uid, betAmount, false);

          const resultStr = JSON.stringify({ mines, opened, hitMine: cell, win: false });
          const serverSeed = roundData?.server_seed || crypto.createHash('sha256').update(`${roundId}_seed`).digest('hex');

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
              nonce: roundData?.nonce,
            },
          };
        }

        // CASE 2: ALL SAFE TILES OPENED (PERFECT WIN)
        if (opened.length >= safeCellsCount) {
          const finalMultiplier = calculateMinesMultiplier(minesCount, opened.length);
          const winAmount = Math.round(betAmount * finalMultiplier * 100) / 100;

          // ATOMIC LOCK: Set active = 0. If changes === 0, another request finished the game!
          const upd = db.prepare(`
            UPDATE mines_games
            SET active = 0, opened = ?, current_multiplier = ?
            WHERE user_id = ? AND active = 1
          `).run(JSON.stringify(opened), finalMultiplier, uid);

          if (upd.changes === 0) {
            throw new Error('Игра уже завершена');
          }

          // Single, safe credit of win amount
          updateUserBalance(db, uid, winAmount);
          updateUserGameStats(db, uid, betAmount, true);

          const resultStr = JSON.stringify({ mines, opened, winAmount, multiplier: finalMultiplier, win: true });
          const serverSeed = roundData?.server_seed || crypto.createHash('sha256').update(`${roundId}_seed`).digest('hex');

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
              nonce: roundData?.nonce,
            },
          };
        }

        // CASE 3: SAFE CELL, GAME CONTINUES
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
          currentWin: Math.round(betAmount * currentMultiplier * 100) / 100,
        };
      });

      return res.json({ ok: true, ...openResult });
    } catch (err: any) {
      console.error('Error in /api/mines/open:', err);
      return res.status(400).json({ ok: false, error: err.message || 'Ошибка открытия ячейки' });
    }
  });

  // 5. Cashout from Mines (PROTECTED AGAINST DOUBLE CASHOUT / DOUBLE ACCRUAL)
  app.post('/api/mines/cashout', async (req: Request, res: Response) => {
    try {
      const { userId } = req.body;
      const uid = Number(userId);

      if (!uid) {
        return res.status(400).json({ ok: false, error: 'User ID is required' });
      }

      const cashoutResult = runTransaction((db) => {
        // 1. Fetch current active game
        const game = db.prepare('SELECT * FROM mines_games WHERE user_id = ? AND active = 1').get(uid) as any;
        if (!game) {
          throw new Error('Активная игра не найдена или уже завершена');
        }

        const opened: number[] = JSON.parse(String(game.opened || '[]'));
        const mines: number[] = JSON.parse(String(game.mines || '[]'));
        const betAmount = Number(game.bet_amount);
        const currentMultiplier = Number(game.current_multiplier);
        const roundId = Number(game.round_id);

        if (opened.length === 0) {
          throw new Error('Откройте хотя бы одну ячейку перед забором');
        }

        // 2. ATOMIC LOCK: Set active = 0 ONLY if active = 1.
        // If two concurrent cashout requests arrive, only ONE will get changes === 1.
        const lockRes = db.prepare(`
          UPDATE mines_games 
          SET active = 0 
          WHERE user_id = ? AND active = 1
        `).run(uid);

        if (lockRes.changes === 0) {
          // Race condition intercepted: double cashout blocked!
          throw new Error('Выигрыш уже был зачислен');
        }

        // 3. Guaranteed single credit
        const winAmount = Math.round(betAmount * currentMultiplier * 100) / 100;
        updateUserBalance(db, uid, winAmount);
        updateUserGameStats(db, uid, betAmount, true);

        // 4. Reveal Provably Fair round
        const roundData = db.prepare('SELECT * FROM provably_fair_rounds WHERE id = ?').get(roundId) as any;
        const resultStr = JSON.stringify({ mines, opened, winAmount, multiplier: currentMultiplier, cashout: true });
        const serverSeed = roundData?.server_seed || crypto.createHash('sha256').update(`${roundId}_seed`).digest('hex');

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
            nonce: roundData?.nonce,
          },
        };
      });

      return res.json({ ok: true, ...cashoutResult });
    } catch (err: any) {
      console.error('Error in /api/mines/cashout:', err);
      return res.status(400).json({ ok: false, error: err.message || 'Ошибка забора выигрыша' });
    }
  });

  // 6. Daily Bonus (Protected against duplicate bonus claim)
  app.post('/api/bonus/claim', async (req: Request, res: Response) => {
    try {
      const { userId } = req.body;
      const uid = Number(userId);

      if (!uid) {
        return res.status(400).json({ ok: false, error: 'User ID is required' });
      }

      const claimResult = runTransaction((db) => {
        const row = db.prepare('SELECT last_claim FROM daily_bonus WHERE user_id = ?').get(uid) as any;
        const lastClaim = row ? Number(row.last_claim) : 0;
        const now = Math.floor(Date.now() / 1000);
        const cooldown = 86400; // 24 hours
        const timeLeft = cooldown - (now - lastClaim);

        if (timeLeft > 0) {
          const hours = Math.floor(timeLeft / 3600);
          const minutes = Math.floor((timeLeft % 3600) / 60);
          throw new Error(`Бонус уже получен. До следующего: ${hours}ч ${minutes}м`);
        }

        // Atomic update or insert
        if (row) {
          const upd = db.prepare(`
            UPDATE daily_bonus 
            SET last_claim = ? 
            WHERE user_id = ? AND (? - last_claim) >= ?
          `).run(now, uid, now, cooldown);
          if (upd.changes === 0) {
            throw new Error('Бонус уже получен');
          }
        } else {
          db.prepare('INSERT INTO daily_bonus (user_id, last_claim) VALUES (?, ?)').run(uid, now);
        }

        // 50% chance for $0.01 as configured in bot
        const won = Math.random() < 0.5;
        const bonusAmount = won ? 0.01 : 0;

        if (won) {
          updateUserBalance(db, uid, bonusAmount);
        }

        const freshUser = getUser(db, uid);
        return {
          won,
          amount: bonusAmount,
          balance: freshUser.balance,
        };
      });

      return res.json({ ok: true, ...claimResult });
    } catch (err: any) {
      console.error('Error in /api/bonus/claim:', err);
      return res.status(400).json({ ok: false, error: err.message || 'Ошибка получения бонуса' });
    }
  });

  // 7. Promo Code Activation (Protected against race conditions & double use)
  app.post('/api/promo/activate', async (req: Request, res: Response) => {
    try {
      const { userId, code } = req.body;
      const uid = Number(userId);
      const promoCode = String(code || '').trim().toUpperCase();

      if (!uid) return res.status(400).json({ ok: false, error: 'User ID is required' });
      if (!promoCode) return res.status(400).json({ ok: false, error: 'Введите промокод' });

      const promoResult = runTransaction((db) => {
        // Check if already used by this user
        const alreadyUsed = db.prepare('SELECT 1 FROM user_promocodes WHERE user_id = ? AND code = ?').get(uid, promoCode);
        if (alreadyUsed) {
          throw new Error('Вы уже использовали этот промокод');
        }

        const promo = db.prepare('SELECT amount, uses, max_uses FROM promocodes WHERE code = ?').get(promoCode) as any;
        if (!promo) {
          throw new Error('Промокод не найден');
        }

        const amount = Number(promo.amount);
        const uses = Number(promo.uses);
        const maxUses = Number(promo.max_uses);

        if (uses >= maxUses) {
          throw new Error('Лимит промокода исчерпан');
        }

        // Atomic increment of uses with limit guard
        const upd = db.prepare('UPDATE promocodes SET uses = uses + 1 WHERE code = ? AND uses < max_uses').run(promoCode);
        if (upd.changes === 0) {
          throw new Error('Лимит промокода исчерпан');
        }

        // Insert into user_promocodes (primary key [user_id, code] prevents duplicate rows)
        db.prepare('INSERT INTO user_promocodes (user_id, code, used_at) VALUES (?, ?, ?)').run(
          uid,
          promoCode,
          Math.floor(Date.now() / 1000)
        );

        // Credit balance
        updateUserBalance(db, uid, amount);
        const freshUser = getUser(db, uid);

        return { amount, balance: freshUser.balance };
      });

      return res.json({ ok: true, ...promoResult });
    } catch (err: any) {
      console.error('Error in /api/promo/activate:', err);
      return res.status(400).json({ ok: false, error: err.message || 'Ошибка активации промокода' });
    }
  });

  // 8. Leaderboard
  app.get('/api/leaderboard', async (req: Request, res: Response) => {
    try {
      const db = getDb();
      const category = String(req.query.category || 'turnover');
      let orderField = 'total_bets_amount';
      if (category === 'games') orderField = 'total_games';
      if (category === 'wins') orderField = 'total_wins';

      const rows = db.prepare(`
        SELECT user_id, username, total_bets_amount, total_games, total_wins
        FROM users
        WHERE is_banned = 0
        ORDER BY ${orderField} DESC LIMIT 15
      `).all() as any[];

      const players = rows.map((item) => {
        const totalGames = item.total_games || 0;
        const totalWins = item.total_wins || 0;
        const winrate = totalGames > 0 ? ((totalWins / totalGames) * 100).toFixed(1) : '0.0';
        return {
          ...item,
          winrate,
        };
      });

      return res.json({ ok: true, players, category });
    } catch (err: any) {
      console.error('Error in /api/leaderboard:', err);
      return res.status(500).json({ ok: false, error: err.message || 'Ошибка загрузки таблицы лидеров' });
    }
  });

  // 9. Bot configuration & WebApp info
  app.get('/api/bot/info', async (_req: Request, res: Response) => {
    const depositUrl = `https://t.me/${BOT_USERNAME}?start=deposit`;
    const withdrawUrl = `https://t.me/${BOT_USERNAME}?start=withdraw`;
    const botUrl = `https://t.me/${BOT_USERNAME}`;

    return res.json({
      ok: true,
      bot: {
        name: 'SpindBet',
        username: BOT_USERNAME,
        depositUrl,
        withdrawUrl,
        botUrl,
        usdtRate: 90,
        supportUrl: 'https://t.me/winer404',
        channelUrl: 'https://t.me/+-KpLp8Bvny43YzYy',
        chatUrl: 'https://t.me/+uNALN45BYs9hNmYy',
        notice: 'Пополнение и вывод баланса осуществляются исключительно через Telegram-бота для гарантированной безопасности и мгновенных выплат.',
      },
    });
  });

  // 10. Roulette History
  const RED_SET = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  const getNumberColor = (num: number): 'green' | 'red' | 'black' => {
    if (num === 0) return 'green';
    if (RED_SET.has(num)) return 'red';
    return 'black';
  };

  app.get('/api/roulette/history', async (_req: Request, res: Response) => {
    try {
      const db = getDb();
      const rows = db.prepare(`
        SELECT result, timestamp FROM provably_fair_rounds 
        WHERE game_name = 'Roulette' AND status = 'revealed'
        ORDER BY id DESC LIMIT 15
      `).all() as any[];

      const history: Array<{ number: number; color: string }> = [];
      for (const row of rows) {
        try {
          const parsed = JSON.parse(String(row.result));
          if (typeof parsed.number === 'number') {
            history.push({
              number: parsed.number,
              color: parsed.color || getNumberColor(parsed.number),
            });
          }
        } catch {
          // ignore parsing error
        }
      }

      if (history.length === 0) {
        const defaults = [14, 2, 0, 19, 32, 7, 26, 11, 35, 17];
        defaults.forEach((num) => history.push({ number: num, color: getNumberColor(num) }));
      }

      return res.json({ ok: true, history });
    } catch (err: any) {
      console.error('Error in /api/roulette/history:', err);
      return res.status(500).json({ ok: false, error: err.message || 'Ошибка истории рулетки' });
    }
  });

  // 11. Roulette Spin (Protected against negative balance and double spin)
  app.post('/api/roulette/spin', async (req: Request, res: Response) => {
    try {
      const { userId, bets } = req.body;
      const uid = Number(userId);

      if (!uid) return res.status(400).json({ ok: false, error: 'User ID is required' });
      if (!bets || typeof bets !== 'object' || Object.keys(bets).length === 0) {
        return res.status(400).json({ ok: false, error: 'Сделайте хотя бы одну ставку' });
      }

      // Calculate total bet
      let totalBet = 0;
      for (const amount of Object.values(bets)) {
        const num = Number(amount) || 0;
        if (num > 0) totalBet += num;
      }
      totalBet = Math.round(totalBet * 100) / 100;

      if (totalBet < 0.01) {
        return res.status(400).json({ ok: false, error: 'Минимальная ставка $0.01' });
      }
      if (totalBet > 500) {
        return res.status(400).json({ ok: false, error: 'Максимальная сумма ставок $500' });
      }

      const spinResult = runTransaction((db) => {
        const user = getUser(db, uid);
        if (user.is_banned) {
          throw new Error('Вы заблокированы в системе');
        }

        // Deduct balance atomically
        const deducted = deductUserBalanceSafe(db, uid, totalBet);
        if (!deducted) {
          throw new Error('Недостаточно средств на балансе');
        }

        // Provably Fair Calculation (European Roulette SHA-256 HMAC)
        const nonce = getNextNonce(db, uid);
        const { server_seed, client_seed, server_seed_hash } = generateSeeds();
        const hmac = crypto.createHmac('sha256', server_seed);
        hmac.update(`${client_seed}:${nonce}`);
        const hash = hmac.digest('hex');
        const winningNumber = parseInt(hash.substring(0, 8), 16) % 37; // 0 to 36
        const winningColor = getNumberColor(winningNumber);

        // Calculate winnings
        let totalWin = 0;
        for (const [key, amount] of Object.entries(bets)) {
          const betAmt = Number(amount) || 0;
          if (betAmt <= 0) continue;

          if (key === 'red' && winningColor === 'red') totalWin += betAmt * 2;
          else if (key === 'black' && winningColor === 'black') totalWin += betAmt * 2;
          else if (key === 'green' && winningNumber === 0) totalWin += betAmt * 14;
          else if (key === 'low' && winningNumber >= 1 && winningNumber <= 18) totalWin += betAmt * 2;
          else if (key === 'high' && winningNumber >= 19 && winningNumber <= 36) totalWin += betAmt * 2;
          else if (key === 'even' && winningNumber > 0 && winningNumber % 2 === 0) totalWin += betAmt * 2;
          else if (key === 'odd' && winningNumber > 0 && winningNumber % 2 === 1) totalWin += betAmt * 2;
          else if (key === 'dozen1' && winningNumber >= 1 && winningNumber <= 12) totalWin += betAmt * 3;
          else if (key === 'dozen2' && winningNumber >= 13 && winningNumber <= 24) totalWin += betAmt * 3;
          else if (key === 'dozen3' && winningNumber >= 25 && winningNumber <= 36) totalWin += betAmt * 3;
          else if (key.startsWith('num_')) {
            const directNum = parseInt(key.replace('num_', ''), 10);
            if (directNum === winningNumber) totalWin += betAmt * 36;
          }
        }
        totalWin = Math.round(totalWin * 100) / 100;

        // Credit winnings atomically
        if (totalWin > 0) {
          updateUserBalance(db, uid, totalWin);
        }

        const isWin = totalWin > totalBet;
        updateUserGameStats(db, uid, totalBet, isWin);

        // Record round
        const nowTs = Math.floor(Date.now() / 1000);
        const resultObj = {
          number: winningNumber,
          color: winningColor,
          totalBet,
          totalWin,
          win: totalWin > 0,
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
            nonce,
          },
        };
      });

      return res.json({ ok: true, ...spinResult });
    } catch (err: any) {
      console.error('Error in /api/roulette/spin:', err);
      return res.status(400).json({ ok: false, error: err.message || 'Ошибка вращения рулетки' });
    }
  });

    // ==========================================
  // 12. CRASH GAME
  // ==========================================

  const calculateCrashMultiplier = (serverSeed: string, clientSeed: string, nonce: number): number => {
    // crypto imported at top
    const hmac = crypto.createHmac("sha256", serverSeed);
    hmac.update(`${clientSeed}:${nonce}:crash`);
    const hash = hmac.digest("hex");
    const h = parseInt(hash.substring(0, 13), 16);
    const e = Math.pow(2, 52);
    if (h % 33 === 0) return 1.0;
    let point = Math.floor((100 * e - h) / (e - h)) / 100;
    point = Math.max(1.0, Math.min(500.0, point));
    return Math.round(point * 100) / 100;
  };

  app.get("/api/crash/history", async (_req: Request, res: Response) => {
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
        } catch {}
      }
      if (history.length === 0) {
        [2.15, 1.45, 8.90, 1.02, 3.40, 1.88, 12.50, 1.15, 4.20, 2.05].forEach((cp) =>
          history.push({ crashPoint: cp })
        );
      }
      return res.json({ ok: true, history });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/crash/start", async (req: Request, res: Response) => {
    try {
      const { userId, betAmount } = req.body;
      const uid = Number(userId);
      if (!uid) return res.status(400).json({ ok: false, error: "User ID is required" });
      const bet = Math.round(Number(betAmount) * 100) / 100;
      if (isNaN(bet) || bet < 0.01) return res.status(400).json({ ok: false, error: "Минимальная ставка $0.01" });
      if (bet > 500) return res.status(400).json({ ok: false, error: "Максимальная ставка $500" });

      const startResult = runTransaction((db) => {
        const user = getUser(db, uid);
        if (user.is_banned) throw new Error("Вы заблокированы в системе");
        const existing = db.prepare("SELECT 1 FROM crash_games WHERE user_id = ? AND active = 1").get(uid);
        if (existing) throw new Error("У вас уже есть активный полёт! Завершите его.");
        const deducted = deductUserBalanceSafe(db, uid, bet);
        if (!deducted) throw new Error("Недостаточно средств на балансе");

        const nonce = getNextNonce(db, uid);
        const { server_seed, client_seed, server_seed_hash } = generateSeeds();
        const crashPoint = calculateCrashMultiplier(server_seed, client_seed, nonce);
        const nowTs = Math.floor(Date.now() / 1000);

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
            nonce,
          },
        };
      });
      return res.json({ ok: true, ...startResult });
    } catch (err: any) {
      return res.status(400).json({ ok: false, error: err.message || "Ошибка старта Crash" });
    }
  });

  app.post("/api/crash/cashout", async (req: Request, res: Response) => {
    try {
      const { userId, multiplier } = req.body;
      const uid = Number(userId);
      const mult = Math.round(Number(multiplier) * 100) / 100;
      if (!uid || isNaN(mult) || mult < 1.01) return res.status(400).json({ ok: false, error: "Неверный множитель" });

      const cashoutResult = runTransaction((db) => {
        const game = db.prepare("SELECT * FROM crash_games WHERE user_id = ? AND active = 1").get(uid);
        if (!game) throw new Error("Активный раунд не найден или уже завершён");

        const betAmount = Number(game.bet_amount);
        const crashPoint = Number(game.crash_point);
        const roundId = Number(game.round_id);

        if (mult > crashPoint) {
          const upd = db.prepare("UPDATE crash_games SET active = 0 WHERE user_id = ? AND active = 1").run(uid);
          if (upd.changes === 0) throw new Error("Раунд уже завершён");
          updateUserGameStats(db, uid, betAmount, false);
          const roundData = db.prepare("SELECT * FROM provably_fair_rounds WHERE id = ?").get(roundId);
          const resultStr = JSON.stringify({ crashPoint, win: false, cashedOut: false });
          db.prepare("UPDATE provably_fair_rounds SET result = ?, status = 'revealed' WHERE id = ?").run(resultStr, roundId);
          const freshUser = getUser(db, uid);
          return {
            win: false,
            crashPoint,
            balance: freshUser.balance,
            fairness: {
              serverSeed: roundData?.server_seed,
              serverSeedHash: roundData?.server_seed_hash,
              clientSeed: roundData?.client_seed,
              nonce: roundData?.nonce,
            },
          };
        }

        const upd = db.prepare("UPDATE crash_games SET active = 0 WHERE user_id = ? AND active = 1").run(uid);
        if (upd.changes === 0) throw new Error("Выигрыш уже был зачислен");
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
            nonce: roundData?.nonce,
          },
        };
      });
      return res.json({ ok: true, ...cashoutResult });
    } catch (err: any) {
      return res.status(400).json({ ok: false, error: err.message || "Ошибка вывода Crash" });
    }
  });

  app.post("/api/crash/finish", async (req: Request, res: Response) => {
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
              nonce: roundData?.nonce,
            },
          };
        }
        return { active: false };
      });
      return res.json({ ok: true, ...finishResult });
    } catch (err: any) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  });

  // ==========================================
  // 13. DICE GAME (КУБИК)
  // ==========================================

  app.post("/api/dice/roll", async (req: Request, res: Response) => {
    try {
      const { userId, betAmount, betType, targetNumber } = req.body;
      const uid = Number(userId);
      if (!uid) return res.status(400).json({ ok: false, error: "User ID is required" });
      const bet = Math.round(Number(betAmount) * 100) / 100;
      if (isNaN(bet) || bet < 0.01) return res.status(400).json({ ok: false, error: "Минимальная ставка $0.01" });
      if (bet > 500) return res.status(400).json({ ok: false, error: "Максимальная ставка $500" });

      const rollResult = runTransaction((db) => {
        const user = getUser(db, uid);
        if (user.is_banned) throw new Error("Вы заблокированы в системе");
        const deducted = deductUserBalanceSafe(db, uid, bet);
        if (!deducted) throw new Error("Недостаточно средств на балансе");

        const nonce = getNextNonce(db, uid);
        const { server_seed, client_seed, server_seed_hash } = generateSeeds();
        // crypto imported at top
        const hmac = crypto.createHmac("sha256", server_seed);
        hmac.update(`${client_seed}:${nonce}:dice`);
        const hash = hmac.digest("hex");

        const diceValue = (parseInt(hash.substring(0, 8), 16) % 6) + 1;
        const sliderValue = (parseInt(hash.substring(8, 16), 16) % 100) + 1;

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

        const nowTs = Math.floor(Date.now() / 1000);
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
            nonce,
          },
        };
      });
      return res.json({ ok: true, ...rollResult });
    } catch (err: any) {
      return res.status(400).json({ ok: false, error: err.message || "Ошибка броска кубика" });
    }
  });

  // ==========================================
  // 14. COINFLIP GAME (МОНЕТКА SPIND BET)
  // ==========================================

  app.post("/api/coinflip/flip", async (req: Request, res: Response) => {
    try {
      const { userId, betAmount, chosenSide } = req.body;
      const uid = Number(userId);
      const side = String(chosenSide || "heads").toLowerCase();
      if (!uid) return res.status(400).json({ ok: false, error: "User ID is required" });
      if (side !== "heads" && side !== "tails") return res.status(400).json({ ok: false, error: "Выберите сторону: Орёл или Решка" });

      const bet = Math.round(Number(betAmount) * 100) / 100;
      if (isNaN(bet) || bet < 0.01) return res.status(400).json({ ok: false, error: "Минимальная ставка $0.01" });
      if (bet > 500) return res.status(400).json({ ok: false, error: "Максимальная ставка $500" });

      const flipResult = runTransaction((db) => {
        const user = getUser(db, uid);
        if (user.is_banned) throw new Error("Вы заблокированы в системе");
        const deducted = deductUserBalanceSafe(db, uid, bet);
        if (!deducted) throw new Error("Недостаточно средств на балансе");

        const nonce = getNextNonce(db, uid);
        const { server_seed, client_seed, server_seed_hash } = generateSeeds();
        // crypto imported at top
        const hmac = crypto.createHmac("sha256", server_seed);
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

        const nowTs = Math.floor(Date.now() / 1000);
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
            nonce,
          },
        };
      });
      return res.json({ ok: true, ...flipResult });
    } catch (err: any) {
      return res.status(400).json({ ok: false, error: err.message || "Ошибка подброса монетки" });
    }
  });
}
