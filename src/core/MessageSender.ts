import { EventEmitter } from 'eventemitter3';
import { RequestBuilder } from './RequestBuilder';
import { GraphQLClient, DOC_IDS } from './GraphQLClient';
import { UploadManager } from './UploadManager';
import { AntiBanManager } from './AntiBanManager';
import { RateLimiter } from './RateLimiter';
import { SendMessageOptions } from '../types';
import { Logger } from './Logger';
import { delay, randomString } from '../utils/helpers';

export interface MessageQueueItem {
  id: string;
  options: SendMessageOptions;
  priority: number;
  retries: number;
  maxRetries: number;
  createdAt: number;
  scheduledFor?: number;
}

export interface MessageResult {
  success: boolean;
  messageID?: string;
  error?: string;
  timestamp?: number;
}

export interface StickerOptions {
  threadID: string;
  stickerID: string;
}

export interface ReplyOptions extends SendMessageOptions {
  replyToMessageID: string;
}

export interface ForwardOptions {
  messageID: string;
  toThreadID: string;
}

export class MessageSender extends EventEmitter {
  private req: RequestBuilder;
  private gql: GraphQLClient;
  private upload: UploadManager;
  private antiBan?: AntiBanManager;
  private rateLimiter: RateLimiter;
  private logger: Logger;
  private queue: MessageQueueItem[] = [];
  private isProcessing = false;
  private processInterval?: NodeJS.Timeout;
  private messageCount = 0;
  private lastSendTime = 0;
  private minSendInterval = 500;

  constructor(
    req: RequestBuilder,
    gql: GraphQLClient,
    upload: UploadManager,
    antiBan?: AntiBanManager
  ) {
    super();
    this.req = req;
    this.gql = gql;
    this.upload = upload;
    this.antiBan = antiBan;
    this.rateLimiter = new RateLimiter(60, 60000);
    this.logger = new Logger('SENDER');
    
    this.startQueueProcessor();
  }

  private startQueueProcessor(): void {
    this.processInterval = setInterval(() => {
      this.processQueue();
    }, 100);
  }

  async send(options: SendMessageOptions): Promise<MessageResult> {
    if (!options.threadID || (!options.message && !options.attachments?.length)) {
      return { success: false, error: 'Missing threadID or message content' };
    }

    if (!this.rateLimiter.consume()) {
      this.logger.warn('Rate limit reached, queueing message');
      return this.queueMessage(options);
    }

    return this.sendImmediate(options);
  }

  private async sendImmediate(options: SendMessageOptions): Promise<MessageResult> {
    const timeSinceLastSend = Date.now() - this.lastSendTime;
    if (timeSinceLastSend < this.minSendInterval) {
      await delay(this.minSendInterval - timeSinceLastSend);
    }

    this.logger.info(`Sending message to ${options.threadID}`);

    try {
      let attachmentIDs: string[] = [];
      
      if (options.attachments?.length) {
        attachmentIDs = await this.uploadAttachments(options.attachments);
      }

      const offlineThreadingId = this.generateOfflineThreadingId();
      const timestamp = Date.now();
      
      const formDefaults = this.req.getFormDefaults();
      
      const messageData: Record<string, any> = {
        ...formDefaults,
        action_type: 'ma-type:user-generated-message',
        body: options.message || '',
        ephemeral_ttl_mode: '0',
        has_attachment: attachmentIDs.length > 0 ? 'true' : 'false',
        message_id: randomString(24),
        offline_threading_id: offlineThreadingId,
        source: 'source:titan:web',
        timestamp: timestamp.toString(),
        thread_id: options.threadID,
      };

      if (options.threadID.length > 15) {
        messageData.thread_fbid = options.threadID;
      } else {
        messageData.other_user_fbid = options.threadID;
      }

      if (attachmentIDs.length > 0) {
        attachmentIDs.forEach((id, i) => {
          messageData[`attachment_ids[${i}]`] = id;
        });
      }

      if (options.mentionIDs?.length) {
        const mentions = options.mentionIDs.map((id, i) => ({
          i: i,
          id: id,
          type: 'p'
        }));
        messageData.profile_xmd = JSON.stringify(mentions);
      }

      const response = await this.req.postForm('/messaging/send/', messageData);

      this.lastSendTime = Date.now();
      this.messageCount++;
      
      if (this.antiBan) {
        this.antiBan.onMessageSent();
      }

      const result = this.parseMessageResponse(response.data);
      
      if (result.success) {
        this.logger.success(`Message sent! ID: ${result.messageID}`);
        this.emit('message_sent', { ...options, messageID: result.messageID });
      } else {
        this.logger.error(`Message failed: ${result.error}`);
        this.emit('message_failed', { ...options, error: result.error });
      }

      return result;
    } catch (error: any) {
      this.logger.error('Send error:', error.message);
      return { success: false, error: error.message };
    }
  }

  private parseMessageResponse(data: any): MessageResult {
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data.replace(/^for \(;;\);/, ''));
      } catch {
        if (data.includes('error')) {
          return { success: false, error: 'Failed to parse response' };
        }
        return { success: true, timestamp: Date.now() };
      }
    }

    if (data.error) {
      return { success: false, error: data.error.message || data.error.summary };
    }

    if (data.payload?.actions?.[0]?.message_id) {
      return {
        success: true,
        messageID: data.payload.actions[0].message_id,
        timestamp: Date.now()
      };
    }

    return { success: true, timestamp: Date.now() };
  }

  private async uploadAttachments(attachments: Array<{ path?: string; url?: string; id?: string }>): Promise<string[]> {
    const ids: string[] = [];

    for (const attachment of attachments) {
      if (attachment.id) {
        ids.push(attachment.id);
        continue;
      }

      if (attachment.path) {
        const result = await this.upload.uploadFile(attachment.path);
        if (result?.metadata?.fbid) {
          ids.push(result.metadata.fbid);
        }
      } else if (attachment.url) {
        const result = await this.upload.uploadFromUrl(attachment.url);
        if (result?.metadata?.fbid) {
          ids.push(result.metadata.fbid);
        }
      }
    }

    return ids;
  }

  private generateOfflineThreadingId(): string {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 4294967295);
    return `${timestamp}${random}`;
  }

  async sendReply(options: ReplyOptions): Promise<MessageResult> {
    const messageData = {
      ...options,
      replied_to_message_id: options.replyToMessageID
    };

    return this.send(messageData);
  }

  async sendSticker(options: StickerOptions): Promise<MessageResult> {
    this.logger.info(`Sending sticker ${options.stickerID} to ${options.threadID}`);

    try {
      const formDefaults = this.req.getFormDefaults();
      
      const data = {
        ...formDefaults,
        sticker_id: options.stickerID,
        thread_id: options.threadID,
        action_type: 'ma-type:user-generated-message',
        source: 'source:titan:web',
      };

      if (options.threadID.length > 15) {
        (data as any).thread_fbid = options.threadID;
      } else {
        (data as any).other_user_fbid = options.threadID;
      }

      const response = await this.req.postForm('/messaging/send/', data);
      return this.parseMessageResponse(response.data);
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async forwardMessage(options: ForwardOptions): Promise<MessageResult> {
    this.logger.info(`Forwarding message ${options.messageID} to ${options.toThreadID}`);

    try {
      const response = await this.gql.request({
        docId: DOC_IDS.FORWARD_MESSAGE,
        variables: {
          message_id: options.messageID,
          thread_id: options.toThreadID
        }
      });

      if (response.errors) {
        return { success: false, error: response.errors[0].message };
      }

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async queueMessage(options: SendMessageOptions, priority: number = 0): Promise<MessageResult> {
    const item: MessageQueueItem = {
      id: randomString(16),
      options,
      priority,
      retries: 0,
      maxRetries: 3,
      createdAt: Date.now()
    };

    this.queue.push(item);
    this.queue.sort((a, b) => b.priority - a.priority);
    
    this.logger.info(`Message queued (${this.queue.length} in queue)`);
    this.emit('message_queued', item);

    return { success: true, messageID: `queued:${item.id}` };
  }

  async scheduleMessage(options: SendMessageOptions, sendAt: Date): Promise<MessageResult> {
    const item: MessageQueueItem = {
      id: randomString(16),
      options,
      priority: 0,
      retries: 0,
      maxRetries: 3,
      createdAt: Date.now(),
      scheduledFor: sendAt.getTime()
    };

    this.queue.push(item);
    this.logger.info(`Message scheduled for ${sendAt.toISOString()}`);
    this.emit('message_scheduled', item);

    return { success: true, messageID: `scheduled:${item.id}` };
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) return;

    const now = Date.now();
    const item = this.queue.find(i => !i.scheduledFor || i.scheduledFor <= now);
    
    if (!item) return;

    this.isProcessing = true;

    try {
      const index = this.queue.indexOf(item);
      this.queue.splice(index, 1);

      const result = await this.sendImmediate(item.options);

      if (!result.success && item.retries < item.maxRetries) {
        item.retries++;
        this.queue.push(item);
        this.logger.warn(`Message retry queued (${item.retries}/${item.maxRetries})`);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  clearQueue(): void {
    this.queue = [];
    this.logger.info('Message queue cleared');
  }

  getStats(): {
    messageCount: number;
    queueLength: number;
    rateLimitRemaining: number;
  } {
    return {
      messageCount: this.messageCount,
      queueLength: this.queue.length,
      rateLimitRemaining: this.rateLimiter.getRemaining()
    };
  }

  setMinSendInterval(ms: number): void {
    this.minSendInterval = ms;
    this.logger.debug(`Min send interval set to ${ms}ms`);
  }

  destroy(): void {
    if (this.processInterval) {
      clearInterval(this.processInterval);
    }
    this.removeAllListeners();
    this.logger.info('Message sender destroyed');
  }
}
