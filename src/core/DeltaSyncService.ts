import { EventEmitter } from 'eventemitter3';
import { GraphQLClient } from './GraphQLClient';
import { MQTTClient } from './MQTTClient';
import { Logger } from './Logger';
import { Message, Attachment } from '../types';
import { FULL_DOC_IDS } from './DocIDRepository';
import { MessageHistoryManager } from './MessageHistoryManager';

export interface SyncState {
  lastSyncTime: number;
  syncToken?: string;
  sequence: number;
  isSyncing: boolean;
  isFullSyncRequired: boolean;
}

export interface DeltaUpdate {
  type: 'message' | 'reaction' | 'read_receipt' | 'typing' | 'presence' | 
        'thread_update' | 'participant' | 'delivery_receipt' | 'unsend' | 'edit';
  data: any;
  timestamp: number;
  sequence: number;
}

export interface SyncConfig {
  enableOfflineRecovery: boolean;
  maxOfflineMessages: number;
  syncInterval: number;
  enableMultiDevice: boolean;
  batchSize: number;
}

export class DeltaSyncService extends EventEmitter {
  private gql: GraphQLClient;
  private mqtt: MQTTClient;
  private history: MessageHistoryManager;
  private logger: Logger;
  private config: SyncConfig;
  private syncState: SyncState;
  private pendingDeltas: DeltaUpdate[] = [];
  private syncTimer?: NodeJS.Timeout;
  private isConnected = false;
  private deviceSyncEnabled = false;

  constructor(
    gql: GraphQLClient, 
    mqtt: MQTTClient, 
    history: MessageHistoryManager,
    config?: Partial<SyncConfig>
  ) {
    super();
    this.gql = gql;
    this.mqtt = mqtt;
    this.history = history;
    this.logger = new Logger('DELTA-SYNC');

    this.config = {
      enableOfflineRecovery: true,
      maxOfflineMessages: 500,
      syncInterval: 30000,
      enableMultiDevice: true,
      batchSize: 50,
      ...config
    };

    this.syncState = {
      lastSyncTime: 0,
      sequence: 0,
      isSyncing: false,
      isFullSyncRequired: true
    };

    this.setupMQTTListeners();
    this.logger.success('Delta sync service initialized');
  }

  private setupMQTTListeners(): void {
    this.mqtt.on('connected', () => {
      this.isConnected = true;
      this.onReconnect();
    });

    this.mqtt.on('disconnected', () => {
      this.isConnected = false;
      this.syncState.lastSyncTime = Date.now();
    });

    this.mqtt.on('delta', (delta: any) => {
      this.processDelta(delta);
    });

    this.mqtt.on('message', (msg: any) => {
      this.handleIncomingMessage(msg);
    });

    this.mqtt.on('sync_update', (update: any) => {
      this.handleSyncUpdate(update);
    });
  }

  private async onReconnect(): Promise<void> {
    const offlineDuration = Date.now() - this.syncState.lastSyncTime;
    
    if (this.config.enableOfflineRecovery && offlineDuration > 60000) {
      this.logger.info(`Offline for ${Math.floor(offlineDuration / 1000)}s, recovering messages...`);
      await this.recoverOfflineMessages();
    }
  }

  async performInitialSync(): Promise<boolean> {
    this.logger.info('Performing initial sync...');
    this.syncState.isSyncing = true;

    try {
      const response = await this.gql.request({
        docId: FULL_DOC_IDS.SYNC.INITIAL_SYNC.id,
        variables: {
          device_id: this.getDeviceId(),
          is_initial: true,
          batch_size: this.config.batchSize
        }
      });

      if (response.data?.sync) {
        this.syncState.syncToken = response.data.sync.sync_token;
        this.syncState.sequence = response.data.sync.sequence || 0;
        this.syncState.isFullSyncRequired = false;
        this.syncState.lastSyncTime = Date.now();

        const threads = response.data.sync.threads || [];
        this.emit('initial_sync_complete', { 
          threads: threads.length,
          syncToken: this.syncState.syncToken
        });

        this.logger.success(`Initial sync complete: ${threads.length} threads`);
        this.startPeriodicSync();
        return true;
      }

      return false;
    } catch (error: any) {
      this.logger.error('Initial sync failed:', error.message);
      return false;
    } finally {
      this.syncState.isSyncing = false;
    }
  }

  async performDeltaSync(): Promise<DeltaUpdate[]> {
    if (this.syncState.isSyncing) {
      this.logger.debug('Sync already in progress');
      return [];
    }

    this.syncState.isSyncing = true;
    const deltas: DeltaUpdate[] = [];

    try {
      const response = await this.gql.request({
        docId: FULL_DOC_IDS.SYNC.DELTA_SYNC.id,
        variables: {
          sync_token: this.syncState.syncToken,
          last_sequence: this.syncState.sequence,
          batch_size: this.config.batchSize
        }
      });

      if (response.data?.delta_sync) {
        const updates = response.data.delta_sync.deltas || [];
        
        for (const update of updates) {
          const delta = this.parseDelta(update);
          if (delta) {
            deltas.push(delta);
            this.emit('delta', delta);
          }
        }

        if (response.data.delta_sync.sync_token) {
          this.syncState.syncToken = response.data.delta_sync.sync_token;
        }
        
        if (updates.length > 0) {
          this.syncState.sequence = updates[updates.length - 1].sequence || this.syncState.sequence;
        }

        this.syncState.lastSyncTime = Date.now();
        this.logger.debug(`Delta sync: ${deltas.length} updates`);
      }

      return deltas;
    } catch (error: any) {
      this.logger.error('Delta sync failed:', error.message);
      return [];
    } finally {
      this.syncState.isSyncing = false;
    }
  }

  async performFullSync(threadIDs?: string[]): Promise<boolean> {
    this.logger.info('Performing full sync...');
    this.syncState.isSyncing = true;

    try {
      const response = await this.gql.request({
        docId: FULL_DOC_IDS.SYNC.FULL_SYNC.id,
        variables: {
          thread_ids: threadIDs,
          include_messages: true,
          include_participants: true,
          message_limit: this.config.batchSize
        }
      });

      if (response.data?.full_sync) {
        const threads = response.data.full_sync.threads || [];
        
        for (const thread of threads) {
          const messages = thread.messages?.nodes || [];
          
          for (const msg of messages) {
            const delta: DeltaUpdate = {
              type: 'message',
              data: this.parseMessageData(msg, thread.thread_id),
              timestamp: Date.now(),
              sequence: this.syncState.sequence++
            };
            
            this.emit('delta', delta);
          }
        }

        this.syncState.isFullSyncRequired = false;
        this.syncState.lastSyncTime = Date.now();
        this.logger.success(`Full sync complete: ${threads.length} threads`);
        return true;
      }

      return false;
    } catch (error: any) {
      this.logger.error('Full sync failed:', error.message);
      return false;
    } finally {
      this.syncState.isSyncing = false;
    }
  }

  async recoverOfflineMessages(): Promise<Message[]> {
    this.logger.info('Recovering offline messages...');
    const messages: Message[] = [];

    try {
      const response = await this.gql.request({
        docId: FULL_DOC_IDS.SYNC.MAILBOX_SYNC.id,
        variables: {
          since_timestamp: this.syncState.lastSyncTime,
          limit: this.config.maxOfflineMessages
        }
      });

      const threads = response.data?.mailbox?.threads || [];
      
      for (const thread of threads) {
        const threadMessages = thread.messages?.nodes || [];
        
        for (const msg of threadMessages) {
          const parsed = this.parseMessageData(msg, thread.thread_id);
          messages.push(parsed);
          
          this.emit('offline_message', parsed);
        }
      }

      this.logger.success(`Recovered ${messages.length} offline messages`);
      this.syncState.lastSyncTime = Date.now();
      
      return messages;
    } catch (error: any) {
      this.logger.error('Offline recovery failed:', error.message);
      return [];
    }
  }

  private processDelta(rawDelta: any): void {
    const delta = this.parseDelta(rawDelta);
    if (!delta) return;

    if (delta.sequence <= this.syncState.sequence && delta.sequence > 0) {
      this.logger.debug(`Duplicate delta ignored: seq ${delta.sequence}`);
      return;
    }

    this.syncState.sequence = Math.max(this.syncState.sequence, delta.sequence);
    this.pendingDeltas.push(delta);
    
    this.emit('delta', delta);
    this.emitTypedDelta(delta);
  }

  private emitTypedDelta(delta: DeltaUpdate): void {
    switch (delta.type) {
      case 'message':
        this.emit('new_message', delta.data);
        break;
      case 'reaction':
        this.emit('reaction', delta.data);
        break;
      case 'read_receipt':
        this.emit('read_receipt', delta.data);
        break;
      case 'typing':
        this.emit('typing', delta.data);
        break;
      case 'presence':
        this.emit('presence', delta.data);
        break;
      case 'thread_update':
        this.emit('thread_update', delta.data);
        break;
      case 'participant':
        this.emit('participant_update', delta.data);
        break;
      case 'unsend':
        this.emit('message_unsent', delta.data);
        break;
      case 'edit':
        this.emit('message_edited', delta.data);
        break;
    }
  }

  private parseDelta(raw: any): DeltaUpdate | null {
    if (!raw) return null;

    const deltaClass = raw.deltaClass || raw.class || raw.type;
    let type: DeltaUpdate['type'];
    let data: any;

    switch (deltaClass) {
      case 'NewMessage':
      case 'deltaNewMessage':
        type = 'message';
        data = this.parseMessageData(raw.messageMetadata || raw, raw.threadKey?.threadFbId);
        break;
      
      case 'MessageReaction':
      case 'deltaMessageReaction':
        type = 'reaction';
        data = {
          messageID: raw.messageId,
          threadID: raw.threadKey?.threadFbId,
          userID: raw.userId || raw.senderId,
          reaction: raw.reaction,
          isRemoval: raw.action === 'remove'
        };
        break;

      case 'ReadReceipt':
      case 'deltaReadReceipt':
        type = 'read_receipt';
        data = {
          threadID: raw.threadKey?.threadFbId,
          readerID: raw.actorFbId,
          timestamp: parseInt(raw.actionTimestampMs) || Date.now(),
          watermark: raw.watermarkTimestampMs
        };
        break;

      case 'TypingNotification':
      case 'deltaTypingNotification':
        type = 'typing';
        data = {
          threadID: raw.threadKey?.threadFbId,
          userID: raw.senderId,
          isTyping: raw.typing === 1 || raw.isTyping
        };
        break;

      case 'PresenceUpdate':
        type = 'presence';
        data = raw;
        break;

      case 'ThreadUpdate':
      case 'deltaThreadUpdate':
        type = 'thread_update';
        data = raw;
        break;

      case 'ParticipantUpdate':
      case 'deltaParticipantsAddedToGroupThread':
      case 'deltaParticipantLeftGroupThread':
        type = 'participant';
        data = raw;
        break;

      case 'MessageUnsend':
      case 'deltaRecallMessageData':
        type = 'unsend';
        data = {
          messageID: raw.messageId,
          threadID: raw.threadKey?.threadFbId,
          senderID: raw.senderID || raw.deletedByUserId,
          timestamp: Date.now()
        };
        break;

      case 'MessageEdit':
      case 'deltaMessageEdit':
        type = 'edit';
        data = {
          messageID: raw.messageId,
          threadID: raw.threadKey?.threadFbId,
          newBody: raw.newMessage || raw.message?.text,
          editedAt: Date.now()
        };
        break;

      default:
        return null;
    }

    return {
      type,
      data,
      timestamp: parseInt(raw.timestamp || raw.timestampMs) || Date.now(),
      sequence: raw.sequence || raw.seq || 0
    };
  }

  private parseMessageData(raw: any, threadID: string): Message {
    const attachments: Attachment[] = [];

    if (raw.attachments) {
      for (const att of raw.attachments) {
        attachments.push({
          type: this.getAttachmentType(att),
          id: att.id || att.attachmentFbid,
          url: att.url || att.playableUrl,
          filename: att.filename,
          filesize: att.fileSize
        });
      }
    }

    return {
      threadID: threadID || raw.threadKey?.threadFbId || '',
      senderID: raw.senderId || raw.actorFbId || raw.message_sender?.id || '',
      messageID: raw.messageId || raw.mid || raw.offlineThreadingId || '',
      body: raw.body || raw.message?.text || raw.snippet || '',
      attachments,
      timestamp: parseInt(raw.timestamp || raw.timestampMs) || Date.now(),
      isGroup: raw.threadType === 'GROUP',
      mentions: raw.mentions?.map((m: any) => m.id) || [],
      replyTo: raw.replyToMessageId?.messageId
    };
  }

  private getAttachmentType(att: any): Attachment['type'] {
    const typename = att.__typename || att.attach_type || '';
    if (typename.includes('Photo') || typename.includes('Image')) return 'image';
    if (typename.includes('Video')) return 'video';
    if (typename.includes('Audio')) return 'audio';
    if (typename.includes('Sticker')) return 'sticker';
    if (typename.includes('Animated') || typename.includes('GIF')) return 'gif';
    if (typename.includes('Share') || typename.includes('Link')) return 'link';
    return 'file';
  }

  private handleIncomingMessage(msg: any): void {
    const delta: DeltaUpdate = {
      type: 'message',
      data: this.parseMessageData(msg, msg.threadKey?.threadFbId || msg.threadID),
      timestamp: Date.now(),
      sequence: this.syncState.sequence++
    };

    this.emit('delta', delta);
    this.emit('new_message', delta.data);
  }

  private handleSyncUpdate(update: any): void {
    if (update.syncToken) {
      this.syncState.syncToken = update.syncToken;
    }
    
    if (update.requiresFullSync) {
      this.syncState.isFullSyncRequired = true;
      this.emit('full_sync_required');
    }
  }

  private startPeriodicSync(): void {
    this.stopPeriodicSync();

    this.syncTimer = setInterval(() => {
      if (this.isConnected && !this.syncState.isSyncing) {
        this.performDeltaSync();
      }
    }, this.config.syncInterval);

    this.logger.debug(`Periodic sync started (${this.config.syncInterval}ms)`);
  }

  private stopPeriodicSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = undefined;
    }
  }

  enableMultiDeviceSync(): void {
    if (this.deviceSyncEnabled) return;
    
    this.deviceSyncEnabled = true;
    this.logger.info('Multi-device sync enabled');

    this.mqtt.on('device_sync', (data: any) => {
      this.handleDeviceSync(data);
    });
  }

  private handleDeviceSync(data: any): void {
    if (data.fromDevice === this.getDeviceId()) return;

    this.logger.debug(`Received sync from device: ${data.fromDevice}`);
    
    if (data.type === 'message_sent') {
      this.emit('own_message', data.message);
    } else if (data.type === 'read') {
      this.emit('own_read', data.threadID);
    }
  }

  private getDeviceId(): string {
    return `bituin_${Date.now().toString(36)}`;
  }

  getSyncState(): SyncState {
    return { ...this.syncState };
  }

  getPendingDeltas(): DeltaUpdate[] {
    return [...this.pendingDeltas];
  }

  clearPendingDeltas(): void {
    this.pendingDeltas = [];
  }

  isFullSyncRequired(): boolean {
    return this.syncState.isFullSyncRequired;
  }

  getStats(): {
    sequence: number;
    lastSync: number;
    pendingDeltas: number;
    isConnected: boolean;
    isSyncing: boolean;
  } {
    return {
      sequence: this.syncState.sequence,
      lastSync: this.syncState.lastSyncTime,
      pendingDeltas: this.pendingDeltas.length,
      isConnected: this.isConnected,
      isSyncing: this.syncState.isSyncing
    };
  }

  destroy(): void {
    this.stopPeriodicSync();
    this.pendingDeltas = [];
    this.removeAllListeners();
    this.logger.info('Delta sync service destroyed');
  }
}
