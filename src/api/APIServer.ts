import express, { Application, Request, Response, NextFunction, Router } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { EventEmitter } from 'eventemitter3';
import { Logger } from '../core/Logger';
import { BitunFCA } from '../index';
import * as crypto from 'crypto';

export interface APIServerConfig {
  port: number;
  host: string;
  corsOrigins?: string | string[];
  enableRateLimit?: boolean;
  rateLimitWindowMs?: number;
  rateLimitMaxRequests?: number;
  apiKeys?: string[];
  jwtSecret?: string;
  enableSwagger?: boolean;
  enableMetrics?: boolean;
}

export interface APIRequest extends Request {
  apiKey?: string;
  userId?: string;
  botInstance?: BitunFCA;
}

export interface APIResponse {
  success: boolean;
  data?: any;
  error?: string;
  meta?: {
    timestamp: number;
    requestId: string;
    version: string;
  };
}

export interface APIMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  requestsPerMinute: number;
  endpointStats: Map<string, EndpointStats>;
  lastReset: number;
}

export interface EndpointStats {
  calls: number;
  errors: number;
  totalTime: number;
  avgTime: number;
}

const API_VERSION = '2.0.0';

export class APIServer extends EventEmitter {
  private app: Application;
  private server: any;
  private logger: Logger;
  private config: APIServerConfig;
  private botInstances: Map<string, BitunFCA> = new Map();
  private apiKeys: Set<string>;
  private metrics: APIMetrics;
  private isRunning = false;

  constructor(config?: Partial<APIServerConfig>) {
    super();
    this.logger = new Logger('API-SERVER');
    
    this.config = {
      port: parseInt(process.env.API_PORT || '3001', 10),
      host: '0.0.0.0',
      corsOrigins: '*',
      enableRateLimit: true,
      rateLimitWindowMs: 60000,
      rateLimitMaxRequests: 100,
      apiKeys: [],
      enableSwagger: true,
      enableMetrics: true,
      ...config,
    };

    this.apiKeys = new Set(this.config.apiKeys || []);
    if (process.env.API_KEY) {
      this.apiKeys.add(process.env.API_KEY);
    }

    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      requestsPerMinute: 0,
      endpointStats: new Map(),
      lastReset: Date.now(),
    };

    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();

    this.logger.success('API server initialized');
  }

  private setupMiddleware(): void {
    this.app.use(helmet({
      contentSecurityPolicy: false,
    }));

    this.app.use(cors({
      origin: this.config.corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-ID'],
    }));

    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    if (this.config.enableRateLimit) {
      const limiter = rateLimit({
        windowMs: this.config.rateLimitWindowMs,
        max: this.config.rateLimitMaxRequests,
        message: { success: false, error: 'Too many requests, please try again later' },
        standardHeaders: true,
        legacyHeaders: false,
      });
      this.app.use(limiter);
    }

    this.app.use((req: APIRequest, res: Response, next: NextFunction) => {
      const requestId = crypto.randomBytes(8).toString('hex');
      req.headers['x-request-id'] = requestId;
      res.setHeader('X-Request-ID', requestId);
      res.setHeader('X-API-Version', API_VERSION);
      next();
    });

    if (this.config.enableMetrics) {
      this.app.use((req: APIRequest, res: Response, next: NextFunction) => {
        const start = Date.now();
        
        res.on('finish', () => {
          const duration = Date.now() - start;
          this.recordMetrics(req.path, res.statusCode, duration);
        });
        
        next();
      });
    }
  }

  private setupRoutes(): void {
    const router = Router();

    router.get('/health', this.healthCheck.bind(this));
    router.get('/info', this.getInfo.bind(this));

    const authRouter = Router();
    authRouter.use(this.authenticate.bind(this));

    authRouter.post('/bots/register', this.registerBot.bind(this));
    authRouter.delete('/bots/:botId', this.unregisterBot.bind(this));
    authRouter.get('/bots', this.listBots.bind(this));
    authRouter.get('/bots/:botId', this.getBotInfo.bind(this));
    authRouter.get('/bots/:botId/health', this.getBotHealth.bind(this));

    authRouter.post('/messages/send', this.sendMessage.bind(this));
    authRouter.post('/messages/reply', this.replyToMessage.bind(this));
    authRouter.put('/messages/:messageId/edit', this.editMessage.bind(this));
    authRouter.delete('/messages/:messageId', this.deleteMessage.bind(this));
    authRouter.post('/messages/:messageId/react', this.reactToMessage.bind(this));

    authRouter.get('/threads/:threadId', this.getThreadInfo.bind(this));
    authRouter.get('/threads/:threadId/messages', this.getThreadMessages.bind(this));
    authRouter.get('/threads/:threadId/participants', this.getThreadParticipants.bind(this));
    authRouter.put('/threads/:threadId/name', this.setThreadName.bind(this));
    authRouter.put('/threads/:threadId/emoji', this.setThreadEmoji.bind(this));
    authRouter.put('/threads/:threadId/color', this.setThreadColor.bind(this));
    authRouter.post('/threads/:threadId/mute', this.muteThread.bind(this));
    authRouter.delete('/threads/:threadId/mute', this.unmuteThread.bind(this));

    authRouter.get('/users/:userId', this.getUserInfo.bind(this));
    authRouter.get('/users/:userId/presence', this.getUserPresence.bind(this));

    authRouter.post('/groups/:threadId/add', this.addGroupMember.bind(this));
    authRouter.delete('/groups/:threadId/remove/:userId', this.removeGroupMember.bind(this));
    authRouter.put('/groups/:threadId/admin/:userId', this.setGroupAdmin.bind(this));
    authRouter.put('/groups/:threadId/image', this.setGroupImage.bind(this));
    authRouter.put('/groups/:threadId/approval-mode', this.setApprovalMode.bind(this));

    authRouter.post('/polls/create', this.createPoll.bind(this));
    authRouter.post('/polls/:pollId/vote', this.votePoll.bind(this));
    authRouter.get('/polls/:pollId', this.getPollResults.bind(this));

    authRouter.get('/stories', this.getStories.bind(this));
    authRouter.post('/stories/:storyId/view', this.viewStory.bind(this));
    authRouter.post('/stories/:storyId/react', this.reactToStory.bind(this));

    authRouter.post('/calls/initiate', this.initiateCall.bind(this));
    authRouter.post('/calls/:callId/end', this.endCall.bind(this));

    authRouter.post('/location/share', this.shareLocation.bind(this));
    authRouter.delete('/location/:shareId', this.stopLocationShare.bind(this));

    authRouter.post('/scheduled/create', this.scheduleMessage.bind(this));
    authRouter.delete('/scheduled/:scheduleId', this.cancelScheduledMessage.bind(this));
    authRouter.get('/scheduled', this.getScheduledMessages.bind(this));

    authRouter.post('/attachments/download', this.downloadAttachment.bind(this));

    if (this.config.enableMetrics) {
      authRouter.get('/metrics', this.getMetrics.bind(this));
    }

    this.app.use('/api/v2', router);
    this.app.use('/api/v2', authRouter);

    this.app.use('*', (req: Request, res: Response) => {
      res.status(404).json(this.formatResponse(false, null, 'Endpoint not found'));
    });
  }

  private setupErrorHandling(): void {
    this.app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
      this.logger.error('API Error:', err.message);
      this.emit('error', err);

      res.status(500).json(this.formatResponse(false, null, err.message || 'Internal server error'));
    });
  }

  private authenticate(req: APIRequest, res: Response, next: NextFunction): void {
    const apiKey = req.headers['x-api-key'] as string || req.query.api_key as string;
    
    if (!apiKey) {
      res.status(401).json(this.formatResponse(false, null, 'API key required'));
      return;
    }

    if (this.apiKeys.size > 0 && !this.apiKeys.has(apiKey)) {
      res.status(403).json(this.formatResponse(false, null, 'Invalid API key'));
      return;
    }

    req.apiKey = apiKey;

    const botId = req.headers['x-bot-id'] as string || req.query.bot_id as string;
    if (botId) {
      const bot = this.botInstances.get(botId);
      if (bot) {
        req.botInstance = bot;
      }
    } else if (this.botInstances.size === 1) {
      req.botInstance = this.botInstances.values().next().value;
    }

    next();
  }

  private formatResponse(success: boolean, data?: any, error?: string): APIResponse {
    return {
      success,
      data,
      error,
      meta: {
        timestamp: Date.now(),
        requestId: crypto.randomBytes(8).toString('hex'),
        version: API_VERSION,
      },
    };
  }

  private getBot(req: APIRequest, res: Response): BitunFCA | null {
    if (!req.botInstance) {
      res.status(400).json(this.formatResponse(false, null, 'No bot instance available. Register a bot or specify bot_id'));
      return null;
    }
    return req.botInstance;
  }

  private recordMetrics(path: string, statusCode: number, duration: number): void {
    this.metrics.totalRequests++;
    
    if (statusCode >= 200 && statusCode < 400) {
      this.metrics.successfulRequests++;
    } else {
      this.metrics.failedRequests++;
    }

    const totalTime = this.metrics.averageResponseTime * (this.metrics.totalRequests - 1) + duration;
    this.metrics.averageResponseTime = totalTime / this.metrics.totalRequests;

    const elapsed = (Date.now() - this.metrics.lastReset) / 60000;
    this.metrics.requestsPerMinute = this.metrics.totalRequests / Math.max(elapsed, 1);

    const stats = this.metrics.endpointStats.get(path) || { calls: 0, errors: 0, totalTime: 0, avgTime: 0 };
    stats.calls++;
    if (statusCode >= 400) stats.errors++;
    stats.totalTime += duration;
    stats.avgTime = stats.totalTime / stats.calls;
    this.metrics.endpointStats.set(path, stats);
  }

  async healthCheck(req: Request, res: Response): Promise<void> {
    const health = {
      status: 'healthy',
      uptime: process.uptime(),
      timestamp: Date.now(),
      version: API_VERSION,
      bots: this.botInstances.size,
    };

    res.json(this.formatResponse(true, health));
  }

  async getInfo(req: Request, res: Response): Promise<void> {
    const info = {
      name: 'Bituin-FCA API',
      version: API_VERSION,
      description: 'REST API for Bituin-FCA V2 Ultra',
      endpoints: {
        health: 'GET /api/v2/health',
        info: 'GET /api/v2/info',
        bots: 'GET/POST /api/v2/bots',
        messages: 'POST /api/v2/messages/*',
        threads: 'GET/PUT /api/v2/threads/:threadId/*',
        users: 'GET /api/v2/users/:userId/*',
        groups: 'POST/PUT/DELETE /api/v2/groups/:threadId/*',
        polls: 'GET/POST /api/v2/polls/*',
        stories: 'GET/POST /api/v2/stories/*',
        calls: 'POST /api/v2/calls/*',
        location: 'POST/DELETE /api/v2/location/*',
        scheduled: 'GET/POST/DELETE /api/v2/scheduled/*',
        metrics: 'GET /api/v2/metrics',
      },
    };

    res.json(this.formatResponse(true, info));
  }

  async registerBot(req: APIRequest, res: Response): Promise<void> {
    try {
      const { botId, config } = req.body;
      
      if (!botId) {
        res.status(400).json(this.formatResponse(false, null, 'Bot ID required'));
        return;
      }

      if (this.botInstances.has(botId)) {
        res.status(409).json(this.formatResponse(false, null, 'Bot already registered'));
        return;
      }

      const bot = new BitunFCA(config);
      this.botInstances.set(botId, bot);
      
      this.logger.success(`Bot registered: ${botId}`);
      this.emit('bot_registered', botId);

      res.json(this.formatResponse(true, { botId, registered: true }));
    } catch (error: any) {
      res.status(500).json(this.formatResponse(false, null, error.message));
    }
  }

  async unregisterBot(req: APIRequest, res: Response): Promise<void> {
    try {
      const { botId } = req.params;
      
      if (!this.botInstances.has(botId)) {
        res.status(404).json(this.formatResponse(false, null, 'Bot not found'));
        return;
      }

      const bot = this.botInstances.get(botId);
      await bot?.destroy();
      this.botInstances.delete(botId);
      
      this.logger.info(`Bot unregistered: ${botId}`);
      this.emit('bot_unregistered', botId);

      res.json(this.formatResponse(true, { botId, unregistered: true }));
    } catch (error: any) {
      res.status(500).json(this.formatResponse(false, null, error.message));
    }
  }

  async listBots(req: APIRequest, res: Response): Promise<void> {
    const bots = Array.from(this.botInstances.keys()).map(id => ({
      botId: id,
      status: 'active',
    }));

    res.json(this.formatResponse(true, { bots, count: bots.length }));
  }

  async getBotInfo(req: APIRequest, res: Response): Promise<void> {
    const { botId } = req.params;
    const bot = this.botInstances.get(botId);

    if (!bot) {
      res.status(404).json(this.formatResponse(false, null, 'Bot not found'));
      return;
    }

    res.json(this.formatResponse(true, {
      botId,
      status: 'active',
      health: bot.getHealth(),
    }));
  }

  async getBotHealth(req: APIRequest, res: Response): Promise<void> {
    const bot = this.getBot(req, res);
    if (!bot) return;

    res.json(this.formatResponse(true, bot.getHealth()));
  }

  async sendMessage(req: APIRequest, res: Response): Promise<void> {
    const bot = this.getBot(req, res);
    if (!bot) return;

    try {
      const { threadId, message, attachments, mentions, replyToMessageId } = req.body;

      if (!threadId || !message) {
        res.status(400).json(this.formatResponse(false, null, 'threadId and message required'));
        return;
      }

      const result = await bot.sendMessage({
        threadID: threadId,
        message,
        attachments,
        mentionIDs: mentions,
        replyToMessageID: replyToMessageId,
      });

      res.json(this.formatResponse(true, result));
    } catch (error: any) {
      res.status(500).json(this.formatResponse(false, null, error.message));
    }
  }

  async replyToMessage(req: APIRequest, res: Response): Promise<void> {
    const bot = this.getBot(req, res);
    if (!bot) return;

    try {
      const { threadId, messageId, message } = req.body;

      if (!threadId || !messageId || !message) {
        res.status(400).json(this.formatResponse(false, null, 'threadId, messageId and message required'));
        return;
      }

      const result = await bot.sendMessage({
        threadID: threadId,
        message,
        replyToMessageID: messageId,
      });

      res.json(this.formatResponse(true, result));
    } catch (error: any) {
      res.status(500).json(this.formatResponse(false, null, error.message));
    }
  }

  async editMessage(req: APIRequest, res: Response): Promise<void> {
    const bot = this.getBot(req, res);
    if (!bot) return;

    try {
      const { messageId } = req.params;
      const { newText, threadId } = req.body;

      if (!newText) {
        res.status(400).json(this.formatResponse(false, null, 'newText required'));
        return;
      }

      const result = await bot.messageAction.editMessage({
        messageID: messageId,
        threadID: threadId || '',
        newBody: newText,
      });
      res.json(this.formatResponse(result.success, { messageId, edited: result.success }));
    } catch (error: any) {
      res.status(500).json(this.formatResponse(false, null, error.message));
    }
  }

  async deleteMessage(req: APIRequest, res: Response): Promise<void> {
    const bot = this.getBot(req, res);
    if (!bot) return;

    try {
      const { messageId } = req.params;
      const { forEveryone, threadId } = req.query;

      let result: { success: boolean };
      if (forEveryone === 'true') {
        result = await bot.messageAction.unsendMessage(messageId, threadId as string);
      } else {
        result = await bot.messageAction.deleteForSelf(messageId, threadId as string);
      }

      res.json(this.formatResponse(result.success, { messageId, deleted: result.success }));
    } catch (error: any) {
      res.status(500).json(this.formatResponse(false, null, error.message));
    }
  }

  async reactToMessage(req: APIRequest, res: Response): Promise<void> {
    const bot = this.getBot(req, res);
    if (!bot) return;

    try {
      const { messageId } = req.params;
      const { reaction } = req.body;

      if (!reaction) {
        res.status(400).json(this.formatResponse(false, null, 'reaction required'));
        return;
      }

      const result = await bot.reaction.addReaction(messageId, reaction);
      res.json(this.formatResponse(result, { messageId, reaction }));
    } catch (error: any) {
      res.status(500).json(this.formatResponse(false, null, error.message));
    }
  }

  async getThreadInfo(req: APIRequest, res: Response): Promise<void> {
    const bot = this.getBot(req, res);
    if (!bot) return;

    try {
      const { threadId } = req.params;
      const info = await bot.getThreadInfo(threadId);
      res.json(this.formatResponse(true, info));
    } catch (error: any) {
      res.status(500).json(this.formatResponse(false, null, error.message));
    }
  }

  async getThreadMessages(req: APIRequest, res: Response): Promise<void> {
    const bot = this.getBot(req, res);
    if (!bot) return;

    try {
      const { threadId } = req.params;
      const { limit, before, after } = req.query;

      const messages = await bot.messageHistory.getMessages(threadId, {
        limit: parseInt(limit as string, 10) || 20,
        before: before as string,
        after: after as string,
      });

      res.json(this.formatResponse(true, messages));
    } catch (error: any) {
      res.status(500).json(this.formatResponse(false, null, error.message));
    }
  }

  async getThreadParticipants(req: APIRequest, res: Response): Promise<void> {
    const bot = this.getBot(req, res);
    if (!bot) return;

    try {
      const { threadId } = req.params;
      const info = await bot.thread.getInfo(threadId);
      res.json(this.formatResponse(true, { participants: info?.participantIDs || [] }));
    } catch (error: any) {
      res.status(500).json(this.formatResponse(false, null, error.message));
    }
  }

  async setThreadName(req: APIRequest, res: Response): Promise<void> {
    const bot = this.getBot(req, res);
    if (!bot) return;

    try {
      const { threadId } = req.params;
      const { name } = req.body;

      const result = await bot.thread.updateThread(threadId, { name });
      res.json(this.formatResponse(result, { threadId, name }));
    } catch (error: any) {
      res.status(500).json(this.formatResponse(false, null, error.message));
    }
  }

  async setThreadEmoji(req: APIRequest, res: Response): Promise<void> {
    const bot = this.getBot(req, res);
    if (!bot) return;

    try {
      const { threadId } = req.params;
      const { emoji } = req.body;

      const result = await bot.thread.updateThread(threadId, { emoji });
      res.json(this.formatResponse(result, { threadId, emoji }));
    } catch (error: any) {
      res.status(500).json(this.formatResponse(false, null, error.message));
    }
  }

  async setThreadColor(req: APIRequest, res: Response): Promise<void> {
    const bot = this.getBot(req, res);
    if (!bot) return;

    try {
      const { threadId } = req.params;
      const { color } = req.body;

      const result = await bot.thread.updateThread(threadId, { color });
      res.json(this.formatResponse(result, { threadId, color }));
    } catch (error: any) {
      res.status(500).json(this.formatResponse(false, null, error.message));
    }
  }

  async muteThread(req: APIRequest, res: Response): Promise<void> {
    const bot = this.getBot(req, res);
    if (!bot) return;

    try {
      const { threadId } = req.params;
      const { duration } = req.body;

      const result = await bot.thread.muteThread(threadId, duration || 'forever');
      res.json(this.formatResponse(result, { threadId, muted: true }));
    } catch (error: any) {
      res.status(500).json(this.formatResponse(false, null, error.message));
    }
  }

  async unmuteThread(req: APIRequest, res: Response): Promise<void> {
    const bot = this.getBot(req, res);
    if (!bot) return;

    try {
      const { threadId } = req.params;

      const result = await bot.thread.unmuteThread(threadId);
      res.json(this.formatResponse(result, { threadId, muted: false }));
    } catch (error: any) {
      res.status(500).json(this.formatResponse(false, null, error.message));
    }
  }

  async getUserInfo(req: APIRequest, res: Response): Promise<void> {
    const bot = this.getBot(req, res);
    if (!bot) return;

    try {
      const { userId } = req.params;
      const info = await bot.getUserInfo(userId);
      res.json(this.formatResponse(true, info));
    } catch (error: any) {
      res.status(500).json(this.formatResponse(false, null, error.message));
    }
  }

  async getUserPresence(req: APIRequest, res: Response): Promise<void> {
    const bot = this.getBot(req, res);
    if (!bot) return;

    try {
      const { userId } = req.params;
      const presence = bot.presence.getPresence(userId);
      res.json(this.formatResponse(true, presence));
    } catch (error: any) {
      res.status(500).json(this.formatResponse(false, null, error.message));
    }
  }

  async addGroupMember(req: APIRequest, res: Response): Promise<void> {
    const bot = this.getBot(req, res);
    if (!bot) return;

    try {
      const { threadId } = req.params;
      const { userIds } = req.body;

      if (!userIds || !Array.isArray(userIds)) {
        res.status(400).json(this.formatResponse(false, null, 'userIds array required'));
        return;
      }

      const result = await bot.thread.addParticipants(threadId, userIds);
      res.json(this.formatResponse(result, { threadId, added: userIds }));
    } catch (error: any) {
      res.status(500).json(this.formatResponse(false, null, error.message));
    }
  }

  async removeGroupMember(req: APIRequest, res: Response): Promise<void> {
    const bot = this.getBot(req, res);
    if (!bot) return;

    try {
      const { threadId, userId } = req.params;

      const result = await bot.thread.removeParticipant(threadId, userId);
      res.json(this.formatResponse(result, { threadId, removed: userId }));
    } catch (error: any) {
      res.status(500).json(this.formatResponse(false, null, error.message));
    }
  }

  async setGroupAdmin(req: APIRequest, res: Response): Promise<void> {
    const bot = this.getBot(req, res);
    if (!bot) return;

    try {
      const { threadId, userId } = req.params;
      const { isAdmin } = req.body;

      const result = await bot.group.setAdminRole({ threadID: threadId, userID: userId, isAdmin: isAdmin !== false });
      res.json(this.formatResponse(result, { threadId, userId, isAdmin: isAdmin !== false }));
    } catch (error: any) {
      res.status(500).json(this.formatResponse(false, null, error.message));
    }
  }

  async setGroupImage(req: APIRequest, res: Response): Promise<void> {
    const bot = this.getBot(req, res);
    if (!bot) return;

    try {
      const { threadId } = req.params;
      const { imageUrl } = req.body;

      if (!imageUrl) {
        res.status(400).json(this.formatResponse(false, null, 'imageUrl required'));
        return;
      }

      const result = await bot.group.setThreadImage({ threadID: threadId, imageUrl });
      res.json(this.formatResponse(result, { threadId, imageSet: result }));
    } catch (error: any) {
      res.status(500).json(this.formatResponse(false, null, error.message));
    }
  }

  async setApprovalMode(req: APIRequest, res: Response): Promise<void> {
    const bot = this.getBot(req, res);
    if (!bot) return;

    try {
      const { threadId } = req.params;
      const { enabled } = req.body;

      const result = await bot.group.setApprovalMode({ threadID: threadId, enabled: enabled !== false });
      res.json(this.formatResponse(result, { threadId, approvalMode: enabled !== false }));
    } catch (error: any) {
      res.status(500).json(this.formatResponse(false, null, error.message));
    }
  }

  async createPoll(req: APIRequest, res: Response): Promise<void> {
    const bot = this.getBot(req, res);
    if (!bot) return;

    try {
      const { threadId, question, options, expiresInHours, isMultipleChoice, isAnonymous } = req.body;

      if (!threadId || !question || !options) {
        res.status(400).json(this.formatResponse(false, null, 'threadId, question and options required'));
        return;
      }

      const poll = await bot.edgeFeatures.createPoll({
        threadID: threadId,
        question,
        options,
        expiresInHours,
        isMultipleChoice,
        isAnonymous,
      });

      res.json(this.formatResponse(!!poll, poll));
    } catch (error: any) {
      res.status(500).json(this.formatResponse(false, null, error.message));
    }
  }

  async votePoll(req: APIRequest, res: Response): Promise<void> {
    const bot = this.getBot(req, res);
    if (!bot) return;

    try {
      const { pollId } = req.params;
      const { optionIds } = req.body;

      if (!optionIds || !Array.isArray(optionIds)) {
        res.status(400).json(this.formatResponse(false, null, 'optionIds array required'));
        return;
      }

      const result = await bot.edgeFeatures.votePoll(pollId, optionIds);
      res.json(this.formatResponse(result, { pollId, voted: result }));
    } catch (error: any) {
      res.status(500).json(this.formatResponse(false, null, error.message));
    }
  }

  async getPollResults(req: APIRequest, res: Response): Promise<void> {
    const bot = this.getBot(req, res);
    if (!bot) return;

    try {
      const { pollId } = req.params;
      const poll = await bot.edgeFeatures.getPollResults(pollId);
      res.json(this.formatResponse(!!poll, poll));
    } catch (error: any) {
      res.status(500).json(this.formatResponse(false, null, error.message));
    }
  }

  async getStories(req: APIRequest, res: Response): Promise<void> {
    const bot = this.getBot(req, res);
    if (!bot) return;

    try {
      const { userIds } = req.query;
      const ids = userIds ? (userIds as string).split(',') : undefined;
      const stories = await bot.edgeFeatures.getStories(ids);
      res.json(this.formatResponse(true, stories));
    } catch (error: any) {
      res.status(500).json(this.formatResponse(false, null, error.message));
    }
  }

  async viewStory(req: APIRequest, res: Response): Promise<void> {
    const bot = this.getBot(req, res);
    if (!bot) return;

    try {
      const { storyId } = req.params;
      const result = await bot.edgeFeatures.viewStory(storyId);
      res.json(this.formatResponse(result, { storyId, viewed: result }));
    } catch (error: any) {
      res.status(500).json(this.formatResponse(false, null, error.message));
    }
  }

  async reactToStory(req: APIRequest, res: Response): Promise<void> {
    const bot = this.getBot(req, res);
    if (!bot) return;

    try {
      const { storyId } = req.params;
      const { reaction } = req.body;

      if (!reaction) {
        res.status(400).json(this.formatResponse(false, null, 'reaction required'));
        return;
      }

      const result = await bot.edgeFeatures.reactToStory(storyId, reaction);
      res.json(this.formatResponse(result, { storyId, reaction }));
    } catch (error: any) {
      res.status(500).json(this.formatResponse(false, null, error.message));
    }
  }

  async initiateCall(req: APIRequest, res: Response): Promise<void> {
    const bot = this.getBot(req, res);
    if (!bot) return;

    try {
      const { threadId, type } = req.body;

      if (!threadId || !type) {
        res.status(400).json(this.formatResponse(false, null, 'threadId and type required'));
        return;
      }

      const call = await bot.edgeFeatures.initiateCall(threadId, type);
      res.json(this.formatResponse(!!call, call));
    } catch (error: any) {
      res.status(500).json(this.formatResponse(false, null, error.message));
    }
  }

  async endCall(req: APIRequest, res: Response): Promise<void> {
    const bot = this.getBot(req, res);
    if (!bot) return;

    try {
      const { callId } = req.params;
      const result = await bot.edgeFeatures.endCall(callId);
      res.json(this.formatResponse(result, { callId, ended: result }));
    } catch (error: any) {
      res.status(500).json(this.formatResponse(false, null, error.message));
    }
  }

  async shareLocation(req: APIRequest, res: Response): Promise<void> {
    const bot = this.getBot(req, res);
    if (!bot) return;

    try {
      const { threadId, latitude, longitude, isLive, duration, placeName } = req.body;

      if (!threadId || latitude === undefined || longitude === undefined) {
        res.status(400).json(this.formatResponse(false, null, 'threadId, latitude and longitude required'));
        return;
      }

      const share = await bot.edgeFeatures.shareLocation(threadId, latitude, longitude, {
        isLive,
        duration,
        placeName,
      });

      res.json(this.formatResponse(!!share, share));
    } catch (error: any) {
      res.status(500).json(this.formatResponse(false, null, error.message));
    }
  }

  async stopLocationShare(req: APIRequest, res: Response): Promise<void> {
    const bot = this.getBot(req, res);
    if (!bot) return;

    try {
      const { shareId } = req.params;
      const result = await bot.edgeFeatures.stopLiveLocation(shareId);
      res.json(this.formatResponse(result, { shareId, stopped: result }));
    } catch (error: any) {
      res.status(500).json(this.formatResponse(false, null, error.message));
    }
  }

  async scheduleMessage(req: APIRequest, res: Response): Promise<void> {
    const bot = this.getBot(req, res);
    if (!bot) return;

    try {
      const { threadId, message, scheduledFor } = req.body;

      if (!threadId || !message || !scheduledFor) {
        res.status(400).json(this.formatResponse(false, null, 'threadId, message and scheduledFor required'));
        return;
      }

      const scheduled = await bot.edgeFeatures.scheduleMessage(threadId, message, new Date(scheduledFor));
      res.json(this.formatResponse(!!scheduled, scheduled));
    } catch (error: any) {
      res.status(500).json(this.formatResponse(false, null, error.message));
    }
  }

  async cancelScheduledMessage(req: APIRequest, res: Response): Promise<void> {
    const bot = this.getBot(req, res);
    if (!bot) return;

    try {
      const { scheduleId } = req.params;
      const result = await bot.edgeFeatures.cancelScheduledMessage(scheduleId);
      res.json(this.formatResponse(result, { scheduleId, cancelled: result }));
    } catch (error: any) {
      res.status(500).json(this.formatResponse(false, null, error.message));
    }
  }

  async getScheduledMessages(req: APIRequest, res: Response): Promise<void> {
    const bot = this.getBot(req, res);
    if (!bot) return;

    try {
      const { threadId } = req.query;
      const messages = bot.edgeFeatures.getScheduledMessages(threadId as string);
      res.json(this.formatResponse(true, messages));
    } catch (error: any) {
      res.status(500).json(this.formatResponse(false, null, error.message));
    }
  }

  async downloadAttachment(req: APIRequest, res: Response): Promise<void> {
    const bot = this.getBot(req, res);
    if (!bot) return;

    try {
      const { url, filename, outputPath } = req.body;

      if (!url) {
        res.status(400).json(this.formatResponse(false, null, 'url required'));
        return;
      }

      const result = await bot.attachmentDownload.download({
        url,
        filename,
        outputPath,
      });

      res.json(this.formatResponse(result.success, result));
    } catch (error: any) {
      res.status(500).json(this.formatResponse(false, null, error.message));
    }
  }

  async getMetrics(req: APIRequest, res: Response): Promise<void> {
    const endpointStats: { [key: string]: EndpointStats } = {};
    this.metrics.endpointStats.forEach((value, key) => {
      endpointStats[key] = value;
    });

    res.json(this.formatResponse(true, {
      ...this.metrics,
      endpointStats,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
    }));
  }

  addApiKey(key: string): void {
    this.apiKeys.add(key);
    this.logger.info('API key added');
  }

  removeApiKey(key: string): boolean {
    const removed = this.apiKeys.delete(key);
    if (removed) {
      this.logger.info('API key removed');
    }
    return removed;
  }

  registerBotInstance(botId: string, bot: BitunFCA): void {
    this.botInstances.set(botId, bot);
    this.logger.success(`Bot instance registered: ${botId}`);
    this.emit('bot_registered', botId);
  }

  unregisterBotInstance(botId: string): boolean {
    const removed = this.botInstances.delete(botId);
    if (removed) {
      this.logger.info(`Bot instance unregistered: ${botId}`);
      this.emit('bot_unregistered', botId);
    }
    return removed;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.config.port, this.config.host, () => {
          this.isRunning = true;
          this.logger.success(`API server running on http://${this.config.host}:${this.config.port}`);
          this.emit('started', { port: this.config.port, host: this.config.host });
          resolve();
        });

        this.server.on('error', (err: Error) => {
          this.logger.error('Server error:', err.message);
          this.emit('error', err);
          reject(err);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.isRunning = false;
          this.logger.info('API server stopped');
          this.emit('stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  getStatus(): { running: boolean; port: number; bots: number; metrics: APIMetrics } {
    return {
      running: this.isRunning,
      port: this.config.port,
      bots: this.botInstances.size,
      metrics: this.metrics,
    };
  }

  getApp(): Application {
    return this.app;
  }
}

export default APIServer;
