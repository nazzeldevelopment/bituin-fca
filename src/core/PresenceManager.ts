import { EventEmitter } from 'eventemitter3';
import { RequestBuilder } from './RequestBuilder';
import { Logger } from './Logger';

export interface PresenceInfo {
  userID: string;
  status: 'online' | 'offline' | 'idle' | 'active' | 'away' | 'invisible';
  lastActive: number;
  lastActiveFormatted: string;
  activeNow: boolean;
  device?: 'mobile' | 'web' | 'desktop' | 'messenger' | 'facebook';
  deviceDetails?: DeviceDetails;
  activityLevel: 'high' | 'medium' | 'low' | 'none';
}

export interface DeviceDetails {
  appName?: string;
  appVersion?: string;
  osName?: string;
  osVersion?: string;
  deviceModel?: string;
  isMessenger: boolean;
  isFacebookApp: boolean;
  isWeb: boolean;
}

export interface PresenceEvent {
  userID: string;
  status: string;
  lastActive: number;
  lastActiveFormatted: string;
  previous?: string;
  device?: string;
  deviceDetails?: DeviceDetails;
}

export interface ActiveTimesData {
  userID: string;
  activeTimes: number[];
  averageActiveHour: number;
  mostActiveDay: string;
  lastSeenPattern: 'morning' | 'afternoon' | 'evening' | 'night' | 'irregular';
}

export interface PresenceManagerConfig {
  pollInterval: number;
  staleThreshold: number;
  trackActivityPatterns: boolean;
  maxCacheSize: number;
}

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export class PresenceManager extends EventEmitter {
  private req: RequestBuilder;
  private logger: Logger;
  private presenceCache: Map<string, PresenceInfo> = new Map();
  private watchedUsers: Set<string> = new Set();
  private myPresence: 'online' | 'offline' | 'invisible' = 'online';
  private presenceUpdateInterval?: NodeJS.Timeout;
  private activityHistory: Map<string, number[]> = new Map();
  private config: PresenceManagerConfig;
  private lastBulkFetch: number = 0;

  constructor(req: RequestBuilder, config?: Partial<PresenceManagerConfig>) {
    super();
    this.req = req;
    this.logger = new Logger('PRESENCE');
    this.config = {
      pollInterval: 60000,
      staleThreshold: 15 * 60 * 1000,
      trackActivityPatterns: true,
      maxCacheSize: 10000,
      ...config,
    };
  }

  async setMyPresence(status: 'online' | 'offline' | 'invisible'): Promise<boolean> {
    this.logger.info(`Setting my presence to ${status}`);
    
    try {
      const formDefaults = this.req.getFormDefaults();
      
      if (status === 'invisible') {
        await this.req.postForm('/ajax/presence/invisibility_status.php', {
          ...formDefaults,
          visible: 'false',
        });
      } else {
        await this.req.postForm('/ajax/presence/reconnect.php', {
          ...formDefaults,
          visibility: status === 'online' ? 'true' : 'false',
        });
      }

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

  async fetchBulkPresence(userIDs: string[]): Promise<Map<string, PresenceInfo>> {
    if (userIDs.length === 0) return new Map();

    const timeSinceLastFetch = Date.now() - this.lastBulkFetch;
    if (timeSinceLastFetch < 5000) {
      await new Promise(r => setTimeout(r, 5000 - timeSinceLastFetch));
    }

    try {
      const formDefaults = this.req.getFormDefaults();
      const response = await this.req.postForm('/ajax/chat/buddy_list.php', {
        ...formDefaults,
        user_ids: JSON.stringify(userIDs.slice(0, 100)),
        fetch_mobile: true,
        get_last_active: true,
      });

      this.lastBulkFetch = Date.now();
      const results = new Map<string, PresenceInfo>();

      const data = response?.data || response;
      if (data && data.payload) {
        const buddyList = data.payload.buddy_list || data.payload;
        
        for (const userID of Object.keys(buddyList)) {
          const data = buddyList[userID];
          const info = this.parsePresenceData(userID, data);
          results.set(userID, info);
          this.presenceCache.set(userID, info);
        }
      }

      this.logger.debug(`Fetched presence for ${results.size} users`);
      return results;
    } catch (error: any) {
      this.logger.error('Failed to fetch bulk presence:', error.message);
      return new Map();
    }
  }

  private parsePresenceData(userID: string, data: any): PresenceInfo {
    const status = this.parseStatus(data);
    const lastActive = this.parseLastActive(data);
    const device = this.parseDevice(data);
    const deviceDetails = this.parseDeviceDetails(data);
    
    return {
      userID,
      status,
      lastActive,
      lastActiveFormatted: this.formatLastActiveTime(lastActive),
      activeNow: status === 'online' || status === 'active',
      device,
      deviceDetails,
      activityLevel: this.calculateActivityLevel(lastActive, status),
    };
  }

  handlePresenceEvent(event: any): void {
    const userID = event.userId || event.uid || event.from || event.id || '';
    if (!userID) return;

    const previousInfo = this.presenceCache.get(userID);
    
    const status = this.parseStatus(event);
    const lastActive = this.parseLastActive(event);
    const device = this.parseDevice(event);
    const deviceDetails = this.parseDeviceDetails(event);
    
    const info: PresenceInfo = {
      userID,
      status,
      lastActive,
      lastActiveFormatted: this.formatLastActiveTime(lastActive),
      activeNow: status === 'online' || status === 'active',
      device,
      deviceDetails,
      activityLevel: this.calculateActivityLevel(lastActive, status),
    };

    this.presenceCache.set(userID, info);
    this.enforceMaxCacheSize();

    if (this.config.trackActivityPatterns && info.activeNow) {
      this.recordActivity(userID);
    }

    const presenceEvent: PresenceEvent = {
      userID,
      status,
      lastActive,
      lastActiveFormatted: info.lastActiveFormatted,
      previous: previousInfo?.status,
      device,
      deviceDetails,
    };

    if (previousInfo?.status !== status) {
      this.logger.debug(`User ${userID} is now ${status} (was ${previousInfo?.status || 'unknown'})`);
      this.emit('presence_change', presenceEvent);
      
      if (status === 'online' || status === 'active') {
        this.emit('user_online', presenceEvent);
      } else if (status === 'offline') {
        this.emit('user_offline', presenceEvent);
      } else if (status === 'idle' || status === 'away') {
        this.emit('user_away', presenceEvent);
      }
    }

    if (previousInfo?.device !== device && device) {
      this.emit('device_changed', { userID, device, previousDevice: previousInfo?.device });
    }

    this.emit('presence', presenceEvent);
  }

  private parseStatus(event: any): 'online' | 'offline' | 'idle' | 'active' | 'away' | 'invisible' {
    if (event.p !== undefined) {
      switch (event.p) {
        case 0: return 'online';
        case 1: return 'idle';
        case 2: return 'offline';
        case 3: return 'away';
        default: return 'offline';
      }
    }
    
    if (event.l !== undefined) {
      return event.l === 0 ? 'online' : 'offline';
    }

    if (event.vc !== undefined) {
      if (event.vc === 0) return 'invisible';
    }

    if (event.status) {
      const statusMap: Record<string, any> = {
        'active': 'active',
        'online': 'online',
        'idle': 'idle',
        'away': 'away',
        'offline': 'offline',
        'invisible': 'invisible',
      };
      return statusMap[event.status] || 'offline';
    }
    
    if (event.a !== undefined) {
      switch (event.a) {
        case 0: return 'active';
        case 1: return 'online';
        case 2: return 'idle';
        case 3: return 'away';
        default: return 'offline';
      }
    }

    if (event.lat !== undefined && Date.now() - event.lat < 300000) {
      return 'online';
    }

    return 'offline';
  }

  private parseLastActive(event: any): number {
    if (event.lat) return event.lat * 1000;
    if (event.lastActive) return event.lastActive;
    if (event.last_active) return event.last_active * 1000;
    if (event.last_active_time) return event.last_active_time * 1000;
    if (event.la) return event.la * 1000;
    
    const status = this.parseStatus(event);
    if (status === 'online' || status === 'active') {
      return Date.now();
    }
    
    return 0;
  }

  private parseDevice(event: any): 'mobile' | 'web' | 'desktop' | 'messenger' | 'facebook' | undefined {
    if (event.c !== undefined) {
      switch (event.c) {
        case 1: return 'web';
        case 2: return 'mobile';
        case 3: return 'messenger';
        case 4: return 'desktop';
        case 5: return 'facebook';
      }
    }

    if (event.webStatus === 1 || event.web) return 'web';
    if (event.messengerStatus === 1 || event.messenger) return 'messenger';
    if (event.appStatus === 1 || event.mobile || event.m) return 'mobile';
    if (event.desktopStatus === 1 || event.desktop) return 'desktop';
    if (event.fbAppStatus === 1) return 'facebook';

    if (event.client) {
      const client = event.client.toLowerCase();
      if (client.includes('messenger')) return 'messenger';
      if (client.includes('mobile') || client.includes('android') || client.includes('ios')) return 'mobile';
      if (client.includes('desktop')) return 'desktop';
      if (client.includes('web')) return 'web';
    }

    return undefined;
  }

  private parseDeviceDetails(event: any): DeviceDetails | undefined {
    if (!event.device && !event.client && !event.app_name) {
      return undefined;
    }

    return {
      appName: event.app_name || event.appName,
      appVersion: event.app_version || event.appVersion,
      osName: event.os_name || event.osName,
      osVersion: event.os_version || event.osVersion,
      deviceModel: event.device_model || event.deviceModel,
      isMessenger: !!(event.messengerStatus || event.messenger || event.app_name?.toLowerCase()?.includes('messenger')),
      isFacebookApp: !!(event.fbAppStatus || event.app_name?.toLowerCase()?.includes('facebook')),
      isWeb: !!(event.webStatus || event.web),
    };
  }

  private calculateActivityLevel(lastActive: number, status: string): 'high' | 'medium' | 'low' | 'none' {
    if (status === 'online' || status === 'active') return 'high';
    if (status === 'idle') return 'medium';

    if (lastActive === 0) return 'none';

    const timeSince = Date.now() - lastActive;
    if (timeSince < 5 * 60 * 1000) return 'high';
    if (timeSince < 30 * 60 * 1000) return 'medium';
    if (timeSince < 2 * 60 * 60 * 1000) return 'low';
    return 'none';
  }

  private formatLastActiveTime(timestamp: number): string {
    if (!timestamp || timestamp === 0) return 'Unknown';
    
    const now = Date.now();
    const diff = now - timestamp;
    
    if (diff < 0) return 'Active now';
    if (diff < 60000) return 'Just now';
    if (diff < 120000) return '1 minute ago';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} minutes ago`;
    if (diff < 7200000) return '1 hour ago';
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours ago`;
    if (diff < 172800000) return 'Yesterday';
    if (diff < 604800000) return `${Math.floor(diff / 86400000)} days ago`;
    
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  private recordActivity(userID: string): void {
    const history = this.activityHistory.get(userID) || [];
    history.push(Date.now());
    
    if (history.length > 100) {
      history.shift();
    }
    
    this.activityHistory.set(userID, history);
  }

  getActivityPattern(userID: string): ActiveTimesData | null {
    const history = this.activityHistory.get(userID);
    if (!history || history.length < 5) return null;

    const hours = history.map(t => new Date(t).getHours());
    const days = history.map(t => new Date(t).getDay());

    const avgHour = hours.reduce((a, b) => a + b, 0) / hours.length;
    
    const dayCounts: Record<number, number> = {};
    days.forEach(d => dayCounts[d] = (dayCounts[d] || 0) + 1);
    const mostActiveDay = Object.entries(dayCounts)
      .sort(([,a], [,b]) => b - a)[0];

    let pattern: 'morning' | 'afternoon' | 'evening' | 'night' | 'irregular';
    if (avgHour >= 5 && avgHour < 12) pattern = 'morning';
    else if (avgHour >= 12 && avgHour < 17) pattern = 'afternoon';
    else if (avgHour >= 17 && avgHour < 21) pattern = 'evening';
    else if (avgHour >= 21 || avgHour < 5) pattern = 'night';
    else pattern = 'irregular';

    const variance = hours.reduce((sum, h) => sum + Math.pow(h - avgHour, 2), 0) / hours.length;
    if (variance > 36) pattern = 'irregular';

    return {
      userID,
      activeTimes: history.slice(-20),
      averageActiveHour: Math.round(avgHour),
      mostActiveDay: DAYS_OF_WEEK[parseInt(mostActiveDay[0])],
      lastSeenPattern: pattern,
    };
  }

  getPresence(userID: string): PresenceInfo | undefined {
    return this.presenceCache.get(userID);
  }

  isOnline(userID: string): boolean {
    const presence = this.presenceCache.get(userID);
    return presence?.status === 'online' || presence?.status === 'active';
  }

  isActive(userID: string): boolean {
    const presence = this.presenceCache.get(userID);
    return presence?.activityLevel === 'high';
  }

  isAway(userID: string): boolean {
    const presence = this.presenceCache.get(userID);
    return presence?.status === 'away' || presence?.status === 'idle';
  }

  getLastActive(userID: string): number | undefined {
    return this.presenceCache.get(userID)?.lastActive;
  }

  getLastActiveFormatted(userID: string): string {
    const info = this.presenceCache.get(userID);
    if (!info) return 'Unknown';
    return info.lastActiveFormatted;
  }

  getDevice(userID: string): string | undefined {
    return this.presenceCache.get(userID)?.device;
  }

  watchUser(userID: string): void {
    this.watchedUsers.add(userID);
    this.logger.debug(`Now watching user ${userID}`);
    this.emit('user_watched', userID);
  }

  unwatchUser(userID: string): void {
    this.watchedUsers.delete(userID);
    this.logger.debug(`Stopped watching user ${userID}`);
    this.emit('user_unwatched', userID);
  }

  getWatchedUsers(): string[] {
    return Array.from(this.watchedUsers);
  }

  isWatching(userID: string): boolean {
    return this.watchedUsers.has(userID);
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

  getActiveUsers(): string[] {
    const active: string[] = [];
    for (const [userID, info] of this.presenceCache.entries()) {
      if (info.activityLevel === 'high') {
        active.push(userID);
      }
    }
    return active;
  }

  getIdleUsers(): string[] {
    const idle: string[] = [];
    for (const [userID, info] of this.presenceCache.entries()) {
      if (info.status === 'idle' || info.status === 'away') {
        idle.push(userID);
      }
    }
    return idle;
  }

  getUsersByDevice(device: 'mobile' | 'web' | 'desktop' | 'messenger' | 'facebook'): string[] {
    const users: string[] = [];
    for (const [userID, info] of this.presenceCache.entries()) {
      if (info.device === device && info.activeNow) {
        users.push(userID);
      }
    }
    return users;
  }

  getAllPresence(): Map<string, PresenceInfo> {
    return new Map(this.presenceCache);
  }

  formatLastActive(userID: string): string {
    const info = this.presenceCache.get(userID);
    if (!info) return 'Unknown';
    
    if (info.activeNow) {
      if (info.device) {
        return `Active now on ${info.device}`;
      }
      return 'Active now';
    }
    
    return info.lastActiveFormatted;
  }

  getPresenceStats(): { total: number; online: number; idle: number; offline: number; byDevice: Record<string, number> } {
    let online = 0, idle = 0, offline = 0;
    const byDevice: Record<string, number> = {};

    for (const info of this.presenceCache.values()) {
      if (info.status === 'online' || info.status === 'active') {
        online++;
      } else if (info.status === 'idle' || info.status === 'away') {
        idle++;
      } else {
        offline++;
      }

      if (info.device && info.activeNow) {
        byDevice[info.device] = (byDevice[info.device] || 0) + 1;
      }
    }

    return {
      total: this.presenceCache.size,
      online,
      idle,
      offline,
      byDevice,
    };
  }

  startPolling(interval?: number): void {
    this.stopPolling();
    
    const pollInterval = interval || this.config.pollInterval;
    
    this.presenceUpdateInterval = setInterval(() => {
      this.cleanupStalePresence();
      
      if (this.watchedUsers.size > 0) {
        this.fetchBulkPresence(Array.from(this.watchedUsers)).catch(() => {});
      }
    }, pollInterval);
    
    this.logger.debug(`Presence polling started (${pollInterval}ms)`);
  }

  stopPolling(): void {
    if (this.presenceUpdateInterval) {
      clearInterval(this.presenceUpdateInterval);
      this.presenceUpdateInterval = undefined;
      this.logger.debug('Presence polling stopped');
    }
  }

  private cleanupStalePresence(): void {
    const now = Date.now();
    let staleCount = 0;
    
    for (const [userID, info] of this.presenceCache.entries()) {
      if (info.lastActive > 0 && now - info.lastActive > this.config.staleThreshold && info.status !== 'offline') {
        info.status = 'offline';
        info.activeNow = false;
        info.activityLevel = 'none';
        info.lastActiveFormatted = this.formatLastActiveTime(info.lastActive);
        staleCount++;
        
        this.emit('presence_change', {
          userID,
          status: 'offline',
          lastActive: info.lastActive,
          lastActiveFormatted: info.lastActiveFormatted,
          previous: 'online',
        });
      }
    }

    if (staleCount > 0) {
      this.logger.debug(`Marked ${staleCount} users as offline (stale)`);
    }
  }

  private enforceMaxCacheSize(): void {
    if (this.presenceCache.size > this.config.maxCacheSize) {
      const entries = Array.from(this.presenceCache.entries())
        .filter(([id]) => !this.watchedUsers.has(id))
        .sort((a, b) => a[1].lastActive - b[1].lastActive);
      
      const toRemove = entries.slice(0, this.presenceCache.size - this.config.maxCacheSize + 100);
      for (const [id] of toRemove) {
        this.presenceCache.delete(id);
      }
      
      this.logger.debug(`Evicted ${toRemove.length} stale presence entries`);
    }
  }

  clearCache(): void {
    this.presenceCache.clear();
    this.activityHistory.clear();
    this.logger.info('Presence cache cleared');
  }

  destroy(): void {
    this.stopPolling();
    this.presenceCache.clear();
    this.watchedUsers.clear();
    this.activityHistory.clear();
    this.removeAllListeners();
    this.logger.info('Presence manager destroyed');
  }
}
