import { Command } from '../types';
import { Logger } from '../core/Logger';

const logger = new Logger('CMD-PING');

export const command: Command = {
  name: 'ping',
  description: 'Check if the bot is responsive',

  async execute(ctx, args) {
    const start = Date.now();
    
    logger.command('Ping command executed');
    
    const latency = Date.now() - start;
    
    if (ctx.sendMessage) {
      await ctx.sendMessage({
        threadID: ctx.message.threadID,
        message: `🏓 Pong! Latency: ${latency}ms`
      });
    }
    
    logger.success(`Ping response sent (${latency}ms)`);
  }
};
