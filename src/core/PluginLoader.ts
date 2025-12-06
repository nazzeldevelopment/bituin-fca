import fs from 'fs';
import path from 'path';
import { PluginContext } from '../types';
import { Logger } from './Logger';

export interface Plugin {
  name: string;
  version?: string;
  description?: string;
  init: (context: PluginContext) => void | Promise<void>;
}

export class PluginLoader {
  private plugins: Plugin[] = [];
  private pluginDir: string;
  private logger: Logger;

  constructor(pluginDir = path.join(process.cwd(), 'src/plugins')) {
    this.pluginDir = pluginDir;
    this.logger = new Logger('PLUGIN');
  }

  async loadAll(context: PluginContext): Promise<void> {
    this.logger.info(`Loading plugins from: ${this.pluginDir}`);
    
    if (!fs.existsSync(this.pluginDir)) {
      this.logger.warn('Plugin directory not found');
      return;
    }

    const files = fs.readdirSync(this.pluginDir).filter(f => 
      f.endsWith('.ts') || f.endsWith('.js')
    );

    this.logger.info(`Found ${files.length} plugin file(s)`);

    for (const f of files) {
      try {
        const modulePath = path.join(this.pluginDir, f);
        const mod = require(modulePath);
        
        const plugin: Plugin = mod.default || mod.plugin || mod;
        
        if (plugin && typeof plugin.init === 'function') {
          await plugin.init(context);
          this.plugins.push(plugin);
          this.logger.plugin(`✓ Loaded: ${plugin.name || f} ${plugin.version ? `v${plugin.version}` : ''}`);
        } else {
          this.logger.warn(`Skipped ${f}: No valid plugin export found`);
        }
      } catch (error: any) {
        this.logger.error(`Failed to load ${f}:`, error.message);
      }
    }

    this.logger.success(`${this.plugins.length} plugin(s) loaded successfully`);
  }

  getPlugins(): Plugin[] {
    return [...this.plugins];
  }

  getPlugin(name: string): Plugin | undefined {
    return this.plugins.find(p => p.name === name);
  }
}
