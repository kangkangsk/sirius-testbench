const request = async (url, options = {}) => {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || `请求失败: ${response.status}`);
  }
  return data;
};

const postJson = (url, body) =>
  request(url, {
    method: 'POST',
    body: JSON.stringify(body || {}),
  });

export const getWorkspace = () => request('/api/workspace');

export const saveWorkspace = (workspacePath) => postJson('/api/workspace', { workspacePath });

export const listSessions = () => request('/api/sessions');

export const getSession = (sessionId) => request(`/api/sessions/${encodeURIComponent(sessionId)}`);

export const deleteSession = (sessionId) =>
  request(`/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  });

export const startCapture = (payload) => postJson('/api/capture/start', payload);

export const stopCapture = (sessionId) => postJson(`/api/capture/${encodeURIComponent(sessionId)}/stop`);

export const getCaptureStatus = (sessionId) =>
  request(`/api/capture/${encodeURIComponent(sessionId)}/status`);

export const patchRequest = (sessionId, requestId, patch) =>
  request(`/api/sessions/${encodeURIComponent(sessionId)}/requests/${encodeURIComponent(requestId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });

export const deleteRequest = (sessionId, requestId) =>
  request(`/api/sessions/${encodeURIComponent(sessionId)}/requests/${encodeURIComponent(requestId)}`, {
    method: 'DELETE',
  });

export const batchPatchRequests = (sessionId, payload) =>
  postJson(`/api/sessions/${encodeURIComponent(sessionId)}/requests/batch`, payload);

export const getAuthOverride = (sessionId) =>
  request(`/api/sessions/${encodeURIComponent(sessionId)}/auth-override`);

export const saveAuthOverride = (sessionId, payload) =>
  postJson(`/api/sessions/${encodeURIComponent(sessionId)}/auth-override`, payload);

export const getPressureConfig = (sessionId) =>
  request(`/api/sessions/${encodeURIComponent(sessionId)}/pressure-config`);

export const savePressureConfig = (sessionId, payload) =>
  postJson(`/api/sessions/${encodeURIComponent(sessionId)}/pressure-config`, payload);

export const replaySession = (sessionId, payload) =>
  postJson(`/api/sessions/${encodeURIComponent(sessionId)}/replay`, payload);

export const startReplaySession = (sessionId, payload) =>
  postJson(`/api/sessions/${encodeURIComponent(sessionId)}/replay/start`, payload);

export const getReplayStatus = (jobId) =>
  request(`/api/replay/${encodeURIComponent(jobId)}/status`);

export const listReplayBatches = (sessionId) =>
  request(`/api/sessions/${encodeURIComponent(sessionId)}/replay/batches`);

export const getReplayBatch = (sessionId, batchId) =>
  request(`/api/sessions/${encodeURIComponent(sessionId)}/replay/batches/${encodeURIComponent(batchId)}`);

export const retestReplayRequest = (sessionId, batchId, requestId, payload) =>
  postJson(`/api/sessions/${encodeURIComponent(sessionId)}/replay/batches/${encodeURIComponent(batchId)}/requests/${encodeURIComponent(requestId)}/retest`, payload);

export const stopReplayBatch = (sessionId, batchId) =>
  postJson(`/api/sessions/${encodeURIComponent(sessionId)}/replay/batches/${encodeURIComponent(batchId)}/stop`);

export const deleteReplayBatch = (sessionId, batchId) =>
  request(`/api/sessions/${encodeURIComponent(sessionId)}/replay/batches/${encodeURIComponent(batchId)}`, {
    method: 'DELETE',
  });

export const clearReplayBatches = (sessionId) =>
  request(`/api/sessions/${encodeURIComponent(sessionId)}/replay/batches`, {
    method: 'DELETE',
  });

export const listPressureTests = (sessionId) =>
  request(`/api/sessions/${encodeURIComponent(sessionId)}/pressure-tests`);

export const startPressureTest = (sessionId, payload) =>
  postJson(`/api/sessions/${encodeURIComponent(sessionId)}/pressure-tests/start`, payload);

export const getPressureTest = (sessionId, testId) =>
  request(`/api/sessions/${encodeURIComponent(sessionId)}/pressure-tests/${encodeURIComponent(testId)}`);

export const stopPressureTest = (sessionId, testId) =>
  postJson(`/api/sessions/${encodeURIComponent(sessionId)}/pressure-tests/${encodeURIComponent(testId)}/stop`);

export const deletePressureTest = (sessionId, testId) =>
  request(`/api/sessions/${encodeURIComponent(sessionId)}/pressure-tests/${encodeURIComponent(testId)}`, {
    method: 'DELETE',
  });

export const clearPressureTests = (sessionId) =>
  request(`/api/sessions/${encodeURIComponent(sessionId)}/pressure-tests`, {
    method: 'DELETE',
  });

export const generateCurlScript = (sessionId, payload) =>
  postJson(`/api/sessions/${encodeURIComponent(sessionId)}/scripts/curl`, payload);
