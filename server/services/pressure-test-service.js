const DEFAULT_PRESSURE_TIMEOUT_MS = 10000;
const MAX_SAMPLES = 300;
const MAX_ERROR_SAMPLES = 50;

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const stripUnsafeHeaders = (headers) => {
  const unsafe = new Set([
    'accept-encoding',
    'connection',
    'content-length',
    'host',
    'keep-alive',
    'proxy-authorization',
    'proxy-connection',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
  ]);
  return Object.fromEntries(
    Object.entries(headers || {}).filter(([key]) => !unsafe.has(key.toLowerCase()) && !key.startsWith(':'))
  );
};

const normalizeCookieHeader = (value) => String(value || '')
  .split(';')
  .map((item) => item.trim())
  .filter(Boolean)
  .join('; ');

const removeHeader = (headers, headerName) => {
  const normalizedName = String(headerName).toLowerCase();
  return Object.fromEntries(
    Object.entries(headers || {}).filter(([key]) => key.toLowerCase() !== normalizedName)
  );
};

const setCookieHeader = (headers, cookieHeader) => {
  const nextHeaders = removeHeader(headers, 'cookie');
  const normalizedCookie = normalizeCookieHeader(cookieHeader);
  if (normalizedCookie) {
    nextHeaders.Cookie = normalizedCookie;
  }
  return nextHeaders;
};

const setHeader = (headers, headerName, value) => {
  const nextHeaders = removeHeader(headers, headerName);
  nextHeaders[headerName] = value;
  return nextHeaders;
};

const headerValue = (headers, headerName) => {
  const normalizedName = String(headerName).toLowerCase();
  return Object.entries(headers || {}).find(([key]) => key.toLowerCase() === normalizedName)?.[1];
};

const rewriteEndpoint = (url, endpoint = {}) => {
  if (!endpoint.hostname && !endpoint.port && !endpoint.protocol) {
    return url;
  }
  try {
    const parsed = new URL(url);
    if (endpoint.protocol) {
      parsed.protocol = String(endpoint.protocol).replace(/:$/, '') + ':';
    }
    if (endpoint.hostname) {
      parsed.hostname = endpoint.hostname;
    }
    if (endpoint.port !== undefined && endpoint.port !== null) {
      parsed.port = String(endpoint.port).trim();
    }
    return parsed.toString();
  } catch (_error) {
    return url;
  }
};

const rewriteOriginHeaders = (headers, originalUrl, rewrittenUrl) => {
  try {
    const originalOrigin = new URL(originalUrl).origin;
    const rewrittenOrigin = new URL(rewrittenUrl).origin;
    if (originalOrigin === rewrittenOrigin) {
      return headers;
    }
    let nextHeaders = { ...headers };
    const origin = headerValue(nextHeaders, 'origin');
    if (origin && String(origin).startsWith(originalOrigin)) {
      nextHeaders = setHeader(nextHeaders, 'Origin', String(origin).replace(originalOrigin, rewrittenOrigin));
    }
    const referer = headerValue(nextHeaders, 'referer');
    if (referer && String(referer).startsWith(originalOrigin)) {
      nextHeaders = setHeader(nextHeaders, 'Referer', String(referer).replace(originalOrigin, rewrittenOrigin));
    }
    return nextHeaders;
  } catch (_error) {
    return headers;
  }
};

const applyAuthOverride = (request, authOverride = {}, mode = 'raw') => {
  let headers = stripUnsafeHeaders(request.headers || {});
  const originalUrl = request.url;
  let url = request.url;
  let postData = request.postData;

  if (mode === 'override') {
    url = rewriteEndpoint(url, authOverride.endpoint);
    headers = rewriteOriginHeaders(headers, originalUrl, url);
    let overrideCookie = authOverride.cookie || '';
    Object.entries(authOverride.headers || {}).forEach(([key, value]) => {
      if (!key || value === undefined || value === null) {
        return;
      }
      if (key.toLowerCase() === 'cookie') {
        overrideCookie = String(value);
      } else {
        headers[key] = String(value);
      }
    });
    if (overrideCookie) {
      headers = setCookieHeader(headers, overrideCookie);
    }
    (authOverride.replacements || []).forEach((rule) => {
      if (!rule?.from) {
        return;
      }
      const from = String(rule.from);
      const to = String(rule.to ?? '');
      if (rule.scope === 'url' || rule.scope === 'all') {
        url = url.split(from).join(to);
      }
      if ((rule.scope === 'body' || rule.scope === 'all') && typeof postData === 'string') {
        postData = postData.split(from).join(to);
      }
    });
  }

  return { ...request, headers, url, postData };
};

const normalizePositiveInt = (value, fallback, min, max) => {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
};

const createPressureJobId = () =>
  `${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${Math.random().toString(36).slice(2, 8)}-pressure`;

const requestBrief = (request) => ({
  id: request.id,
  sequence: request.sequence,
  method: request.method,
  url: request.url,
  category: request.category,
  resourceType: request.resourceType,
});

const percentile = (values, ratio) => {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((first, second) => first - second);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
};

const round = (value, digits = 2) => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const emptyStats = (target = null) => ({
  target,
  total: 0,
  success: 0,
  failed: 0,
  totalDurationMs: 0,
  minDurationMs: null,
  maxDurationMs: null,
  latencies: [],
  statusCounts: {},
  errorCounts: {},
});

const recordStats = (stats, result) => {
  stats.total += 1;
  stats.success += result.ok ? 1 : 0;
  stats.failed += result.ok ? 0 : 1;
  stats.totalDurationMs += result.durationMs;
  stats.minDurationMs = stats.minDurationMs === null ? result.durationMs : Math.min(stats.minDurationMs, result.durationMs);
  stats.maxDurationMs = stats.maxDurationMs === null ? result.durationMs : Math.max(stats.maxDurationMs, result.durationMs);
  stats.latencies.push(result.durationMs);
  const statusKey = String(result.status || 'ERR');
  stats.statusCounts[statusKey] = (stats.statusCounts[statusKey] || 0) + 1;
  if (result.error) {
    stats.errorCounts[result.error] = (stats.errorCounts[result.error] || 0) + 1;
  }
};

const summarizeStats = (stats, elapsedSeconds) => ({
  total: stats.total,
  success: stats.success,
  failed: stats.failed,
  successRate: stats.total ? round((stats.success / stats.total) * 100) : 0,
  tps: elapsedSeconds > 0 ? round(stats.total / elapsedSeconds) : 0,
  avgDurationMs: stats.total ? round(stats.totalDurationMs / stats.total) : 0,
  minDurationMs: stats.minDurationMs ?? 0,
  maxDurationMs: stats.maxDurationMs ?? 0,
  p50DurationMs: percentile(stats.latencies, 0.5),
  p90DurationMs: percentile(stats.latencies, 0.9),
  p95DurationMs: percentile(stats.latencies, 0.95),
  p99DurationMs: percentile(stats.latencies, 0.99),
  statusCounts: stats.statusCounts,
  errorCounts: stats.errorCounts,
});

const reportSummary = (job, finishedAt = new Date().toISOString()) => {
  const elapsedMs = Math.max(0, new Date(finishedAt).getTime() - new Date(job.startedAt).getTime());
  const elapsedSeconds = elapsedMs > 0 ? elapsedMs / 1000 : 0;
  const summary = {
    ...summarizeStats(job.overallStats, elapsedSeconds),
    elapsedMs,
    elapsedSeconds: round(elapsedSeconds),
  };
  const interfaces = [...job.targetStats.values()].map((stats) => ({
    ...stats.target,
    ...summarizeStats(stats, elapsedSeconds),
  }));
  return { summary, interfaces };
};

const serializeReportSummary = (report) => ({
  jobId: report.reportId,
  batchId: report.reportId,
  sessionId: report.sessionId,
  status: report.status,
  startedAt: report.startedAt,
  finishedAt: report.finishedAt,
  config: report.config,
  summary: report.summary,
  reportId: report.reportId,
  reportPath: report.reportPath || '',
  error: report.error || '',
});

export class PressureTestService {
  constructor(workspaceService) {
    this.workspaceService = workspaceService;
    this.pressureJobs = new Map();
  }

  buildConfig(options = {}) {
    return {
      concurrency: normalizePositiveInt(options.concurrency, 5, 1, 500),
      durationSeconds: normalizePositiveInt(options.durationSeconds, 30, 1, 24 * 60 * 60),
      timeoutMs: normalizePositiveInt(options.timeoutMs, DEFAULT_PRESSURE_TIMEOUT_MS, 100, 10 * 60 * 1000),
      maxRequests: normalizePositiveInt(options.maxRequests, 0, 0, 10_000_000),
      requestIntervalMs: normalizePositiveInt(options.requestIntervalMs, 0, 0, 60_000),
    };
  }

  buildTargets(session, authOverride, options = {}) {
    const targetInputs = Array.isArray(options.targets) && options.targets.length
      ? options.targets
      : (options.requestIds || []).map((requestId) => ({ requestId, enabled: true, weight: 1 }));
    const requestMap = new Map((session.requests || []).map((request) => [request.id, request]));
    const mode = options.authMode || authOverride.mode || 'raw';
    const targets = targetInputs
      .filter((target) => target.enabled !== false)
      .map((target) => {
        const sourceRequest = requestMap.get(target.requestId || target.id);
        if (!sourceRequest) {
          return null;
        }
        const request = applyAuthOverride(sourceRequest, authOverride, mode);
        return {
          ...requestBrief(sourceRequest),
          originalUrl: sourceRequest.url,
          pressureUrl: request.url,
          weight: normalizePositiveInt(target.weight, 1, 1, 100),
          request,
        };
      })
      .filter(Boolean);
    if (!targets.length) {
      const error = new Error('请至少选择一个接口用于压力测试');
      error.statusCode = 400;
      throw error;
    }
    const weightedTargets = targets.flatMap((target) =>
      Array.from({ length: target.weight }, () => target)
    );
    return { mode, targets, weightedTargets };
  }

  serializeJob(job) {
    const { summary, interfaces } = reportSummary(job, job.finishedAt || new Date().toISOString());
    return {
      jobId: job.jobId,
      batchId: job.jobId,
      sessionId: job.sessionId,
      status: job.status,
      config: job.config,
      authMode: job.authMode,
      authOverride: job.authOverride,
      targets: job.targets,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      progressPercent: job.progressPercent,
      summary,
      interfaces,
      samples: job.samples,
      errors: job.errors,
      timeline: [...job.timeline.values()].sort((first, second) => first.second - second.second),
      report: job.report,
      reportId: job.reportId || null,
      reportPath: job.reportPath || null,
      error: job.error || '',
    };
  }

  serializeBatchSummary(job) {
    const { summary } = reportSummary(job, job.finishedAt || new Date().toISOString());
    return {
      jobId: job.jobId,
      batchId: job.jobId,
      sessionId: job.sessionId,
      status: job.status,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      config: job.config,
      summary,
      reportId: job.reportId || null,
      reportPath: job.reportPath || null,
      error: job.error || '',
    };
  }

  serializeReport(report) {
    return {
      jobId: report.reportId,
      batchId: report.reportId,
      sessionId: report.sessionId,
      status: report.status || 'completed',
      config: report.config,
      authMode: report.authMode,
      authOverride: report.authOverride,
      targets: report.targets,
      startedAt: report.startedAt,
      finishedAt: report.finishedAt,
      progressPercent: 100,
      summary: report.summary,
      interfaces: report.interfaces,
      samples: report.samples || [],
      errors: report.errors || [],
      timeline: report.timeline || [],
      report,
      reportId: report.reportId,
      reportPath: report.reportPath || '',
      error: report.error || '',
    };
  }

  async listPressureTests(sessionId) {
    const activeSummaries = [...this.pressureJobs.values()]
      .filter((job) => job.sessionId === sessionId)
      .map((job) => this.serializeBatchSummary(job));
    const activeIds = new Set(activeSummaries.map((item) => item.batchId));
    const fileSummaries = (await this.workspaceService.listPressureReports(sessionId))
      .filter((report) => !activeIds.has(report.reportId))
      .map(serializeReportSummary);
    return [...activeSummaries, ...fileSummaries]
      .sort((first, second) => String(second.startedAt).localeCompare(String(first.startedAt)));
  }

  async getPressureTest(sessionId, testId) {
    const job = this.pressureJobs.get(testId);
    if (job?.sessionId === sessionId) {
      return this.serializeJob(job);
    }
    const report = await this.workspaceService.readPressureReport(sessionId, testId);
    return this.serializeReport(report);
  }

  async startPressureTest(sessionId, options = {}) {
    const session = await this.workspaceService.readSession(sessionId);
    const authOverride = await this.workspaceService.readAuthOverride(sessionId);
    const config = this.buildConfig(options);
    const { mode, targets, weightedTargets } = this.buildTargets(session, authOverride, options);
    const jobId = createPressureJobId();
    const job = {
      jobId,
      sessionId,
      status: 'running',
      config,
      authMode: mode,
      authOverride,
      targets: targets.map(({ request, ...target }) => target),
      weightedTargets,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      progressPercent: 0,
      overallStats: emptyStats(),
      targetStats: new Map(targets.map((target) => [target.id, emptyStats({ ...target, request: undefined })])),
      samples: [],
      errors: [],
      timeline: new Map(),
      report: null,
      reportId: null,
      reportPath: null,
      error: '',
      cancelled: false,
      deleted: false,
    };
    this.pressureJobs.set(jobId, job);
    this.runPressureJob(job).catch((error) => {
      job.status = job.cancelled ? 'stopped' : 'failed';
      job.finishedAt = job.finishedAt || new Date().toISOString();
      job.error = job.cancelled ? '' : error.message;
    });
    return this.serializeJob(job);
  }

  stopPressureTest(sessionId, testId) {
    const job = this.pressureJobs.get(testId);
    if (!job || job.sessionId !== sessionId) {
      const error = new Error(`运行中的压力测试不存在: ${testId}`);
      error.statusCode = 404;
      throw error;
    }
    if (job.status === 'running') {
      job.status = 'stopping';
      job.cancelled = true;
    }
    return this.serializeJob(job);
  }

  async deletePressureTest(sessionId, testId) {
    const job = this.pressureJobs.get(testId);
    if (job?.sessionId === sessionId) {
      job.cancelled = true;
      job.deleted = true;
      this.pressureJobs.delete(testId);
    }
    await this.workspaceService.deletePressureReport(sessionId, testId);
    return { deleted: true, testId };
  }

  async clearPressureTests(sessionId) {
    [...this.pressureJobs.values()]
      .filter((job) => job.sessionId === sessionId)
      .forEach((job) => {
        job.cancelled = true;
        job.deleted = true;
        this.pressureJobs.delete(job.jobId);
      });
    await this.workspaceService.clearPressureReports(sessionId);
    return { cleared: true };
  }

  async runPressureJob(job) {
    const startedMs = Date.now();
    const deadlineMs = startedMs + job.config.durationSeconds * 1000;
    let sequence = 0;
    let targetCursor = 0;

    const nextTarget = () => {
      const target = job.weightedTargets[targetCursor % job.weightedTargets.length];
      targetCursor += 1;
      return target;
    };

    const canContinue = () => {
      if (job.cancelled) {
        return false;
      }
      if (Date.now() >= deadlineMs) {
        return false;
      }
      return job.config.maxRequests <= 0 || sequence < job.config.maxRequests;
    };

    const worker = async () => {
      while (canContinue()) {
        sequence += 1;
        const target = nextTarget();
        await this.executeTarget(job, target, sequence, startedMs);
        const elapsedRatio = Math.min(1, (Date.now() - startedMs) / (job.config.durationSeconds * 1000));
        const requestRatio = job.config.maxRequests > 0 ? Math.min(1, sequence / job.config.maxRequests) : 0;
        job.progressPercent = Math.round(Math.max(elapsedRatio, requestRatio) * 100);
        if (job.config.requestIntervalMs > 0 && canContinue()) {
          await sleep(job.config.requestIntervalMs);
        }
      }
    };

    await Promise.all(Array.from({ length: job.config.concurrency }, () => worker()));
    job.status = job.cancelled ? 'stopped' : 'completed';
    job.finishedAt = new Date().toISOString();
    job.progressPercent = 100;
    if (job.deleted) {
      return;
    }
    const report = await this.writeReport(job);
    job.report = report;
    job.reportId = report.reportId;
    job.reportPath = report.reportPath;
  }

  async executeTarget(job, target, sequence, startedMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), job.config.timeoutMs);
    const startedAt = new Date().toISOString();
    const requestStarted = Date.now();
    try {
      const response = await fetch(target.request.url, {
        method: target.request.method,
        headers: target.request.headers,
        body: ['GET', 'HEAD'].includes(target.request.method) ? undefined : target.request.postData,
        redirect: 'manual',
        signal: controller.signal,
      });
      const result = {
        sequence,
        requestId: target.id,
        method: target.method,
        url: target.request.url,
        ok: response.ok,
        status: response.status,
        durationMs: Date.now() - requestStarted,
        startedAt,
        finishedAt: new Date().toISOString(),
      };
      this.recordResult(job, target, result, startedMs);
    } catch (error) {
      const result = {
        sequence,
        requestId: target.id,
        method: target.method,
        url: target.request.url,
        ok: false,
        status: 0,
        durationMs: Date.now() - requestStarted,
        startedAt,
        finishedAt: new Date().toISOString(),
        error: error.name === 'AbortError' ? `请求超时 ${job.config.timeoutMs}ms` : error.message,
      };
      this.recordResult(job, target, result, startedMs);
    } finally {
      clearTimeout(timeout);
    }
  }

  recordResult(job, target, result, startedMs) {
    recordStats(job.overallStats, result);
    const targetStats = job.targetStats.get(target.id);
    if (targetStats) {
      recordStats(targetStats, result);
    }
    const second = Math.floor((Date.now() - startedMs) / 1000);
    const bucket = job.timeline.get(second) || { second, total: 0, success: 0, failed: 0 };
    bucket.total += 1;
    bucket.success += result.ok ? 1 : 0;
    bucket.failed += result.ok ? 0 : 1;
    job.timeline.set(second, bucket);
    job.samples.push(result);
    if (job.samples.length > MAX_SAMPLES) {
      job.samples.shift();
    }
    if (result.error && job.errors.length < MAX_ERROR_SAMPLES) {
      job.errors.push(result);
    }
  }

  async writeReport(job) {
    const { summary, interfaces } = reportSummary(job, job.finishedAt);
    const report = {
      reportId: job.jobId,
      sessionId: job.sessionId,
      status: job.status,
      config: job.config,
      authMode: job.authMode,
      authOverride: job.authOverride,
      targets: job.targets,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      summary,
      interfaces,
      samples: job.samples,
      errors: job.errors,
      timeline: [...job.timeline.values()].sort((first, second) => first.second - second.second),
      error: job.error || '',
    };
    const reportFile = await this.workspaceService.writePressureReport(job.sessionId, report);
    return { ...report, ...reportFile };
  }
}
