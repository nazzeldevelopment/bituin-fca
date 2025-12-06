import dotenv from 'dotenv';
dotenv.config();

import { RequestBuilder } from './core/RequestBuilder';
import { LoginManager } from './core/LoginManager';
import { SessionManager } from './core/SessionManager';
import { CookieManager } from './core/CookieManager';
import { GraphQLClient } from './core/GraphQLClient';
import { MQTTClient } from './core/MQTTClient';
import { UploadManager } from './core/UploadManager';
import { MessageParser } from './core/MessageParser';
import { MessageHandler } from './core/MessageHandler';
import { MessageSender } from './core/MessageSender';
import { ThreadManager } from './core/ThreadManager';
import { UserManager } from './core/UserManager';
import { ReactionManager } from './core/ReactionManager';
import { TypingIndicator } from './core/TypingIndicator';
import { ReadReceiptManager } from './core/ReadReceiptManager';
import { PresenceManager } from './core/PresenceManager';
import { PluginLoader } from './core/PluginLoader';
import { CommandLoader } from './core/CommandLoader';
import { RateLimiter } from './core/RateLimiter';
import { CooldownManager } from './core/CooldownManager';
import { AntiBanManager } from './core/AntiBanManager';
import { Logger, logger } from './core/Logger';
import { SendMessageOptions } from './types';

export {
  RequestBuilder,
  LoginManager,
  SessionManager,
  CookieManager,
  GraphQLClient,
  MQTTClient,
  UploadManager,
  MessageParser,
  MessageHandler,
  MessageSender,
  ThreadManager,
  UserManager,
  ReactionManager,
  TypingIndicator,
  ReadReceiptManager,
  PresenceManager,
  PluginLoader,
  CommandLoader,
  RateLimiter,
  CooldownManager,
  AntiBanManager,
  Logger
};

export interface BitunFCAConfig {
  sessionPath?: string;
  encryptionKey?: string;
  commandPrefix?: string;
  enableAntiBan?: boolean;
  enablePlugins?: boolean;
  enableCommands?: boolean;
}

export class BitunFCA {
  public req: RequestBuilder;
  public login: LoginManager;
  public session: SessionManager;
  public cookie: CookieManager;
  public gql: GraphQLClient;
  public mqtt: MQTTClient;
  public upload: UploadManager;
  public parser: MessageParser;
  public handler: MessageHandler;
  public sender: MessageSender;
  public thread: ThreadManager;
  public user: UserManager;
  public reaction: ReactionManager;
  public typing: TypingIndicator;
  public readReceipt: ReadReceiptManager;
  public presence: PresenceManager;
  public plugins: PluginLoader;
  public commands: CommandLoader;
  public rateLimiter: RateLimiter;
  public cooldown: CooldownManager;
  public antiBan: AntiBanManager;
  public logger: Logger;

  private config: BitunFCAConfig;
  private isInitialized = false;

  constructor(config?: BitunFCAConfig) {
    this.config = {
      sessionPath: 'session.json',
      commandPrefix: '!',
      enableAntiBan: true,
      enablePlugins: true,
      enableCommands: true,
      ...config
    };

    this.logger = new Logger('BITUIN-FCA');
    
    this.antiBan = new AntiBanManager();
    this.req = new RequestBuilder({}, this.config.enableAntiBan ? this.antiBan : undefined);
    this.login = new LoginManager(this.req, this.antiBan);
    this.session = new SessionManager({
      sessionPath: this.config.sessionPath,
      encryptionKey: this.config.encryptionKey
    });
    this.cookie = new CookieManager();
    this.gql = new GraphQLClient(this.req);
    this.mqtt = new MQTTClient();
    this.upload = new UploadManager(this.req);
    this.parser = new MessageParser();
    this.handler = new MessageHandler(this.parser, this.config.commandPrefix);
    this.sender = new MessageSender(this.req, this.gql, this.upload, this.antiBan);
    this.thread = new ThreadManager(this.gql, this.req);
    this.user = new UserManager(this.gql, this.req);
    this.reaction = new ReactionManager(this.gql);
    this.typing = new TypingIndicator(this.req);
    this.readReceipt = new ReadReceiptManager(this.req, this.gql);
    this.presence = new PresenceManager(this.req);
    this.plugins = new PluginLoader();
    this.commands = new CommandLoader();
    this.rateLimiter = new RateLimiter(1000, 60000);
    this.cooldown = new CooldownManager();

    this.setupEventRouting();
  }

  private setupEventRouting(): void {
    this.mqtt.on('message', (msg) => {
      this.parser.parseEvent(msg);
    });

    this.mqtt.on('typing', (data) => {
      this.typing.handleTypingEvent(data);
    });

    this.mqtt.on('presence', (data) => {
      this.presence.handlePresenceEvent(data);
    });

    this.mqtt.on('read_receipt', (data) => {
      this.readReceipt.handleReadReceipt(data);
    });

    this.parser.on('command', async ({ command, args, message }) => {
      const userKey = `cmd:${message.senderID}:${command}`;
      
      if (!this.cooldown.allowed(userKey)) {
        return;
      }

      await this.commands.execute(command, {
        message,
        api: this,
        sendMessage: (opts: SendMessageOptions) => this.sender.send(opts),
        thread: this.thread,
        user: this.user
      }, args);
    });

    this.antiBan.on('checkpoint', () => {
      this.logger.error('CHECKPOINT DETECTED! Manual verification required');
    });

    this.antiBan.on('warning', () => {
      this.logger.warn('Account warning detected');
    });
  }

  async initialize(): Promise<boolean> {
    this.logger.banner();
    this.logger.divider('═', 62);
    this.logger.info('Initializing Bituin-FCA V2 Ultra...');
    this.logger.divider();

    this.logger.table({
      'Anti-Ban': this.config.enableAntiBan ? '✓ Enabled' : '✗ Disabled',
      'Plugins': this.config.enablePlugins ? '✓ Enabled' : '✗ Disabled',
      'Commands': this.config.enableCommands ? '✓ Enabled' : '✗ Disabled',
      'Command Prefix': this.config.commandPrefix || '!',
      'Rate Limit': `${this.rateLimiter.getStatus().capacity} tokens/min`
    });

    if (this.config.enablePlugins) {
      await this.plugins.loadAll({
        client: this.req,
        sendMessage: (opts: SendMessageOptions) => this.sender.send(opts),
        on: (event: string, handler: (...args: any[]) => void) => {
          this.parser.on(event, handler);
        }
      });
    }

    if (this.config.enableCommands) {
      this.commands.loadAll();
    }

    const existingSession = await this.session.load();
    if (existingSession) {
      const result = await this.login.loadSession(existingSession);
      if (result.success) {
        this.connectMQTT();
        this.isInitialized = true;
        this.logger.success('Initialized with existing session');
        return true;
      }
    }

    this.logger.info('No valid session found. Use loginWithEmail() or loginWithSession()');
    return false;
  }

  async loginWithEmail(email: string, password: string): Promise<boolean> {
    this.logger.info('Attempting email login...');
    
    const result = await this.login.loginEmail({ email, password });
    
    if (result.success && result.session) {
      await this.session.save(result.session);
      this.connectMQTT();
      this.isInitialized = true;
      return true;
    }

    if (result.requiresTwoFactor) {
      this.logger.warn('Two-factor authentication required');
    }

    if (result.requiresCheckpoint) {
      this.logger.warn('Security checkpoint required');
    }

    return false;
  }

  async loginWithSession(sessionData: string): Promise<boolean> {
    this.logger.info('Loading session from import...');
    
    try {
      const session = await this.session.import(sessionData);
      const result = await this.login.loadSession(session);
      
      if (result.success) {
        this.connectMQTT();
        this.isInitialized = true;
        return true;
      }
    } catch (error: any) {
      this.logger.error('Failed to load session:', error.message);
    }

    return false;
  }

  private connectMQTT(): void {
    const cookieHeader = this.req.getCookieHeader();
    const userID = this.req.getCookie('c_user');
    
    if (cookieHeader && userID) {
      this.mqtt.connect(cookieHeader, userID);
    }
  }

  async sendMessage(options: SendMessageOptions): Promise<any> {
    return this.sender.send(options);
  }

  async getThreadInfo(threadID: string): Promise<any> {
    return this.thread.getInfo(threadID);
  }

  async getUserInfo(userID: string): Promise<any> {
    return this.user.getInfo(userID);
  }

  on(event: string, handler: (...args: any[]) => void): void {
    this.parser.on(event, handler);
    this.mqtt.on(event, handler);
  }

  off(event: string, handler: (...args: any[]) => void): void {
    this.parser.off(event, handler);
    this.mqtt.off(event, handler);
  }

  getHealth(): any {
    return {
      antiBan: this.antiBan.getHealth(),
      rateLimit: this.rateLimiter.getStatus(),
      mqtt: this.mqtt.getStatus(),
      session: {
        valid: this.session.isValid(),
        remainingLife: this.session.getRemainingLife()
      }
    };
  }

  async destroy(): Promise<void> {
    this.logger.info('Shutting down Bituin-FCA...');
    
    this.mqtt.disconnect();
    this.typing.destroy();
    this.readReceipt.destroy();
    this.presence.destroy();
    this.sender.destroy();
    this.antiBan.destroy();
    this.session.destroy();
    this.cooldown.destroy();
    
    this.logger.success('Bituin-FCA shut down complete');
  }
}

async function main() {
  logger.banner();
  logger.divider('═', 62);
  
  logger.info('Starting Bituin-FCA V2 Ultra...');
  logger.divider();

  const antiBan = new AntiBanManager();
  const req = new RequestBuilder({}, antiBan);
  const loginMgr = new LoginManager(req, antiBan);
  const sessionMgr = new SessionManager();
  const gql = new GraphQLClient(req);
  const mqtt = new MQTTClient();
  const upload = new UploadManager(req);
  const parser = new MessageParser();
  const handler = new MessageHandler(parser);
  const sender = new MessageSender(req, gql, upload, antiBan);
  const threadMgr = new ThreadManager(gql, req);
  const userMgr = new UserManager(gql, req);
  const reactionMgr = new ReactionManager(gql);
  const typingMgr = new TypingIndicator(req);
  const readReceiptMgr = new ReadReceiptManager(req, gql);
  const presenceMgr = new PresenceManager(req);
  const rateLimiter = new RateLimiter(1000, 60000);
  const cooldown = new CooldownManager();

  logger.table({
    'Core Modules': '✓ Initialized',
    'Anti-Ban': '✓ Active',
    'Account Health': `${antiBan.getHealthScore()}/100`,
    'Rate Limiter': `${rateLimiter.getStatus().capacity} tokens/min`,
    'Cooldown': `${cooldown.getStats().defaultCooldown}ms default`,
    'Command Prefix': '!'
  });

  const pluginContext = {
    client: req,
    sendMessage: async (opts: SendMessageOptions) => sender.send(opts),
    on: (event: string, handler: (...args: any[]) => void) => {
      parser.on(event, handler);
    }
  };

  const pluginLoader = new PluginLoader();
  await pluginLoader.loadAll(pluginContext);

  const cmdLoader = new CommandLoader();
  cmdLoader.loadAll();

  mqtt.on('message', (msg) => {
    parser.parseEvent(msg);
  });

  mqtt.on('typing', (data) => {
    typingMgr.handleTypingEvent(data);
  });

  mqtt.on('presence', (data) => {
    presenceMgr.handlePresenceEvent(data);
  });

  mqtt.on('read_receipt', (data) => {
    readReceiptMgr.handleReadReceipt(data);
  });

  parser.on('command', async ({ command, args, message }) => {
    const userKey = `cmd:${message.senderID}:${command}`;
    
    if (!cooldown.allowed(userKey)) {
      logger.warn(`Cooldown active for ${message.senderID} on command ${command}`);
      return;
    }

    await cmdLoader.execute(command, { 
      message, 
      sendMessage: async (opts: SendMessageOptions) => sender.send(opts),
      thread: threadMgr,
      user: userMgr,
      reaction: reactionMgr
    }, args);
  });

  antiBan.on('checkpoint', () => {
    logger.error('CHECKPOINT DETECTED! Account may require verification');
  });

  antiBan.on('warning', () => {
    logger.warn('Account warning - reducing activity');
  });

  mqtt.on('connected', () => {
    logger.success('MQTT WebSocket connected - Ready to receive messages!');
  });

  mqtt.on('disconnected', ({ code, reason }) => {
    logger.warn(`MQTT disconnected: ${code} - ${reason}`);
  });

  logger.divider();
  logger.success('Bituin-FCA V2 Ultra is ready!');
  logger.info('Waiting for session or login...');
  logger.divider('═', 62);

  const existingSession = await sessionMgr.load();
  if (existingSession) {
    const result = await loginMgr.loadSession(existingSession);
    if (result.success) {
      mqtt.connect(req.getCookieHeader(), existingSession.userID);
    }
  } else {
    logger.info('No existing session found');
    logger.info('Use BitunFCA class or loginEmail() to authenticate');
  }
}

main().catch((error) => {
  logger.error('Fatal error:', error.message);
  console.error(error);
  process.exit(1);
});
