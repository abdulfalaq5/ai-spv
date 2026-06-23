import { config } from 'dotenv';
import { z } from 'zod';

config();

const envSchema = z.object({
  PORT: z.string().default('9002'),
  POSTGRES_HOST: z.string().min(1),
  POSTGRES_PORT: z.string().default('5432'),
  POSTGRES_DB: z.string().min(1),
  POSTGRES_USER: z.string().min(1),
  POSTGRES_PASSWORD: z.string().min(1),
  OPENAI_BASE_URL: z.string().url().optional(),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1),
  OPENCLAW_URL: z.string().url().default('http://openclaw:9001'),
  OPENCLAW_GATEWAY_TOKEN: z.string().optional(),
  OPENCLAW_NOTIFY_CHANNEL: z.string().default('telegram'),
  OPENCLAW_NOTIFY_TARGET: z.string().optional(),
  // Telegram Public Chat Bot (ai-spv direct integration, separate from OpenClaw bot)
  TELEGRAM_PUBLIC_BOT_TOKEN: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  // WeCom Intelligent AI Bot Integration
  // Hanya membutuhkan WECOM_BOT_ID dan WECOM_SECRET dari WeCom admin panel
  WECOM_ENABLED: z.string().optional().default('false'),
  WECOM_BOT_ID: z.string().optional(),   // Bot ID dari WeCom Intelligent AI Bot
  WECOM_SECRET: z.string().optional(),    // Secret dari WeCom Intelligent AI Bot
  // URL for ai-server /metrics/snapshot (used by WeCom monitoring scheduler)
  AI_SERVER_URL: z.string().url().optional().default('http://mcp-monitoring:9003'),
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error('Invalid environment variables', _env.error.format());
  throw new Error('Invalid environment variables');
}

export const env = _env.data;
