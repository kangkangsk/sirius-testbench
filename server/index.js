import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkspaceService } from './services/workspace-service.js';
import { CaptureService } from './services/capture-service.js';
import { ReplayService } from './services/replay-service.js';
import { PressureTestService } from './services/pressure-test-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '..');
const distDir = path.join(appRoot, 'dist');
const port = Number(process.env.PORT || 5174);

const workspaceService = new WorkspaceService(appRoot);
const captureService = new CaptureService(workspaceService);
const replayService = new ReplayService(workspaceService);
const pressureTestService = new PressureTestService(workspaceService);

const app = express();
app.use(express.json({ limit: '50mb' }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

const asyncRoute = (handler) => async (req, res, next) => {
  try {
    await handler(req, res);
  } catch (error) {
    next(error);
  }
};

app.get('/api/health', asyncRoute(async (_req, res) => {
  res.json({
    ok: true,
    service: 'sirius-testbench',
    activeCaptures: captureService.activeCount(),
  });
}));

app.get('/api/workspace', asyncRoute(async (_req, res) => {
  res.json(await workspaceService.getWorkspaceSummary());
}));

app.post('/api/workspace', asyncRoute(async (req, res) => {
  const summary = await workspaceService.setWorkspacePath(req.body.workspacePath);
  res.json(summary);
}));

app.get('/api/sessions', asyncRoute(async (_req, res) => {
  res.json(await workspaceService.listSessions());
}));

app.get('/api/sessions/:sessionId', asyncRoute(async (req, res) => {
  res.json(await workspaceService.readSession(req.params.sessionId));
}));

app.delete('/api/sessions/:sessionId', asyncRoute(async (req, res) => {
  await workspaceService.readSession(req.params.sessionId);
  await replayService.clearReplayBatches(req.params.sessionId).catch(() => null);
  await pressureTestService.clearPressureTests(req.params.sessionId).catch(() => null);
  res.json(await captureService.deleteSession(req.params.sessionId));
}));

app.patch('/api/sessions/:sessionId/requests/:requestId', asyncRoute(async (req, res) => {
  res.json(await captureService.patchRequest(req.params.sessionId, req.params.requestId, req.body));
}));

app.delete('/api/sessions/:sessionId/requests/:requestId', asyncRoute(async (req, res) => {
  res.json(await captureService.deleteRequest(req.params.sessionId, req.params.requestId));
}));

app.post('/api/sessions/:sessionId/requests/batch', asyncRoute(async (req, res) => {
  res.json(await captureService.batchPatchRequests(req.params.sessionId, req.body));
}));

app.get('/api/sessions/:sessionId/auth-override', asyncRoute(async (req, res) => {
  res.json(await workspaceService.readAuthOverride(req.params.sessionId));
}));

app.post('/api/sessions/:sessionId/auth-override', asyncRoute(async (req, res) => {
  res.json(await workspaceService.writeAuthOverride(req.params.sessionId, req.body));
}));

app.get('/api/sessions/:sessionId/pressure-config', asyncRoute(async (req, res) => {
  res.json(await workspaceService.readPressureConfig(req.params.sessionId));
}));

app.post('/api/sessions/:sessionId/pressure-config', asyncRoute(async (req, res) => {
  res.json(await workspaceService.writePressureConfig(req.params.sessionId, req.body));
}));

app.post('/api/capture/start', asyncRoute(async (req, res) => {
  res.json(await captureService.start(req.body));
}));

app.post('/api/capture/:sessionId/stop', asyncRoute(async (req, res) => {
  res.json(await captureService.stop(req.params.sessionId));
}));

app.get('/api/capture/:sessionId/status', asyncRoute(async (req, res) => {
  res.json(await captureService.status(req.params.sessionId));
}));

app.post('/api/sessions/:sessionId/replay', asyncRoute(async (req, res) => {
  res.json(await replayService.replay(req.params.sessionId, req.body));
}));

app.post('/api/sessions/:sessionId/replay/start', asyncRoute(async (req, res) => {
  res.json(await replayService.startReplay(req.params.sessionId, req.body));
}));

app.get('/api/sessions/:sessionId/replay/batches', asyncRoute(async (req, res) => {
  res.json(await replayService.listReplayBatches(req.params.sessionId));
}));

app.get('/api/sessions/:sessionId/replay/batches/:batchId', asyncRoute(async (req, res) => {
  res.json(await replayService.getReplayBatch(req.params.sessionId, req.params.batchId));
}));

app.post('/api/sessions/:sessionId/replay/batches/:batchId/requests/:requestId/retest', asyncRoute(async (req, res) => {
  res.json(await replayService.retestReplayRequest(
    req.params.sessionId,
    req.params.batchId,
    req.params.requestId,
    req.body
  ));
}));

app.post('/api/sessions/:sessionId/replay/batches/:batchId/stop', asyncRoute(async (req, res) => {
  res.json(await replayService.stopReplayBatch(req.params.sessionId, req.params.batchId));
}));

app.delete('/api/sessions/:sessionId/replay/batches/:batchId', asyncRoute(async (req, res) => {
  res.json(await replayService.deleteReplayBatch(req.params.sessionId, req.params.batchId));
}));

app.delete('/api/sessions/:sessionId/replay/batches', asyncRoute(async (req, res) => {
  res.json(await replayService.clearReplayBatches(req.params.sessionId));
}));

app.get('/api/replay/:jobId/status', asyncRoute(async (req, res) => {
  res.json(await replayService.getReplayStatus(req.params.jobId));
}));

app.get('/api/sessions/:sessionId/pressure-tests', asyncRoute(async (req, res) => {
  res.json(await pressureTestService.listPressureTests(req.params.sessionId));
}));

app.post('/api/sessions/:sessionId/pressure-tests/start', asyncRoute(async (req, res) => {
  res.json(await pressureTestService.startPressureTest(req.params.sessionId, req.body));
}));

app.get('/api/sessions/:sessionId/pressure-tests/:testId', asyncRoute(async (req, res) => {
  res.json(await pressureTestService.getPressureTest(req.params.sessionId, req.params.testId));
}));

app.post('/api/sessions/:sessionId/pressure-tests/:testId/stop', asyncRoute(async (req, res) => {
  res.json(pressureTestService.stopPressureTest(req.params.sessionId, req.params.testId));
}));

app.delete('/api/sessions/:sessionId/pressure-tests/:testId', asyncRoute(async (req, res) => {
  res.json(await pressureTestService.deletePressureTest(req.params.sessionId, req.params.testId));
}));

app.delete('/api/sessions/:sessionId/pressure-tests', asyncRoute(async (req, res) => {
  res.json(await pressureTestService.clearPressureTests(req.params.sessionId));
}));

app.post('/api/sessions/:sessionId/scripts/curl', asyncRoute(async (req, res) => {
  res.json(await replayService.generateCurlScript(req.params.sessionId, req.body));
}));

app.use(express.static(distDir));
app.get('*', (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

app.use((error, _req, res, _next) => {
  const status = error.statusCode || 500;
  res.status(status).json({
    message: error.message || '服务异常',
    detail: process.env.NODE_ENV === 'production' ? undefined : error.stack,
  });
});

app.listen(port, async () => {
  await workspaceService.ensureWorkspace();
  console.log(`HTTP capture workbench API listening on http://localhost:${port}`);
});

const shutdown = async () => {
  await captureService.stopAll();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
