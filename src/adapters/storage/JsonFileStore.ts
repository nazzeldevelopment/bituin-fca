import fs from 'fs';
import path from 'path';
import { Logger } from '../../core/Logger';

export class JsonFileStore<T = any> {
  private filePath: string;
  private logger: Logger;
  private data: Map<string, T> = new Map();

  constructor(filePath: string) {
    this.filePath = path.resolve(filePath);
    this.logger = new Logger('JSON-STORE');
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const content = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(content);
        this.data = new Map(Object.entries(parsed));
        this.logger.info(`Loaded ${this.data.size} entries from ${path.basename(this.filePath)}`);
      }
    } catch (error: any) {
      this.logger.error('Failed to load store:', error.message);
    }
  }

  private save(): void {
    try {
      const obj = Object.fromEntries(this.data);
      fs.writeFileSync(this.filePath, JSON.stringify(obj, null, 2), 'utf-8');
    } catch (error: any) {
      this.logger.error('Failed to save store:', error.message);
    }
  }

  async get(key: string): Promise<T | undefined> {
    return this.data.get(key);
  }

  async set(key: string, value: T): Promise<void> {
    this.data.set(key, value);
    this.save();
  }

  async delete(key: string): Promise<boolean> {
    const result = this.data.delete(key);
    if (result) this.save();
    return result;
  }

  async has(key: string): Promise<boolean> {
    return this.data.has(key);
  }

  async clear(): Promise<void> {
    this.data.clear();
    this.save();
    this.logger.info('Store cleared');
  }

  async getAll(): Promise<Map<string, T>> {
    return new Map(this.data);
  }

  async size(): Promise<number> {
    return this.data.size;
  }
}
