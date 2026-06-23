import OpenAI from 'openai';
import { env } from '../config/env';
import { registryService } from '../registry/registry.service';

const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
  baseURL: env.OPENAI_BASE_URL,
});

// ---------------------------------------------------------------------------
// WeComIntent — intent khusus untuk WeCom monitoring commands
// ---------------------------------------------------------------------------
export type WeComIntent =
  | 'monitoring.enable'    // "pantau server", "aktifkan monitoring CPU"
  | 'monitoring.disable'   // "hentikan monitoring", "nonaktifkan"
  | 'monitoring.list'      // "monitoring apa yang aktif"
  | 'monitoring.update'    // "ubah threshold CPU ke 80%"
  | 'server.status'        // "kondisi server sekarang"
  | 'server.cpu'           // "berapa CPU sekarang"
  | 'server.ram'           // "berapa RAM sekarang"
  | 'server.disk'          // "berapa disk sekarang"
  | 'agent.forward';       // diteruskan ke AI-Server / agent lain

export interface WeComIntentResult {
  intent: WeComIntent;
  /** Metrik yang disebutkan: cpu, ram, disk (untuk monitoring.enable/update) */
  metrics?: Array<'cpu' | 'ram' | 'disk'>;
  /** Threshold numerik yang disebutkan (untuk monitoring.enable/update) */
  threshold?: number;
  /** Threshold per-metrik jika user menyebut threshold berbeda untuk tiap metrik */
  thresholdMap?: Partial<Record<'cpu' | 'ram' | 'disk', number>>;
}

// ---------------------------------------------------------------------------
// Keyword fallback — cepat, tanpa LLM
// ---------------------------------------------------------------------------
const MONITORING_ENABLE_KEYWORDS = [
  'pantau', 'monitor', 'aktifkan monitoring', 'mulai pantau',
  'beritahu aku', 'beri tahu', 'kabari', 'notifikasi jika',
];
const MONITORING_DISABLE_KEYWORDS = [
  'hentikan monitoring', 'stop monitoring', 'nonaktifkan', 'matikan monitoring',
  'berhenti pantau',
];
const MONITORING_LIST_KEYWORDS = [
  'monitoring apa', 'list monitoring', 'monitoring aktif', 'tampilkan monitoring',
  'daftar monitoring',
];
const SERVER_STATUS_KEYWORDS = [
  'kondisi server', 'status server', 'cek server', 'server sekarang',
  'bagaimana server', 'gimana server',
];
const CPU_KEYWORDS = ['cpu', 'processor', 'prosesor'];
const RAM_KEYWORDS = ['ram', 'memori', 'memory', 'memori'];
const DISK_KEYWORDS = ['disk', 'storage', 'penyimpanan', 'harddisk'];

function keywordFallback(text: string): WeComIntentResult | null {
  const lower = text.toLowerCase();

  if (MONITORING_DISABLE_KEYWORDS.some(k => lower.includes(k))) {
    return { intent: 'monitoring.disable' };
  }
  if (MONITORING_LIST_KEYWORDS.some(k => lower.includes(k))) {
    return { intent: 'monitoring.list' };
  }

  // Threshold detection: angka diikuti '%'
  const thresholdMatch = lower.match(/(\d+)\s*%/);
  const threshold = thresholdMatch ? parseInt(thresholdMatch[1], 10) : undefined;

  if (MONITORING_ENABLE_KEYWORDS.some(k => lower.includes(k))) {
    const metrics: Array<'cpu' | 'ram' | 'disk'> = [];
    if (CPU_KEYWORDS.some(k => lower.includes(k))) metrics.push('cpu');
    if (RAM_KEYWORDS.some(k => lower.includes(k))) metrics.push('ram');
    if (DISK_KEYWORDS.some(k => lower.includes(k))) metrics.push('disk');
    // Jika tidak disebutkan metrik spesifik, monitor cpu & ram secara default
    if (metrics.length === 0) metrics.push('cpu', 'ram');
    return { intent: 'monitoring.enable', metrics, threshold };
  }

  if (SERVER_STATUS_KEYWORDS.some(k => lower.includes(k))) {
    return { intent: 'server.status' };
  }
  if (CPU_KEYWORDS.some(k => lower.includes(k)) && lower.match(/berapa|cek|lihat|status/)) {
    return { intent: 'server.cpu' };
  }
  if (RAM_KEYWORDS.some(k => lower.includes(k)) && lower.match(/berapa|cek|lihat|status/)) {
    return { intent: 'server.ram' };
  }
  if (DISK_KEYWORDS.some(k => lower.includes(k)) && lower.match(/berapa|cek|lihat|status/)) {
    return { intent: 'server.disk' };
  }

  return null;
}

export class IntentClassifier {
  // ---------------------------------------------------------------------------
  // classify — original method: routing ke agent (Telegram + general)
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // classifyWeComIntent — deteksi WeCom monitoring commands
  // Strategi: keyword fallback dulu (cepat, <1ms), fallback ke LLM jika tidak match
  // ---------------------------------------------------------------------------
  async classifyWeComIntent(text: string): Promise<WeComIntentResult> {
    console.log(`[CLASSIFIER] WeCom intent: "${text.substring(0, 80)}"`);

    // 1. Coba keyword fallback dulu (tanpa LLM)
    const fallbackResult = keywordFallback(text);
    if (fallbackResult) {
      console.log(`[CLASSIFIER] WeCom keyword match: ${fallbackResult.intent}`);
      return fallbackResult;
    }

    // 2. LLM-based classification untuk kalimat kompleks
    const prompt = `Kamu adalah classifier intent untuk bot monitoring server WeCom.

Tugas kamu: klasifikasikan pesan user ke salah satu intent berikut.

Intent yang tersedia:
- monitoring.enable   : user ingin mengaktifkan monitoring / notifikasi threshold
- monitoring.disable  : user ingin mematikan monitoring
- monitoring.list     : user ingin melihat daftar monitoring aktif
- monitoring.update   : user ingin mengubah threshold monitoring
- server.status       : user ingin melihat kondisi umum server (CPU, RAM, Disk sekaligus)
- server.cpu          : user hanya ingin tahu CPU
- server.ram          : user hanya ingin tahu RAM
- server.disk         : user hanya ingin tahu Disk
- agent.forward       : pertanyaan umum yang harus diteruskan ke AI agent

Ekstrak juga:
- metrics: ["cpu","ram","disk"] (untuk monitoring.enable/update)
- threshold: angka persentase jika disebutkan (e.g. 70)

Return JSON saja, contoh:
{"intent":"monitoring.enable","metrics":["cpu","ram"],"threshold":70}
atau
{"intent":"server.status"}
atau
{"intent":"agent.forward"}`;

    try {
      const response = await openai.chat.completions.create({
        model: env.OPENAI_MODEL,
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: text },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 128,
      });

      const resultText = response.choices[0]?.message?.content || '{}';
      const result = JSON.parse(resultText) as WeComIntentResult;
      console.log(`[CLASSIFIER] WeCom LLM intent: ${JSON.stringify(result)}`);
      return result;
    } catch (error) {
      console.error('[CLASSIFIER] WeCom intent classification failed — fallback to agent.forward:', error);
      return { intent: 'agent.forward' };
    }
  }
}

export const intentClassifier = new IntentClassifier();
