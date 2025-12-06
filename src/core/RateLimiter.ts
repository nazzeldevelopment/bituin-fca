import { Logger } from './Logger';

export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private capacity: number;
  private refillMs: number;
  private logger: Logger;

  constructor(capacity = 1000, refillMs = 60_000) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.refillMs = refillMs;
    this.lastRefill = Date.now();
    this.logger = new Logger('RATELIMIT');
    
    this.logger.info(`Rate limiter initialized: ${capacity} tokens / ${refillMs}ms`);
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    
    if (elapsed > this.refillMs) {
      const refillCount = Math.floor(elapsed / this.refillMs);
      const tokensToAdd = refillCount * this.capacity;
      this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
      this.lastRefill = now - (elapsed % this.refillMs);
      this.logger.debug(`Refilled tokens: ${this.tokens}/${this.capacity}`);
    }
  }

  consume(count = 1): boolean {
    this.refill();
    
    if (this.tokens - count < 0) {
      this.logger.warn(`Rate limit exceeded! Requested: ${count}, Available: ${this.tokens}`);
      return false;
    }
    
    this.tokens -= count;
    this.logger.debug(`Consumed ${count} token(s). Remaining: ${this.tokens}`);
    return true;
  }

  getRemaining(): number {
    this.refill();
    return this.tokens;
  }

  reset(): void {
    this.tokens = this.capacity;
    this.lastRefill = Date.now();
    this.logger.info('Rate limiter reset');
  }

  getStatus(): { tokens: number; capacity: number; refillMs: number } {
    return {
      tokens: this.tokens,
      capacity: this.capacity,
      refillMs: this.refillMs
    };
  }
}
