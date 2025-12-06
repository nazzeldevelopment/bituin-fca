import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { Logger } from '../../core/Logger';

export class AxiosTransport {
  private client: AxiosInstance;
  private logger: Logger;

  constructor(config?: AxiosRequestConfig) {
    this.logger = new Logger('HTTP-TRANSPORT');
    
    this.client = axios.create({
      timeout: 30000,
      ...config
    });

    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    this.client.interceptors.request.use(
      (config) => {
        this.logger.http(`→ ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        this.logger.error('Request error:', error.message);
        return Promise.reject(error);
      }
    );

    this.client.interceptors.response.use(
      (response) => {
        this.logger.http(`← ${response.status} ${response.config.url}`);
        return response;
      },
      (error) => {
        if (error.response) {
          this.logger.error(`← ${error.response.status} ${error.config?.url}`);
        } else {
          this.logger.error('Network error:', error.message);
        }
        return Promise.reject(error);
      }
    );
  }

  async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.client.get<T>(url, config);
  }

  async post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.client.post<T>(url, data, config);
  }

  async put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.client.put<T>(url, data, config);
  }

  async delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.client.delete<T>(url, config);
  }

  getClient(): AxiosInstance {
    return this.client;
  }
}
