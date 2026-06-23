// =============================================================================
// WeComMonitoringSchedulerService — Global 1-menit monitoring scheduler
// =============================================================================
// Flow setiap 1 menit:
//   1. Fetch semua wecom_monitoring_rules yang aktif
//   2. Fetch metrics snapshot dari AI-Server GET /metrics/snapshot
//   3. Evaluasi tiap rule terhadap snapshot
//   4. Kirim alert ke WeCom jika threshold terlampaui (via anti-spam state)
//   5. Log alert ke wecom_alert_logs
// =============================================================================

import axios from 'axios';
import { env } from '../config/env';
import { wecomMonitoringService, WeComMonitoringRule } from './wecom-monitoring.service';
import { wecomAlertStateService } from './wecom-alert-state.service';
import { wecomService } from './wecom.service';

const log = {
  info: (msg: string) => console.log(`[WECOM-SCHEDULER] ${new Date().toISOString()} ${msg}`),
  warn: (msg: string) => console.warn(`[WECOM-SCHEDULER] ${new Date().toISOString()} ${msg}`),
  error: (msg: string, e?: unknown) => console.error(`[WECOM-SCHEDULER] ${new Date().toISOString()} ${msg}`, e ?? ''),
};

// ---------------------------------------------------------------------------
// MetricsSnapshot — struktur dari AI-Server GET /metrics/snapshot
// ---------------------------------------------------------------------------
interface MetricsSnapshot {
  timestamp: string;
  cpu: {
    total_percent: number;
    load_avg_1m: number;
    cores: number;
  };
  memory: {
    used_percent: number;
    used_mb: number;
    total_mb: number;
  };
  disk: {
    max_used_percent: number;
    partitions: Array<{ mountpoint: string; used_percent: number }>;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Ambil nilai metrik dari snapshot berdasarkan nama */
function extractMetricValue(snapshot: MetricsSnapshot, metric: string): number {
  switch (metric) {
    case 'cpu':
      return snapshot.cpu.total_percent;
    case 'ram':
      return snapshot.memory.used_percent;
    case 'disk':
      return snapshot.disk.max_used_percent;
    default:
      return 0;
  }
}

/** Format pesan alert WeCom */
function formatAlertMessage(rule: WeComMonitoringRule, currentValue: number): string {
  const metricLabel: Record<string, string> = {
    cpu: 'CPU',
    ram: 'RAM',
    disk: 'Disk',
  };

  const label = metricLabel[rule.metric] ?? rule.metric.toUpperCase();
  const wib = new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    dateStyle: 'short',
    timeStyle: 'short',
  });

  return [
    `🚨 *SERVER ALERT*`,
    ``,
    `📊 *${label}:* ${currentValue.toFixed(1)}% (threshold: ${rule.threshold}%)`,
    `🕐 *Waktu:* ${wib} WIB`,
    ``,
    `⚠️ Threshold telah terlampaui.`,
    `Silakan lakukan pengecekan segera.`,
  ].join('\n');
}

/** Format pesan recovery (kondisi kembali normal) */
function formatRecoveryMessage(rule: WeComMonitoringRule, currentValue: number): string {
  const metricLabel: Record<string, string> = { cpu: 'CPU', ram: 'RAM', disk: 'Disk' };
  const label = metricLabel[rule.metric] ?? rule.metric.toUpperCase();
  return `✅ *RECOVERY:* ${label} kembali normal: ${currentValue.toFixed(1)}% (threshold: ${rule.threshold}%)`;
}

// ---------------------------------------------------------------------------
// WeComMonitoringSchedulerService
// ---------------------------------------------------------------------------
export class WeComMonitoringSchedulerService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /** Track apakah sebelumnya rule dalam kondisi breach (untuk kirim recovery notif) */
  private previousBreachState = new Map<string, boolean>();

  readonly INTERVAL_MS = 60_000; // 1 menit

  // ---------------------------------------------------------------------------
  // start — mulai scheduler global
  // ---------------------------------------------------------------------------
  start(): void {
    if (this.running) {
      log.warn('Scheduler sudah berjalan.');
      return;
    }
    this.running = true;

    log.info(`Monitoring scheduler dimulai. Interval: ${this.INTERVAL_MS / 1000}s`);

    // Jalankan sekali langsung, lalu setiap INTERVAL_MS
    this.runCycle().catch(e => log.error('Siklus pertama gagal:', e));

    this.timer = setInterval(() => {
      this.runCycle().catch(e => log.error('Siklus monitoring gagal:', e));
    }, this.INTERVAL_MS);
  }

  // ---------------------------------------------------------------------------
  // stop — hentikan scheduler
  // ---------------------------------------------------------------------------
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
    log.info('Monitoring scheduler dihentikan.');
  }

  // ---------------------------------------------------------------------------
  // runCycle — satu siklus monitoring lengkap
  // ---------------------------------------------------------------------------
  private async runCycle(): Promise<void> {
    if (!this.running) return;

    // 1. Fetch semua rules aktif
    let rules: WeComMonitoringRule[];
    try {
      rules = await wecomMonitoringService.getAllActiveRules();
    } catch (e) {
      log.error('Gagal fetch monitoring rules:', e);
      return;
    }

    if (rules.length === 0) return;

    log.info(`Mengevaluasi ${rules.length} monitoring rule(s)...`);

    // 2. Fetch metrics snapshot dari AI-Server
    let snapshot: MetricsSnapshot | null = null;
    try {
      snapshot = await this.fetchMetricsSnapshot();
    } catch (e) {
      log.error('Gagal fetch metrics snapshot dari AI-Server:', e);
      return;
    }

    if (!snapshot) return;

    log.info(
      `Snapshot: CPU=${snapshot.cpu.total_percent.toFixed(1)}% ` +
      `RAM=${snapshot.memory.used_percent.toFixed(1)}% ` +
      `Disk=${snapshot.disk.max_used_percent.toFixed(1)}%`
    );

    // 3. Evaluasi tiap rule
    for (const rule of rules) {
      await this.evaluateRule(rule, snapshot);
    }
  }

  // ---------------------------------------------------------------------------
  // evaluateRule — evaluasi satu rule terhadap snapshot
  // ---------------------------------------------------------------------------
  private async evaluateRule(rule: WeComMonitoringRule, snapshot: MetricsSnapshot): Promise<void> {
    const currentValue = extractMetricValue(snapshot, rule.metric);
    const conditionMet = currentValue >= rule.threshold;
    const wasBreaching = this.previousBreachState.get(rule.id) ?? false;

    // Update previous state
    this.previousBreachState.set(rule.id, conditionMet);

    // Evaluasi apakah perlu kirim alert (anti-spam logic)
    const shouldSendAlert = wecomAlertStateService.shouldFire(
      rule.id,
      conditionMet,
      rule.cooldown_minutes,
    );

    if (shouldSendAlert) {
      const message = formatAlertMessage(rule, currentValue);
      try {
        await wecomService.sendAlert(rule.open_kfid, rule.user_id, message);

        // Log ke DB
        await wecomMonitoringService.logAlert(
          rule.id,
          rule.metric,
          currentValue,
          message,
        );

        log.info(
          `Alert dikirim: userId=${rule.user_id} metric=${rule.metric} ` +
          `value=${currentValue.toFixed(1)}% threshold=${rule.threshold}%`
        );
      } catch (e) {
        log.error(`Gagal mengirim alert untuk rule ${rule.id}:`, e);
      }
    }

    // Kirim notifikasi recovery jika kondisi kembali normal setelah breach
    if (wasBreaching && !conditionMet) {
      try {
        const recoveryMsg = formatRecoveryMessage(rule, currentValue);
        await wecomService.sendMessage(rule.open_kfid, rule.user_id, recoveryMsg);
        log.info(`Recovery notification dikirim: userId=${rule.user_id} metric=${rule.metric}`);
      } catch (e) {
        log.error(`Gagal mengirim recovery notification untuk rule ${rule.id}:`, e);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // fetchMetricsSnapshot — GET /metrics/snapshot dari AI-Server
  // ---------------------------------------------------------------------------
  private async fetchMetricsSnapshot(): Promise<MetricsSnapshot> {
    const url = `${env.AI_SERVER_URL}/metrics/snapshot`;
    const res = await axios.get<MetricsSnapshot>(url, { timeout: 15_000 });
    return res.data;
  }
}

export const wecomMonitoringScheduler = new WeComMonitoringSchedulerService();
