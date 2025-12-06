import { Logger } from './Logger';

export class CooldownManager {
  private map: Map<string, number> = new Map();
  private cooldownMs: number;
  private logger: Logger;

  constructor(cooldownMs = 3_000) {
    this.cooldownMs = cooldownMs;
    this.logger = new Logger('COOLDOWN');
    this.logger.info(`Cooldown manager initialized: ${cooldownMs}ms default cooldown`);
  }

  allowed(key: string, customCooldown?: number): boolean {
    const now = Date.now();
    const until = this.map.get(key) || 0;
    const cd = customCooldown || this.cooldownMs;
    
    if (now < until) {
      const remaining = Math.ceil((until - now) / 1000);
      this.logger.debug(`Cooldown active for "${key}": ${remaining}s remaining`);
      return false;
    }
    
    this.map.set(key, now + cd);
    this.logger.debug(`Cooldown set for "${key}": ${cd}ms`);
    return true;
  }

  getRemainingTime(key: string): number {
    const now = Date.now();
    const until = this.map.get(key) || 0;
    return Math.max(0, until - now);
  }

  reset(key: string): void {
    this.map.delete(key);
    this.logger.debug(`Cooldown reset for "${key}"`);
  }

  resetAll(): void {
    this.map.clear();
    this.logger.info('All cooldowns reset');
  }

  setDefaultCooldown(ms: number): void {
    this.cooldownMs = ms;
    this.logger.info(`Default cooldown changed to ${ms}ms`);
  }

  cleanup(): void {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, until] of this.map.entries()) {
      if (now > until) {
        this.map.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      this.logger.debug(`Cleaned up ${cleaned} expired cooldowns`);
    }
  }
}
