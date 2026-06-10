import { Request, Response } from 'express';
import { knex } from '../database/knex';
import { intentClassifier } from '../router/intent-classifier';
import { routingService } from '../router/routing.service';
import { aggregationService } from '../router/aggregation.service';

/**
 * Ekstrak teks dari content yang bisa berupa string atau array content-parts.
 * OpenAI format: content = "text" | [{type:"text", text:"..."}, ...]
 */
function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((p: any) => p?.type === 'text')
      .map((p: any) => p.text ?? '')
      .join('\n')
      .trim();
  }
  return '';
}

/**
 * Hapus prefix timestamp yang ditambahkan OpenClaw pada setiap pesan.
 * Format: "[Mon 2026-06-09 09:12 UTC] pesan asli"
 */
function stripTimestamp(text: string): string {
  // Hapus prefix seperti [Mon 2026-06-09 09:12 UTC] atau [Mon 2026-06-09 09:12:34 UTC]
  return text.replace(/^\[\w{3}\s+\d{4}-\d{2}-\d{2}\s+[\d:]+\s+\w+\]\s*/, '').trim();
}

/**
 * Format response ke format OpenAI chat completions.
 */
function buildOpenAIResponse(content: string, model: string) {
  return {
    id: `chatcmpl-spv-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

/**
 * Cari email login TERAKHIR YANG BERHASIL dari riwayat percakapan.
 * Scan dari belakang: cari /login, lalu cek apakah assistant response-nya bukan penolakan.
 * OpenClaw mengirimkan seluruh history messages setiap request.
 */
function extractEmailFromHistory(
  messages: Array<{ role: string; content: unknown }>
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'user') {
      const rawText = extractText(msg.content).trim();
      const text = stripTimestamp(rawText);  // hapus timestamp OpenClaw
      if (text.startsWith('/login ')) {
        const email = text.split(' ')[1]?.trim() ?? null;
        if (!email) continue;

        // Cek apakah assistant response berikutnya adalah penolakan
        const nextMsg = messages[i + 1];
        if (nextMsg && nextMsg.role === 'assistant') {
          const nextText = extractText(nextMsg.content);
          // Jika response adalah penolakan, skip login ini
          if (
            nextText.includes('tidak terdaftar') ||
            nextText.includes('Akses ditolak') ||
            nextText.includes('ditolak')
          ) {
            continue; // login ini gagal, lanjut scan ke belakang
          }
        }

        return email; // login berhasil ditemukan
      }
    }
  }
  return null;
}

export class CompletionsController {
  async completions(req: Request, res: Response): Promise<void> {
    try {
      const { messages = [], model = 'ai-spv' } = req.body;

      // Ambil pesan user terakhir
      const lastUserMsg = [...messages]
        .reverse()
        .find((m: any) => m.role === 'user');

      if (!lastUserMsg) {
        res.status(400).json({ error: 'No user message found in messages array.' });
        return;
      }

      const rawQuestion: string = extractText(lastUserMsg.content).trim();
      // Hapus timestamp yang ditambahkan OpenClaw di depan pesan
      const question: string = stripTimestamp(rawQuestion);

      const send = (content: string) =>
        res.json(buildOpenAIResponse(content, model));

      // -----------------------------------------------------------------------
      // Tangani perintah /login
      // -----------------------------------------------------------------------
      if (question.startsWith('/login ')) {
        const email = question.split(' ')[1]?.trim();
        if (!email) {
          send('Format salah. Gunakan: /login nama@email.com');
          return;
        }

        const user = await knex('user_access').where('email', email).first();
        if (!user) {
          send('Akses ditolak. Email tidak terdaftar di sistem.');
          return;
        }

        const rights: string[] = Array.isArray(user.access_rights)
          ? user.access_rights
          : JSON.parse(user.access_rights ?? '[]');

        send(
          `✅ Login berhasil sebagai **${user.email}**.\nAnda memiliki akses ke: **${rights.join(', ')}**`
        );
        return;
      }

      // -----------------------------------------------------------------------
      // Untuk pertanyaan biasa: cari email login dari history conversation
      // OpenClaw selalu mengirimkan seluruh history, jadi kita bisa scan.
      // -----------------------------------------------------------------------
      const loggedInEmail = extractEmailFromHistory(messages);

      if (!loggedInEmail) {
        send(
          'Anda belum login. Silakan ketik:\n`/login nama@email.com`\nuntuk memulai.'
        );
        return;
      }

      // Ambil data user dan hak aksesnya
      const user = await knex('user_access').where('email', loggedInEmail).first();
      if (!user) {
        send('Akses ditolak. Email login tidak ditemukan di database.');
        return;
      }

      const rights: string[] = Array.isArray(user.access_rights)
        ? user.access_rights
        : JSON.parse(user.access_rights ?? '[]');

      console.log(
        `[COMPLETIONS] Request dari ${user.email} | akses: ${rights.join(', ')} | pertanyaan: "${question}"`
      );

      // -----------------------------------------------------------------------
      // 1. Intent Classification
      // -----------------------------------------------------------------------
      const targetAgents = await intentClassifier.classify(question);

      if (targetAgents.length === 0) {
        send('Maaf, saya tidak dapat menentukan kategori pertanyaan ini. Coba ajukan dengan lebih spesifik.');
        return;
      }

      // -----------------------------------------------------------------------
      // 2. Validasi hak akses
      // -----------------------------------------------------------------------
      const allowedAgents = targetAgents.filter(
        (agent: string) => rights.includes(agent) || rights.includes('*')
      );

      if (allowedAgents.length === 0) {
        send(
          `⛔ Akses ditolak.\n` +
          `Pertanyaan ini membutuhkan akses ke **${targetAgents.join(', ')}**, ` +
          `namun hak akses Anda hanya mencakup: **${rights.join(', ')}**.\n` +
          `Hubungi administrator untuk mengubah hak akses Anda.`
        );
        return;
      }

      // -----------------------------------------------------------------------
      // 3. Routing ke agent yang sesuai
      // -----------------------------------------------------------------------
      const agentResponses = await routingService.route(question, allowedAgents);
      const respondedAgents = Object.keys(agentResponses);

      if (respondedAgents.length === 0) {
        send('Agent yang dituju tidak dapat dihubungi saat ini.');
        return;
      }

      let answer: string;
      if (respondedAgents.length === 1) {
        answer = agentResponses[respondedAgents[0]];
      } else {
        answer = await aggregationService.aggregate(question, agentResponses);
      }

      send(answer);
    } catch (error) {
      console.error('[COMPLETIONS] Error:', error);
      res.status(500).json({ error: 'Internal server error.' });
    }
  }
}

export const completionsController = new CompletionsController();
