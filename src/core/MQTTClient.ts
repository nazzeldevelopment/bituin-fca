import { EventEmitter } from 'eventemitter3';
import WebSocket from 'ws';
import { Logger } from './Logger';

export class MQTTClient extends EventEmitter {
  private ws?: WebSocket;
  private url = 'wss://edge-chat.facebook.com/chat?region=prn';
  private heartbeatTimer?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;
  private logger: Logger;
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor() {
    super();
    this.logger = new Logger('MQTT');
  }

  connect(cookieHeader: string): void {
    this.logger.info('Connecting to Facebook MQTT WebSocket...');
    this.logger.debug(`URL: ${this.url}`);

    this.ws = new WebSocket(this.url, { 
      headers: { 
        cookie: cookieHeader,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      } 
    });

    this.ws.on('open', () => {
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.logger.success('WebSocket connected!');
      this.emit('connected');
      this.startHeartbeat();
    });

    this.ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(String(data));
        this.logger.mqtt('Message received:', JSON.stringify(parsed).substring(0, 100));
        this.emit('raw', parsed);
      } catch {
        this.logger.mqtt('Binary message received:', (data as Buffer).length, 'bytes');
        this.emit('rawBinary', data);
      }
    });

    this.ws.on('close', (code, reason) => {
      this.isConnected = false;
      this.logger.warn(`WebSocket disconnected: ${code} - ${reason || 'No reason'}`);
      this.emit('disconnected', { code, reason: String(reason) });
      this.stopHeartbeat();
      this.scheduleReconnect(cookieHeader);
    });

    this.ws.on('error', (err) => {
      this.logger.error('WebSocket error:', err.message);
      this.emit('error', err);
    });
  }

  private scheduleReconnect(cookieHeader: string): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error('Max reconnect attempts reached');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
    
    this.logger.info(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    this.reconnectTimer = setTimeout(() => {
      this.connect(cookieHeader);
    }, delay);
  }

  send(payload: any): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.logger.error('Cannot send - WebSocket not connected');
      throw new Error('MQTT WS not connected');
    }
    
    const str = typeof payload === 'string' ? payload : JSON.stringify(payload);
    this.ws.send(str);
    this.logger.mqtt('Message sent:', str.substring(0, 100));
  }

  private startHeartbeat(): void {
    this.logger.debug('Starting heartbeat (25s interval)');
    this.heartbeatTimer = setInterval(() => {
      try {
        this.send({ type: 'ping' });
        this.logger.debug('Heartbeat ping sent');
      } catch {
        this.logger.warn('Heartbeat failed');
      }
    }, 25_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
      this.logger.debug('Heartbeat stopped');
    }
  }

  disconnect(): void {
    this.logger.info('Disconnecting...');
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.isConnected = false;
  }

  getStatus(): { connected: boolean; reconnectAttempts: number } {
    return {
      connected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts
    };
  }
}
