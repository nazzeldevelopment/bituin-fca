import { Command, CommandContext } from '../types';
import { Logger } from '../core/Logger';

const logger = new Logger('CMD-HELP');

export const command: Command = {
  name: 'help',
  description: 'Show available commands',
  usage: '!help [command]',
  aliases: ['h', 'commands'],

  async execute(ctx: CommandContext, args: string[]) {
    logger.command('Help command executed');

    const helpText = `
📚 **Bituin-FCA Commands**

!ping - Check bot responsiveness
!help - Show this help message
!info - Get your info
!thread - Get thread info

More commands coming soon!
    `.trim();

    if (ctx.sendMessage) {
      await ctx.sendMessage({
        threadID: ctx.message.threadID,
        message: helpText
      });
    }

    logger.success('Help sent');
  }
};
