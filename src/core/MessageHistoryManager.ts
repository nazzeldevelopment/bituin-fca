import { EventEmitter } from 'eventemitter3';
import { GraphQLClient } from './GraphQLClient';
import { Logger } from './Logger';
import { Message, Attachment } from '../types';
import { FULL_DOC_IDS } from './DocIDRepository';

export interface MessageHistoryOptions {
  limit?: number;
  before?: string;
  after?: string;
  includeAttachments?: boolean;
}

export interface MessageSearchOptions {
  query: string;
  threadID?: string;
  limit?: number;
  fromUserID?: string;
  startDate?: Date;
  endDate?: Date;
}

export interface PinnedMessage {
  messageID: string;
  threadID: string;
  senderID: string;
  body: string;
  pinnedAt: number;
  pinnedBy: string;
}

export interface HistoryPage {
  messages: Message[];
  hasMore: boolean;
  cursor?: string;
  totalCount?: number;
}

export class MessageHistoryManager extends EventEmitter {
  private gql: GraphQLClient;
  private logger: Logger;
  private messageCache: Map<string, Message> = new Map();
  private threadCursors: Map<string, string> = new Map();
  private pinnedMessages: Map<string, PinnedMessage[]> = new Map();

  constructor(gql: GraphQLClient) {
    super();
    this.gql = gql;
    this.logger = new Logger('MSG-HISTORY');
  }

  async getMessages(threadID: string, options: MessageHistoryOptions = {}): Promise<HistoryPage> {
    const limit = options.limit || 20;
    this.logger.info(`Fetching ${limit} messages from thread ${threadID}`);

    try {
      const response = await this.gql.request({
        docId: FULL_DOC_IDS.MESSAGES.THREAD_MESSAGES.id,
        variables: {
          thread_id: threadID,
          limit,
          before_time_ms: options.before,
          after_time_ms: options.after,
          include_attachments: options.includeAttachments !== false
        }
      });

      const nodes = response.data?.thread?.messages?.nodes || [];
      const pageInfo = response.data?.thread?.messages?.page_info || {};

      const messages = nodes.map((node: any) => this.parseMessage(node, threadID));
      
      messages.forEach((msg: Message) => {
        this.messageCache.set(msg.messageID, msg);
      });

      if (pageInfo.end_cursor) {
        this.threadCursors.set(threadID, pageInfo.end_cursor);
      }

      this.logger.success(`Retrieved ${messages.length} messages`);

      return {
        messages,
        hasMore: pageInfo.has_next_page || false,
        cursor: pageInfo.end_cursor,
        totalCount: response.data?.thread?.messages?.count
      };
    } catch (error: any) {
      this.logger.error('Failed to fetch messages:', error.message);
      return { messages: [], hasMore: false };
    }
  }

  async getOlderMessages(threadID: string, limit: number = 20): Promise<HistoryPage> {
    const cursor = this.threadCursors.get(threadID);
    this.logger.info(`Fetching ${limit} older messages from ${threadID}`);

    return this.getMessages(threadID, { limit, before: cursor });
  }

  async getNewerMessages(threadID: string, lastMessageID: string, limit: number = 20): Promise<HistoryPage> {
    this.logger.info(`Fetching ${limit} newer messages after ${lastMessageID}`);

    try {
      const response = await this.gql.request({
        docId: FULL_DOC_IDS.MESSAGES.THREAD_MESSAGES.id,
        variables: {
          thread_id: threadID,
          limit,
          after_message_id: lastMessageID
        }
      });

      const nodes = response.data?.thread?.messages?.nodes || [];
      const pageInfo = response.data?.thread?.messages?.page_info || {};

      const messages = nodes.map((node: any) => this.parseMessage(node, threadID));
      
      messages.forEach((msg: Message) => {
        this.messageCache.set(msg.messageID, msg);
      });

      return {
        messages,
        hasMore: pageInfo.has_previous_page || false,
        cursor: pageInfo.start_cursor
      };
    } catch (error: any) {
      this.logger.error('Failed to fetch newer messages:', error.message);
      return { messages: [], hasMore: false };
    }
  }

  async searchMessages(options: MessageSearchOptions): Promise<Message[]> {
    this.logger.info(`Searching messages: "${options.query}"`);

    try {
      const variables: Record<string, any> = {
        query: options.query,
        limit: options.limit || 50
      };

      if (options.threadID) {
        variables.thread_id = options.threadID;
      }

      if (options.fromUserID) {
        variables.sender_id = options.fromUserID;
      }

      if (options.startDate) {
        variables.start_time = options.startDate.getTime();
      }

      if (options.endDate) {
        variables.end_time = options.endDate.getTime();
      }

      const response = await this.gql.request({
        docId: FULL_DOC_IDS.MESSAGES.SEARCH_MESSAGES.id,
        variables
      });

      const results = response.data?.search_results?.edges || [];
      const messages = results.map((edge: any) => 
        this.parseMessage(edge.node, edge.node.thread_id)
      );

      this.logger.success(`Found ${messages.length} matching messages`);
      return messages;
    } catch (error: any) {
      this.logger.error('Search failed:', error.message);
      return [];
    }
  }

  async getPinnedMessages(threadID: string): Promise<PinnedMessage[]> {
    this.logger.info(`Fetching pinned messages from ${threadID}`);

    try {
      const response = await this.gql.request({
        docId: FULL_DOC_IDS.MESSAGES.PIN_MESSAGE.id,
        variables: {
          thread_id: threadID,
          fetch_pinned: true
        }
      });

      const pinnedNodes = response.data?.thread?.pinned_messages?.nodes || [];
      
      const pinned: PinnedMessage[] = pinnedNodes.map((node: any) => ({
        messageID: node.message_id || node.id,
        threadID,
        senderID: node.message_sender?.id || '',
        body: node.snippet || node.message?.text || '',
        pinnedAt: parseInt(node.pinned_at || node.timestamp_precise) || Date.now(),
        pinnedBy: node.pinned_by?.id || ''
      }));

      this.pinnedMessages.set(threadID, pinned);
      this.logger.success(`Found ${pinned.length} pinned messages`);

      return pinned;
    } catch (error: any) {
      this.logger.error('Failed to fetch pinned messages:', error.message);
      return [];
    }
  }

  async pinMessage(threadID: string, messageID: string): Promise<boolean> {
    this.logger.info(`Pinning message ${messageID}`);

    try {
      const response = await this.gql.request({
        docId: FULL_DOC_IDS.MESSAGES.PIN_MESSAGE.id,
        variables: {
          thread_id: threadID,
          message_id: messageID
        }
      }, false);

      const success = !response.errors;
      if (success) {
        this.logger.success('Message pinned');
        this.emit('message_pinned', { threadID, messageID });
      }

      return success;
    } catch (error: any) {
      this.logger.error('Failed to pin message:', error.message);
      return false;
    }
  }

  async unpinMessage(threadID: string, messageID: string): Promise<boolean> {
    this.logger.info(`Unpinning message ${messageID}`);

    try {
      const response = await this.gql.request({
        docId: FULL_DOC_IDS.MESSAGES.UNPIN_MESSAGE.id,
        variables: {
          thread_id: threadID,
          message_id: messageID
        }
      }, false);

      const success = !response.errors;
      if (success) {
        this.logger.success('Message unpinned');
        this.emit('message_unpinned', { threadID, messageID });
      }

      return success;
    } catch (error: any) {
      this.logger.error('Failed to unpin message:', error.message);
      return false;
    }
  }

  async getAllMessagesInThread(threadID: string, maxMessages: number = 1000): Promise<Message[]> {
    this.logger.info(`Fetching all messages from ${threadID} (max: ${maxMessages})`);
    
    const allMessages: Message[] = [];
    let hasMore = true;
    let cursor: string | undefined;

    while (hasMore && allMessages.length < maxMessages) {
      const batchSize = Math.min(50, maxMessages - allMessages.length);
      const page = await this.getMessages(threadID, { limit: batchSize, before: cursor });
      
      allMessages.push(...page.messages);
      hasMore = page.hasMore;
      cursor = page.cursor;

      this.logger.debug(`Fetched ${allMessages.length}/${maxMessages} messages`);
    }

    this.logger.success(`Retrieved total of ${allMessages.length} messages`);
    return allMessages;
  }

  private parseMessage(node: any, threadID: string): Message {
    const attachments: Attachment[] = (node.blob_attachments || node.attachments || [])
      .map((att: any) => this.parseAttachment(att));

    return {
      threadID,
      senderID: node.message_sender?.id || node.sender?.id || node.from || '',
      messageID: node.message_id || node.mid || node.id || '',
      body: node.message?.text || node.snippet || node.body || '',
      attachments,
      timestamp: parseInt(node.timestamp_precise || node.timestamp) || Date.now(),
      isGroup: node.thread_type === 'GROUP',
      mentions: node.message?.ranges?.filter((r: any) => r.entity?.id)
        .map((r: any) => r.entity.id) || [],
      replyTo: node.replied_to_message?.message_id
    };
  }

  private parseAttachment(att: any): Attachment {
    const type = this.detectAttachmentType(att);
    
    return {
      type,
      id: att.legacy_attachment_id || att.id,
      url: att.url || att.playable_url || att.thumbnail?.uri,
      filename: att.filename || att.name,
      filesize: att.file_size,
      width: att.original_dimensions?.width || att.preview?.width,
      height: att.original_dimensions?.height || att.preview?.height,
      duration: att.playable_duration_in_ms,
      previewUrl: att.thumbnail?.uri || att.preview?.uri,
      stickerID: att.sticker?.id
    };
  }

  private detectAttachmentType(att: any): Attachment['type'] {
    if (att.sticker) return 'sticker';
    if (att.__typename?.includes('Video') || att.playable_url) return 'video';
    if (att.__typename?.includes('Audio')) return 'audio';
    if (att.__typename?.includes('Image') || att.large_preview) return 'image';
    if (att.__typename?.includes('Animated')) return 'gif';
    if (att.url && att.url.includes('gif')) return 'gif';
    if (att.__typename?.includes('Share') || att.story_attachment) return 'link';
    return 'file';
  }

  getCachedMessage(messageID: string): Message | undefined {
    return this.messageCache.get(messageID);
  }

  getCachedPinnedMessages(threadID: string): PinnedMessage[] {
    return this.pinnedMessages.get(threadID) || [];
  }

  clearCache(): void {
    this.messageCache.clear();
    this.threadCursors.clear();
    this.pinnedMessages.clear();
    this.logger.info('Message cache cleared');
  }

  getStats(): {
    cachedMessages: number;
    trackedThreads: number;
  } {
    return {
      cachedMessages: this.messageCache.size,
      trackedThreads: this.threadCursors.size
    };
  }
}
