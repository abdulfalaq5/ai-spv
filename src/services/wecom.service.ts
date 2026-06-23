// =============================================================================
// WeComService — thin wrapper sekitar WeCom Intelligent AI Bot API
// =============================================================================
// Auth: Bot ID + Secret → access_token (2 jam TTL)
// Endpoint referensi: https://qyapi.weixin.qq.com/cgi-bin/
// =============================================================================

import axios from 'axios';
import { env } from '../config/env';

const log = {
  info: (msg: string) => console.log(`[WECOM] ${new Date().toISOString()} ${msg}`),
  warn: (msg: string) => console.warn(`[WECOM] ${new Date().toISOString()} ${msg}`),
  error: (msg: string, e?: unknown) => console.error(`[WECOM] ${new Date().toISOString()} ${msg}`, e ?? ''),
};

const WECOM_API_BASE = 'https://qyapi.weixin.qq.com/cgi-bin';

// ---------------------------------------------------------------------------
// Token cache
// ---------------------------------------------------------------------------
interface TokenCache {
  token: string;
  expiresAt: number; // ms epoch
}

// ---------------------------------------------------------------------------
// WeCom Intelligent AI Bot message types
// ---------------------------------------------------------------------------
export interface WeComTextMessage {
  msgtype: 'text';
  text: { content: string };
}

export type WeComMessage = WeComTextMessage;

// ---------------------------------------------------------------------------
// WeComService
// ---------------------------------------------------------------------------
export class WeComService {
  private tokenCache: TokenCache | null = null;

  /** Check apakah credentials tersedia */
  isConfigured(): boolean {
    return !!(env.WECOM_BOT_ID && env.WECOM_SECRET);
  }

  // ---------------------------------------------------------------------------
  // getAccessToken — fetch + cache access_token (TTL 2 jam, refresh 5 menit awal)
  // ---------------------------------------------------------------------------
  async getAccessToken(): Promise<string> {
    const now = Date.now();

    // Return cached token jika masih valid (dengan buffer 5 menit)
    if (this.tokenCache && this.tokenCache.expiresAt - now > 5 * 60 * 1000) {
      return this.tokenCache.token;
    }

    if (!this.isConfigured()) {
      throw new Error('WECOM_BOT_ID atau WECOM_SECRET belum dikonfigurasi.');
    }

    try {
      // WeCom Intelligent AI Bot token endpoint
      const res = await axios.get(`${WECOM_API_BASE}/bot/get_token`, {
        params: {
          bot_id: env.WECOM_BOT_ID,
          secret: env.WECOM_SECRET,
        },
        timeout: 10_000,
      });

      const data = res.data;

      // WeCom returns errcode 0 on success
      if (data?.errcode !== 0 && data?.errcode !== undefined) {
        throw new Error(`WeCom API error ${data.errcode}: ${data.errmsg}`);
      }

      const token: string = data?.access_token ?? data?.bot_access_token;
      const expiresIn: number = data?.expires_in ?? 7200; // default 2 jam

      if (!token) {
        throw new Error('WeCom token response tidak mengandung access_token');
      }

      this.tokenCache = {
        token,
        expiresAt: now + expiresIn * 1000,
      };

      log.info(`Access token refreshed. Expires in ${expiresIn}s.`);
      return token;
    } catch (e: any) {
      log.error(`getAccessToken gagal: ${e?.message}`);
      throw e;
    }
  }

  /** Invalidate token cache (e.g., setelah menerima 42001 invalid token error) */
  invalidateToken(): void {
    this.tokenCache = null;
    log.warn('Token cache diinvalidate.');
  }

  // ---------------------------------------------------------------------------
  // sendMessage — kirim pesan teks ke user WeCom melalui Bot API
  // open_kfid : WeCom chat session ID (open_kfid dari callback)
  // userId    : WeCom sender user ID (dari callback)
  // text      : isi pesan yang akan dikirim
  // ---------------------------------------------------------------------------
  async sendMessage(openKfid: string, userId: string, text: string): Promise<void> {
    if (!this.isConfigured()) {
      log.warn('WeComService tidak terkonfigurasi — skip sendMessage.');
      return;
    }

    const message: WeComTextMessage = {
      msgtype: 'text',
      text: { content: text },
    };

    await this._send(openKfid, userId, message);
  }

  // ---------------------------------------------------------------------------
  // sendAlert — alias khusus untuk alert monitoring (tidak perlu open_kfid user)
  // Menggunakan send API langsung ke user_id atau chat
  // ---------------------------------------------------------------------------
  async sendAlert(openKfid: string, userId: string, alertText: string): Promise<void> {
    return this.sendMessage(openKfid, userId, alertText);
  }

  // ---------------------------------------------------------------------------
  // _send — internal: kirim payload ke WeCom Bot message API
  // ---------------------------------------------------------------------------
  private async _send(
    openKfid: string,
    userId: string,
    message: WeComMessage,
    retried = false,
  ): Promise<void> {
    let token: string;
    try {
      token = await this.getAccessToken();
    } catch (e: any) {
      log.error(`Gagal mendapatkan token untuk sendMessage: ${e.message}`);
      return;
    }

    try {
      const payload = {
        touser: userId,
        open_kfid: openKfid,
        ...message,
      };

      const res = await axios.post(
        `${WECOM_API_BASE}/message/send?access_token=${token}`,
        payload,
        { timeout: 10_000 },
      );

      const data = res.data;

      // errcode 42001 = token expired → refresh dan retry sekali
      if (data?.errcode === 42001 && !retried) {
        log.warn('Token expired (42001) — refresh dan retry...');
        this.invalidateToken();
        return this._send(openKfid, userId, message, true);
      }

      if (data?.errcode !== 0 && data?.errcode !== undefined) {
        log.error(`sendMessage WeCom error ${data.errcode}: ${data.errmsg}`);
        return;
      }

      log.info(`Pesan terkirim ke userId=${userId} openKfid=${openKfid}`);
    } catch (e: any) {
      log.error(`sendMessage HTTP gagal: ${e?.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // verifySignature — verifikasi signature GET callback (URL verification)
  // WeCom mengirim: GET ?msg_signature=xxx&timestamp=yyy&nonce=zzz&echostr=aaa
  // ---------------------------------------------------------------------------
  verifySignature(
    msgSignature: string,
    timestamp: string,
    nonce: string,
    token: string,
    echoStr: string,
  ): boolean {
    // WeCom signature = SHA1(sort([token, timestamp, nonce]).join(''))
    // Jika cocok, return echoStr ke WeCom sebagai verifikasi URL
    const crypto = require('crypto');
    const sortedStr = [token, timestamp, nonce].sort().join('');
    const computed = crypto.createHash('sha1').update(sortedStr).digest('hex');
    return computed === msgSignature;
  }

  // ---------------------------------------------------------------------------
  // getBotInfo — cek status bot (health check)
  // ---------------------------------------------------------------------------
  async getBotInfo(): Promise<Record<string, unknown> | null> {
    if (!this.isConfigured()) return null;
    try {
      const token = await this.getAccessToken();
      const res = await axios.get(`${WECOM_API_BASE}/bot/get_bot_info`, {
        params: { access_token: token },
        timeout: 10_000,
      });
      return res.data ?? null;
    } catch (e: any) {
      log.error(`getBotInfo gagal: ${e?.message}`);
      return null;
    }
  }
}

export const wecomService = new WeComService();
