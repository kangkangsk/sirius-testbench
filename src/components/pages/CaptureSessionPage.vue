<template>
  <div class="page-stack">
    <a-card class="panel-card">
      <PageSectionHeader
        title="开始抓包"
        description="点击开始后会启动有界面 Chromium；你在浏览器里登录和操作，后台实时记录 HTTP 请求。"
      >
        <template #extra>
          <a-button @click="mechanismOpen = true">
            <template #icon><EyeOutlined /></template>
            查看抓包机制
          </a-button>
        </template>
      </PageSectionHeader>

      <a-form layout="vertical">
        <div class="capture-form-grid">
          <a-form-item label="目标网站 URL" class="capture-target-field" required>
            <a-input v-model:value="form.targetUrl" placeholder="https://example.com">
              <template #prefix><GlobalOutlined /></template>
            </a-input>
          </a-form-item>
          <a-form-item label="会话名称">
            <a-input v-model:value="form.sessionName" placeholder="可选，例如 login-query-flow" />
          </a-form-item>
          <a-form-item label="已有会话">
            <a-select
              v-model:value="selectedSessionId"
              allow-clear
              show-search
              option-filter-prop="label"
              :filter-option="filterSessionOption"
              :options="sessionOptions"
              placeholder="选择后查看请求"
              @change="loadSelectedSession"
            />
          </a-form-item>
        </div>
        <a-space wrap>
          <a-button type="primary" :loading="starting" @click="start">
            <template #icon><PlayCircleOutlined /></template>
            开始抓包
          </a-button>
          <a-button danger :disabled="!currentSession.meta?.id" :loading="stopping" @click="stop">
            <template #icon><PauseCircleOutlined /></template>
            停止抓包
          </a-button>
          <a-button @click="refresh">
            <template #icon><ReloadOutlined /></template>
            刷新
          </a-button>
        </a-space>
      </a-form>
    </a-card>

    <div class="metric-grid">
      <DashboardMetricCard title="浏览器状态" :value="browserStatus" :icon="DesktopOutlined" />
      <DashboardMetricCard title="HTTP 请求" :value="currentSession.requests.length" :icon="ApiOutlined" />
      <DashboardMetricCard title="静态资源" :value="currentSession.resources.length" :icon="FileImageOutlined" />
      <DashboardMetricCard title="失败请求" :value="failedCount" :icon="WarningOutlined" />
    </div>

    <div class="page-grid content-grid-main-side">
      <a-card class="detail-card">
        <PageSectionHeader title="会话状态" description="抓包运行态和文件写入位置。" />
        <a-descriptions bordered size="small" :column="1">
          <a-descriptions-item label="会话 ID">{{ currentSession.meta?.id || '-' }}</a-descriptions-item>
          <a-descriptions-item label="状态">
            <span :class="`status-pill ${statusClass(currentSession.meta?.status)}`">
              {{ statusLabel(currentSession.meta?.status) }}
            </span>
          </a-descriptions-item>
          <a-descriptions-item label="Session 目录">
            <a-typography-paragraph copyable class="url-text">
              {{ currentSession.meta?.sessionDir || '-' }}
            </a-typography-paragraph>
          </a-descriptions-item>
          <a-descriptions-item label="HAR 文件">
            <a-typography-paragraph copyable class="url-text">
              {{ currentSession.meta?.harPath || '-' }}
            </a-typography-paragraph>
          </a-descriptions-item>
        </a-descriptions>
      </a-card>

      <a-card class="panel-card">
        <PageSectionHeader title="抓包可见性" description="页面会显示 Playwright 监听到的关键事件。" />
        <a-timeline>
          <a-timeline-item>创建 session 目录和 `meta.json`</a-timeline-item>
          <a-timeline-item>启动有界面 Chromium</a-timeline-item>
          <a-timeline-item>监听 request / response / requestfailed</a-timeline-item>
          <a-timeline-item>XHR/FETCH 等接口请求写入 `requests.json`</a-timeline-item>
          <a-timeline-item>JS/CSS/图片/HTML 等静态资源写入 `resources.json`</a-timeline-item>
          <a-timeline-item>停止时关闭浏览器并落 HAR 文件</a-timeline-item>
        </a-timeline>
      </a-card>
    </div>

    <a-card class="table-card">
      <PageSectionHeader title="实时流量列表" description="接口请求和静态资源分开展示；请求整理和回放只处理 HTTP 请求。" />
      <a-tabs v-model:activeKey="trafficTab" class="traffic-tabs">
        <a-tab-pane key="requests" :tab="`HTTP 请求 (${currentSession.requests.length})`">
          <a-table
            row-key="id"
            :columns="columns"
            :data-source="currentSession.requests"
            :pagination="{ pageSize: 10 }"
            :scroll="{ x: 1180 }"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'method'">
                <a-tag :color="methodColor(record.method)">{{ record.method }}</a-tag>
              </template>
              <template v-else-if="column.key === 'url'">
                <a-tooltip :title="record.url">{{ shortUrl(record.url) }}</a-tooltip>
              </template>
              <template v-else-if="column.key === 'response'">
                <a-tag v-if="record.response" :color="responseStatusColor(record.response.status)">
                  {{ record.response.status }}
                </a-tag>
                <span v-else>-</span>
              </template>
              <template v-else-if="column.key === 'status'">
                <span :class="`status-pill ${statusClass(record.status)}`">{{ statusLabel(record.status) }}</span>
              </template>
              <template v-else-if="column.key === 'action'">
                <a-button type="link" @click="openDetail(record)">详情</a-button>
              </template>
            </template>
          </a-table>
        </a-tab-pane>
        <a-tab-pane key="resources" :tab="`静态资源 (${currentSession.resources.length})`">
          <a-table
            row-key="id"
            :columns="resourceColumns"
            :data-source="currentSession.resources"
            :pagination="{ pageSize: 10 }"
            :scroll="{ x: 1180 }"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'method'">
                <a-tag :color="methodColor(record.method)">{{ record.method }}</a-tag>
              </template>
              <template v-else-if="column.key === 'url'">
                <a-tooltip :title="record.url">{{ shortUrl(record.url) }}</a-tooltip>
              </template>
              <template v-else-if="column.key === 'response'">
                <a-tag v-if="record.response" :color="responseStatusColor(record.response.status)">
                  {{ record.response.status }}
                </a-tag>
                <span v-else>-</span>
              </template>
              <template v-else-if="column.key === 'status'">
                <span :class="`status-pill ${statusClass(record.status)}`">{{ statusLabel(record.status) }}</span>
              </template>
              <template v-else-if="column.key === 'action'">
                <a-button type="link" @click="openDetail(record)">详情</a-button>
              </template>
            </template>
          </a-table>
        </a-tab-pane>
      </a-tabs>
    </a-card>

    <RequestDetailDrawer :open="detailOpen" :request="detailRequest" @close="detailOpen = false" />

    <a-drawer title="抓包会话如何工作" :open="mechanismOpen" :width="720" @close="mechanismOpen = false">
      <a-space direction="vertical" class="full-width" :size="16">
        <a-alert
          type="info"
          show-icon
          message="抓包不是系统代理，而是受控浏览器监听网络事件。"
          description="开始抓包后，后端启动有界面 Chromium。你在浏览器中完成登录、点击、查询，服务端通过 Playwright 监听页面 request / response / requestfailed 事件。"
        />
        <a-card class="panel-card" size="small" title="核心监听逻辑">
          <pre class="code-block">context.on('request', async (request) => {
  saveRequest({
    method: request.method(),
    url: request.url(),
    resourceType: request.resourceType(),
    trafficType: classifyTraffic(request),
    headers: await request.allHeaders(),
    headersArray: await request.headersArray(),
    postData: request.postData(),
  });
});</pre>
          <pre class="code-block">context.on('response', async (response) => {
  saveResponse({
    status: response.status(),
    headers: await response.allHeaders(),
    headersArray: await response.headersArray(),
    body: await safeReadBody(response),
  });
});</pre>
        </a-card>
        <a-card class="panel-card" size="small" title="文件写入">
          <a-list :data-source="fileSteps" size="small">
            <template #renderItem="{ item }">
              <a-list-item><code>{{ item }}</code></a-list-item>
            </template>
          </a-list>
        </a-card>
      </a-space>
    </a-drawer>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { message } from 'ant-design-vue';
import {
  ApiOutlined,
  DesktopOutlined,
  EyeOutlined,
  FileImageOutlined,
  GlobalOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  WarningOutlined,
} from '@ant-design/icons-vue';
import DashboardMetricCard from '../common/DashboardMetricCard.vue';
import PageSectionHeader from '../common/PageSectionHeader.vue';
import RequestDetailDrawer from '../common/RequestDetailDrawer.vue';
import {
  getCaptureStatus,
  getSession,
  listSessions,
  startCapture,
  stopCapture,
} from '../../utils/workbench-api.js';
import {
  methodColor,
  responseStatusColor,
  shortUrl,
  filterSessionOption,
  sessionOptionLabel,
  statusClass,
  statusLabel,
} from '../../utils/formatters.js';

const form = reactive({
  targetUrl: '',
  sessionName: '',
});
const sessions = ref([]);
const selectedSessionId = ref(null);
const currentSession = ref({ meta: null, requests: [], resources: [] });
const trafficTab = ref('requests');
const starting = ref(false);
const stopping = ref(false);
const detailOpen = ref(false);
const detailRequest = ref(null);
const mechanismOpen = ref(false);
let timer = null;

const columns = [
  { title: '序号', dataIndex: 'id', key: 'id', width: 90 },
  { title: '方法', dataIndex: 'method', key: 'method', width: 90 },
  { title: '类型', dataIndex: 'resourceType', key: 'resourceType', width: 100 },
  { title: 'URL', dataIndex: 'url', key: 'url', ellipsis: true },
  { title: '响应', key: 'response', width: 90 },
  { title: '状态', dataIndex: 'status', key: 'status', width: 120 },
  { title: '耗时', dataIndex: 'durationMs', key: 'durationMs', width: 100 },
  { title: '时间', dataIndex: 'timestamp', key: 'timestamp', width: 190 },
  { title: '操作', key: 'action', fixed: 'right', width: 90 },
];
const resourceColumns = [
  { title: '序号', dataIndex: 'id', key: 'id', width: 90 },
  { title: '方法', dataIndex: 'method', key: 'method', width: 90 },
  { title: '资源类型', dataIndex: 'resourceType', key: 'resourceType', width: 110 },
  { title: 'URL', dataIndex: 'url', key: 'url', ellipsis: true },
  { title: '响应', key: 'response', width: 90 },
  { title: '状态', dataIndex: 'status', key: 'status', width: 120 },
  { title: '耗时', dataIndex: 'durationMs', key: 'durationMs', width: 100 },
  { title: '时间', dataIndex: 'timestamp', key: 'timestamp', width: 190 },
  { title: '操作', key: 'action', fixed: 'right', width: 90 },
];

const fileSteps = [
  'meta.json：会话状态、目标 URL、浏览器状态、HAR 路径',
  'requests.json：HTTP 接口请求，后续整理和回放只读取这里',
  'resources.json：静态资源请求，如 JS、CSS、图片、HTML、字体',
  'capture.json：原始抓包元数据和请求合并视图',
  'capture.har：Playwright 停止 context 时生成',
];

const sessionOptions = computed(() =>
  sessions.value.map((session) => ({
    value: session.id,
    label: sessionOptionLabel(session, { includeStatic: true }),
  }))
);
const failedCount = computed(() =>
  [...currentSession.value.requests, ...currentSession.value.resources]
    .filter((request) => request.status === 'failed').length
);
const browserStatus = computed(() => {
  if (currentSession.value.meta?.status === 'capturing') {
    return '运行中';
  }
  if (currentSession.value.meta?.status === 'stopped') {
    return '已停止';
  }
  return '未启动';
});

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

const loadSessions = async () => {
  sessions.value = await listSessions();
};

const loadSelectedSession = async () => {
  if (!selectedSessionId.value) {
    currentSession.value = { meta: null, requests: [], resources: [] };
    return;
  }
  currentSession.value = await getSession(selectedSessionId.value);
};

const refresh = async () => {
  await loadSessions();
  if (selectedSessionId.value) {
    if (currentSession.value.meta?.status === 'capturing') {
      currentSession.value = await getCaptureStatus(selectedSessionId.value);
    } else {
      await loadSelectedSession();
    }
  }
};

const start = async () => {
  const targetUrl = normalizeTargetUrl(form.targetUrl);
  if (!targetUrl) {
    message.warning('请先输入目标网站 URL');
    return;
  }
  starting.value = true;
  const hideLoading = message.loading('正在启动有界面 Chromium...', 0);
  try {
    form.targetUrl = targetUrl;
    const result = await startCapture({ ...form, targetUrl });
    selectedSessionId.value = result.meta.id;
    currentSession.value = result.session;
    message.success(result.message);
    await loadSessions();
    await refresh();
  } catch (error) {
    message.error(error.message || '启动抓包失败，请查看后端日志');
  } finally {
    hideLoading();
    starting.value = false;
  }
};

const stop = async () => {
  if (!currentSession.value.meta?.id) {
    return;
  }
  stopping.value = true;
  try {
    const result = await stopCapture(currentSession.value.meta.id);
    currentSession.value = { meta: result.meta, requests: result.requests || [], resources: result.resources || [] };
    message.success(result.message);
    await loadSessions();
  } catch (error) {
    message.error(error.message || '停止抓包失败');
  } finally {
    stopping.value = false;
  }
};

const openDetail = (record) => {
  detailRequest.value = record;
  detailOpen.value = true;
};

onMounted(async () => {
  await loadSessions();
  timer = window.setInterval(refresh, 2500);
});

onBeforeUnmount(() => {
  if (timer) {
    window.clearInterval(timer);
  }
});
</script>
