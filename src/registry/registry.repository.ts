import { knex } from '../database/knex';
import type { Agent, AgentCapability } from '../types';

export class RegistryRepository {
  async getActiveAgents(): Promise<Agent[]> {
    return knex<Agent>('agent_registry').where('enabled', true);
  }

  async getCapabilities(): Promise<AgentCapability[]> {
    return knex<AgentCapability>('agent_capabilities');
  }
}
