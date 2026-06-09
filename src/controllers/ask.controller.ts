import { Request, Response } from 'express';
import { intentClassifier } from '../router/intent-classifier';
import { routingService } from '../router/routing.service';
import { aggregationService } from '../router/aggregation.service';
import { knex } from '../database/knex';

export class AskController {
  async ask(req: Request, res: Response): Promise<void> {
    try {
      // Default userId jika request tidak memiliki identifikasi (misal dari REST biasa)
      const { question, userId = 'default_user' } = req.body;
      
      if (!question || typeof question !== 'string') {
        res.status(400).json({ error: 'Question is required and must be a string.' });
        return;
      }

      // [BARU] Logika /login
      if (question.startsWith('/login ')) {
        const email = question.split(' ')[1]?.trim();
        if (!email) {
          res.json({ answer: 'Silakan sertakan email. Format: /login nama@email.com' });
          return;
        }

        const user = await knex('user_access').where('email', email).first();
        if (!user) {
          res.json({ answer: 'Akses ditolak. Email tidak terdaftar di sistem.' });
          return;
        }

        // Simpan sesi login
        await knex('user_sessions')
          .insert({ session_id: userId, email: user.email })
          .onConflict('session_id')
          .merge();

        const rights = typeof user.access_rights === 'string' 
          ? JSON.parse(user.access_rights) 
          : user.access_rights || [];

        res.json({ answer: `Login berhasil sebagai ${user.email}. Anda memiliki akses ke: ${Array.isArray(rights) ? rights.join(', ') : JSON.stringify(rights)}` });
        return;
      }

      // Validasi sesi untuk request pertanyaan biasa
      const session = await knex('user_sessions').where('session_id', userId).first();
      if (!session) {
        res.json({ answer: 'Anda belum login. Silakan gunakan perintah /login <email> terlebih dahulu.' });
        return;
      }

      const user = await knex('user_access').where('email', session.email).first();
      if (!user) {
        res.json({ answer: 'Akses ditolak. Sesi tidak valid atau pengguna telah dihapus.' });
        return;
      }

      const rights: string[] = typeof user.access_rights === 'string' 
        ? JSON.parse(user.access_rights) 
        : user.access_rights || [];

      console.log(`[SPV] Received ask request from ${user.email} (userId: ${userId}): "${question}"`);

      // 1. Intent Classification
      const targetAgents = await intentClassifier.classify(question);
      
      if (targetAgents.length === 0) {
        res.status(404).json({ error: 'No suitable agent found to answer the question.' });
        return;
      }

      // [BARU] Validasi hak akses berdasarkan intent
      const allowedAgents = targetAgents.filter(agent => rights.includes(agent) || rights.includes('*'));
      if (allowedAgents.length === 0) {
        res.json({ answer: `Maaf, Anda tidak memiliki hak akses ke agen yang dibutuhkan untuk pertanyaan ini (${targetAgents.join(', ')}).` });
        return;
      }

      // 2. Routing Logic (Single or Multi-Agent)
      // Hanya kirim pertanyaan ke agen yang diizinkan (allowedAgents)
      const agentResponses = await routingService.route(question, allowedAgents);
      const respondedAgents = Object.keys(agentResponses);

      if (respondedAgents.length === 0) {
        res.status(500).json({ error: 'Target agents failed to respond atau Anda tidak diizinkan.' });
        return;
      }

      // 3. Aggregation Logic
      if (respondedAgents.length === 1) {
        const agentCode = respondedAgents[0];
        console.log(`[SPV] Returning direct response from ${agentCode}`);
        res.json({ answer: agentResponses[agentCode] });
      } else {
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
