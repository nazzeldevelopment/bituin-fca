import { EventEmitter } from 'eventemitter3';
import { GraphQLClient, DOC_IDS } from './GraphQLClient';
import { RequestBuilder } from './RequestBuilder';
import { Logger } from './Logger';

export interface ThreadInfo {
  threadID: string;
  name: string;
  participantIDs: string[];
  isGroup: boolean;
  adminIDs: string[];
  emoji?: string;
  color?: string;
  imageUrl?: string;
  unreadCount: number;
  messageCount: number;
  lastMessage?: {
    text: string;
    senderID: string;
    timestamp: number;
  };
  isArchived: boolean;
  isMuted: boolean;
  muteUntil?: number;
  nicknames: Record<string, string>;
}

export interface CreateGroupOptions {
  name?: string;
  participantIDs: string[];
  message?: string;
}

export interface ThreadUpdateOptions {
  name?: string;
  emoji?: string;
  color?: string;
  imageUrl?: string;
}

export class ThreadManager extends EventEmitter {
  private gql: GraphQLClient;
  private req: RequestBuilder;
  private logger: Logger;
  private cache: Map<string, ThreadInfo> = new Map();
  private cacheTimeout = 5 * 60 * 1000;

  constructor(gql: GraphQLClient, req: RequestBuilder) {
    super();
    this.gql = gql;
    this.req = req;
    this.logger = new Logger('THREAD');
  }

  async getInfo(threadID: string, useCache: boolean = true): Promise<ThreadInfo | null> {
    this.logger.info(`Getting thread info: ${threadID}`);
    
    if (useCache) {
      const cached = this.cache.get(threadID);
      if (cached) {
        this.logger.debug('Returning cached thread info');
        return cached;
      }
    }

    try {
      const response = await this.gql.request({
        docId: DOC_IDS.THREAD_INFO,
        variables: { thread_id: threadID }
      });
      
      const thread = response.data?.thread;
      if (!thread) {
        this.logger.warn('Thread not found');
        return null;
      }

      const info: ThreadInfo = {
        threadID,
        name: thread.name || thread.thread_name || '',
        participantIDs: thread.all_participants?.nodes?.map((p: any) => p.id) || [],
        isGroup: thread.thread_type === 'GROUP',
        adminIDs: thread.admin_ids || [],
        emoji: thread.customized_emoji || thread.thread_emoji,
        color: thread.color || thread.thread_color,
        imageUrl: thread.image?.uri || thread.thread_picture?.uri,
        unreadCount: thread.unread_count || 0,
        messageCount: thread.message_count || 0,
        lastMessage: thread.last_message ? {
          text: thread.last_message.nodes?.[0]?.snippet || '',
          senderID: thread.last_message.nodes?.[0]?.message_sender?.id || '',
          timestamp: thread.last_message.nodes?.[0]?.timestamp_precise || 0
        } : undefined,
        isArchived: thread.folder === 'ARCHIVED',
        isMuted: thread.mute_until > Date.now(),
        muteUntil: thread.mute_until,
        nicknames: {}
      };

      if (thread.customization_info?.participant_customizations) {
        for (const c of thread.customization_info.participant_customizations) {
          if (c.nickname) {
            info.nicknames[c.participant_id] = c.nickname;
          }
        }
      }

      this.cache.set(threadID, info);
      setTimeout(() => this.cache.delete(threadID), this.cacheTimeout);

      this.logger.success(`Thread info retrieved: ${info.name || 'Unnamed'}`);
      return info;
    } catch (error: any) {
      this.logger.error('Failed to get thread info:', error.message);
      return null;
    }
  }

  async getMessages(threadID: string, limit: number = 20, before?: string): Promise<any[]> {
    this.logger.info(`Fetching ${limit} messages from ${threadID}`);
    
    try {
      const messages = await this.gql.getThreadMessages(threadID, limit, before);
      this.logger.success(`Retrieved ${messages.length} messages`);
      return messages;
    } catch (error: any) {
      this.logger.error('Failed to fetch messages:', error.message);
      return [];
    }
  }

  async getList(limit: number = 20, folder: string = 'INBOX'): Promise<ThreadInfo[]> {
    this.logger.info(`Fetching thread list (${limit} threads, ${folder})`);
    
    try {
      const threads = await this.gql.getThreadList(limit, folder);
      
      const infos: ThreadInfo[] = threads.map((t: any) => ({
        threadID: t.thread_key?.thread_fbid || t.thread_key?.other_user_id || '',
        name: t.name || '',
        participantIDs: t.all_participants?.nodes?.map((p: any) => p.id) || [],
        isGroup: t.thread_type === 'GROUP',
        adminIDs: t.admin_ids || [],
        unreadCount: t.unread_count || 0,
        messageCount: t.message_count || 0,
        isArchived: t.folder === 'ARCHIVED',
        isMuted: t.mute_until > Date.now(),
        nicknames: {}
      }));

      this.logger.success(`Retrieved ${infos.length} threads`);
      return infos;
    } catch (error: any) {
      this.logger.error('Failed to fetch thread list:', error.message);
      return [];
    }
  }

  async createGroup(options: CreateGroupOptions): Promise<string | null> {
    this.logger.info(`Creating group with ${options.participantIDs.length} participants`);
    
    if (options.participantIDs.length < 2) {
      this.logger.error('Need at least 2 participants');
      return null;
    }

    try {
      const response = await this.gql.request({
        docId: DOC_IDS.CREATE_GROUP,
        variables: {
          participant_ids: options.participantIDs,
          name: options.name,
          initial_message: options.message
        }
      });

      const threadID = response.data?.createGroupThread?.thread_key?.thread_fbid;
      
      if (threadID) {
        this.logger.success(`Group created: ${threadID}`);
        this.emit('group_created', { threadID, ...options });
        return threadID;
      }

      return null;
    } catch (error: any) {
      this.logger.error('Failed to create group:', error.message);
      return null;
    }
  }

  async addParticipants(threadID: string, userIDs: string[]): Promise<boolean> {
    this.logger.info(`Adding ${userIDs.length} participants to ${threadID}`);
    
    try {
      const response = await this.gql.request({
        docId: DOC_IDS.ADD_PARTICIPANTS,
        variables: {
          thread_id: threadID,
          participant_ids: userIDs
        }
      });

      const success = !response.errors;
      if (success) {
        this.logger.success('Participants added');
        this.emit('participants_added', { threadID, userIDs });
        this.cache.delete(threadID);
      }
      
      return success;
    } catch (error: any) {
      this.logger.error('Failed to add participants:', error.message);
      return false;
    }
  }

  async removeParticipant(threadID: string, userID: string): Promise<boolean> {
    this.logger.info(`Removing participant ${userID} from ${threadID}`);
    
    try {
      const response = await this.gql.request({
        docId: DOC_IDS.REMOVE_PARTICIPANT,
        variables: {
          thread_id: threadID,
          participant_id: userID
        }
      });

      const success = !response.errors;
      if (success) {
        this.logger.success('Participant removed');
        this.emit('participant_removed', { threadID, userID });
        this.cache.delete(threadID);
      }
      
      return success;
    } catch (error: any) {
      this.logger.error('Failed to remove participant:', error.message);
      return false;
    }
  }

  async leaveGroup(threadID: string): Promise<boolean> {
    this.logger.info(`Leaving group ${threadID}`);
    
    try {
      const response = await this.gql.request({
        docId: DOC_IDS.LEAVE_GROUP,
        variables: { thread_id: threadID }
      });

      const success = !response.errors;
      if (success) {
        this.logger.success('Left group');
        this.emit('group_left', { threadID });
        this.cache.delete(threadID);
      }
      
      return success;
    } catch (error: any) {
      this.logger.error('Failed to leave group:', error.message);
      return false;
    }
  }

  async updateThread(threadID: string, options: ThreadUpdateOptions): Promise<boolean> {
    this.logger.info(`Updating thread ${threadID}`);
    
    try {
      let success = true;

      if (options.name !== undefined) {
        const res = await this.gql.request({
          docId: DOC_IDS.CHANGE_THREAD_NAME,
          variables: { thread_id: threadID, name: options.name }
        });
        success = success && !res.errors;
      }

      if (options.emoji !== undefined) {
        const res = await this.gql.request({
          docId: DOC_IDS.CHANGE_THREAD_EMOJI,
          variables: { thread_id: threadID, emoji: options.emoji }
        });
        success = success && !res.errors;
      }

      if (success) {
        this.logger.success('Thread updated');
        this.emit('thread_updated', { threadID, ...options });
        this.cache.delete(threadID);
      }
      
      return success;
    } catch (error: any) {
      this.logger.error('Failed to update thread:', error.message);
      return false;
    }
  }

  async setNickname(threadID: string, userID: string, nickname: string): Promise<boolean> {
    this.logger.info(`Setting nickname for ${userID} in ${threadID}`);
    
    try {
      const response = await this.gql.request({
        docId: DOC_IDS.CHANGE_NICKNAME,
        variables: {
          thread_id: threadID,
          participant_id: userID,
          nickname
        }
      });

      const success = !response.errors;
      if (success) {
        this.logger.success('Nickname set');
        this.cache.delete(threadID);
      }
      
      return success;
    } catch (error: any) {
      this.logger.error('Failed to set nickname:', error.message);
      return false;
    }
  }

  async muteThread(threadID: string, muteUntil: number | 'forever'): Promise<boolean> {
    this.logger.info(`Muting thread ${threadID}`);
    
    const until = muteUntil === 'forever' ? -1 : muteUntil;
    
    try {
      const response = await this.gql.request({
        docId: DOC_IDS.MUTE_THREAD,
        variables: {
          thread_id: threadID,
          mute_until: until
        }
      });

      const success = !response.errors;
      if (success) {
        this.logger.success('Thread muted');
        this.cache.delete(threadID);
      }
      
      return success;
    } catch (error: any) {
      this.logger.error('Failed to mute thread:', error.message);
      return false;
    }
  }

  async unmuteThread(threadID: string): Promise<boolean> {
    return this.muteThread(threadID, 0);
  }

  async archiveThread(threadID: string): Promise<boolean> {
    this.logger.info(`Archiving thread ${threadID}`);
    
    try {
      const response = await this.gql.request({
        docId: DOC_IDS.ARCHIVE_THREAD,
        variables: {
          thread_id: threadID,
          archive: true
        }
      });

      const success = !response.errors;
      if (success) {
        this.logger.success('Thread archived');
        this.emit('thread_archived', { threadID });
        this.cache.delete(threadID);
      }
      
      return success;
    } catch (error: any) {
      this.logger.error('Failed to archive thread:', error.message);
      return false;
    }
  }

  async unarchiveThread(threadID: string): Promise<boolean> {
    this.logger.info(`Unarchiving thread ${threadID}`);
    
    try {
      const response = await this.gql.request({
        docId: DOC_IDS.ARCHIVE_THREAD,
        variables: {
          thread_id: threadID,
          archive: false
        }
      });

      const success = !response.errors;
      if (success) {
        this.logger.success('Thread unarchived');
        this.cache.delete(threadID);
      }
      
      return success;
    } catch (error: any) {
      this.logger.error('Failed to unarchive thread:', error.message);
      return false;
    }
  }

  async markRead(threadID: string): Promise<boolean> {
    this.logger.info(`Marking thread ${threadID} as read`);
    
    try {
      const response = await this.gql.request({
        docId: DOC_IDS.MARK_READ,
        variables: { thread_id: threadID }
      });

      return !response.errors;
    } catch (error: any) {
      this.logger.error('Failed to mark read:', error.message);
      return false;
    }
  }

  clearCache(): void {
    this.cache.clear();
    this.logger.info('Thread cache cleared');
  }

  getCached(threadID: string): ThreadInfo | undefined {
    return this.cache.get(threadID);
  }
}
