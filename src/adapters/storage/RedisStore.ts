import Redis from 'ioredis';
import { Logger } from '../../core/Logger';

export class RedisStore<T = any> {
  private client: Redis;
  private logger: Logger;
  private prefix: string;

  constructor(url?: string, prefix: string = 'bituin:') {
    this.logger = new Logger('REDIS-STORE');
    this.prefix = prefix;
    
    this.client = url ? new Redis(url) : new Redis();
    
    this.client.on('connect', () => {
      this.logger.success('Connected to Redis');
    });

    this.client.on('error', (err) => {
      this.logger.error('Redis error:', err.message);
    });
  }

  private key(k: string): string {
    return `${this.prefix}${k}`;
  }

  async get(key: string): Promise<T | undefined> {
    try {
      const value = await this.client.get(this.key(key));
      return value ? JSON.parse(value) : undefined;
    } catch (error: any) {
      this.logger.error('Get failed:', error.message);
      return undefined;
    }
  }

  async set(key: string, value: T, ttlSeconds?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      if (ttlSeconds) {
        await this.client.setex(this.key(key), ttlSeconds, serialized);
      } else {
        await this.client.set(this.key(key), serialized);
      }
    } catch (error: any) {
      this.logger.error('Set failed:', error.message);
    }
  }

  async delete(key: string): Promise<boolean> {
    try {
      const result = await this.client.del(this.key(key));
      return result > 0;
    } catch (error: any) {
      this.logger.error('Delete failed:', error.message);
      return false;
    }
  }

  async has(key: string): Promise<boolean> {
    try {
      const result = await this.client.exists(this.key(key));
      return result > 0;
    } catch (error: any) {
      this.logger.error('Exists check failed:', error.message);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    await this.client.quit();
    this.logger.info('Disconnected from Redis');
  }
}
