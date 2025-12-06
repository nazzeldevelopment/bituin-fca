import { Command, CommandContext } from '../types';
import { Logger } from '../core/Logger';

const logger = new Logger('CMD-INFO');

export const command: Command = {
  name: 'info',
  description: 'Get user or thread information',
  usage: '!info [userID]',
  aliases: ['i', 'user'],

  async execute(ctx: CommandContext, args: string[]) {
    logger.command('Info command executed');

    const targetID = args[0] || ctx.message.senderID;

    try {
      if (ctx.user) {
        const userInfo = await ctx.user.getInfo(targetID);
        
        if (userInfo) {
          const infoText = `
👤 **User Information**
━━━━━━━━━━━━━━━━━━━━
📛 Name: ${userInfo.name}
🆔 ID: ${userInfo.userID}
${userInfo.vanity ? `🔗 Username: ${userInfo.vanity}` : ''}
${userInfo.isFriend ? '✅ Friend' : ''}
${userInfo.isVerified ? '✓ Verified' : ''}
          `.trim();

          await ctx.sendMessage({
            threadID: ctx.message.threadID,
            message: infoText
          });
        } else {
          await ctx.sendMessage({
            threadID: ctx.message.threadID,
            message: '❌ User not found'
          });
        }
      }
    } catch (error: any) {
      logger.error('Info command error:', error.message);
      await ctx.sendMessage({
        threadID: ctx.message.threadID,
        message: '❌ Failed to get user info'
      });
    }

    logger.success('Info command completed');
  }
};
