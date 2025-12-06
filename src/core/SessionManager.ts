import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { SessionData } from '../types';
import { Logger } from './Logger';
import { EventEmitter } from 'eventemitter3';

export interface SessionManagerConfig {
  sessionPath: string;
  encryptionKey?: string;
  autoRefresh: boolean;
  refreshInterval: number;
  maxSessionAge: number;
}

export interface EncryptedSession {
  iv: string;
  data: string;
  tag: string;
  timestamp: number;
}

export class SessionManager extends EventEmitter {
  private config: SessionManagerConfig;
  private logger: Logger;
  private currentSession: SessionData | null = null;
  private refreshTimer?: NodeJS.Timeout;
  private algorithm = 'aes-256-gcm';

  constructor(config?: Partial<SessionManagerConfig>) {
    super();
    this.logger = new Logger('SESSION');
    
    this.config = {
      sessionPath: config?.sessionPath || 'session.json',
      encryptionKey: config?.encryptionKey,
      autoRefresh: config?.autoRefresh ?? true,
      refreshInterval: config?.refreshInterval || 30 * 60 * 1000,
      maxSessionAge: config?.maxSessionAge || 7 * 24 * 60 * 60 * 1000,
    };

    this.config.sessionPath = path.resolve(this.config.sessionPath);
  }

  async save(session: SessionData): Promise<void> {
    this.logger.info('Saving session to disk...');
    
    try {
      let data: string;
      
      if (this.config.encryptionKey) {
        const encrypted = this.encrypt(session);
        data = JSON.stringify(encrypted, null, 2);
        this.logger.debug('Session encrypted before saving');
      } else {
        data = JSON.stringify(session, null, 2);
        this.logger.warn('Session saved without encryption');
      }
      
      fs.writeFileSync(this.config.sessionPath, data, 'utf-8');
      this.currentSession = session;
      this.logger.success(`Session saved to ${path.basename(this.config.sessionPath)}`);
      this.emit('session_saved', session);
      
      if (this.config.autoRefresh) {
        this.startAutoRefresh();
      }
    } catch (error: any) {
      this.logger.error('Failed to save session:', error.message);
      throw error;
    }
  }

  async load(): Promise<SessionData | null> {
    this.logger.info('Loading session from disk...');
    
    if (!fs.existsSync(this.config.sessionPath)) {
      this.logger.warn('No session file found');
      return null;
    }

    try {
      const rawData = fs.readFileSync(this.config.sessionPath, 'utf-8');
      const parsed = JSON.parse(rawData);
      
      let session: SessionData;
      
      if (this.isEncryptedSession(parsed)) {
        if (!this.config.encryptionKey) {
          this.logger.error('Session is encrypted but no encryption key provided');
          return null;
        }
        session = this.decrypt(parsed);
        this.logger.debug('Session decrypted successfully');
      } else {
        session = parsed as SessionData;
      }
      
      if (this.isSessionExpired(session)) {
        this.logger.warn('Session has expired');
        await this.delete();
        return null;
      }
      
      this.currentSession = session;
      this.logger.success('Session loaded successfully');
      this.emit('session_loaded', session);
      
      if (this.config.autoRefresh) {
        this.startAutoRefresh();
      }
      
      return session;
    } catch (error: any) {
      this.logger.error('Failed to load session:', error.message);
      return null;
    }
  }

  private encrypt(session: SessionData): EncryptedSession {
    const key = crypto.scryptSync(this.config.encryptionKey!, 'salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm as 'aes-256-gcm', key, iv) as crypto.CipherGCM;
    
    let encrypted = cipher.update(JSON.stringify(session), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag();
    
    return {
      iv: iv.toString('hex'),
      data: encrypted,
      tag: tag.toString('hex'),
      timestamp: Date.now()
    };
  }

  private decrypt(encrypted: EncryptedSession): SessionData {
    const key = crypto.scryptSync(this.config.encryptionKey!, 'salt', 32);
    const iv = Buffer.from(encrypted.iv, 'hex');
    const tag = Buffer.from(encrypted.tag, 'hex');
    const decipher = crypto.createDecipheriv(this.algorithm as 'aes-256-gcm', key, iv) as crypto.DecipherGCM;
    decipher.setAuthTag(tag);
    
    let decrypted = decipher.update(encrypted.data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return JSON.parse(decrypted);
  }

  private isEncryptedSession(data: any): data is EncryptedSession {
    return data && typeof data.iv === 'string' && 
           typeof data.data === 'string' && 
           typeof data.tag === 'string';
  }

  private isSessionExpired(session: SessionData): boolean {
    const age = Date.now() - session.createdAt;
    return age > this.config.maxSessionAge;
  }

  private startAutoRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
    
    this.refreshTimer = setInterval(() => {
      this.checkAndRefresh();
    }, this.config.refreshInterval);
    
    this.logger.debug(`Auto-refresh enabled (${this.config.refreshInterval / 1000}s interval)`);
  }

  private async checkAndRefresh(): Promise<void> {
    if (!this.currentSession) return;
    
    const age = Date.now() - this.currentSession.createdAt;
    const remainingLife = this.config.maxSessionAge - age;
    
    this.logger.debug(`Session remaining life: ${Math.floor(remainingLife / (1000 * 60 * 60))} hours`);
    
    if (remainingLife < this.config.maxSessionAge * 0.2) {
      this.logger.warn('Session nearing expiry, refresh recommended');
      this.emit('session_expiring', this.currentSession);
    }
  }

  async refresh(newSession: SessionData): Promise<void> {
    this.logger.info('Refreshing session...');
    
    newSession.createdAt = Date.now();
    await this.save(newSession);
    
    this.logger.success('Session refreshed');
    this.emit('session_refreshed', newSession);
  }

  async exists(): Promise<boolean> {
    return fs.existsSync(this.config.sessionPath);
  }

  async delete(): Promise<void> {
    if (fs.existsSync(this.config.sessionPath)) {
      fs.unlinkSync(this.config.sessionPath);
      this.currentSession = null;
      this.logger.info('Session deleted');
      this.emit('session_deleted');
    }
    
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
  }

  getCurrent(): SessionData | null {
    return this.currentSession;
  }

  getSessionAge(): number | null {
    if (!this.currentSession) return null;
    return Date.now() - this.currentSession.createdAt;
  }

  getRemainingLife(): number | null {
    if (!this.currentSession) return null;
    const age = Date.now() - this.currentSession.createdAt;
    return Math.max(0, this.config.maxSessionAge - age);
  }

  isValid(): boolean {
    if (!this.currentSession) return false;
    return !this.isSessionExpired(this.currentSession);
  }

  async export(): Promise<string> {
    if (!this.currentSession) {
      throw new Error('No session to export');
    }
    
    const exportData = {
      ...this.currentSession,
      exportedAt: Date.now(),
      version: '1.0'
    };
    
    return Buffer.from(JSON.stringify(exportData)).toString('base64');
  }

  async import(base64Data: string): Promise<SessionData> {
    try {
      const jsonData = Buffer.from(base64Data, 'base64').toString('utf-8');
      const session = JSON.parse(jsonData) as SessionData;
      
      if (!session.cookies || !session.userID) {
        throw new Error('Invalid session format');
      }
      
      await this.save(session);
      return session;
    } catch (error: any) {
      this.logger.error('Failed to import session:', error.message);
      throw error;
    }
  }

  setEncryptionKey(key: string): void {
    this.config.encryptionKey = key;
    this.logger.info('Encryption key updated');
  }

  destroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
    this.removeAllListeners();
    this.logger.info('Session manager destroyed');
  }
}
