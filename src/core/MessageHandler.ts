import { MessageParser } from './MessageParser';
import { Message } from '../types';
import { Logger } from './Logger';

export class MessageHandler {
  private parser: MessageParser;
  private logger: Logger;
  private commandPrefix: string;
  private handlers: Array<(msg: Message) => Promise<void>> = [];

  constructor(parser: MessageParser, commandPrefix: string = '!') {
    this.parser = parser;
    this.logger = new Logger('HANDLER');
    this.commandPrefix = commandPrefix;
    
    this.parser.on('message', (m: Message) => this.handle(m));
    this.logger.info(`Message handler initialized with prefix: "${this.commandPrefix}"`);
  }

  async handle(msg: Message): Promise<void> {
    this.logger.debug(`Processing message: ${msg.messageID}`);
    
    if (typeof msg.body === 'string' && msg.body.startsWith(this.commandPrefix)) {
      const commandLine = msg.body.substring(this.commandPrefix.length).trim();
      const [command, ...args] = commandLine.split(/\s+/);
      
      this.logger.command(`Command detected: ${command} [${args.join(', ')}]`);
      this.parser.emit('command', { command, args, message: msg });
    }

    for (const handler of this.handlers) {
      try {
        await handler(msg);
      } catch (error: any) {
        this.logger.error(`Handler error: ${error.message}`);
      }
    }
  }

  addHandler(handler: (msg: Message) => Promise<void>): void {
    this.handlers.push(handler);
    this.logger.debug(`Handler added (total: ${this.handlers.length})`);
  }

  setPrefix(prefix: string): void {
    this.commandPrefix = prefix;
    this.logger.info(`Command prefix changed to: "${prefix}"`);
  }
}
