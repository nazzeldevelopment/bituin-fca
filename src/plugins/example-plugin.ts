import { PluginContext } from '../types';
import { Logger } from '../core/Logger';

const logger = new Logger('EXAMPLE-PLUGIN');

export const plugin = {
  name: 'example-plugin',
  version: '1.0.0',
  description: 'An example plugin demonstrating the plugin system',

  init(context: PluginContext): void {
    logger.plugin('Example plugin initialized!');
    
    context.on('message', (msg) => {
      if (msg.body && msg.body.toLowerCase().includes('hello')) {
        logger.info(`Detected greeting from ${msg.senderID}`);
      }
    });
  }
};

export default plugin;
