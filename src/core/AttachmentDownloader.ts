import { EventEmitter } from 'eventemitter3';
import { RequestBuilder } from './RequestBuilder';
import { GraphQLClient } from './GraphQLClient';
import { Logger } from './Logger';
import { Attachment } from '../types';
import { FULL_DOC_IDS } from './DocIDRepository';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface DownloadOptions {
  url: string;
  filename?: string;
  outputPath?: string;
  decrypt?: boolean;
}

export interface DownloadResult {
  success: boolean;
  path?: string;
  size?: number;
  mimeType?: string;
  error?: string;
  cached?: boolean;
}

export interface CacheEntry {
  path: string;
  size: number;
  mimeType: string;
  downloadedAt: number;
  accessedAt: number;
}

export interface DownloaderConfig {
  cacheEnabled: boolean;
  cacheDir: string;
  maxCacheSize: number;
  cacheTTL: number;
  autoDecrypt: boolean;
  maxConcurrent: number;
}

const MIME_TYPES: Record<string, string> = {
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'png': 'image/png',
  'gif': 'image/gif',
  'webp': 'image/webp',
  'mp4': 'video/mp4',
  'webm': 'video/webm',
  'mov': 'video/quicktime',
  'mp3': 'audio/mpeg',
  'ogg': 'audio/ogg',
  'wav': 'audio/wav',
  'm4a': 'audio/mp4',
  'pdf': 'application/pdf',
  'doc': 'application/msword',
  'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'zip': 'application/zip',
};

export class AttachmentDownloader extends EventEmitter {
  private req: RequestBuilder;
  private gql: GraphQLClient;
  private logger: Logger;
  private config: DownloaderConfig;
  private cache: Map<string, CacheEntry> = new Map();
  private downloadQueue: Map<string, Promise<DownloadResult>> = new Map();
  private activeDownloads = 0;

  constructor(req: RequestBuilder, gql: GraphQLClient, config?: Partial<DownloaderConfig>) {
    super();
    this.req = req;
    this.gql = gql;
    this.logger = new Logger('DOWNLOADER');

    this.config = {
      cacheEnabled: true,
      cacheDir: './downloads/cache',
      maxCacheSize: 500 * 1024 * 1024,
      cacheTTL: 7 * 24 * 60 * 60 * 1000,
      autoDecrypt: true,
      maxConcurrent: 5,
      ...config
    };

    this.ensureCacheDir();
    this.loadCacheIndex();
    this.startCacheCleanup();

    this.logger.success('Attachment downloader initialized');
  }

  private ensureCacheDir(): void {
    if (!fs.existsSync(this.config.cacheDir)) {
      fs.mkdirSync(this.config.cacheDir, { recursive: true });
    }
  }

  private loadCacheIndex(): void {
    try {
      const indexPath = path.join(this.config.cacheDir, 'index.json');
      if (fs.existsSync(indexPath)) {
        const data = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
        for (const [key, entry] of Object.entries(data)) {
          this.cache.set(key, entry as CacheEntry);
        }
        this.logger.debug(`Loaded ${this.cache.size} cached entries`);
      }
    } catch (error: any) {
      this.logger.debug('No cache index found');
    }
  }

  private saveCacheIndex(): void {
    try {
      const indexPath = path.join(this.config.cacheDir, 'index.json');
      const data = Object.fromEntries(this.cache);
      fs.writeFileSync(indexPath, JSON.stringify(data, null, 2));
    } catch (error: any) {
      this.logger.error('Failed to save cache index:', error.message);
    }
  }

  private startCacheCleanup(): void {
    setInterval(() => {
      this.cleanupCache();
    }, 60 * 60 * 1000);
  }

  private cleanupCache(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.downloadedAt > this.config.cacheTTL) {
        try {
          if (fs.existsSync(entry.path)) {
            fs.unlinkSync(entry.path);
          }
          this.cache.delete(key);
          cleaned++;
        } catch (error: any) {
          this.logger.debug(`Failed to clean cache entry: ${key}`);
        }
      }
    }

    if (cleaned > 0) {
      this.logger.debug(`Cleaned ${cleaned} expired cache entries`);
      this.saveCacheIndex();
    }
  }

  async download(options: DownloadOptions): Promise<DownloadResult> {
    const { url, filename, outputPath, decrypt } = options;
    const cacheKey = this.getCacheKey(url);

    if (this.config.cacheEnabled) {
      const cached = this.getFromCache(cacheKey);
      if (cached) {
        this.logger.debug(`Cache hit: ${filename || url}`);
        return {
          success: true,
          path: cached.path,
          size: cached.size,
          mimeType: cached.mimeType,
          cached: true
        };
      }
    }

    if (this.downloadQueue.has(cacheKey)) {
      this.logger.debug(`Already downloading: ${url}`);
      return this.downloadQueue.get(cacheKey)!;
    }

    const downloadPromise = this.performDownload(url, filename, outputPath, decrypt ?? this.config.autoDecrypt);
    this.downloadQueue.set(cacheKey, downloadPromise);

    try {
      const result = await downloadPromise;
      
      if (result.success && result.path && this.config.cacheEnabled) {
        this.addToCache(cacheKey, {
          path: result.path,
          size: result.size || 0,
          mimeType: result.mimeType || 'application/octet-stream',
          downloadedAt: Date.now(),
          accessedAt: Date.now()
        });
      }

      return result;
    } finally {
      this.downloadQueue.delete(cacheKey);
    }
  }

  private async performDownload(
    url: string, 
    filename?: string, 
    outputPath?: string,
    decrypt?: boolean
  ): Promise<DownloadResult> {
    while (this.activeDownloads >= this.config.maxConcurrent) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.activeDownloads++;
    this.logger.info(`Downloading: ${filename || url.substring(0, 50)}...`);

    try {
      const response = await this.req.get(url, {
        responseType: 'arraybuffer',
        maxRedirects: 5
      });

      let data = Buffer.from(response.data);
      
      if (decrypt && this.isEncrypted(data)) {
        data = await this.decryptAttachment(data, url);
      }

      const mimeType = this.detectMimeType(response.headers['content-type'], filename, data);
      const ext = this.getExtensionFromMime(mimeType);
      
      const finalFilename = filename || `attachment_${Date.now()}${ext}`;
      const finalPath = outputPath || path.join(this.config.cacheDir, finalFilename);

      const dir = path.dirname(finalPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(finalPath, data);

      this.logger.success(`Downloaded: ${finalFilename} (${this.formatBytes(data.length)})`);
      this.emit('downloaded', { path: finalPath, size: data.length, mimeType });

      return {
        success: true,
        path: finalPath,
        size: data.length,
        mimeType
      };
    } catch (error: any) {
      this.logger.error('Download failed:', error.message);
      return {
        success: false,
        error: error.message
      };
    } finally {
      this.activeDownloads--;
    }
  }

  async downloadAttachment(attachment: Attachment, outputPath?: string): Promise<DownloadResult> {
    if (!attachment.url) {
      if (attachment.id) {
        const url = await this.getAttachmentUrl(attachment.id);
        if (url) {
          return this.download({ url, filename: attachment.filename, outputPath });
        }
      }
      return { success: false, error: 'No URL or ID available' };
    }

    return this.download({
      url: attachment.url,
      filename: attachment.filename,
      outputPath
    });
  }

  async getAttachmentUrl(attachmentID: string): Promise<string | null> {
    this.logger.debug(`Fetching URL for attachment: ${attachmentID}`);

    try {
      const response = await this.gql.request({
        docId: FULL_DOC_IDS.ATTACHMENTS.ATTACHMENT_URL.id,
        variables: {
          attachment_id: attachmentID
        }
      });

      return response.data?.attachment?.url || 
             response.data?.attachment?.playable_url || 
             null;
    } catch (error: any) {
      this.logger.error('Failed to get attachment URL:', error.message);
      return null;
    }
  }

  async downloadBatch(attachments: Attachment[], outputDir?: string): Promise<DownloadResult[]> {
    this.logger.info(`Batch downloading ${attachments.length} attachments`);

    const results: DownloadResult[] = [];
    const dir = outputDir || this.config.cacheDir;

    const chunks: Attachment[][] = [];
    for (let i = 0; i < attachments.length; i += this.config.maxConcurrent) {
      chunks.push(attachments.slice(i, i + this.config.maxConcurrent));
    }

    for (const chunk of chunks) {
      const chunkResults = await Promise.all(
        chunk.map(att => {
          const filename = att.filename || `${att.type}_${att.id || Date.now()}`;
          return this.downloadAttachment(att, path.join(dir, filename));
        })
      );
      results.push(...chunkResults);
    }

    const successCount = results.filter(r => r.success).length;
    this.logger.success(`Batch download complete: ${successCount}/${attachments.length}`);

    return results;
  }

  private isEncrypted(data: Buffer): boolean {
    if (data.length < 16) return false;
    
    const header = data.slice(0, 8).toString('hex');
    return header.startsWith('00000') || 
           (data[0] === 0 && data[1] === 0 && data[2] === 0);
  }

  private async decryptAttachment(data: Buffer, url: string): Promise<Buffer> {
    this.logger.debug('Decrypting attachment...');

    try {
      const keyMatch = url.match(/[?&]oh=([a-f0-9]+)/);
      if (!keyMatch) {
        return data;
      }

      const key = Buffer.from(keyMatch[1], 'hex');
      const iv = data.slice(0, 16);
      const encrypted = data.slice(16);

      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

      this.logger.debug('Decryption successful');
      return decrypted;
    } catch (error: any) {
      this.logger.debug('Decryption not needed or failed, using original data');
      return data;
    }
  }

  private detectMimeType(contentType?: string, filename?: string, data?: Buffer): string {
    if (contentType && !contentType.includes('octet-stream')) {
      return contentType.split(';')[0].trim();
    }

    if (filename) {
      const ext = path.extname(filename).toLowerCase().slice(1);
      if (MIME_TYPES[ext]) {
        return MIME_TYPES[ext];
      }
    }

    if (data && data.length >= 4) {
      const magic = data.slice(0, 4).toString('hex');
      
      if (magic.startsWith('89504e47')) return 'image/png';
      if (magic.startsWith('ffd8ff')) return 'image/jpeg';
      if (magic.startsWith('47494638')) return 'image/gif';
      if (magic.startsWith('52494646')) return 'image/webp';
      if (magic.startsWith('00000020') || magic.startsWith('00000018')) return 'video/mp4';
      if (magic.startsWith('1a45dfa3')) return 'video/webm';
      if (magic.startsWith('4944334')) return 'audio/mpeg';
      if (magic.startsWith('4f676753')) return 'audio/ogg';
      if (magic.startsWith('25504446')) return 'application/pdf';
    }

    return 'application/octet-stream';
  }

  private getExtensionFromMime(mimeType: string): string {
    const mimeToExt: Record<string, string> = {};
    for (const [ext, mime] of Object.entries(MIME_TYPES)) {
      mimeToExt[mime] = `.${ext}`;
    }
    return mimeToExt[mimeType] || '';
  }

  private getCacheKey(url: string): string {
    return crypto.createHash('md5').update(url).digest('hex');
  }

  private getFromCache(key: string): CacheEntry | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (!fs.existsSync(entry.path)) {
      this.cache.delete(key);
      return null;
    }

    entry.accessedAt = Date.now();
    return entry;
  }

  private addToCache(key: string, entry: CacheEntry): void {
    this.cache.set(key, entry);
    this.saveCacheIndex();
    this.checkCacheSize();
  }

  private checkCacheSize(): void {
    let totalSize = 0;
    for (const entry of this.cache.values()) {
      totalSize += entry.size;
    }

    if (totalSize > this.config.maxCacheSize) {
      this.logger.debug('Cache size exceeded, cleaning oldest entries...');
      
      const entries = Array.from(this.cache.entries())
        .sort((a, b) => a[1].accessedAt - b[1].accessedAt);

      while (totalSize > this.config.maxCacheSize * 0.8 && entries.length > 0) {
        const [key, entry] = entries.shift()!;
        totalSize -= entry.size;
        
        try {
          if (fs.existsSync(entry.path)) {
            fs.unlinkSync(entry.path);
          }
        } catch {}
        
        this.cache.delete(key);
      }

      this.saveCacheIndex();
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  clearCache(): void {
    for (const entry of this.cache.values()) {
      try {
        if (fs.existsSync(entry.path)) {
          fs.unlinkSync(entry.path);
        }
      } catch {}
    }

    this.cache.clear();
    this.saveCacheIndex();
    this.logger.info('Cache cleared');
  }

  getCacheStats(): {
    entries: number;
    totalSize: number;
    oldestEntry: number;
  } {
    let totalSize = 0;
    let oldest = Date.now();

    for (const entry of this.cache.values()) {
      totalSize += entry.size;
      if (entry.downloadedAt < oldest) {
        oldest = entry.downloadedAt;
      }
    }

    return {
      entries: this.cache.size,
      totalSize,
      oldestEntry: oldest
    };
  }

  destroy(): void {
    this.saveCacheIndex();
    this.downloadQueue.clear();
    this.removeAllListeners();
    this.logger.info('Attachment downloader destroyed');
  }
}
