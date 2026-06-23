// =============================================================================
// ChatLogService — persists Telegram chat interactions to DB
// =============================================================================

import { knex } from '../database/knex';

export interface ChatLogEntry {
  chat_id: number;
  user_id: number;
  username?: string | null;
  message: string;
  response?: string | null;
  latency_ms?: number | null;
  status: 'success' | 'error' | 'rate_limited' | 'unauthorized';
  agent_used?: string | null;
  error_message?: string | null;
}

export class ChatLogService {
  async log(entry: ChatLogEntry): Promise<void> {
    try {
      await knex('telegram_chat_logs').insert({
        chat_id: entry.chat_id,
        user_id: entry.user_id,
        username: entry.username ?? null,
        message: entry.message,
        response: entry.response ?? null,
        latency_ms: entry.latency_ms ?? null,
        status: entry.status,
        agent_used: entry.agent_used ?? null,
        error_message: entry.error_message ?? null,
      });
    } catch (err) {
      // Log errors silently — never throw, logging must not block the response flow
      console.error('[CHAT-LOG] Failed to write log entry:', err);
    }
  }
}

export const chatLogService = new ChatLogService();
