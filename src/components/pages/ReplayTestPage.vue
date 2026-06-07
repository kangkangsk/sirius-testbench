<template>
  <div class="page-stack">
    <a-card class="panel-card">
      <PageSectionHeader
        title="回放测试"
        description="后台按抓包顺序执行 enabled 请求；登录接口从“登录态替换”配置读取，并自动接续 Cookie。"
      />
      <div class="filter-grid session-filter-grid replay-filter-grid">
        <a-form-item label="抓包会话" class="session-form-item">
          <a-select
            v-model:value="selectedSessionId"
            show-search
            option-filter-prop="label"
            :filter-option="filterSessionOption"
            :options="sessionOptions"
            placeholder="选择会话"
            @change="handleSessionChange"
          />
        </a-form-item>
        <a-form-item label="请求间隔 ms">
          <a-input-number v-model:value="options.delayMs" class="full-width" :min="0" :step="100" />
        </a-form-item>
        <a-form-item label="超时时间 ms">
          <a-input-number v-model:value="options.timeoutMs" class="full-width" :min="1000" :step="1000" />
        </a-form-item>
      </div>
      <a-space wrap>
        <a-button
          type="primary"
          :loading="starting || activeBatchRunning"
          :disabled="!selectedSessionId || activeBatchRunning"
          @click="runReplay"
        >
          <template #icon><PlayCircleOutlined /></template>
          {{ activeBatchRunning ? '回放中' : '运行回放' }}
        </a-button>
        <a-button
          danger
          :loading="Boolean(stoppingBatchId)"
          :disabled="!runningBatch || runningBatch.status !== 'running'"
          @click="stopCurrentReplay"
        >
          <template #icon><PauseCircleOutlined /></template>
          停止回放
        </a-button>
        <a-button :disabled="!selectedSessionId" @click="refreshSession">
          <template #icon><ReloadOutlined /></template>
          刷新请求
        </a-button>
        <a-button danger :disabled="!selectedSessionId || !batches.length" @click="confirmClearBatches">
          <template #icon><DeleteOutlined /></template>
          清空批次
        </a-button>
      </a-space>
    </a-card>

    <a-card class="table-card">
      <PageSectionHeader title="回放批次" description="每次点击运行回放都会生成新批次；批次在后台执行，切换页面不会取消。" />
      <a-table
        row-key="batchId"
        :columns="batchColumns"
        :data-source="batches"
        :pagination="{ pageSize: 6 }"
        :scroll="{ x: 1180 }"
        size="middle"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'batchId'">
            <a-typography-text :copyable="{ text: record.batchId }" class="url-text">
              {{ record.batchId }}
            </a-typography-text>
          </template>
          <template v-else-if="column.key === 'status'">
            <a-tag :color="batchStatusColor(record.status)">{{ batchStatusLabel(record.status) }}</a-tag>
          </template>
          <template v-else-if="column.key === 'progress'">
            {{ record.completed }}/{{ record.total }}
          </template>
          <template v-else-if="column.key === 'authMode'">
            {{ authModeLabel(record.authMode) }}
          </template>
          <template v-else-if="column.key === 'startedAt'">
            {{ formatSessionTime(record.startedAt) }}
          </template>
          <template v-else-if="column.key === 'finishedAt'">
            {{ formatSessionTime(record.finishedAt) }}
          </template>
          <template v-else-if="column.key === 'action'">
            <a-space>
              <a-button type="link" @click="selectBatch(record)">查看</a-button>
              <a-button v-if="record.status === 'running'" type="link" danger @click="stopBatch(record)">停止</a-button>
              <a-button type="link" @click="openBatchDetail(record)">详情</a-button>
              <a-button type="link" @click="openBatchAuthConfig(record)">配置</a-button>
              <a-button type="link" danger @click="confirmDeleteBatch(record)">删除</a-button>
            </a-space>
          </template>
        </template>
      </a-table>
    </a-card>

    <a-card class="detail-card">
      <PageSectionHeader
        title="登录态替换配置"
        description="以下内容来自“登录态替换”页面保存结果，回放测试只读取不修改。"
      />
      <a-descriptions bordered size="small" :column="1">
        <a-descriptions-item label="覆盖模式">{{ authModeLabel(authOverride.mode) }}</a-descriptions-item>
        <a-descriptions-item label="登录接口">{{ authLoginRequestLabel }}</a-descriptions-item>
        <a-descriptions-item label="目标地址">{{ authEndpointLabel }}</a-descriptions-item>
        <a-descriptions-item label="Cookie">
          <a-typography-paragraph copyable class="url-text">{{ authOverride.cookie || '-' }}</a-typography-paragraph>
        </a-descriptions-item>
        <a-descriptions-item label="统一 Header">
          <pre class="code-block">{{ stringifyConfig(authOverride.headers || {}) }}</pre>
        </a-descriptions-item>
        <a-descriptions-item label="替换规则">
          <pre class="code-block">{{ stringifyConfig(authOverride.replacements || []) }}</pre>
        </a-descriptions-item>
        <a-descriptions-item label="保存时间">{{ formatSessionTime(authOverride.updatedAt) }}</a-descriptions-item>
      </a-descriptions>
    </a-card>

    <a-card v-if="replayJob" class="detail-card">
      <PageSectionHeader title="实时进展" :description="progressDescription" />
      <a-progress :percent="progressPercent" :status="progressBarStatus" />
      <a-descriptions bordered size="small" :column="1" class="replay-progress-detail">
        <a-descriptions-item label="批次 ID">{{ replayJob.batchId || replayJob.jobId }}</a-descriptions-item>
        <a-descriptions-item label="批次状态">{{ batchStatusLabel(replayJob.status) }}</a-descriptions-item>
        <a-descriptions-item label="当前请求">{{ currentReplayLabel }}</a-descriptions-item>
        <a-descriptions-item label="已完成">{{ progressText }}</a-descriptions-item>
      </a-descriptions>
    </a-card>

    <div class="metric-grid">
      <DashboardMetricCard title="启用请求" :value="enabledRequests.length" :icon="ApiOutlined" :on-click="() => setResultFilter('all')" />
      <DashboardMetricCard title="总体进展" :value="progressText" :icon="FileDoneOutlined" :on-click="() => setResultFilter('all')" />
      <DashboardMetricCard title="通过" :value="passedCount" :icon="CheckCircleOutlined" :on-click="() => setResultFilter('passed')" />
      <DashboardMetricCard title="失败" :value="failedCount" :icon="CloseCircleOutlined" :on-click="() => setResultFilter('failed')" />
    </div>

    <a-card class="table-card">
      <PageSectionHeader
        title="回放请求清单"
        :description="requestListDescription"
      />
      <a-table
        row-key="id"
        :columns="columns"
        :data-source="filteredReplayRows"
        :pagination="{ pageSize: 10 }"
        :scroll="{ x: 1360 }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'ok'">
            <a-tag :color="replayStatusColor(record.runStatus)">
              {{ replayStatusLabel(record.runStatus) }}
            </a-tag>
          </template>
          <template v-else-if="column.key === 'method'">
            <a-tag :color="methodColor(record.method)">{{ record.method }}</a-tag>
          </template>
          <template v-else-if="column.key === 'url'">
            <a-tooltip :title="record.url">{{ shortUrl(record.url) }}</a-tooltip>
          </template>
          <template v-else-if="column.key === 'originalStatus'">
            <a-tag v-if="record.originalStatus !== null && record.originalStatus !== undefined" :color="responseStatusColor(record.originalStatus)">
              {{ record.originalStatus }}
            </a-tag>
            <span v-else>-</span>
          </template>
          <template v-else-if="column.key === 'status'">
            <a-tag v-if="record.runStatus === 'running'" color="blue">执行中</a-tag>
            <a-tag v-else-if="['passed', 'failed'].includes(record.runStatus)" :color="responseStatusColor(record.status)">
              {{ record.status || 'ERR' }}
            </a-tag>
            <a-tag v-else-if="record.response" :color="responseStatusColor(record.response.status)">
              {{ record.response.status }}
            </a-tag>
            <span v-else>-</span>
          </template>
          <template v-else-if="column.key === 'error'">
            <a-typography-text type="danger">{{ record.error || '-' }}</a-typography-text>
          </template>
          <template v-else-if="column.key === 'action'">
            <a-space>
              <a-button type="link" @click="openDetail(record)">详情</a-button>
              <a-button
                type="link"
                :loading="retestingRequestId === record.id"
                :disabled="!canRetestRow(record)"
                @click="retestRequest(record)"
              >
                重测
              </a-button>
            </a-space>
          </template>
        </template>
      </a-table>
    </a-card>

    <a-drawer
      title="回放批次详情"
      :open="batchDetailOpen"
      :width="780"
      @close="batchDetailOpen = false"
    >
      <a-space direction="vertical" class="full-width" :size="16">
        <a-descriptions bordered size="small" :column="1">
          <a-descriptions-item label="批次 ID">{{ replayJob?.batchId || '-' }}</a-descriptions-item>
          <a-descriptions-item label="状态">{{ batchStatusLabel(replayJob?.status) }}</a-descriptions-item>
          <a-descriptions-item label="登录态模式">{{ authModeLabel(replayJob?.authMode) }}</a-descriptions-item>
          <a-descriptions-item label="登录接口">{{ loginRequestLabel(replayJob?.loginRequest) }}</a-descriptions-item>
          <a-descriptions-item label="登录态配置">
            <a-button size="small" @click="batchAuthConfigOpen = true">查看配置快照</a-button>
          </a-descriptions-item>
          <a-descriptions-item label="目标连通性">{{ preflightLabel(replayJob?.preflightCheck) }}</a-descriptions-item>
          <a-descriptions-item label="登录策略">{{ replayJob?.loginPolicy || '-' }}</a-descriptions-item>
          <a-descriptions-item label="执行时间">
            {{ formatSessionTime(replayJob?.startedAt) }} ~ {{ formatSessionTime(replayJob?.finishedAt) }}
          </a-descriptions-item>
          <a-descriptions-item label="报告路径">
            <a-typography-paragraph copyable class="url-text">{{ replayJob?.reportPath || '-' }}</a-typography-paragraph>
          </a-descriptions-item>
        </a-descriptions>

        <a-card class="panel-card" size="small" title="批次请求">
          <a-table
            row-key="id"
            :columns="detailColumns"
            :data-source="replayJob?.rows || []"
            :pagination="{ pageSize: 6 }"
            :scroll="{ x: 1080 }"
            size="small"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'ok'">
                <a-tag :color="replayStatusColor(record.runStatus)">
                  {{ replayStatusLabel(record.runStatus) }}
                </a-tag>
              </template>
              <template v-else-if="column.key === 'method'">
                <a-tag :color="methodColor(record.method)">{{ record.method }}</a-tag>
              </template>
              <template v-else-if="column.key === 'url'">
                <a-tooltip :title="record.url">{{ shortUrl(record.url) }}</a-tooltip>
              </template>
              <template v-else-if="column.key === 'originalStatus'">
                <a-tag v-if="record.originalStatus !== null && record.originalStatus !== undefined" :color="responseStatusColor(record.originalStatus)">
                  {{ record.originalStatus }}
                </a-tag>
                <span v-else>-</span>
              </template>
              <template v-else-if="column.key === 'status'">
                {{ record.status || '-' }}
              </template>
              <template v-else-if="column.key === 'action'">
                <a-space>
                  <a-button type="link" size="small" @click="openDetail(record)">详情</a-button>
                  <a-button
                    type="link"
                    size="small"
                    :loading="retestingRequestId === record.id"
                    :disabled="!canRetestRow(record)"
                    @click="retestRequest(record)"
                  >
                    重测
                  </a-button>
                </a-space>
              </template>
            </template>
          </a-table>
        </a-card>
      </a-space>
    </a-drawer>

    <a-modal
      title="批次登录态替换配置"
      :open="batchAuthConfigOpen"
      :width="760"
      :footer="null"
      @cancel="batchAuthConfigOpen = false"
    >
      <a-descriptions bordered size="small" :column="1">
        <a-descriptions-item label="批次 ID">{{ replayJob?.batchId || replayJob?.jobId || '-' }}</a-descriptions-item>
        <a-descriptions-item label="覆盖模式">{{ authModeLabel(replayJob?.authMode) }}</a-descriptions-item>
        <a-descriptions-item label="登录接口">{{ loginRequestLabel(replayJob?.loginRequest) }}</a-descriptions-item>
        <a-descriptions-item label="协议">{{ replayJob?.authOverride?.endpoint?.protocol || '-' }}</a-descriptions-item>
        <a-descriptions-item label="IP / 域名">{{ replayJob?.authOverride?.endpoint?.hostname || '-' }}</a-descriptions-item>
        <a-descriptions-item label="端口">{{ replayJob?.authOverride?.endpoint?.port || '-' }}</a-descriptions-item>
        <a-descriptions-item label="Cookie">
          <a-typography-paragraph copyable class="url-text">{{ replayJob?.authOverride?.cookie || '-' }}</a-typography-paragraph>
        </a-descriptions-item>
        <a-descriptions-item label="请求头">
          <pre class="code-block">{{ stringifyConfig(replayJob?.authOverride?.headers || {}) }}</pre>
        </a-descriptions-item>
        <a-descriptions-item label="替换规则">
          <pre class="code-block">{{ stringifyConfig(replayJob?.authOverride?.replacements || []) }}</pre>
        </a-descriptions-item>
      </a-descriptions>
    </a-modal>

    <RequestDetailDrawer :open="detailOpen" :request="detailRequest" @close="detailOpen = false" />
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { Modal, message } from 'ant-design-vue';
import {
  ApiOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  FileDoneOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons-vue';
import DashboardMetricCard from '../common/DashboardMetricCard.vue';
import PageSectionHeader from '../common/PageSectionHeader.vue';
import RequestDetailDrawer from '../common/RequestDetailDrawer.vue';
import {
  clearReplayBatches,
  deleteReplayBatch,
  getAuthOverride,
  getReplayBatch,
  getSession,
  listReplayBatches,
  listSessions,
  retestReplayRequest,
  startReplaySession,
  stopReplayBatch,
} from '../../utils/workbench-api.js';
import {
  filterSessionOption,
  formatSessionTime,
  methodColor,
  responseStatusColor,
  sessionOptionLabel,
  shortUrl,
} from '../../utils/formatters.js';

const sessions = ref([]);
const selectedSessionId = ref(null);
const currentSession = ref({ meta: null, requests: [] });
const authOverride = ref(createEmptyAuthOverride());
const batches = ref([]);
const selectedBatchId = ref(null);
const replayJob = ref(null);
const starting = ref(false);
const stoppingBatchId = ref(null);
const retestingRequestId = ref(null);
const detailOpen = ref(false);
const detailRequest = ref(null);
const batchDetailOpen = ref(false);
const batchAuthConfigOpen = ref(false);
const resultFilter = ref('all');
let replayTimer = null;

const options = reactive({
  delayMs: 0,
  timeoutMs: 10000,
});

function createEmptyAuthOverride() {
  return {
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
}

const normalizeAuthOverride = (config = {}) => ({
  ...createEmptyAuthOverride(),
  ...config,
  mode: config.mode === 'raw' ? 'raw' : 'override',
  headers: config.headers || {},
  loginRequestId: config.loginRequestId || '',
  endpoint: {
    ...createEmptyAuthOverride().endpoint,
    ...(config.endpoint || {}),
  },
  replacements: Array.isArray(config.replacements) ? config.replacements : [],
  updatedAt: config.updatedAt || null,
});

const columns = [
  { title: '结果', key: 'ok', width: 90, fixed: 'left' },
  { title: '序号', dataIndex: 'id', key: 'id', width: 90 },
  { title: '方法', dataIndex: 'method', key: 'method', width: 90 },
  { title: 'URL', dataIndex: 'url', key: 'url', ellipsis: true },
  { title: '原始响应', dataIndex: 'originalStatus', key: 'originalStatus', width: 110 },
  { title: '回放响应', dataIndex: 'status', key: 'status', width: 100 },
  { title: '耗时', dataIndex: 'durationMs', key: 'durationMs', width: 100 },
  { title: '错误', dataIndex: 'error', key: 'error', width: 220 },
  { title: '操作', key: 'action', fixed: 'right', width: 130 },
];

const detailColumns = [
  { title: '结果', key: 'ok', width: 90 },
  { title: '序号', dataIndex: 'id', key: 'id', width: 90 },
  { title: '方法', dataIndex: 'method', key: 'method', width: 90 },
  { title: 'URL', dataIndex: 'url', key: 'url', ellipsis: true },
  { title: '原始响应', dataIndex: 'originalStatus', key: 'originalStatus', width: 100 },
  { title: '回放响应', dataIndex: 'status', key: 'status', width: 90 },
  { title: '耗时', dataIndex: 'durationMs', key: 'durationMs', width: 90 },
  { title: '操作', key: 'action', fixed: 'right', width: 120 },
];

const batchColumns = [
  { title: '批次 ID', dataIndex: 'batchId', key: 'batchId', width: 220 },
  { title: '状态', key: 'status', width: 100 },
  { title: '进度', key: 'progress', width: 100 },
  { title: '通过', dataIndex: 'passed', key: 'passed', width: 80 },
  { title: '失败', dataIndex: 'failed', key: 'failed', width: 80 },
  { title: '登录态', dataIndex: 'authMode', key: 'authMode', width: 110 },
  { title: '开始时间', dataIndex: 'startedAt', key: 'startedAt', width: 180 },
  { title: '结束时间', dataIndex: 'finishedAt', key: 'finishedAt', width: 180 },
  { title: '操作', key: 'action', fixed: 'right', width: 230 },
];

const sessionOptions = computed(() =>
  sessions.value.map((session) => ({
    value: session.id,
    label: sessionOptionLabel(session),
  }))
);
const requests = computed(() => currentSession.value.requests || []);
const enabledRequests = computed(() =>
  requests.value.filter((request) => request.enabled !== false)
);
const authLoginRequest = computed(() =>
  requests.value.find((request) => request.id === authOverride.value.loginRequestId) || null
);
const authLoginRequestLabel = computed(() => {
  if (authLoginRequest.value) {
    return loginRequestLabel(authLoginRequest.value);
  }
  return authOverride.value.loginRequestId || '未选择';
});
const authEndpointLabel = computed(() => {
  const endpoint = authOverride.value.endpoint || {};
  const protocol = endpoint.protocol ? `${String(endpoint.protocol).replace(/:$/, '')}://` : '';
  const hostname = endpoint.hostname || '';
  const port = endpoint.port ? `:${endpoint.port}` : '';
  if (!protocol && !hostname && !port) {
    return '不替换';
  }
  return `${protocol}${hostname || '*'}${port}`;
});
const activeBatchRunning = computed(() =>
  batches.value.some((batch) => ['running', 'stopping'].includes(batch.status))
    || ['running', 'stopping'].includes(replayJob.value?.status)
);
const runningBatch = computed(() =>
  ['running', 'stopping'].includes(replayJob.value?.status)
    ? replayJob.value
    : batches.value.find((batch) => ['running', 'stopping'].includes(batch.status))
);
const replayRowsById = computed(() =>
  new Map((replayJob.value?.rows || []).map((row) => [row.id, row]))
);
const replayRows = computed(() =>
  (replayJob.value?.rows?.length ? replayJob.value.rows : enabledRequests.value).map((request) => {
    const row = replayRowsById.value.get(request.id);
    const source = requests.value.find((item) => item.id === request.id) || request;
    const originalStatus = source.response?.status ?? null;
    const originalStatusText = source.response?.statusText || '';
    return row
      ? {
          ...source,
          ...row,
          originalStatus,
          originalStatusText,
          sourceRequest: source,
          replayed: ['running', 'passed', 'failed', 'stopped'].includes(row.runStatus),
        }
      : { ...source, originalStatus, originalStatusText, runStatus: 'idle', replayed: false };
  })
);
const filteredReplayRows = computed(() => {
  if (resultFilter.value === 'passed') {
    return replayRows.value.filter((row) => row.runStatus === 'passed');
  }
  if (resultFilter.value === 'failed') {
    return replayRows.value.filter((row) => row.runStatus === 'failed');
  }
  return replayRows.value;
});
const passedCount = computed(() => replayJob.value?.passed ?? 0);
const failedCount = computed(() => replayJob.value?.failed ?? 0);
const progressText = computed(() => {
  const total = replayJob.value?.total ?? enabledRequests.value.length;
  const completed = replayJob.value?.completed ?? 0;
  return `${completed}/${total}`;
});
const progressPercent = computed(() => replayJob.value?.progressPercent ?? 0);
const progressBarStatus = computed(() => {
  if (replayJob.value?.status === 'failed') {
    return 'exception';
  }
  if (progressPercent.value >= 100 && replayJob.value) {
    return 'success';
  }
  return 'active';
});
const currentReplayLabel = computed(() => {
  const currentId = replayJob.value?.currentRequestId;
  if (!currentId) {
    return '-';
  }
  const row = replayRows.value.find((item) => item.id === currentId);
  return row ? `${row.method} ${shortUrl(row.url)}` : currentId;
});
const progressDescription = computed(() =>
  replayJob.value?.status === 'running'
    ? '当前批次正在后台按抓包顺序逐个执行，页面只负责实时读取状态。'
    : '展示当前选中回放批次的执行进展。'
);
const requestListDescription = computed(() => {
  const labels = {
    all: '仅展示启用请求；点击上方总体进展、通过、失败指标可以切换筛选。',
    passed: '当前仅展示通过的请求。',
    failed: '当前仅展示失败的请求。',
  };
  return labels[resultFilter.value] || labels.all;
});

const loadSessions = async () => {
  sessions.value = await listSessions();
  if (!selectedSessionId.value && sessions.value[0]) {
    selectedSessionId.value = sessions.value[0].id;
  }
};

const loadSession = async () => {
  if (!selectedSessionId.value) {
    currentSession.value = { meta: null, requests: [] };
    authOverride.value = createEmptyAuthOverride();
    return;
  }
  const [session, authConfig] = await Promise.all([
    getSession(selectedSessionId.value),
    getAuthOverride(selectedSessionId.value),
  ]);
  currentSession.value = session;
  authOverride.value = normalizeAuthOverride(authConfig);
};

const clearReplayTimer = () => {
  if (replayTimer) {
    window.clearInterval(replayTimer);
    replayTimer = null;
  }
};

const summarizeJob = (job) => ({
  batchId: job.batchId || job.jobId,
  jobId: job.jobId || job.batchId,
  sessionId: job.sessionId,
  status: job.status,
  authMode: job.authMode,
  startedAt: job.startedAt,
  finishedAt: job.finishedAt,
  total: job.total,
  completed: job.completed,
  passed: job.passed,
  failed: job.failed,
  progressPercent: job.progressPercent,
  currentRequestId: job.currentRequestId,
  hasLoginRequest: job.hasLoginRequest,
  loginRequestId: job.loginRequestId,
  loginRequest: job.loginRequest,
  loginPolicy: job.loginPolicy,
  reportId: job.reportId,
  reportPath: job.reportPath,
  error: job.error,
});

const upsertBatchSummary = (job) => {
  const summary = summarizeJob(job);
  const index = batches.value.findIndex((batch) => batch.batchId === summary.batchId);
  if (index >= 0) {
    batches.value.splice(index, 1, summary);
  } else {
    batches.value.unshift(summary);
  }
};

const loadBatch = async (batchId) => {
  if (!selectedSessionId.value || !batchId) {
    replayJob.value = null;
    selectedBatchId.value = null;
    return;
  }
  selectedBatchId.value = batchId;
  replayJob.value = await getReplayBatch(selectedSessionId.value, batchId);
  upsertBatchSummary(replayJob.value);
  if (['running', 'stopping'].includes(replayJob.value.status)) {
    startReplayPolling();
  } else {
    clearReplayTimer();
  }
};

const loadBatches = async ({ restore = true } = {}) => {
  if (!selectedSessionId.value) {
    batches.value = [];
    replayJob.value = null;
    selectedBatchId.value = null;
    return;
  }
  batches.value = await listReplayBatches(selectedSessionId.value);
  if (!restore) {
    return;
  }
  const current = batches.value.find((batch) => batch.batchId === selectedBatchId.value);
  const runningBatch = batches.value.find((batch) => batch.status === 'running');
  const nextBatch = current || runningBatch || batches.value[0];
  if (nextBatch) {
    await loadBatch(nextBatch.batchId);
  } else {
    replayJob.value = null;
    selectedBatchId.value = null;
    clearReplayTimer();
  }
};

const refreshSession = async () => {
  await loadSessions();
  await loadSession();
  await loadBatches();
};

const handleSessionChange = async () => {
  clearReplayTimer();
  replayJob.value = null;
  selectedBatchId.value = null;
  resultFilter.value = 'all';
  await loadSession();
  await loadBatches();
};

const pollReplayStatus = async () => {
  if (!selectedSessionId.value || !selectedBatchId.value) {
    return;
  }
  const status = await getReplayBatch(selectedSessionId.value, selectedBatchId.value);
  replayJob.value = status;
  upsertBatchSummary(status);
  if (status.status === 'completed') {
    clearReplayTimer();
    stoppingBatchId.value = null;
    await loadBatches({ restore: false });
    message.success(`回放完成：通过 ${status.passed}，失败 ${status.failed}`);
  }
  if (status.status === 'failed') {
    clearReplayTimer();
    stoppingBatchId.value = null;
    await loadBatches({ restore: false });
    message.error(status.error || '回放失败');
  }
  if (['stopped', 'cancelled'].includes(status.status)) {
    clearReplayTimer();
    stoppingBatchId.value = null;
    await loadBatches({ restore: false });
    message.warning('回放已停止');
  }
};

const startReplayPolling = () => {
  clearReplayTimer();
  replayTimer = window.setInterval(() => {
    pollReplayStatus().catch((error) => {
      clearReplayTimer();
      message.error(error.message || '获取回放状态失败');
    });
  }, 800);
};

const runReplay = async () => {
  starting.value = true;
  resultFilter.value = 'all';
  try {
    const job = await startReplaySession(selectedSessionId.value, { ...options });
    replayJob.value = job;
    selectedBatchId.value = job.batchId || job.jobId;
    upsertBatchSummary(job);
    await loadBatches({ restore: false });
    message.success('回放批次已启动');
    startReplayPolling();
    await pollReplayStatus();
  } catch (error) {
    message.error(error.message || '启动回放失败');
  } finally {
    starting.value = false;
  }
};

const selectBatch = async (record) => {
  resultFilter.value = 'all';
  await loadBatch(record.batchId);
};

const stopBatch = async (record) => {
  if (!selectedSessionId.value || !record?.batchId || record.status !== 'running') {
    return;
  }
  stoppingBatchId.value = record.batchId;
  try {
    const status = await stopReplayBatch(selectedSessionId.value, record.batchId);
    replayJob.value = status;
    selectedBatchId.value = status.batchId || status.jobId;
    upsertBatchSummary(status);
    message.warning('已发送停止指令');
    startReplayPolling();
    await pollReplayStatus();
  } catch (error) {
    message.error(error.message || '停止回放失败');
    stoppingBatchId.value = null;
  }
};

const stopCurrentReplay = async () => {
  await stopBatch(runningBatch.value);
};

const canRetestRow = (record) =>
  Boolean(
    selectedSessionId.value
      && selectedBatchId.value
      && record?.replayed
      && record.runStatus !== 'running'
      && !['running', 'stopping'].includes(replayJob.value?.status)
  );

const retestRequest = async (record) => {
  if (!canRetestRow(record)) {
    return;
  }
  retestingRequestId.value = record.id;
  try {
    const status = await retestReplayRequest(
      selectedSessionId.value,
      selectedBatchId.value,
      record.id,
      { timeoutMs: options.timeoutMs }
    );
    replayJob.value = status;
    selectedBatchId.value = status.batchId || status.jobId;
    upsertBatchSummary(status);
    const updatedRow = (status.rows || []).find((row) => String(row.id) === String(record.id));
    if (detailOpen.value && String(detailRequest.value?.id) === String(record.id) && updatedRow) {
      detailRequest.value = buildDetailRequest(updatedRow);
    }
    message.success(`接口 ${record.id} 已重新测试，结果已写入详情`);
  } catch (error) {
    message.error(error.message || '重新测试失败');
  } finally {
    retestingRequestId.value = null;
  }
};

const openBatchDetail = async (record) => {
  await selectBatch(record);
  batchDetailOpen.value = true;
};

const openBatchAuthConfig = async (record) => {
  await selectBatch(record);
  batchAuthConfigOpen.value = true;
};

const confirmDeleteBatch = (record) => {
  Modal.confirm({
    title: '确认删除回放批次？',
    content: record.batchId,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      await deleteReplayBatch(selectedSessionId.value, record.batchId);
      if (selectedBatchId.value === record.batchId) {
        replayJob.value = null;
        selectedBatchId.value = null;
        batchDetailOpen.value = false;
        batchAuthConfigOpen.value = false;
        clearReplayTimer();
      }
      await loadBatches();
      message.success('回放批次已删除');
    },
  });
};

const confirmClearBatches = () => {
  Modal.confirm({
    title: '确认清空当前会话的回放批次？',
    content: '会删除当前会话 reports 目录下的批次报告，并取消正在运行的批次。',
    okText: '清空',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      await clearReplayBatches(selectedSessionId.value);
      batches.value = [];
      replayJob.value = null;
      selectedBatchId.value = null;
      batchDetailOpen.value = false;
      batchAuthConfigOpen.value = false;
      clearReplayTimer();
      message.success('回放批次已清空');
    },
  });
};

const buildDetailRequest = (record) => {
  const source = record.sourceRequest || requests.value.find((item) => item.id === record.id) || record;
  return {
    ...source,
    ...record,
    originalStatus: source.response?.status ?? record.originalStatus ?? null,
    originalStatusText: source.response?.statusText || record.originalStatusText || '',
    status: record.runStatus === 'running'
      ? 'pending'
      : (record.replayed ? (record.ok ? 'completed' : 'failed') : source.status),
    httpStatus: record.response?.status ?? record.status ?? source.response?.status,
    httpStatusText: record.response?.statusText ?? record.statusText ?? source.response?.statusText,
    response: record.response || source.response,
    failure: record.error ? { errorText: record.error } : source.failure,
  };
};

const openDetail = (record) => {
  detailRequest.value = buildDetailRequest(record);
  detailOpen.value = true;
};

const setResultFilter = (filter) => {
  resultFilter.value = filter;
};

const authModeLabel = (mode) => ({
  raw: '原样',
  override: '统一替换',
}[mode] || '-');

const loginRequestLabel = (request) =>
  request ? `${request.id} | ${request.method} | ${shortUrl(request.url)}` : '未选择';

const batchStatusLabel = (status) => ({
  running: '回放中',
  stopping: '停止中',
  stopped: '已停止',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}[status] || '未开始');

const batchStatusColor = (status) => ({
  running: 'processing',
  stopping: 'warning',
  stopped: 'default',
  completed: 'green',
  failed: 'red',
  cancelled: 'default',
}[status] || 'default');

const preflightLabel = (preflightCheck) => {
  if (!preflightCheck) {
    return '-';
  }
  const endpointText = (preflightCheck.endpoints || [])
    .map((endpoint) => `${endpoint.label || `${endpoint.hostname}:${endpoint.port}`}${endpoint.ok ? ' 通' : ` 不通(${endpoint.error || '失败'})`}`)
    .join('；');
  return `${preflightCheck.ok ? '通过' : '失败'}${endpointText ? `：${endpointText}` : ''}`;
};

const replayStatusLabel = (status) => ({
  idle: '待执行',
  queued: '排队中',
  running: '执行中',
  stopped: '已停止',
  passed: '通过',
  failed: '失败',
}[status] || '待执行');

const replayStatusColor = (status) => ({
  idle: 'blue',
  queued: 'blue',
  running: 'processing',
  stopped: 'default',
  passed: 'green',
  failed: 'red',
}[status] || 'blue');

const stringifyConfig = (value) => JSON.stringify(value || {}, null, 2);

onMounted(async () => {
  await loadSessions();
  await loadSession();
  await loadBatches();
});

onBeforeUnmount(() => {
  clearReplayTimer();
});
</script>
