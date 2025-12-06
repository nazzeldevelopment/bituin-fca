import { Router, Request, Response } from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { EventEmitter } from 'eventemitter3';
import { Logger } from '../core/Logger';
import { APIServer } from './APIServer';
import { WebhooksManager } from './WebhooksManager';
import * as http from 'http';

export interface DashboardConfig {
  refreshInterval?: number;
  maxHistoryPoints?: number;
  enableWebSocket?: boolean;
  wsPort?: number;
}

export interface SystemMetrics {
  uptime: number;
  memoryUsage: NodeJS.MemoryUsage;
  cpuUsage: number;
  timestamp: number;
}

export interface DashboardMetrics {
  api: {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    averageResponseTime: number;
    requestsPerMinute: number;
  };
  webhooks: {
    totalDeliveries: number;
    successfulDeliveries: number;
    failedDeliveries: number;
    pendingDeliveries: number;
  };
  bots: {
    totalBots: number;
    activeBots: number;
  };
  system: SystemMetrics;
}

export interface MetricsHistory {
  timestamps: number[];
  requests: number[];
  responseTime: number[];
  errors: number[];
}

export class MonitoringDashboard extends EventEmitter {
  private logger: Logger;
  private config: DashboardConfig;
  private apiServer: APIServer | null = null;
  private webhooksManager: WebhooksManager | null = null;
  private wss: WebSocketServer | null = null;
  private wsClients: Set<WebSocket> = new Set();
  private metricsHistory: MetricsHistory;
  private broadcastInterval: NodeJS.Timeout | null = null;
  private lastCpuUsage = process.cpuUsage();
  private lastCpuTime = Date.now();

  constructor(config?: DashboardConfig) {
    super();
    this.logger = new Logger('DASHBOARD');
    
    this.config = {
      refreshInterval: 5000,
      maxHistoryPoints: 100,
      enableWebSocket: true,
      wsPort: 3002,
      ...config,
    };

    this.metricsHistory = {
      timestamps: [],
      requests: [],
      responseTime: [],
      errors: [],
    };

    this.logger.success('Monitoring dashboard initialized');
  }

  setAPIServer(server: APIServer): void {
    this.apiServer = server;
  }

  setWebhooksManager(manager: WebhooksManager): void {
    this.webhooksManager = manager;
  }

  getRouter(): Router {
    const router = Router();

    router.get('/dashboard', this.serveDashboard.bind(this));
    router.get('/dashboard/metrics', this.getMetrics.bind(this));
    router.get('/dashboard/history', this.getHistory.bind(this));
    router.get('/dashboard/bots', this.getBots.bind(this));
    router.get('/dashboard/webhooks', this.getWebhooks.bind(this));
    router.post('/dashboard/webhooks/:id/test', this.testWebhook.bind(this));
    router.post('/dashboard/webhooks/:id/toggle', this.toggleWebhook.bind(this));
    router.get('/dashboard/health', this.getHealthStatus.bind(this));

    return router;
  }

  startWebSocket(server: http.Server): void {
    if (!this.config.enableWebSocket) return;

    this.wss = new WebSocketServer({ server, path: '/ws/dashboard' });

    this.wss.on('connection', (ws: WebSocket) => {
      this.wsClients.add(ws);
      this.logger.debug(`Dashboard WebSocket client connected (${this.wsClients.size} total)`);

      ws.send(JSON.stringify({
        type: 'connected',
        data: { timestamp: Date.now() },
      }));

      ws.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleWsMessage(ws, msg);
        } catch (e) {
          this.logger.warn('Invalid WebSocket message');
        }
      });

      ws.on('close', () => {
        this.wsClients.delete(ws);
        this.logger.debug(`Dashboard WebSocket client disconnected (${this.wsClients.size} remaining)`);
      });

      ws.on('error', (err) => {
        this.logger.error('WebSocket error:', err.message);
        this.wsClients.delete(ws);
      });
    });

    this.startBroadcast();
    this.logger.success('Dashboard WebSocket server started');
  }

  private handleWsMessage(ws: WebSocket, msg: any): void {
    switch (msg.type) {
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        break;
      case 'subscribe':
        break;
      case 'getMetrics':
        ws.send(JSON.stringify({ type: 'metrics', data: this.collectMetrics() }));
        break;
    }
  }

  private startBroadcast(): void {
    this.broadcastInterval = setInterval(() => {
      this.broadcastMetrics();
    }, this.config.refreshInterval);
  }

  private broadcastMetrics(): void {
    if (this.wsClients.size === 0) return;

    const metrics = this.collectMetrics();
    this.recordHistory(metrics);

    const message = JSON.stringify({
      type: 'metrics',
      data: metrics,
    });

    for (const client of this.wsClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  private collectMetrics(): DashboardMetrics {
    const apiMetrics = this.apiServer ? (this.apiServer as any).metrics : {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      requestsPerMinute: 0,
    };

    const webhookStats = this.webhooksManager?.getStats() || {
      totalDeliveries: 0,
      successfulDeliveries: 0,
      failedDeliveries: 0,
      pendingDeliveries: 0,
    };

    const botInstances = this.apiServer ? (this.apiServer as any).botInstances : new Map();
    const activeBots = Array.from(botInstances.values()).filter((b: any) => b).length;

    return {
      api: {
        totalRequests: apiMetrics.totalRequests || 0,
        successfulRequests: apiMetrics.successfulRequests || 0,
        failedRequests: apiMetrics.failedRequests || 0,
        averageResponseTime: Math.round(apiMetrics.averageResponseTime || 0),
        requestsPerMinute: Math.round((apiMetrics.requestsPerMinute || 0) * 100) / 100,
      },
      webhooks: {
        totalDeliveries: webhookStats.totalDeliveries,
        successfulDeliveries: webhookStats.successfulDeliveries,
        failedDeliveries: webhookStats.failedDeliveries,
        pendingDeliveries: webhookStats.pendingDeliveries,
      },
      bots: {
        totalBots: botInstances.size,
        activeBots,
      },
      system: this.getSystemMetrics(),
    };
  }

  private getSystemMetrics(): SystemMetrics {
    const now = Date.now();
    const cpuUsage = process.cpuUsage(this.lastCpuUsage);
    const elapsedMs = now - this.lastCpuTime;
    
    const cpuPercent = elapsedMs > 0
      ? ((cpuUsage.user + cpuUsage.system) / 1000 / elapsedMs) * 100
      : 0;

    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuTime = now;

    return {
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      cpuUsage: Math.round(cpuPercent * 100) / 100,
      timestamp: now,
    };
  }

  private recordHistory(metrics: DashboardMetrics): void {
    const maxPoints = this.config.maxHistoryPoints || 100;

    this.metricsHistory.timestamps.push(Date.now());
    this.metricsHistory.requests.push(metrics.api.totalRequests);
    this.metricsHistory.responseTime.push(metrics.api.averageResponseTime);
    this.metricsHistory.errors.push(metrics.api.failedRequests);

    if (this.metricsHistory.timestamps.length > maxPoints) {
      this.metricsHistory.timestamps.shift();
      this.metricsHistory.requests.shift();
      this.metricsHistory.responseTime.shift();
      this.metricsHistory.errors.shift();
    }
  }

  private async serveDashboard(req: Request, res: Response): Promise<void> {
    const wsProtocol = req.secure ? 'wss' : 'ws';
    const wsHost = req.headers.host || 'localhost:3001';
    
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(this.generateDashboardHTML(wsProtocol, wsHost));
  }

  private async getMetrics(req: Request, res: Response): Promise<void> {
    res.json({
      success: true,
      data: this.collectMetrics(),
      timestamp: Date.now(),
    });
  }

  private async getHistory(req: Request, res: Response): Promise<void> {
    res.json({
      success: true,
      data: this.metricsHistory,
      timestamp: Date.now(),
    });
  }

  private async getBots(req: Request, res: Response): Promise<void> {
    const botInstances = this.apiServer ? (this.apiServer as any).botInstances : new Map();
    
    const bots = Array.from(botInstances.entries()).map(([id, bot]: [string, any]) => ({
      id,
      status: bot ? 'active' : 'inactive',
      health: bot?.getHealth?.() || null,
    }));

    res.json({
      success: true,
      data: { bots, count: bots.length },
      timestamp: Date.now(),
    });
  }

  private async getWebhooks(req: Request, res: Response): Promise<void> {
    const webhooks = this.webhooksManager?.listWebhooks() || [];
    
    const webhookData = webhooks.map((wh) => ({
      id: wh.id,
      url: wh.url,
      events: wh.events,
      enabled: wh.enabled,
      stats: this.webhooksManager?.getWebhookStats(wh.id),
      createdAt: wh.createdAt,
      updatedAt: wh.updatedAt,
    }));

    res.json({
      success: true,
      data: { webhooks: webhookData, count: webhookData.length },
      timestamp: Date.now(),
    });
  }

  private async testWebhook(req: Request, res: Response): Promise<void> {
    const { id } = req.params;

    if (!this.webhooksManager) {
      res.status(503).json({ success: false, error: 'Webhooks manager not available' });
      return;
    }

    try {
      const delivery = await this.webhooksManager.testWebhook(id);
      res.json({
        success: true,
        data: delivery,
        timestamp: Date.now(),
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message,
        timestamp: Date.now(),
      });
    }
  }

  private async toggleWebhook(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const { enabled } = req.body;

    if (!this.webhooksManager) {
      res.status(503).json({ success: false, error: 'Webhooks manager not available' });
      return;
    }

    const webhook = this.webhooksManager.getWebhook(id);
    if (!webhook) {
      res.status(404).json({ success: false, error: 'Webhook not found' });
      return;
    }

    const result = enabled
      ? this.webhooksManager.enableWebhook(id)
      : this.webhooksManager.disableWebhook(id);

    res.json({
      success: result,
      data: { id, enabled },
      timestamp: Date.now(),
    });
  }

  private async getHealthStatus(req: Request, res: Response): Promise<void> {
    const metrics = this.collectMetrics();
    const errorRate = metrics.api.totalRequests > 0
      ? (metrics.api.failedRequests / metrics.api.totalRequests) * 100
      : 0;

    const memoryPercent = (metrics.system.memoryUsage.heapUsed / metrics.system.memoryUsage.heapTotal) * 100;

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    const issues: string[] = [];

    if (errorRate > 10) {
      status = 'degraded';
      issues.push(`High error rate: ${errorRate.toFixed(1)}%`);
    }
    if (errorRate > 25) {
      status = 'unhealthy';
    }

    if (memoryPercent > 85) {
      status = status === 'unhealthy' ? 'unhealthy' : 'degraded';
      issues.push(`High memory usage: ${memoryPercent.toFixed(1)}%`);
    }
    if (memoryPercent > 95) {
      status = 'unhealthy';
    }

    if (metrics.api.averageResponseTime > 5000) {
      status = status === 'unhealthy' ? 'unhealthy' : 'degraded';
      issues.push(`Slow response time: ${metrics.api.averageResponseTime}ms`);
    }

    res.json({
      success: true,
      data: {
        status,
        issues,
        metrics: {
          errorRate: Math.round(errorRate * 100) / 100,
          memoryPercent: Math.round(memoryPercent * 100) / 100,
          responseTime: metrics.api.averageResponseTime,
          uptime: metrics.system.uptime,
        },
      },
      timestamp: Date.now(),
    });
  }

  private generateDashboardHTML(wsProtocol: string, wsHost: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bituin-FCA Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: #e0e0e0;
      min-height: 100vh;
      padding: 20px;
    }
    .header {
      text-align: center;
      margin-bottom: 30px;
    }
    .header h1 {
      font-size: 2.5rem;
      background: linear-gradient(90deg, #00d9ff, #00ff88);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 5px;
    }
    .header .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 5px 15px;
      border-radius: 20px;
      font-size: 0.9rem;
    }
    .status.healthy { background: rgba(0, 255, 136, 0.2); color: #00ff88; }
    .status.degraded { background: rgba(255, 193, 7, 0.2); color: #ffc107; }
    .status.unhealthy { background: rgba(255, 82, 82, 0.2); color: #ff5252; }
    .status-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      animation: pulse 2s infinite;
    }
    .healthy .status-dot { background: #00ff88; }
    .degraded .status-dot { background: #ffc107; }
    .unhealthy .status-dot { background: #ff5252; }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 20px;
      max-width: 1400px;
      margin: 0 auto;
    }
    .card {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 15px;
      padding: 20px;
      backdrop-filter: blur(10px);
    }
    .card h2 {
      font-size: 1.1rem;
      color: #888;
      margin-bottom: 15px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .card h2 .icon {
      font-size: 1.3rem;
    }
    .metric {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }
    .metric:last-child { border-bottom: none; }
    .metric-label { color: #aaa; }
    .metric-value {
      font-size: 1.4rem;
      font-weight: 600;
      color: #fff;
    }
    .metric-value.success { color: #00ff88; }
    .metric-value.error { color: #ff5252; }
    .metric-value.warning { color: #ffc107; }
    .metric-value.info { color: #00d9ff; }
    .progress-bar {
      width: 100%;
      height: 8px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 4px;
      overflow: hidden;
      margin-top: 5px;
    }
    .progress-fill {
      height: 100%;
      transition: width 0.3s ease;
    }
    .progress-fill.green { background: linear-gradient(90deg, #00ff88, #00d9ff); }
    .progress-fill.yellow { background: linear-gradient(90deg, #ffc107, #ff9800); }
    .progress-fill.red { background: linear-gradient(90deg, #ff5252, #ff1744); }
    .table {
      width: 100%;
      border-collapse: collapse;
    }
    .table th, .table td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }
    .table th {
      color: #888;
      font-weight: 500;
      font-size: 0.85rem;
    }
    .badge {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 12px;
      font-size: 0.8rem;
    }
    .badge.active { background: rgba(0, 255, 136, 0.2); color: #00ff88; }
    .badge.inactive { background: rgba(255, 82, 82, 0.2); color: #ff5252; }
    .badge.enabled { background: rgba(0, 217, 255, 0.2); color: #00d9ff; }
    .badge.disabled { background: rgba(136, 136, 136, 0.2); color: #888; }
    .btn {
      padding: 6px 12px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.85rem;
      transition: all 0.2s;
    }
    .btn-primary {
      background: #00d9ff;
      color: #1a1a2e;
    }
    .btn-primary:hover { background: #00b8d4; }
    .btn-danger {
      background: #ff5252;
      color: #fff;
    }
    .btn-danger:hover { background: #ff1744; }
    .btn-sm {
      padding: 4px 8px;
      font-size: 0.75rem;
    }
    .chart-container {
      height: 200px;
      position: relative;
    }
    .chart-placeholder {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #666;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 8px;
    }
    .ws-status {
      position: fixed;
      bottom: 20px;
      right: 20px;
      padding: 8px 15px;
      border-radius: 20px;
      font-size: 0.8rem;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .ws-status.connected {
      background: rgba(0, 255, 136, 0.2);
      color: #00ff88;
    }
    .ws-status.disconnected {
      background: rgba(255, 82, 82, 0.2);
      color: #ff5252;
    }
    .mini-chart {
      display: flex;
      align-items: flex-end;
      gap: 2px;
      height: 40px;
      margin-top: 10px;
    }
    .mini-chart .bar {
      flex: 1;
      background: linear-gradient(180deg, #00d9ff, #00ff88);
      border-radius: 2px 2px 0 0;
      min-height: 2px;
      transition: height 0.3s ease;
    }
    .uptime-value {
      font-family: monospace;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Bituin-FCA V2 Ultra</h1>
    <div class="status healthy" id="healthStatus">
      <span class="status-dot"></span>
      <span id="healthText">System Healthy</span>
    </div>
  </div>

  <div class="grid">
    <div class="card">
      <h2><span class="icon">&#128200;</span> API Metrics</h2>
      <div class="metric">
        <span class="metric-label">Total Requests</span>
        <span class="metric-value info" id="totalRequests">0</span>
      </div>
      <div class="metric">
        <span class="metric-label">Successful</span>
        <span class="metric-value success" id="successRequests">0</span>
      </div>
      <div class="metric">
        <span class="metric-label">Failed</span>
        <span class="metric-value error" id="failedRequests">0</span>
      </div>
      <div class="metric">
        <span class="metric-label">Avg Response Time</span>
        <span class="metric-value" id="avgResponseTime">0ms</span>
      </div>
      <div class="metric">
        <span class="metric-label">Requests/min</span>
        <span class="metric-value" id="requestsPerMin">0</span>
      </div>
      <div class="mini-chart" id="requestsChart"></div>
    </div>

    <div class="card">
      <h2><span class="icon">&#128268;</span> Webhooks</h2>
      <div class="metric">
        <span class="metric-label">Total Deliveries</span>
        <span class="metric-value info" id="totalDeliveries">0</span>
      </div>
      <div class="metric">
        <span class="metric-label">Successful</span>
        <span class="metric-value success" id="successDeliveries">0</span>
      </div>
      <div class="metric">
        <span class="metric-label">Failed</span>
        <span class="metric-value error" id="failedDeliveries">0</span>
      </div>
      <div class="metric">
        <span class="metric-label">Pending</span>
        <span class="metric-value warning" id="pendingDeliveries">0</span>
      </div>
    </div>

    <div class="card">
      <h2><span class="icon">&#129302;</span> Bot Instances</h2>
      <div class="metric">
        <span class="metric-label">Total Bots</span>
        <span class="metric-value info" id="totalBots">0</span>
      </div>
      <div class="metric">
        <span class="metric-label">Active</span>
        <span class="metric-value success" id="activeBots">0</span>
      </div>
      <div id="botsList"></div>
    </div>

    <div class="card">
      <h2><span class="icon">&#128187;</span> System Resources</h2>
      <div class="metric">
        <span class="metric-label">Uptime</span>
        <span class="metric-value uptime-value" id="uptime">0s</span>
      </div>
      <div class="metric">
        <span class="metric-label">CPU Usage</span>
        <span class="metric-value" id="cpuUsage">0%</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill green" id="cpuBar" style="width: 0%"></div>
      </div>
      <div class="metric">
        <span class="metric-label">Memory (Heap)</span>
        <span class="metric-value" id="memoryUsage">0 MB</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill green" id="memoryBar" style="width: 0%"></div>
      </div>
    </div>

    <div class="card" style="grid-column: span 2;">
      <h2><span class="icon">&#128279;</span> Registered Webhooks</h2>
      <table class="table" id="webhooksTable">
        <thead>
          <tr>
            <th>ID</th>
            <th>URL</th>
            <th>Events</th>
            <th>Status</th>
            <th>Success Rate</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="webhooksBody">
          <tr><td colspan="6" style="text-align:center;color:#666;">No webhooks registered</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <div class="ws-status disconnected" id="wsStatus">
    <span class="status-dot"></span>
    <span id="wsText">Disconnected</span>
  </div>

  <script>
    const wsProtocol = '${wsProtocol}';
    const wsHost = '${wsHost}';
    let ws = null;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 10;
    const requestHistory = [];
    const maxHistoryBars = 20;

    function connect() {
      try {
        ws = new WebSocket(wsProtocol + '://' + wsHost + '/ws/dashboard');
        
        ws.onopen = function() {
          reconnectAttempts = 0;
          updateWsStatus(true);
          ws.send(JSON.stringify({ type: 'getMetrics' }));
        };
        
        ws.onmessage = function(event) {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'metrics') {
              updateDashboard(msg.data);
            }
          } catch (e) {
            console.error('Failed to parse message:', e);
          }
        };
        
        ws.onclose = function() {
          updateWsStatus(false);
          scheduleReconnect();
        };
        
        ws.onerror = function(err) {
          console.error('WebSocket error:', err);
          updateWsStatus(false);
        };
      } catch (e) {
        console.error('WebSocket connection failed:', e);
        updateWsStatus(false);
        scheduleReconnect();
      }
    }

    function scheduleReconnect() {
      if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
        setTimeout(connect, delay);
      }
    }

    function updateWsStatus(connected) {
      const el = document.getElementById('wsStatus');
      const text = document.getElementById('wsText');
      el.className = 'ws-status ' + (connected ? 'connected' : 'disconnected');
      text.textContent = connected ? 'Live Updates' : 'Disconnected';
    }

    function updateDashboard(data) {
      document.getElementById('totalRequests').textContent = data.api.totalRequests.toLocaleString();
      document.getElementById('successRequests').textContent = data.api.successfulRequests.toLocaleString();
      document.getElementById('failedRequests').textContent = data.api.failedRequests.toLocaleString();
      document.getElementById('avgResponseTime').textContent = data.api.averageResponseTime + 'ms';
      document.getElementById('requestsPerMin').textContent = data.api.requestsPerMinute.toFixed(2);

      document.getElementById('totalDeliveries').textContent = data.webhooks.totalDeliveries.toLocaleString();
      document.getElementById('successDeliveries').textContent = data.webhooks.successfulDeliveries.toLocaleString();
      document.getElementById('failedDeliveries').textContent = data.webhooks.failedDeliveries.toLocaleString();
      document.getElementById('pendingDeliveries').textContent = data.webhooks.pendingDeliveries.toLocaleString();

      document.getElementById('totalBots').textContent = data.bots.totalBots;
      document.getElementById('activeBots').textContent = data.bots.activeBots;

      document.getElementById('uptime').textContent = formatUptime(data.system.uptime);
      document.getElementById('cpuUsage').textContent = data.system.cpuUsage.toFixed(1) + '%';
      
      const memoryMB = Math.round(data.system.memoryUsage.heapUsed / 1024 / 1024);
      const memoryTotalMB = Math.round(data.system.memoryUsage.heapTotal / 1024 / 1024);
      const memoryPercent = (data.system.memoryUsage.heapUsed / data.system.memoryUsage.heapTotal) * 100;
      document.getElementById('memoryUsage').textContent = memoryMB + ' / ' + memoryTotalMB + ' MB';

      updateProgressBar('cpuBar', data.system.cpuUsage);
      updateProgressBar('memoryBar', memoryPercent);

      requestHistory.push(data.api.requestsPerMinute);
      if (requestHistory.length > maxHistoryBars) requestHistory.shift();
      updateMiniChart();

      updateHealthStatus(data);
    }

    function updateProgressBar(id, percent) {
      const bar = document.getElementById(id);
      bar.style.width = Math.min(percent, 100) + '%';
      bar.className = 'progress-fill ' + (percent < 60 ? 'green' : percent < 85 ? 'yellow' : 'red');
    }

    function updateMiniChart() {
      const container = document.getElementById('requestsChart');
      container.innerHTML = '';
      const max = Math.max(...requestHistory, 1);
      requestHistory.forEach(val => {
        const bar = document.createElement('div');
        bar.className = 'bar';
        bar.style.height = ((val / max) * 100) + '%';
        container.appendChild(bar);
      });
    }

    function updateHealthStatus(data) {
      const el = document.getElementById('healthStatus');
      const text = document.getElementById('healthText');
      
      const errorRate = data.api.totalRequests > 0
        ? (data.api.failedRequests / data.api.totalRequests) * 100
        : 0;
      const memoryPercent = (data.system.memoryUsage.heapUsed / data.system.memoryUsage.heapTotal) * 100;

      let status = 'healthy';
      let statusText = 'System Healthy';

      if (errorRate > 25 || memoryPercent > 95) {
        status = 'unhealthy';
        statusText = 'System Unhealthy';
      } else if (errorRate > 10 || memoryPercent > 85 || data.api.averageResponseTime > 5000) {
        status = 'degraded';
        statusText = 'System Degraded';
      }

      el.className = 'status ' + status;
      text.textContent = statusText;
    }

    function formatUptime(seconds) {
      const days = Math.floor(seconds / 86400);
      const hours = Math.floor((seconds % 86400) / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      const secs = Math.floor(seconds % 60);
      
      if (days > 0) return days + 'd ' + hours + 'h ' + mins + 'm';
      if (hours > 0) return hours + 'h ' + mins + 'm ' + secs + 's';
      if (mins > 0) return mins + 'm ' + secs + 's';
      return secs + 's';
    }

    async function loadWebhooks() {
      try {
        const res = await fetch('/api/v2/dashboard/webhooks');
        const data = await res.json();
        
        if (data.success && data.data.webhooks.length > 0) {
          const tbody = document.getElementById('webhooksBody');
          tbody.innerHTML = data.data.webhooks.map(wh => {
            const successRate = wh.stats?.successRate
              ? (wh.stats.successRate * 100).toFixed(1) + '%'
              : 'N/A';
            return '<tr>' +
              '<td><code>' + wh.id.slice(0, 12) + '...</code></td>' +
              '<td>' + wh.url.slice(0, 40) + (wh.url.length > 40 ? '...' : '') + '</td>' +
              '<td>' + wh.events.join(', ') + '</td>' +
              '<td><span class="badge ' + (wh.enabled ? 'enabled' : 'disabled') + '">' +
                (wh.enabled ? 'Enabled' : 'Disabled') + '</span></td>' +
              '<td>' + successRate + '</td>' +
              '<td>' +
                '<button class="btn btn-primary btn-sm" onclick="testWebhook(\\'' + wh.id + '\\')">Test</button> ' +
                '<button class="btn btn-sm" onclick="toggleWebhook(\\'' + wh.id + '\\', ' + !wh.enabled + ')">' +
                  (wh.enabled ? 'Disable' : 'Enable') + '</button>' +
              '</td>' +
            '</tr>';
          }).join('');
        }
      } catch (e) {
        console.error('Failed to load webhooks:', e);
      }
    }

    async function testWebhook(id) {
      try {
        const res = await fetch('/api/v2/dashboard/webhooks/' + id + '/test', { method: 'POST' });
        const data = await res.json();
        alert(data.success ? 'Test sent!' : 'Test failed: ' + data.error);
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }

    async function toggleWebhook(id, enabled) {
      try {
        const res = await fetch('/api/v2/dashboard/webhooks/' + id + '/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled })
        });
        const data = await res.json();
        if (data.success) {
          loadWebhooks();
        }
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }

    function fallbackPolling() {
      setInterval(async () => {
        try {
          const res = await fetch('/api/v2/dashboard/metrics');
          const data = await res.json();
          if (data.success) {
            updateDashboard(data.data);
          }
        } catch (e) {
          console.error('Polling failed:', e);
        }
      }, 5000);
    }

    connect();
    loadWebhooks();
    
    setTimeout(() => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        fallbackPolling();
      }
    }, 10000);
  </script>
</body>
</html>`;
  }

  destroy(): void {
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
      this.broadcastInterval = null;
    }

    for (const client of this.wsClients) {
      client.close();
    }
    this.wsClients.clear();

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    this.logger.info('Monitoring dashboard destroyed');
  }
}
