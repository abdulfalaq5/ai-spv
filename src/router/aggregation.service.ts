import OpenAI from 'openai';
import { env } from '../config/env';

const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
  baseURL: env.OPENAI_BASE_URL,
});

export class AggregationService {
  async aggregate(question: string, agentResponses: Record<string, string>): Promise<string> {
    console.log(`[AGGREGATION] Aggregating responses for question: "${question}"`);

    const responsesContext = Object.entries(agentResponses)
      .map(([agent, response]) => `Response from ${agent}:\n${response}`)
      .join('\n\n');

    const prompt = `You are an enterprise AI supervisor.

Combine answers from multiple specialist agents.

Do not invent information.

Only use supplied responses.`;

    const userMessage = `User question: ${question}\n\n${responsesContext}`;

    try {
      const response = await openai.chat.completions.create({
        model: env.OPENAI_MODEL,
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: userMessage }
        ]
      });

      const finalAnswer = response.choices[0]?.message?.content || 'No response could be generated.';
      console.log(`[AGGREGATION] Generated final consolidated response.`);
      return finalAnswer;
    } catch (error) {
      console.error('[AGGREGATION] Aggregation failed:', error);
      return 'Error aggregating responses.';
    }
  }
}

export const aggregationService = new AggregationService();
