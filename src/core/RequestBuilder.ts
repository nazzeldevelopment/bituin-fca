import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { CookieJar } from '../types';
import { Logger } from './Logger';

export class RequestBuilder {
  private http: AxiosInstance;
  private cookieJar: CookieJar = {};
  private userAgent: string;
  private logger: Logger;

  constructor(baseUrl = 'https://www.facebook.com') {
    this.logger = new Logger('HTTP');
    this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    
    this.http = axios.create({ 
      baseURL: baseUrl, 
      timeout: 20000,
      headers: {
        'User-Agent': this.userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      }
    });

    this.http.interceptors.request.use((config) => {
      this.logger.http(`→ ${config.method?.toUpperCase()} ${config.url}`);
      return config;
    });

    this.http.interceptors.response.use(
      (response) => {
        this.logger.http(`← ${response.status} ${response.config.url}`);
        return response;
      },
      (error) => {
        this.logger.error(`← ${error.response?.status || 'ERR'} ${error.config?.url}`);
        return Promise.reject(error);
      }
    );
  }

  setCookies(jar: CookieJar): void {
    this.cookieJar = jar;
    const cookieHeader = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    this.http.defaults.headers.common['cookie'] = cookieHeader;
    this.logger.session('Cookies updated', `(${Object.keys(jar).length} cookies)`);
  }

  getCookies(): CookieJar {
    return { ...this.cookieJar };
  }

  getCookieHeader(): string {
    return Object.entries(this.cookieJar).map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async get(path: string, params?: any): Promise<AxiosResponse> {
    return this.http.get(path, { params });
  }

  async post(path: string, body?: any, headers?: any): Promise<AxiosResponse> {
    return this.http.post(path, body, { headers });
  }

  buildFormData(fields: Record<string, any>): URLSearchParams {
    const fd = new URLSearchParams();
    for (const k in fields) {
      fd.append(k, String(fields[k]));
    }
    return fd;
  }

  setUserAgent(ua: string): void {
    this.userAgent = ua;
    this.http.defaults.headers.common['User-Agent'] = ua;
  }
}
