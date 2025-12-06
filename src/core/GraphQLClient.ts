import { RequestBuilder } from './RequestBuilder';
import { GraphQLRequest } from '../types';
import { Logger } from './Logger';
import { delay } from '../utils/helpers';

export interface GraphQLResponse<T = any> {
  data?: T;
  errors?: Array<{ message: string; code?: number }>;
  extensions?: any;
}

export interface CacheEntry<T = any> {
  data: T;
  timestamp: number;
  ttl: number;
}

export interface GraphQLConfig {
  maxRetries?: number;
  retryDelay?: number;
  cacheTTL?: number;
  enableCache?: boolean;
  batchDelay?: number;
  maxBatchSize?: number;
}

export const DOC_IDS = {
  THREAD_MESSAGES: '6376629829043296',
  THREAD_INFO: '7222848254431650',
  USER_INFO: '7242726912461752',
  SEND_MESSAGE: '7241726279450295',
  THREAD_LIST: '6195354443842493',
  SEARCH_USERS: '7127316647317233',
  THREAD_PARTICIPANTS: '6380235648726478',
  THREAD_IMAGE: '7141741889226494',
  CREATE_GROUP: '6385726271506396',
  ADD_PARTICIPANTS: '6424692530934232',
  REMOVE_PARTICIPANT: '6424692530934234',
  LEAVE_GROUP: '6424692530934236',
  CHANGE_THREAD_NAME: '6385726271506398',
  CHANGE_THREAD_EMOJI: '6385726271506400',
  CHANGE_NICKNAME: '6385726271506402',
  MUTE_THREAD: '6385726271506404',
  ARCHIVE_THREAD: '6385726271506406',
  MARK_READ: '6385726271506408',
  DELETE_MESSAGE: '6385726271506410',
  UNSEND_MESSAGE: '6385726271506412',
  REACT_MESSAGE: '6385726271506414',
  FORWARD_MESSAGE: '6385726271506416',
};

interface BatchedRequest {
  request: GraphQLRequest;
  resolve: (value: any) => void;
  reject: (error: any) => void;
}

export class GraphQLClient {
  private req: RequestBuilder;
  private logger: Logger;
  private config: Required<GraphQLConfig>;
  private cache: Map<string, CacheEntry> = new Map();
  private batchQueue: BatchedRequest[] = [];
  private batchTimer?: NodeJS.Timeout;
  private requestCount = 0;

  constructor(req: RequestBuilder, config?: GraphQLConfig) {
    this.req = req;
    this.logger = new Logger('GRAPHQL');
    
    this.config = {
      maxRetries: config?.maxRetries ?? 3,
      retryDelay: config?.retryDelay ?? 1000,
      cacheTTL: config?.cacheTTL ?? 60000,
      enableCache: config?.enableCache ?? true,
      batchDelay: config?.batchDelay ?? 50,
      maxBatchSize: config?.maxBatchSize ?? 10,
    };

    setInterval(() => this.cleanCache(), 60000);
  }

  async request<T = any>(q: GraphQLRequest, useCache: boolean = true): Promise<GraphQLResponse<T>> {
    const cacheKey = this.getCacheKey(q);
    
    if (useCache && this.config.enableCache) {
      const cached = this.getFromCache<T>(cacheKey);
      if (cached) {
        this.logger.debug(`Cache hit: ${q.docId || 'custom'}`);
        return { data: cached };
      }
    }

    return this.executeWithRetry<T>(q, cacheKey);
  }

  private async executeWithRetry<T>(q: GraphQLRequest, cacheKey: string, attempt: number = 0): Promise<GraphQLResponse<T>> {
    this.requestCount++;
    const requestId = this.requestCount;
    
    this.logger.debug(`[#${requestId}] Executing: ${q.docId || 'custom query'}`);

    try {
      const formDefaults = this.req.getFormDefaults();
      
      const payload: Record<string, any> = {
        ...formDefaults,
        variables: JSON.stringify(q.variables || {}),
      };

      if (q.docId) {
        payload.doc_id = q.docId;
      } else if (q.query) {
        payload.query = q.query;
      }

      const res = await this.req.postForm('/api/graphql/', payload);
      
      let data = res.data;
      if (typeof data === 'string') {
        data = this.parseGraphQLResponse(data);
      }

      if (data.error || data.errors) {
        const errorMsg = data.error?.message || data.errors?.[0]?.message || 'Unknown error';
        throw new Error(errorMsg);
      }

      if (this.config.enableCache && cacheKey) {
        this.setCache(cacheKey, data);
      }

      this.logger.success(`[#${requestId}] Request completed`);
      return { data };
    } catch (error: any) {
      this.logger.error(`[#${requestId}] Request failed:`, error.message);

      if (attempt < this.config.maxRetries && this.shouldRetry(error)) {
        const waitTime = this.config.retryDelay * Math.pow(2, attempt);
        this.logger.warn(`[#${requestId}] Retrying in ${waitTime}ms (${attempt + 1}/${this.config.maxRetries})`);
        await delay(waitTime);
        return this.executeWithRetry<T>(q, cacheKey, attempt + 1);
      }

      return {
        errors: [{ message: error.message }]
      };
    }
  }

  private parseGraphQLResponse(data: string): any {
    const cleanData = data.replace(/^for \(;;\);/, '');
    
    try {
      return JSON.parse(cleanData);
    } catch {
      const lines = cleanData.split('\n').filter(line => line.trim());
      for (const line of lines) {
        try {
          return JSON.parse(line);
        } catch {
          continue;
        }
      }
      throw new Error('Failed to parse GraphQL response');
    }
  }

  private shouldRetry(error: any): boolean {
    const message = error.message?.toLowerCase() || '';
    
    if (message.includes('rate limit') || message.includes('too many')) {
      return true;
    }
    
    if (message.includes('timeout') || message.includes('network')) {
      return true;
    }
    
    if (error.response?.status >= 500) {
      return true;
    }
    
    return false;
  }

  async batch<T = any>(q: GraphQLRequest): Promise<GraphQLResponse<T>> {
    return new Promise((resolve, reject) => {
      this.batchQueue.push({ request: q, resolve, reject });
      
      if (!this.batchTimer) {
        this.batchTimer = setTimeout(() => this.flushBatch(), this.config.batchDelay);
      }
      
      if (this.batchQueue.length >= this.config.maxBatchSize) {
        this.flushBatch();
      }
    });
  }

  private async flushBatch(): Promise<void> {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = undefined;
    }
    
    if (this.batchQueue.length === 0) return;
    
    const batch = this.batchQueue.splice(0, this.config.maxBatchSize);
    this.logger.debug(`Flushing batch of ${batch.length} requests`);
    
    const results = await Promise.allSettled(
      batch.map(item => this.request(item.request))
    );
    
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        batch[index].resolve(result.value);
      } else {
        batch[index].reject(result.reason);
      }
    });
  }

  private getCacheKey(q: GraphQLRequest): string {
    const id = q.docId || q.query || '';
    const vars = JSON.stringify(q.variables || {});
    return `${id}:${vars}`;
  }

  private getFromCache<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.data;
  }

  private setCache(key: string, data: any): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: this.config.cacheTTL
    });
  }

  private cleanCache(): void {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      this.logger.debug(`Cleaned ${cleaned} expired cache entries`);
    }
  }

  clearCache(): void {
    this.cache.clear();
    this.logger.info('Cache cleared');
  }

  async getThreadMessages(threadID: string, limit: number = 20, before?: string): Promise<any> {
    this.logger.info(`Fetching ${limit} messages from thread ${threadID}`);
    
    const response = await this.request({
      docId: DOC_IDS.THREAD_MESSAGES,
      variables: {
        thread_id: threadID,
        limit,
        before_time_ms: before,
      }
    });
    
    return response.data?.thread?.messages?.nodes || [];
  }

  async getThreadInfo(threadID: string): Promise<any> {
    this.logger.info(`Fetching thread info: ${threadID}`);
    
    const response = await this.request({
      docId: DOC_IDS.THREAD_INFO,
      variables: { thread_id: threadID }
    });
    
    return response.data?.thread || null;
  }

  async getUserInfo(userID: string): Promise<any> {
    this.logger.info(`Fetching user info: ${userID}`);
    
    const response = await this.request({
      docId: DOC_IDS.USER_INFO,
      variables: { user_id: userID }
    });
    
    return response.data?.user || null;
  }

  async getThreadList(limit: number = 20, folder: string = 'INBOX'): Promise<any[]> {
    this.logger.info(`Fetching thread list (${limit} threads)`);
    
    const response = await this.request({
      docId: DOC_IDS.THREAD_LIST,
      variables: { limit, folder }
    });
    
    return response.data?.viewer?.message_threads?.nodes || [];
  }

  async searchUsers(query: string, limit: number = 10): Promise<any[]> {
    this.logger.info(`Searching users: "${query}"`);
    
    const response = await this.request({
      docId: DOC_IDS.SEARCH_USERS,
      variables: { query, limit }
    });
    
    return response.data?.entities_named?.search_results || [];
  }

  async sendReaction(messageID: string, reaction: string): Promise<boolean> {
    this.logger.info(`Sending reaction ${reaction} to message ${messageID}`);
    
    const response = await this.request({
      docId: DOC_IDS.REACT_MESSAGE,
      variables: {
        message_id: messageID,
        reaction
      }
    }, false);
    
    return !response.errors;
  }

  async deleteMessage(messageID: string): Promise<boolean> {
    this.logger.info(`Deleting message ${messageID}`);
    
    const response = await this.request({
      docId: DOC_IDS.DELETE_MESSAGE,
      variables: { message_id: messageID }
    }, false);
    
    return !response.errors;
  }

  async unsendMessage(messageID: string): Promise<boolean> {
    this.logger.info(`Unsending message ${messageID}`);
    
    const response = await this.request({
      docId: DOC_IDS.UNSEND_MESSAGE,
      variables: { message_id: messageID }
    }, false);
    
    return !response.errors;
  }

  getStats(): { requestCount: number; cacheSize: number; cacheHitRate: number } {
    return {
      requestCount: this.requestCount,
      cacheSize: this.cache.size,
      cacheHitRate: 0 // Would need to track hits vs misses
    };
  }

  static get DOC_IDS() {
    return DOC_IDS;
  }
}
