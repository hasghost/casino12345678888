import { sendTelegramNotification } from './botNotifier.ts';
import { BOT_CONFIG } from './botConfig.ts';
import { getDb, getUser } from './database.ts';

const ADMIN_GROUP_ID = BOT_CONFIG.ADMIN_GROUP_ID; // -1002491370510

/**
 * Clean username without '@' prefix
 */
function getUsername(userId: number): string {
  try {
    const db = getDb();
    const u = getUser(db, userId);
    if (u?.username) {
      return u.username.replace(/^@/, '');
    }
  } catch {
    // ignore
  }
  return '';
}

/**
 * Inline keyboard for group/channel.
 * Telegram Bot API restricts 'web_app' buttons in groups/supergroups/channels to direct url buttons.
 * We use the t.me bot deep link (or direct web URL) which is valid in all groups!
 */
function getPlayKeyboard() {
  const cleanUsername = BOT_CONFIG.BOT_USERNAME.replace(/^@/, '');
  return {
    inline_keyboard: [
      [
        {
          text: '🎮 Играть в SpindBet',
          url: `t.me/SPIND_BET_BOT/play`,
        },
      ],
    ],
  };
}

/**
 * Builds the exact message structure specified:
 *
 * <tg-emoji emoji-id="5426842047812240711">🔥</tg-emoji> <b>Новая ставка (Web)</b>
 * <blockquote>├ Игра: <b>{game_name}</b>
 * ├ Игрок: @{username or 'скрыт'}
 * ├ Ставка: <b>${bet_amount:.2f}</b>
 * └ {outcome_text}</blockquote>
 * <i><tg-emoji emoji-id="5426995996619999058">📊</tg-emoji> {profit_text}<tg-emoji emoji-id="5426913374334122021">💸</tg-emoji></i>
 */
function buildExactBetMessage(params: {
  gameName: string;
  username: string;
  betAmount: number;
  outcomeText: string;
  profitText: string;
}): string {
  const { gameName, username, betAmount, outcomeText, profitText } = params;
  const userDisplay = username ? `@${username}` : 'скрыт';
  const betFormatted = (Math.round(betAmount * 100) / 100).toFixed(2);

  return (
`<tg-emoji emoji-id="5426842047812240711">🔥</tg-emoji> <b>Новая ставка (Web)</b>

<blockquote>├ Игра: <b>${gameName}</b>
├ Игрок: ${userDisplay}
├ Ставка: <b>$${betFormatted}</b>
└ ${outcomeText}</blockquote>

<i><tg-emoji emoji-id="5426995996619999058">📊</tg-emoji> ${profitText}<tg-emoji emoji-id="5426913374334122021">💸</tg-emoji></i>`
  );
}

/**
 * Send notification ONLY to ADMIN_GROUP_ID with the WebApp button.
 * No messages sent to user PM and no messages sent to channel logs.
 */
async function dispatchNotifications(_userId: number, messageText: string) {
  if (ADMIN_GROUP_ID) {
    sendTelegramNotification(ADMIN_GROUP_ID, messageText, getPlayKeyboard()).catch((err) => {
      console.warn(`[Send Admin Group error]:`, err);
    });
  }
}

/**
 * 1. NOTIFY MINES RESULT
 */
export async function notifyMinesResult(params: {
  userId: number;
  betAmount: number;
  minesCount: number;
  openedCount: number;
  multiplier: number;
  winAmount: number;
  won: boolean;
  hitMine?: boolean;
  newBalance: number;
}) {
  const {
    userId,
    betAmount,
    winAmount,
    won,
  } = params;

  const username = getUsername(userId);
  const betFormatted = (Math.round(betAmount * 100) / 100).toFixed(2);
  const winFormatted = (Math.round(winAmount * 100) / 100).toFixed(2);

  let outcomeText = '';
  let profitText = '';

  if (won) {
    const profit = Math.max(0, winAmount - betAmount);
    outcomeText = `<tg-emoji emoji-id="5424792515188397051">🎉</tg-emoji> Выигрыш: <b>+$${winFormatted}</b>`;
    profitText = `Профит: +$${(Math.round(profit * 100) / 100).toFixed(2)} `;
  } else {
    outcomeText = `<tg-emoji emoji-id="5427125073272147164">💥</tg-emoji> Проигрыш: <b>-$${betFormatted}</b>`;
    profitText = `Профит: -$${betFormatted} `;
  }

  const messageText = buildExactBetMessage({
    gameName: 'Мины',
    username,
    betAmount,
    outcomeText,
    profitText,
  });

  await dispatchNotifications(userId, messageText);
}

/**
 * 2. NOTIFY COINFLIP RESULT
 */
export async function notifyCoinflipResult(params: {
  userId: number;
  betAmount: number;
  chosenSide: string;
  resultSide: string;
  won: boolean;
  winAmount: number;
  newBalance: number;
}) {
  const {
    userId,
    betAmount,
    won,
    winAmount,
  } = params;

  const username = getUsername(userId);
  const betFormatted = (Math.round(betAmount * 100) / 100).toFixed(2);
  const winFormatted = (Math.round(winAmount * 100) / 100).toFixed(2);

  let outcomeText = '';
  let profitText = '';

  if (won) {
    const profit = Math.max(0, winAmount - betAmount);
    outcomeText = `<tg-emoji emoji-id="5424792515188397051">🎉</tg-emoji> Выигрыш: <b>+$${winFormatted}</b>`;
    profitText = `Профит: +$${(Math.round(profit * 100) / 100).toFixed(2)} `;
  } else {
    outcomeText = `<tg-emoji emoji-id="5427125073272147164">💥</tg-emoji> Проигрыш: <b>-$${betFormatted}</b>`;
    profitText = `Профит: -$${betFormatted} `;
  }

  const messageText = buildExactBetMessage({
    gameName: 'Орёл и Решка',
    username,
    betAmount,
    outcomeText,
    profitText,
  });

  await dispatchNotifications(userId, messageText);
}

/**
 * 3. NOTIFY DICE RESULT
 */
export async function notifyDiceResult(params: {
  userId: number;
  betAmount: number;
  betType: string;
  targetNumber?: number;
  diceValue: number;
  won: boolean;
  winAmount: number;
  multiplier: number;
  newBalance: number;
}) {
  const {
    userId,
    betAmount,
    won,
    winAmount,
  } = params;

  const username = getUsername(userId);
  const betFormatted = (Math.round(betAmount * 100) / 100).toFixed(2);
  const winFormatted = (Math.round(winAmount * 100) / 100).toFixed(2);

  let outcomeText = '';
  let profitText = '';

  if (won) {
    const profit = Math.max(0, winAmount - betAmount);
    outcomeText = `<tg-emoji emoji-id="5424792515188397051">🎉</tg-emoji> Выигрыш: <b>+$${winFormatted}</b>`;
    profitText = `Профит: +$${(Math.round(profit * 100) / 100).toFixed(2)} `;
  } else {
    outcomeText = `<tg-emoji emoji-id="5427125073272147164">💥</tg-emoji> Проигрыш: <b>-$${betFormatted}</b>`;
    profitText = `Профит: -$${betFormatted} `;
  }

  const messageText = buildExactBetMessage({
    gameName: 'Кубик',
    username,
    betAmount,
    outcomeText,
    profitText,
  });

  await dispatchNotifications(userId, messageText);
}

/**
 * 4. NOTIFY ROULETTE RESULT
 */
export async function notifyRouletteResult(params: {
  userId: number;
  totalBet: number;
  winningNumber: number;
  color: string;
  totalWin: number;
  won: boolean;
  newBalance: number;
}) {
  const {
    userId,
    totalBet,
    totalWin,
    won,
  } = params;

  const username = getUsername(userId);
  const betFormatted = (Math.round(totalBet * 100) / 100).toFixed(2);
  const winFormatted = (Math.round(totalWin * 100) / 100).toFixed(2);

  let outcomeText = '';
  let profitText = '';

  if (won) {
    const profit = Math.max(0, totalWin - totalBet);
    outcomeText = `<tg-emoji emoji-id="5424792515188397051">🎉</tg-emoji> Выигрыш: <b>+$${winFormatted}</b>`;
    profitText = `Профит: +$${(Math.round(profit * 100) / 100).toFixed(2)} `;
  } else {
    outcomeText = `<tg-emoji emoji-id="5427125073272147164">💥</tg-emoji> Проигрыш: <b>-$${betFormatted}</b>`;
    profitText = `Профит: -$${betFormatted} `;
  }

  const messageText = buildExactBetMessage({
    gameName: 'Рулетка',
    username,
    betAmount: totalBet,
    outcomeText,
    profitText,
  });

  await dispatchNotifications(userId, messageText);
}
