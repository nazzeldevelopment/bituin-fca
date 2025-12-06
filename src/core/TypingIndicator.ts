import { EventEmitter } from 'eventemitter3';
import { RequestBuilder } from './RequestBuilder';
import { Logger } from './Logger';

export interface TypingState {
  threadID: string;
  userID: string;
  isTyping: boolean;
  timestamp: number;
}

export class TypingIndicator extends EventEmitter {
  private req: RequestBuilder;
  private logger: Logger;
  private typingStates: Map<string, TypingState> = new Map();
  private activeTyping: Map<string, NodeJS.Timeout> = new Map();
  private typingInterval = 3000;
  private typingTimeout = 30000;

  constructor(req: RequestBuilder) {
    super();
    this.req = req;
    this.logger = new Logger('TYPING');
    
    setInterval(() => this.cleanupStaleTyping(), 10000);
  }

  async startTyping(threadID: string): Promise<boolean> {
    this.logger.debug(`Starting typing in ${threadID}`);
    
    const key = `outgoing:${threadID}`;
    
    if (this.activeTyping.has(key)) {
      return true;
    }

    try {
      await this.sendTypingIndicator(threadID, true);
      
      const intervalId = setInterval(async () => {
        await this.sendTypingIndicator(threadID, true);
      }, this.typingInterval);
      
      this.activeTyping.set(key, intervalId);
      
      setTimeout(() => {
        this.stopTyping(threadID);
      }, this.typingTimeout);
      
      return true;
    } catch (error: any) {
      this.logger.error('Failed to start typing:', error.message);
      return false;
    }
  }

  async stopTyping(threadID: string): Promise<boolean> {
    this.logger.debug(`Stopping typing in ${threadID}`);
    
    const key = `outgoing:${threadID}`;
    const intervalId = this.activeTyping.get(key);
    
    if (intervalId) {
      clearInterval(intervalId);
      this.activeTyping.delete(key);
    }

    try {
      await this.sendTypingIndicator(threadID, false);
      return true;
    } catch (error: any) {
      this.logger.error('Failed to stop typing:', error.message);
      return false;
    }
  }

  private async sendTypingIndicator(threadID: string, isTyping: boolean): Promise<void> {
    const formDefaults = this.req.getFormDefaults();
    
    const data: Record<string, any> = {
      ...formDefaults,
      typ: isTyping ? '1' : '0',
      to: '',
      source: 'mercury-chat',
      thread: threadID
    };

    if (threadID.length > 15) {
      data.thread_fbid = threadID;
    } else {
      data.to = threadID;
    }

    await this.req.postForm('/ajax/messaging/typ.php', data);
  }

  handleTypingEvent(event: any): void {
    const state: TypingState = {
      threadID: event.threadId || event.thread || event.thread_id || '',
      userID: event.senderId || event.from || event.user_id || '',
      isTyping: event.st === 1 || event.state === 1 || event.isTyping === true,
      timestamp: Date.now()
    };

    if (!state.threadID || !state.userID) return;

    const key = `incoming:${state.threadID}:${state.userID}`;
    
    if (state.isTyping) {
      this.typingStates.set(key, state);
      this.emit('typing_start', state);
      this.logger.debug(`User ${state.userID} started typing in ${state.threadID}`);
    } else {
      this.typingStates.delete(key);
      this.emit('typing_stop', state);
      this.logger.debug(`User ${state.userID} stopped typing in ${state.threadID}`);
    }

    this.emit('typing', state);
  }

  isTyping(threadID: string, userID?: string): boolean {
    if (userID) {
      const key = `incoming:${threadID}:${userID}`;
      const state = this.typingStates.get(key);
      return state?.isTyping || false;
    }

    for (const [key, state] of this.typingStates.entries()) {
      if (key.includes(threadID) && state.isTyping) {
        return true;
      }
    }

    return false;
  }

  getTypingUsers(threadID: string): string[] {
    const users: string[] = [];
    
    for (const [key, state] of this.typingStates.entries()) {
      if (key.includes(threadID) && state.isTyping) {
        users.push(state.userID);
      }
    }

    return users;
  }

  private cleanupStaleTyping(): void {
    const now = Date.now();
    const staleTime = 10000;
    
    for (const [key, state] of this.typingStates.entries()) {
      if (now - state.timestamp > staleTime) {
        this.typingStates.delete(key);
        this.emit('typing_stop', { ...state, isTyping: false });
      }
    }
  }

  stopAllTyping(): void {
    for (const [key, intervalId] of this.activeTyping.entries()) {
      clearInterval(intervalId);
      const threadID = key.replace('outgoing:', '');
      this.sendTypingIndicator(threadID, false).catch(() => {});
    }
    this.activeTyping.clear();
  }

  destroy(): void {
    this.stopAllTyping();
    this.typingStates.clear();
    this.removeAllListeners();
  }
}
