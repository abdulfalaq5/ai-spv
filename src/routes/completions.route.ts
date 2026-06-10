import { Router } from 'express';
import { completionsController } from '../controllers/completions.controller';

const router = Router();

// OpenAI-compatible chat completions endpoint
router.post('/chat/completions', completionsController.completions.bind(completionsController));

// OpenAI-compatible models list (required by some clients)
router.get('/models', (_req, res) => {
  res.json({
    object: 'list',
    data: [
      {
        id: 'ai-spv',
        object: 'model',
        created: 1700000000,
        owned_by: 'ai-spv',
      },
    ],
  });
});

export default router;
