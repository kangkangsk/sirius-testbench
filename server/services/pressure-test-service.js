const DEFAULT_PRESSURE_TIMEOUT_MS = 10000;
const PROMETHEUS_TIMEOUT_MS = 10000;
const MAX_SAMPLES = 300;
const MAX_ERROR_SAMPLES = 50;

const RESOURCE_METRIC_DEFINITIONS = {
  cpu: {
    label: 'CPU',
    unit: '%',
    aggregation: 'avg',
    query: '100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[1m])) * 100)',
  },
  memory: {
    label: '内存',
    unit: '%',
    aggregation: 'avg',
    query: '(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100',
  },
  diskIo: {
    label: '磁盘 I/O',
    unit: 'bytes/s',
    aggregation: 'sum',
    query: 'sum(rate(node_disk_read_bytes_total[1m])) + sum(rate(node_disk_written_bytes_total[1m]))',
  },
  networkIo: {
    label: '网络 I/O',
    unit: 'bytes/s',
    aggregation: 'sum',
    query: 'sum(rate(node_network_receive_bytes_total[1m])) + sum(rate(node_network_transmit_bytes_total[1m]))',
  },
  jvmGc: {
    label: 'JVM GC',
    unit: 's/s',
    aggregation: 'sum',
    query: 'sum(rate(jvm_gc_pause_seconds_sum[1m]))',
  },
  threadCount: {
    label: '线程数',
    unit: 'threads',
    aggregation: 'avg',
    query: 'jvm_threads_live_threads',
  },
  dbConnections: {
    label: '数据库连接数',
    unit: 'connections',
    aggregation: 'avg',
    query: 'hikaricp_connections_active',
  },
  slowSql: {
    label: '慢 SQL',
    unit: 'count',
    aggregation: 'sum',
    query: 'increase(mysql_global_status_slow_queries[1m])',
  },
};

const RESOURCE_METRIC_KEYS = Object.keys(RESOURCE_METRIC_DEFINITIONS);

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

const byteLength = (value) => Buffer.byteLength(String(value ?? ''), 'utf8');

const objectByteLength = (value) =>
  Object.entries(value || {}).reduce((total, [key, itemValue]) =>
    total + byteLength(`${key}: ${itemValue}\r\n`), 0);

const payloadByteLength = (value) => {
  if (value === undefined || value === null) {
    return 0;
  }
  if (Buffer.isBuffer(value)) {
    return value.length;
  }
  if (value instanceof ArrayBuffer) {
    return value.byteLength;
  }
  return byteLength(value);
};

const estimateSentBytes = (request) => {
  let pathWithQuery = request.url || '/';
  try {
    const parsed = new URL(request.url);
    pathWithQuery = `${parsed.pathname}${parsed.search}`;
  } catch (_error) {
    pathWithQuery = request.url || '/';
  }
  return byteLength(`${request.method || 'GET'} ${pathWithQuery} HTTP/1.1\r\n`)
    + objectByteLength(request.headers || {})
    + byteLength('\r\n')
    + payloadByteLength(request.postData);
};

const responseHeadersObject = (headers) =>
  Object.fromEntries([...headers.entries()].map(([key, value]) => [key, value]));

const firstHeaderValue = (headers, names) => {
  const normalized = Object.fromEntries(
    Object.entries(headers || {}).map(([key, value]) => [key.toLowerCase(), value])
  );
  return names.map((name) => normalized[name.toLowerCase()]).find((value) => value !== undefined) || '';
};

const businessValue = (value) => {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value).slice(0, 500);
  }
  return String(value);
};

const findBusinessField = (value, names, visited = new Set()) => {
  if (!value || typeof value !== 'object' || visited.has(value)) {
    return '';
  }
  visited.add(value);
  const nameSet = new Set(names.map((name) => name.toLowerCase()));
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findBusinessField(item, names, visited);
      if (found) {
        return found;
      }
    }
    return '';
  }
  for (const [key, itemValue] of Object.entries(value)) {
    if (nameSet.has(key.toLowerCase())) {
      return businessValue(itemValue);
    }
  }
  for (const itemValue of Object.values(value)) {
    const found = findBusinessField(itemValue, names, visited);
    if (found) {
      return found;
    }
  }
  return '';
};

const extractBusinessFields = (responseText, headers = {}) => {
  let parsed = null;
  try {
    parsed = responseText ? JSON.parse(responseText) : null;
  } catch (_error) {
    parsed = null;
  }
  return {
    bizCode: findBusinessField(parsed, ['bizCode', 'code', 'errorCode', 'errCode']),
    bizMessage: findBusinessField(parsed, ['bizMessage', 'message', 'msg', 'errorMessage']),
    traceId: findBusinessField(parsed, ['traceId', 'traceID', 'trace_id'])
      || firstHeaderValue(headers, ['trace-id', 'x-trace-id', 'x-request-id', 'request-id']),
    errorType: findBusinessField(parsed, ['errorType', 'exception', 'exceptionType'])
      || firstHeaderValue(headers, ['error-type', 'x-error-type']),
  };
};

const timestampFromSample = (sample) => {
  if (Number.isFinite(Number(sample.timeStamp))) {
    return Number(sample.timeStamp);
  }
  const startedAt = new Date(sample.startedAt || 0).getTime();
  return Number.isFinite(startedAt) ? startedAt : 0;
};

const jtlFieldsFromResult = (result, config = {}) => {
  const success = result.success ?? result.ok ?? false;
  const status = result.responseCode ?? result.status ?? 0;
  const elapsed = result.elapsed ?? result.durationMs ?? 0;
  const url = result.URL || result.url || '';
  const method = result.method || 'HTTP';
  const label = result.label || `${method} ${url}`.trim();
  const failureMessage = result.failureMessage || result.error || (success ? '' : result.bizMessage || '');
  const threads = config.concurrency || result.allThreads || result.grpThreads || 0;
  return {
    sequence: result.sequence,
    requestId: result.requestId,
    method,
    url,
    timeStamp: timestampFromSample(result),
    elapsed,
    label,
    success,
    responseCode: String(status),
    responseMessage: result.responseMessage || result.error || '',
    failureMessage,
    URL: url,
    allThreads: result.allThreads ?? threads,
    grpThreads: result.grpThreads ?? threads,
    Latency: result.Latency ?? result.latencyMs ?? elapsed,
    Connect: result.Connect ?? result.connectMs ?? 0,
    bytes: result.bytes ?? 0,
    sentBytes: result.sentBytes ?? 0,
    bizCode: result.bizCode || '',
    bizMessage: result.bizMessage || '',
    traceId: result.traceId || '',
    errorType: result.errorType || '',
  };
};

const summarizeValues = (samples) => {
  const values = samples.map((sample) => sample.value).filter((value) => Number.isFinite(value));
  if (!values.length) {
    return { min: 0, max: 0, avg: 0, last: 0 };
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    min: round(Math.min(...values)),
    max: round(Math.max(...values)),
    avg: round(total / values.length),
    last: round(values[values.length - 1]),
  };
};

const aggregatePrometheusValues = (series, aggregation) => {
  const buckets = new Map();
  series.forEach((item) => {
    (item.values || []).forEach(([timestampSeconds, rawValue]) => {
      const value = Number(rawValue);
      if (!Number.isFinite(value)) {
        return;
      }
      const timeStamp = Math.round(Number(timestampSeconds) * 1000);
      const values = buckets.get(timeStamp) || [];
      values.push(value);
      buckets.set(timeStamp, values);
    });
  });
  return [...buckets.entries()]
    .sort(([first], [second]) => first - second)
    .map(([timeStamp, values]) => {
      const value = aggregation === 'sum'
        ? values.reduce((sum, item) => sum + item, 0)
        : values.reduce((sum, item) => sum + item, 0) / values.length;
      return { timeStamp, value: round(value) };
    });
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
  bizCodeCounts: {},
  errorTypeCounts: {},
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
  if (result.bizCode) {
    stats.bizCodeCounts[result.bizCode] = (stats.bizCodeCounts[result.bizCode] || 0) + 1;
  }
  if (result.errorType) {
    stats.errorTypeCounts[result.errorType] = (stats.errorTypeCounts[result.errorType] || 0) + 1;
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
  bizCodeCounts: stats.bizCodeCounts,
  errorTypeCounts: stats.errorTypeCounts,
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
  monitoring: report.monitoring,
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

  buildMonitoring(options = {}) {
    const provider = options.provider === 'prometheus' ? 'prometheus' : 'none';
    const enabled = options.enabled === true && provider === 'prometheus';
    const queries = {};
    RESOURCE_METRIC_KEYS.forEach((key) => {
      const definition = RESOURCE_METRIC_DEFINITIONS[key];
      queries[key] = String(options.queries?.[key] || definition.query);
    });
    return {
      enabled,
      provider,
      prometheusUrl: String(options.prometheusUrl || '').trim(),
      stepSeconds: normalizePositiveInt(options.stepSeconds, 15, 1, 3600),
      queries,
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
      monitoring: job.monitoring,
      authMode: job.authMode,
      authOverride: job.authOverride,
      targets: job.targets,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      progressPercent: job.progressPercent,
      summary,
      interfaces,
      samples: job.samples,
      jtlSamples: job.samples.map((sample) => jtlFieldsFromResult(sample, job.config)),
      errors: job.errors,
      timeline: [...job.timeline.values()].sort((first, second) => first.second - second.second),
      resourceMetrics: job.resourceMetrics || null,
      unavailableFields: job.unavailableFields || [],
      fieldLimitations: job.fieldLimitations || this.buildFieldLimitations(job.monitoring, job.resourceMetrics),
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
      monitoring: job.monitoring,
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
      monitoring: report.monitoring,
      authMode: report.authMode,
      authOverride: report.authOverride,
      targets: report.targets,
      startedAt: report.startedAt,
      finishedAt: report.finishedAt,
      progressPercent: 100,
      summary: report.summary,
      interfaces: report.interfaces,
      samples: report.samples || [],
      jtlSamples: report.jtlSamples || (report.samples || []).map((sample) => jtlFieldsFromResult(sample, report.config)),
      errors: report.errors || [],
      timeline: report.timeline || [],
      resourceMetrics: report.resourceMetrics || null,
      unavailableFields: report.unavailableFields || [],
      fieldLimitations: report.fieldLimitations || [],
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
    const monitoring = this.buildMonitoring(options.monitoring || {});
    const { mode, targets, weightedTargets } = this.buildTargets(session, authOverride, options);
    const jobId = createPressureJobId();
    const job = {
      jobId,
      sessionId,
      status: 'running',
      config,
      monitoring,
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
      resourceMetrics: null,
      unavailableFields: [],
      fieldLimitations: [],
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
    const requestStarted = Date.now();
    const startedAt = new Date(requestStarted).toISOString();
    const label = `${target.method} ${target.pressureUrl || target.originalUrl || target.id}`;
    const sentBytes = estimateSentBytes(target.request);
    try {
      const response = await fetch(target.request.url, {
        method: target.request.method,
        headers: target.request.headers,
        body: ['GET', 'HEAD'].includes(target.request.method) ? undefined : target.request.postData,
        redirect: 'manual',
        signal: controller.signal,
      });
      const responseHeadersAt = Date.now();
      const responseHeaders = responseHeadersObject(response.headers);
      const bodyBuffer = Buffer.from(await response.arrayBuffer());
      const finishedAtMs = Date.now();
      const responseText = bodyBuffer.toString('utf8');
      const businessFields = extractBusinessFields(responseText, responseHeaders);
      const elapsed = finishedAtMs - requestStarted;
      const latency = responseHeadersAt - requestStarted;
      const responseMessage = response.statusText || '';
      const failureMessage = response.ok ? '' : (businessFields.bizMessage || responseMessage || `HTTP ${response.status}`);
      const result = {
        sequence,
        requestId: target.id,
        method: target.method,
        url: target.request.url,
        ok: response.ok,
        status: response.status,
        durationMs: elapsed,
        startedAt,
        finishedAt: new Date(finishedAtMs).toISOString(),
        timeStamp: requestStarted,
        elapsed,
        label,
        success: response.ok,
        responseCode: String(response.status),
        responseMessage,
        failureMessage,
        URL: target.request.url,
        allThreads: job.config.concurrency,
        grpThreads: job.config.concurrency,
        Latency: latency,
        Connect: 0,
        bytes: bodyBuffer.length,
        sentBytes,
        latencyMs: latency,
        connectMs: 0,
        ...businessFields,
      };
      this.recordResult(job, target, result, startedMs);
    } catch (error) {
      const finishedAtMs = Date.now();
      const elapsed = finishedAtMs - requestStarted;
      const errorMessage = error.name === 'AbortError' ? `请求超时 ${job.config.timeoutMs}ms` : error.message;
      const result = {
        sequence,
        requestId: target.id,
        method: target.method,
        url: target.request.url,
        ok: false,
        status: 0,
        durationMs: elapsed,
        startedAt,
        finishedAt: new Date(finishedAtMs).toISOString(),
        error: errorMessage,
        timeStamp: requestStarted,
        elapsed,
        label,
        success: false,
        responseCode: '0',
        responseMessage: error.name || 'Error',
        failureMessage: errorMessage,
        URL: target.request.url,
        allThreads: job.config.concurrency,
        grpThreads: job.config.concurrency,
        Latency: elapsed,
        Connect: 0,
        bytes: 0,
        sentBytes,
        latencyMs: elapsed,
        connectMs: 0,
        bizCode: '',
        bizMessage: '',
        traceId: '',
        errorType: error.name || 'Error',
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

  unavailableResourceFields(reason) {
    return RESOURCE_METRIC_KEYS.map((key) => ({
      field: RESOURCE_METRIC_DEFINITIONS[key].label,
      key,
      reason,
    }));
  }

  buildFieldLimitations(monitoring, resourceMetrics = null) {
    const limitations = [
      {
        field: 'JTL Connect',
        key: 'Connect',
        reason: 'Node fetch 不暴露 DNS/TCP/TLS 建连耗时，报告中填 0。',
      },
      {
        field: 'JTL Latency',
        key: 'Latency',
        reason: '使用“请求发出到响应头返回”的耗时，不能拆分服务端首字节和网络传输细节。',
      },
      {
        field: 'JTL 样本数量',
        key: 'jtlSamples',
        reason: `报告内沿用最近 ${MAX_SAMPLES} 条样本限制，未生成全量 JTL 文件。`,
      },
    ];
    if (!monitoring?.enabled) {
      limitations.push({
        field: '资源监控',
        key: 'resourceMetrics',
        reason: '未启用 Prometheus 监控，无法从普通 HTTP 响应推断被测服务资源指标。',
      });
      return limitations;
    }
    if (!monitoring.prometheusUrl) {
      limitations.push({
        field: '资源监控',
        key: 'resourceMetrics',
        reason: '已启用 Prometheus 监控，但未配置 Prometheus URL。',
      });
      return limitations;
    }
    Object.entries(resourceMetrics?.metrics || {}).forEach(([key, metric]) => {
      if (metric.status !== 'ok') {
        limitations.push({
          field: RESOURCE_METRIC_DEFINITIONS[key]?.label || key,
          key,
          reason: metric.reason || 'Prometheus 未返回可用数据。',
        });
      }
    });
    return limitations;
  }

  async queryPrometheusRange(prometheusUrl, query, startMs, endMs, stepSeconds) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROMETHEUS_TIMEOUT_MS);
    try {
      const params = new URLSearchParams({
        query,
        start: String(Math.floor(startMs / 1000)),
        end: String(Math.ceil(endMs / 1000)),
        step: `${stepSeconds}s`,
      });
      const url = `${prometheusUrl.replace(/\/+$/, '')}/api/v1/query_range?${params.toString()}`;
      const response = await fetch(url, { signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.status !== 'success') {
        throw new Error(data.error || `Prometheus 查询失败: ${response.status}`);
      }
      return data.data?.result || [];
    } finally {
      clearTimeout(timeout);
    }
  }

  async collectPrometheusMetric(monitoring, key, startMs, endMs) {
    const definition = RESOURCE_METRIC_DEFINITIONS[key];
    const query = monitoring.queries[key] || definition.query;
    try {
      const series = await this.queryPrometheusRange(
        monitoring.prometheusUrl,
        query,
        startMs,
        endMs,
        monitoring.stepSeconds
      );
      const samples = aggregatePrometheusValues(series, definition.aggregation);
      if (!samples.length) {
        return {
          ...definition,
          key,
          query,
          status: 'unavailable',
          reason: 'Prometheus 查询成功，但没有返回时间序列数据。',
          samples: [],
          summary: summarizeValues([]),
          seriesCount: series.length,
        };
      }
      return {
        ...definition,
        key,
        query,
        status: 'ok',
        reason: '',
        samples,
        summary: summarizeValues(samples),
        seriesCount: series.length,
      };
    } catch (error) {
      return {
        ...definition,
        key,
        query,
        status: 'unavailable',
        reason: error.name === 'AbortError' ? `Prometheus 查询超时 ${PROMETHEUS_TIMEOUT_MS}ms` : error.message,
        samples: [],
        summary: summarizeValues([]),
        seriesCount: 0,
      };
    }
  }

  async collectResourceMetrics(job) {
    const monitoring = job.monitoring || this.buildMonitoring();
    const base = {
      provider: monitoring.provider,
      enabled: monitoring.enabled,
      source: monitoring.prometheusUrl || '',
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      stepSeconds: monitoring.stepSeconds,
      metrics: {},
      status: 'unavailable',
      reason: '',
    };
    if (!monitoring.enabled) {
      return {
        ...base,
        reason: '未启用 Prometheus 监控。',
        unavailableFields: this.unavailableResourceFields('未启用 Prometheus 监控。'),
      };
    }
    if (!monitoring.prometheusUrl) {
      return {
        ...base,
        reason: '未配置 Prometheus URL。',
        unavailableFields: this.unavailableResourceFields('未配置 Prometheus URL。'),
      };
    }
    const startMs = new Date(job.startedAt).getTime();
    const endMs = new Date(job.finishedAt || new Date().toISOString()).getTime();
    const metricEntries = await Promise.all(
      RESOURCE_METRIC_KEYS.map(async (key) => [key, await this.collectPrometheusMetric(monitoring, key, startMs, endMs)])
    );
    const metrics = Object.fromEntries(metricEntries);
    const unavailableFields = metricEntries
      .filter(([, metric]) => metric.status !== 'ok')
      .map(([key, metric]) => ({
        field: RESOURCE_METRIC_DEFINITIONS[key].label,
        key,
        reason: metric.reason || 'Prometheus 未返回可用数据。',
      }));
    return {
      ...base,
      metrics,
      status: unavailableFields.length ? 'partial' : 'ok',
      reason: unavailableFields.length ? '部分资源指标不可用。' : '',
      unavailableFields,
    };
  }

  async writeReport(job) {
    const { summary, interfaces } = reportSummary(job, job.finishedAt);
    const resourceMetrics = await this.collectResourceMetrics(job);
    const unavailableFields = resourceMetrics.unavailableFields || [];
    const fieldLimitations = this.buildFieldLimitations(job.monitoring, resourceMetrics);
    const report = {
      reportId: job.jobId,
      sessionId: job.sessionId,
      status: job.status,
      config: job.config,
      monitoring: job.monitoring,
      authMode: job.authMode,
      authOverride: job.authOverride,
      targets: job.targets,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      summary,
      interfaces,
      samples: job.samples,
      jtlSamples: job.samples.map((sample) => jtlFieldsFromResult(sample, job.config)),
      errors: job.errors,
      timeline: [...job.timeline.values()].sort((first, second) => first.second - second.second),
      resourceMetrics,
      unavailableFields,
      fieldLimitations,
      error: job.error || '',
    };
    job.resourceMetrics = resourceMetrics;
    job.unavailableFields = unavailableFields;
    job.fieldLimitations = fieldLimitations;
    const reportFile = await this.workspaceService.writePressureReport(job.sessionId, report);
    return { ...report, ...reportFile };
  }
}
