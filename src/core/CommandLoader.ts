import fs from 'fs';
import path from 'path';
import { Command } from '../types';
import { Logger } from './Logger';

export class CommandLoader {
  private commands: Map<string, Command> = new Map();
  private commandDir: string;
  private logger: Logger;

  constructor(commandDir = path.join(process.cwd(), 'src/commands')) {
    this.commandDir = commandDir;
    this.logger = new Logger('COMMAND');
  }

  loadAll(): void {
    this.logger.info(`Loading commands from: ${this.commandDir}`);
    
    if (!fs.existsSync(this.commandDir)) {
      this.logger.warn('Command directory not found');
      return;
    }

    const files = fs.readdirSync(this.commandDir).filter(f =>
      f.endsWith('.ts') || f.endsWith('.js')
    );

    this.logger.info(`Found ${files.length} command file(s)`);

    for (const f of files) {
      try {
        const modulePath = path.join(this.commandDir, f);
        const mod = require(modulePath);
        const cmd: Command = mod.command || mod.default;

        if (cmd && cmd.name && typeof cmd.execute === 'function') {
          this.commands.set(cmd.name.toLowerCase(), cmd);
          this.logger.command(`✓ Loaded: !${cmd.name} ${cmd.description ? `- ${cmd.description}` : ''}`);
        } else {
          this.logger.warn(`Skipped ${f}: Invalid command format`);
        }
      } catch (error: any) {
        this.logger.error(`Failed to load ${f}:`, error.message);
      }
    }

    this.logger.success(`${this.commands.size} command(s) loaded successfully`);
  }

  getCommand(name: string): Command | undefined {
    return this.commands.get(name.toLowerCase());
  }

  getAllCommands(): Map<string, Command> {
    return new Map(this.commands);
  }

  hasCommand(name: string): boolean {
    return this.commands.has(name.toLowerCase());
  }

  async execute(name: string, ctx: any, args: string[]): Promise<boolean> {
    const cmd = this.getCommand(name);
    
    if (!cmd) {
      this.logger.warn(`Command not found: ${name}`);
      return false;
    }

    try {
      this.logger.command(`Executing: !${name} [${args.join(', ')}]`);
      await cmd.execute(ctx, args);
      return true;
    } catch (error: any) {
      this.logger.error(`Command execution failed: ${error.message}`);
      return false;
    }
  }
}
