import { EventEmitter } from 'eventemitter3';
import { RequestBuilder } from './RequestBuilder';
import { Logger } from './Logger';

export interface PresenceInfo {
  userID: string;
  status: 'online' | 'offline' | 'idle' | 'active';
  lastActive: number;
  activeNow: boolean;
  device?: 'mobile' | 'web' | 'desktop';
}

export interface PresenceEvent {
  userID: string;
  status: string;
  lastActive: number;
  previous?: string;
}

export class PresenceManager extends EventEmitter {
  private req: RequestBuilder;
  private logger: Logger;
  private presenceCache: Map<string, PresenceInfo> = new Map();
  private watchedUsers: Set<string> = new Set();
  private myPresence: 'online' | 'offline' = 'online';
  private presenceUpdateInterval?: NodeJS.Timeout;

  constructor(req: RequestBuilder) {
    super();
    this.req = req;
    this.logger = new Logger('PRESENCE');
  }

  async setMyPresence(status: 'online' | 'offline'): Promise<boolean> {
    this.logger.info(`Setting my presence to ${status}`);
    
    try {
      const formDefaults = this.req.getFormDefaults();
      
      await this.req.postForm('/ajax/presence/reconnect.php', {
        ...formDefaults,
        visibility: status === 'online' ? 'true' : 'false'
      });

      this.myPresence = status;
      this.logger.success(`Presence set to ${status}`);
      return true;
    } catch (error: any) {
      this.logger.error('Failed to set presence:', error.message);
      return false;
    }
  }

  getMyPresence(): string {
    return this.myPresence;
  }

  handlePresenceEvent(event: any): void {
    const userID = event.userId || event.uid || event.from || '';
    if (!userID) return;

    const previousInfo = this.presenceCache.get(userID);
    
    const status = this.parseStatus(event);
    const lastActive = event.lat || event.lastActive || event.last_active || Date.now();
    
    const info: PresenceInfo = {
      userID,
      status,
      lastActive,
      activeNow: status === 'online' || status === 'active',
      device: this.parseDevice(event)
    };

    this.presenceCache.set(userID, info);

    const presenceEvent: PresenceEvent = {
      userID,
      status,
      lastActive,
      previous: previousInfo?.status
    };

    if (previousInfo?.status !== status) {
      this.logger.debug(`User ${userID} is now ${status}`);
      this.emit('presence_change', presenceEvent);
      
      if (status === 'online') {
        this.emit('user_online', presenceEvent);
      } else if (status === 'offline') {
        this.emit('user_offline', presenceEvent);
      }
    }

    this.emit('presence', presenceEvent);
  }

  private parseStatus(event: any): 'online' | 'offline' | 'idle' | 'active' {
    if (event.p !== undefined) {
      if (event.p === 0) return 'online';
      if (event.p === 2) return 'offline';
    }
    
    if (event.l !== undefined) {
      return event.l === 0 ? 'online' : 'offline';
    }
    
    if (event.status) {
      return event.status as any;
    }
    
    if (event.a !== undefined) {
      return event.a === 0 ? 'active' : 'idle';
    }

    return 'offline';
  }

  private parseDevice(event: any): 'mobile' | 'web' | 'desktop' | undefined {
    if (event.webStatus === 1 || event.web) return 'web';
    if (event.appStatus === 1 || event.mobile) return 'mobile';
    if (event.desktopStatus === 1) return 'desktop';
    return undefined;
  }

  getPresence(userID: string): PresenceInfo | undefined {
    return this.presenceCache.get(userID);
  }

  isOnline(userID: string): boolean {
    const presence = this.presenceCache.get(userID);
    return presence?.status === 'online' || presence?.status === 'active';
  }

  getLastActive(userID: string): number | undefined {
    return this.presenceCache.get(userID)?.lastActive;
  }

  watchUser(userID: string): void {
    this.watchedUsers.add(userID);
    this.logger.debug(`Now watching user ${userID}`);
  }

  unwatchUser(userID: string): void {
    this.watchedUsers.delete(userID);
    this.logger.debug(`Stopped watching user ${userID}`);
  }

  getWatchedUsers(): string[] {
    return Array.from(this.watchedUsers);
  }

  getOnlineUsers(): string[] {
    const online: string[] = [];
    for (const [userID, info] of this.presenceCache.entries()) {
      if (info.status === 'online' || info.status === 'active') {
        online.push(userID);
      }
    }
    return online;
  }

  getAllPresence(): Map<string, PresenceInfo> {
    return new Map(this.presenceCache);
  }

  formatLastActive(userID: string): string {
    const info = this.presenceCache.get(userID);
    if (!info) return 'Unknown';
    
    if (info.activeNow) return 'Active now';
    
    const diff = Date.now() - info.lastActive;
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  }

  startPolling(interval: number = 60000): void {
    this.stopPolling();
    
    this.presenceUpdateInterval = setInterval(() => {
      this.cleanupStalePresence();
    }, interval);
    
    this.logger.debug(`Presence polling started (${interval}ms)`);
  }

  stopPolling(): void {
    if (this.presenceUpdateInterval) {
      clearInterval(this.presenceUpdateInterval);
      this.presenceUpdateInterval = undefined;
    }
  }

  private cleanupStalePresence(): void {
    const staleTime = 15 * 60 * 1000;
    const now = Date.now();
    
    for (const [userID, info] of this.presenceCache.entries()) {
      if (now - info.lastActive > staleTime && info.status !== 'offline') {
        info.status = 'offline';
        info.activeNow = false;
        this.emit('presence_change', {
          userID,
          status: 'offline',
          lastActive: info.lastActive,
          previous: 'online'
        });
      }
    }
  }

  clearCache(): void {
    this.presenceCache.clear();
    this.logger.info('Presence cache cleared');
  }

  destroy(): void {
    this.stopPolling();
    this.presenceCache.clear();
    this.watchedUsers.clear();
    this.removeAllListeners();
  }
}
