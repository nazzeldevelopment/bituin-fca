import { Logger } from './Logger';

export interface CooldownEntry {
  key: string;
  expiresAt: number;
  duration: number;
  metadata?: any;
}

export interface CooldownConfig {
  defaultCooldown: number;
  cleanupInterval: number;
  maxEntries: number;
}

export class CooldownManager {
  private map: Map<string, CooldownEntry> = new Map();
  private defaultCooldownMs: number;
  private maxEntries: number;
  private logger: Logger;
  private cleanupTimer?: NodeJS.Timeout;
  private adminBypass: Set<string> = new Set();
  private globalCooldownUntil = 0;

  constructor(config?: Partial<CooldownConfig>) {
    this.defaultCooldownMs = config?.defaultCooldown || 3000;
    this.maxEntries = config?.maxEntries || 10000;
    this.logger = new Logger('COOLDOWN');
    
    this.startCleanup(config?.cleanupInterval || 60000);
    this.logger.info(`Cooldown manager initialized: ${this.defaultCooldownMs}ms default`);
  }

  private startCleanup(interval: number): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, interval);
  }

  allowed(key: string, customCooldown?: number): boolean {
    if (this.adminBypass.has(key.split(':')[0])) {
      return true;
    }

    const now = Date.now();
    
    if (now < this.globalCooldownUntil) {
      const remaining = Math.ceil((this.globalCooldownUntil - now) / 1000);
      this.logger.debug(`Global cooldown active: ${remaining}s remaining`);
      return false;
    }
    
    const entry = this.map.get(key);
    if (entry && now < entry.expiresAt) {
      const remaining = Math.ceil((entry.expiresAt - now) / 1000);
      this.logger.debug(`Cooldown active for "${key}": ${remaining}s remaining`);
      return false;
    }
    
    const duration = customCooldown || this.defaultCooldownMs;
    this.map.set(key, {
      key,
      expiresAt: now + duration,
      duration
    });
    
    if (this.map.size > this.maxEntries) {
      this.cleanup();
    }
    
    return true;
  }

  check(key: string): boolean {
    if (this.adminBypass.has(key.split(':')[0])) {
      return true;
    }

    const now = Date.now();
    
    if (now < this.globalCooldownUntil) {
      return false;
    }
    
    const entry = this.map.get(key);
    return !entry || now >= entry.expiresAt;
  }

  set(key: string, durationMs: number, metadata?: any): void {
    this.map.set(key, {
      key,
      expiresAt: Date.now() + durationMs,
      duration: durationMs,
      metadata
    });
    this.logger.debug(`Cooldown set for "${key}": ${durationMs}ms`);
  }

  getRemainingTime(key: string): number {
    const now = Date.now();
    const entry = this.map.get(key);
    
    if (!entry) return 0;
    return Math.max(0, entry.expiresAt - now);
  }

  getFormattedRemaining(key: string): string {
    const remaining = this.getRemainingTime(key);
    if (remaining === 0) return 'Ready';
    
    const seconds = Math.ceil(remaining / 1000);
    if (seconds < 60) return `${seconds}s`;
    
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}m ${secs}s`;
  }

  reset(key: string): void {
    this.map.delete(key);
    this.logger.debug(`Cooldown reset for "${key}"`);
  }

  resetPattern(pattern: string): number {
    let count = 0;
    const regex = new RegExp(pattern);
    
    for (const key of this.map.keys()) {
      if (regex.test(key)) {
        this.map.delete(key);
        count++;
      }
    }
    
    this.logger.debug(`Reset ${count} cooldowns matching ${pattern}`);
    return count;
  }

  resetAll(): void {
    this.map.clear();
    this.globalCooldownUntil = 0;
    this.logger.info('All cooldowns reset');
  }

  setGlobalCooldown(durationMs: number): void {
    this.globalCooldownUntil = Date.now() + durationMs;
    this.logger.warn(`Global cooldown set for ${durationMs}ms`);
  }

  clearGlobalCooldown(): void {
    this.globalCooldownUntil = 0;
    this.logger.info('Global cooldown cleared');
  }

  isGlobalCooldownActive(): boolean {
    return Date.now() < this.globalCooldownUntil;
  }

  addAdminBypass(identifier: string): void {
    this.adminBypass.add(identifier);
    this.logger.debug(`Admin bypass added: ${identifier}`);
  }

  removeAdminBypass(identifier: string): void {
    this.adminBypass.delete(identifier);
    this.logger.debug(`Admin bypass removed: ${identifier}`);
  }

  isAdmin(identifier: string): boolean {
    return this.adminBypass.has(identifier);
  }

  setDefaultCooldown(ms: number): void {
    this.defaultCooldownMs = ms;
    this.logger.info(`Default cooldown changed to ${ms}ms`);
  }

  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, entry] of this.map.entries()) {
      if (now >= entry.expiresAt) {
        this.map.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      this.logger.debug(`Cleaned up ${cleaned} expired cooldowns`);
    }
  }

  getActiveCount(): number {
    const now = Date.now();
    let count = 0;
    
    for (const entry of this.map.values()) {
      if (now < entry.expiresAt) {
        count++;
      }
    }
    
    return count;
  }

  getStats(): {
    activeCount: number;
    totalEntries: number;
    adminBypasses: number;
    globalCooldownActive: boolean;
    defaultCooldown: number;
  } {
    return {
      activeCount: this.getActiveCount(),
      totalEntries: this.map.size,
      adminBypasses: this.adminBypass.size,
      globalCooldownActive: this.isGlobalCooldownActive(),
      defaultCooldown: this.defaultCooldownMs
    };
  }

  getEntry(key: string): CooldownEntry | undefined {
    return this.map.get(key);
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.map.clear();
    this.adminBypass.clear();
    this.logger.info('Cooldown manager destroyed');
  }
}
