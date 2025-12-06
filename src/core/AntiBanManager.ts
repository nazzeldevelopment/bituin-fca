import { EventEmitter } from 'eventemitter3';
import { Logger } from './Logger';
import { delay, randomString } from '../utils/helpers';

export interface AntiBanConfig {
  minRequestDelay: number;
  maxRequestDelay: number;
  requestsPerMinute: number;
  enableFingerprint: boolean;
  enableHumanBehavior: boolean;
  maxConsecutiveRequests: number;
  cooldownAfterWarning: number;
  checkpointCooldown: number;
}

export interface DeviceFingerprint {
  userAgent: string;
  screenWidth: number;
  screenHeight: number;
  colorDepth: number;
  timezone: string;
  language: string;
  platform: string;
  deviceMemory: number;
  hardwareConcurrency: number;
  webglVendor: string;
  webglRenderer: string;
}

export interface AccountHealth {
  score: number;
  warnings: number;
  checkpoints: number;
  lastCheckpoint: number | null;
  requestsToday: number;
  messagestoday: number;
  lastRequest: number;
  isSuspicious: boolean;
  isRestricted: boolean;
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1.2 Mobile/15E148 Safari/604.1',
];

const SCREEN_RESOLUTIONS = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 2560, height: 1440 },
  { width: 3840, height: 2160 },
];

const TIMEZONES = [
  'America/New_York',
  'America/Los_Angeles',
  'America/Chicago',
  'Europe/London',
  'Europe/Paris',
  'Asia/Tokyo',
  'Asia/Manila',
  'Australia/Sydney',
];

const WEBGL_RENDERERS = [
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)' },
  { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0)' },
  { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0)' },
  { vendor: 'Apple Inc.', renderer: 'Apple M1' },
  { vendor: 'Apple Inc.', renderer: 'Apple M2 Pro' },
];

export class AntiBanManager extends EventEmitter {
  private logger: Logger;
  private config: AntiBanConfig;
  private health: AccountHealth;
  private currentFingerprint: DeviceFingerprint;
  private requestQueue: number[] = [];
  private consecutiveRequests = 0;
  private isCoolingDown = false;
  private fingerprintRotationInterval?: NodeJS.Timeout;

  constructor(config?: Partial<AntiBanConfig>) {
    super();
    this.logger = new Logger('ANTI-BAN');

    this.config = {
      minRequestDelay: 500,
      maxRequestDelay: 2000,
      requestsPerMinute: 30,
      enableFingerprint: true,
      enableHumanBehavior: true,
      maxConsecutiveRequests: 10,
      cooldownAfterWarning: 60000,
      checkpointCooldown: 300000,
      ...config
    };

    this.health = {
      score: 100,
      warnings: 0,
      checkpoints: 0,
      lastCheckpoint: null,
      requestsToday: 0,
      messagestoday: 0,
      lastRequest: 0,
      isSuspicious: false,
      isRestricted: false
    };

    this.currentFingerprint = this.generateFingerprint();
    this.startFingerprintRotation();
    this.startHealthMonitor();

    this.logger.success('Anti-ban manager initialized');
    this.logger.table({
      'Min Delay': `${this.config.minRequestDelay}ms`,
      'Max Delay': `${this.config.maxRequestDelay}ms`,
      'Requests/min': this.config.requestsPerMinute,
      'Fingerprint': this.config.enableFingerprint ? 'Enabled' : 'Disabled',
      'Human Behavior': this.config.enableHumanBehavior ? 'Enabled' : 'Disabled'
    });
  }

  private generateFingerprint(): DeviceFingerprint {
    const resolution = SCREEN_RESOLUTIONS[Math.floor(Math.random() * SCREEN_RESOLUTIONS.length)];
    const webgl = WEBGL_RENDERERS[Math.floor(Math.random() * WEBGL_RENDERERS.length)];

    const fingerprint: DeviceFingerprint = {
      userAgent: USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
      screenWidth: resolution.width,
      screenHeight: resolution.height,
      colorDepth: [24, 32][Math.floor(Math.random() * 2)],
      timezone: TIMEZONES[Math.floor(Math.random() * TIMEZONES.length)],
      language: ['en-US', 'en-GB', 'en'][Math.floor(Math.random() * 3)],
      platform: ['Win32', 'MacIntel', 'Linux x86_64'][Math.floor(Math.random() * 3)],
      deviceMemory: [4, 8, 16, 32][Math.floor(Math.random() * 4)],
      hardwareConcurrency: [4, 6, 8, 12, 16][Math.floor(Math.random() * 5)],
      webglVendor: webgl.vendor,
      webglRenderer: webgl.renderer
    };

    this.logger.debug('Generated new fingerprint');
    return fingerprint;
  }

  private startFingerprintRotation(): void {
    if (!this.config.enableFingerprint) return;

    const rotationInterval = 30 * 60 * 1000 + Math.random() * 30 * 60 * 1000;
    
    this.fingerprintRotationInterval = setInterval(() => {
      this.rotateFingerprint();
    }, rotationInterval);
  }

  rotateFingerprint(): DeviceFingerprint {
    this.currentFingerprint = this.generateFingerprint();
    this.logger.info('Device fingerprint rotated');
    this.emit('fingerprint_rotated', this.currentFingerprint);
    return this.currentFingerprint;
  }

  getFingerprint(): DeviceFingerprint {
    return { ...this.currentFingerprint };
  }

  getUserAgent(): string {
    return this.currentFingerprint.userAgent;
  }

  private startHealthMonitor(): void {
    setInterval(() => {
      this.updateHealthScore();
      this.cleanupOldRequests();
      
      if (this.health.score < 30) {
        this.logger.warn(`Account health critical: ${this.health.score}/100`);
        this.emit('health_critical', this.health);
      }
    }, 60000);

    setInterval(() => {
      this.health.requestsToday = 0;
      this.health.messagestoday = 0;
      this.logger.debug('Daily counters reset');
    }, 24 * 60 * 60 * 1000);
  }

  private updateHealthScore(): void {
    let score = 100;

    score -= this.health.warnings * 10;
    score -= this.health.checkpoints * 20;

    if (this.health.requestsToday > 500) {
      score -= Math.floor((this.health.requestsToday - 500) / 100) * 5;
    }

    if (this.health.messagestoday > 200) {
      score -= Math.floor((this.health.messagestoday - 200) / 50) * 5;
    }

    if (this.health.lastCheckpoint) {
      const hoursSinceCheckpoint = (Date.now() - this.health.lastCheckpoint) / (1000 * 60 * 60);
      if (hoursSinceCheckpoint < 24) {
        score -= 20;
      }
    }

    this.health.score = Math.max(0, Math.min(100, score));
    this.health.isSuspicious = this.health.score < 50;
  }

  private cleanupOldRequests(): void {
    const oneMinuteAgo = Date.now() - 60000;
    this.requestQueue = this.requestQueue.filter(t => t > oneMinuteAgo);
  }

  async beforeRequest(): Promise<{ allowed: boolean; headers: Record<string, string> }> {
    if (this.isCoolingDown) {
      this.logger.warn('Request blocked - cooling down');
      return { allowed: false, headers: {} };
    }

    if (this.health.isRestricted) {
      this.logger.error('Request blocked - account restricted');
      return { allowed: false, headers: {} };
    }

    this.cleanupOldRequests();
    if (this.requestQueue.length >= this.config.requestsPerMinute) {
      this.logger.warn('Rate limit approaching, adding extra delay');
      await delay(5000 + Math.random() * 5000);
    }

    if (this.config.enableHumanBehavior) {
      await this.simulateHumanDelay();
    }

    this.consecutiveRequests++;
    if (this.consecutiveRequests >= this.config.maxConsecutiveRequests) {
      this.logger.info('Taking break after consecutive requests');
      await delay(10000 + Math.random() * 10000);
      this.consecutiveRequests = 0;
    }

    this.requestQueue.push(Date.now());
    this.health.requestsToday++;
    this.health.lastRequest = Date.now();

    const headers = this.buildHeaders();
    return { allowed: true, headers };
  }

  private async simulateHumanDelay(): Promise<void> {
    const baseDelay = this.config.minRequestDelay + 
      Math.random() * (this.config.maxRequestDelay - this.config.minRequestDelay);
    
    const jitter = (Math.random() - 0.5) * 200;
    const totalDelay = Math.max(100, baseDelay + jitter);

    if (Math.random() < 0.1) {
      const extraDelay = 2000 + Math.random() * 5000;
      this.logger.debug(`Simulating reading pause: ${Math.floor(extraDelay)}ms`);
      await delay(extraDelay);
    }

    await delay(totalDelay);
  }

  private buildHeaders(): Record<string, string> {
    const fp = this.currentFingerprint;
    
    return {
      'User-Agent': fp.userAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': `${fp.language},en;q=0.9`,
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': `"${fp.platform === 'Win32' ? 'Windows' : fp.platform === 'MacIntel' ? 'macOS' : 'Linux'}"`,
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'X-Request-Id': randomString(32),
    };
  }

  afterRequest(response: any): void {
    this.consecutiveRequests = 0;

    if (this.detectCheckpoint(response)) {
      this.handleCheckpoint();
    }

    if (this.detectWarning(response)) {
      this.handleWarning();
    }

    if (this.detectRateLimit(response)) {
      this.handleRateLimit();
    }
  }

  private detectCheckpoint(response: any): boolean {
    if (!response) return false;
    
    const data = typeof response === 'string' ? response : JSON.stringify(response);
    const checkpointIndicators = [
      'checkpoint',
      'security_check',
      'verify_identity',
      'confirm_identity',
      'suspicious_login',
      'account_secured',
      'login_approval',
      'two_factor',
      '/checkpoint/',
      'checkpoint_required'
    ];

    return checkpointIndicators.some(indicator => 
      data.toLowerCase().includes(indicator.toLowerCase())
    );
  }

  private detectWarning(response: any): boolean {
    if (!response) return false;
    
    const data = typeof response === 'string' ? response : JSON.stringify(response);
    const warningIndicators = [
      'rate_limit',
      'too_many_requests',
      'slow_down',
      'temporarily_blocked',
      'action_blocked',
      'try_again_later'
    ];

    return warningIndicators.some(indicator => 
      data.toLowerCase().includes(indicator.toLowerCase())
    );
  }

  private detectRateLimit(response: any): boolean {
    if (!response) return false;
    
    if (response.status === 429) return true;
    
    const data = typeof response === 'string' ? response : JSON.stringify(response);
    return data.toLowerCase().includes('rate limit') || 
           data.toLowerCase().includes('too many');
  }

  private handleCheckpoint(): void {
    this.health.checkpoints++;
    this.health.lastCheckpoint = Date.now();
    this.health.score -= 30;
    
    this.logger.error('CHECKPOINT DETECTED! Account may require verification');
    this.emit('checkpoint', { timestamp: Date.now(), count: this.health.checkpoints });
    
    this.startCooldown(this.config.checkpointCooldown);
  }

  private handleWarning(): void {
    this.health.warnings++;
    this.health.score -= 15;
    
    this.logger.warn(`Warning detected! Total warnings: ${this.health.warnings}`);
    this.emit('warning', { timestamp: Date.now(), count: this.health.warnings });
    
    this.startCooldown(this.config.cooldownAfterWarning);
  }

  private handleRateLimit(): void {
    this.logger.warn('Rate limit hit! Starting extended cooldown');
    this.emit('rate_limit', { timestamp: Date.now() });
    
    this.startCooldown(this.config.cooldownAfterWarning * 2);
  }

  private startCooldown(duration: number): void {
    this.isCoolingDown = true;
    this.logger.info(`Starting cooldown for ${duration / 1000}s`);
    
    setTimeout(() => {
      this.isCoolingDown = false;
      this.logger.info('Cooldown ended');
      this.emit('cooldown_ended');
    }, duration);
  }

  onMessageSent(): void {
    this.health.messagestoday++;
  }

  getHealth(): AccountHealth {
    return { ...this.health };
  }

  getHealthScore(): number {
    return this.health.score;
  }

  isHealthy(): boolean {
    return this.health.score >= 70 && !this.health.isSuspicious && !this.health.isRestricted;
  }

  resetHealth(): void {
    this.health = {
      score: 100,
      warnings: 0,
      checkpoints: 0,
      lastCheckpoint: null,
      requestsToday: 0,
      messagestoday: 0,
      lastRequest: 0,
      isSuspicious: false,
      isRestricted: false
    };
    this.logger.info('Account health reset');
  }

  setRestricted(restricted: boolean): void {
    this.health.isRestricted = restricted;
    if (restricted) {
      this.logger.error('Account marked as restricted');
    } else {
      this.logger.info('Account restriction lifted');
    }
  }

  destroy(): void {
    if (this.fingerprintRotationInterval) {
      clearInterval(this.fingerprintRotationInterval);
    }
    this.removeAllListeners();
    this.logger.info('Anti-ban manager destroyed');
  }
}
