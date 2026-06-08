import { RegistryRepository } from './registry.repository';
import type { Agent, AgentCapability } from '../types';

export class RegistryService {
  private repository: RegistryRepository;
  private activeAgents: Agent[] = [];
  private capabilities: AgentCapability[] = [];
  private refreshInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.repository = new RegistryRepository();
  }

  async start(): Promise<void> {
    await this.refreshCache();
    // Auto refresh every 60 seconds
    this.refreshInterval = setInterval(() => this.refreshCache(), 60000);
    console.log('[REGISTRY] RegistryService started');
  }

  async stop(): Promise<void> {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
  }

  private async refreshCache(): Promise<void> {
    try {
      this.activeAgents = await this.repository.getActiveAgents();
      this.capabilities = await this.repository.getCapabilities();
      console.log(`[REGISTRY] Refreshed cache. Active agents: ${this.activeAgents.length}`);
    } catch (error) {
      console.error('[REGISTRY] Failed to refresh cache:', error);
    }
  }

  getAgents(): Agent[] {
    return this.activeAgents;
  }

  getAgentByCode(agentCode: string): Agent | undefined {
    return this.activeAgents.find(a => a.agent_code === agentCode);
  }

  getCapabilitiesForAgent(agentCode: string): AgentCapability[] {
    return this.capabilities.filter(c => c.agent_code === agentCode);
  }
}

export const registryService = new RegistryService();
