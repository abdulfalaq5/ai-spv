// =============================================================================
// WeComController — handles incoming WeCom Intelligent AI Bot callbacks
//
// Routes:
//   GET  /wecom/webhook  — URL Verification (echo echostr)
//   POST /wecom/webhook  — Incoming messages dari WeCom Bot
//   GET  /wecom/info     — Status bot (admin)
// =============================================================================

import { Request, Response } from 'express';
import { env } from '../config/env';
import { wecomService } from '../services/wecom.service';
import { wecomMonitoringService } from '../services/wecom-monitoring.service';
import { rateLimiterService } from '../services/rate-limiter.service';
import { intentClassifier } from '../router/intent-classifier';
import { routingService } from '../router/routing.service';
import { aggregationService } from '../router/aggregation.service';
import { knex } from '../database/knex';
import type { WeComIntentResult } from '../router/intent-classifier';
import axios from 'axios';

const log = {
  info: (msg: string) => console.log(`[WECOM-CTRL] ${new Date().toISOString()} ${msg}`),
  warn: (msg: string) => console.warn(`[WECOM-CTRL] ${new Date().toISOString()} ${msg}`),
  error: (msg: string, e?: unknown) => console.error(`[WECOM-CTRL] ${new Date().toISOString()} ${msg}`, e ?? ''),
};

// ---------------------------------------------------------------------------
// Types — WeCom Callback Payload
// ---------------------------------------------------------------------------
// WeCom Intelligent AI Bot mengirim JSON (bukan XML seperti WeCom standard)
// Format sesuai dokumentasi WeCom AI Bot callback
interface WeComCallbackBody {
  /** Tipe event */
  event?: string;
  /** Sender info */
  sender?: {
    sender_type?: string;  // 'user' | 'bot'
    sender_id?: string;    // user identifier
    open_kfid?: string;    // customer service session ID
  };
  /** Chat session info */
  chat_info?: {
    open_kfid?: string;
  };
  /** Pesan teks dari user */
  text?: {
    content?: string;
  };
  /** Message type */
  msg_type?: string;  // 'text' | 'image' | etc.
  /** Token verifikasi (untuk URL verify GET request) */
  echostr?: string;
}

// ---------------------------------------------------------------------------
// Response helper
// ---------------------------------------------------------------------------
const MESSAGES = {
  welcome: () =>
    `🤖 *Selamat datang di AI Assistant WeCom!*\n\nSaya dapat membantu:\n• 🖥️ Cek status server (CPU, RAM, Disk)\n• 📡 Aktifkan monitoring dengan threshold kustom\n• 🔔 Kirim notifikasi otomatis saat threshold terlampaui\n\nCoba kirim:\n• "Kondisi server sekarang"\n• "Pantau server, kabari jika CPU atau RAM di atas 70%"\n• "Monitoring apa yang aktif?"\n\nGunakan /login email@perusahaan.com untuk login.`,
  help: () =>
    `📋 *Panduan WeCom AI Bot*\n\n*/login <email>* — Login ke sistem\n*/logout* — Keluar\n*/status* — Status login\n*/help* — Panduan ini\n\n*Perintah monitoring:*\n• "Pantau CPU dan RAM, threshold 70%"\n• "Hentikan monitoring"\n• "Monitoring apa yang aktif?"\n\n*Cek server:*\n• "Kondisi server sekarang"\n• "Berapa penggunaan CPU?"\n• "Berapa RAM yang terpakai?"`,
  notLoggedIn: () =>
    `🔒 Anda belum login.\n\nGunakan:\n/login email@perusahaan.com`,
  rateLimited: (retryAfter: number) =>
    `⏳ Terlalu banyak pesan. Coba lagi dalam *${retryAfter} detik*.`,
  noAccess: (agents: string[]) =>
    `🚫 Anda tidak memiliki akses ke: *${agents.join(', ')}*`,
  aiError: () =>
    `⚠️ AI sedang sibuk. Coba beberapa saat lagi.`,
  blocked: () =>
    `🚫 Akun Anda diblokir. Hubungi administrator.`,
};

// ---------------------------------------------------------------------------
// WeComController
// ---------------------------------------------------------------------------
export class WeComController {
  // -------------------------------------------------------------------------
  // GET /wecom/webhook — URL Verification
  // WeCom mengirim: ?echostr=xxx&msg_signature=yyy&timestamp=zzz&nonce=aaa
  // Kita harus return echostr jika signature valid
  // -------------------------------------------------------------------------
  async verifyUrl(req: Request, res: Response): Promise<void> {
    const { echostr, msg_signature, timestamp, nonce } = req.query as Record<string, string>;

    if (!echostr) {
      // Health check GET tanpa parameter
      res.json({ ok: true, service: 'wecom-webhook', configured: wecomService.isConfigured() });
      return;
    }

    // Verifikasi signature — gunakan WECOM_BOT_ID sebagai token (atau env.WECOM_SECRET)
    // WeCom Intelligent AI Bot menggunakan secret sebagai token validasi
    const token = env.WECOM_SECRET ?? '';
    const isValid = wecomService.verifySignature(msg_signature ?? '', timestamp ?? '', nonce ?? '', token, echostr);

    if (!isValid) {
      log.warn(`URL verify gagal: signature tidak cocok.`);
      res.status(403).send('Invalid signature');
      return;
    }

    log.info(`URL Verification sukses. echostr length=${echostr.length}`);
    // WeCom mengharapkan echostr dikembalikan sebagai plain text
    res.send(echostr);
  }

  // -------------------------------------------------------------------------
  // POST /wecom/webhook — Incoming messages
  // -------------------------------------------------------------------------
  async handleUpdate(req: Request, res: Response): Promise<void> {
    // Acknowledge segera — WeCom membutuhkan respons cepat
    res.json({ errcode: 0, errmsg: 'ok' });

    const body: WeComCallbackBody = req.body;

    // Extract pesan
    const userId = body.sender?.sender_id;
    const openKfid = body.sender?.open_kfid ?? body.chat_info?.open_kfid;
    const msgType = body.msg_type;
    const text = body.text?.content?.trim();

    // Hanya proses pesan teks dari user (bukan bot)
    if (!userId || !text || msgType !== 'text' || body.sender?.sender_type === 'bot') {
      return;
    }

    log.info(`Pesan dari userId=${userId} openKfid=${openKfid}: "${text.substring(0, 80)}"`);

    // Proses async
    this.processMessage({ userId, openKfid: openKfid ?? '', text }).catch(e => {
      log.error(`Unhandled error dari userId=${userId}:`, e);
    });
  }

  // -------------------------------------------------------------------------
  // Core message processor
  // -------------------------------------------------------------------------
  private async processMessage(ctx: {
    userId: string;
    openKfid: string;
    text: string;
  }): Promise<void> {
    const { userId, openKfid, text } = ctx;
    const startedAt = Date.now();

    // --- Upsert wecom_users ---
    try {
      await knex('wecom_users')
        .insert({ wecom_user_id: userId, last_seen_at: new Date() })
        .onConflict('wecom_user_id')
        .merge({ last_seen_at: new Date(), updated_at: new Date() });
    } catch (e) {
      log.error('Gagal upsert wecom_users:', e);
    }

    // --- Check blocked ---
    const wecomUser = await knex('wecom_users').where('wecom_user_id', userId).first();
    if (wecomUser?.is_blocked) {
      await wecomService.sendMessage(openKfid, userId, MESSAGES.blocked());
      return;
    }

    // --- Command handling ---
    if (text.startsWith('/')) {
      await this.handleCommand(text, userId, openKfid);
      return;
    }

    // --- Rate limit ---
    if (!rateLimiterService.isAllowed(userId)) {
      const retryAfter = rateLimiterService.retryAfterSeconds(userId);
      await wecomService.sendMessage(openKfid, userId, MESSAGES.rateLimited(retryAfter));
      await this.logChat({ userId, openKfid, text, intent: 'rate_limited', status: 'rate_limited', latencyMs: Date.now() - startedAt });
      return;
    }

    // --- Session check ---
    const session = await knex('user_sessions').where('session_id', userId).first();
    if (!session) {
      await wecomService.sendMessage(openKfid, userId, MESSAGES.notLoggedIn());
      await this.logChat({ userId, openKfid, text, intent: 'unauthorized', status: 'unauthorized', latencyMs: Date.now() - startedAt });
      return;
    }

    // --- User access ---
    const user = await knex('user_access').where('email', session.email).first();
    if (!user) {
      await wecomService.sendMessage(openKfid, userId, MESSAGES.notLoggedIn());
      return;
    }

    const rights: string[] = typeof user.access_rights === 'string'
      ? JSON.parse(user.access_rights)
      : user.access_rights || [];

    // --- Classify WeCom-specific intent ---
    let intentResult: WeComIntentResult;
    try {
      intentResult = await intentClassifier.classifyWeComIntent(text);
    } catch {
      intentResult = { intent: 'agent.forward' };
    }

    log.info(`Intent: ${intentResult.intent} | userId=${userId}`);

    let responseText: string | null = null;
    let agentUsed: string | null = intentResult.intent;
    let status: 'success' | 'error' = 'success';

    try {
      switch (intentResult.intent) {
        // --- Monitoring commands ---
        case 'monitoring.enable': {
          responseText = await this.handleMonitoringEnable(intentResult, userId, openKfid, session.email);
          break;
        }
        case 'monitoring.disable': {
          const count = await wecomMonitoringService.disableRulesByUser(userId);
          responseText = count > 0
            ? `✅ *${count} monitoring rule* telah dinonaktifkan.`
            : `ℹ️ Tidak ada monitoring aktif untuk dinonaktifkan.`;
          break;
        }
        case 'monitoring.list': {
          responseText = await this.handleMonitoringList(userId);
          break;
        }
        case 'monitoring.update': {
          responseText = `ℹ️ Untuk mengubah threshold, nonaktifkan monitoring lama dan aktifkan kembali dengan threshold baru.\n\nContoh: "Pantau CPU, threshold 80%"`;
          break;
        }

        // --- Server queries (single metric) ---
        case 'server.cpu':
        case 'server.ram':
        case 'server.disk':
        case 'server.status': {
          responseText = await this.handleServerQuery(intentResult.intent, rights, text);
          agentUsed = 'ai-server';
          break;
        }

        // --- Forward ke agent ---
        case 'agent.forward':
        default: {
          const targetAgents = await intentClassifier.classify(text);
          if (targetAgents.length === 0) {
            responseText = MESSAGES.aiError();
            status = 'error';
          } else {
            const allowedAgents = targetAgents.filter(a => rights.includes(a) || rights.includes('*'));
            if (allowedAgents.length === 0) {
              responseText = MESSAGES.noAccess(targetAgents);
              status = 'error';
            } else {
              const agentResponses = await routingService.route(text, allowedAgents);
              const respondedAgents = Object.keys(agentResponses);
              if (respondedAgents.length === 0) {
                responseText = MESSAGES.aiError();
                status = 'error';
              } else if (respondedAgents.length === 1) {
                agentUsed = respondedAgents[0];
                responseText = agentResponses[agentUsed];
              } else {
                agentUsed = respondedAgents.join('+');
                responseText = await aggregationService.aggregate(text, agentResponses);
              }
            }
          }
          break;
        }
      }
    } catch (e: any) {
      log.error('Error saat memproses:', e);
      responseText = MESSAGES.aiError();
      status = 'error';
    }

    const latencyMs = Date.now() - startedAt;

    // --- Kirim respons ---
    if (responseText) {
      await wecomService.sendMessage(openKfid, userId, responseText);
    }

    // --- Log ke DB ---
    await this.logChat({
      userId,
      openKfid,
      text,
      response: responseText,
      intent: agentUsed,
      status,
      latencyMs,
    });

    log.info(`Selesai userId=${userId} latency=${latencyMs}ms intent=${agentUsed}`);
  }

  // -------------------------------------------------------------------------
  // handleMonitoringEnable — aktifkan monitoring rules
  // -------------------------------------------------------------------------
  private async handleMonitoringEnable(
    intentResult: WeComIntentResult,
    userId: string,
    openKfid: string,
    email: string,
  ): Promise<string> {
    const metrics = intentResult.metrics ?? ['cpu', 'ram'];
    const threshold = intentResult.threshold ?? 80;

    if (threshold < 1 || threshold > 100) {
      return `❗ Threshold harus antara 1–100%.`;
    }

    // Nonaktifkan rules lama yang sama (untuk replace)
    for (const metric of metrics) {
      const existing = await wecomMonitoringService.getUserRules(userId);
      const sameMetric = existing.filter(r => r.metric === metric);
      for (const r of sameMetric) {
        await wecomMonitoringService.disableRulesByUser(userId, r.id);
      }
    }

    // Buat rules baru
    const created: string[] = [];
    for (const metric of metrics) {
      await wecomMonitoringService.createRule({
        userId,
        openKfid,
        email,
        metric: metric as any,
        threshold,
        cooldownMinutes: 10,
      });
      created.push(metric.toUpperCase());
    }

    return [
      `✅ *Monitoring Diaktifkan*`,
      ``,
      `📊 Metrik: ${created.join(', ')}`,
      `🎯 Threshold: ${threshold}%`,
      `⏱️ Interval: setiap 1 menit`,
      `🔔 Cooldown notifikasi: 10 menit`,
      ``,
      `Saya akan mengirim notifikasi jika nilai melebihi threshold.`,
    ].join('\n');
  }

  // -------------------------------------------------------------------------
  // handleMonitoringList — tampilkan daftar monitoring aktif user
  // -------------------------------------------------------------------------
  private async handleMonitoringList(userId: string): Promise<string> {
    const rules = await wecomMonitoringService.getUserRules(userId);
    if (rules.length === 0) {
      return `ℹ️ Tidak ada monitoring yang aktif.\n\nAktifkan dengan: "Pantau CPU dan RAM, threshold 70%"`;
    }

    const metricLabel: Record<string, string> = { cpu: 'CPU', ram: 'RAM', disk: 'Disk' };
    const lines = rules.map((r, i) =>
      `${i + 1}. ${metricLabel[r.metric] ?? r.metric}: ≥${r.threshold}% (cooldown: ${r.cooldown_minutes} menit)`
    );

    return [`📡 *Monitoring Aktif (${rules.length}):*`, '', ...lines].join('\n');
  }

  // -------------------------------------------------------------------------
  // handleServerQuery — query ke AI-Server untuk status metrik server
  // -------------------------------------------------------------------------
  private async handleServerQuery(
    intent: string,
    rights: string[],
    originalText: string,
  ): Promise<string> {
    const hasServerAccess = rights.includes('ai-server') || rights.includes('*');
    if (!hasServerAccess) {
      return MESSAGES.noAccess(['ai-server']);
    }

    // Gunakan routing ke ai-server
    const queryMap: Record<string, string> = {
      'server.status': 'Bagaimana kondisi server sekarang? Tampilkan CPU, RAM, dan Disk.',
      'server.cpu':    'Berapa penggunaan CPU server sekarang?',
      'server.ram':    'Berapa penggunaan RAM/memori server sekarang?',
      'server.disk':   'Berapa penggunaan disk/storage server sekarang?',
    };

    const query = queryMap[intent] ?? originalText;
    const agentResponses = await routingService.route(query, ['ai-server']);

    return agentResponses['ai-server'] ?? MESSAGES.aiError();
  }

  // -------------------------------------------------------------------------
  // handleCommand — /login, /logout, /status, /help, /start
  // -------------------------------------------------------------------------
  private async handleCommand(
    text: string,
    userId: string,
    openKfid: string,
  ): Promise<void> {
    const parts = text.split(/\s+/);
    const command = parts[0].toLowerCase();

    switch (command) {
      case '/start':
        await wecomService.sendMessage(openKfid, userId, MESSAGES.welcome());
        break;

      case '/help':
        await wecomService.sendMessage(openKfid, userId, MESSAGES.help());
        break;

      case '/login': {
        const email = parts[1]?.trim().toLowerCase();
        if (!email) {
          await wecomService.sendMessage(openKfid, userId, '❗ Format: /login email@perusahaan.com');
          return;
        }
        const userAccess = await knex('user_access').where('email', email).first();
        if (!userAccess) {
          await wecomService.sendMessage(openKfid, userId, `❌ Email *${email}* tidak terdaftar.\nHubungi administrator.`);
          return;
        }
        await knex('user_sessions')
          .insert({ session_id: userId, email: userAccess.email })
          .onConflict('session_id')
          .merge({ email: userAccess.email, updated_at: new Date() });
        await knex('wecom_users')
          .where('wecom_user_id', userId)
          .update({ email: userAccess.email, updated_at: new Date() });

        const rights: string[] = typeof userAccess.access_rights === 'string'
          ? JSON.parse(userAccess.access_rights)
          : userAccess.access_rights || [];

        await wecomService.sendMessage(
          openKfid, userId,
          `✅ *Login berhasil!*\n\nAkun: ${userAccess.email}\nAkses: ${rights.join(', ') || 'tidak ada akses khusus'}\n\nSilakan ajukan pertanyaan Anda.`,
        );
        log.info(`User ${email} login via WeCom userId=${userId}`);
        break;
      }

      case '/logout': {
        await knex('user_sessions').where('session_id', userId).delete();
        await knex('wecom_users').where('wecom_user_id', userId).update({ email: null, updated_at: new Date() });
        await wecomService.sendMessage(openKfid, userId, '👋 Logout berhasil. Gunakan /login untuk masuk kembali.');
        log.info(`userId=${userId} logout.`);
        break;
      }

      case '/status': {
        const session = await knex('user_sessions').where('session_id', userId).first();
        if (!session) {
          await wecomService.sendMessage(openKfid, userId, MESSAGES.notLoggedIn());
        } else {
          const userAccess = await knex('user_access').where('email', session.email).first();
          const rights: string[] = typeof userAccess?.access_rights === 'string'
            ? JSON.parse(userAccess.access_rights)
            : userAccess?.access_rights || [];
          await wecomService.sendMessage(
            openKfid, userId,
            `ℹ️ *Status Login*\n\nAkun: ${session.email}\nAkses: ${rights.join(', ') || 'tidak ada'}\nWeCom ID: \`${userId}\``,
          );
        }
        break;
      }

      default:
        await wecomService.sendMessage(
          openKfid, userId,
          `❓ Perintah tidak dikenal: \`${command}\`\nKetik /help untuk panduan.`,
        );
    }
  }

  // -------------------------------------------------------------------------
  // logChat — log interaksi ke wecom_chat_logs
  // -------------------------------------------------------------------------
  private async logChat(entry: {
    userId: string;
    openKfid: string;
    text: string;
    response?: string | null;
    intent?: string | null;
    status: string;
    latencyMs?: number;
  }): Promise<void> {
    try {
      await knex('wecom_chat_logs').insert({
        user_id: entry.userId,
        open_kfid: entry.openKfid,
        message: entry.text,
        response: entry.response ?? null,
        intent: entry.intent ?? null,
        latency_ms: entry.latencyMs ?? null,
        status: entry.status,
      });
    } catch (e) {
      log.error('Gagal menyimpan wecom_chat_logs:', e);
    }
  }

  // -------------------------------------------------------------------------
  // GET /wecom/info — bot info (admin)
  // -------------------------------------------------------------------------
  async getBotInfo(_req: Request, res: Response): Promise<void> {
    if (!wecomService.isConfigured()) {
      res.status(503).json({ error: 'WECOM_BOT_ID atau WECOM_SECRET belum dikonfigurasi.' });
      return;
    }
    const info = await wecomService.getBotInfo();
    res.json({ configured: true, bot: info });
  }

  // -------------------------------------------------------------------------
  // POST /wecom/test-alert — manual test endpoint for WeCom alert notification
  // -------------------------------------------------------------------------
  async testAlert(req: Request, res: Response): Promise<void> {
    const { user_id, message } = req.body;

    if (!user_id || !message) {
      res.status(400).json({ error: 'user_id dan message wajib diisi dalam request body.' });
      return;
    }

    try {
      // Kita kirim null/undefined untuk openKfid karena ini pengujian non-KF mode
      await wecomService.sendAlert(null, user_id, message);
      res.json({ success: true, message: `Alert berhasil dikirim ke user: ${user_id}` });
    } catch (e: any) {
      log.error(`Gagal mengirim test alert ke ${user_id}:`, e);
      res.status(500).json({ error: 'Gagal mengirim pesan', details: e.message });
    }
  }
}

export const wecomController = new WeComController();
