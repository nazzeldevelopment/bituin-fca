import { GraphQLClient } from './GraphQLClient';
import { Logger } from './Logger';

export interface ThreadInfo {
  threadID: string;
  name: string;
  participantIDs: string[];
  isGroup: boolean;
  adminIDs?: string[];
}

export class ThreadManager {
  private gql: GraphQLClient;
  private logger: Logger;
  private cache: Map<string, ThreadInfo> = new Map();

  constructor(gql: GraphQLClient) {
    this.gql = gql;
    this.logger = new Logger('THREAD');
  }

  async getInfo(threadID: string, useCache: boolean = true): Promise<ThreadInfo | null> {
    this.logger.info(`Getting thread info: ${threadID}`);
    
    if (useCache && this.cache.has(threadID)) {
      this.logger.debug('Returning cached thread info');
      return this.cache.get(threadID)!;
    }

    try {
      const data = await this.gql.getThreadInfo(threadID);
      
      const info: ThreadInfo = {
        threadID,
        name: data?.thread?.name || 'Unknown',
        participantIDs: data?.thread?.participants?.map((p: any) => p.id) || [],
        isGroup: data?.thread?.thread_type === 'GROUP',
        adminIDs: data?.thread?.admin_ids || []
      };

      this.cache.set(threadID, info);
      this.logger.success(`Thread info retrieved: ${info.name}`);
      return info;
    } catch (error: any) {
      this.logger.error('Failed to get thread info:', error.message);
      return null;
    }
  }

  async getMessages(threadID: string, limit: number = 20): Promise<any[]> {
    this.logger.info(`Fetching ${limit} messages from ${threadID}`);
    
    try {
      const data = await this.gql.getThreadMessages(threadID, limit);
      const messages = data?.thread?.messages?.nodes || [];
      this.logger.success(`Retrieved ${messages.length} messages`);
      return messages;
    } catch (error: any) {
      this.logger.error('Failed to fetch messages:', error.message);
      return [];
    }
  }

  clearCache(): void {
    this.cache.clear();
    this.logger.info('Thread cache cleared');
  }
}
