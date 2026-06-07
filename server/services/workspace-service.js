import fs from 'node:fs/promises';
import path from 'node:path';

const JSON_SPACES = 2;
const DEFAULT_PRESSURE_CONFIG = {
  config: {
    concurrency: 5,
    durationSeconds: 30,
    maxRequests: 0,
    timeoutMs: 10000,
    requestIntervalMs: 0,
  },
  selectedRequestIds: [],
  targets: [],
  updatedAt: null,
};
const STATIC_RESOURCE_TYPES = new Set([
  'document',
  'stylesheet',
  'script',
  'image',
  'media',
  'font',
  'manifest',
]);
const STATIC_FILE_PATTERN = /\.(?:css|js|mjs|html?|png|jpe?g|gif|webp|svg|ico|bmp|avif|woff2?|ttf|otf|eot|mp4|webm|mp3|wav|map)(?:[?#].*)?$/i;

const readJson = async (filePath, fallback) => {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return JSON.parse(text);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
};

const writeJson = async (filePath, data) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = [
    filePath,
    process.pid,
    Date.now(),
    Math.random().toString(36).slice(2),
    'tmp',
  ].join('.');
  try {
    await fs.writeFile(tmpPath, `${JSON.stringify(data, null, JSON_SPACES)}\n`, 'utf8');
    await fs.rename(tmpPath, filePath);
  } catch (error) {
    await fs.unlink(tmpPath).catch(() => null);
    throw error;
  }
};

const safeName = (value) =>
  String(value || 'site')
    .replace(/^https?:\/\//, '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'site';

const timestampId = () => {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');
};

export class WorkspaceService {
  constructor(appRoot) {
    this.appRoot = appRoot;
    this.configFile = path.join(appRoot, 'workspace.config.json');
    this.defaultWorkspace = path.join(appRoot, 'workspace');
    this.sessionWriteChains = new Map();
  }

  async withSessionWriteLock(sessionId, task) {
    const previous = this.sessionWriteChains.get(sessionId) || Promise.resolve();
    const next = previous.catch(() => null).then(task);
    this.sessionWriteChains.set(sessionId, next);
    try {
      return await next;
    } finally {
      if (this.sessionWriteChains.get(sessionId) === next) {
        this.sessionWriteChains.delete(sessionId);
      }
    }
  }

  async getWorkspacePath() {
    const config = await readJson(this.configFile, {});
    return path.resolve(config.workspacePath || this.defaultWorkspace);
  }

  async ensureWorkspace(workspacePath) {
    const resolvedPath = path.resolve(workspacePath || await this.getWorkspacePath());
    await fs.mkdir(path.join(resolvedPath, 'sessions'), { recursive: true });
    await fs.mkdir(path.join(resolvedPath, 'reports'), { recursive: true });
    return resolvedPath;
  }

  async setWorkspacePath(workspacePath) {
    if (!workspacePath || !String(workspacePath).trim()) {
      const error = new Error('工作空间目录不能为空');
      error.statusCode = 400;
      throw error;
    }
    const resolvedPath = await this.ensureWorkspace(workspacePath);
    await writeJson(this.configFile, { workspacePath: resolvedPath, updatedAt: new Date().toISOString() });
    return this.getWorkspaceSummary();
  }

  sessionDir(workspacePath, sessionId) {
    return path.join(workspacePath, 'sessions', sessionId);
  }

  assertSafeSessionId(sessionId) {
    const normalized = String(sessionId || '').trim();
    if (!normalized || normalized.includes('/') || normalized.includes('\\')) {
      const error = new Error(`抓包会话不存在: ${sessionId}`);
      error.statusCode = 404;
      throw error;
    }
    return normalized;
  }

  assertSafeReportId(reportId) {
    const normalized = String(reportId || '').trim();
    if (!normalized || normalized.includes('/') || normalized.includes('\\')) {
      const error = new Error(`回放批次不存在: ${reportId}`);
      error.statusCode = 404;
      throw error;
    }
    return normalized;
  }

  classifyTraffic(item) {
    if (item.trafficType) {
      return item.trafficType;
    }
    if (STATIC_RESOURCE_TYPES.has(item.resourceType)) {
      return 'static';
    }
    if (STATIC_FILE_PATTERN.test(item.url || item.pathname || '')) {
      return 'static';
    }
    return 'http';
  }

  splitTraffic(entries) {
    const normalized = entries
      .map((item) => ({ ...item, trafficType: this.classifyTraffic(item) }))
      .sort((first, second) => Number(first.sequence || 0) - Number(second.sequence || 0));
    return {
      traffic: normalized,
      requests: normalized.filter((item) => item.trafficType === 'http'),
      resources: normalized.filter((item) => item.trafficType === 'static'),
    };
  }

  buildSessionPayload(meta, entries, authOverride = null) {
    const { traffic, requests, resources } = this.splitTraffic(entries);
    return {
      meta,
      requests,
      resources,
      traffic,
      ...(authOverride ? { authOverride } : {}),
    };
  }

  buildSnapshotMeta(meta, traffic, requests, resources) {
    return {
      ...meta,
      requestCount: requests.length,
      staticResourceCount: resources.length,
      totalTrafficCount: traffic.length,
      xhrFetchCount: requests.filter((item) => ['xhr', 'fetch'].includes(item.resourceType)).length,
      failedCount: traffic.filter((item) => item.status === 'failed').length,
      lastRequestAt: traffic[traffic.length - 1]?.timestamp || meta.lastRequestAt || null,
    };
  }

  async getWorkspaceSummary() {
    const workspacePath = await this.ensureWorkspace();
    const sessions = await this.listSessions();
    const reportCount = sessions.reduce((total, session) => total + Number(session.reportCount || 0), 0);
    return {
      workspacePath,
      exists: true,
      sessionCount: sessions.length,
      reportCount,
      directoryLayout: [
        'sessions/{sessionId}/meta.json',
        'sessions/{sessionId}/requests.json',
        'sessions/{sessionId}/resources.json',
        'sessions/{sessionId}/capture.json',
        'sessions/{sessionId}/capture.har',
        'sessions/{sessionId}/auth.override.json',
        'sessions/{sessionId}/pressure.config.json',
        'sessions/{sessionId}/scripts/*.sh',
        'sessions/{sessionId}/reports/*/result.json',
        'sessions/{sessionId}/pressure-tests/*/result.json',
      ],
    };
  }

  async createSession(targetUrl, sessionName) {
    const workspacePath = await this.ensureWorkspace();
    const hostname = (() => {
      try {
        return new URL(targetUrl).hostname;
      } catch (_error) {
        return 'site';
      }
    })();
    const sessionId = `${timestampId()}-${safeName(sessionName || hostname)}`;
    const sessionDir = this.sessionDir(workspacePath, sessionId);
    await fs.mkdir(path.join(sessionDir, 'scripts'), { recursive: true });
    await fs.mkdir(path.join(sessionDir, 'reports'), { recursive: true });
    await fs.mkdir(path.join(sessionDir, 'browser-profile'), { recursive: true });
    const meta = {
      id: sessionId,
      name: sessionName || hostname,
      targetUrl,
      workspacePath,
      sessionDir,
      status: 'created',
      browserVisible: true,
      startedAt: new Date().toISOString(),
      stoppedAt: null,
      requestCount: 0,
      staticResourceCount: 0,
      totalTrafficCount: 0,
      xhrFetchCount: 0,
      failedCount: 0,
      lastRequestAt: null,
      harPath: path.join(sessionDir, 'capture.har'),
    };
    await writeJson(path.join(sessionDir, 'meta.json'), meta);
    await writeJson(path.join(sessionDir, 'requests.json'), []);
    await writeJson(path.join(sessionDir, 'resources.json'), []);
    await writeJson(path.join(sessionDir, 'capture.json'), { meta, requests: [], resources: [], traffic: [] });
    await writeJson(path.join(sessionDir, 'pressure.config.json'), DEFAULT_PRESSURE_CONFIG);
    return { workspacePath, sessionDir, meta };
  }

  async writeSessionSnapshot(sessionId, meta, entries) {
    return this.withSessionWriteLock(sessionId, async () => {
      const workspacePath = await this.ensureWorkspace();
      const sessionDir = this.sessionDir(workspacePath, sessionId);
      const { traffic, requests, resources } = this.splitTraffic(entries);
      const nextMeta = this.buildSnapshotMeta(meta, traffic, requests, resources);
      await writeJson(path.join(sessionDir, 'meta.json'), nextMeta);
      await writeJson(path.join(sessionDir, 'requests.json'), requests);
      await writeJson(path.join(sessionDir, 'resources.json'), resources);
      await writeJson(path.join(sessionDir, 'capture.json'), { meta: nextMeta, requests, resources, traffic });
      return nextMeta;
    });
  }

  async writeSessionReviewSnapshot(sessionId, meta, entries) {
    return this.withSessionWriteLock(sessionId, async () => {
      const workspacePath = await this.ensureWorkspace();
      const sessionDir = this.sessionDir(workspacePath, sessionId);
      const { traffic, requests, resources } = this.splitTraffic(entries);
      const nextMeta = this.buildSnapshotMeta(meta, traffic, requests, resources);
      await writeJson(path.join(sessionDir, 'meta.json'), nextMeta);
      await writeJson(path.join(sessionDir, 'requests.json'), requests);
      await writeJson(path.join(sessionDir, 'resources.json'), resources);
      return nextMeta;
    });
  }

  async listSessions() {
    const workspacePath = await this.ensureWorkspace();
    const sessionsDir = path.join(workspacePath, 'sessions');
    const names = await fs.readdir(sessionsDir).catch(() => []);
    const sessions = await Promise.all(names.map(async (name) => {
      const sessionDir = path.join(sessionsDir, name);
      const stat = await fs.stat(sessionDir).catch(() => null);
      if (!stat?.isDirectory()) {
        return null;
      }
      const meta = await readJson(path.join(sessionDir, 'meta.json'), null);
      if (!meta) {
        return null;
      }
      const reports = await fs.readdir(path.join(sessionDir, 'reports')).catch(() => []);
      const pressureReports = await fs.readdir(path.join(sessionDir, 'pressure-tests')).catch(() => []);
      return {
        ...meta,
        reportCount: reports.length + pressureReports.length,
        replayReportCount: reports.length,
        pressureReportCount: pressureReports.length,
      };
    }));
    return sessions
      .filter(Boolean)
      .sort((first, second) => String(second.startedAt).localeCompare(String(first.startedAt)));
  }

  async readSession(sessionId) {
    const workspacePath = await this.ensureWorkspace();
    const normalizedSessionId = this.assertSafeSessionId(sessionId);
    const sessionDir = this.sessionDir(workspacePath, normalizedSessionId);
    const meta = await readJson(path.join(sessionDir, 'meta.json'), null);
    if (!meta) {
      const error = new Error(`抓包会话不存在: ${sessionId}`);
      error.statusCode = 404;
      throw error;
    }
    const rawRequests = await readJson(path.join(sessionDir, 'requests.json'), []);
    const rawResources = await readJson(path.join(sessionDir, 'resources.json'), []);
    const { requests, resources } = this.splitTraffic([...rawRequests, ...rawResources]);
    const authOverride = await this.readAuthOverride(sessionId);
    return { meta, requests, resources, authOverride };
  }

  async patchRequest(sessionId, requestId, patch) {
    const session = await this.readSession(sessionId);
    const requests = session.requests.map((item) =>
      item.id === requestId ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item
    );
    const found = requests.some((item) => item.id === requestId);
    if (!found) {
      const error = new Error(`请求不存在: ${requestId}`);
      error.statusCode = 404;
      throw error;
    }
    const meta = await this.writeSessionReviewSnapshot(sessionId, session.meta, [...requests, ...session.resources]);
    return { meta, requests, resources: session.resources };
  }

  async deleteRequest(sessionId, requestId) {
    const session = await this.readSession(sessionId);
    const requests = session.requests.filter((item) => item.id !== requestId);
    const meta = await this.writeSessionReviewSnapshot(sessionId, session.meta, [...requests, ...session.resources]);
    return { meta, requests, resources: session.resources };
  }

  async deleteSession(sessionId) {
    const workspacePath = await this.ensureWorkspace();
    const normalizedSessionId = this.assertSafeSessionId(sessionId);
    const sessionDir = this.sessionDir(workspacePath, normalizedSessionId);
    await fs.rm(sessionDir, { recursive: true, force: true });
    this.sessionWriteChains.delete(normalizedSessionId);
    return { deleted: true, sessionId: normalizedSessionId };
  }

  async batchPatchRequests(sessionId, body) {
    const session = await this.readSession(sessionId);
    const methods = new Set(body.methods || []);
    const patch = body.patch || {};
    const requests = session.requests.map((item) => {
      if (!methods.size || methods.has(item.method)) {
        return { ...item, ...patch, updatedAt: new Date().toISOString() };
      }
      return item;
    });
    const meta = await this.writeSessionReviewSnapshot(sessionId, session.meta, [...requests, ...session.resources]);
    return { meta, requests, resources: session.resources };
  }

  async readAuthOverride(sessionId) {
    const workspacePath = await this.ensureWorkspace();
    const normalizedSessionId = this.assertSafeSessionId(sessionId);
    const filePath = path.join(this.sessionDir(workspacePath, normalizedSessionId), 'auth.override.json');
    const fallback = {
      mode: 'override',
      cookie: '',
      headers: {},
      loginRequestId: '',
      endpoint: {
        protocol: '',
        hostname: '',
        port: '',
      },
      replacements: [],
      updatedAt: null,
    };
    const authOverride = await readJson(filePath, fallback);
    return {
      ...fallback,
      ...authOverride,
      mode: authOverride.mode === 'raw' ? 'raw' : 'override',
      headers: authOverride.headers || {},
      loginRequestId: authOverride.loginRequestId || '',
      endpoint: {
        ...fallback.endpoint,
        ...(authOverride.endpoint || {}),
      },
      replacements: Array.isArray(authOverride.replacements) ? authOverride.replacements : [],
      updatedAt: authOverride.updatedAt || null,
    };
  }

  async writeAuthOverride(sessionId, data) {
    const workspacePath = await this.ensureWorkspace();
    const normalizedSessionId = this.assertSafeSessionId(sessionId);
    const filePath = path.join(this.sessionDir(workspacePath, normalizedSessionId), 'auth.override.json');
    const payload = {
      mode: data.mode === 'raw' ? 'raw' : 'override',
      cookie: data.cookie || '',
      headers: data.headers || {},
      loginRequestId: data.loginRequestId || '',
      endpoint: {
        protocol: data.endpoint?.protocol || '',
        hostname: data.endpoint?.hostname || '',
        port: data.endpoint?.port || '',
      },
      replacements: Array.isArray(data.replacements) ? data.replacements : [],
      updatedAt: new Date().toISOString(),
    };
    await writeJson(filePath, payload);
    return payload;
  }

  normalizePressureConfig(data = {}) {
    const config = data.config || {};
    const targets = Array.isArray(data.targets) ? data.targets : [];
    const selectedRequestIds = Array.isArray(data.selectedRequestIds)
      ? data.selectedRequestIds
      : targets.map((target) => target.requestId || target.id).filter(Boolean);
    const numberOr = (value, fallback) => {
      const nextValue = Number(value);
      return Number.isFinite(nextValue) ? nextValue : fallback;
    };
    return {
      config: {
        concurrency: numberOr(config.concurrency, DEFAULT_PRESSURE_CONFIG.config.concurrency),
        durationSeconds: numberOr(config.durationSeconds, DEFAULT_PRESSURE_CONFIG.config.durationSeconds),
        maxRequests: numberOr(config.maxRequests, DEFAULT_PRESSURE_CONFIG.config.maxRequests),
        timeoutMs: numberOr(config.timeoutMs, DEFAULT_PRESSURE_CONFIG.config.timeoutMs),
        requestIntervalMs: numberOr(config.requestIntervalMs, DEFAULT_PRESSURE_CONFIG.config.requestIntervalMs),
      },
      selectedRequestIds: selectedRequestIds.map((id) => String(id)),
      targets: targets
        .map((target) => {
          const requestId = target.requestId || target.id;
          if (!requestId) {
            return null;
          }
          return {
            requestId: String(requestId),
            method: target.method || '',
            url: target.url || '',
            pressureUrl: target.pressureUrl || target.url || '',
            category: target.category || 'other',
            enabled: target.enabled !== false,
            weight: numberOr(target.weight, 1),
          };
        })
        .filter(Boolean),
      updatedAt: data.updatedAt || null,
    };
  }

  async readPressureConfig(sessionId) {
    const workspacePath = await this.ensureWorkspace();
    const normalizedSessionId = this.assertSafeSessionId(sessionId);
    const filePath = path.join(this.sessionDir(workspacePath, normalizedSessionId), 'pressure.config.json');
    const pressureConfig = await readJson(filePath, DEFAULT_PRESSURE_CONFIG);
    return this.normalizePressureConfig(pressureConfig);
  }

  async writePressureConfig(sessionId, data) {
    const workspacePath = await this.ensureWorkspace();
    const normalizedSessionId = this.assertSafeSessionId(sessionId);
    const filePath = path.join(this.sessionDir(workspacePath, normalizedSessionId), 'pressure.config.json');
    const payload = {
      ...this.normalizePressureConfig(data),
      updatedAt: new Date().toISOString(),
    };
    await writeJson(filePath, payload);
    return payload;
  }

  async writeReport(sessionId, report) {
    const workspacePath = await this.ensureWorkspace();
    const normalizedSessionId = this.assertSafeSessionId(sessionId);
    const reportId = report.reportId ? this.assertSafeReportId(report.reportId) : `${timestampId()}-replay`;
    const reportDir = path.join(this.sessionDir(workspacePath, normalizedSessionId), 'reports', reportId);
    await fs.mkdir(reportDir, { recursive: true });
    const reportPath = path.join(reportDir, 'result.json');
    await writeJson(reportPath, { ...report, reportId, reportPath });
    return { reportId, reportDir, reportPath };
  }

  async listReports(sessionId) {
    const workspacePath = await this.ensureWorkspace();
    const normalizedSessionId = this.assertSafeSessionId(sessionId);
    const reportsDir = path.join(this.sessionDir(workspacePath, normalizedSessionId), 'reports');
    const names = await fs.readdir(reportsDir).catch(() => []);
    const reports = await Promise.all(names.map(async (name) => {
      const reportDir = path.join(reportsDir, name);
      const stat = await fs.stat(reportDir).catch(() => null);
      if (!stat?.isDirectory()) {
        return null;
      }
      const report = await readJson(path.join(reportDir, 'result.json'), null);
      return report ? { ...report, reportId: report.reportId || name, reportDir } : null;
    }));
    return reports
      .filter(Boolean)
      .sort((first, second) => String(second.startedAt).localeCompare(String(first.startedAt)));
  }

  async readReport(sessionId, reportId) {
    const workspacePath = await this.ensureWorkspace();
    const normalizedSessionId = this.assertSafeSessionId(sessionId);
    const normalizedReportId = this.assertSafeReportId(reportId);
    const reportPath = path.join(this.sessionDir(workspacePath, normalizedSessionId), 'reports', normalizedReportId, 'result.json');
    const report = await readJson(reportPath, null);
    if (!report) {
      const error = new Error(`回放批次不存在: ${reportId}`);
      error.statusCode = 404;
      throw error;
    }
    return report;
  }

  async deleteReport(sessionId, reportId) {
    const workspacePath = await this.ensureWorkspace();
    const normalizedSessionId = this.assertSafeSessionId(sessionId);
    const normalizedReportId = this.assertSafeReportId(reportId);
    const reportDir = path.join(this.sessionDir(workspacePath, normalizedSessionId), 'reports', normalizedReportId);
    await fs.rm(reportDir, { recursive: true, force: true });
    return { deleted: true, reportId: normalizedReportId };
  }

  async clearReports(sessionId) {
    const workspacePath = await this.ensureWorkspace();
    const normalizedSessionId = this.assertSafeSessionId(sessionId);
    const reportsDir = path.join(this.sessionDir(workspacePath, normalizedSessionId), 'reports');
    await fs.rm(reportsDir, { recursive: true, force: true });
    await fs.mkdir(reportsDir, { recursive: true });
    return { cleared: true };
  }

  async writePressureReport(sessionId, report) {
    const workspacePath = await this.ensureWorkspace();
    const normalizedSessionId = this.assertSafeSessionId(sessionId);
    const reportId = report.reportId ? this.assertSafeReportId(report.reportId) : `${timestampId()}-pressure`;
    const reportDir = path.join(this.sessionDir(workspacePath, normalizedSessionId), 'pressure-tests', reportId);
    await fs.mkdir(reportDir, { recursive: true });
    const reportPath = path.join(reportDir, 'result.json');
    await writeJson(reportPath, { ...report, reportId, reportPath });
    return { reportId, reportDir, reportPath };
  }

  async listPressureReports(sessionId) {
    const workspacePath = await this.ensureWorkspace();
    const normalizedSessionId = this.assertSafeSessionId(sessionId);
    const reportsDir = path.join(this.sessionDir(workspacePath, normalizedSessionId), 'pressure-tests');
    const names = await fs.readdir(reportsDir).catch(() => []);
    const reports = await Promise.all(names.map(async (name) => {
      const reportDir = path.join(reportsDir, name);
      const stat = await fs.stat(reportDir).catch(() => null);
      if (!stat?.isDirectory()) {
        return null;
      }
      return readJson(path.join(reportDir, 'result.json'), null);
    }));
    return reports.filter(Boolean);
  }

  async readPressureReport(sessionId, reportId) {
    const workspacePath = await this.ensureWorkspace();
    const normalizedSessionId = this.assertSafeSessionId(sessionId);
    const normalizedReportId = this.assertSafeReportId(reportId);
    const reportPath = path.join(this.sessionDir(workspacePath, normalizedSessionId), 'pressure-tests', normalizedReportId, 'result.json');
    const report = await readJson(reportPath, null);
    if (!report) {
      const error = new Error(`压力测试报告不存在: ${reportId}`);
      error.statusCode = 404;
      throw error;
    }
    return report;
  }

  async deletePressureReport(sessionId, reportId) {
    const workspacePath = await this.ensureWorkspace();
    const normalizedSessionId = this.assertSafeSessionId(sessionId);
    const normalizedReportId = this.assertSafeReportId(reportId);
    const reportDir = path.join(this.sessionDir(workspacePath, normalizedSessionId), 'pressure-tests', normalizedReportId);
    await fs.rm(reportDir, { recursive: true, force: true });
    return { deleted: true, reportId: normalizedReportId };
  }

  async clearPressureReports(sessionId) {
    const workspacePath = await this.ensureWorkspace();
    const normalizedSessionId = this.assertSafeSessionId(sessionId);
    const reportsDir = path.join(this.sessionDir(workspacePath, normalizedSessionId), 'pressure-tests');
    await fs.rm(reportsDir, { recursive: true, force: true });
    await fs.mkdir(reportsDir, { recursive: true });
    return { cleared: true };
  }

  async writeScript(sessionId, fileName, content) {
    const workspacePath = await this.ensureWorkspace();
    const normalizedSessionId = this.assertSafeSessionId(sessionId);
    const scriptPath = path.join(this.sessionDir(workspacePath, normalizedSessionId), 'scripts', fileName);
    await fs.mkdir(path.dirname(scriptPath), { recursive: true });
    await fs.writeFile(scriptPath, content, 'utf8');
    await fs.chmod(scriptPath, 0o755);
    return scriptPath;
  }
}
