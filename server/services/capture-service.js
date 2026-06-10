import { chromium } from 'playwright';
import path from 'node:path';

const BODY_TEXT_TYPES = [
  'application/json',
  'application/xml',
  'application/x-www-form-urlencoded',
  'text/',
  'javascript',
  'html',
  'xml',
];
const MAX_RESPONSE_BODY_BYTES = 2 * 1024 * 1024;

const padRequestId = (value) => String(value).padStart(4, '0');

const inferCategory = (method) => {
  if (method === 'GET') {
    return 'query';
  }
  if (method === 'DELETE') {
    return 'delete';
  }
  if (method === 'POST') {
    return 'create';
  }
  if (['PUT', 'PATCH'].includes(method)) {
    return 'update';
  }
  return 'other';
};

const normalizeTargetUrl = (value) => {
  const rawUrl = String(value || '').trim();
  if (!rawUrl) {
    return '';
  }
  if (/^https?:\/\//i.test(rawUrl)) {
    return rawUrl;
  }
  if (/^(localhost|127\.0\.0\.1|\[::1\])/i.test(rawUrl)) {
    return `http://${rawUrl}`;
  }
  return `https://${rawUrl}`;
};

const isTextResponse = (headers) => {
  const contentType = String(headers['content-type'] || headers['Content-Type'] || '').toLowerCase();
  return BODY_TEXT_TYPES.some((type) => contentType.includes(type));
};

const mergeHeader = (headers, name, value) => {
  const nextHeaders = Object.fromEntries(
    Object.entries(headers || {}).filter(([key]) => key.toLowerCase() !== String(name).toLowerCase())
  );
  nextHeaders[name] = value;
  return nextHeaders;
};

const mergeHeaderObject = (headers, nextHeaders) =>
  Object.entries(nextHeaders || {}).reduce(
    (merged, [name, value]) => mergeHeader(merged, name, value),
    { ...(headers || {}) }
  );

const mergeHeaderArray = (headers, headersArray) =>
  (headersArray || []).reduce((merged, item) => {
    if (!item?.name) {
      return merged;
    }
    return mergeHeader(merged, item.name, item.value);
  }, { ...(headers || {}) });

const hasHeader = (headers, name) =>
  Object.keys(headers || {}).some((key) => key.toLowerCase() === String(name).toLowerCase());

const withDerivedRequestHeaders = (headers, url, postData) => {
  let nextHeaders = { ...(headers || {}) };
  try {
    const parsedUrl = new URL(url);
    if (!hasHeader(nextHeaders, 'host')) {
      nextHeaders = mergeHeader(nextHeaders, 'Host', parsedUrl.host);
    }
  } catch (_error) {
    // URL already validated by the browser; ignore rare non-standard schemes here.
  }
  if (postData && !hasHeader(nextHeaders, 'content-length')) {
    nextHeaders = mergeHeader(nextHeaders, 'Content-Length', String(Buffer.byteLength(postData, 'utf8')));
  }
  return nextHeaders;
};

const safeRequestHeaderSnapshot = async (request) => {
  let headers = request.headers();
  let headersArray = [];
  const sources = ['request.headers'];
  try {
    headers = mergeHeaderObject(headers, await request.allHeaders());
    sources.push('request.allHeaders');
  } catch (error) {
    sources.push(`request.allHeaders failed: ${error.message}`);
  }
  try {
    headersArray = await request.headersArray();
    headers = mergeHeaderArray(headers, headersArray);
    sources.push('request.headersArray');
  } catch (error) {
    sources.push(`request.headersArray failed: ${error.message}`);
  }
  return { headers, headersArray, sources };
};

const safeResponseHeaderSnapshot = async (response) => {
  let headers = response.headers();
  let headersArray = [];
  const sources = ['response.headers'];
  try {
    headers = mergeHeaderObject(headers, await response.allHeaders());
    sources.push('response.allHeaders');
  } catch (error) {
    sources.push(`response.allHeaders failed: ${error.message}`);
  }
  try {
    headersArray = await response.headersArray();
    headers = mergeHeaderArray(headers, headersArray);
    sources.push('response.headersArray');
  } catch (error) {
    sources.push(`response.headersArray failed: ${error.message}`);
  }
  return { headers, headersArray, sources };
};

const safeReadBody = async (response, headers = response.headers()) => {
  if (!isTextResponse(headers)) {
    return {
      omitted: true,
      reason: '非文本响应体未保存',
      contentType: headers['content-type'] || '',
    };
  }
  try {
    const buffer = await response.body();
    const truncated = buffer.length > MAX_RESPONSE_BODY_BYTES;
    const bodyBuffer = truncated ? buffer.subarray(0, MAX_RESPONSE_BODY_BYTES) : buffer;
    return {
      text: bodyBuffer.toString('utf8'),
      size: buffer.length,
      truncated,
    };
  } catch (error) {
    return {
      omitted: true,
      reason: error.message,
      contentType: headers['content-type'] || '',
    };
  }
};

export class CaptureService {
  constructor(workspaceService) {
    this.workspaceService = workspaceService;
    this.activeSessions = new Map();
  }

  activeCount() {
    return this.activeSessions.size;
  }

  activeHttpRequests(active) {
    return active.requests.filter((request) => this.workspaceService.classifyTraffic(request) === 'http');
  }

  async patchRequest(sessionId, requestId, patch) {
    const active = this.activeSessions.get(sessionId);
    if (!active) {
      return this.workspaceService.patchRequest(sessionId, requestId, patch);
    }
    const item = active.requests.find((request) =>
      request.id === requestId && this.workspaceService.classifyTraffic(request) === 'http'
    );
    if (!item) {
      const error = new Error(`请求不存在: ${requestId}`);
      error.statusCode = 404;
      throw error;
    }
    Object.assign(item, patch, { updatedAt: new Date().toISOString() });
    const meta = await this.workspaceService.writeSessionReviewSnapshot(sessionId, active.meta, active.requests);
    active.meta = meta;
    return this.workspaceService.buildSessionPayload(meta, active.requests);
  }

  async deleteRequest(sessionId, requestId) {
    const active = this.activeSessions.get(sessionId);
    if (!active) {
      return this.workspaceService.deleteRequest(sessionId, requestId);
    }
    const index = active.requests.findIndex((request) =>
      request.id === requestId && this.workspaceService.classifyTraffic(request) === 'http'
    );
    if (index < 0) {
      const error = new Error(`请求不存在: ${requestId}`);
      error.statusCode = 404;
      throw error;
    }
    active.requests.splice(index, 1);
    const meta = await this.workspaceService.writeSessionReviewSnapshot(sessionId, active.meta, active.requests);
    active.meta = meta;
    return this.workspaceService.buildSessionPayload(meta, active.requests);
  }

  async deleteSession(sessionId) {
    const active = this.activeSessions.get(sessionId);
    if (active) {
      await active.context.close().catch(() => null);
      active.meta.status = 'stopped';
      active.meta.stoppedAt = new Date().toISOString();
      await active.writeSnapshot(active.meta).catch(() => null);
      this.activeSessions.delete(sessionId);
    }
    return this.workspaceService.deleteSession(sessionId);
  }

  async batchPatchRequests(sessionId, body) {
    const active = this.activeSessions.get(sessionId);
    if (!active) {
      return this.workspaceService.batchPatchRequests(sessionId, body);
    }
    const batchResult = this.workspaceService.applyBatchTrafficOperation(active.requests, body);
    active.requests.splice(0, active.requests.length, ...batchResult.entries);
    const meta = await this.workspaceService.writeSessionReviewSnapshot(sessionId, active.meta, active.requests);
    active.meta = meta;
    return {
      ...this.workspaceService.buildSessionPayload(meta, active.requests),
      deletedCount: batchResult.deletedCount,
      updatedCount: batchResult.updatedCount,
    };
  }

  async start(body) {
    const targetUrl = normalizeTargetUrl(body.targetUrl);
    if (!targetUrl) {
      const error = new Error('目标 URL 不能为空');
      error.statusCode = 400;
      throw error;
    }
    try {
      new URL(targetUrl);
    } catch (_error) {
      const error = new Error(`目标 URL 不合法: ${targetUrl}`);
      error.statusCode = 400;
      throw error;
    }
    const { sessionDir, meta } = await this.workspaceService.createSession(targetUrl, body.sessionName);
    const requests = [];
    const requestIds = new Map();
    const attachedTargets = new WeakSet();
    let sequence = 0;
    let snapshotChain = Promise.resolve();

    const writeSnapshot = (nextMeta = meta) => {
      snapshotChain = snapshotChain.then(() =>
        this.workspaceService.writeSessionSnapshot(meta.id, nextMeta, requests)
      );
      return snapshotChain;
    };

    const context = await chromium.launchPersistentContext(path.join(sessionDir, 'browser-profile'), {
      headless: false,
      ignoreHTTPSErrors: true,
      viewport: null,
      recordHar: {
        path: meta.harPath,
        content: 'embed',
        mode: 'full',
      },
      args: ['--start-maximized', '--ignore-certificate-errors'],
    });

    const attachNetworkListeners = (target) => {
      if (attachedTargets.has(target)) {
        return;
      }
      attachedTargets.add(target);
      target.on('request', async (request) => {
        sequence += 1;
        const id = padRequestId(sequence);
        requestIds.set(request, id);
        const url = request.url();
        const parsedUrl = (() => {
          try {
            return new URL(url);
          } catch (_error) {
            return null;
          }
        })();
        const postData = request.postData();
        const item = {
          id,
          sequence,
          enabled: true,
          category: inferCategory(request.method()),
          method: request.method(),
          url,
          host: parsedUrl?.host || '',
          pathname: parsedUrl?.pathname || '',
          resourceType: request.resourceType(),
          trafficType: this.workspaceService.classifyTraffic({
            resourceType: request.resourceType(),
            url,
            pathname: parsedUrl?.pathname || '',
          }),
          headers: withDerivedRequestHeaders(request.headers(), url, postData),
          headersArray: [],
          headerCapture: {
            sources: ['request.headers'],
            complete: false,
          },
          postData,
          timestamp: new Date().toISOString(),
          status: 'pending',
          response: null,
          failure: null,
          durationMs: null,
        };
        requests.push(item);
        if (meta.status !== 'stopped') {
          meta.status = 'capturing';
        }
        await writeSnapshot(meta);
        const headerSnapshot = await safeRequestHeaderSnapshot(request);
        item.headers = withDerivedRequestHeaders(headerSnapshot.headers, url, postData);
        item.headersArray = headerSnapshot.headersArray;
        item.headerCapture = {
          sources: headerSnapshot.sources,
          complete: true,
          capturedAt: new Date().toISOString(),
        };
        await writeSnapshot(meta);
      });

      target.on('response', async (response) => {
        const request = response.request();
        const id = requestIds.get(request);
        if (!id) {
          return;
        }
        const item = requests.find((requestItem) => requestItem.id === id);
        if (!item) {
          return;
        }
        const receivedAt = new Date().toISOString();
        const headerSnapshot = await safeResponseHeaderSnapshot(response);
        item.status = 'completed';
        item.response = {
          status: response.status(),
          statusText: response.statusText(),
          url: response.url(),
          headers: headerSnapshot.headers,
          headersArray: headerSnapshot.headersArray,
          headerCapture: {
            sources: headerSnapshot.sources,
            complete: true,
            capturedAt: receivedAt,
          },
          body: await safeReadBody(response, headerSnapshot.headers),
          receivedAt,
        };
        item.durationMs = Math.max(0, new Date(receivedAt).getTime() - new Date(item.timestamp).getTime());
        await writeSnapshot(meta);
      });

      target.on('requestfailed', async (request) => {
        const id = requestIds.get(request);
        const item = requests.find((requestItem) => requestItem.id === id);
        if (!item) {
          return;
        }
        item.status = 'failed';
        item.failure = request.failure();
        item.durationMs = Math.max(0, Date.now() - new Date(item.timestamp).getTime());
        await writeSnapshot(meta);
      });
    };

    attachNetworkListeners(context);
    const page = await context.newPage();
    this.activeSessions.set(meta.id, { context, meta, requests, writeSnapshot });

    meta.status = 'capturing';
    await writeSnapshot(meta);
    page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(async (error) => {
      meta.openWarning = error.message;
      await writeSnapshot(meta);
    });
    return {
      meta,
      session: this.workspaceService.buildSessionPayload(meta, requests),
      message: '已启动有界面 Chromium，请在新打开的浏览器中完成登录和操作。',
    };
  }

  async stop(sessionId) {
    const active = this.activeSessions.get(sessionId);
    if (!active) {
      const session = await this.workspaceService.readSession(sessionId);
      return {
        meta: session.meta,
        requests: session.requests,
        resources: session.resources,
        message: '该会话当前没有活跃浏览器进程。',
      };
    }
    await active.context.close();
    active.meta.status = 'stopped';
    active.meta.stoppedAt = new Date().toISOString();
    const meta = await this.workspaceService.writeSessionSnapshot(sessionId, active.meta, active.requests);
    this.activeSessions.delete(sessionId);
    return {
      ...this.workspaceService.buildSessionPayload(meta, active.requests),
      message: '抓包会话已停止，HAR 文件已写入。',
    };
  }

  async stopAll() {
    const ids = [...this.activeSessions.keys()];
    await Promise.all(ids.map((id) => this.stop(id).catch(() => null)));
  }

  async status(sessionId) {
    const active = this.activeSessions.get(sessionId);
    if (active) {
      const meta = await this.workspaceService.writeSessionSnapshot(sessionId, active.meta, active.requests);
      return { active: true, ...this.workspaceService.buildSessionPayload(meta, active.requests) };
    }
    const session = await this.workspaceService.readSession(sessionId);
    return { active: false, ...session };
  }
}
