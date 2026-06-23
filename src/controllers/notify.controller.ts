// =============================================================================
// NotifyController — receives alert payloads from ai-server and forwards
// them to OpenClaw gateway, which distributes to Telegram / Discord / Web UI
// =============================================================================

import { Request, Response } from 'express';
import axios from 'axios';
import { env } from '../config/env';

const log = {
  info: (msg: string) => console.log(`[NOTIFY] ${new Date().toISOString()} ${msg}`),
  warn: (msg: string) => console.warn(`[NOTIFY] ${new Date().toISOString()} ${msg}`),
  error: (msg: string, e?: unknown) => console.error(`[NOTIFY] ${new Date().toISOString()} ${msg}`, e ?? ''),
};

// ---------------------------------------------------------------------------
// Format a nicely structured Telegram/Discord message from the alert payload
// ---------------------------------------------------------------------------
function formatMessage(payload: {
  severity: string;
  metric: string;
  current_value: number;
  threshold: number;
  rule_name: string;
  analysis: string;
  fired_at: string;
}): string {
  const severityIcon = payload.severity === 'critical' ? '🔴' : '🟡';
  const metricLabel: Record<string, string> = {
    cpu: 'CPU',
    memory: 'RAM/Memory',
    disk: 'Disk',
    load: 'Load Average',
  };

  const firedAt = new Date(payload.fired_at).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    dateStyle: 'short',
    timeStyle: 'short',
  });

  return [
    `${severityIcon} *SERVER ALERT — ${payload.severity.toUpperCase()}*`,
    ``,
    `📌 *Rule:* ${payload.rule_name}`,
    `📊 *Metrik:* ${metricLabel[payload.metric] ?? payload.metric} = \`${payload.current_value.toFixed(1)}%\` (threshold: ${payload.threshold}%)`,
    `🕐 *Waktu:* ${firedAt} WIB`,
    ``,
    `📝 *Analisis AI:*`,
    payload.analysis,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// NotifyController
// ---------------------------------------------------------------------------
export class NotifyController {
  async notify(req: Request, res: Response): Promise<void> {
    const payload = req.body;

    // Basic validation
    if (!payload?.severity || !payload?.metric || payload?.current_value === undefined) {
      res.status(400).json({ error: 'Invalid alert payload. Required: severity, metric, current_value, threshold, rule_name, analysis, fired_at' });
      return;
    }

    log.info(`Received alert: "${payload.rule_name}" (${payload.severity}) — ${payload.metric}=${payload.current_value.toFixed(1)}%`);

    // Acknowledge immediately — notification is fire-and-forget
    res.json({ ok: true, message: 'Alert received, forwarding to OpenClaw.' });

    // Forward to OpenClaw asynchronously
    this.forwardToOpenClaw(payload).catch(e => {
      log.error('Failed to forward to OpenClaw:', e);
    });
  }

  // ---------------------------------------------------------------------------
  // Forward via OpenClaw Gateway HTTP API
  // POST http://openclaw:9001/api/v1/message/send
  // Auth: Bearer <gateway_token>
  // ---------------------------------------------------------------------------
  private async forwardToOpenClaw(payload: any): Promise<void> {
    const message = formatMessage(payload);
    const openclawUrl = env.OPENCLAW_URL ?? 'http://openclaw:9001';
    const token = env.OPENCLAW_GATEWAY_TOKEN;

    if (!token) {
      log.warn('OPENCLAW_GATEWAY_TOKEN not set — cannot forward alert to OpenClaw.');
      return;
    }

    const channel = env.OPENCLAW_NOTIFY_CHANNEL ?? 'telegram';
    const target = env.OPENCLAW_NOTIFY_TARGET;

    if (!target) {
      log.warn('OPENCLAW_NOTIFY_TARGET not set — cannot determine notification target.');
      return;
    }

    try {
      // OpenClaw Gateway HTTP API for outbound message send
      await axios.post(
        `${openclawUrl}/api/v1/message/send`,
        {
          message,
          channel,
          target,
        },
        {
          timeout: 10_000,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
        }
      );
      log.info(`Alert forwarded to OpenClaw (${channel} → ${target})`);
    } catch (e: any) {
      // Try fallback: use OpenClaw's /v1/chat/completions to inject a notification
      log.warn(`OpenClaw message API failed (${e.message}) — trying chat completions fallback...`);
      try {
        await this.forwardViaChatCompletions(message, openclawUrl, token);
      } catch (e2: any) {
        // Final fallback: send directly via Telegram Bot API
        log.warn(`Chat completions fallback also failed (${e2.message}) — trying direct Telegram API...`);
        await this.forwardDirectTelegram(message).catch(e3 => {
          log.error('Direct Telegram fallback also failed:', e3);
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Fallback: inject alert as a system message via chat completions
  // ---------------------------------------------------------------------------
  private async forwardViaChatCompletions(message: string, openclawUrl: string, token: string): Promise<void> {
    await axios.post(
      `${openclawUrl}/v1/chat/completions`,
      {
        model: 'ai-spv',
        messages: [
          {
            role: 'system',
            content: 'You are a notification relay. Forward the following server alert to the user verbatim.',
          },
          {
            role: 'user',
            content: `[SERVER ALERT - DO NOT PROCESS, RELAY AS-IS]\n\n${message}`,
          },
        ],
      },
      {
        timeout: 15_000,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      }
    );
    log.info('Alert forwarded via chat completions fallback.');
  }

  // ---------------------------------------------------------------------------
  // Final Fallback: send directly via Telegram Bot API (bypasses OpenClaw)
  // Requires TELEGRAM_PUBLIC_BOT_TOKEN and OPENCLAW_NOTIFY_TARGET (chat_id)
  // ---------------------------------------------------------------------------
  private async forwardDirectTelegram(message: string): Promise<void> {
    const botToken = env.TELEGRAM_PUBLIC_BOT_TOKEN;
    const chatId = env.OPENCLAW_NOTIFY_TARGET;

    if (!botToken || !chatId) {
      log.warn('TELEGRAM_PUBLIC_BOT_TOKEN or OPENCLAW_NOTIFY_TARGET not set — cannot use direct Telegram fallback.');
      return;
    }

    await axios.post(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      },
      { timeout: 10_000 },
    );
    log.info(`Alert sent directly via Telegram Bot API to chat_id=${chatId}`);
  }
}

export const notifyController = new NotifyController();
