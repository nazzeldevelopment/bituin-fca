import { RequestBuilder } from './RequestBuilder';
import { CookieJar, LoginOptions, SessionData } from '../types';
import { Logger } from './Logger';

export class LoginManager {
  private req: RequestBuilder;
  private logger: Logger;

  constructor(req: RequestBuilder) {
    this.req = req;
    this.logger = new Logger('LOGIN');
  }

  async loginEmail(opts: LoginOptions): Promise<SessionData> {
    if (!opts.email || !opts.password) {
      this.logger.error('Missing credentials - email and password required');
      throw new Error('Missing credentials');
    }

    this.logger.info('Attempting email/password login...');
    this.logger.debug(`Email: ${opts.email.substring(0, 3)}***`);

    const body = this.req.buildFormData({
      email: opts.email,
      pass: opts.password,
    });

    try {
      const res = await this.req.post('/login.php', body, {
        'Content-Type': 'application/x-www-form-urlencoded',
      });

      const setCookie = res.headers?.['set-cookie'] || [];
      const jar: CookieJar = {};
      
      if (Array.isArray(setCookie)) {
        setCookie.forEach((c: string) => {
          const [kv] = c.split(';');
          const [k, v] = kv.split('=');
          if (k && v) {
            jar[k.trim()] = v;
          }
        });
      }

      this.req.setCookies(jar);

      const session: SessionData = {
        cookies: jar,
        userID: jar['c_user'] || 'unknown',
        xs: jar['xs'],
        c_user: jar['c_user'],
        createdAt: Date.now(),
      };

      if (session.userID !== 'unknown') {
        this.logger.success(`Login successful! User ID: ${session.userID}`);
      } else {
        this.logger.warn('Login completed but user ID not found in cookies');
      }

      return session;
    } catch (error: any) {
      this.logger.error('Login failed:', error.message);
      throw error;
    }
  }

  async loadSession(appState: SessionData): Promise<SessionData> {
    this.logger.info('Loading existing session...');
    this.req.setCookies(appState.cookies);
    
    const age = Date.now() - appState.createdAt;
    const ageHours = Math.floor(age / (1000 * 60 * 60));
    
    this.logger.success(`Session loaded for user ${appState.userID}`);
    this.logger.debug(`Session age: ${ageHours} hours`);
    
    return appState;
  }

  async validateSession(session: SessionData): Promise<boolean> {
    this.logger.info('Validating session...');
    
    try {
      const res = await this.req.get('/');
      const isValid = res.data.includes(session.userID);
      
      if (isValid) {
        this.logger.success('Session is valid');
      } else {
        this.logger.warn('Session may be expired or invalid');
      }
      
      return isValid;
    } catch (error) {
      this.logger.error('Session validation failed');
      return false;
    }
  }
}
