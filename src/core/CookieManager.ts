import { CookieJar } from '../types';
import { Logger } from './Logger';

export class CookieManager {
  private cookies: CookieJar = {};
  private logger: Logger;

  constructor() {
    this.logger = new Logger('COOKIE');
  }

  parse(setCookieHeaders: string[]): CookieJar {
    const jar: CookieJar = {};
    
    for (const header of setCookieHeaders) {
      const [kv] = header.split(';');
      const eqIndex = kv.indexOf('=');
      if (eqIndex > 0) {
        const key = kv.substring(0, eqIndex).trim();
        const value = kv.substring(eqIndex + 1);
        jar[key] = value;
      }
    }

    this.logger.debug(`Parsed ${Object.keys(jar).length} cookies`);
    return jar;
  }

  merge(existing: CookieJar, incoming: CookieJar): CookieJar {
    const merged = { ...existing, ...incoming };
    this.cookies = merged;
    return merged;
  }

  toString(jar?: CookieJar): string {
    const target = jar || this.cookies;
    return Object.entries(target)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  get(name: string): string | undefined {
    return this.cookies[name];
  }

  set(name: string, value: string): void {
    this.cookies[name] = value;
  }

  getAll(): CookieJar {
    return { ...this.cookies };
  }

  clear(): void {
    this.cookies = {};
    this.logger.info('Cookies cleared');
  }

  getRequired(): { c_user?: string; xs?: string; datr?: string; sb?: string } {
    return {
      c_user: this.cookies['c_user'],
      xs: this.cookies['xs'],
      datr: this.cookies['datr'],
      sb: this.cookies['sb']
    };
  }
}
