import { Request, Response } from 'express';
import { intentClassifier } from '../router/intent-classifier';
import { routingService } from '../router/routing.service';
import { aggregationService } from '../router/aggregation.service';

export class AskController {
  async ask(req: Request, res: Response): Promise<void> {
    try {
      const { question } = req.body;
      
      if (!question || typeof question !== 'string') {
        res.status(400).json({ error: 'Question is required and must be a string.' });
        return;
      }

      console.log(`[SPV] Received ask request: "${question}"`);

      // 1. Intent Classification
      const targetAgents = await intentClassifier.classify(question);
      
      if (targetAgents.length === 0) {
        res.status(404).json({ error: 'No suitable agent found to answer the question.' });
        return;
      }

      // 2. Routing Logic (Single or Multi-Agent)
      const agentResponses = await routingService.route(question, targetAgents);
      const respondedAgents = Object.keys(agentResponses);

      if (respondedAgents.length === 0) {
        res.status(500).json({ error: 'Target agents failed to respond.' });
        return;
      }

      // 3. Aggregation Logic
      if (respondedAgents.length === 1) {
        // Single agent response
        const agentCode = respondedAgents[0];
        console.log(`[SPV] Returning direct response from ${agentCode}`);
        res.json({ answer: agentResponses[agentCode] });
      } else {
        // Multi-agent response
        console.log(`[SPV] Aggregating responses from ${respondedAgents.join(', ')}`);
        const finalAnswer = await aggregationService.aggregate(question, agentResponses);
        res.json({ answer: finalAnswer });
      }

    } catch (error) {
      console.error('[SPV] Error processing ask request:', error);
      res.status(500).json({ error: 'Internal server error processing the request.' });
    }
  }
}

export const askController = new AskController();
