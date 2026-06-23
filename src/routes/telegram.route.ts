import { Router } from 'express';
import { telegramController } from '../controllers/telegram.controller';

const router = Router();

// Receives updates from Telegram Bot API
router.post('/webhook', telegramController.handleUpdate.bind(telegramController));

// Admin: register webhook URL with Telegram
// POST { "url": "https://yourdomain.com/telegram/webhook" }
router.post('/setup', telegramController.setupWebhook.bind(telegramController));

// Admin: get bot info and current webhook status
router.get('/info', telegramController.getBotInfo.bind(telegramController));

export default router;
