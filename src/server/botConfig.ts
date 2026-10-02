export const BOT_CONFIG = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '7368962343:AAGWmcvczpA_LJ_Qb8whxsGYpzOfPc4gWJs',
  BOT_USERNAME: process.env.BOT_USERNAME || 'SPIND_BET_BOT',
  LOGS_CHANNEL_ID: Number(process.env.LOGS_CHANNEL_ID) || -1003414639951,
  NEWS_CHANNEL_ID: Number(process.env.NEWS_CHANNEL_ID) || -1002409260613,
  ADMIN_GROUP_ID: Number(process.env.ADMIN_GROUP_ID) || -1002491370510,
  USDT_RUB_RATE: 90,
  APP_HOST: process.env.APP_HOST || 'spindbet.ru',
};
