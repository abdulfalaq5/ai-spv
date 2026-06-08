import { registryService } from '../registry/registry.service';
import { AgentClient } from '../clients/agent.client';

export class RoutingService {
  async route(question: string, agentCodes: string[]): Promise<Record<string, string>> {
    console.log(`[ROUTER] Routing question to agents: ${agentCodes.join(', ')}`);
    
    const validAgents = agentCodes
      .map(code => registryService.getAgentByCode(code))
      .filter(agent => agent !== undefined);

    if (validAgents.length === 0) {
      console.warn('[ROUTER] No valid agents found for routing.');
      return {};
    }

    const promises = validAgents.map(async (agent) => {
      // agent is guaranteed to be defined here due to filter above
      const client = new AgentClient(agent!.endpoint);
      const answer = await client.ask(question);
      return { agentCode: agent!.agent_code, answer };
    });

    const results = await Promise.all(promises);

    const responseMap: Record<string, string> = {};
    for (const res of results) {
      responseMap[res.agentCode] = res.answer;
    }

    return responseMap;
  }
}

export const routingService = new RoutingService();
