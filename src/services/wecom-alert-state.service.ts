// =============================================================================
// WeComAlertStateService — in-memory anti-spam state machine
// =============================================================================
// Mencegah alert berulang selama kondisi masih di atas threshold.
// Alert baru hanya dikirim ketika:
//   1. Kondisi baru saja melewati threshold (false → true)  [edge trigger]
//   2. Kondisi pernah normal kembali lalu breach lagi        [re-arm after recovery]
//   3. Cooldown sudah habis (opsional, untuk per-rule TTL)
// =============================================================================

const log = {
  info: (msg: string) => console.log(`[WECOM-ALERT-STATE] ${new Date().toISOString()} ${msg}`),
};

// ---------------------------------------------------------------------------
// AlertState per rule
// ---------------------------------------------------------------------------
interface RuleAlertState {
  /** Apakah kondisi saat ini sudah breach threshold */
  conditionActive: boolean;
  /** Timestamp (ms) saat alert terakhir dikirim, undefined jika belum pernah */
  lastFiredAt?: number;
  /** Timestamp saat kondisi pertama kali breach (untuk sustained check opsional) */
  firstBreachedAt?: number;
}

// ---------------------------------------------------------------------------
// WeComAlertStateService
// ---------------------------------------------------------------------------
export class WeComAlertStateService {
  /** Map ruleId → state */
  private states = new Map<string, RuleAlertState>();

  // ---------------------------------------------------------------------------
  // shouldFire
  // Evaluasi apakah alert perlu dikirim untuk ruleId ini.
  //
  // Logic:
  //   - conditionMet=true  + sebelumnya false → FIRE (edge: normal→breach)
  //   - conditionMet=true  + sebelumnya true  → SKIP (masih breach, sudah dikirim)
  //   - conditionMet=false + sebelumnya true  → RECOVERY (update state, tidak kirim)
  //   - conditionMet=false + sebelumnya false → SKIP (normal, tidak ada apa-apa)
  //   - cooldownMinutes > 0 → re-fire jika cooldown sudah habis meski belum recovery
  // ---------------------------------------------------------------------------
  shouldFire(ruleId: string, conditionMet: boolean, cooldownMinutes = 10): boolean {
    const state = this.states.get(ruleId) ?? { conditionActive: false };
    const now = Date.now();

    if (conditionMet) {
      if (!state.conditionActive) {
        // Edge: condition baru breach → FIRE
        this.states.set(ruleId, {
          conditionActive: true,
          lastFiredAt: now,
          firstBreachedAt: now,
        });
        log.info(`Rule ${ruleId}: BREACH DETECTED — alert akan dikirim.`);
        return true;
      }

      // Masih breach — cek cooldown untuk re-fire
      if (cooldownMinutes > 0 && state.lastFiredAt) {
        const cooldownMs = cooldownMinutes * 60 * 1000;
        if (now - state.lastFiredAt >= cooldownMs) {
          // Cooldown habis → re-fire
          this.states.set(ruleId, { ...state, lastFiredAt: now });
          log.info(`Rule ${ruleId}: COOLDOWN EXPIRED — re-alert dikirim.`);
          return true;
        }
      }

      // Masih breach, cooldown belum habis → SKIP
      return false;
    } else {
      // Kondisi normal
      if (state.conditionActive) {
        // Recovery: kondisi kembali normal → reset state (arm ulang)
        this.states.set(ruleId, { conditionActive: false });
        log.info(`Rule ${ruleId}: RECOVERED — state di-reset, siap untuk alert berikutnya.`);
      }
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // getState — inspect state saat ini (untuk debug/monitoring)
  // ---------------------------------------------------------------------------
  getState(ruleId: string): RuleAlertState | undefined {
    return this.states.get(ruleId);
  }

  // ---------------------------------------------------------------------------
  // resetAll — reset semua state (e.g., saat restart scheduler)
  // ---------------------------------------------------------------------------
  resetAll(): void {
    this.states.clear();
    log.info('Semua alert state di-reset.');
  }

  // ---------------------------------------------------------------------------
  // remove — hapus state untuk satu rule (e.g., rule dihapus/dinonaktifkan)
  // ---------------------------------------------------------------------------
  remove(ruleId: string): void {
    this.states.delete(ruleId);
  }
}

export const wecomAlertStateService = new WeComAlertStateService();
