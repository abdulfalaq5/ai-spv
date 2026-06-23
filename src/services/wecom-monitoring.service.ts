// =============================================================================
// WeComMonitoringService — CRUD monitoring rules per-user WeCom
// =============================================================================
// Menyimpan rules ke tabel wecom_monitoring_rules (PostgreSQL via Knex).
// Setiap rule berisi: user_id, open_kfid, metric, threshold, cooldown.
// =============================================================================

import { knex } from '../database/knex';

const log = {
  info: (msg: string) => console.log(`[WECOM-MON] ${new Date().toISOString()} ${msg}`),
  warn: (msg: string) => console.warn(`[WECOM-MON] ${new Date().toISOString()} ${msg}`),
  error: (msg: string, e?: unknown) => console.error(`[WECOM-MON] ${new Date().toISOString()} ${msg}`, e ?? ''),
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type MonitoringMetric = 'cpu' | 'ram' | 'disk';

export interface WeComMonitoringRule {
  id: string;
  user_id: string;
  open_kfid: string | null;
  email: string | null;
  metric: MonitoringMetric;
  threshold: number;
  cooldown_minutes: number;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CreateRuleInput {
  userId: string;
  openKfid?: string | null;
  email?: string | null;
  metric: MonitoringMetric;
  threshold: number;
  cooldownMinutes?: number;
}

// ---------------------------------------------------------------------------
// WeComMonitoringService
// ---------------------------------------------------------------------------
export class WeComMonitoringService {
  // ---------------------------------------------------------------------------
  // createRule — buat monitoring rule baru untuk user
  // ---------------------------------------------------------------------------
  async createRule(input: CreateRuleInput): Promise<WeComMonitoringRule> {
    const [rule] = await knex('wecom_monitoring_rules')
      .insert({
        user_id: input.userId,
        open_kfid: input.openKfid ?? null,
        email: input.email ?? null,
        metric: input.metric,
        threshold: input.threshold,
        cooldown_minutes: input.cooldownMinutes ?? 10,
        enabled: true,
      })
      .returning('*');

    log.info(`Rule dibuat: userId=${input.userId} metric=${input.metric} threshold=${input.threshold}%`);
    return rule as WeComMonitoringRule;
  }

  // ---------------------------------------------------------------------------
  // getUserRules — list rules aktif milik user
  // ---------------------------------------------------------------------------
  async getUserRules(userId: string): Promise<WeComMonitoringRule[]> {
    return knex('wecom_monitoring_rules')
      .where({ user_id: userId, enabled: true })
      .orderBy('created_at', 'asc') as Promise<WeComMonitoringRule[]>;
  }

  // ---------------------------------------------------------------------------
  // getAllActiveRules — dipakai oleh scheduler global
  // ---------------------------------------------------------------------------
  async getAllActiveRules(): Promise<WeComMonitoringRule[]> {
    return knex('wecom_monitoring_rules')
      .where({ enabled: true })
      .orderBy('created_at', 'asc') as Promise<WeComMonitoringRule[]>;
  }

  // ---------------------------------------------------------------------------
  // disableRulesByUser — nonaktifkan semua rules milik user
  // Jika ruleId diberikan, nonaktifkan hanya rule tersebut
  // ---------------------------------------------------------------------------
  async disableRulesByUser(userId: string, ruleId?: string): Promise<number> {
    const query = knex('wecom_monitoring_rules').where({ user_id: userId, enabled: true });
    if (ruleId) query.andWhere({ id: ruleId });

    const count = await query.update({ enabled: false, updated_at: new Date() });
    log.info(`Disabled ${count} rule(s) untuk userId=${userId}`);
    return count;
  }

  // ---------------------------------------------------------------------------
  // updateThreshold — ubah threshold rule
  // ---------------------------------------------------------------------------
  async updateThreshold(ruleId: string, userId: string, threshold: number): Promise<boolean> {
    const count = await knex('wecom_monitoring_rules')
      .where({ id: ruleId, user_id: userId })
      .update({ threshold, updated_at: new Date() });
    return count > 0;
  }

  // ---------------------------------------------------------------------------
  // logAlert — catat alert yang terkirim ke audit log
  // ---------------------------------------------------------------------------
  async logAlert(ruleId: string, metric: string, value: number, message: string): Promise<void> {
    try {
      await knex('wecom_alert_logs').insert({
        rule_id: ruleId,
        metric,
        value,
        message,
      });
    } catch (e) {
      log.error('Gagal menyimpan alert log:', e);
    }
  }

  // ---------------------------------------------------------------------------
  // getAlertHistory — riwayat alert untuk satu rule
  // ---------------------------------------------------------------------------
  async getAlertHistory(ruleId: string, limit = 10): Promise<any[]> {
    return knex('wecom_alert_logs')
      .where({ rule_id: ruleId })
      .orderBy('sent_at', 'desc')
      .limit(limit);
  }

  // ---------------------------------------------------------------------------
  // deleteUserRules — hapus semua rules milik user (hard delete)
  // ---------------------------------------------------------------------------
  async deleteUserRules(userId: string): Promise<number> {
    const count = await knex('wecom_monitoring_rules').where({ user_id: userId }).delete();
    log.info(`Deleted ${count} rule(s) untuk userId=${userId}`);
    return count;
  }
}

export const wecomMonitoringService = new WeComMonitoringService();
