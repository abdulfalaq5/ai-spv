import express from 'express';
import { env } from './config/env';
import askRouter from './routes/ask.route';
import completionsRouter from './routes/completions.route';
import notifyRouter from './routes/notify.route';
import telegramRouter from './routes/telegram.route';
import wecomRouter from './routes/wecom.route';
import { registryService } from './registry/registry.service';
import { wecomMonitoringScheduler } from './services/wecom-monitoring-scheduler.service';

const app = express();

app.use(express.json());

// Routes
app.use('/ask', askRouter);
app.use('/v1', completionsRouter); // OpenAI-compatible endpoint untuk OpenClaw
app.use('/notify', notifyRouter);
app.use('/telegram', telegramRouter); // Telegram Bot webhook
app.use('/wecom', wecomRouter);       // WeCom Intelligent AI Bot webhook


// Health Endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'ai-spv',
    wecom_enabled: env.WECOM_ENABLED === 'true',
  });
});

async function bootstrap() {
  try {
    // Start Registry Service cache loop
    await registryService.start();

    // Start WeCom monitoring scheduler (jika WECOM_ENABLED)
    if (env.WECOM_ENABLED === 'true') {
      console.log('[SPV] WeCom enabled — starting monitoring scheduler...');
      wecomMonitoringScheduler.start();
    }

    app.listen(env.PORT, () => {
      console.log(`[SPV] Service listening on port ${env.PORT}`);
      if (env.WECOM_ENABLED === 'true') {
        console.log(`[SPV] WeCom webhook: POST /wecom/webhook`);
      }
    });
  } catch (error) {
    console.error('[SPV] Failed to start service:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  wecomMonitoringScheduler.stop();
  process.exit(0);
});
process.on('SIGINT', () => {
  wecomMonitoringScheduler.stop();
  process.exit(0);
});

bootstrap();

export default app;
