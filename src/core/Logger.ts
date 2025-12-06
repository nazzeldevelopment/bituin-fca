import chalk from 'chalk';

const getTimestamp = (): string => {
  const now = new Date();
  return now.toISOString().replace('T', ' ').substring(0, 19);
};

const formatMessage = (level: string, color: (str: string) => string, emoji: string, ...args: any[]): void => {
  const timestamp = chalk.gray(`[${getTimestamp()}]`);
  const levelTag = color(`[${level}]`);
  console.log(`${timestamp} ${emoji} ${levelTag}`, ...args);
};

export class Logger {
  private context: string;

  constructor(context: string = 'BITUIN-FCA') {
    this.context = context;
  }

  private formatWithContext(level: string, color: (str: string) => string, emoji: string, ...args: any[]): void {
    const timestamp = chalk.gray(`[${getTimestamp()}]`);
    const ctx = chalk.cyan(`[${this.context}]`);
    const levelTag = color(`[${level}]`);
    console.log(`${timestamp} ${emoji} ${ctx} ${levelTag}`, ...args);
  }

  info(...args: any[]): void {
    this.formatWithContext('INFO', chalk.blue, '💡', ...args);
  }

  success(...args: any[]): void {
    this.formatWithContext('SUCCESS', chalk.green, '✅', ...args);
  }

  warn(...args: any[]): void {
    this.formatWithContext('WARN', chalk.yellow, '⚠️', ...args);
  }

  error(...args: any[]): void {
    this.formatWithContext('ERROR', chalk.red, '❌', ...args);
  }

  debug(...args: any[]): void {
    this.formatWithContext('DEBUG', chalk.magenta, '🔍', ...args);
  }

  mqtt(...args: any[]): void {
    this.formatWithContext('MQTT', chalk.greenBright, '📡', ...args);
  }

  http(...args: any[]): void {
    this.formatWithContext('HTTP', chalk.blueBright, '🌐', ...args);
  }

  session(...args: any[]): void {
    this.formatWithContext('SESSION', chalk.yellowBright, '🔐', ...args);
  }

  plugin(...args: any[]): void {
    this.formatWithContext('PLUGIN', chalk.magentaBright, '🔌', ...args);
  }

  command(...args: any[]): void {
    this.formatWithContext('CMD', chalk.cyanBright, '⚡', ...args);
  }

  banner(): void {
    console.log(chalk.cyan(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   ██████╗ ██╗████████╗██╗   ██╗██╗███╗   ██╗                ║
║   ██╔══██╗██║╚══██╔══╝██║   ██║██║████╗  ██║                ║
║   ██████╔╝██║   ██║   ██║   ██║██║██╔██╗ ██║                ║
║   ██╔══██╗██║   ██║   ██║   ██║██║██║╚██╗██║                ║
║   ██████╔╝██║   ██║   ╚██████╔╝██║██║ ╚████║                ║
║   ╚═════╝ ╚═╝   ╚═╝    ╚═════╝ ╚═╝╚═╝  ╚═══╝                ║
║                                                              ║
║   ${chalk.yellow('FCA V1/V2 Ultra')} - ${chalk.green('Advanced Facebook Chat API')}          ║
║   ${chalk.gray('Version 0.1.0')}                                            ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`));
  }

  divider(char: string = '─', length: number = 60): void {
    console.log(chalk.gray(char.repeat(length)));
  }

  table(data: Record<string, any>): void {
    this.divider();
    for (const [key, value] of Object.entries(data)) {
      console.log(`  ${chalk.cyan(key.padEnd(20))} ${chalk.white(String(value))}`);
    }
    this.divider();
  }
}

export const logger = new Logger();
