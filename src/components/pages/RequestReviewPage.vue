<template>
  <div class="page-stack">
    <a-card class="panel-card">
      <PageSectionHeader
        title="请求整理"
        description="抓包后在这里删除或禁用不希望回放的接口，尤其是新增、修改、删除类请求。"
      />
      <div class="filter-grid session-filter-grid">
        <a-form-item label="抓包会话" class="session-form-item">
          <a-select
            v-model:value="selectedSessionId"
            show-search
            option-filter-prop="label"
            :filter-option="filterSessionOption"
            :options="sessionOptions"
            placeholder="选择会话"
            @change="loadSelectedSession"
          />
        </a-form-item>
        <a-form-item label="请求方法">
          <a-radio-group v-model:value="filters.method" class="filter-tab-group">
            <a-radio-button v-for="option in methodOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </a-radio-button>
          </a-radio-group>
        </a-form-item>
        <a-form-item label="接口分类">
          <a-radio-group v-model:value="filters.category" class="filter-tab-group">
            <a-radio-button v-for="option in categoryOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </a-radio-button>
          </a-radio-group>
        </a-form-item>
        <a-form-item label="状态码">
          <a-select
            v-model:value="filters.statusCode"
            allow-clear
            show-search
            option-filter-prop="label"
            :options="statusCodeOptions"
            placeholder="全部状态码"
          />
        </a-form-item>
        <a-form-item label="URL 关键词">
          <a-input v-model:value="filters.keyword" placeholder="/api/order" />
        </a-form-item>
      </div>
      <a-space wrap>
        <a-button type="primary" @click="loadSelectedSession">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
        <a-button danger :disabled="!selectedSessionId" @click="disableMutations">
          <template #icon><StopOutlined /></template>
          禁用增删改
        </a-button>
        <a-button :disabled="!selectedSessionId" @click="enableAll">
          <template #icon><CheckCircleOutlined /></template>
          全部启用
        </a-button>
      </a-space>
    </a-card>

    <div class="metric-grid">
      <DashboardMetricCard title="HTTP 请求" :value="requests.length" :icon="ApiOutlined" />
      <DashboardMetricCard title="静态资源" :value="resources.length" :icon="FileImageOutlined" />
      <DashboardMetricCard title="启用请求" :value="enabledCount" :icon="CheckCircleOutlined" />
      <DashboardMetricCard title="增删改" :value="mutationCount" :icon="EditOutlined" />
    </div>

    <a-card class="table-card">
      <PageSectionHeader title="请求清单" description="HTTP 请求可启用、禁用、删除和回放；静态资源页面单独查看，不参与回放。" />
      <a-tabs v-model:activeKey="trafficTab" class="traffic-tabs">
        <a-tab-pane key="http" :tab="`HTTP 请求 (${filteredRequests.length})`">
          <a-table
            row-key="id"
            :columns="columns"
            :data-source="filteredRequests"
            :pagination="{ pageSize: 10 }"
            :scroll="{ x: 1240 }"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'enabled'">
                <a-switch
                  class="enable-switch"
                  :checked="record.enabled !== false"
                  checked-children="启用"
                  un-checked-children="禁用"
                  @change="(checked) => updateRequest(record, { enabled: checked })"
                />
              </template>
              <template v-else-if="column.key === 'method'">
                <a-tag :color="methodColor(record.method)">{{ record.method }}</a-tag>
              </template>
              <template v-else-if="column.key === 'category'">
                <a-radio-group
                  :value="reviewCategory(record)"
                  size="small"
                  class="category-select"
                  option-type="button"
                  button-style="solid"
                  @change="(event) => updateRequest(record, { category: event.target.value })"
                >
                  <a-radio-button
                    v-for="option in categoryEditOptions"
                    :key="option.value"
                    :class="`category-option-${option.value}`"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </a-radio-button>
                </a-radio-group>
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
              <template v-else-if="column.key === 'action'">
                <a-space>
                  <a-button type="link" @click="openDetail(record)">详情</a-button>
                  <a-button type="link" danger @click="confirmDelete(record)">删除</a-button>
                </a-space>
              </template>
            </template>
          </a-table>
        </a-tab-pane>
        <a-tab-pane key="static" :tab="`静态资源页面 (${filteredResources.length})`">
          <a-table
            row-key="id"
            :columns="resourceColumns"
            :data-source="filteredResources"
            :pagination="{ pageSize: 10 }"
            :scroll="{ x: 1120 }"
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
              <template v-else-if="column.key === 'action'">
                <a-button type="link" @click="openDetail(record)">详情</a-button>
              </template>
            </template>
          </a-table>
        </a-tab-pane>
      </a-tabs>
    </a-card>

    <RequestDetailDrawer :open="detailOpen" :request="detailRequest" @close="detailOpen = false" />
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { Modal, message } from 'ant-design-vue';
import {
  ApiOutlined,
  CheckCircleOutlined,
  EditOutlined,
  FileImageOutlined,
  ReloadOutlined,
  StopOutlined,
} from '@ant-design/icons-vue';
import DashboardMetricCard from '../common/DashboardMetricCard.vue';
import PageSectionHeader from '../common/PageSectionHeader.vue';
import RequestDetailDrawer from '../common/RequestDetailDrawer.vue';
import {
  batchPatchRequests,
  deleteRequest,
  getSession,
  listSessions,
  patchRequest,
} from '../../utils/workbench-api.js';
import {
  methodColor,
  filterSessionOption,
  responseStatusColor,
  sessionOptionLabel,
  shortUrl,
} from '../../utils/formatters.js';

const sessions = ref([]);
const selectedSessionId = ref(null);
const currentSession = ref({ meta: null, requests: [], resources: [] });
const trafficTab = ref('http');
const detailOpen = ref(false);
const detailRequest = ref(null);
const filters = reactive({
  method: 'all',
  category: 'all',
  statusCode: undefined,
  keyword: '',
});

const methodOptions = ['all', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((value) => ({
  value,
  label: value === 'all' ? '全部' : value,
}));
const categoryEditOptions = [
  { value: 'create', label: '增' },
  { value: 'delete', label: '删' },
  { value: 'update', label: '改' },
  { value: 'query', label: '查' },
];
const categoryOptions = [{ value: 'all', label: '全部' }, ...categoryEditOptions];
const columns = [
  { title: '启用', key: 'enabled', width: 105, fixed: 'left' },
  { title: '序号', dataIndex: 'id', key: 'id', width: 90 },
  { title: '方法', dataIndex: 'method', key: 'method', width: 90 },
  { title: '分类', dataIndex: 'category', key: 'category', width: 210 },
  { title: '类型', dataIndex: 'resourceType', key: 'resourceType', width: 100 },
  { title: 'URL', dataIndex: 'url', key: 'url', ellipsis: true },
  { title: '响应', key: 'response', width: 90 },
  { title: '耗时', dataIndex: 'durationMs', key: 'durationMs', width: 100 },
  { title: '操作', key: 'action', fixed: 'right', width: 140 },
];
const resourceColumns = [
  { title: '序号', dataIndex: 'id', key: 'id', width: 90 },
  { title: '方法', dataIndex: 'method', key: 'method', width: 90 },
  { title: '资源类型', dataIndex: 'resourceType', key: 'resourceType', width: 120 },
  { title: 'URL', dataIndex: 'url', key: 'url', ellipsis: true },
  { title: '响应', key: 'response', width: 90 },
  { title: '耗时', dataIndex: 'durationMs', key: 'durationMs', width: 100 },
  { title: '操作', key: 'action', fixed: 'right', width: 90 },
];

const requests = computed(() => currentSession.value.requests || []);
const resources = computed(() => currentSession.value.resources || []);
const sessionOptions = computed(() =>
  sessions.value.map((session) => ({
    value: session.id,
    label: sessionOptionLabel(session),
  }))
);
const enabledCount = computed(() => requests.value.filter((request) => request.enabled !== false).length);
const mutationCount = computed(() =>
  requests.value.filter((request) => ['POST', 'PUT', 'PATCH'].includes(request.method)).length
);
const responseStatusKey = (request) => {
  const status = request.response?.status;
  return status === undefined || status === null ? 'no-response' : String(status);
};
const statusCodeOptions = computed(() => {
  const optionMap = new Map();
  [...requests.value, ...resources.value].forEach((request) => {
    const key = responseStatusKey(request);
    optionMap.set(key, {
      value: key,
      label: key === 'no-response' ? '无响应' : key,
    });
  });
  return [...optionMap.values()].sort((first, second) => {
    if (first.value === 'no-response') {
      return 1;
    }
    if (second.value === 'no-response') {
      return -1;
    }
    return Number(first.value) - Number(second.value);
  });
});
const reviewCategory = (request) => {
  if (request.category === 'mutation') {
    return ['POST'].includes(request.method) ? 'create' : 'update';
  }
  if (['create', 'delete', 'update', 'query'].includes(request.category)) {
    return request.category;
  }
  if (request.method === 'GET') {
    return 'query';
  }
  if (request.method === 'DELETE') {
    return 'delete';
  }
  if (request.method === 'POST') {
    return 'create';
  }
  if (['PUT', 'PATCH'].includes(request.method)) {
    return 'update';
  }
  return 'query';
};
const filteredRequests = computed(() =>
  requests.value.filter((request) => {
    const methodMatched = filters.method === 'all' || request.method === filters.method;
    const categoryMatched = filters.category === 'all' || reviewCategory(request) === filters.category;
    const statusMatched = !filters.statusCode || responseStatusKey(request) === filters.statusCode;
    const keywordMatched = !filters.keyword || request.url.includes(filters.keyword);
    return methodMatched && categoryMatched && statusMatched && keywordMatched;
  })
);
const filteredResources = computed(() =>
  resources.value.filter((request) => {
    const methodMatched = filters.method === 'all' || request.method === filters.method;
    const statusMatched = !filters.statusCode || responseStatusKey(request) === filters.statusCode;
    const keywordMatched = !filters.keyword || request.url.includes(filters.keyword);
    return methodMatched && statusMatched && keywordMatched;
  })
);

const loadSessions = async () => {
  sessions.value = await listSessions();
  if (!selectedSessionId.value && sessions.value[0]) {
    selectedSessionId.value = sessions.value[0].id;
  }
};

const loadSelectedSession = async () => {
  if (!selectedSessionId.value) {
    currentSession.value = { meta: null, requests: [], resources: [] };
    return;
  }
  currentSession.value = await getSession(selectedSessionId.value);
};

const applyLocalRequestPatch = (requestId, patch) => {
  currentSession.value = {
    ...currentSession.value,
    requests: requests.value.map((request) =>
      request.id === requestId ? { ...request, ...patch, updatedAt: new Date().toISOString() } : request
    ),
  };
};

const updateRequest = async (record, patch) => {
  const before = { ...record };
  applyLocalRequestPatch(record.id, patch);
  try {
    const result = await patchRequest(selectedSessionId.value, record.id, patch);
    currentSession.value = { ...currentSession.value, meta: result.meta };
  } catch (error) {
    applyLocalRequestPatch(record.id, before);
    message.error(error.message || '请求更新失败');
  }
};

const confirmDelete = (record) => {
  Modal.confirm({
    title: '确认删除请求？',
    content: `${record.method} ${record.url}`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      const result = await deleteRequest(selectedSessionId.value, record.id);
      currentSession.value = result;
      message.success('请求已删除');
    },
  });
};

const disableMutations = async () => {
  const before = currentSession.value.requests || [];
  currentSession.value = {
    ...currentSession.value,
    requests: requests.value.map((request) =>
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) ? { ...request, enabled: false } : request
    ),
  };
  try {
    const result = await batchPatchRequests(selectedSessionId.value, {
      methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
      patch: { enabled: false },
    });
    currentSession.value = result;
    message.success('已禁用 POST / PUT / PATCH / DELETE 请求');
  } catch (error) {
    currentSession.value = { ...currentSession.value, requests: before };
    message.error(error.message || '批量禁用失败');
  }
};

const enableAll = async () => {
  const before = currentSession.value.requests || [];
  currentSession.value = {
    ...currentSession.value,
    requests: requests.value.map((request) => ({ ...request, enabled: true })),
  };
  try {
    const result = await batchPatchRequests(selectedSessionId.value, {
      methods: [],
      patch: { enabled: true },
    });
    currentSession.value = result;
    message.success('已启用全部请求');
  } catch (error) {
    currentSession.value = { ...currentSession.value, requests: before };
    message.error(error.message || '批量启用失败');
  }
};

const openDetail = (record) => {
  detailRequest.value = record;
  detailOpen.value = true;
};

onMounted(async () => {
  await loadSessions();
  await loadSelectedSession();
});
</script>
