import axios, { AxiosInstance, AxiosResponse, AxiosRequestConfig } from 'axios';
import { CookieJar } from '../types';
import { Logger } from './Logger';
import { AntiBanManager } from './AntiBanManager';

export interface RequestConfig {
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
}

export class RequestBuilder {
  private http: AxiosInstance;
  private cookieJar: CookieJar = {};
  private userAgent: string;
  private logger: Logger;
  private antiBan?: AntiBanManager;
  private customHeaders: Record<string, string> = {};
  private maxRetries: number;
  private retryDelay: number;
  private fbDtsg?: string;
  private jazoest?: string;

  constructor(config?: RequestConfig, antiBan?: AntiBanManager) {
    this.logger = new Logger('HTTP');
    this.antiBan = antiBan;
    this.maxRetries = config?.maxRetries || 3;
    this.retryDelay = config?.retryDelay || 1000;
    
    this.userAgent = antiBan?.getUserAgent() || 
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    
    this.http = axios.create({ 
      baseURL: config?.baseUrl || 'https://www.facebook.com', 
      timeout: config?.timeout || 30000,
      maxRedirects: 5,
      validateStatus: (status) => status < 500,
      headers: {
        'User-Agent': this.userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0'
      }
    });

    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    this.http.interceptors.request.use(
      async (config) => {
        if (this.antiBan) {
          const { allowed, headers } = await this.antiBan.beforeRequest();
          if (!allowed) {
            throw new Error('Request blocked by anti-ban system');
          }
          Object.assign(config.headers, headers);
        }
        
        Object.assign(config.headers, this.customHeaders);
        
        this.logger.http(`→ ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        this.logger.error('Request setup error:', error.message);
        return Promise.reject(error);
      }
    );

    this.http.interceptors.response.use(
      (response) => {
        this.logger.http(`← ${response.status} ${response.config.url}`);
        
        if (this.antiBan) {
          this.antiBan.afterRequest(response);
        }
        
        this.extractTokens(response);
        this.updateCookiesFromResponse(response);
        
        return response;
      },
      async (error) => {
        const config = error.config;
        
        if (!config || !config.__retryCount) {
          config.__retryCount = 0;
        }
        
        if (config.__retryCount < this.maxRetries && this.shouldRetry(error)) {
          config.__retryCount++;
          this.logger.warn(`Retrying request (${config.__retryCount}/${this.maxRetries})...`);
          
          await new Promise(resolve => setTimeout(resolve, this.retryDelay * config.__retryCount));
          return this.http(config);
        }
        
        this.logger.error(`← ${error.response?.status || 'ERR'} ${config?.url || 'unknown'}`);
        return Promise.reject(error);
      }
    );
  }

  private shouldRetry(error: any): boolean {
    if (!error.response) return true;
    
    const status = error.response.status;
    return status >= 500 || status === 429 || status === 408;
  }

  private extractTokens(response: AxiosResponse): void {
    if (typeof response.data !== 'string') return;
    
    const fbDtsgMatch = response.data.match(/\["DTSGInitialData",\[\],\{"token":"([^"]+)"/);
    if (fbDtsgMatch) {
      this.fbDtsg = fbDtsgMatch[1];
      this.logger.debug('Extracted fb_dtsg token');
    }
    
    const jazoestMatch = response.data.match(/jazoest=(\d+)/);
    if (jazoestMatch) {
      this.jazoest = jazoestMatch[1];
    }
  }

  private updateCookiesFromResponse(response: AxiosResponse): void {
    const setCookie = response.headers?.['set-cookie'];
    if (!setCookie) return;
    
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
    for (const cookie of cookies) {
      const parts = cookie.split(';')[0];
      const eqIndex = parts.indexOf('=');
      if (eqIndex > 0) {
        const key = parts.substring(0, eqIndex).trim();
        const value = parts.substring(eqIndex + 1);
        if (key && value && value !== 'deleted') {
          this.cookieJar[key] = value;
        }
      }
    }
  }

  setCookies(jar: CookieJar): void {
    this.cookieJar = { ...jar };
    this.updateCookieHeader();
    this.logger.session('Cookies updated', `(${Object.keys(jar).length} cookies)`);
  }

  private updateCookieHeader(): void {
    const cookieHeader = Object.entries(this.cookieJar)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    this.http.defaults.headers.common['cookie'] = cookieHeader;
  }

  getCookies(): CookieJar {
    return { ...this.cookieJar };
  }

  getCookieHeader(): string {
    return Object.entries(this.cookieJar)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  getCookie(name: string): string | undefined {
    return this.cookieJar[name];
  }

  setHeaders(headers: Record<string, string>): void {
    this.customHeaders = { ...this.customHeaders, ...headers };
  }

  removeHeader(name: string): void {
    delete this.customHeaders[name];
  }

  async get(path: string, config?: AxiosRequestConfig): Promise<AxiosResponse> {
    return this.http.get(path, config);
  }

  async post(path: string, body?: any, headers?: Record<string, string>): Promise<AxiosResponse> {
    return this.http.post(path, body, { headers });
  }

  async postForm(path: string, data: Record<string, any>): Promise<AxiosResponse> {
    const formData = this.buildFormData(data);
    return this.http.post(path, formData, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
  }

  async postJSON(path: string, data: any): Promise<AxiosResponse> {
    return this.http.post(path, JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  buildFormData(fields: Record<string, any>): URLSearchParams {
    const fd = new URLSearchParams();
    for (const k in fields) {
      if (fields[k] !== undefined && fields[k] !== null) {
        fd.append(k, String(fields[k]));
      }
    }
    return fd;
  }

  getFormDefaults(): Record<string, string> {
    const defaults: Record<string, string> = {
      __a: '1',
      __req: this.generateReqId(),
      __rev: String(Date.now()),
    };
    
    if (this.fbDtsg) {
      defaults.fb_dtsg = this.fbDtsg;
    }
    
    if (this.jazoest) {
      defaults.jazoest = this.jazoest;
    }
    
    if (this.cookieJar['c_user']) {
      defaults.__user = this.cookieJar['c_user'];
    }
    
    return defaults;
  }

  private generateReqId(): string {
    return Math.random().toString(36).substring(2, 8);
  }

  setUserAgent(ua: string): void {
    this.userAgent = ua;
    this.http.defaults.headers.common['User-Agent'] = ua;
    this.logger.debug('User-Agent updated');
  }

  getUserAgent(): string {
    return this.userAgent;
  }

  getFbDtsg(): string | undefined {
    return this.fbDtsg;
  }

  getJazoest(): string | undefined {
    return this.jazoest;
  }

  setAntiBan(antiBan: AntiBanManager): void {
    this.antiBan = antiBan;
    this.setUserAgent(antiBan.getUserAgent());
  }

  getAxiosInstance(): AxiosInstance {
    return this.http;
  }
}
