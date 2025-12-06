import fs from 'fs';
import path from 'path';
import { SessionData } from '../types';
import { Logger } from './Logger';

export class SessionManager {
  private sessionPath: string;
  private logger: Logger;

  constructor(sessionPath: string = 'session.json') {
    this.sessionPath = path.resolve(sessionPath);
    this.logger = new Logger('SESSION');
  }

  async save(session: SessionData): Promise<void> {
    this.logger.info('Saving session to disk...');
    
    try {
      const data = JSON.stringify(session, null, 2);
      fs.writeFileSync(this.sessionPath, data, 'utf-8');
      this.logger.success(`Session saved to ${this.sessionPath}`);
    } catch (error: any) {
      this.logger.error('Failed to save session:', error.message);
      throw error;
    }
  }

  async load(): Promise<SessionData | null> {
    this.logger.info('Loading session from disk...');
    
    if (!fs.existsSync(this.sessionPath)) {
      this.logger.warn('No session file found');
      return null;
    }

    try {
      const data = fs.readFileSync(this.sessionPath, 'utf-8');
      const session: SessionData = JSON.parse(data);
      this.logger.success('Session loaded successfully');
      return session;
    } catch (error: any) {
      this.logger.error('Failed to load session:', error.message);
      return null;
    }
  }

  async exists(): Promise<boolean> {
    return fs.existsSync(this.sessionPath);
  }

  async delete(): Promise<void> {
    if (fs.existsSync(this.sessionPath)) {
      fs.unlinkSync(this.sessionPath);
      this.logger.info('Session deleted');
    }
  }
}
