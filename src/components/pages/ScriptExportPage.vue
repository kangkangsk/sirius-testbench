<template>
  <div class="page-stack">
    <a-card class="panel-card">
      <PageSectionHeader
        title="脚本导出"
        description="从整理后的 enabled 请求生成可执行 curl 脚本，后续可继续扩展 Playwright、Postman、JMeter。"
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
            @change="loadSession"
          />
        </a-form-item>
      </div>
      <a-space wrap>
        <a-button type="primary" :loading="generating" :disabled="!selectedSessionId" @click="generate">
          <template #icon><CodeOutlined /></template>
          生成 curl 脚本
        </a-button>
        <a-button :disabled="!selectedSessionId" @click="loadSession">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
      </a-space>
    </a-card>

    <div class="metric-grid">
      <DashboardMetricCard title="启用请求" :value="enabledRequests.length" :icon="ApiOutlined" />
      <DashboardMetricCard title="脚本类型" value="curl" :icon="CodeOutlined" />
      <DashboardMetricCard title="登录态" :value="authMode === 'raw' ? '原样' : '替换'" :icon="SafetyCertificateOutlined" />
      <DashboardMetricCard title="输出文件" :value="result?.fileName || '-'" :icon="FileDoneOutlined" />
    </div>

    <a-card class="detail-card">
      <PageSectionHeader title="输出结果" description="脚本保存在当前 session 的 scripts 目录。" />
      <a-empty v-if="!result" :image="Empty.PRESENTED_IMAGE_SIMPLE" description="尚未生成脚本" />
      <a-descriptions v-else bordered size="small" :column="1">
        <a-descriptions-item label="脚本文件">{{ result.fileName }}</a-descriptions-item>
        <a-descriptions-item label="认证模式">{{ result.authMode }}</a-descriptions-item>
        <a-descriptions-item label="路径">
          <a-typography-paragraph copyable class="url-text">{{ result.scriptPath }}</a-typography-paragraph>
        </a-descriptions-item>
      </a-descriptions>
    </a-card>

    <a-card class="panel-card">
      <PageSectionHeader title="后续扩展点" description="第一版先交付最直接可运行的 curl 脚本。" />
      <a-list :data-source="scriptTypes" size="small">
        <template #renderItem="{ item }">
          <a-list-item>
            <a-list-item-meta :title="item.title" :description="item.description" />
          </a-list-item>
        </template>
      </a-list>
    </a-card>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { Empty, message } from 'ant-design-vue';
import {
  ApiOutlined,
  CodeOutlined,
  FileDoneOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons-vue';
import DashboardMetricCard from '../common/DashboardMetricCard.vue';
import PageSectionHeader from '../common/PageSectionHeader.vue';
import { generateCurlScript, getAuthOverride, getSession, listSessions } from '../../utils/workbench-api.js';
import { filterSessionOption, sessionOptionLabel } from '../../utils/formatters.js';

const sessions = ref([]);
const selectedSessionId = ref(null);
const currentSession = ref({ meta: null, requests: [] });
const authMode = ref('override');
const generating = ref(false);
const result = ref(null);

const scriptTypes = [
  { title: 'curl.sh', description: '已实现，直接用于本地和 CI 调试。' },
  { title: 'Playwright API 测试', description: '设计预留，可生成 expect 断言和 trace。' },
  { title: 'Postman / JMeter', description: '可从 HTTP 请求清单继续转换。' },
];

const sessionOptions = computed(() =>
  sessions.value.map((session) => ({
    value: session.id,
    label: sessionOptionLabel(session),
  }))
);
const enabledRequests = computed(() =>
  (currentSession.value.requests || []).filter((request) => request.enabled !== false)
);

const loadSessions = async () => {
  sessions.value = await listSessions();
  if (!selectedSessionId.value && sessions.value[0]) {
    selectedSessionId.value = sessions.value[0].id;
  }
};

const loadSession = async () => {
  if (!selectedSessionId.value) {
    currentSession.value = { meta: null, requests: [] };
    return;
  }
  const [session, authOverride] = await Promise.all([
    getSession(selectedSessionId.value),
    getAuthOverride(selectedSessionId.value),
  ]);
  currentSession.value = session;
  authMode.value = authOverride.mode || 'override';
};

const generate = async () => {
  generating.value = true;
  try {
    result.value = await generateCurlScript(selectedSessionId.value, {});
    authMode.value = result.value.authMode || authMode.value;
    message.success('curl 脚本已生成');
  } finally {
    generating.value = false;
  }
};

onMounted(async () => {
  await loadSessions();
  await loadSession();
});
</script>
