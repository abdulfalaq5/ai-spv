import axios, { AxiosInstance } from 'axios';
import type { AgentRequest, AgentResponse } from '../types';

export class AgentClient {
  private client: AxiosInstance;
  private retries = 3;

  constructor(private endpoint: string) {
    this.client = axios.create({
      baseURL: this.endpoint,
      timeout: 120000, // 2 minutes, LLMs can take a while
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  async ask(question: string): Promise<string> {
    for (let attempt = 1; attempt <= this.retries; attempt++) {
      try {
        const payload: AgentRequest = { question };
        const response = await this.client.post<AgentResponse>('/ask', payload);
        return response.data.answer;
      } catch (error: any) {
        if (attempt === this.retries) {
          console.error(`[AGENT-CLIENT] Error calling agent at ${this.endpoint}:`, error.message);
          return `Error: Could not reach agent at ${this.endpoint}`;
        }
        console.warn(`[AGENT-CLIENT] Attempt ${attempt} failed for ${this.endpoint}. Retrying...`);
        // Basic delay before retry
        await new Promise(res => setTimeout(res, 1000 * attempt));
      }
    }
    return `Error: Could not reach agent at ${this.endpoint}`;
  }
}
