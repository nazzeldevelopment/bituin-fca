import { EventEmitter } from 'eventemitter3';
import axios, { AxiosError } from 'axios';
import * as crypto from 'crypto';
import { Logger } from '../core/Logger';

export interface WebhookConfig {
  id: string;
  url: string;
  secret: string;
  events: string[];
  enabled: boolean;
  retryConfig?: RetryConfig;
  headers?: Record<string, string>;
  metadata?: Record<string, any>;
  createdAt: number;
  updatedAt: number;
}

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export interface WebhookEvent {
  id: string;
  type: string;
  timestamp: number;
  data: any;
  metadata?: Record<string, any>;
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  eventId: string;
  eventType: string;
  url: string;
  status: 'pending' | 'success' | 'failed' | 'retrying';
  attempts: number;
  lastAttemptAt?: number;
  nextRetryAt?: number;
  responseCode?: number;
  responseBody?: string;
  error?: string;
  createdAt: number;
  completedAt?: number;
}

export interface WebhookStats {
  totalDeliveries: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  pendingDeliveries: number;
  averageResponseTime: number;
  deliveriesPerMinute: number;
  lastDeliveryAt?: number;
  webhookStats: Map<string, WebhookDeliveryStats>;
}

export interface WebhookDeliveryStats {
  webhookId: string;
  totalDeliveries: number;
  successRate: number;
  averageResponseTime: number;
  lastDeliveryAt?: number;
  consecutiveFailures: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5,
  initialDelayMs: 1000,
  maxDelayMs: 300000,
  backoffMultiplier: 2,
};

export class WebhooksManager extends EventEmitter {
  private logger: Logger;
  private webhooks: Map<string, WebhookConfig> = new Map();
  private deliveryQueue: Map<string, WebhookDelivery> = new Map();
  private eventQueue: WebhookEvent[] = [];
  private stats: WebhookStats;
  private processingInterval: NodeJS.Timeout | null = null;
  private retryInterval: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private signingAlgorithm = 'sha256';

  constructor() {
    super();
    this.logger = new Logger('WEBHOOKS');
    
    this.stats = {
      totalDeliveries: 0,
      successfulDeliveries: 0,
      failedDeliveries: 0,
      pendingDeliveries: 0,
      averageResponseTime: 0,
      deliveriesPerMinute: 0,
      webhookStats: new Map(),
    };

    this.startProcessing();
    this.logger.success('Webhooks manager initialized');
  }

  registerWebhook(config: Omit<WebhookConfig, 'id' | 'createdAt' | 'updatedAt'>): WebhookConfig {
    const id = this.generateId();
    const now = Date.now();
    
    const webhook: WebhookConfig = {
      ...config,
      id,
      retryConfig: config.retryConfig || DEFAULT_RETRY_CONFIG,
      createdAt: now,
      updatedAt: now,
    };

    this.webhooks.set(id, webhook);
    this.initWebhookStats(id);
    
    this.logger.success(`Webhook registered: ${id} -> ${webhook.url}`);
    this.emit('webhook_registered', webhook);
    
    return webhook;
  }

  updateWebhook(id: string, updates: Partial<Omit<WebhookConfig, 'id' | 'createdAt'>>): WebhookConfig | null {
    const webhook = this.webhooks.get(id);
    if (!webhook) {
      this.logger.warn(`Webhook not found: ${id}`);
      return null;
    }

    const updated: WebhookConfig = {
      ...webhook,
      ...updates,
      updatedAt: Date.now(),
    };

    this.webhooks.set(id, updated);
    this.emit('webhook_updated', updated);
    
    return updated;
  }

  unregisterWebhook(id: string): boolean {
    const webhook = this.webhooks.get(id);
    if (!webhook) {
      return false;
    }

    this.webhooks.delete(id);
    this.stats.webhookStats.delete(id);
    
    this.logger.info(`Webhook unregistered: ${id}`);
    this.emit('webhook_unregistered', id);
    
    return true;
  }

  getWebhook(id: string): WebhookConfig | undefined {
    return this.webhooks.get(id);
  }

  listWebhooks(): WebhookConfig[] {
    return Array.from(this.webhooks.values());
  }

  getWebhooksForEvent(eventType: string): WebhookConfig[] {
    return Array.from(this.webhooks.values()).filter(
      (webhook) => webhook.enabled && this.matchesEventType(webhook.events, eventType)
    );
  }

  private matchesEventType(patterns: string[], eventType: string): boolean {
    return patterns.some((pattern) => {
      if (pattern === '*') return true;
      if (pattern.endsWith('.*')) {
        const prefix = pattern.slice(0, -2);
        return eventType.startsWith(prefix);
      }
      return pattern === eventType;
    });
  }

  dispatch(eventType: string, data: any, metadata?: Record<string, any>): string {
    const event: WebhookEvent = {
      id: this.generateId(),
      type: eventType,
      timestamp: Date.now(),
      data,
      metadata,
    };

    this.eventQueue.push(event);
    this.emit('event_queued', event);
    
    this.logger.debug(`Event queued: ${eventType} (${event.id})`);
    
    return event.id;
  }

  async dispatchImmediate(eventType: string, data: any, metadata?: Record<string, any>): Promise<WebhookDelivery[]> {
    const event: WebhookEvent = {
      id: this.generateId(),
      type: eventType,
      timestamp: Date.now(),
      data,
      metadata,
    };

    const webhooks = this.getWebhooksForEvent(eventType);
    const deliveries: WebhookDelivery[] = [];

    for (const webhook of webhooks) {
      const delivery = await this.deliverToWebhook(webhook, event);
      deliveries.push(delivery);
    }

    return deliveries;
  }

  private async processEventQueue(): Promise<void> {
    if (this.isProcessing || this.eventQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    try {
      while (this.eventQueue.length > 0) {
        const event = this.eventQueue.shift()!;
        const webhooks = this.getWebhooksForEvent(event.type);

        for (const webhook of webhooks) {
          await this.deliverToWebhook(webhook, event);
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private async deliverToWebhook(webhook: WebhookConfig, event: WebhookEvent): Promise<WebhookDelivery> {
    const deliveryId = this.generateId();
    const now = Date.now();

    const delivery: WebhookDelivery = {
      id: deliveryId,
      webhookId: webhook.id,
      eventId: event.id,
      eventType: event.type,
      url: webhook.url,
      status: 'pending',
      attempts: 0,
      createdAt: now,
    };

    this.deliveryQueue.set(deliveryId, delivery);
    this.stats.pendingDeliveries++;

    return this.attemptDelivery(delivery, webhook, event);
  }

  private async attemptDelivery(
    delivery: WebhookDelivery,
    webhook: WebhookConfig,
    event: WebhookEvent
  ): Promise<WebhookDelivery> {
    const payload = this.buildPayload(event);
    const signature = this.generateSignature(payload, webhook.secret);
    const startTime = Date.now();

    delivery.attempts++;
    delivery.lastAttemptAt = startTime;

    try {
      const response = await axios.post(webhook.url, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-ID': webhook.id,
          'X-Webhook-Signature': signature,
          'X-Webhook-Timestamp': event.timestamp.toString(),
          'X-Event-ID': event.id,
          'X-Event-Type': event.type,
          'User-Agent': 'Bituin-FCA-Webhooks/2.0',
          ...webhook.headers,
        },
        timeout: 30000,
        validateStatus: (status) => status < 500,
      });

      const responseTime = Date.now() - startTime;
      delivery.responseCode = response.status;
      delivery.responseBody = typeof response.data === 'string' 
        ? response.data.slice(0, 1000) 
        : JSON.stringify(response.data).slice(0, 1000);

      if (response.status >= 200 && response.status < 300) {
        delivery.status = 'success';
        delivery.completedAt = Date.now();
        
        this.recordSuccess(webhook.id, responseTime);
        this.emit('delivery_success', delivery);
        this.logger.debug(`Webhook delivered: ${webhook.id} -> ${event.type}`);
      } else {
        delivery.status = 'failed';
        delivery.error = `HTTP ${response.status}`;
        
        this.scheduleRetry(delivery, webhook, event);
      }
    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        delivery.error = axiosError.message;
        delivery.responseCode = axiosError.response?.status;
      } else {
        delivery.error = error.message;
      }

      if (this.shouldRetry(delivery, webhook)) {
        delivery.status = 'retrying';
        this.scheduleRetry(delivery, webhook, event);
      } else {
        delivery.status = 'failed';
        delivery.completedAt = Date.now();
        this.recordFailure(webhook.id, responseTime);
        this.emit('delivery_failed', delivery);
        this.logger.warn(`Webhook delivery failed: ${webhook.id} -> ${event.type}: ${delivery.error}`);
      }
    }

    this.deliveryQueue.set(delivery.id, delivery);
    this.updatePendingCount();

    return delivery;
  }

  private shouldRetry(delivery: WebhookDelivery, webhook: WebhookConfig): boolean {
    const retryConfig = webhook.retryConfig || DEFAULT_RETRY_CONFIG;
    return delivery.attempts < retryConfig.maxRetries;
  }

  private scheduleRetry(
    delivery: WebhookDelivery,
    webhook: WebhookConfig,
    event: WebhookEvent
  ): void {
    const retryConfig = webhook.retryConfig || DEFAULT_RETRY_CONFIG;
    const delay = this.calculateBackoff(delivery.attempts, retryConfig);
    
    delivery.nextRetryAt = Date.now() + delay;
    delivery.status = 'retrying';

    setTimeout(async () => {
      await this.attemptDelivery(delivery, webhook, event);
    }, delay);

    this.emit('delivery_retry_scheduled', { delivery, nextRetryAt: delivery.nextRetryAt });
    this.logger.debug(`Retry scheduled for ${delivery.id} in ${delay}ms (attempt ${delivery.attempts})`);
  }

  private calculateBackoff(attempt: number, config: RetryConfig): number {
    const delay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt - 1);
    const jitter = Math.random() * 0.1 * delay;
    return Math.min(delay + jitter, config.maxDelayMs);
  }

  private buildPayload(event: WebhookEvent): string {
    return JSON.stringify({
      id: event.id,
      type: event.type,
      timestamp: event.timestamp,
      data: event.data,
      metadata: event.metadata,
    });
  }

  generateSignature(payload: string, secret: string): string {
    const timestamp = Date.now();
    const signedPayload = `${timestamp}.${payload}`;
    const hmac = crypto.createHmac(this.signingAlgorithm, secret);
    hmac.update(signedPayload);
    const signature = hmac.digest('hex');
    return `t=${timestamp},v1=${signature}`;
  }

  verifySignature(payload: string, signature: string, secret: string, tolerance = 300000): boolean {
    try {
      const parts = signature.split(',');
      const timestampPart = parts.find(p => p.startsWith('t='));
      const signaturePart = parts.find(p => p.startsWith('v1='));

      if (!timestampPart || !signaturePart) {
        return false;
      }

      const timestamp = parseInt(timestampPart.slice(2), 10);
      const expectedSignature = signaturePart.slice(3);

      if (Date.now() - timestamp > tolerance) {
        this.logger.warn('Webhook signature expired');
        return false;
      }

      const signedPayload = `${timestamp}.${payload}`;
      const hmac = crypto.createHmac(this.signingAlgorithm, secret);
      hmac.update(signedPayload);
      const computedSignature = hmac.digest('hex');

      return crypto.timingSafeEqual(
        Buffer.from(expectedSignature),
        Buffer.from(computedSignature)
      );
    } catch (error) {
      this.logger.error('Signature verification failed:', error);
      return false;
    }
  }

  private recordSuccess(webhookId: string, responseTime: number): void {
    this.stats.totalDeliveries++;
    this.stats.successfulDeliveries++;
    this.stats.lastDeliveryAt = Date.now();

    const totalTime = this.stats.averageResponseTime * (this.stats.totalDeliveries - 1) + responseTime;
    this.stats.averageResponseTime = totalTime / this.stats.totalDeliveries;

    const webhookStats = this.stats.webhookStats.get(webhookId);
    if (webhookStats) {
      webhookStats.totalDeliveries++;
      webhookStats.consecutiveFailures = 0;
      webhookStats.lastDeliveryAt = Date.now();
      webhookStats.successRate = 
        (webhookStats.totalDeliveries > 0)
          ? (webhookStats.totalDeliveries - webhookStats.consecutiveFailures) / webhookStats.totalDeliveries
          : 1;
      
      const wTime = webhookStats.averageResponseTime * (webhookStats.totalDeliveries - 1) + responseTime;
      webhookStats.averageResponseTime = wTime / webhookStats.totalDeliveries;
    }
  }

  private recordFailure(webhookId: string, responseTime: number): void {
    this.stats.totalDeliveries++;
    this.stats.failedDeliveries++;

    const webhookStats = this.stats.webhookStats.get(webhookId);
    if (webhookStats) {
      webhookStats.totalDeliveries++;
      webhookStats.consecutiveFailures++;
      webhookStats.lastDeliveryAt = Date.now();
      webhookStats.successRate = 
        (webhookStats.totalDeliveries > 0)
          ? Math.max(0, (webhookStats.totalDeliveries - webhookStats.consecutiveFailures) / webhookStats.totalDeliveries)
          : 0;
    }

    if (webhookStats && webhookStats.consecutiveFailures >= 5) {
      this.emit('webhook_unhealthy', { webhookId, consecutiveFailures: webhookStats.consecutiveFailures });
      this.logger.warn(`Webhook ${webhookId} has ${webhookStats.consecutiveFailures} consecutive failures`);
    }
  }

  private updatePendingCount(): void {
    this.stats.pendingDeliveries = Array.from(this.deliveryQueue.values()).filter(
      (d) => d.status === 'pending' || d.status === 'retrying'
    ).length;
  }

  private initWebhookStats(webhookId: string): void {
    this.stats.webhookStats.set(webhookId, {
      webhookId,
      totalDeliveries: 0,
      successRate: 1,
      averageResponseTime: 0,
      consecutiveFailures: 0,
    });
  }

  getDelivery(id: string): WebhookDelivery | undefined {
    return this.deliveryQueue.get(id);
  }

  getDeliveries(options?: {
    webhookId?: string;
    status?: WebhookDelivery['status'];
    limit?: number;
  }): WebhookDelivery[] {
    let deliveries = Array.from(this.deliveryQueue.values());

    if (options?.webhookId) {
      deliveries = deliveries.filter((d) => d.webhookId === options.webhookId);
    }

    if (options?.status) {
      deliveries = deliveries.filter((d) => d.status === options.status);
    }

    deliveries.sort((a, b) => b.createdAt - a.createdAt);

    if (options?.limit) {
      deliveries = deliveries.slice(0, options.limit);
    }

    return deliveries;
  }

  getStats(): WebhookStats {
    return {
      ...this.stats,
      webhookStats: new Map(this.stats.webhookStats),
    };
  }

  getWebhookStats(webhookId: string): WebhookDeliveryStats | undefined {
    return this.stats.webhookStats.get(webhookId);
  }

  retryDelivery(deliveryId: string): boolean {
    const delivery = this.deliveryQueue.get(deliveryId);
    if (!delivery || delivery.status !== 'failed') {
      return false;
    }

    const webhook = this.webhooks.get(delivery.webhookId);
    if (!webhook) {
      return false;
    }

    delivery.attempts = 0;
    delivery.status = 'pending';
    
    const event: WebhookEvent = {
      id: delivery.eventId,
      type: delivery.eventType,
      timestamp: Date.now(),
      data: {},
    };

    this.attemptDelivery(delivery, webhook, event);
    return true;
  }

  clearDeliveryHistory(olderThanMs?: number): number {
    const threshold = olderThanMs ? Date.now() - olderThanMs : 0;
    let cleared = 0;

    for (const [id, delivery] of this.deliveryQueue) {
      if (
        (delivery.status === 'success' || delivery.status === 'failed') &&
        delivery.completedAt &&
        delivery.completedAt < threshold
      ) {
        this.deliveryQueue.delete(id);
        cleared++;
      }
    }

    this.logger.info(`Cleared ${cleared} delivery records`);
    return cleared;
  }

  private startProcessing(): void {
    this.processingInterval = setInterval(() => {
      this.processEventQueue();
    }, 100);

    this.retryInterval = setInterval(() => {
      this.cleanupOldDeliveries();
    }, 60000);
  }

  private cleanupOldDeliveries(): void {
    const maxAge = 24 * 60 * 60 * 1000;
    this.clearDeliveryHistory(maxAge);
  }

  private generateId(): string {
    return `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}`;
  }

  async testWebhook(webhookId: string): Promise<WebhookDelivery> {
    const webhook = this.webhooks.get(webhookId);
    if (!webhook) {
      throw new Error(`Webhook not found: ${webhookId}`);
    }

    const testEvent: WebhookEvent = {
      id: this.generateId(),
      type: 'webhook.test',
      timestamp: Date.now(),
      data: {
        message: 'This is a test webhook delivery',
        webhookId,
      },
    };

    return this.deliverToWebhook(webhook, testEvent);
  }

  enableWebhook(id: string): boolean {
    const webhook = this.webhooks.get(id);
    if (!webhook) return false;
    
    webhook.enabled = true;
    webhook.updatedAt = Date.now();
    this.emit('webhook_enabled', id);
    return true;
  }

  disableWebhook(id: string): boolean {
    const webhook = this.webhooks.get(id);
    if (!webhook) return false;
    
    webhook.enabled = false;
    webhook.updatedAt = Date.now();
    this.emit('webhook_disabled', id);
    return true;
  }

  destroy(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    if (this.retryInterval) {
      clearInterval(this.retryInterval);
      this.retryInterval = null;
    }

    this.webhooks.clear();
    this.deliveryQueue.clear();
    this.eventQueue = [];
    
    this.logger.info('Webhooks manager destroyed');
  }
}
