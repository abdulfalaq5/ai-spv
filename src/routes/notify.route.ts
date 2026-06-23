import { Router } from 'express';
import { notifyController } from '../controllers/notify.controller';

const router = Router();

router.post('/', notifyController.notify.bind(notifyController));

export default router;
