import { EventEmitter } from 'eventemitter3';
import WebSocket from 'ws';
import { Logger } from './Logger';

export interface MQTTConfig {
  url?: string;
  region?: string;
  heartbeatInterval?: number;
  reconnectAttempts?: number;
  reconnectDelay?: number;
  maxReconnectDelay?: number;
}

export interface MQTTMessage {
  topic: string;
  payload: any;
  timestamp: number;
}

export interface PresenceData {
  userID: string;
  status: 'online' | 'offline' | 'idle';
  lastActive: number;
}

export interface TypingData {
  threadID: string;
  userID: string;
  isTyping: boolean;
}

const MQTT_TOPICS = {
  MESSAGE_SYNC: '/t_ms',
  PRESENCE: '/orca_presence',
  TYPING: '/thread_typing',
  TYPING_NOTIFICATION: '/orca_typing_notifications',
  INBOX: '/inbox',
  MARK_THREAD: '/mark_thread',
  DELETE_MESSAGES: '/delete_messages',
  UNSENT_MESSAGE: '/unsent_message',
  SEND_MESSAGE: '/send_message2',
  WEBRTC: '/webrtc',
  MERCURY: '/mercury',
  MESSAGING_EVENTS: '/messaging_events',
  NOTIFICATION: '/notifications_sync',
};

export class MQTTClient extends EventEmitter {
  private ws?: WebSocket;
  private config: Required<MQTTConfig>;
  private logger: Logger;
  private isConnected = false;
  private reconnectAttempts = 0;
  private heartbeatTimer?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;
  private cookieHeader = '';
  private userID = '';
  private subscribedTopics: Set<string> = new Set();
  private messageQueue: MQTTMessage[] = [];
  private sequenceId = 0;
  private lastMessageTime = 0;
  private pendingAcks: Map<string, NodeJS.Timeout> = new Map();

  constructor(config?: MQTTConfig) {
    super();
    this.logger = new Logger('MQTT');
    
    this.config = {
      url: config?.url || 'wss://edge-chat.facebook.com/chat',
      region: config?.region || 'prn',
      heartbeatInterval: config?.heartbeatInterval || 25000,
      reconnectAttempts: config?.reconnectAttempts || 10,
      reconnectDelay: config?.reconnectDelay || 1000,
      maxReconnectDelay: config?.maxReconnectDelay || 30000,
    };
  }

  connect(cookieHeader: string, userID?: string): void {
    this.cookieHeader = cookieHeader;
    this.userID = userID || this.extractUserID(cookieHeader);
    
    const url = `${this.config.url}?region=${this.config.region}&sid=${this.generateSessionId()}`;
    
    this.logger.mqtt(`Connecting to ${url}`);
    this.logger.debug(`User ID: ${this.userID}`);

    this.ws = new WebSocket(url, {
      headers: {
        'Cookie': cookieHeader,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Origin': 'https://www.facebook.com',
        'Sec-WebSocket-Extensions': 'permessage-deflate; client_max_window_bits',
      }
    });

    this.ws.on('open', this.onOpen.bind(this));
    this.ws.on('message', this.onMessage.bind(this));
    this.ws.on('close', this.onClose.bind(this));
    this.ws.on('error', this.onError.bind(this));
    this.ws.on('ping', () => this.ws?.pong());
  }

  private extractUserID(cookieHeader: string): string {
    const match = cookieHeader.match(/c_user=(\d+)/);
    return match ? match[1] : '';
  }

  private generateSessionId(): string {
    return Math.floor(Math.random() * 2147483647).toString();
  }

  private onOpen(): void {
    this.isConnected = true;
    this.reconnectAttempts = 0;
    this.logger.success('WebSocket connected!');
    
    this.sendConnectPacket();
    this.subscribeToDefaultTopics();
    this.startHeartbeat();
    
    this.emit('connected');
  }

  private sendConnectPacket(): void {
    const connectPacket = {
      type: 'connect',
      clientId: `mqttwsclient_${Date.now()}`,
      username: JSON.stringify({
        u: this.userID,
        s: this.generateSessionId(),
        chat_on: true,
        fg: true,
        d: this.generateDeviceId(),
        ct: 'websocket',
        aid: '219994525426954',
        mqtt_sid: '',
        cp: 3,
        ecp: 10,
        st: [],
        pm: [],
        dc: '',
        no_auto_fg: true,
        gas: null,
        pack: []
      }),
      cleanSession: true,
      keepAlive: 60
    };

    this.sendRaw(connectPacket);
    this.logger.debug('Connect packet sent');
  }

  private generateDeviceId(): string {
    return 'device_id_' + Math.random().toString(36).substring(2, 15);
  }

  private subscribeToDefaultTopics(): void {
    const defaultTopics = [
      MQTT_TOPICS.MESSAGE_SYNC,
      MQTT_TOPICS.PRESENCE,
      MQTT_TOPICS.TYPING,
      MQTT_TOPICS.INBOX,
      MQTT_TOPICS.MESSAGING_EVENTS,
    ];

    for (const topic of defaultTopics) {
      this.subscribe(topic);
    }
  }

  subscribe(topic: string): void {
    if (this.subscribedTopics.has(topic)) return;
    
    this.subscribedTopics.add(topic);
    
    const subscribePacket = {
      type: 'subscribe',
      messageId: this.getNextSequenceId(),
      subscriptions: [{ topic, qos: 0 }]
    };

    this.sendRaw(subscribePacket);
    this.logger.debug(`Subscribed to ${topic}`);
  }

  unsubscribe(topic: string): void {
    if (!this.subscribedTopics.has(topic)) return;
    
    this.subscribedTopics.delete(topic);
    
    const unsubscribePacket = {
      type: 'unsubscribe',
      messageId: this.getNextSequenceId(),
      topics: [topic]
    };

    this.sendRaw(unsubscribePacket);
    this.logger.debug(`Unsubscribed from ${topic}`);
  }

  private onMessage(data: WebSocket.Data): void {
    this.lastMessageTime = Date.now();
    
    try {
      if (data instanceof Buffer || data instanceof ArrayBuffer) {
        this.handleBinaryMessage(data as Buffer);
      } else {
        const parsed = JSON.parse(String(data));
        this.handleParsedMessage(parsed);
      }
    } catch (error) {
      this.logger.debug('Raw binary message received');
      this.emit('rawBinary', data);
    }
  }

  private handleBinaryMessage(data: Buffer): void {
    try {
      const decoded = this.decodeMQTTPacket(data);
      this.handleParsedMessage(decoded);
    } catch {
      this.emit('rawBinary', data);
    }
  }

  private decodeMQTTPacket(data: Buffer): any {
    const json = data.toString('utf8');
    return JSON.parse(json);
  }

  private handleParsedMessage(message: any): void {
    const mqttMessage: MQTTMessage = {
      topic: message.topic || 'unknown',
      payload: message,
      timestamp: Date.now()
    };
    
    this.messageQueue.push(mqttMessage);
    if (this.messageQueue.length > 1000) {
      this.messageQueue.shift();
    }
    
    this.emit('raw', message);
    
    if (message.type === 'connack') {
      this.logger.mqtt('Connection acknowledged');
      this.emit('connack', message);
      return;
    }
    
    if (message.type === 'suback') {
      this.logger.debug('Subscription acknowledged');
      return;
    }
    
    if (message.type === 'pingresp') {
      return;
    }

    this.routeMessage(message);
  }

  private routeMessage(message: any): void {
    const topic = message.topic || '';
    const payload = message.payload || message;
    
    if (topic.includes('/t_ms') || this.isNewMessage(payload)) {
      this.handleNewMessage(payload);
    }
    
    if (topic.includes('presence') || payload.type === 'presence') {
      this.handlePresence(payload);
    }
    
    if (topic.includes('typing') || payload.type === 'typing') {
      this.handleTyping(payload);
    }
    
    if (payload.type === 'read_receipt') {
      this.handleReadReceipt(payload);
    }
    
    if (payload.deltas) {
      for (const delta of payload.deltas) {
        this.handleDelta(delta);
      }
    }
  }

  private isNewMessage(payload: any): boolean {
    return payload.messageMetadata || 
           payload.body || 
           payload.message ||
           (payload.deltas && payload.deltas.some((d: any) => d.messageMetadata));
  }

  private handleNewMessage(payload: any): void {
    const message = this.parseMessage(payload);
    if (message) {
      this.logger.mqtt(`Message from ${message.senderID}: "${message.body?.substring(0, 50) || '[attachment]'}"`);
      this.emit('message', message);
    }
  }

  private parseMessage(payload: any): any {
    try {
      let threadID = '';
      let senderID = '';
      let messageID = '';
      let body = '';
      let attachments: any[] = [];
      let timestamp = Date.now();
      
      if (payload.messageMetadata) {
        const meta = payload.messageMetadata;
        threadID = meta.threadKey?.threadFbId || meta.threadKey?.otherUserFbId || '';
        senderID = meta.actorFbId || '';
        messageID = meta.messageId || '';
        timestamp = parseInt(meta.timestamp) || Date.now();
      }
      
      if (payload.body) {
        body = payload.body;
      }
      
      if (payload.attachments) {
        attachments = payload.attachments;
      }
      
      if (!threadID && !senderID && !body) {
        return null;
      }
      
      return {
        threadID,
        senderID,
        messageID,
        body,
        attachments,
        timestamp,
        isGroup: threadID.length > 15,
        raw: payload
      };
    } catch {
      return null;
    }
  }

  private handlePresence(payload: any): void {
    const presence: PresenceData = {
      userID: payload.userId || payload.uid || '',
      status: payload.status || (payload.l === 0 ? 'online' : 'offline'),
      lastActive: payload.lat || payload.lastActive || Date.now()
    };
    
    if (presence.userID) {
      this.emit('presence', presence);
    }
  }

  private handleTyping(payload: any): void {
    const typing: TypingData = {
      threadID: payload.threadId || payload.thread || '',
      userID: payload.userId || payload.sender || '',
      isTyping: payload.st === 1 || payload.isTyping === true
    };
    
    if (typing.threadID && typing.userID) {
      this.emit('typing', typing);
    }
  }

  private handleReadReceipt(payload: any): void {
    this.emit('read_receipt', {
      threadID: payload.threadId || payload.thread,
      reader: payload.reader || payload.actorFbId,
      time: payload.time || Date.now(),
      watermarkTimestampMs: payload.watermarkTimestampMs
    });
  }

  private handleDelta(delta: any): void {
    const deltaClass = delta.class;
    
    switch (deltaClass) {
      case 'NewMessage':
        this.handleNewMessage(delta);
        break;
      case 'MarkRead':
        this.emit('mark_read', delta);
        break;
      case 'ThreadName':
        this.emit('thread_name_change', delta);
        break;
      case 'ParticipantsAddedToGroupThread':
        this.emit('participant_added', delta);
        break;
      case 'ParticipantLeftGroupThread':
        this.emit('participant_left', delta);
        break;
      case 'AdminTextMessage':
        this.emit('admin_message', delta);
        break;
      default:
        this.emit('delta', delta);
    }
  }

  private onClose(code: number, reason: Buffer): void {
    this.isConnected = false;
    this.stopHeartbeat();
    
    const reasonStr = reason.toString() || 'Unknown';
    this.logger.warn(`WebSocket disconnected: ${code} - ${reasonStr}`);
    this.emit('disconnected', { code, reason: reasonStr });
    
    this.scheduleReconnect();
  }

  private onError(error: Error): void {
    this.logger.error('WebSocket error:', error.message);
    this.emit('error', error);
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.reconnectAttempts) {
      this.logger.error('Max reconnection attempts reached');
      this.emit('reconnect_failed');
      return;
    }

    const delay = Math.min(
      this.config.reconnectDelay * Math.pow(2, this.reconnectAttempts),
      this.config.maxReconnectDelay
    );
    
    this.reconnectAttempts++;
    this.logger.info(`Reconnecting in ${delay}ms (${this.reconnectAttempts}/${this.config.reconnectAttempts})`);
    
    this.reconnectTimer = setTimeout(() => {
      this.connect(this.cookieHeader, this.userID);
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    
    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected) {
        this.sendPing();
      }
    }, this.config.heartbeatInterval);
    
    this.logger.debug(`Heartbeat started (${this.config.heartbeatInterval}ms)`);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private sendPing(): void {
    try {
      this.sendRaw({ type: 'pingreq' });
    } catch {
      this.logger.warn('Failed to send ping');
    }
  }

  send(payload: any): void {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('MQTT WebSocket not connected');
    }
    
    const str = typeof payload === 'string' ? payload : JSON.stringify(payload);
    this.ws.send(str);
  }

  private sendRaw(payload: any): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this.ws.send(JSON.stringify(payload));
  }

  publish(topic: string, payload: any): void {
    const packet = {
      type: 'publish',
      topic,
      payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
      messageId: this.getNextSequenceId(),
      qos: 1
    };
    
    this.sendRaw(packet);
    this.logger.debug(`Published to ${topic}`);
  }

  private getNextSequenceId(): number {
    this.sequenceId = (this.sequenceId + 1) % 65535;
    return this.sequenceId;
  }

  disconnect(): void {
    this.logger.info('Disconnecting...');
    
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    
    for (const timeout of this.pendingAcks.values()) {
      clearTimeout(timeout);
    }
    this.pendingAcks.clear();
    
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
    }
    
    this.isConnected = false;
    this.subscribedTopics.clear();
  }

  getStatus(): {
    connected: boolean;
    reconnectAttempts: number;
    subscribedTopics: string[];
    lastMessageTime: number;
    queuedMessages: number;
  } {
    return {
      connected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
      subscribedTopics: Array.from(this.subscribedTopics),
      lastMessageTime: this.lastMessageTime,
      queuedMessages: this.messageQueue.length
    };
  }

  getRecentMessages(count: number = 10): MQTTMessage[] {
    return this.messageQueue.slice(-count);
  }

  isOnline(): boolean {
    return this.isConnected && this.ws?.readyState === WebSocket.OPEN;
  }

  static get TOPICS() {
    return MQTT_TOPICS;
  }
}
