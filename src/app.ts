import express from 'express';
import { env } from './config/env';
import askRouter from './routes/ask.route';
import completionsRouter from './routes/completions.route';
import notifyRouter from './routes/notify.route';
import telegramRouter from './routes/telegram.route';
import { registryService } from './registry/registry.service';

const app = express();

app.use(express.json());

// Routes
app.use('/ask', askRouter);
app.use('/v1', completionsRouter); // OpenAI-compatible endpoint untuk OpenClaw
app.use('/notify', notifyRouter);
app.use('/telegram', telegramRouter); // Telegram Bot webhook


// Health Endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'ai-spv'
  });
});

async function bootstrap() {
  try {
    // Start Registry Service cache loop
    await registryService.start();

    app.listen(env.PORT, () => {
      console.log(`[SPV] Service listening on port ${env.PORT}`);
    });
  } catch (error) {
    console.error('[SPV] Failed to start service:', error);
    process.exit(1);
  }
}

bootstrap();

export default app;
