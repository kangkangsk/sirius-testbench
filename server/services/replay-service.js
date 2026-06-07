import net from 'node:net';

const MAX_REPLAY_BODY_BYTES = 512 * 1024;
const MAX_RETEST_HISTORY = 20;
const DEFAULT_REPLAY_TIMEOUT_MS = 10000;
const DEFAULT_PORTS = {
  'http:': 80,
  'https:': 443,
};

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

const cookieMapFromHeader = (cookieHeader) => {
  const cookieMap = new Map();
  normalizeCookieHeader(cookieHeader).split('; ').forEach((pair) => {
    const equalIndex = pair.indexOf('=');
    if (equalIndex > 0) {
      cookieMap.set(pair.slice(0, equalIndex), pair);
    }
  });
  return cookieMap;
};

const cookieHeaderFromMap = (cookieMap) => [...cookieMap.values()].join('; ');

const splitCombinedSetCookie = (value) => {
  if (!value) {
    return [];
  }
  return String(value).split(/,(?=\s*[^;,=\s]+=[^;,]+)/g).map((item) => item.trim()).filter(Boolean);
};

const mergeSetCookieHeaders = (cookieMap, setCookieHeaders) => {
  setCookieHeaders.forEach((header) => {
    const pair = String(header || '').split(';')[0]?.trim();
    const equalIndex = pair.indexOf('=');
    if (equalIndex > 0) {
      cookieMap.set(pair.slice(0, equalIndex), pair);
    }
  });
  return cookieHeaderFromMap(cookieMap);
};

const getSetCookieHeaders = (headers) => {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }
  return splitCombinedSetCookie(headers.get('set-cookie'));
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

const normalizeTimeoutMs = (value) => {
  const timeoutMs = Number(value);
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_REPLAY_TIMEOUT_MS;
};

const endpointFromUrl = (url) => {
  try {
    const parsed = new URL(url);
    const port = parsed.port || DEFAULT_PORTS[parsed.protocol];
    if (!parsed.hostname || !port) {
      return null;
    }
    return {
      protocol: parsed.protocol,
      hostname: parsed.hostname.replace(/^\[|\]$/g, ''),
      port: Number(port),
    };
  } catch (_error) {
    return null;
  }
};

const endpointLabel = (endpoint) => `${endpoint.hostname}:${endpoint.port}`;

const uniqueEndpointsFromRequests = (requests) => {
  const endpointMap = new Map();
  requests.forEach((request) => {
    const endpoint = endpointFromUrl(request.url);
    if (!endpoint) {
      return;
    }
    endpointMap.set(`${endpoint.protocol}//${endpoint.hostname}:${endpoint.port}`, endpoint);
  });
  return [...endpointMap.values()];
};

const testEndpoint = (endpoint, timeoutMs) => new Promise((resolve) => {
  const startedAt = Date.now();
  const socket = net.createConnection({
    host: endpoint.hostname,
    port: endpoint.port,
    timeout: timeoutMs,
  });
  let settled = false;
  const finish = (ok, error = '') => {
    if (settled) {
      return;
    }
    settled = true;
    socket.destroy();
    resolve({
      ...endpoint,
      label: endpointLabel(endpoint),
      ok,
      durationMs: Date.now() - startedAt,
      error,
    });
  };
  socket.once('connect', () => finish(true));
  socket.once('timeout', () => finish(false, `连接超时 ${timeoutMs}ms`));
  socket.once('error', (error) => finish(false, error.message));
});

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
      if (key && value !== undefined && value !== null) {
        if (key.toLowerCase() === 'cookie') {
          overrideCookie = String(value);
        } else {
          headers[key] = String(value);
        }
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

const withCookieHeader = (request, cookieHeader) => {
  if (!cookieHeader) {
    return request;
  }
  return {
    ...request,
    headers: setCookieHeader(request.headers || {}, cookieHeader),
  };
};

const readResponseText = async (response) => {
  const text = await response.text();
  const truncated = Buffer.byteLength(text, 'utf8') > MAX_REPLAY_BODY_BYTES;
  return {
    text: truncated ? text.slice(0, MAX_REPLAY_BODY_BYTES) : text,
    truncated,
  };
};

const executeSingleReplayRequest = async (request, options = {}) => {
  const method = String(request.method || 'GET').toUpperCase();
  const headers = stripUnsafeHeaders(request.headers || {});
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const requestStarted = Date.now();
  const requestStartedAt = new Date().toISOString();
  const baseResult = {
    id: request.id,
    sequence: request.sequence,
    sourceSequence: request.sourceSequence,
    method,
    url: request.url,
    category: request.category,
    resourceType: request.resourceType,
    enabled: request.enabled,
    headers,
    postData: request.postData,
    authSource: options.authSource || request.authSource || 'retest',
  };

  try {
    const response = await fetch(request.url, {
      method,
      headers,
      body: ['GET', 'HEAD'].includes(method) ? undefined : request.postData,
      redirect: 'manual',
      signal: controller.signal,
    });
    const responseBody = await readResponseText(response);
    const responseHeaders = Object.fromEntries(response.headers.entries());
    const setCookieHeaders = getSetCookieHeaders(response.headers);
    const receivedAt = new Date().toISOString();
    return {
      ...baseResult,
      loginCookieCaptured: options.isLoginStep ? setCookieHeaders.length > 0 : request.loginCookieCaptured,
      loginSetCookieHeaders: options.isLoginStep ? setCookieHeaders : request.loginSetCookieHeaders,
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      durationMs: Date.now() - requestStarted,
      startedAt: requestStartedAt,
      finishedAt: receivedAt,
      responseHeaders,
      responseBody,
      response: {
        status: response.status,
        statusText: response.statusText,
        url: response.url,
        headers: responseHeaders,
        body: responseBody,
        receivedAt,
      },
    };
  } catch (error) {
    return {
      ...baseResult,
      ok: false,
      status: 0,
      statusText: 'REQUEST_FAILED',
      durationMs: Date.now() - requestStarted,
      startedAt: requestStartedAt,
      finishedAt: new Date().toISOString(),
      error: error.message,
    };
  } finally {
    clearTimeout(timeout);
  }
};

const shellEscape = (value) => `'${String(value).replace(/'/g, "'\"'\"'")}'`;

const createReplayJobId = () =>
  `${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${Math.random().toString(36).slice(2, 8)}`;

const replayRowFromRequest = (request) => ({
  id: request.id,
  sequence: request.sequence,
  method: request.method,
  url: request.url,
  category: request.category,
  resourceType: request.resourceType,
  enabled: request.enabled,
  runStatus: 'queued',
  ok: null,
  status: null,
  statusText: '',
  durationMs: null,
  error: '',
  startedAt: null,
  finishedAt: null,
});

const sortBySequence = (first, second) =>
  Number(first.sequence || first.sourceSequence || 0) - Number(second.sequence || second.sourceSequence || 0);

const replayRowFromResult = (result) => ({
  ...result,
  replayed: true,
  runStatus: result.ok ? 'passed' : 'failed',
});

const retestRecordFromResult = (result, attempt) => ({
  attempt,
  retestedAt: result.finishedAt,
  id: result.id,
  sequence: result.sequence,
  sourceSequence: result.sourceSequence,
  method: result.method,
  url: result.url,
  category: result.category,
  resourceType: result.resourceType,
  enabled: result.enabled,
  headers: result.headers,
  postData: result.postData,
  authSource: result.authSource,
  ok: result.ok,
  status: result.status,
  statusText: result.statusText,
  durationMs: result.durationMs,
  startedAt: result.startedAt,
  finishedAt: result.finishedAt,
  error: result.error,
  responseHeaders: result.responseHeaders,
  responseBody: result.responseBody,
  response: result.response,
});

const mergeRetestResult = (previousResult, result) => {
  const retestCount = Number(previousResult.retestCount || 0) + 1;
  const latestRetestResult = retestRecordFromResult(result, retestCount);
  const retestResults = [
    ...(Array.isArray(previousResult.retestResults) ? previousResult.retestResults : []),
    latestRetestResult,
  ].slice(-MAX_RETEST_HISTORY);
  return {
    ...previousResult,
    ...result,
    retest: true,
    retestCount,
    retestedAt: result.finishedAt,
    latestRetestResult,
    retestResults,
  };
};

const requestBrief = (request) => request
  ? {
      id: request.id,
      sequence: request.sequence,
      method: request.method,
      url: request.url,
      category: request.category,
      resourceType: request.resourceType,
    }
  : null;

const resolveLoginRequest = (session, enabledRequests, options = {}) => {
  if (options.loginRequestId) {
    return session.requests.find((request) => request.id === options.loginRequestId) || null;
  }
  return enabledRequests.find((request) => request.category === 'login') || null;
};

const buildReplayPlan = (session, options = {}) => {
  const enabledRequests = session.requests.filter((request) => request.enabled !== false);
  const loginRequest = resolveLoginRequest(session, enabledRequests, options);
  const replayRequests = loginRequest
    ? [
        loginRequest,
        ...enabledRequests.filter((request) => request.id !== loginRequest.id),
      ]
    : enabledRequests;
  return { enabledRequests, loginRequest, replayRequests };
};

const loginCookieFromReport = (report, loginResult) => {
  const authOverride = report.authOverride || {};
  const authMode = report.authMode || report.replayOptions?.authMode || 'raw';
  const cookieMap = cookieMapFromHeader(authMode === 'override' ? authOverride.cookie : '');
  return mergeSetCookieHeaders(cookieMap, loginResult?.loginSetCookieHeaders || []);
};

const buildRetestRequest = (result, report, results) => {
  const isLoginStep = Boolean(report.hasLoginRequest && result.id === report.loginRequestId);
  const loginResult = results.find((item) => item.id === report.loginRequestId);
  let request = {
    id: result.id,
    sequence: result.sequence,
    sourceSequence: result.sourceSequence,
    method: result.method,
    url: result.url,
    category: result.category,
    resourceType: result.resourceType,
    enabled: result.enabled,
    headers: result.headers || {},
    postData: result.postData,
    loginCookieCaptured: result.loginCookieCaptured,
    loginSetCookieHeaders: result.loginSetCookieHeaders,
  };

  if (isLoginStep) {
    request = {
      ...request,
      headers: removeHeader(request.headers || {}, 'cookie'),
    };
  } else if (report.hasLoginRequest) {
    const runtimeCookie = loginCookieFromReport(report, loginResult);
    if (runtimeCookie) {
      request = withCookieHeader(request, runtimeCookie);
    }
  }

  return {
    request,
    isLoginStep,
    authSource: isLoginStep ? 'login-request' : (report.hasLoginRequest ? 'login-cookie' : (report.authMode || 'raw')),
  };
};

export class ReplayService {
  constructor(workspaceService) {
    this.workspaceService = workspaceService;
    this.replayJobs = new Map();
  }

  serializeJob(job) {
    return {
      jobId: job.jobId,
      batchId: job.jobId,
      sessionId: job.sessionId,
      status: job.status,
      authMode: job.authMode,
      authOverride: job.authOverride,
      replayOptions: job.replayOptions,
      preflightCheck: job.preflightCheck,
      hasLoginRequest: job.hasLoginRequest,
      loginRequestId: job.loginRequestId,
      loginRequest: job.loginRequest,
      loginPolicy: job.loginPolicy,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      total: job.total,
      completed: job.completed,
      passed: job.passed,
      failed: job.failed,
      progressPercent: job.total ? Math.round((job.completed / job.total) * 100) : 100,
      currentRequestId: job.currentRequestId,
      rows: [...job.rows.values()].sort(sortBySequence),
      results: job.results,
      report: job.report,
      reportId: job.reportId || null,
      reportPath: job.reportPath || null,
      error: job.error || '',
    };
  }

  serializeBatchSummary(job) {
    return {
      jobId: job.jobId,
      batchId: job.jobId,
      sessionId: job.sessionId,
      status: job.status,
      authMode: job.authMode,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      total: job.total,
      completed: job.completed,
      passed: job.passed,
      failed: job.failed,
      progressPercent: job.total ? Math.round((job.completed / job.total) * 100) : 100,
      currentRequestId: job.currentRequestId,
      hasLoginRequest: job.hasLoginRequest,
      loginRequestId: job.loginRequestId,
      loginRequest: job.loginRequest,
      loginPolicy: job.loginPolicy,
      reportId: job.reportId || null,
      reportPath: job.reportPath || null,
      error: job.error || '',
    };
  }

  serializeReport(report) {
    const rows = (report.results || []).map(replayRowFromResult).sort(sortBySequence);
    return {
      jobId: report.reportId,
      batchId: report.reportId,
      sessionId: report.sessionId,
      status: 'completed',
      authMode: report.authMode,
      authOverride: report.authOverride,
      replayOptions: report.replayOptions || {
        authMode: report.authMode,
        delayMs: 0,
        timeoutMs: DEFAULT_REPLAY_TIMEOUT_MS,
      },
      preflightCheck: report.preflightCheck,
      hasLoginRequest: report.hasLoginRequest,
      loginRequestId: report.loginRequestId,
      loginRequest: report.loginRequest,
      loginPolicy: report.loginPolicy,
      startedAt: report.startedAt,
      finishedAt: report.finishedAt,
      total: report.total,
      completed: report.total,
      passed: report.passed,
      failed: report.failed,
      progressPercent: 100,
      currentRequestId: null,
      rows,
      results: report.results || [],
      report,
      reportId: report.reportId,
      reportPath: report.reportPath || '',
      error: '',
    };
  }

  serializeReportSummary(report) {
    return {
      jobId: report.reportId,
      batchId: report.reportId,
      sessionId: report.sessionId,
      status: 'completed',
      authMode: report.authMode,
      startedAt: report.startedAt,
      finishedAt: report.finishedAt,
      total: report.total,
      completed: report.total,
      passed: report.passed,
      failed: report.failed,
      progressPercent: 100,
      currentRequestId: null,
      hasLoginRequest: report.hasLoginRequest,
      loginRequestId: report.loginRequestId,
      loginRequest: report.loginRequest,
      loginPolicy: report.loginPolicy,
      reportId: report.reportId,
      reportPath: report.reportPath || '',
      error: '',
    };
  }

  async listReplayBatches(sessionId) {
    const activeSummaries = [...this.replayJobs.values()]
      .filter((job) => job.sessionId === sessionId)
      .map((job) => this.serializeBatchSummary(job));
    const activeIds = new Set(activeSummaries.map((item) => item.batchId));
    const fileSummaries = (await this.workspaceService.listReports(sessionId))
      .filter((report) => !activeIds.has(report.reportId))
      .map((report) => this.serializeReportSummary(report));
    return [...activeSummaries, ...fileSummaries]
      .sort((first, second) => String(second.startedAt).localeCompare(String(first.startedAt)));
  }

  getReplayStatus(jobId) {
    const job = this.replayJobs.get(jobId);
    if (!job) {
      const error = new Error(`回放任务不存在: ${jobId}`);
      error.statusCode = 404;
      throw error;
    }
    return this.serializeJob(job);
  }

  async getReplayBatch(sessionId, batchId) {
    const job = this.replayJobs.get(batchId);
    if (job?.sessionId === sessionId) {
      return this.serializeJob(job);
    }
    const report = await this.workspaceService.readReport(sessionId, batchId);
    return this.serializeReport(report);
  }

  cancelJob(job) {
    job.cancelled = true;
    job.abortController?.abort();
  }

  async stopReplayBatch(sessionId, batchId) {
    const job = this.replayJobs.get(batchId);
    if (!job || job.sessionId !== sessionId) {
      const error = new Error(`运行中的回放批次不存在: ${batchId}`);
      error.statusCode = 404;
      throw error;
    }
    if (job.status === 'running') {
      job.status = 'stopping';
      job.finishedAt = new Date().toISOString();
      this.cancelJob(job);
    }
    return this.serializeJob(job);
  }

  async deleteReplayBatch(sessionId, batchId) {
    const job = this.replayJobs.get(batchId);
    if (job?.sessionId === sessionId) {
      this.cancelJob(job);
      this.replayJobs.delete(batchId);
    }
    await this.workspaceService.deleteReport(sessionId, batchId);
    return { deleted: true, batchId };
  }

  async clearReplayBatches(sessionId) {
    [...this.replayJobs.values()]
      .filter((job) => job.sessionId === sessionId)
      .forEach((job) => {
        this.cancelJob(job);
        this.replayJobs.delete(job.jobId);
      });
    await this.workspaceService.clearReports(sessionId);
    return { cleared: true };
  }

  async startReplay(sessionId, options = {}) {
    const session = await this.workspaceService.readSession(sessionId);
    const authOverride = await this.workspaceService.readAuthOverride(sessionId);
    const replayConfig = {
      ...options,
      loginRequestId: options.loginRequestId || authOverride.loginRequestId || '',
    };
    const { loginRequest, replayRequests } = buildReplayPlan(session, replayConfig);
    const hasLoginRequest = Boolean(loginRequest);
    const jobId = createReplayJobId();
    const authMode = options.authMode || authOverride.mode || 'raw';
    const replayOptions = {
      authMode,
      delayMs: Number(options.delayMs || 0),
      timeoutMs: normalizeTimeoutMs(options.timeoutMs),
      loginRequestId: loginRequest?.id || '',
    };
    const job = {
      jobId,
      sessionId,
      authMode: replayOptions.authMode,
      authOverride,
      replayOptions,
      preflightCheck: null,
      hasLoginRequest,
      loginRequestId: loginRequest?.id || '',
      loginRequest: requestBrief(loginRequest),
      loginPolicy: hasLoginRequest
        ? '先单独执行登录接口，并把登录响应 Set-Cookie 合并后写入后续所有请求头。'
        : '未选择登录接口，按当前登录态模式处理请求。',
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      total: replayRequests.length,
      completed: 0,
      passed: 0,
      failed: 0,
      currentRequestId: null,
      rows: new Map(replayRequests.map((request) => [request.id, replayRowFromRequest(request)])),
      results: [],
      report: null,
      reportId: null,
      reportPath: null,
      error: '',
      cancelled: false,
      abortController: null,
    };
    this.replayJobs.set(job.jobId, job);

    this.runReplaySequence(sessionId, {
      ...replayOptions,
      authOverrideSnapshot: authOverride,
      loginRequestId: replayOptions.loginRequestId,
      reportId: jobId,
    }, {
      shouldStop: () => job.cancelled,
      onAbortController: (controller) => {
        job.abortController = controller;
      },
      onPreflightFinish: (preflightCheck) => {
        job.preflightCheck = preflightCheck;
      },
      onRequestStart: ({ sourceRequest, request, index, startedAt }) => {
        job.currentRequestId = sourceRequest.id;
        job.rows.set(sourceRequest.id, {
          ...replayRowFromRequest(sourceRequest),
          ...request,
          replaySequence: index + 1,
          runStatus: 'running',
          startedAt,
        });
      },
      onRequestFinish: ({ sourceRequest, result, finishedAt }) => {
        job.completed += 1;
        job.passed += result.ok ? 1 : 0;
        job.failed += result.ok ? 0 : 1;
        job.currentRequestId = null;
        job.results.push(result);
        job.rows.set(sourceRequest.id, {
          ...replayRowFromRequest(sourceRequest),
          ...result,
          runStatus: result.ok ? 'passed' : 'failed',
          replayed: true,
          finishedAt,
        });
      },
      onFinish: (report) => {
        job.status = 'completed';
        job.finishedAt = report.finishedAt;
        job.report = report;
        job.reportId = report.reportId;
        job.reportPath = report.reportPath;
      },
      onError: (error) => {
        job.status = error.isReplayCancelled ? 'stopped' : 'failed';
        job.finishedAt = job.finishedAt || new Date().toISOString();
        job.error = error.isReplayCancelled ? '' : error.message;
        if (error.isReplayCancelled && job.currentRequestId) {
          const row = job.rows.get(job.currentRequestId);
          if (row) {
            job.rows.set(job.currentRequestId, {
              ...row,
              runStatus: 'stopped',
              error: '用户停止回放',
              finishedAt: job.finishedAt,
            });
          }
        }
        job.currentRequestId = null;
      },
    }).catch((error) => {
      job.status = error.isReplayCancelled ? 'stopped' : 'failed';
      job.finishedAt = job.finishedAt || new Date().toISOString();
      job.error = error.isReplayCancelled ? '' : error.message;
      if (error.isReplayCancelled && job.currentRequestId) {
        const row = job.rows.get(job.currentRequestId);
        if (row) {
          job.rows.set(job.currentRequestId, {
            ...row,
            runStatus: 'stopped',
            error: '用户停止回放',
            finishedAt: job.finishedAt,
          });
        }
      }
      job.currentRequestId = null;
    });

    return this.serializeJob(job);
  }

  async replay(sessionId, options = {}) {
    return this.runReplaySequence(sessionId, options);
  }

  async runReplaySequence(sessionId, options = {}, hooks = {}) {
    const session = await this.workspaceService.readSession(sessionId);
    const authOverride = options.authOverrideSnapshot || await this.workspaceService.readAuthOverride(sessionId);
    const replayConfig = {
      ...options,
      loginRequestId: options.loginRequestId || authOverride.loginRequestId || '',
    };
    const { loginRequest, replayRequests: sourceRequests } = buildReplayPlan(session, replayConfig);
    const delayMs = Number(options.delayMs || 0);
    const timeoutMs = normalizeTimeoutMs(options.timeoutMs);
    const mode = options.authMode || authOverride.mode || 'raw';
    const hasLoginRequest = Boolean(loginRequest);
    const loginPolicy = hasLoginRequest
      ? '先单独执行登录接口，并把登录响应 Set-Cookie 合并后写入后续所有请求头。'
      : '未选择登录接口，按当前登录态模式处理请求。';
    const cookieMap = cookieMapFromHeader(mode === 'override' ? authOverride.cookie : '');
    let runtimeCookie = cookieHeaderFromMap(cookieMap);
    const startedAt = new Date().toISOString();
    const results = [];
    const replayRequests = sourceRequests.map((sourceRequest) => ({
      sourceRequest,
      request: applyAuthOverride(sourceRequest, authOverride, mode),
    }));
    const writeReplayReport = async (preflightCheck = null) => {
      const report = {
        reportId: options.reportId,
        sessionId,
        authMode: mode,
        replayOptions: {
          authMode: mode,
          delayMs,
          timeoutMs,
          loginRequestId: loginRequest?.id || '',
        },
        authOverride,
        preflightCheck,
        hasLoginRequest,
        loginRequestId: loginRequest?.id || '',
        loginRequest: requestBrief(loginRequest),
        loginPolicy,
        startedAt,
        finishedAt: new Date().toISOString(),
        total: results.length,
        passed: results.filter((item) => item.ok).length,
        failed: results.filter((item) => !item.ok).length,
        results,
      };
      const reportFile = await this.workspaceService.writeReport(sessionId, report);
      const finalReport = { ...report, ...reportFile };
      hooks.onFinish?.(finalReport);
      return finalReport;
    };

    const endpointChecks = await Promise.all(
      uniqueEndpointsFromRequests(replayRequests.map(({ request }) => request))
        .map((endpoint) => testEndpoint(endpoint, timeoutMs))
    );
    const failedEndpointChecks = endpointChecks.filter((item) => !item.ok);
    const preflightCheck = {
      ok: failedEndpointChecks.length === 0,
      timeoutMs,
      checkedAt: new Date().toISOString(),
      endpoints: endpointChecks,
    };
    hooks.onPreflightFinish?.(preflightCheck);
    if (!preflightCheck.ok) {
      const failedEndpointText = failedEndpointChecks.map(endpointLabel).join('、');
      const errorText = `目标服务不可达：${failedEndpointText}，超时时间 ${timeoutMs}ms`;
      replayRequests.forEach(({ sourceRequest, request }, index) => {
        const finishedAt = new Date().toISOString();
        const result = {
          id: request.id,
          sequence: index + 1,
          sourceSequence: sourceRequest.sequence,
          method: request.method,
          url: request.url,
          category: request.category,
          resourceType: request.resourceType,
          enabled: request.enabled,
          headers: request.headers,
          postData: request.postData,
          authSource: mode,
          ok: false,
          status: 0,
          statusText: 'TARGET_UNREACHABLE',
          durationMs: 0,
          startedAt: finishedAt,
          finishedAt,
          error: errorText,
          preflightCheck,
        };
        results.push(result);
        hooks.onRequestFinish?.({
          sourceRequest,
          result,
          index,
          total: replayRequests.length,
          finishedAt,
        });
      });
      return writeReplayReport(preflightCheck);
    }

    for (const [index, { sourceRequest, request: baseRequest }] of replayRequests.entries()) {
      if (hooks.shouldStop?.()) {
        const error = new Error('回放批次已取消');
        error.isReplayCancelled = true;
        throw error;
      }
      const isLoginStep = hasLoginRequest && sourceRequest.id === loginRequest.id;
      let request = { ...baseRequest };
      if (isLoginStep) {
        request = {
          ...request,
          headers: removeHeader(request.headers || {}, 'cookie'),
        };
      }
      if (hasLoginRequest && !isLoginStep && runtimeCookie) {
        request = withCookieHeader(request, runtimeCookie);
      }
      const controller = new AbortController();
      hooks.onAbortController?.(controller);
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const requestStarted = Date.now();
      const requestStartedAt = new Date().toISOString();
      hooks.onRequestStart?.({
        sourceRequest,
        request,
        index,
        total: replayRequests.length,
        startedAt: requestStartedAt,
      });
      try {
        const response = await fetch(request.url, {
          method: request.method,
          headers: request.headers,
          body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.postData,
          redirect: 'manual',
          signal: controller.signal,
        });
        const responseBody = await readResponseText(response);
        const setCookieHeaders = getSetCookieHeaders(response.headers);
        if (isLoginStep && setCookieHeaders.length) {
          runtimeCookie = mergeSetCookieHeaders(cookieMap, setCookieHeaders);
        }
        const responseHeaders = Object.fromEntries(response.headers.entries());
        const receivedAt = new Date().toISOString();
        results.push({
          id: request.id,
          sequence: index + 1,
          sourceSequence: sourceRequest.sequence,
          method: request.method,
          url: request.url,
          category: request.category,
          resourceType: request.resourceType,
          enabled: request.enabled,
          headers: request.headers,
          postData: request.postData,
          authSource: isLoginStep ? 'login-request' : (hasLoginRequest ? 'login-cookie' : mode),
          loginCookieCaptured: isLoginStep && setCookieHeaders.length > 0,
          loginSetCookieHeaders: isLoginStep ? setCookieHeaders : undefined,
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          durationMs: Date.now() - requestStarted,
          startedAt: requestStartedAt,
          finishedAt: receivedAt,
          responseHeaders,
          responseBody,
          response: {
            status: response.status,
            statusText: response.statusText,
            url: response.url,
            headers: responseHeaders,
            body: responseBody,
            receivedAt,
          },
        });
      } catch (error) {
        if (hooks.shouldStop?.()) {
          const cancelError = new Error('回放批次已取消');
          cancelError.isReplayCancelled = true;
          throw cancelError;
        }
        results.push({
          id: request.id,
          sequence: index + 1,
          sourceSequence: sourceRequest.sequence,
          method: request.method,
          url: request.url,
          category: request.category,
          resourceType: request.resourceType,
          enabled: request.enabled,
          headers: request.headers,
          postData: request.postData,
          authSource: isLoginStep ? 'login-request' : (hasLoginRequest ? 'login-cookie' : mode),
          ok: false,
          status: 0,
          statusText: 'REQUEST_FAILED',
          durationMs: Date.now() - requestStarted,
          startedAt: requestStartedAt,
          finishedAt: new Date().toISOString(),
          error: error.message,
        });
      } finally {
        clearTimeout(timeout);
      }
      hooks.onRequestFinish?.({
        sourceRequest,
        result: results[results.length - 1],
        index,
        total: replayRequests.length,
        finishedAt: results[results.length - 1].finishedAt,
      });
      if (delayMs > 0 && index < replayRequests.length - 1) {
        await sleep(delayMs);
      }
    }

    if (hooks.shouldStop?.()) {
      const error = new Error('回放批次已取消');
      error.isReplayCancelled = true;
      throw error;
    }

    return writeReplayReport(preflightCheck);
  }

  async retestReplayRequest(sessionId, batchId, requestId, options = {}) {
    const job = this.replayJobs.get(batchId);
    if (job?.sessionId === sessionId) {
      return this.retestReplayJobRequest(job, requestId, options);
    }
    const report = await this.workspaceService.readReport(sessionId, batchId);
    return this.retestReplayReportRequest(sessionId, report, requestId, options);
  }

  async retestReplayJobRequest(job, requestId, options = {}) {
    if (['running', 'stopping'].includes(job.status)) {
      const error = new Error('回放批次运行中，结束后再重新测试单个接口');
      error.statusCode = 409;
      throw error;
    }
    const resultIndex = job.results.findIndex((item) => String(item.id) === String(requestId));
    if (resultIndex < 0) {
      const error = new Error(`回放日志中找不到接口: ${requestId}`);
      error.statusCode = 404;
      throw error;
    }

    const previousResult = job.results[resultIndex];
    const reportLike = {
      authMode: job.authMode,
      authOverride: job.authOverride,
      replayOptions: job.replayOptions,
      hasLoginRequest: job.hasLoginRequest,
      loginRequestId: job.loginRequestId,
    };
    const { request, isLoginStep, authSource } = buildRetestRequest(previousResult, reportLike, job.results);
    const startedAt = new Date().toISOString();
    job.currentRequestId = request.id;
    job.rows.set(request.id, {
      ...(job.rows.get(request.id) || {}),
      ...request,
      runStatus: 'running',
      startedAt,
      finishedAt: null,
      error: '',
    });

    const result = await executeSingleReplayRequest(request, {
      timeoutMs: options.timeoutMs || job.replayOptions?.timeoutMs,
      authSource,
      isLoginStep,
    });
    const nextResult = mergeRetestResult(previousResult, result);

    job.results.splice(resultIndex, 1, nextResult);
    job.completed = job.results.length;
    job.passed = job.results.filter((item) => item.ok).length;
    job.failed = job.results.filter((item) => !item.ok).length;
    job.currentRequestId = null;
    job.lastRetestedAt = nextResult.retestedAt;
    job.rows.set(request.id, {
      ...(job.rows.get(request.id) || {}),
      ...nextResult,
      runStatus: nextResult.ok ? 'passed' : 'failed',
      replayed: true,
    });

    if (job.report || job.reportId) {
      const report = {
        ...(job.report || {}),
        reportId: job.reportId || job.jobId,
        sessionId: job.sessionId,
        authMode: job.authMode,
        replayOptions: job.replayOptions,
        authOverride: job.authOverride,
        preflightCheck: job.preflightCheck,
        hasLoginRequest: job.hasLoginRequest,
        loginRequestId: job.loginRequestId,
        loginRequest: job.loginRequest,
        loginPolicy: job.loginPolicy,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt || new Date().toISOString(),
        total: job.results.length,
        passed: job.passed,
        failed: job.failed,
        results: job.results,
        lastRetestedAt: job.lastRetestedAt,
      };
      const reportFile = await this.workspaceService.writeReport(job.sessionId, report);
      const finalReport = { ...report, ...reportFile };
      job.report = finalReport;
      job.reportId = finalReport.reportId;
      job.reportPath = finalReport.reportPath;
    }

    return this.serializeJob(job);
  }

  async retestReplayReportRequest(sessionId, report, requestId, options = {}) {
    const results = [...(report.results || [])];
    const resultIndex = results.findIndex((item) => String(item.id) === String(requestId));
    if (resultIndex < 0) {
      const error = new Error(`回放日志中找不到接口: ${requestId}`);
      error.statusCode = 404;
      throw error;
    }

    const previousResult = results[resultIndex];
    const { request, isLoginStep, authSource } = buildRetestRequest(previousResult, report, results);
    const result = await executeSingleReplayRequest(request, {
      timeoutMs: options.timeoutMs || report.replayOptions?.timeoutMs,
      authSource,
      isLoginStep,
    });
    const nextResult = mergeRetestResult(previousResult, result);
    results.splice(resultIndex, 1, nextResult);

    const nextReport = {
      ...report,
      total: results.length,
      passed: results.filter((item) => item.ok).length,
      failed: results.filter((item) => !item.ok).length,
      results,
      lastRetestedAt: nextResult.retestedAt,
    };
    const reportFile = await this.workspaceService.writeReport(sessionId, nextReport);
    return this.serializeReport({ ...nextReport, ...reportFile });
  }

  async generateCurlScript(sessionId, options = {}) {
    const session = await this.workspaceService.readSession(sessionId);
    const authOverride = await this.workspaceService.readAuthOverride(sessionId);
    const mode = options.authMode || authOverride.mode || 'raw';
    const lines = ['#!/usr/bin/env bash', 'set -euo pipefail', ''];
    session.requests
      .filter((request) => request.enabled !== false)
      .forEach((sourceRequest) => {
        const request = applyAuthOverride(sourceRequest, authOverride, mode);
        lines.push(`echo ${shellEscape(`[${request.id}] ${request.method} ${request.url}`)}`);
        lines.push(`curl -i -X ${shellEscape(request.method)} ${shellEscape(request.url)} \\`);
        const headerEntries = Object.entries(request.headers || {});
        headerEntries.forEach(([key, value], index) => {
          const suffix = index === headerEntries.length - 1 && !request.postData ? '' : ' \\';
          lines.push(`  -H ${shellEscape(`${key}: ${value}`)}${suffix}`);
        });
        if (request.postData) {
          lines.push(`  --data-raw ${shellEscape(request.postData)}`);
        }
        lines.push('');
      });
    const fileName = mode === 'override' ? 'replay-with-auth.sh' : 'replay-raw.sh';
    const scriptPath = await this.workspaceService.writeScript(sessionId, fileName, `${lines.join('\n')}\n`);
    return { scriptPath, fileName, authMode: mode };
  }
}
