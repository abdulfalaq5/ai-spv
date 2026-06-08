export interface Agent {
  id: string;
  agent_code: string;
  agent_name: string;
  endpoint: string;
  description: string | null;
  enabled: boolean;
  created_at: Date;
}

export interface AgentCapability {
  id: string;
  agent_code: string;
  capability: string;
  created_at: Date;
}

export interface AgentRequest {
  question: string;
}

export interface AgentResponse {
  answer: string;
}
