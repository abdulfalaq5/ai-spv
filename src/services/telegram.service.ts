// =============================================================================
// TelegramService — thin wrapper around Telegram Bot API
// =============================================================================

import axios from 'axios';
import { env } from '../config/env';

const log = {
  info: (msg: string) => console.log(`[TELEGRAM] ${new Date().toISOString()} ${msg}`),
  warn: (msg: string) => console.warn(`[TELEGRAM] ${new Date().toISOString()} ${msg}`),
  error: (msg: string, e?: unknown) => console.error(`[TELEGRAM] ${new Date().toISOString()} ${msg}`, e ?? ''),
};

export type ParseMode = 'Markdown' | 'MarkdownV2' | 'HTML';

export class TelegramService {
  private get token(): string | undefined {
    return env.TELEGRAM_PUBLIC_BOT_TOKEN;
  }

  private get apiBase(): string {
    return `https://api.telegram.org/bot${this.token}`;
  }

  /** Check if the bot token is configured */
  isConfigured(): boolean {
    return !!this.token;
  }

  // ---------------------------------------------------------------------------
  // sendMessage
  // ---------------------------------------------------------------------------
  async sendMessage(
    chatId: number,
    text: string,
    parseMode: ParseMode = 'Markdown',
  ): Promise<void> {
    if (!this.token) {
      log.warn('TELEGRAM_PUBLIC_BOT_TOKEN not set — skipping sendMessage.');
      return;
    }

    try {
      await axios.post(
        `${this.apiBase}/sendMessage`,
        {
          chat_id: chatId,
          text,
          parse_mode: parseMode,
          // Disable link previews to keep messages clean
          disable_web_page_preview: true,
        },
        { timeout: 10_000 },
      );
    } catch (e: any) {
      // Retry once with plain text if markdown causes parse error
      if (e?.response?.data?.description?.includes('parse')) {
        log.warn(`Markdown parse error, retrying as plain text for chat_id=${chatId}`);
        try {
          await axios.post(
            `${this.apiBase}/sendMessage`,
            { chat_id: chatId, text, disable_web_page_preview: true },
            { timeout: 10_000 },
          );
        } catch (e2: any) {
          log.error(`sendMessage fallback also failed for chat_id=${chatId}:`, e2?.message);
        }
      } else {
        log.error(`sendMessage failed for chat_id=${chatId}: ${e?.message}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // sendChatAction (typing indicator)
  // ---------------------------------------------------------------------------
  async sendTyping(chatId: number): Promise<void> {
    if (!this.token) return;
    try {
      await axios.post(
        `${this.apiBase}/sendChatAction`,
        { chat_id: chatId, action: 'typing' },
        { timeout: 5_000 },
      );
    } catch {
      // typing is best-effort, ignore errors
    }
  }

  // ---------------------------------------------------------------------------
  // setWebhook — register webhook URL with Telegram
  // ---------------------------------------------------------------------------
  async setWebhook(webhookUrl: string, secretToken?: string): Promise<{ ok: boolean; description?: string }> {
    if (!this.token) {
      return { ok: false, description: 'TELEGRAM_PUBLIC_BOT_TOKEN not configured' };
    }

    try {
      const payload: Record<string, unknown> = {
        url: webhookUrl,
        allowed_updates: ['message'],
        drop_pending_updates: true,
      };

      if (secretToken) {
        payload.secret_token = secretToken;
      }

      const res = await axios.post(`${this.apiBase}/setWebhook`, payload, { timeout: 10_000 });
      log.info(`Webhook set to: ${webhookUrl} → ${JSON.stringify(res.data)}`);
      return res.data;
    } catch (e: any) {
      log.error('setWebhook failed:', e?.response?.data ?? e?.message);
      return { ok: false, description: e?.response?.data?.description ?? e?.message };
    }
  }

  // ---------------------------------------------------------------------------
  // deleteWebhook
  // ---------------------------------------------------------------------------
  async deleteWebhook(): Promise<void> {
    if (!this.token) return;
    try {
      await axios.post(`${this.apiBase}/deleteWebhook`, {}, { timeout: 10_000 });
      log.info('Webhook deleted.');
    } catch (e: any) {
      log.error('deleteWebhook failed:', e?.message);
    }
  }

  // ---------------------------------------------------------------------------
  // getMe — get bot info
  // ---------------------------------------------------------------------------
  async getMe(): Promise<Record<string, unknown> | null> {
    if (!this.token) return null;
    try {
      const res = await axios.get(`${this.apiBase}/getMe`, { timeout: 10_000 });
      return res.data?.result ?? null;
    } catch (e: any) {
      log.error('getMe failed:', e?.message);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // getWebhookInfo — check current webhook status
  // ---------------------------------------------------------------------------
  async getWebhookInfo(): Promise<Record<string, unknown> | null> {
    if (!this.token) return null;
    try {
      const res = await axios.get(`${this.apiBase}/getWebhookInfo`, { timeout: 10_000 });
      return res.data?.result ?? null;
    } catch (e: any) {
      log.error('getWebhookInfo failed:', e?.message);
      return null;
    }
  }
}

export const telegramService = new TelegramService();
