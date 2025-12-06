import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import { RequestBuilder } from './RequestBuilder';
import { Logger } from './Logger';

export class UploadManager {
  private req: RequestBuilder;
  private logger: Logger;

  constructor(req: RequestBuilder) {
    this.req = req;
    this.logger = new Logger('UPLOAD');
  }

  async uploadFile(filepath: string): Promise<any> {
    this.logger.info(`Uploading file: ${path.basename(filepath)}`);
    
    if (!fs.existsSync(filepath)) {
      this.logger.error('File not found:', filepath);
      throw new Error(`File not found: ${filepath}`);
    }

    const stats = fs.statSync(filepath);
    this.logger.debug(`File size: ${(stats.size / 1024).toFixed(2)} KB`);

    const stream = fs.createReadStream(filepath);
    const form = new FormData();
    form.append('file', stream, path.basename(filepath));

    try {
      const headers = form.getHeaders();
      const res = await this.req.post(
        'https://upload.facebook.com/ajax/mercury/upload.php', 
        form, 
        headers as any
      );
      
      this.logger.success('File uploaded successfully');
      return res.data;
    } catch (error: any) {
      this.logger.error('Upload failed:', error.message);
      throw error;
    }
  }

  async uploadFromUrl(url: string): Promise<any> {
    this.logger.info(`Uploading from URL: ${url}`);
    
    try {
      const form = new FormData();
      form.append('url', url);
      
      const headers = form.getHeaders();
      const res = await this.req.post(
        'https://upload.facebook.com/ajax/mercury/upload.php',
        form,
        headers as any
      );
      
      this.logger.success('URL upload successful');
      return res.data;
    } catch (error: any) {
      this.logger.error('URL upload failed:', error.message);
      throw error;
    }
  }
}
