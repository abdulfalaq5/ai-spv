import OpenAI from 'openai';
import { env } from '../config/env';
import { registryService } from '../registry/registry.service';

const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
  baseURL: env.OPENAI_BASE_URL,
});

export class IntentClassifier {
  async classify(question: string): Promise<string[]> {
    console.log(`[CLASSIFIER] Classifying question: "${question}"`);

    const activeAgents = registryService.getAgents();
    const agentsContext = activeAgents.map(agent => {
      const capabilities = registryService.getCapabilitiesForAgent(agent.agent_code).map(c => c.capability);
      return `- ${agent.agent_code}: ${agent.description || ''} (Capabilities: ${capabilities.join(', ')})`;
    }).join('\n');

    const prompt = `You are an enterprise AI router.

Your task is ONLY to determine which agent should answer.

Available agents:
${agentsContext}

Return JSON only.

Example:

{
  "agents":["ai-hr"]
}

or

{
  "agents":["ai-hr","ai-server"]
}
`;

    try {
      const response = await openai.chat.completions.create({
        model: env.OPENAI_MODEL,
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: question }
        ],
        response_format: { type: 'json_object' }
      });

      const resultText = response.choices[0]?.message?.content || '{}';
      const result = JSON.parse(resultText);

      console.log(`[CLASSIFIER] Result: ${JSON.stringify(result)}`);
      return result.agents || [];
    } catch (error) {
      console.error('[CLASSIFIER] Classification failed:', error);
      return [];
    }
  }
}

export const intentClassifier = new IntentClassifier();
