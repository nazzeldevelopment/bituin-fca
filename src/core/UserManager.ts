import { GraphQLClient } from './GraphQLClient';
import { Logger } from './Logger';

export interface UserInfo {
  userID: string;
  name: string;
  profileUrl?: string;
  thumbSrc?: string;
}

export class UserManager {
  private gql: GraphQLClient;
  private logger: Logger;
  private cache: Map<string, UserInfo> = new Map();

  constructor(gql: GraphQLClient) {
    this.gql = gql;
    this.logger = new Logger('USER');
  }

  async getInfo(userID: string, useCache: boolean = true): Promise<UserInfo | null> {
    this.logger.info(`Getting user info: ${userID}`);
    
    if (useCache && this.cache.has(userID)) {
      this.logger.debug('Returning cached user info');
      return this.cache.get(userID)!;
    }

    try {
      const data = await this.gql.request({
        docId: '7242726912461752',
        variables: { user_id: userID }
      });

      const info: UserInfo = {
        userID,
        name: data?.user?.name || 'Unknown User',
        profileUrl: data?.user?.url,
        thumbSrc: data?.user?.profile_picture?.uri
      };

      this.cache.set(userID, info);
      this.logger.success(`User info retrieved: ${info.name}`);
      return info;
    } catch (error: any) {
      this.logger.error('Failed to get user info:', error.message);
      return null;
    }
  }

  async getBulkInfo(userIDs: string[]): Promise<Map<string, UserInfo>> {
    this.logger.info(`Fetching info for ${userIDs.length} users`);
    
    const results = new Map<string, UserInfo>();
    
    for (const id of userIDs) {
      const info = await this.getInfo(id);
      if (info) {
        results.set(id, info);
      }
    }

    this.logger.success(`Retrieved ${results.size}/${userIDs.length} user profiles`);
    return results;
  }

  clearCache(): void {
    this.cache.clear();
    this.logger.info('User cache cleared');
  }
}
