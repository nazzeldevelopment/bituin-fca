import dotenv from 'dotenv';
dotenv.config();

import { RequestBuilder } from './core/RequestBuilder';
import { LoginManager } from './core/LoginManager';
import { SessionManager } from './core/SessionManager';
import { GraphQLClient } from './core/GraphQLClient';
import { MQTTClient } from './core/MQTTClient';
import { UploadManager } from './core/UploadManager';
import { MessageParser } from './core/MessageParser';
import { MessageHandler } from './core/MessageHandler';
import { ThreadManager } from './core/ThreadManager';
import { UserManager } from './core/UserManager';
import { PluginLoader } from './core/PluginLoader';
import { CommandLoader } from './core/CommandLoader';
import { RateLimiter } from './core/RateLimiter';
import { CooldownManager } from './core/CooldownManager';
import { Logger, logger } from './core/Logger';
import { SendMessageOptions } from './types';

export {
  RequestBuilder,
  LoginManager,
  SessionManager,
  GraphQLClient,
  MQTTClient,
  UploadManager,
  MessageParser,
  MessageHandler,
  ThreadManager,
  UserManager,
  PluginLoader,
  CommandLoader,
  RateLimiter,
  CooldownManager,
  Logger
};

async function main() {
  logger.banner();
  logger.divider('═', 62);
  
  logger.info('Starting Bituin-FCA V2 Ultra...');
  logger.divider();

  const req = new RequestBuilder();
  const login = new LoginManager(req);
  const sessionMgr = new SessionManager();
  const gql = new GraphQLClient(req);
  const mqtt = new MQTTClient();
  const upload = new UploadManager(req);
  const parser = new MessageParser();
  const handler = new MessageHandler(parser);
  const threadMgr = new ThreadManager(gql);
  const userMgr = new UserManager(gql);
  const rateLimiter = new RateLimiter(1000, 60000);
  const cooldown = new CooldownManager(3000);

  logger.table({
    'Core Modules': '✓ Initialized',
    'Rate Limiter': `${rateLimiter.getStatus().capacity} tokens/min`,
    'Cooldown': '3000ms default',
    'Command Prefix': '!'
  });

  const sendMessage = async (opts: SendMessageOptions): Promise<void> => {
    if (!rateLimiter.consume()) {
      logger.warn('Rate limit exceeded, message not sent');
      return;
    }
    logger.info(`Sending message to ${opts.threadID}: "${opts.message.substring(0, 50)}..."`);
  };

  const pluginContext = {
    client: req,
    sendMessage,
    on: (event: string, handler: (...args: any[]) => void) => {
      parser.on(event, handler);
    }
  };

  const pluginLoader = new PluginLoader();
  await pluginLoader.loadAll(pluginContext);

  const cmdLoader = new CommandLoader();
  cmdLoader.loadAll();

  parser.on('command', async ({ command, args, message }) => {
    const userKey = `cmd:${message.senderID}:${command}`;
    
    if (!cooldown.allowed(userKey)) {
      logger.warn(`Cooldown active for ${message.senderID} on command ${command}`);
      return;
    }

    await cmdLoader.execute(command, { 
      message, 
      sendMessage,
      threadMgr,
      userMgr 
    }, args);
  });

  mqtt.on('connected', () => {
    logger.success('MQTT WebSocket connected - Ready to receive messages!');
  });

  mqtt.on('raw', (data) => {
    parser.parseEvent(data);
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
    await login.loadSession(existingSession);
    mqtt.connect(req.getCookieHeader());
  } else {
    logger.info('No existing session found');
    logger.info('Use loginEmail() to authenticate or provide session cookies');
  }
}

main().catch((error) => {
  logger.error('Fatal error:', error.message);
  console.error(error);
  process.exit(1);
});
