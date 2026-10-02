import { BOT_CONFIG } from './botConfig.ts';

const BOT_TOKEN = BOT_CONFIG.TELEGRAM_BOT_TOKEN;

/**
 * Send notification to user or channel from bot via Telegram Bot API
 */
export async function sendTelegramNotification(
  chatId: number | string,
  text: string,
  replyMarkup?: any
): Promise<boolean> {
  if (!BOT_TOKEN) {
    console.log(`[Bot Notification] (No BOT_TOKEN set) -> Chat: ${chatId} | Message: ${text.replace(/\n/g, ' ')}`);
    return false;
  }

  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const payload: any = {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };
    if (replyMarkup) {
      payload.reply_markup = replyMarkup;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data: any = await res.json();
    if (!data.ok) {
      console.warn(`[Telegram Bot API Warning to ${chatId}]: ${data.description || 'Failed to send'}`);
      return false;
    }
    return true;
  } catch (err: any) {
    console.warn(`[Telegram Bot Send Error to ${chatId}]: ${err.message}`);
    return false;
  }
}