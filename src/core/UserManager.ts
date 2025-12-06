import { EventEmitter } from 'eventemitter3';
import { GraphQLClient, DOC_IDS } from './GraphQLClient';
import { RequestBuilder } from './RequestBuilder';
import { Logger } from './Logger';

export interface UserInfo {
  userID: string;
  name: string;
  firstName?: string;
  lastName?: string;
  vanity?: string;
  profileUrl?: string;
  thumbSrc?: string;
  profilePicture?: {
    small: string;
    medium: string;
    large: string;
  };
  gender?: string;
  isFriend: boolean;
  isBlocked: boolean;
  isVerified: boolean;
  isBusiness: boolean;
}

export interface FriendshipStatus {
  userID: string;
  isFriend: boolean;
  isIncoming: boolean;
  isOutgoing: boolean;
  canMessage: boolean;
}

export interface BlockedUser {
  userID: string;
  name: string;
  blockedAt: number;
}

export class UserManager extends EventEmitter {
  private gql: GraphQLClient;
  private req: RequestBuilder;
  private logger: Logger;
  private cache: Map<string, UserInfo> = new Map();
  private blockedUsers: Set<string> = new Set();
  private cacheTimeout = 10 * 60 * 1000;

  constructor(gql: GraphQLClient, req: RequestBuilder) {
    super();
    this.gql = gql;
    this.req = req;
    this.logger = new Logger('USER');
  }

  async getInfo(userID: string, useCache: boolean = true): Promise<UserInfo | null> {
    this.logger.info(`Getting user info: ${userID}`);
    
    if (useCache) {
      const cached = this.cache.get(userID);
      if (cached) {
        this.logger.debug('Returning cached user info');
        return cached;
      }
    }

    try {
      const response = await this.gql.request({
        docId: DOC_IDS.USER_INFO,
        variables: { user_id: userID }
      });
      
      const user = response.data?.user;
      if (!user) {
        this.logger.warn('User not found');
        return null;
      }

      const info: UserInfo = {
        userID,
        name: user.name || '',
        firstName: user.first_name || user.short_name,
        lastName: user.last_name,
        vanity: user.username || user.vanity,
        profileUrl: user.url || `https://facebook.com/${userID}`,
        thumbSrc: user.profile_picture?.uri || user.thumbSrc,
        profilePicture: {
          small: user.profile_picture?.uri || '',
          medium: user.big_picture?.uri || user.profile_picture?.uri || '',
          large: user.huge_picture?.uri || user.big_picture?.uri || ''
        },
        gender: user.gender,
        isFriend: user.is_friend || false,
        isBlocked: this.blockedUsers.has(userID),
        isVerified: user.is_verified || false,
        isBusiness: user.is_business || false
      };

      this.cache.set(userID, info);
      setTimeout(() => this.cache.delete(userID), this.cacheTimeout);

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
    const uncached: string[] = [];
    
    for (const id of userIDs) {
      const cached = this.cache.get(id);
      if (cached) {
        results.set(id, cached);
      } else {
        uncached.push(id);
      }
    }

    if (uncached.length > 0) {
      const promises = uncached.map(id => this.getInfo(id, false));
      const infos = await Promise.all(promises);
      
      infos.forEach((info, index) => {
        if (info) {
          results.set(uncached[index], info);
        }
      });
    }

    this.logger.success(`Retrieved ${results.size}/${userIDs.length} user profiles`);
    return results;
  }

  async search(query: string, limit: number = 10): Promise<UserInfo[]> {
    this.logger.info(`Searching users: "${query}"`);
    
    try {
      const results = await this.gql.searchUsers(query, limit);
      
      const users: UserInfo[] = results
        .filter((r: any) => r.entity?.id)
        .map((r: any) => ({
          userID: r.entity.id,
          name: r.entity.name || '',
          thumbSrc: r.entity.profile_picture?.uri,
          isFriend: r.entity.is_friend || false,
          isBlocked: false,
          isVerified: r.entity.is_verified || false,
          isBusiness: false
        }));

      this.logger.success(`Found ${users.length} users`);
      return users;
    } catch (error: any) {
      this.logger.error('Search failed:', error.message);
      return [];
    }
  }

  async blockUser(userID: string): Promise<boolean> {
    this.logger.info(`Blocking user ${userID}`);
    
    try {
      const formDefaults = this.req.getFormDefaults();
      
      await this.req.postForm('/ajax/privacy/block_user.php', {
        ...formDefaults,
        block_user_id: userID,
        confirmed: '1'
      });

      this.blockedUsers.add(userID);
      const cached = this.cache.get(userID);
      if (cached) {
        cached.isBlocked = true;
      }
      
      this.logger.success('User blocked');
      this.emit('user_blocked', { userID });
      return true;
    } catch (error: any) {
      this.logger.error('Failed to block user:', error.message);
      return false;
    }
  }

  async unblockUser(userID: string): Promise<boolean> {
    this.logger.info(`Unblocking user ${userID}`);
    
    try {
      const formDefaults = this.req.getFormDefaults();
      
      await this.req.postForm('/ajax/privacy/unblock_user.php', {
        ...formDefaults,
        unblock_user_id: userID,
        confirmed: '1'
      });

      this.blockedUsers.delete(userID);
      const cached = this.cache.get(userID);
      if (cached) {
        cached.isBlocked = false;
      }
      
      this.logger.success('User unblocked');
      this.emit('user_unblocked', { userID });
      return true;
    } catch (error: any) {
      this.logger.error('Failed to unblock user:', error.message);
      return false;
    }
  }

  async getFriendshipStatus(userID: string): Promise<FriendshipStatus | null> {
    this.logger.info(`Getting friendship status with ${userID}`);
    
    try {
      const info = await this.getInfo(userID);
      if (!info) return null;

      return {
        userID,
        isFriend: info.isFriend,
        isIncoming: false,
        isOutgoing: false,
        canMessage: true
      };
    } catch (error: any) {
      this.logger.error('Failed to get friendship status:', error.message);
      return null;
    }
  }

  async sendFriendRequest(userID: string): Promise<boolean> {
    this.logger.info(`Sending friend request to ${userID}`);
    
    try {
      const formDefaults = this.req.getFormDefaults();
      
      await this.req.postForm('/ajax/add_friend/action.php', {
        ...formDefaults,
        to_friend: userID,
        action: 'add_friend'
      });

      this.logger.success('Friend request sent');
      this.emit('friend_request_sent', { userID });
      return true;
    } catch (error: any) {
      this.logger.error('Failed to send friend request:', error.message);
      return false;
    }
  }

  async cancelFriendRequest(userID: string): Promise<boolean> {
    this.logger.info(`Canceling friend request to ${userID}`);
    
    try {
      const formDefaults = this.req.getFormDefaults();
      
      await this.req.postForm('/ajax/add_friend/action.php', {
        ...formDefaults,
        friend: userID,
        action: 'cancel_request'
      });

      this.logger.success('Friend request canceled');
      return true;
    } catch (error: any) {
      this.logger.error('Failed to cancel friend request:', error.message);
      return false;
    }
  }

  async acceptFriendRequest(userID: string): Promise<boolean> {
    this.logger.info(`Accepting friend request from ${userID}`);
    
    try {
      const formDefaults = this.req.getFormDefaults();
      
      await this.req.postForm('/ajax/add_friend/action.php', {
        ...formDefaults,
        from_friend: userID,
        action: 'confirm'
      });

      this.logger.success('Friend request accepted');
      this.emit('friend_added', { userID });
      return true;
    } catch (error: any) {
      this.logger.error('Failed to accept friend request:', error.message);
      return false;
    }
  }

  async removeFriend(userID: string): Promise<boolean> {
    this.logger.info(`Removing friend ${userID}`);
    
    try {
      const formDefaults = this.req.getFormDefaults();
      
      await this.req.postForm('/ajax/profile/removefriendconfirm.php', {
        ...formDefaults,
        uid: userID,
        confirmed: '1'
      });

      const cached = this.cache.get(userID);
      if (cached) {
        cached.isFriend = false;
      }
      
      this.logger.success('Friend removed');
      this.emit('friend_removed', { userID });
      return true;
    } catch (error: any) {
      this.logger.error('Failed to remove friend:', error.message);
      return false;
    }
  }

  async getProfilePicture(userID: string, size: 'small' | 'medium' | 'large' = 'medium'): Promise<string | null> {
    const info = await this.getInfo(userID);
    if (!info?.profilePicture) return null;
    return info.profilePicture[size];
  }

  isBlocked(userID: string): boolean {
    return this.blockedUsers.has(userID);
  }

  getBlockedUsers(): string[] {
    return Array.from(this.blockedUsers);
  }

  clearCache(): void {
    this.cache.clear();
    this.logger.info('User cache cleared');
  }

  getCached(userID: string): UserInfo | undefined {
    return this.cache.get(userID);
  }
}
