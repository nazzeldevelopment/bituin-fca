import { RequestBuilder } from './RequestBuilder';
import { AntiBanManager } from './AntiBanManager';
import { CookieJar, LoginOptions, SessionData } from '../types';
import { Logger } from './Logger';
import { delay } from '../utils/helpers';
import { EventEmitter } from 'eventemitter3';

export interface LoginResult {
  success: boolean;
  session?: SessionData;
  error?: string;
  requiresTwoFactor?: boolean;
  requiresCheckpoint?: boolean;
  checkpointUrl?: string;
  captchaRequired?: boolean;
}

export interface TwoFactorOptions {
  code: string;
  trustDevice?: boolean;
}

export class LoginManager extends EventEmitter {
  private req: RequestBuilder;
  private antiBan?: AntiBanManager;
  private logger: Logger;
  private loginAttempts = 0;
  private maxLoginAttempts = 3;
  private lastLoginAttempt = 0;
  private loginCooldown = 60000;

  constructor(req: RequestBuilder, antiBan?: AntiBanManager) {
    super();
    this.req = req;
    this.antiBan = antiBan;
    this.logger = new Logger('LOGIN');
  }

  async loginEmail(opts: LoginOptions): Promise<LoginResult> {
    if (!opts.email || !opts.password) {
      this.logger.error('Missing credentials - email and password required');
      return { success: false, error: 'Missing credentials' };
    }

    if (!this.canAttemptLogin()) {
      const waitTime = this.getLoginCooldownRemaining();
      this.logger.warn(`Too many login attempts. Wait ${Math.ceil(waitTime / 1000)}s`);
      return { success: false, error: `Please wait ${Math.ceil(waitTime / 1000)} seconds before trying again` };
    }

    this.loginAttempts++;
    this.lastLoginAttempt = Date.now();

    this.logger.info('Starting email/password login...');
    this.logger.debug(`Email: ${opts.email.substring(0, 3)}***@${opts.email.split('@')[1] || '***'}`);

    try {
      if (this.antiBan) {
        const { allowed, headers } = await this.antiBan.beforeRequest();
        if (!allowed) {
          return { success: false, error: 'Request blocked by anti-ban system' };
        }
        this.req.setHeaders(headers);
      }

      const loginPage = await this.req.get('/login/');
      const formData = this.extractFormFields(loginPage.data);

      if (!formData.lsd || !formData.jazoest) {
        this.logger.warn('Could not extract all form fields, using fallback');
      }

      await delay(1000 + Math.random() * 2000);

      const body = this.req.buildFormData({
        ...formData,
        email: opts.email,
        pass: opts.password,
        login: 'Log In',
        persistent: '1',
        default_persistent: '1',
      });

      const res = await this.req.post('/login/device-based/regular/login/', body, {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://www.facebook.com',
        'Referer': 'https://www.facebook.com/login/',
      });

      if (this.antiBan) {
        this.antiBan.afterRequest(res);
      }

      const result = await this.parseLoginResponse(res);
      
      if (result.success) {
        this.loginAttempts = 0;
        this.logger.success(`Login successful! User ID: ${result.session?.userID}`);
        this.emit('login_success', result.session);
      } else if (result.requiresTwoFactor) {
        this.logger.warn('Two-factor authentication required');
        this.emit('two_factor_required');
      } else if (result.requiresCheckpoint) {
        this.logger.warn('Security checkpoint detected');
        this.emit('checkpoint_required', result.checkpointUrl);
      } else if (result.captchaRequired) {
        this.logger.error('CAPTCHA verification required');
        this.emit('captcha_required');
      } else {
        this.logger.error(`Login failed: ${result.error}`);
        this.emit('login_failed', result.error);
      }

      return result;
    } catch (error: any) {
      this.logger.error('Login error:', error.message);
      return { success: false, error: error.message };
    }
  }

  private extractFormFields(html: string): Record<string, string> {
    const fields: Record<string, string> = {};

    const lsdMatch = html.match(/name="lsd"\s+value="([^"]+)"/);
    if (lsdMatch) fields.lsd = lsdMatch[1];

    const jazoestMatch = html.match(/name="jazoest"\s+value="([^"]+)"/);
    if (jazoestMatch) fields.jazoest = jazoestMatch[1];

    const liMatch = html.match(/name="li"\s+value="([^"]+)"/);
    if (liMatch) fields.li = liMatch[1];

    const mTsMatch = html.match(/name="m_ts"\s+value="([^"]+)"/);
    if (mTsMatch) fields.m_ts = mTsMatch[1];

    const tryNumMatch = html.match(/name="try_num"\s+value="([^"]+)"/);
    if (tryNumMatch) fields.try_num = tryNumMatch[1];

    const uniqTimeTagMatch = html.match(/name="uniq_time_tag"\s+value="([^"]+)"/);
    if (uniqTimeTagMatch) fields.uniq_time_tag = uniqTimeTagMatch[1];

    const privacyMutationTokenMatch = html.match(/name="privacy_mutation_token"\s+value="([^"]+)"/);
    if (privacyMutationTokenMatch) fields.privacy_mutation_token = privacyMutationTokenMatch[1];

    const fbDtsgMatch = html.match(/name="fb_dtsg"\s+value="([^"]+)"/);
    if (fbDtsgMatch) fields.fb_dtsg = fbDtsgMatch[1];

    this.logger.debug(`Extracted ${Object.keys(fields).length} form fields`);
    return fields;
  }

  private async parseLoginResponse(res: any): Promise<LoginResult> {
    const setCookie = res.headers?.['set-cookie'] || [];
    const jar = this.parseCookies(setCookie);
    
    this.req.setCookies(jar);

    if (jar['c_user'] && jar['xs']) {
      const session: SessionData = {
        cookies: jar,
        userID: jar['c_user'],
        xs: jar['xs'],
        c_user: jar['c_user'],
        createdAt: Date.now(),
      };
      return { success: true, session };
    }

    const html = typeof res.data === 'string' ? res.data : '';

    if (html.includes('checkpoint') || html.includes('/checkpoint/')) {
      const checkpointMatch = html.match(/href="(\/checkpoint\/[^"]+)"/);
      return {
        success: false,
        requiresCheckpoint: true,
        checkpointUrl: checkpointMatch ? `https://www.facebook.com${checkpointMatch[1]}` : undefined,
        error: 'Security checkpoint required'
      };
    }

    if (html.includes('two_factor') || html.includes('approvals_code') || html.includes('Code Generator')) {
      return {
        success: false,
        requiresTwoFactor: true,
        error: 'Two-factor authentication required'
      };
    }

    if (html.includes('captcha') || html.includes('recaptcha') || html.includes('security_check')) {
      return {
        success: false,
        captchaRequired: true,
        error: 'CAPTCHA verification required'
      };
    }

    if (html.includes('incorrect') || html.includes('wrong password') || html.includes('password you entered')) {
      return { success: false, error: 'Incorrect email or password' };
    }

    if (html.includes('account has been disabled') || html.includes('account is disabled')) {
      return { success: false, error: 'Account has been disabled' };
    }

    if (html.includes('account has been locked')) {
      return { success: false, error: 'Account has been locked' };
    }

    return { success: false, error: 'Login failed - unknown response' };
  }

  async submitTwoFactor(options: TwoFactorOptions): Promise<LoginResult> {
    this.logger.info('Submitting two-factor authentication code...');

    try {
      const body = this.req.buildFormData({
        approvals_code: options.code,
        submit: 'Submit Code',
        save_device: options.trustDevice ? '1' : '0',
      });

      const res = await this.req.post('/checkpoint/', body, {
        'Content-Type': 'application/x-www-form-urlencoded',
      });

      return await this.parseLoginResponse(res);
    } catch (error: any) {
      this.logger.error('Two-factor submission error:', error.message);
      return { success: false, error: error.message };
    }
  }

  async handleCheckpoint(url: string): Promise<{ success: boolean; nextStep?: string }> {
    this.logger.info('Attempting to handle checkpoint...');

    try {
      const res = await this.req.get(url);
      const html = res.data;

      if (html.includes('verify your identity')) {
        return { success: false, nextStep: 'identity_verification' };
      }

      if (html.includes('confirm your phone')) {
        return { success: false, nextStep: 'phone_confirmation' };
      }

      if (html.includes('recognize these devices')) {
        return { success: false, nextStep: 'device_review' };
      }

      if (html.includes('suspicious activity')) {
        return { success: false, nextStep: 'suspicious_activity' };
      }

      return { success: false, nextStep: 'unknown_checkpoint' };
    } catch (error: any) {
      this.logger.error('Checkpoint handling error:', error.message);
      return { success: false, nextStep: 'error' };
    }
  }

  private parseCookies(setCookieHeaders: string[]): CookieJar {
    const jar: CookieJar = {};
    
    if (!Array.isArray(setCookieHeaders)) return jar;

    for (const header of setCookieHeaders) {
      const parts = header.split(';')[0];
      const eqIndex = parts.indexOf('=');
      if (eqIndex > 0) {
        const key = parts.substring(0, eqIndex).trim();
        const value = parts.substring(eqIndex + 1);
        if (key && value && value !== 'deleted') {
          jar[key] = value;
        }
      }
    }

    return jar;
  }

  async loadSession(appState: SessionData): Promise<LoginResult> {
    this.logger.info('Loading existing session...');
    
    if (!appState.cookies || !appState.c_user) {
      return { success: false, error: 'Invalid session data' };
    }

    this.req.setCookies(appState.cookies);
    
    const isValid = await this.validateSession(appState);
    if (!isValid) {
      return { success: false, error: 'Session expired or invalid' };
    }

    const age = Date.now() - appState.createdAt;
    const ageHours = Math.floor(age / (1000 * 60 * 60));
    
    this.logger.success(`Session loaded for user ${appState.userID}`);
    this.logger.debug(`Session age: ${ageHours} hours`);
    this.emit('session_loaded', appState);
    
    return { success: true, session: appState };
  }

  async validateSession(session: SessionData): Promise<boolean> {
    this.logger.info('Validating session...');
    
    try {
      const res = await this.req.get('/me');
      const isValid = !res.data.includes('login') && 
                      !res.data.includes('Log In') &&
                      res.data.includes(session.userID);
      
      if (isValid) {
        this.logger.success('Session is valid');
        this.emit('session_valid', session);
      } else {
        this.logger.warn('Session may be expired or invalid');
        this.emit('session_invalid', session);
      }
      
      return isValid;
    } catch (error) {
      this.logger.error('Session validation failed');
      return false;
    }
  }

  async logout(): Promise<boolean> {
    this.logger.info('Logging out...');
    
    try {
      await this.req.get('/logout.php');
      this.req.setCookies({});
      this.logger.success('Logged out successfully');
      this.emit('logout');
      return true;
    } catch (error: any) {
      this.logger.error('Logout error:', error.message);
      return false;
    }
  }

  private canAttemptLogin(): boolean {
    if (this.loginAttempts >= this.maxLoginAttempts) {
      const timeSinceLastAttempt = Date.now() - this.lastLoginAttempt;
      if (timeSinceLastAttempt < this.loginCooldown) {
        return false;
      }
      this.loginAttempts = 0;
    }
    return true;
  }

  private getLoginCooldownRemaining(): number {
    const timeSinceLastAttempt = Date.now() - this.lastLoginAttempt;
    return Math.max(0, this.loginCooldown - timeSinceLastAttempt);
  }

  getLoginAttempts(): number {
    return this.loginAttempts;
  }

  resetLoginAttempts(): void {
    this.loginAttempts = 0;
    this.logger.info('Login attempts reset');
  }
}
