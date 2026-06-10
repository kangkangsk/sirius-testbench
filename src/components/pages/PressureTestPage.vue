<template>
  <div class="page-stack">
    <a-card class="panel-card">
      <PageSectionHeader
        title="压力测试"
        description="从抓包会话中选择接口保存压测目标，再按并发、持续时间和超时参数执行压力测试。"
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
        <a-form-item label="并发数">
          <a-input-number
            v-model:value="config.concurrency"
            class="full-width"
            :min="1"
            :max="500"
            @change="autoSavePressureConfig"
          />
        </a-form-item>
        <a-form-item label="持续时间 s">
          <a-input-number
            v-model:value="config.durationSeconds"
            class="full-width"
            :min="1"
            :max="86400"
            @change="autoSavePressureConfig"
          />
        </a-form-item>
        <a-form-item label="最大请求数">
          <a-input-number
            v-model:value="config.maxRequests"
            class="full-width"
            :min="0"
            :max="10000000"
            @change="autoSavePressureConfig"
          />
        </a-form-item>
        <a-form-item label="超时时间 ms">
          <a-input-number
            v-model:value="config.timeoutMs"
            class="full-width"
            :min="100"
            :step="1000"
            @change="autoSavePressureConfig"
          />
        </a-form-item>
        <a-form-item label="请求间隔 ms">
          <a-input-number
            v-model:value="config.requestIntervalMs"
            class="full-width"
            :min="0"
            :step="10"
            @change="autoSavePressureConfig"
          />
        </a-form-item>
        <a-form-item label="资源监控">
          <a-switch
            v-model:checked="monitoring.enabled"
            checked-children="Prometheus"
            un-checked-children="关闭"
            @change="autoSavePressureConfig"
          />
        </a-form-item>
        <a-form-item label="Prometheus URL">
          <a-input
            v-model:value="monitoring.prometheusUrl"
            :disabled="!monitoring.enabled"
            placeholder="http://localhost:9090"
            @change="autoSavePressureConfig"
          />
        </a-form-item>
        <a-form-item label="监控步长 s">
          <a-input-number
            v-model:value="monitoring.stepSeconds"
            class="full-width"
            :disabled="!monitoring.enabled"
            :min="1"
            :max="3600"
            @change="autoSavePressureConfig"
          />
        </a-form-item>
      </div>
      <a-space wrap>
        <a-button type="primary" :disabled="!selectedSessionId" @click="saveTargets">
          <template #icon><SaveOutlined /></template>
          保存
        </a-button>
      </a-space>
    </a-card>

    <a-card class="table-card">
      <PageSectionHeader title="接口选择" description="从当前抓包会话的 HTTP 请求中选择要压测的接口。">
        <template #extra>
          <a-input-search
            v-model:value="requestKeyword"
            class="session-search"
            placeholder="搜索 URL / 方法 / 序号"
            allow-clear
          />
        </template>
      </PageSectionHeader>
      <div class="batch-toolbar">
        <a-space wrap>
          <a-button
            type="primary"
            size="small"
            :disabled="!selectedRequestIds.length"
            @click="batchAddSelectedRequests"
          >
            <template #icon><PlusOutlined /></template>
            批量加入压测
          </a-button>
          <a-button size="small" :disabled="!filteredRequests.length" @click="batchAddFilteredRequests">
            <template #icon><PlusOutlined /></template>
            加入筛选结果
          </a-button>
          <a-button size="small" :disabled="!selectedRequestIds.length" @click="clearSelectedRequests">
            清空选择
          </a-button>
        </a-space>
        <span class="batch-toolbar__count">
          已选 {{ selectedRequestIds.length }} / 目标 {{ targets.length }}
        </span>
      </div>
      <a-table
        row-key="id"
        :columns="requestColumns"
        :data-source="filteredRequests"
        :pagination="{ pageSize: 8 }"
        :row-selection="{ selectedRowKeys: selectedRequestIds, onChange: onRequestSelect }"
        :scroll="{ x: 1480 }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'method'">
            <a-tag :color="methodColor(record.method)">{{ record.method }}</a-tag>
          </template>
          <template v-else-if="column.key === 'url'">
            <a-tooltip :title="record.url">
              <span class="url-text">{{ displayUrl(record.url) }}</span>
            </a-tooltip>
          </template>
          <template v-else-if="column.key === 'pressureUrl'">
            <a-tooltip :title="record.pressureUrl">
              <span class="url-text">{{ displayUrl(record.pressureUrl) }}</span>
            </a-tooltip>
          </template>
          <template v-else-if="column.key === 'status'">
            <a-tag v-if="record.response" :color="responseStatusColor(record.response.status)">
              {{ record.response.status }}
            </a-tag>
            <span v-else>-</span>
          </template>
          <template v-else-if="column.key === 'action'">
            <a-button
              type="link"
              :disabled="isTargetAdded(record.id)"
              @click="addRequestToTargets(record)"
            >
              <template #icon><PlusOutlined /></template>
              {{ isTargetAdded(record.id) ? '已加入' : '加入压测' }}
            </a-button>
          </template>
        </template>
      </a-table>
    </a-card>

    <a-card class="table-card">
      <PageSectionHeader title="压测目标配置" description="保存后可调整接口权重；权重越高，在压测流量中出现越频繁。" />
      <div class="pressure-config-summary">{{ configSummaryText }}</div>
      <div class="batch-toolbar">
        <a-space wrap>
          <a-button
            size="small"
            danger
            :disabled="!selectedTargetIds.length"
            @click="batchRemoveTargets"
          >
            <template #icon><DeleteOutlined /></template>
            批量移除
          </a-button>
          <a-button size="small" :disabled="!selectedTargetIds.length" @click="clearSelectedTargets">
            清空选择
          </a-button>
        </a-space>
        <span class="batch-toolbar__count">已选 {{ selectedTargetIds.length }}</span>
      </div>
      <a-table
        row-key="requestId"
        :columns="targetColumns"
        :data-source="targetRows"
        :pagination="{ pageSize: 8 }"
        :row-selection="{ selectedRowKeys: selectedTargetIds, onChange: onTargetSelect }"
        :scroll="{ x: 1480 }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'enabled'">
            <a-switch
              :checked="record.enabled !== false"
              checked-children="启用"
              un-checked-children="禁用"
              @change="(checked) => updateTarget(record.requestId, { enabled: checked })"
            />
          </template>
          <template v-else-if="column.key === 'method'">
            <a-tag :color="methodColor(record.method)">{{ record.method }}</a-tag>
          </template>
          <template v-else-if="column.key === 'weight'">
            <a-input-number
              :value="record.weight"
              :min="1"
              :max="100"
              @change="(value) => updateTarget(record.requestId, { weight: Number(value || 1) })"
            />
          </template>
          <template v-else-if="column.key === 'url'">
            <a-tooltip :title="record.url">
              <span class="url-text">{{ displayUrl(record.url) }}</span>
            </a-tooltip>
          </template>
          <template v-else-if="column.key === 'pressureUrl'">
            <a-tooltip :title="record.pressureUrl">
              <span class="url-text">{{ displayUrl(record.pressureUrl) }}</span>
            </a-tooltip>
          </template>
          <template v-else-if="column.key === 'action'">
            <a-button type="link" danger @click="removeTarget(record.requestId)">移除</a-button>
          </template>
        </template>
      </a-table>
    </a-card>

    <a-card class="panel-card">
      <a-space wrap>
        <a-button
          type="primary"
          :loading="starting || activeTestRunning"
          :disabled="!selectedSessionId || !enabledTargets.length || activeTestRunning"
          @click="runPressureTest"
        >
          <template #icon><ThunderboltOutlined /></template>
          {{ activeTestRunning ? '压测中' : '运行压力测试' }}
        </a-button>
        <a-button
          danger
          :loading="Boolean(stoppingTestId)"
          :disabled="!runningTest || runningTest.status !== 'running'"
          @click="stopCurrentTest"
        >
          <template #icon><PauseCircleOutlined /></template>
          停止
        </a-button>
        <a-button :disabled="!selectedSessionId" @click="refreshAll">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
        <a-button danger :disabled="!selectedSessionId || !tests.length" @click="confirmClearTests">
          <template #icon><DeleteOutlined /></template>
          清空报告
        </a-button>
      </a-space>
    </a-card>

    <div class="metric-grid">
      <DashboardMetricCard title="目标接口" :value="enabledTargets.length" :icon="ApiOutlined" />
      <DashboardMetricCard title="总请求" :value="summary.total || 0" :icon="FileDoneOutlined" />
      <DashboardMetricCard title="成功率" :value="`${summary.successRate || 0}%`" :icon="CheckCircleOutlined" />
      <DashboardMetricCard title="TPS" :value="summary.tps || 0" :icon="ThunderboltOutlined" />
    </div>

    <a-card class="table-card">
      <PageSectionHeader title="压力测试报告" description="报告保存到当前会话 pressure-tests 目录，包含成功率、TPS、耗时分布和状态码分布。" />
      <a-table
        row-key="batchId"
        :columns="batchColumns"
        :data-source="tests"
        :pagination="{ pageSize: 6 }"
        :scroll="{ x: 1200 }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'batchId'">
            <a-typography-text :copyable="{ text: record.batchId }" class="url-text">
              {{ record.batchId }}
            </a-typography-text>
          </template>
          <template v-else-if="column.key === 'status'">
            <a-tag :color="testStatusColor(record.status)">{{ testStatusLabel(record.status) }}</a-tag>
          </template>
          <template v-else-if="column.key === 'successRate'">
            {{ record.summary?.successRate ?? 0 }}%
          </template>
          <template v-else-if="column.key === 'tps'">
            {{ record.summary?.tps ?? 0 }}
          </template>
          <template v-else-if="column.key === 'total'">
            {{ record.summary?.total ?? 0 }}
          </template>
          <template v-else-if="column.key === 'startedAt'">
            {{ formatSessionTime(record.startedAt) }}
          </template>
          <template v-else-if="column.key === 'action'">
            <a-space>
              <a-button type="link" @click="selectTest(record)">查看详情</a-button>
              <a-button v-if="record.status === 'running'" type="link" danger @click="stopTest(record)">停止</a-button>
              <a-button type="link" danger @click="confirmDeleteTest(record)">删除</a-button>
            </a-space>
          </template>
        </template>
      </a-table>
    </a-card>

    <a-card v-if="pressureJob" class="detail-card">
      <PageSectionHeader title="报告详情" :description="reportDescription" />
      <a-progress :percent="pressureJob.progressPercent || 0" :status="progressStatus" />
      <a-descriptions bordered size="small" :column="1" class="replay-progress-detail">
        <a-descriptions-item label="批次 ID">{{ pressureJob.batchId || pressureJob.jobId }}</a-descriptions-item>
        <a-descriptions-item label="状态">{{ testStatusLabel(pressureJob.status) }}</a-descriptions-item>
        <a-descriptions-item label="并发 / 时长">{{ pressureJob.config?.concurrency || 0 }} / {{ pressureJob.config?.durationSeconds || 0 }}s</a-descriptions-item>
        <a-descriptions-item label="总请求">{{ pressureJob.summary?.total || 0 }}</a-descriptions-item>
        <a-descriptions-item label="成功率">{{ pressureJob.summary?.successRate || 0 }}%</a-descriptions-item>
        <a-descriptions-item label="TPS">{{ pressureJob.summary?.tps || 0 }}</a-descriptions-item>
        <a-descriptions-item label="平均耗时">{{ pressureJob.summary?.avgDurationMs || 0 }}ms</a-descriptions-item>
        <a-descriptions-item label="P95 耗时">{{ pressureJob.summary?.p95DurationMs || 0 }}ms</a-descriptions-item>
        <a-descriptions-item label="报告路径">
          <a-typography-paragraph copyable class="url-text">{{ pressureJob.reportPath || '-' }}</a-typography-paragraph>
        </a-descriptions-item>
      </a-descriptions>
    </a-card>

    <a-card v-if="pressureJob" class="table-card">
      <PageSectionHeader title="接口指标" description="按接口统计成功率、TPS 和耗时分布。" />
      <a-table
        row-key="id"
        :columns="interfaceColumns"
        :data-source="pressureInterfaces"
        :pagination="{ pageSize: 8 }"
        :scroll="{ x: 1520 }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'method'">
            <a-tag :color="methodColor(record.method)">{{ record.method }}</a-tag>
          </template>
          <template v-else-if="column.key === 'url'">
            <a-tooltip :title="record.url">
              <span class="url-text">{{ displayUrl(record.url) }}</span>
            </a-tooltip>
          </template>
          <template v-else-if="column.key === 'pressureUrl'">
            <a-tooltip :title="record.pressureUrl">
              <span class="url-text">{{ displayUrl(record.pressureUrl) }}</span>
            </a-tooltip>
          </template>
          <template v-else-if="column.key === 'successRate'">
            {{ record.successRate }}%
          </template>
        </template>
      </a-table>
    </a-card>

    <a-card v-if="pressureJob" class="table-card">
      <PageSectionHeader title="JTL / 业务字段样本" description="样本包含 JMeter JTL 字段和响应中提取的业务字段。" />
      <a-table
        row-key="sequence"
        :columns="sampleColumns"
        :data-source="pressureSamples"
        :pagination="{ pageSize: 8 }"
        :locale="{ emptyText: sampleEmptyText }"
        :scroll="{ x: 2200 }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'success'">
            <a-tag :color="record.success ? 'success' : 'error'">{{ record.success ? 'true' : 'false' }}</a-tag>
          </template>
          <template v-else-if="column.key === 'URL'">
            <a-tooltip :title="record.URL">
              <span class="url-text">{{ displayUrl(record.URL) }}</span>
            </a-tooltip>
          </template>
          <template v-else-if="column.key === 'failureMessage'">
            <a-tooltip :title="record.failureMessage">
              <span class="url-text">{{ record.failureMessage || '-' }}</span>
            </a-tooltip>
          </template>
        </template>
      </a-table>
    </a-card>

    <a-card v-if="pressureJob && resourceMonitoringVisible" class="table-card">
      <PageSectionHeader title="资源监控" description="当前接入 Prometheus query_range；未配置或查询失败的字段会在下方说明。" />
      <a-descriptions bordered size="small" :column="1" class="replay-progress-detail">
        <a-descriptions-item label="状态">{{ resourceMetricStatusText }}</a-descriptions-item>
        <a-descriptions-item label="来源">{{ pressureJob.resourceMetrics?.source || '-' }}</a-descriptions-item>
      </a-descriptions>
      <a-table
        row-key="key"
        :columns="resourceMetricColumns"
        :data-source="resourceMetricRows"
        :pagination="{ pageSize: 8 }"
        :scroll="{ x: 1180 }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'status'">
            <a-tag :color="record.status === 'ok' ? 'success' : 'warning'">{{ record.status }}</a-tag>
          </template>
          <template v-else-if="column.key === 'query'">
            <a-tooltip :title="record.query">
              <span class="url-text">{{ record.query || '-' }}</span>
            </a-tooltip>
          </template>
          <template v-else-if="column.key === 'reason'">
            <a-tooltip :title="record.reason">
              <span class="url-text">{{ record.reason || '-' }}</span>
            </a-tooltip>
          </template>
        </template>
      </a-table>
    </a-card>

    <a-card v-if="pressureJob && fieldLimitationRows.length" class="table-card">
      <PageSectionHeader title="不可行字段说明" description="无法直接或精确采集的字段会保留原因，避免报告误读。" />
      <a-table
        row-key="key"
        :columns="limitationColumns"
        :data-source="fieldLimitationRows"
        :pagination="{ pageSize: 8 }"
      />
    </a-card>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { Modal, message } from 'ant-design-vue';
import {
  ApiOutlined,
  CheckCircleOutlined,
  DeleteOutlined,
  FileDoneOutlined,
  PauseCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons-vue';
import DashboardMetricCard from '../common/DashboardMetricCard.vue';
import PageSectionHeader from '../common/PageSectionHeader.vue';
import {
  clearPressureTests,
  deletePressureTest,
  getAuthOverride,
  getPressureConfig,
  getPressureTest,
  getSession,
  listPressureTests,
  listSessions,
  savePressureConfig,
  startPressureTest,
  stopPressureTest,
} from '../../utils/workbench-api.js';
import {
  filterSessionOption,
  formatSessionTime,
  methodColor,
  responseStatusColor,
  sessionOptionLabel,
} from '../../utils/formatters.js';

const sessions = ref([]);
const selectedSessionId = ref(null);
const currentSession = ref({ meta: null, requests: [] });
const authOverride = ref(createEmptyAuthOverride());
const requestKeyword = ref('');
const selectedRequestIds = ref([]);
const selectedTargetIds = ref([]);
const targets = ref([]);
const tests = ref([]);
const selectedTestId = ref(null);
const pressureJob = ref(null);
const starting = ref(false);
const stoppingTestId = ref(null);
let pressureTimer = null;

const config = reactive({
  concurrency: 5,
  durationSeconds: 30,
  maxRequests: 0,
  timeoutMs: 10000,
  requestIntervalMs: 0,
});
const monitoring = reactive({
  enabled: false,
  provider: 'prometheus',
  prometheusUrl: '',
  stepSeconds: 15,
  queries: {},
});

const numberOr = (value, fallback) => {
  const nextValue = Number(value);
  return Number.isFinite(nextValue) ? nextValue : fallback;
};

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

const normalizeAuthOverride = (configValue = {}) => ({
  ...createEmptyAuthOverride(),
  ...configValue,
  mode: configValue.mode === 'raw' ? 'raw' : 'override',
  headers: configValue.headers || {},
  loginRequestId: configValue.loginRequestId || '',
  endpoint: {
    ...createEmptyAuthOverride().endpoint,
    ...(configValue.endpoint || {}),
  },
  replacements: Array.isArray(configValue.replacements) ? configValue.replacements : [],
  updatedAt: configValue.updatedAt || null,
});

const requestColumns = [
  { title: '序号', dataIndex: 'id', key: 'id', width: 90 },
  { title: '方法', dataIndex: 'method', key: 'method', width: 90 },
  { title: '分类', dataIndex: 'category', key: 'category', width: 100 },
  { title: '原始 URL', dataIndex: 'url', key: 'url', ellipsis: true, width: 360 },
  { title: '压测地址', dataIndex: 'pressureUrl', key: 'pressureUrl', ellipsis: true, width: 360 },
  { title: '响应', key: 'status', width: 90 },
  { title: '耗时', dataIndex: 'durationMs', key: 'durationMs', width: 90 },
  { title: '操作', key: 'action', fixed: 'right', width: 120 },
];

const targetColumns = [
  { title: '启用', key: 'enabled', width: 105 },
  { title: '序号', dataIndex: 'requestId', key: 'requestId', width: 90 },
  { title: '方法', dataIndex: 'method', key: 'method', width: 90 },
  { title: '权重', key: 'weight', width: 110 },
  { title: '原始 URL', dataIndex: 'url', key: 'url', ellipsis: true, width: 360 },
  { title: '压测地址', dataIndex: 'pressureUrl', key: 'pressureUrl', ellipsis: true, width: 360 },
  { title: '操作', key: 'action', fixed: 'right', width: 90 },
];

const batchColumns = [
  { title: '批次 ID', dataIndex: 'batchId', key: 'batchId', width: 260 },
  { title: '状态', key: 'status', width: 100 },
  { title: '总请求', key: 'total', width: 90 },
  { title: '成功率', key: 'successRate', width: 100 },
  { title: 'TPS', key: 'tps', width: 90 },
  { title: '并发', dataIndex: ['config', 'concurrency'], key: 'concurrency', width: 80 },
  { title: '开始时间', dataIndex: 'startedAt', key: 'startedAt', width: 180 },
  { title: '操作', key: 'action', fixed: 'right', width: 170 },
];

const interfaceColumns = [
  { title: '序号', dataIndex: 'id', key: 'id', width: 90 },
  { title: '方法', dataIndex: 'method', key: 'method', width: 90 },
  { title: '原始 URL', dataIndex: 'url', key: 'url', ellipsis: true, width: 360 },
  { title: '压测地址', dataIndex: 'pressureUrl', key: 'pressureUrl', ellipsis: true, width: 360 },
  { title: '总请求', dataIndex: 'total', key: 'total', width: 90 },
  { title: '成功率', key: 'successRate', width: 100 },
  { title: 'TPS', dataIndex: 'tps', key: 'tps', width: 90 },
  { title: '平均耗时', dataIndex: 'avgDurationMs', key: 'avgDurationMs', width: 100 },
  { title: 'P95', dataIndex: 'p95DurationMs', key: 'p95DurationMs', width: 90 },
  { title: 'P99', dataIndex: 'p99DurationMs', key: 'p99DurationMs', width: 90 },
];

const sampleColumns = [
  { title: 'timeStamp', dataIndex: 'timeStamp', key: 'timeStamp', width: 150 },
  { title: 'elapsed', dataIndex: 'elapsed', key: 'elapsed', width: 90 },
  { title: 'label', dataIndex: 'label', key: 'label', ellipsis: true, width: 220 },
  { title: 'success', key: 'success', width: 90 },
  { title: 'responseCode', dataIndex: 'responseCode', key: 'responseCode', width: 120 },
  { title: 'responseMessage', dataIndex: 'responseMessage', key: 'responseMessage', width: 160 },
  { title: 'failureMessage', key: 'failureMessage', width: 180 },
  { title: 'URL', key: 'URL', width: 300 },
  { title: 'allThreads', dataIndex: 'allThreads', key: 'allThreads', width: 110 },
  { title: 'grpThreads', dataIndex: 'grpThreads', key: 'grpThreads', width: 110 },
  { title: 'Latency', dataIndex: 'Latency', key: 'Latency', width: 90 },
  { title: 'Connect', dataIndex: 'Connect', key: 'Connect', width: 90 },
  { title: 'bytes', dataIndex: 'bytes', key: 'bytes', width: 90 },
  { title: 'sentBytes', dataIndex: 'sentBytes', key: 'sentBytes', width: 100 },
  { title: 'bizCode', dataIndex: 'bizCode', key: 'bizCode', width: 120 },
  { title: 'bizMessage', dataIndex: 'bizMessage', key: 'bizMessage', width: 160 },
  { title: 'traceId', dataIndex: 'traceId', key: 'traceId', width: 180 },
  { title: 'errorType', dataIndex: 'errorType', key: 'errorType', width: 140 },
];

const resourceMetricColumns = [
  { title: '指标', dataIndex: 'label', key: 'label', width: 120 },
  { title: '状态', key: 'status', width: 110 },
  { title: '单位', dataIndex: 'unit', key: 'unit', width: 90 },
  { title: '平均', dataIndex: ['summary', 'avg'], key: 'avg', width: 90 },
  { title: '最大', dataIndex: ['summary', 'max'], key: 'max', width: 90 },
  { title: '最新', dataIndex: ['summary', 'last'], key: 'last', width: 90 },
  { title: '查询', key: 'query', width: 360 },
  { title: '原因', key: 'reason', width: 260 },
];

const limitationColumns = [
  { title: '字段', dataIndex: 'field', key: 'field', width: 160 },
  { title: '原因', dataIndex: 'reason', key: 'reason' },
];

const sessionOptions = computed(() =>
  sessions.value.map((session) => ({
    value: session.id,
    label: sessionOptionLabel(session),
  }))
);
const requests = computed(() => currentSession.value.requests || []);
const rewriteEndpoint = (url, endpoint = {}) => {
  if (!endpoint.hostname && !endpoint.port && !endpoint.protocol) {
    return url;
  }
  try {
    const parsed = new URL(url);
    if (endpoint.protocol) {
      parsed.protocol = `${String(endpoint.protocol).replace(/:$/, '')}:`;
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

const pressureUrlForRequest = (request) => {
  if (!request?.url) {
    return '';
  }
  let url = request.url;
  if (authOverride.value.mode === 'override') {
    url = rewriteEndpoint(url, authOverride.value.endpoint);
    (authOverride.value.replacements || []).forEach((rule) => {
      if (!rule?.from || !['url', 'all'].includes(rule.scope)) {
        return;
      }
      url = url.split(String(rule.from)).join(String(rule.to ?? ''));
    });
  }
  return url;
};

const requestRows = computed(() =>
  requests.value.map((request) => ({
    ...request,
    pressureUrl: pressureUrlForRequest(request),
  }))
);
const filteredRequests = computed(() => {
  const keyword = requestKeyword.value.trim().toLowerCase();
  if (!keyword) {
    return requestRows.value;
  }
  return requestRows.value.filter((request) =>
    [request.id, request.method, request.category, request.url, request.pressureUrl]
      .some((value) => String(value || '').toLowerCase().includes(keyword))
  );
});
const enabledTargets = computed(() => targets.value.filter((target) => target.enabled !== false));
const targetRows = computed(() =>
  targets.value.map((target) => {
    const request = requests.value.find((item) => item.id === target.requestId);
    return {
      ...target,
      pressureUrl: pressureUrlForRequest(request || target),
    };
  })
);
const pressureInterfaces = computed(() =>
  (pressureJob.value?.interfaces || []).map((item) => ({
    ...item,
    pressureUrl: item.pressureUrl || item.url,
  }))
);

const timestampFromSample = (sample) => {
  const timeStamp = Number(sample.timeStamp);
  if (Number.isFinite(timeStamp) && timeStamp > 0) {
    return timeStamp;
  }
  const startedAt = new Date(sample.startedAt || 0).getTime();
  return Number.isFinite(startedAt) ? startedAt : 0;
};

const normalizePressureSample = (sample, index) => {
  const elapsed = sample.elapsed ?? sample.durationMs ?? 0;
  const success = sample.success ?? sample.ok ?? false;
  const status = sample.responseCode ?? sample.status ?? 0;
  const url = sample.URL || sample.url || '';
  const method = sample.method || 'HTTP';
  const label = sample.label || `${method} ${url}`.trim();
  const threads = pressureJob.value?.config?.concurrency || sample.allThreads || sample.grpThreads || 0;
  return {
    ...sample,
    sequence: sample.sequence ?? `${sample.requestId || 'sample'}-${index + 1}`,
    timeStamp: timestampFromSample(sample),
    elapsed,
    label,
    success,
    responseCode: String(status),
    responseMessage: sample.responseMessage || sample.error || '',
    failureMessage: sample.failureMessage || sample.error || (success ? '' : sample.bizMessage || ''),
    URL: url,
    allThreads: sample.allThreads ?? threads,
    grpThreads: sample.grpThreads ?? threads,
    Latency: sample.Latency ?? sample.latencyMs ?? elapsed,
    Connect: sample.Connect ?? sample.connectMs ?? 0,
    bytes: sample.bytes ?? 0,
    sentBytes: sample.sentBytes ?? 0,
    bizCode: sample.bizCode || '',
    bizMessage: sample.bizMessage || '',
    traceId: sample.traceId || '',
    errorType: sample.errorType || '',
  };
};

const pressureSamples = computed(() => {
  const samples = pressureJob.value?.samples || [];
  if (samples.length) {
    return samples.map(normalizePressureSample);
  }
  return (pressureJob.value?.jtlSamples || []).map(normalizePressureSample);
});
const sampleEmptyText = computed(() => {
  if (!pressureJob.value) {
    return '请先查看一个压力测试报告';
  }
  if (['running', 'stopping'].includes(pressureJob.value.status)) {
    return '压力测试正在运行，尚未产生请求样本';
  }
  if ((pressureJob.value.summary?.total || 0) <= 0) {
    return '该报告没有执行请求，检查压测目标、持续时间、最大请求数和启动错误';
  }
  return '该报告没有样本数据；历史报告需重新运行压力测试后才会包含 JTL / 业务字段样本';
});
const resourceMetricRows = computed(() =>
  Object.entries(pressureJob.value?.resourceMetrics?.metrics || {}).map(([key, metric]) => ({
    key,
    ...metric,
  }))
);
const resourceMetricStatusText = computed(() => {
  const metrics = pressureJob.value?.resourceMetrics;
  if (!metrics) {
    return '未生成';
  }
  if (metrics.status === 'ok') {
    return '已采集';
  }
  if (metrics.status === 'partial') {
    return '部分可用';
  }
  return metrics.reason || '不可用';
});
const resourceMonitoringVisible = computed(() => monitoring.enabled === true);
const fieldLimitationRows = computed(() =>
  [...(pressureJob.value?.fieldLimitations || []), ...(pressureJob.value?.unavailableFields || [])]
    .filter((item) => {
      if (resourceMonitoringVisible.value) {
        return true;
      }
      return item.key !== 'resourceMetrics' && item.field !== '资源监控';
    })
    .reduce((rows, item) => {
      const key = `${item.key || item.field}-${item.reason}`;
      if (!rows.some((row) => row.key === key)) {
        rows.push({ key, ...item });
      }
      return rows;
    }, [])
);
const configSummaryText = computed(() => {
  const maxRequestsText = Number(config.maxRequests) > 0 ? `${config.maxRequests}` : '不限';
  const authModeText = authOverride.value.mode === 'raw' ? '原样' : '统一替换';
  const monitorText = monitoring.enabled ? `Prometheus ${monitoring.prometheusUrl || '未配置'}` : '关闭';
  return [
    `当前配置：并发 ${config.concurrency}`,
    `持续 ${config.durationSeconds}s`,
    `最大请求 ${maxRequestsText}`,
    `超时 ${config.timeoutMs}ms`,
    `间隔 ${config.requestIntervalMs}ms`,
    `登录态 ${authModeText}`,
    `资源监控 ${monitorText}`,
    `目标接口 ${enabledTargets.value.length}/${targets.value.length}`,
  ].join(' | ');
});
const activeTestRunning = computed(() =>
  tests.value.some((test) => ['running', 'stopping'].includes(test.status))
    || ['running', 'stopping'].includes(pressureJob.value?.status)
);
const runningTest = computed(() =>
  ['running', 'stopping'].includes(pressureJob.value?.status)
    ? pressureJob.value
    : tests.value.find((test) => ['running', 'stopping'].includes(test.status))
);
const summary = computed(() => pressureJob.value?.summary || {});
const progressStatus = computed(() => {
  if (pressureJob.value?.status === 'failed') {
    return 'exception';
  }
  if (pressureJob.value?.status === 'completed') {
    return 'success';
  }
  return 'active';
});
const reportDescription = computed(() =>
  pressureJob.value?.status === 'running'
    ? '压力测试正在后台执行，页面按批次轮询实时指标。'
    : '展示当前选中压力测试批次的统计结果。'
);

const monitoringPayload = () => ({
  enabled: monitoring.enabled === true,
  provider: 'prometheus',
  prometheusUrl: monitoring.prometheusUrl || '',
  stepSeconds: numberOr(monitoring.stepSeconds, 15),
  queries: monitoring.queries || {},
});

const pressureConfigPayload = () => ({
  config: {
    concurrency: numberOr(config.concurrency, 5),
    durationSeconds: numberOr(config.durationSeconds, 30),
    maxRequests: numberOr(config.maxRequests, 0),
    timeoutMs: numberOr(config.timeoutMs, 10000),
    requestIntervalMs: numberOr(config.requestIntervalMs, 0),
  },
  monitoring: monitoringPayload(),
  selectedRequestIds: selectedRequestIds.value,
  targets: targetRows.value.map((target) => ({
    requestId: target.requestId,
    method: target.method,
    url: target.url,
    pressureUrl: target.pressureUrl,
    category: target.category,
    enabled: target.enabled !== false,
    weight: numberOr(target.weight, 1),
  })),
});

const persistPressureConfig = async ({ silent = false } = {}) => {
  if (!selectedSessionId.value) {
    return null;
  }
  try {
    const savedConfig = await savePressureConfig(selectedSessionId.value, pressureConfigPayload());
    if (!silent) {
      message.success('压测配置已保存');
    }
    return savedConfig;
  } catch (error) {
    message.error(error.message || '保存压测配置失败');
    throw error;
  }
};

const autoSavePressureConfig = () => {
  persistPressureConfig({ silent: true }).catch(() => null);
};

const applyPressureConfig = (pressureConfig = {}) => {
  const savedConfig = pressureConfig.config || {};
  Object.assign(config, {
    concurrency: numberOr(savedConfig.concurrency, 5),
    durationSeconds: numberOr(savedConfig.durationSeconds, 30),
    maxRequests: numberOr(savedConfig.maxRequests, 0),
    timeoutMs: numberOr(savedConfig.timeoutMs, 10000),
    requestIntervalMs: numberOr(savedConfig.requestIntervalMs, 0),
  });
  const savedMonitoring = pressureConfig.monitoring || {};
  Object.assign(monitoring, {
    enabled: savedMonitoring.enabled === true,
    provider: 'prometheus',
    prometheusUrl: savedMonitoring.prometheusUrl || '',
    stepSeconds: numberOr(savedMonitoring.stepSeconds, 15),
    queries: savedMonitoring.queries || {},
  });
  const requestMap = new Map(requests.value.map((request) => [request.id, request]));
  const savedTargets = Array.isArray(pressureConfig.targets) ? pressureConfig.targets : [];
  targets.value = savedTargets
    .map((target) => {
      const request = requestMap.get(target.requestId);
      return request ? createTargetFromRequest(request, target) : null;
    })
    .filter(Boolean);
  const selectedIds = Array.isArray(pressureConfig.selectedRequestIds)
    ? pressureConfig.selectedRequestIds
    : targets.value.map((target) => target.requestId);
  const targetIds = new Set(targets.value.map((target) => target.requestId));
  selectedRequestIds.value = selectedIds
    .map((id) => String(id))
    .filter((id) => requestMap.has(id) || targetIds.has(id));
  selectedTargetIds.value = selectedTargetIds.value.filter((id) => targetIds.has(id));
};

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
  const [session, authConfig, pressureConfig] = await Promise.all([
    getSession(selectedSessionId.value),
    getAuthOverride(selectedSessionId.value),
    getPressureConfig(selectedSessionId.value),
  ]);
  currentSession.value = session;
  authOverride.value = normalizeAuthOverride(authConfig);
  applyPressureConfig(pressureConfig);
};

const loadTests = async ({ restore = true } = {}) => {
  if (!selectedSessionId.value) {
    tests.value = [];
    pressureJob.value = null;
    selectedTestId.value = null;
    return;
  }
  tests.value = await listPressureTests(selectedSessionId.value);
  if (!restore) {
    return;
  }
  const current = tests.value.find((test) => test.batchId === selectedTestId.value);
  const running = tests.value.find((test) => test.status === 'running');
  const next = current || running || tests.value[0];
  if (next) {
    await loadTest(next.batchId);
  } else {
    pressureJob.value = null;
    selectedTestId.value = null;
    clearPressureTimer();
  }
};

const refreshAll = async () => {
  await loadSessions();
  await loadSession();
  await loadTests();
};

const handleSessionChange = async () => {
  clearPressureTimer();
  selectedRequestIds.value = [];
  selectedTargetIds.value = [];
  targets.value = [];
  pressureJob.value = null;
  selectedTestId.value = null;
  await loadSession();
  await loadTests();
};

const onRequestSelect = (keys) => {
  selectedRequestIds.value = keys;
};

const onTargetSelect = (keys) => {
  selectedTargetIds.value = keys;
};

const createTargetFromRequest = (request, existing = null) => ({
  requestId: request.id,
  method: request.method,
  url: request.url,
  pressureUrl: pressureUrlForRequest(request),
  category: request.category,
  enabled: existing?.enabled ?? true,
  weight: existing?.weight || 1,
});

const isTargetAdded = (requestId) =>
  targets.value.some((target) => target.requestId === requestId);

const addRequestToTargets = async (request) => {
  if (!request?.id || isTargetAdded(request.id)) {
    return;
  }
  targets.value = [...targets.value, createTargetFromRequest(request)];
  if (!selectedRequestIds.value.includes(request.id)) {
    selectedRequestIds.value = [...selectedRequestIds.value, request.id];
  }
  try {
    await persistPressureConfig({ silent: true });
    message.success(`已加入并保存压测目标：${request.id}`);
  } catch (_error) {}
};

const batchAddRequestsToTargets = async (requestList, sourceLabel) => {
  const uniqueRequests = [];
  const seenRequestIds = new Set();
  requestList.forEach((request) => {
    if (!request?.id || seenRequestIds.has(request.id)) {
      return;
    }
    seenRequestIds.add(request.id);
    uniqueRequests.push(request);
  });
  if (!uniqueRequests.length) {
    message.warning('没有可加入的接口');
    return;
  }

  const targetIdSet = new Set(targets.value.map((target) => target.requestId));
  const selectedIdSet = new Set(selectedRequestIds.value);
  const nextTargets = [...targets.value];
  let addedCount = 0;

  uniqueRequests.forEach((request) => {
    selectedIdSet.add(request.id);
    if (targetIdSet.has(request.id)) {
      return;
    }
    nextTargets.push(createTargetFromRequest(request));
    targetIdSet.add(request.id);
    addedCount += 1;
  });

  selectedRequestIds.value = [...selectedIdSet];
  targets.value = nextTargets;

  try {
    await persistPressureConfig({ silent: true });
    if (addedCount) {
      message.success(`${sourceLabel}已加入 ${addedCount} 个压测目标`);
    } else {
      message.info(`${sourceLabel}已全部在压测目标中`);
    }
  } catch (_error) {}
};

const batchAddSelectedRequests = () => {
  const requestMap = new Map(requests.value.map((request) => [request.id, request]));
  const selectedRequests = selectedRequestIds.value
    .map((requestId) => requestMap.get(requestId))
    .filter(Boolean);
  batchAddRequestsToTargets(selectedRequests, '所选接口');
};

const batchAddFilteredRequests = () => {
  batchAddRequestsToTargets(filteredRequests.value, '筛选结果');
};

const clearSelectedRequests = () => {
  selectedRequestIds.value = [];
};

const clearSelectedTargets = () => {
  selectedTargetIds.value = [];
};

const saveTargets = async () => {
  const existingTargets = new Map(targets.value.map((target) => [target.requestId, target]));
  const nextTargets = selectedRequestIds.value
    .map((requestId) => {
      const request = requests.value.find((item) => item.id === requestId);
      if (!request) {
        return null;
      }
      const existing = existingTargets.get(request.id);
      return createTargetFromRequest(request, existing);
    })
    .filter(Boolean);
  targets.value = nextTargets;
  selectedTargetIds.value = selectedTargetIds.value.filter((id) =>
    nextTargets.some((target) => target.requestId === id)
  );
  try {
    await persistPressureConfig({ silent: true });
    message.success(`已保存 ${nextTargets.length} 个压测目标`);
  } catch (_error) {}
};

const updateTarget = (requestId, patch) => {
  targets.value = targets.value.map((target) =>
    target.requestId === requestId ? { ...target, ...patch } : target
  );
  autoSavePressureConfig();
};

const removeTarget = (requestId) => {
  targets.value = targets.value.filter((target) => target.requestId !== requestId);
  selectedRequestIds.value = selectedRequestIds.value.filter((id) => id !== requestId);
  selectedTargetIds.value = selectedTargetIds.value.filter((id) => id !== requestId);
  autoSavePressureConfig();
};

const batchRemoveTargets = () => {
  if (!selectedTargetIds.value.length) {
    return;
  }
  const removeIdSet = new Set(selectedTargetIds.value);
  const removedCount = targets.value.filter((target) => removeIdSet.has(target.requestId)).length;
  targets.value = targets.value.filter((target) => !removeIdSet.has(target.requestId));
  selectedRequestIds.value = selectedRequestIds.value.filter((id) => !removeIdSet.has(id));
  selectedTargetIds.value = [];
  autoSavePressureConfig();
  message.success(`已移除 ${removedCount} 个压测目标`);
};

const runPressureTest = async () => {
  if (!enabledTargets.value.length) {
    message.warning('请先选择接口并保存压测目标配置');
    return;
  }
  starting.value = true;
  try {
    await persistPressureConfig({ silent: true });
    const job = await startPressureTest(selectedSessionId.value, {
      ...config,
      monitoring: monitoringPayload(),
      targets: enabledTargets.value,
    });
    pressureJob.value = job;
    selectedTestId.value = job.batchId || job.jobId;
    upsertTestSummary(job);
    await loadTests({ restore: false });
    message.success('压力测试批次已启动');
    startPressurePolling();
    await pollPressureStatus();
  } catch (error) {
    message.error(error.message || '启动压力测试失败');
  } finally {
    starting.value = false;
  }
};

const summarizeJob = (job) => ({
  batchId: job.batchId || job.jobId,
  jobId: job.jobId || job.batchId,
  sessionId: job.sessionId,
  status: job.status,
  startedAt: job.startedAt,
  finishedAt: job.finishedAt,
  config: job.config,
  summary: job.summary,
  reportId: job.reportId,
  reportPath: job.reportPath,
  error: job.error,
});

const upsertTestSummary = (job) => {
  const summaryRow = summarizeJob(job);
  const index = tests.value.findIndex((test) => test.batchId === summaryRow.batchId);
  if (index >= 0) {
    tests.value.splice(index, 1, summaryRow);
  } else {
    tests.value.unshift(summaryRow);
  }
};

const loadTest = async (batchId) => {
  if (!selectedSessionId.value || !batchId) {
    pressureJob.value = null;
    selectedTestId.value = null;
    return;
  }
  selectedTestId.value = batchId;
  pressureJob.value = await getPressureTest(selectedSessionId.value, batchId);
  upsertTestSummary(pressureJob.value);
  if (['running', 'stopping'].includes(pressureJob.value.status)) {
    startPressurePolling();
  } else {
    clearPressureTimer();
  }
};

const selectTest = async (record) => {
  await loadTest(record.batchId);
};

const clearPressureTimer = () => {
  if (pressureTimer) {
    window.clearInterval(pressureTimer);
    pressureTimer = null;
  }
};

const pollPressureStatus = async () => {
  if (!selectedSessionId.value || !selectedTestId.value) {
    return;
  }
  const status = await getPressureTest(selectedSessionId.value, selectedTestId.value);
  pressureJob.value = status;
  upsertTestSummary(status);
  if (status.status === 'completed') {
    clearPressureTimer();
    stoppingTestId.value = null;
    await loadTests({ restore: false });
    message.success(`压力测试完成：成功率 ${status.summary?.successRate || 0}%，TPS ${status.summary?.tps || 0}`);
  }
  if (status.status === 'failed') {
    clearPressureTimer();
    stoppingTestId.value = null;
    await loadTests({ restore: false });
    message.error(status.error || '压力测试失败');
  }
  if (['stopped', 'cancelled'].includes(status.status)) {
    clearPressureTimer();
    stoppingTestId.value = null;
    await loadTests({ restore: false });
    message.warning('压力测试已停止');
  }
};

const startPressurePolling = () => {
  clearPressureTimer();
  pressureTimer = window.setInterval(() => {
    pollPressureStatus().catch((error) => {
      clearPressureTimer();
      message.error(error.message || '获取压力测试状态失败');
    });
  }, 1000);
};

const stopTest = async (record) => {
  if (!selectedSessionId.value || !record?.batchId || record.status !== 'running') {
    return;
  }
  stoppingTestId.value = record.batchId;
  try {
    const status = await stopPressureTest(selectedSessionId.value, record.batchId);
    pressureJob.value = status;
    selectedTestId.value = status.batchId || status.jobId;
    upsertTestSummary(status);
    message.warning('已发送停止指令');
    startPressurePolling();
  } catch (error) {
    message.error(error.message || '停止压力测试失败');
    stoppingTestId.value = null;
  }
};

const stopCurrentTest = async () => {
  await stopTest(runningTest.value);
};

const confirmDeleteTest = (record) => {
  Modal.confirm({
    title: '确认删除压力测试报告？',
    content: record.batchId,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      await deletePressureTest(selectedSessionId.value, record.batchId);
      if (selectedTestId.value === record.batchId) {
        pressureJob.value = null;
        selectedTestId.value = null;
        clearPressureTimer();
      }
      await loadTests();
      message.success('压力测试报告已删除');
    },
  });
};

const confirmClearTests = () => {
  Modal.confirm({
    title: '确认清空当前会话的压力测试报告？',
    content: '会删除当前会话 pressure-tests 目录下的报告，并停止正在运行的压力测试。',
    okText: '清空',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      await clearPressureTests(selectedSessionId.value);
      tests.value = [];
      pressureJob.value = null;
      selectedTestId.value = null;
      clearPressureTimer();
      message.success('压力测试报告已清空');
    },
  });
};

const testStatusLabel = (status) => ({
  running: '压测中',
  stopping: '停止中',
  stopped: '已停止',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}[status] || '未开始');

const testStatusColor = (status) => ({
  running: 'processing',
  stopping: 'warning',
  stopped: 'default',
  completed: 'green',
  failed: 'red',
  cancelled: 'default',
}[status] || 'default');

const displayUrl = (url) => String(url || '-');

onMounted(async () => {
  await loadSessions();
  await loadSession();
  await loadTests();
});

onBeforeUnmount(() => {
  clearPressureTimer();
});
</script>
