import { Logger } from './Logger';

export interface RateLimitConfig {
  capacity: number;
  refillRate: number;
  refillInterval: number;
  burstCapacity?: number;
}

export interface EndpointLimit {
  endpoint: string;
  capacity: number;
  windowMs: number;
}

export class RateLimiter {
  private tokens: number;
  private capacity: number;
  private refillRate: number;
  private refillInterval: number;
  private lastRefill: number;
  private burstTokens: number;
  private burstCapacity: number;
  private logger: Logger;
  
  private endpointLimits: Map<string, EndpointLimit> = new Map();
  private endpointUsage: Map<string, { count: number; windowStart: number }> = new Map();
  
  private slidingWindow: number[] = [];
  private windowSize = 60000;

  constructor(capacity = 1000, refillMs = 60000, config?: Partial<RateLimitConfig>) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.refillRate = config?.refillRate || capacity;
    this.refillInterval = refillMs;
    this.lastRefill = Date.now();
    this.burstCapacity = config?.burstCapacity || Math.floor(capacity * 0.2);
    this.burstTokens = this.burstCapacity;
    this.logger = new Logger('RATELIMIT');
    
    this.logger.info(`Rate limiter initialized: ${capacity} tokens / ${refillMs}ms`);
    
    setInterval(() => this.cleanupWindow(), 10000);
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    
    if (elapsed >= this.refillInterval) {
      const periods = Math.floor(elapsed / this.refillInterval);
      const tokensToAdd = periods * this.refillRate;
      
      this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
      this.burstTokens = Math.min(this.burstCapacity, this.burstTokens + Math.floor(tokensToAdd * 0.2));
      this.lastRefill = now - (elapsed % this.refillInterval);
      
      this.logger.debug(`Refilled tokens: ${this.tokens}/${this.capacity}`);
    }
  }

  private cleanupWindow(): void {
    const cutoff = Date.now() - this.windowSize;
    this.slidingWindow = this.slidingWindow.filter(t => t > cutoff);
  }

  consume(count = 1): boolean {
    this.refill();
    
    const requestsInWindow = this.slidingWindow.length;
    if (requestsInWindow >= this.capacity) {
      this.logger.warn('Sliding window limit reached');
      return false;
    }
    
    if (this.tokens >= count) {
      this.tokens -= count;
      this.slidingWindow.push(Date.now());
      this.logger.debug(`Consumed ${count} token(s). Remaining: ${this.tokens}`);
      return true;
    }
    
    if (this.burstTokens >= count) {
      this.burstTokens -= count;
      this.slidingWindow.push(Date.now());
      this.logger.debug(`Used burst token. Burst remaining: ${this.burstTokens}`);
      return true;
    }
    
    this.logger.warn(`Rate limit exceeded! Requested: ${count}, Available: ${this.tokens}, Burst: ${this.burstTokens}`);
    return false;
  }

  consumeForEndpoint(endpoint: string, count = 1): boolean {
    const limit = this.endpointLimits.get(endpoint);
    
    if (limit) {
      const now = Date.now();
      let usage = this.endpointUsage.get(endpoint);
      
      if (!usage || now - usage.windowStart > limit.windowMs) {
        usage = { count: 0, windowStart: now };
      }
      
      if (usage.count + count > limit.capacity) {
        this.logger.warn(`Endpoint limit reached for ${endpoint}`);
        return false;
      }
      
      usage.count += count;
      this.endpointUsage.set(endpoint, usage);
    }
    
    return this.consume(count);
  }

  setEndpointLimit(endpoint: string, capacity: number, windowMs: number): void {
    this.endpointLimits.set(endpoint, { endpoint, capacity, windowMs });
    this.logger.debug(`Set limit for ${endpoint}: ${capacity}/${windowMs}ms`);
  }

  removeEndpointLimit(endpoint: string): void {
    this.endpointLimits.delete(endpoint);
    this.endpointUsage.delete(endpoint);
  }

  getRemaining(): number {
    this.refill();
    return this.tokens + this.burstTokens;
  }

  getTokens(): number {
    this.refill();
    return this.tokens;
  }

  getBurstTokens(): number {
    return this.burstTokens;
  }

  getRequestsInWindow(): number {
    this.cleanupWindow();
    return this.slidingWindow.length;
  }

  reset(): void {
    this.tokens = this.capacity;
    this.burstTokens = this.burstCapacity;
    this.lastRefill = Date.now();
    this.slidingWindow = [];
    this.endpointUsage.clear();
    this.logger.info('Rate limiter reset');
  }

  getStatus(): {
    tokens: number;
    burstTokens: number;
    capacity: number;
    burstCapacity: number;
    refillInterval: number;
    requestsInWindow: number;
  } {
    this.refill();
    return {
      tokens: this.tokens,
      burstTokens: this.burstTokens,
      capacity: this.capacity,
      burstCapacity: this.burstCapacity,
      refillInterval: this.refillInterval,
      requestsInWindow: this.slidingWindow.length
    };
  }

  getWaitTime(): number {
    if (this.tokens > 0 || this.burstTokens > 0) return 0;
    
    const now = Date.now();
    const nextRefill = this.lastRefill + this.refillInterval;
    return Math.max(0, nextRefill - now);
  }

  async waitForToken(): Promise<void> {
    const waitTime = this.getWaitTime();
    if (waitTime > 0) {
      this.logger.debug(`Waiting ${waitTime}ms for token`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
}
