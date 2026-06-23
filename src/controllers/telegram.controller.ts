// =============================================================================
// TelegramController — handles incoming Telegram webhook updates
//
// Routes:
//   POST /telegram/webhook  — receives updates from Telegram Bot API
//   POST /telegram/setup    — register webhook URL (internal / admin use)
//   GET  /telegram/info     — get bot info + webhook status
// =============================================================================

import { Request, Response } from 'express';
import { env } from '../config/env';
import { telegramService } from '../services/telegram.service';
import { rateLimiterService } from '../services/rate-limiter.service';
import { chatLogService } from '../services/chat-log.service';
import { intentClassifier } from '../router/intent-classifier';
import { routingService } from '../router/routing.service';
import { aggregationService } from '../router/aggregation.service';
import { knex } from '../database/knex';

const log = {
  info: (msg: string) => console.log(`[TG-CTRL] ${new Date().toISOString()} ${msg}`),
  warn: (msg: string) => console.warn(`[TG-CTRL] ${new Date().toISOString()} ${msg}`),
  error: (msg: string, e?: unknown) => console.error(`[TG-CTRL] ${new Date().toISOString()} ${msg}`, e ?? ''),
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface TelegramFrom {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
}

interface TelegramMessage {
  message_id: number;
  from?: TelegramFrom;
  chat: TelegramChat;
  date: number;
  text?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function displayName(from: TelegramFrom): string {
  return [from.first_name, from.last_name].filter(Boolean).join(' ') || `User#${from.id}`;
}

// ---------------------------------------------------------------------------
// Commands text definitions
// ---------------------------------------------------------------------------
const MESSAGES = {
  welcome: (botName: string) =>
    `🤖 *Selamat datang di ${botName}!*\n\nSaya adalah AI Assistant yang dapat menjawab pertanyaan seputar:\n• 🖥️ Server & Infrastruktur\n• 👥 HR & SDM\n• 📊 CRM & Data\n• 💬 Pertanyaan Umum\n\nUntuk mulai, silakan login terlebih dahulu:\n\`/login email@perusahaan.com\`\n\nKetik /help untuk melihat daftar perintah.`,
  help: () =>
    `📋 *Daftar Perintah*\n\n\`/login <email>\` — Login ke sistem\n\`/logout\` — Keluar dari sesi\n\`/status\` — Cek status login Anda\n\`/help\` — Tampilkan panduan ini\n\nSetelah login, ketik pertanyaan Anda secara langsung. Contoh:\n• "Berapa penggunaan RAM server?"\n• "Cuti tahunan berapa hari?"\n• "Siapa sales terbaik bulan ini?"`,
  notLoggedIn: () =>
    `🔒 Anda belum login.\n\nGunakan perintah:\n\`/login email@perusahaan.com\``,
  rateLimited: (retryAfter: number) =>
    `⏳ Anda terlalu sering mengirim pesan. Coba lagi dalam *${retryAfter} detik*.`,
  noAccess: (agents: string[]) =>
    `🚫 Maaf, Anda tidak memiliki akses ke agen yang dibutuhkan: *${agents.join(', ')}*.`,
  aiError: () =>
    `⚠️ Maaf, sistem AI sedang sibuk. Silakan coba beberapa saat lagi.`,
  blocked: () =>
    `🚫 Akun Telegram Anda telah diblokir. Hubungi administrator.`,
};

// ---------------------------------------------------------------------------
// TelegramController
// ---------------------------------------------------------------------------
export class TelegramController {
  // -------------------------------------------------------------------------
  // POST /telegram/webhook
  // -------------------------------------------------------------------------
  async handleUpdate(req: Request, res: Response): Promise<void> {
    // 1. Validate webhook secret token
    const incomingSecret = req.headers['x-telegram-bot-api-secret-token'];
    if (env.TELEGRAM_WEBHOOK_SECRET && incomingSecret !== env.TELEGRAM_WEBHOOK_SECRET) {
      log.warn('Rejected webhook: invalid secret token.');
      res.status(403).json({ ok: false });
      return;
    }

    const update: TelegramUpdate = req.body;

    // 2. Only process new messages (ignore edits, channel posts)
    const message = update.message;
    if (!message || !message.text || !message.from) {
      // Acknowledge silently — Telegram requires 200 OK for all updates
      res.json({ ok: true });
      return;
    }

    // 3. Acknowledge immediately — process async to avoid Telegram timeout
    res.json({ ok: true });

    // 4. Process in background
    this.processMessage(message).catch((e) => {
      log.error(`Unhandled error processing message from user=${message.from?.id}:`, e);
    });
  }

  // -------------------------------------------------------------------------
  // Core message processor (async, after 200 OK returned)
  // -------------------------------------------------------------------------
  private async processMessage(message: TelegramMessage): Promise<void> {
    const from = message.from!;
    const chatId = message.chat.id;
    const userId = from.id;
    const text = (message.text ?? '').trim();
    const username = from.username ?? null;
    const name = displayName(from);

    log.info(`Received from ${name} (uid=${userId}): "${text.substring(0, 80)}"`);

    // --- Update or upsert telegram_users (record last seen) ---
    try {
      await knex('telegram_users')
        .insert({
          telegram_user_id: userId,
          username,
          display_name: name,
          last_seen_at: new Date(),
        })
        .onConflict('telegram_user_id')
        .merge({ username, display_name: name, last_seen_at: new Date(), updated_at: new Date() });
    } catch (e) {
      log.error('Failed to upsert telegram_users:', e);
    }

    // --- Check if blocked ---
    const telegramUser = await knex('telegram_users')
      .where('telegram_user_id', userId)
      .first();

    if (telegramUser?.is_blocked) {
      await telegramService.sendMessage(chatId, MESSAGES.blocked());
      return;
    }

    // --- Route commands ---
    if (text.startsWith('/')) {
      await this.handleCommand(text, chatId, userId, username, name);
      return;
    }

    // --- Regular message: rate limit check ---
    if (!rateLimiterService.isAllowed(userId)) {
      const retryAfter = rateLimiterService.retryAfterSeconds(userId);
      await telegramService.sendMessage(chatId, MESSAGES.rateLimited(retryAfter));
      chatLogService.log({
        chat_id: chatId,
        user_id: userId,
        username,
        message: text,
        status: 'rate_limited',
      });
      return;
    }

    // --- Session check ---
    const session = await knex('user_sessions').where('session_id', userId.toString()).first();
    if (!session) {
      await telegramService.sendMessage(chatId, MESSAGES.notLoggedIn());
      chatLogService.log({
        chat_id: chatId,
        user_id: userId,
        username,
        message: text,
        status: 'unauthorized',
      });
      return;
    }

    // --- Validate user_access entry ---
    const user = await knex('user_access').where('email', session.email).first();
    if (!user) {
      await telegramService.sendMessage(chatId, MESSAGES.notLoggedIn());
      return;
    }

    const rights: string[] = typeof user.access_rights === 'string'
      ? JSON.parse(user.access_rights)
      : user.access_rights || [];

    // --- Send typing indicator ---
    await telegramService.sendTyping(chatId);

    // --- Process AI query ---
    const startedAt = Date.now();
    let responseText: string | null = null;
    let status: 'success' | 'error' = 'success';
    let agentUsed: string | null = null;
    let errorMessage: string | null = null;

    try {
      // Intent classification
      const targetAgents = await intentClassifier.classify(text);
      if (targetAgents.length === 0) {
        responseText = MESSAGES.aiError();
        status = 'error';
        errorMessage = 'No agents classified';
      } else {
        // Access rights filter
        const allowedAgents = targetAgents.filter(
          (a) => rights.includes(a) || rights.includes('*'),
        );

        if (allowedAgents.length === 0) {
          responseText = MESSAGES.noAccess(targetAgents);
          status = 'error';
          errorMessage = `No access to agents: ${targetAgents.join(', ')}`;
        } else {
          // Route to agents
          const agentResponses = await routingService.route(text, allowedAgents);
          const respondedAgents = Object.keys(agentResponses);

          if (respondedAgents.length === 0) {
            responseText = MESSAGES.aiError();
            status = 'error';
            errorMessage = 'All agents failed to respond';
          } else if (respondedAgents.length === 1) {
            agentUsed = respondedAgents[0];
            responseText = agentResponses[agentUsed];
          } else {
            // Multi-agent aggregation
            agentUsed = respondedAgents.join('+');
            responseText = await aggregationService.aggregate(text, agentResponses);
          }
        }
      }
    } catch (e: any) {
      log.error('Error processing AI query:', e);
      responseText = MESSAGES.aiError();
      status = 'error';
      errorMessage = e?.message ?? 'Unknown error';
    }

    const latencyMs = Date.now() - startedAt;

    // --- Send response ---
    if (responseText) {
      await telegramService.sendMessage(chatId, responseText);
    }

    // --- Log to DB ---
    chatLogService.log({
      chat_id: chatId,
      user_id: userId,
      username,
      message: text,
      response: responseText,
      latency_ms: latencyMs,
      status,
      agent_used: agentUsed,
      error_message: errorMessage,
    });

    log.info(`Responded to uid=${userId} in ${latencyMs}ms via agent=${agentUsed ?? 'N/A'}`);
  }

  // -------------------------------------------------------------------------
  // Command Handler
  // -------------------------------------------------------------------------
  private async handleCommand(
    text: string,
    chatId: number,
    userId: number,
    username: string | null,
    displayNameStr: string,
  ): Promise<void> {
    const parts = text.split(/\s+/);
    const command = parts[0].toLowerCase().split('@')[0]; // strip @BotName suffix

    switch (command) {
      case '/start': {
        const botInfo = await telegramService.getMe();
        const botName = (botInfo as any)?.first_name ?? 'AI Assistant';
        await telegramService.sendMessage(chatId, MESSAGES.welcome(botName));
        break;
      }

      case '/help': {
        await telegramService.sendMessage(chatId, MESSAGES.help());
        break;
      }

      case '/login': {
        const email = parts[1]?.trim().toLowerCase();
        if (!email) {
          await telegramService.sendMessage(
            chatId,
            '❗ Format login: `/login email@perusahaan.com`',
          );
          return;
        }

        const userAccess = await knex('user_access').where('email', email).first();
        if (!userAccess) {
          await telegramService.sendMessage(
            chatId,
            `❌ Email *${email}* tidak terdaftar di sistem.\nHubungi administrator untuk mendapatkan akses.`,
          );
          return;
        }

        // Create/update session — session_id is telegram user_id
        await knex('user_sessions')
          .insert({ session_id: userId.toString(), email: userAccess.email })
          .onConflict('session_id')
          .merge({ email: userAccess.email, updated_at: new Date() });

        // Link telegram_user_id to email
        await knex('telegram_users')
          .where('telegram_user_id', userId)
          .update({ email: userAccess.email, updated_at: new Date() });

        const rights: string[] = typeof userAccess.access_rights === 'string'
          ? JSON.parse(userAccess.access_rights)
          : userAccess.access_rights || [];

        const accessList = rights.length > 0 ? rights.join(', ') : 'tidak ada akses khusus';

        await telegramService.sendMessage(
          chatId,
          `✅ *Login berhasil!*\n\nHalo, *${displayNameStr}*!\nAkun: ${userAccess.email}\nAkses: ${accessList}\n\nSilakan ajukan pertanyaan Anda.`,
        );

        log.info(`User ${email} logged in via Telegram uid=${userId}`);
        break;
      }

      case '/logout': {
        await knex('user_sessions').where('session_id', userId.toString()).delete();
        await knex('telegram_users')
          .where('telegram_user_id', userId)
          .update({ email: null, updated_at: new Date() });

        await telegramService.sendMessage(
          chatId,
          '👋 Anda telah logout. Gunakan `/login` untuk masuk kembali.',
        );
        log.info(`User uid=${userId} logged out.`);
        break;
      }

      case '/status': {
        const session = await knex('user_sessions').where('session_id', userId.toString()).first();
        if (!session) {
          await telegramService.sendMessage(chatId, MESSAGES.notLoggedIn());
        } else {
          const userAccess = await knex('user_access').where('email', session.email).first();
          const rights: string[] = typeof userAccess?.access_rights === 'string'
            ? JSON.parse(userAccess.access_rights)
            : userAccess?.access_rights || [];

          await telegramService.sendMessage(
            chatId,
            `ℹ️ *Status Login*\n\nAkun: ${session.email}\nAkses: ${rights.join(', ') || 'tidak ada'}\nTelegram ID: \`${userId}\``,
          );
        }
        break;
      }

      default: {
        await telegramService.sendMessage(
          chatId,
          `❓ Perintah tidak dikenal: \`${command}\`\n\nKetik /help untuk daftar perintah.`,
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // POST /telegram/setup — register webhook (internal admin endpoint)
  // -------------------------------------------------------------------------
  async setupWebhook(req: Request, res: Response): Promise<void> {
    const { url } = req.body;
    if (!url || typeof url !== 'string') {
      res.status(400).json({ error: 'url is required. Example: { "url": "https://yourdomain.com/telegram/webhook" }' });
      return;
    }

    if (!telegramService.isConfigured()) {
      res.status(503).json({ error: 'TELEGRAM_PUBLIC_BOT_TOKEN not configured.' });
      return;
    }

    const result = await telegramService.setWebhook(url, env.TELEGRAM_WEBHOOK_SECRET);
    res.json(result);
  }

  // -------------------------------------------------------------------------
  // GET /telegram/info — bot info + webhook status
  // -------------------------------------------------------------------------
  async getBotInfo(req: Request, res: Response): Promise<void> {
    if (!telegramService.isConfigured()) {
      res.status(503).json({ error: 'TELEGRAM_PUBLIC_BOT_TOKEN not configured.' });
      return;
    }

    const [botInfo, webhookInfo] = await Promise.all([
      telegramService.getMe(),
      telegramService.getWebhookInfo(),
    ]);

    res.json({ bot: botInfo, webhook: webhookInfo });
  }
}

export const telegramController = new TelegramController();
