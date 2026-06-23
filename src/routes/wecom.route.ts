import { Router } from 'express';
import { wecomController } from '../controllers/wecom.controller';

const router = Router();

// WeCom URL Verification (GET) + Incoming messages (POST)
router.get('/webhook', wecomController.verifyUrl.bind(wecomController));
router.post('/webhook', wecomController.handleUpdate.bind(wecomController));

// Admin: status bot
router.get('/info', wecomController.getBotInfo.bind(wecomController));

export default router;
