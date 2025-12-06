import { EventEmitter } from 'eventemitter3';
import { Logger } from './Logger';
import { randomString } from '../utils/helpers';
import * as crypto from 'crypto';

export interface BrowserFingerprint {
  userAgent: string;
  platform: string;
  language: string;
  languages: string[];
  screenWidth: number;
  screenHeight: number;
  availWidth: number;
  availHeight: number;
  colorDepth: number;
  pixelRatio: number;
  timezone: string;
  timezoneOffset: number;
  hardwareConcurrency: number;
  deviceMemory: number;
  maxTouchPoints: number;
  webglVendor: string;
  webglRenderer: string;
  webglVersion: string;
  canvasHash: string;
  audioHash: string;
  fontsHash: string;
  pluginsHash: string;
  doNotTrack: string | null;
  cookieEnabled: boolean;
  productSub: string;
  vendorSub: string;
  vendor: string;
  appCodeName: string;
  appName: string;
  appVersion: string;
  oscpu?: string;
  buildID?: string;
  connection?: ConnectionInfo;
  battery?: BatteryInfo;
}

export interface ConnectionInfo {
  effectiveType: '4g' | '3g' | '2g' | 'slow-2g';
  downlink: number;
  rtt: number;
  saveData: boolean;
}

export interface BatteryInfo {
  charging: boolean;
  chargingTime: number;
  dischargingTime: number;
  level: number;
}

export interface MobileProfile {
  deviceName: string;
  userAgent: string;
  screenWidth: number;
  screenHeight: number;
  pixelRatio: number;
  platform: string;
  maxTouchPoints: number;
  isMobile: boolean;
  isTablet: boolean;
}

export interface AJAXHiddenFields {
  fb_dtsg: string;
  jazoest: string;
  lsd: string;
  spin_r: number;
  spin_b: string;
  spin_t: number;
  hsi: string;
  __rev: string;
  __hs: string;
  __hsi: string;
  __comet_req: string;
  __a: number;
  __user: string;
  __dyn: string;
  __csr: string;
  __req: string;
  __ccg: string;
  __s: string;
  dpr: number;
}

export interface ProfileConfig {
  consistentIdentity: boolean;
  rotationIntervalMs: number;
  preferMobile: boolean;
  region: 'us' | 'eu' | 'asia' | 'auto';
  chromeVersion: string;
  firefoxVersion: string;
  safariVersion: string;
}

const DESKTOP_USER_AGENTS = {
  chrome_windows: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  ],
  chrome_mac: [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  ],
  chrome_linux: [
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  ],
  firefox_windows: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  ],
  firefox_mac: [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:122.0) Gecko/20100101 Firefox/122.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.2; rv:121.0) Gecko/20100101 Firefox/121.0',
  ],
  safari_mac: [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  ],
  edge_windows: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  ],
};

const MOBILE_PROFILES: MobileProfile[] = [
  {
    deviceName: 'iPhone 15 Pro',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
    screenWidth: 393,
    screenHeight: 852,
    pixelRatio: 3,
    platform: 'iPhone',
    maxTouchPoints: 5,
    isMobile: true,
    isTablet: false,
  },
  {
    deviceName: 'iPhone 14',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1.2 Mobile/15E148 Safari/604.1',
    screenWidth: 390,
    screenHeight: 844,
    pixelRatio: 3,
    platform: 'iPhone',
    maxTouchPoints: 5,
    isMobile: true,
    isTablet: false,
  },
  {
    deviceName: 'iPhone 13',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
    screenWidth: 390,
    screenHeight: 844,
    pixelRatio: 3,
    platform: 'iPhone',
    maxTouchPoints: 5,
    isMobile: true,
    isTablet: false,
  },
  {
    deviceName: 'Samsung Galaxy S24',
    userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
    screenWidth: 360,
    screenHeight: 780,
    pixelRatio: 3,
    platform: 'Linux armv8l',
    maxTouchPoints: 5,
    isMobile: true,
    isTablet: false,
  },
  {
    deviceName: 'Samsung Galaxy S23',
    userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    screenWidth: 360,
    screenHeight: 780,
    pixelRatio: 3,
    platform: 'Linux armv8l',
    maxTouchPoints: 5,
    isMobile: true,
    isTablet: false,
  },
  {
    deviceName: 'Google Pixel 8',
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
    screenWidth: 412,
    screenHeight: 915,
    pixelRatio: 2.625,
    platform: 'Linux armv8l',
    maxTouchPoints: 5,
    isMobile: true,
    isTablet: false,
  },
  {
    deviceName: 'iPad Pro 12.9',
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
    screenWidth: 1024,
    screenHeight: 1366,
    pixelRatio: 2,
    platform: 'iPad',
    maxTouchPoints: 5,
    isMobile: false,
    isTablet: true,
  },
  {
    deviceName: 'Samsung Galaxy Tab S9',
    userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-X910) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    screenWidth: 800,
    screenHeight: 1280,
    pixelRatio: 2,
    platform: 'Linux armv8l',
    maxTouchPoints: 5,
    isMobile: false,
    isTablet: true,
  },
];

const SCREEN_RESOLUTIONS = [
  { width: 1920, height: 1080, avail: { width: 1920, height: 1040 } },
  { width: 2560, height: 1440, avail: { width: 2560, height: 1400 } },
  { width: 1366, height: 768, avail: { width: 1366, height: 728 } },
  { width: 1536, height: 864, avail: { width: 1536, height: 824 } },
  { width: 1440, height: 900, avail: { width: 1440, height: 860 } },
  { width: 1680, height: 1050, avail: { width: 1680, height: 1010 } },
  { width: 3840, height: 2160, avail: { width: 3840, height: 2120 } },
  { width: 2560, height: 1600, avail: { width: 2560, height: 1560 } },
];

const WEBGL_CONFIGS = [
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0)', version: 'WebGL 2.0 (OpenGL ES 3.0 Chromium)' },
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0)', version: 'WebGL 2.0 (OpenGL ES 3.0 Chromium)' },
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)', version: 'WebGL 2.0 (OpenGL ES 3.0 Chromium)' },
  { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD Radeon RX 7900 XTX Direct3D11 vs_5_0 ps_5_0)', version: 'WebGL 2.0 (OpenGL ES 3.0 Chromium)' },
  { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD Radeon RX 6800 XT Direct3D11 vs_5_0 ps_5_0)', version: 'WebGL 2.0 (OpenGL ES 3.0 Chromium)' },
  { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel(R) UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0)', version: 'WebGL 2.0 (OpenGL ES 3.0 Chromium)' },
  { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0)', version: 'WebGL 2.0 (OpenGL ES 3.0 Chromium)' },
  { vendor: 'Apple Inc.', renderer: 'Apple M3 Pro', version: 'WebGL 2.0 (OpenGL ES 3.0)' },
  { vendor: 'Apple Inc.', renderer: 'Apple M2 Pro', version: 'WebGL 2.0 (OpenGL ES 3.0)' },
  { vendor: 'Apple Inc.', renderer: 'Apple M1 Max', version: 'WebGL 2.0 (OpenGL ES 3.0)' },
];

const TIMEZONES_BY_REGION = {
  us: [
    { name: 'America/New_York', offset: -300 },
    { name: 'America/Chicago', offset: -360 },
    { name: 'America/Denver', offset: -420 },
    { name: 'America/Los_Angeles', offset: -480 },
    { name: 'America/Phoenix', offset: -420 },
  ],
  eu: [
    { name: 'Europe/London', offset: 0 },
    { name: 'Europe/Paris', offset: 60 },
    { name: 'Europe/Berlin', offset: 60 },
    { name: 'Europe/Rome', offset: 60 },
    { name: 'Europe/Madrid', offset: 60 },
    { name: 'Europe/Amsterdam', offset: 60 },
  ],
  asia: [
    { name: 'Asia/Tokyo', offset: 540 },
    { name: 'Asia/Seoul', offset: 540 },
    { name: 'Asia/Shanghai', offset: 480 },
    { name: 'Asia/Singapore', offset: 480 },
    { name: 'Asia/Manila', offset: 480 },
    { name: 'Asia/Bangkok', offset: 420 },
    { name: 'Asia/Jakarta', offset: 420 },
  ],
};

const LANGUAGES_BY_REGION = {
  us: ['en-US', 'en'],
  eu: ['en-GB', 'en', 'de', 'fr', 'es', 'it', 'nl', 'pt'],
  asia: ['en-US', 'en', 'ja', 'ko', 'zh-CN', 'zh-TW', 'th', 'vi', 'id', 'fil'],
};

export class BrowserProfileService extends EventEmitter {
  private logger: Logger;
  private config: ProfileConfig;
  private currentFingerprint: BrowserFingerprint | null = null;
  private currentMobileProfile: MobileProfile | null = null;
  private cachedAJAXFields: Partial<AJAXHiddenFields> = {};
  private rotationTimer?: NodeJS.Timeout;
  private identitySeed: string;
  private requestCounter = 0;

  constructor(config?: Partial<ProfileConfig>) {
    super();
    this.logger = new Logger('BROWSER-PROFILE');
    
    this.config = {
      consistentIdentity: true,
      rotationIntervalMs: 30 * 60 * 1000,
      preferMobile: false,
      region: 'auto',
      chromeVersion: '121',
      firefoxVersion: '122',
      safariVersion: '17.2',
      ...config,
    };

    this.identitySeed = randomString(32);
    this.initializeProfile();
    this.startRotation();

    this.logger.success('Browser profile service initialized');
  }

  private initializeProfile(): void {
    if (this.config.preferMobile) {
      this.currentMobileProfile = this.generateMobileProfile();
      this.currentFingerprint = this.mobileToFingerprint(this.currentMobileProfile);
    } else {
      this.currentFingerprint = this.generateDesktopFingerprint();
    }
  }

  private startRotation(): void {
    if (this.config.rotationIntervalMs <= 0) return;

    this.rotationTimer = setInterval(() => {
      this.rotateProfile();
    }, this.config.rotationIntervalMs);
  }

  private getRegion(): 'us' | 'eu' | 'asia' {
    if (this.config.region !== 'auto') return this.config.region;
    const regions: Array<'us' | 'eu' | 'asia'> = ['us', 'eu', 'asia'];
    return regions[Math.floor(this.seededRandom() * regions.length)];
  }

  private seededRandom(): number {
    if (!this.config.consistentIdentity) {
      return Math.random();
    }
    const hash = crypto.createHash('sha256').update(this.identitySeed + this.requestCounter.toString()).digest('hex');
    return parseInt(hash.substring(0, 8), 16) / 0xffffffff;
  }

  private pickRandom<T>(arr: T[]): T {
    return arr[Math.floor(this.seededRandom() * arr.length)];
  }

  generateDesktopFingerprint(): BrowserFingerprint {
    const region = this.getRegion();
    const timezone = this.pickRandom(TIMEZONES_BY_REGION[region]);
    const screen = this.pickRandom(SCREEN_RESOLUTIONS);
    const webgl = this.pickRandom(WEBGL_CONFIGS);
    const languages = LANGUAGES_BY_REGION[region];
    const primaryLang = languages[0];
    
    const browserType = this.pickRandom(['chrome_windows', 'chrome_mac', 'chrome_linux', 'firefox_windows', 'safari_mac', 'edge_windows']);
    const userAgents = DESKTOP_USER_AGENTS[browserType as keyof typeof DESKTOP_USER_AGENTS];
    const userAgent = this.pickRandom(userAgents);
    
    let platform = 'Win32';
    let vendor = 'Google Inc.';
    if (browserType.includes('mac') || browserType.includes('safari')) {
      platform = 'MacIntel';
      if (browserType.includes('safari')) vendor = 'Apple Computer, Inc.';
    } else if (browserType.includes('linux')) {
      platform = 'Linux x86_64';
    }

    const fingerprint: BrowserFingerprint = {
      userAgent,
      platform,
      language: primaryLang,
      languages: languages.slice(0, 3),
      screenWidth: screen.width,
      screenHeight: screen.height,
      availWidth: screen.avail.width,
      availHeight: screen.avail.height,
      colorDepth: this.pickRandom([24, 32]),
      pixelRatio: this.pickRandom([1, 1.25, 1.5, 2]),
      timezone: timezone.name,
      timezoneOffset: timezone.offset,
      hardwareConcurrency: this.pickRandom([4, 6, 8, 12, 16]),
      deviceMemory: this.pickRandom([4, 8, 16, 32]),
      maxTouchPoints: 0,
      webglVendor: webgl.vendor,
      webglRenderer: webgl.renderer,
      webglVersion: webgl.version,
      canvasHash: this.generateCanvasHash(),
      audioHash: this.generateAudioHash(),
      fontsHash: this.generateFontsHash(),
      pluginsHash: this.generatePluginsHash(),
      doNotTrack: this.pickRandom([null, '1', 'unspecified']),
      cookieEnabled: true,
      productSub: '20030107',
      vendorSub: '',
      vendor,
      appCodeName: 'Mozilla',
      appName: 'Netscape',
      appVersion: userAgent.substring(userAgent.indexOf('(') - 1),
      connection: this.generateConnectionInfo(),
      battery: this.generateBatteryInfo(),
    };

    if (browserType.includes('firefox')) {
      fingerprint.oscpu = platform === 'Win32' ? 'Windows NT 10.0; Win64; x64' : 
                          platform === 'MacIntel' ? 'Intel Mac OS X 10.15' : 'Linux x86_64';
      fingerprint.buildID = '20240101000000';
    }

    this.logger.debug(`Generated desktop fingerprint: ${browserType}`);
    return fingerprint;
  }

  generateMobileProfile(): MobileProfile {
    const profile = this.pickRandom(MOBILE_PROFILES);
    this.logger.debug(`Generated mobile profile: ${profile.deviceName}`);
    return { ...profile };
  }

  private mobileToFingerprint(mobile: MobileProfile): BrowserFingerprint {
    const region = this.getRegion();
    const timezone = this.pickRandom(TIMEZONES_BY_REGION[region]);
    const languages = LANGUAGES_BY_REGION[region];

    return {
      userAgent: mobile.userAgent,
      platform: mobile.platform,
      language: languages[0],
      languages: languages.slice(0, 2),
      screenWidth: mobile.screenWidth,
      screenHeight: mobile.screenHeight,
      availWidth: mobile.screenWidth,
      availHeight: mobile.screenHeight - 80,
      colorDepth: 32,
      pixelRatio: mobile.pixelRatio,
      timezone: timezone.name,
      timezoneOffset: timezone.offset,
      hardwareConcurrency: this.pickRandom([4, 6, 8]),
      deviceMemory: this.pickRandom([4, 6, 8]),
      maxTouchPoints: mobile.maxTouchPoints,
      webglVendor: mobile.platform.includes('iPhone') || mobile.platform.includes('iPad') 
        ? 'Apple Inc.' 
        : 'Qualcomm',
      webglRenderer: mobile.platform.includes('iPhone') || mobile.platform.includes('iPad')
        ? 'Apple GPU'
        : 'Adreno (TM) 740',
      webglVersion: 'WebGL 2.0',
      canvasHash: this.generateCanvasHash(),
      audioHash: this.generateAudioHash(),
      fontsHash: this.generateFontsHash(),
      pluginsHash: '',
      doNotTrack: null,
      cookieEnabled: true,
      productSub: '20030107',
      vendorSub: '',
      vendor: mobile.platform.includes('iPhone') || mobile.platform.includes('iPad') 
        ? 'Apple Computer, Inc.' 
        : 'Google Inc.',
      appCodeName: 'Mozilla',
      appName: 'Netscape',
      appVersion: mobile.userAgent.substring(8),
      connection: this.generateConnectionInfo(),
      battery: this.generateBatteryInfo(),
    };
  }

  private generateCanvasHash(): string {
    const data = this.identitySeed + 'canvas' + this.seededRandom().toString();
    return crypto.createHash('md5').update(data).digest('hex').substring(0, 16);
  }

  private generateAudioHash(): string {
    const data = this.identitySeed + 'audio' + this.seededRandom().toString();
    return crypto.createHash('md5').update(data).digest('hex').substring(0, 16);
  }

  private generateFontsHash(): string {
    const data = this.identitySeed + 'fonts' + this.seededRandom().toString();
    return crypto.createHash('md5').update(data).digest('hex').substring(0, 16);
  }

  private generatePluginsHash(): string {
    const data = this.identitySeed + 'plugins' + this.seededRandom().toString();
    return crypto.createHash('md5').update(data).digest('hex').substring(0, 16);
  }

  private generateConnectionInfo(): ConnectionInfo {
    return {
      effectiveType: this.pickRandom(['4g', '4g', '4g', '3g']),
      downlink: this.pickRandom([10, 15, 20, 25, 50, 100]),
      rtt: this.pickRandom([50, 75, 100, 150]),
      saveData: false,
    };
  }

  private generateBatteryInfo(): BatteryInfo {
    return {
      charging: this.seededRandom() > 0.3,
      chargingTime: this.seededRandom() > 0.5 ? Infinity : Math.floor(this.seededRandom() * 7200),
      dischargingTime: Math.floor(this.seededRandom() * 36000) + 3600,
      level: 0.5 + this.seededRandom() * 0.5,
    };
  }

  extractLsdFromHTML(html: string): string | null {
    const patterns = [
      /\["LSD",\[\],\{"token":"([^"]+)"\}/,
      /"lsd":"([^"]+)"/,
      /name="lsd" value="([^"]+)"/,
      /\["DTSGInitialData",\[\],\{"token":"([^"]+)"/,
      /"lsd"\s*:\s*"([^"]+)"/,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        this.cachedAJAXFields.lsd = match[1];
        this.logger.debug('Extracted LSD token');
        return match[1];
      }
    }
    return null;
  }

  extractJazoestFromHTML(html: string): string | null {
    const patterns = [
      /name="jazoest" value="(\d+)"/,
      /"jazoest":"(\d+)"/,
      /jazoest=(\d+)/,
      /\["Jazoest",\[\],\{"value":"(\d+)"\}/,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        this.cachedAJAXFields.jazoest = match[1];
        this.logger.debug('Extracted jazoest token');
        return match[1];
      }
    }
    return null;
  }

  extractFbDtsgFromHTML(html: string): string | null {
    const patterns = [
      /\["DTSGInitData",\[\],\{"token":"([^"]+)"/,
      /"DTSGInitialData",\[\],\{"token":"([^"]+)"/,
      /name="fb_dtsg" value="([^"]+)"/,
      /"fb_dtsg":"([^"]+)"/,
      /fb_dtsg\\?":\\?"([^"\\]+)/,
      /"dtsg":\{"token":"([^"]+)"/,
      /\["DTSG",\[\],\{"token":"([^"]+)"\}/,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        this.cachedAJAXFields.fb_dtsg = match[1];
        this.logger.debug('Extracted fb_dtsg token');
        return match[1];
      }
    }
    return null;
  }

  extractSpinParams(html: string): { spin_r: number; spin_b: string; spin_t: number } | null {
    try {
      const spinRMatch = html.match(/"__spin_r":(\d+)/);
      const spinBMatch = html.match(/"__spin_b":"([^"]+)"/);
      const spinTMatch = html.match(/"__spin_t":(\d+)/);

      if (spinRMatch && spinBMatch && spinTMatch) {
        const result = {
          spin_r: parseInt(spinRMatch[1], 10),
          spin_b: spinBMatch[1],
          spin_t: parseInt(spinTMatch[1], 10),
        };
        this.cachedAJAXFields.spin_r = result.spin_r;
        this.cachedAJAXFields.spin_b = result.spin_b;
        this.cachedAJAXFields.spin_t = result.spin_t;
        this.logger.debug('Extracted spin params');
        return result;
      }
    } catch (error) {
      this.logger.debug('Failed to extract spin params');
    }
    return null;
  }

  extractHSIParams(html: string): { hsi: string; __hs: string; __hsi: string } | null {
    try {
      const hsiMatch = html.match(/"hsi":"([^"]+)"/);
      const hsMatch = html.match(/"__hs":"([^"]+)"/);

      if (hsiMatch) {
        const result = {
          hsi: hsiMatch[1],
          __hs: hsMatch?.[1] || '',
          __hsi: hsiMatch[1],
        };
        this.cachedAJAXFields.hsi = result.hsi;
        this.cachedAJAXFields.__hs = result.__hs;
        this.cachedAJAXFields.__hsi = result.__hsi;
        this.logger.debug('Extracted HSI params');
        return result;
      }
    } catch (error) {
      this.logger.debug('Failed to extract HSI params');
    }
    return null;
  }

  extractRevision(html: string): string | null {
    const patterns = [
      /"__rev":(\d+)/,
      /"revision":(\d+)/,
      /revision=(\d+)/,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        this.cachedAJAXFields.__rev = match[1];
        this.logger.debug('Extracted revision');
        return match[1];
      }
    }
    return null;
  }

  extractAllAJAXFields(html: string): Partial<AJAXHiddenFields> {
    const fields: Partial<AJAXHiddenFields> = {};

    const lsd = this.extractLsdFromHTML(html);
    if (lsd) fields.lsd = lsd;

    const jazoest = this.extractJazoestFromHTML(html);
    if (jazoest) fields.jazoest = jazoest;

    const fbDtsg = this.extractFbDtsgFromHTML(html);
    if (fbDtsg) fields.fb_dtsg = fbDtsg;

    const spinParams = this.extractSpinParams(html);
    if (spinParams) {
      fields.spin_r = spinParams.spin_r;
      fields.spin_b = spinParams.spin_b;
      fields.spin_t = spinParams.spin_t;
    }

    const hsiParams = this.extractHSIParams(html);
    if (hsiParams) {
      fields.hsi = hsiParams.hsi;
      fields.__hs = hsiParams.__hs;
      fields.__hsi = hsiParams.__hsi;
    }

    const rev = this.extractRevision(html);
    if (rev) fields.__rev = rev;

    const userMatch = html.match(/"USER_ID":"(\d+)"/);
    if (userMatch) fields.__user = userMatch[1];

    const csrMatch = html.match(/"__csr":"([^"]+)"/);
    if (csrMatch) fields.__csr = csrMatch[1];

    const dynMatch = html.match(/"__dyn":"([^"]+)"/);
    if (dynMatch) fields.__dyn = dynMatch[1];

    const ccgMatch = html.match(/"__ccg":"([^"]+)"/);
    if (ccgMatch) fields.__ccg = ccgMatch[1];

    Object.assign(this.cachedAJAXFields, fields);
    
    const extractedCount = Object.keys(fields).length;
    this.logger.info(`Extracted ${extractedCount} AJAX hidden fields`);
    
    return fields;
  }

  generateJazoest(fbDtsg: string): string {
    let sum = 0;
    for (let i = 0; i < fbDtsg.length; i++) {
      sum += fbDtsg.charCodeAt(i);
    }
    return '2' + sum.toString();
  }

  getFingerprint(): BrowserFingerprint {
    if (!this.currentFingerprint) {
      this.initializeProfile();
    }
    return { ...this.currentFingerprint! };
  }

  getMobileProfile(): MobileProfile | null {
    return this.currentMobileProfile ? { ...this.currentMobileProfile } : null;
  }

  getUserAgent(): string {
    return this.currentFingerprint?.userAgent || DESKTOP_USER_AGENTS.chrome_windows[0];
  }

  getCachedAJAXFields(): Partial<AJAXHiddenFields> {
    return { ...this.cachedAJAXFields };
  }

  buildRequestHeaders(options?: { isMobile?: boolean; isXHR?: boolean; referer?: string }): Record<string, string> {
    const fp = this.getFingerprint();
    
    const headers: Record<string, string> = {
      'User-Agent': fp.userAgent,
      'Accept': options?.isXHR 
        ? 'application/json, text/plain, */*'
        : 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': fp.languages.join(',') + ';q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
    };

    if (fp.platform === 'Win32' || fp.platform === 'MacIntel' || fp.platform === 'Linux x86_64') {
      headers['Sec-Ch-Ua'] = `"Not_A Brand";v="8", "Chromium";v="${this.config.chromeVersion}", "Google Chrome";v="${this.config.chromeVersion}"`;
      headers['Sec-Ch-Ua-Mobile'] = '?0';
      headers['Sec-Ch-Ua-Platform'] = `"${fp.platform === 'Win32' ? 'Windows' : fp.platform === 'MacIntel' ? 'macOS' : 'Linux'}"`;
      headers['Sec-Fetch-Dest'] = options?.isXHR ? 'empty' : 'document';
      headers['Sec-Fetch-Mode'] = options?.isXHR ? 'cors' : 'navigate';
      headers['Sec-Fetch-Site'] = 'same-origin';
      headers['Sec-Fetch-User'] = '?1';
    }

    if (options?.isMobile && this.currentMobileProfile) {
      headers['User-Agent'] = this.currentMobileProfile.userAgent;
      headers['Sec-Ch-Ua-Mobile'] = '?1';
    }

    if (options?.referer) {
      headers['Referer'] = options.referer;
    }

    headers['Upgrade-Insecure-Requests'] = '1';
    headers['X-Requested-With'] = options?.isXHR ? 'XMLHttpRequest' : '';

    return headers;
  }

  buildFormData(additionalFields?: Record<string, any>): Record<string, any> {
    const cached = this.cachedAJAXFields;
    this.requestCounter++;

    const form: Record<string, any> = {
      __a: 1,
      __req: this.requestCounter.toString(36),
      __s: randomString(6) + ':' + randomString(6),
      dpr: this.currentFingerprint?.pixelRatio || 1,
    };

    if (cached.fb_dtsg) form.fb_dtsg = cached.fb_dtsg;
    if (cached.jazoest) form.jazoest = cached.jazoest;
    if (cached.lsd) form.lsd = cached.lsd;
    if (cached.__user) form.__user = cached.__user;
    if (cached.__rev) form.__rev = cached.__rev;
    if (cached.__hs) form.__hs = cached.__hs;
    if (cached.__hsi) form.__hsi = cached.__hsi;
    if (cached.__dyn) form.__dyn = cached.__dyn;
    if (cached.__csr) form.__csr = cached.__csr;
    if (cached.__ccg) form.__ccg = cached.__ccg;
    if (cached.spin_r) form.__spin_r = cached.spin_r;
    if (cached.spin_b) form.__spin_b = cached.spin_b;
    if (cached.spin_t) form.__spin_t = cached.spin_t;

    if (additionalFields) {
      Object.assign(form, additionalFields);
    }

    return form;
  }

  rotateProfile(): void {
    if (!this.config.consistentIdentity) {
      this.identitySeed = randomString(32);
    }
    this.requestCounter++;

    if (this.config.preferMobile) {
      this.currentMobileProfile = this.generateMobileProfile();
      this.currentFingerprint = this.mobileToFingerprint(this.currentMobileProfile);
    } else {
      this.currentFingerprint = this.generateDesktopFingerprint();
    }

    this.logger.info('Browser profile rotated');
    this.emit('profile_rotated', this.currentFingerprint);
  }

  switchToMobile(): void {
    this.config.preferMobile = true;
    this.currentMobileProfile = this.generateMobileProfile();
    this.currentFingerprint = this.mobileToFingerprint(this.currentMobileProfile);
    this.logger.info(`Switched to mobile: ${this.currentMobileProfile.deviceName}`);
    this.emit('switched_to_mobile', this.currentMobileProfile);
  }

  switchToDesktop(): void {
    this.config.preferMobile = false;
    this.currentMobileProfile = null;
    this.currentFingerprint = this.generateDesktopFingerprint();
    this.logger.info('Switched to desktop');
    this.emit('switched_to_desktop', this.currentFingerprint);
  }

  setRegion(region: 'us' | 'eu' | 'asia' | 'auto'): void {
    this.config.region = region;
    this.rotateProfile();
    this.logger.info(`Region set to: ${region}`);
  }

  setAJAXField(key: keyof AJAXHiddenFields, value: any): void {
    (this.cachedAJAXFields as any)[key] = value;
  }

  clearCachedFields(): void {
    this.cachedAJAXFields = {};
    this.logger.debug('Cached AJAX fields cleared');
  }

  getIdentityHash(): string {
    return crypto.createHash('sha256').update(this.identitySeed).digest('hex').substring(0, 16);
  }

  isMobileMode(): boolean {
    return this.config.preferMobile && this.currentMobileProfile !== null;
  }

  destroy(): void {
    if (this.rotationTimer) {
      clearInterval(this.rotationTimer);
    }
    this.removeAllListeners();
    this.logger.info('Browser profile service destroyed');
  }
}
