import { Command, CommandContext } from '../types';
import { Logger } from '../core/Logger';

const logger = new Logger('CMD-THREAD');

export const command: Command = {
  name: 'thread',
  description: 'Get current thread information',
  usage: '!thread',
  aliases: ['t', 'gc'],

  async execute(ctx: CommandContext, args: string[]) {
    logger.command('Thread command executed');

    try {
      if (ctx.thread) {
        const threadInfo = await ctx.thread.getInfo(ctx.message.threadID);
        
        if (threadInfo) {
          const infoText = `
💬 **Thread Information**
━━━━━━━━━━━━━━━━━━━━
📛 Name: ${threadInfo.name || 'Unnamed'}
🆔 ID: ${threadInfo.threadID}
👥 Participants: ${threadInfo.participantIDs.length}
${threadInfo.isGroup ? '✅ Group Chat' : '👤 Direct Message'}
${threadInfo.emoji ? `😀 Emoji: ${threadInfo.emoji}` : ''}
📊 Messages: ${threadInfo.messageCount}
${threadInfo.unreadCount > 0 ? `📩 Unread: ${threadInfo.unreadCount}` : ''}
${threadInfo.isMuted ? '🔇 Muted' : '🔔 Notifications On'}
${threadInfo.isArchived ? '📦 Archived' : ''}
          `.trim();

          await ctx.sendMessage({
            threadID: ctx.message.threadID,
            message: infoText
          });
        } else {
          await ctx.sendMessage({
            threadID: ctx.message.threadID,
            message: '❌ Could not get thread info'
          });
        }
      }
    } catch (error: any) {
      logger.error('Thread command error:', error.message);
      await ctx.sendMessage({
        threadID: ctx.message.threadID,
        message: '❌ Failed to get thread info'
      });
    }

    logger.success('Thread command completed');
  }
};
