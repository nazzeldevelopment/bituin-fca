import { EventEmitter } from 'eventemitter3';
import WebSocket from 'ws';
import { Logger } from '../../core/Logger';

export interface MQTTConfig {
  url?: string;
  heartbeatInterval?: number;
  reconnectAttempts?: number;
  reconnectDelay?: number;
}

export class WebsocketMQTTClient extends EventEmitter {
  private ws?: WebSocket;
  private config: Required<MQTTConfig>;
  private heartbeatTimer?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;
  private logger: Logger;
  private connected = false;
  private currentReconnects = 0;
  private cookieHeader = '';

  constructor(config?: MQTTConfig) {
    super();
    this.logger = new Logger('WS-MQTT');
    
    this.config = {
      url: config?.url || 'wss://edge-chat.facebook.com/chat?region=prn',
      heartbeatInterval: config?.heartbeatInterval || 25000,
      reconnectAttempts: config?.reconnectAttempts || 5,
      reconnectDelay: config?.reconnectDelay || 2000
    };
  }

  connect(cookieHeader: string): void {
    this.cookieHeader = cookieHeader;
    this.logger.mqtt(`Connecting to ${this.config.url}`);

    this.ws = new WebSocket(this.config.url, {
      headers: {
        cookie: cookieHeader,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    this.ws.on('open', this.onOpen.bind(this));
    this.ws.on('message', this.onMessage.bind(this));
    this.ws.on('close', this.onClose.bind(this));
    this.ws.on('error', this.onError.bind(this));
  }

  private onOpen(): void {
    this.connected = true;
    this.currentReconnects = 0;
    this.logger.success('WebSocket connected');
    this.startHeartbeat();
    this.emit('connected');
  }

  private onMessage(data: WebSocket.Data): void {
    try {
      const parsed = JSON.parse(String(data));
      this.emit('message', parsed);
    } catch {
      this.emit('binary', data);
    }
  }

  private onClose(code: number, reason: Buffer): void {
    this.connected = false;
    this.stopHeartbeat();
    this.logger.warn(`Disconnected: ${code} - ${reason.toString() || 'Unknown'}`);
    this.emit('disconnected', { code, reason: reason.toString() });
    this.attemptReconnect();
  }

  private onError(error: Error): void {
    this.logger.error('WebSocket error:', error.message);
    this.emit('error', error);
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.connected) {
        try {
          this.send({ type: 'ping' });
        } catch {}
      }
    }, this.config.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private attemptReconnect(): void {
    if (this.currentReconnects >= this.config.reconnectAttempts) {
      this.logger.error('Max reconnection attempts reached');
      this.emit('reconnect_failed');
      return;
    }

    this.currentReconnects++;
    const delay = this.config.reconnectDelay * this.currentReconnects;
    
    this.logger.info(`Reconnecting in ${delay}ms (${this.currentReconnects}/${this.config.reconnectAttempts})`);
    
    this.reconnectTimer = setTimeout(() => {
      this.connect(this.cookieHeader);
    }, delay);
  }

  send(data: any): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    this.ws.send(payload);
  }

  disconnect(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }
}
