import { EventEmitter } from 'eventemitter3';
import { Message } from '../types';
import { Logger } from './Logger';

export class MessageParser extends EventEmitter {
  private logger: Logger;

  constructor() {
    super();
    this.logger = new Logger('PARSER');
  }

  parse(raw: any): Message {
    this.logger.debug('Parsing incoming message...');
    
    const message: Message = {
      threadID: raw.thread_id || raw.to || raw.threadID || '',
      senderID: raw.from || raw.sender || raw.user || raw.author || '',
      messageID: raw.mid || raw.messageID || raw.message_id || '',
      body: raw.body || raw.message || raw.text || '',
      attachments: raw.attachments || [],
      timestamp: raw.timestamp || raw.time || Date.now(),
      isGroup: raw.isGroup ?? raw.is_group ?? (raw.thread_type === 'group')
    };

    if (message.body) {
      this.logger.info(`Message from ${message.senderID}: "${message.body.substring(0, 50)}${message.body.length > 50 ? '...' : ''}"`);
    }

    this.emit('message', message);
    return message;
  }

  parseEvent(raw: any): void {
    const eventType = raw.type || raw.event || 'unknown';
    this.logger.debug(`Event received: ${eventType}`);
    
    switch (eventType) {
      case 'message':
        this.parse(raw);
        break;
      case 'read_receipt':
        this.emit('read', raw);
        break;
      case 'typing':
        this.emit('typing', raw);
        break;
      case 'presence':
        this.emit('presence', raw);
        break;
      default:
        this.emit('event', raw);
    }
  }
}
