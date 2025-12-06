import { EventEmitter } from 'eventemitter3';
import { RequestBuilder } from './RequestBuilder';
import { GraphQLClient, DOC_IDS } from './GraphQLClient';
import { Logger } from './Logger';

export interface ReadReceipt {
  threadID: string;
  readerID: string;
  timestamp: number;
  watermarkTimestamp?: number;
}

export interface SeenState {
  threadID: string;
  lastSeenTimestamp: number;
  seenBy: Map<string, number>;
}

export class ReadReceiptManager extends EventEmitter {
  private req: RequestBuilder;
  private gql: GraphQLClient;
  private logger: Logger;
  private seenStates: Map<string, SeenState> = new Map();
  private pendingMarkRead: Set<string> = new Set();
  private batchTimer?: NodeJS.Timeout;
  private batchDelay = 1000;

  constructor(req: RequestBuilder, gql: GraphQLClient) {
    super();
    this.req = req;
    this.gql = gql;
    this.logger = new Logger('READ');
  }

  async markRead(threadID: string): Promise<boolean> {
    this.logger.info(`Marking thread ${threadID} as read`);
    
    try {
      const response = await this.gql.request({
        docId: DOC_IDS.MARK_READ,
        variables: {
          thread_id: threadID,
          watermark: Date.now()
        }
      });

      const success = !response.errors;
      if (success) {
        this.logger.success('Thread marked as read');
        this.emit('marked_read', { threadID, timestamp: Date.now() });
      }
      
      return success;
    } catch (error: any) {
      this.logger.error('Failed to mark read:', error.message);
      return false;
    }
  }

  async markSeen(threadID: string, messageID?: string): Promise<boolean> {
    this.logger.debug(`Marking thread ${threadID} as seen`);
    
    try {
      const formDefaults = this.req.getFormDefaults();
      
      const data: Record<string, any> = {
        ...formDefaults,
        seen_timestamp: Date.now(),
        folder: 'inbox'
      };

      if (threadID.length > 15) {
        data[`ids[${threadID}]`] = 'true';
      } else {
        data[`ids[${threadID}]`] = 'true';
      }

      await this.req.postForm('/ajax/mercury/change_read_status.php', data);
      
      return true;
    } catch (error: any) {
      this.logger.error('Failed to mark seen:', error.message);
      return false;
    }
  }

  queueMarkRead(threadID: string): void {
    this.pendingMarkRead.add(threadID);
    
    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => {
        this.flushBatch();
      }, this.batchDelay);
    }
  }

  private async flushBatch(): Promise<void> {
    this.batchTimer = undefined;
    
    if (this.pendingMarkRead.size === 0) return;
    
    const threads = Array.from(this.pendingMarkRead);
    this.pendingMarkRead.clear();
    
    this.logger.debug(`Batch marking ${threads.length} threads as read`);
    
    for (const threadID of threads) {
      await this.markRead(threadID);
    }
  }

  handleReadReceipt(event: any): void {
    const receipt: ReadReceipt = {
      threadID: event.threadId || event.thread_id || event.thread || '',
      readerID: event.reader || event.actorFbId || event.actor_id || '',
      timestamp: event.time || event.timestamp || Date.now(),
      watermarkTimestamp: event.watermarkTimestampMs
    };

    if (!receipt.threadID || !receipt.readerID) return;

    let state = this.seenStates.get(receipt.threadID);
    if (!state) {
      state = {
        threadID: receipt.threadID,
        lastSeenTimestamp: receipt.timestamp,
        seenBy: new Map()
      };
      this.seenStates.set(receipt.threadID, state);
    }

    state.seenBy.set(receipt.readerID, receipt.timestamp);
    state.lastSeenTimestamp = Math.max(state.lastSeenTimestamp, receipt.timestamp);

    this.logger.debug(`User ${receipt.readerID} read messages in ${receipt.threadID}`);
    this.emit('read_receipt', receipt);
  }

  getSeenState(threadID: string): SeenState | undefined {
    return this.seenStates.get(threadID);
  }

  hasBeenSeenBy(threadID: string, userID: string): boolean {
    const state = this.seenStates.get(threadID);
    return state?.seenBy.has(userID) || false;
  }

  getSeenTimestamp(threadID: string, userID: string): number | undefined {
    const state = this.seenStates.get(threadID);
    return state?.seenBy.get(userID);
  }

  getReadersForThread(threadID: string): { userID: string; timestamp: number }[] {
    const state = this.seenStates.get(threadID);
    if (!state) return [];

    const readers: { userID: string; timestamp: number }[] = [];
    for (const [userID, timestamp] of state.seenBy.entries()) {
      readers.push({ userID, timestamp });
    }

    return readers.sort((a, b) => b.timestamp - a.timestamp);
  }

  clearState(threadID?: string): void {
    if (threadID) {
      this.seenStates.delete(threadID);
    } else {
      this.seenStates.clear();
    }
  }

  destroy(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }
    this.pendingMarkRead.clear();
    this.seenStates.clear();
    this.removeAllListeners();
  }
}
