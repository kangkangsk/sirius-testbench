<template>
  <div class="page-stack">
    <a-card class="panel-card">
      <PageSectionHeader
        title="工作空间设置"
        description="所有抓包会话、请求清单、登录态覆盖配置、脚本和报告都写入这个本地目录。"
      >
        <template #extra>
          <a-button @click="workspaceDetailOpen = true">
            <template #icon><FolderOpenOutlined /></template>
            查看详情
          </a-button>
        </template>
      </PageSectionHeader>
      <a-form layout="vertical" @finish="save">
        <div class="workspace-form-row">
          <a-form-item label="本地工作空间目录" class="workspace-path-field">
            <a-input v-model:value="workspacePath" placeholder="/Users/zhaomk/capture-workspace">
              <template #prefix><FolderOpenOutlined /></template>
            </a-input>
          </a-form-item>
          <a-button type="primary" html-type="submit" :loading="saving">
            <template #icon><SaveOutlined /></template>
            保存
          </a-button>
          <a-button @click="loadWorkspace">
            <template #icon><ReloadOutlined /></template>
            刷新
          </a-button>
        </div>
      </a-form>
    </a-card>

    <div class="metric-grid">
      <DashboardMetricCard title="会话数量" :value="summary.sessionCount || 0" :icon="CloudSyncOutlined" />
      <DashboardMetricCard title="报告数量" :value="summary.reportCount || 0" :icon="FileDoneOutlined" />
      <DashboardMetricCard title="存储方式" value="文件" :icon="DatabaseOutlined" />
      <DashboardMetricCard title="浏览器模式" value="有界面" :icon="DesktopOutlined" />
    </div>

    <a-card class="table-card">
      <PageSectionHeader title="最近抓包会话" description="从工作空间 sessions 目录读取，支持按名称、ID、URL、目录搜索。">
        <template #extra>
          <a-input-search
            v-model:value="sessionKeyword"
            class="session-search"
            placeholder="搜索会话"
            allow-clear
          />
        </template>
      </PageSectionHeader>
      <a-table
        row-key="id"
        :columns="columns"
        :data-source="filteredSessions"
        :pagination="{ pageSize: 6 }"
        :scroll="{ x: 1320 }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'name'">
            <a-typography-text strong>{{ sessionDisplayName(record) }}</a-typography-text>
          </template>
          <template v-else-if="column.key === 'id'">
            <a-typography-text copyable>{{ record.id }}</a-typography-text>
          </template>
          <template v-else-if="column.key === 'status'">
            <span :class="`status-pill ${statusClass(record.status)}`">{{ statusLabel(record.status) }}</span>
          </template>
          <template v-else-if="column.key === 'startedAt'">
            {{ formatSessionTime(record.startedAt) }}
          </template>
          <template v-else-if="column.key === 'path'">
            <a-typography-text copyable>{{ record.sessionDir }}</a-typography-text>
          </template>
          <template v-else-if="column.key === 'action'">
            <a-space>
              <a-button type="link" @click="openSessionDetail(record)">详情</a-button>
              <a-button type="link" danger @click="confirmDeleteSession(record)">删除</a-button>
            </a-space>
          </template>
        </template>
      </a-table>
    </a-card>

    <a-drawer
      title="工作空间详情"
      :open="workspaceDetailOpen"
      :width="760"
      @close="workspaceDetailOpen = false"
    >
      <a-space direction="vertical" class="full-width" :size="18">
        <div>
          <PageSectionHeader title="当前目录" description="服务端实际写入位置。" compact />
          <a-descriptions bordered size="small" :column="1">
            <a-descriptions-item label="目录">
              <a-typography-paragraph copyable class="url-text">{{ summary.workspacePath || '-' }}</a-typography-paragraph>
            </a-descriptions-item>
            <a-descriptions-item label="状态">
              <span :class="`status-pill ${summary.exists ? 'is-success' : 'is-warning'}`">
                {{ summary.exists ? '可用' : '未初始化' }}
              </span>
            </a-descriptions-item>
          </a-descriptions>
        </div>

        <div>
          <PageSectionHeader title="目录结构" description="第一版不使用数据库，所有状态都可直接查看和备份。" compact />
          <div class="directory-chip-list">
            <code v-for="item in summary.directoryLayout || []" :key="item">{{ item }}</code>
          </div>
        </div>
      </a-space>
    </a-drawer>

    <a-drawer
      title="会话详情"
      :open="detailOpen"
      :width="760"
      @close="detailOpen = false"
    >
      <a-empty v-if="!detailSession" />
      <a-descriptions v-else bordered size="small" :column="1">
        <a-descriptions-item label="会话名称">{{ detailSession.name || '-' }}</a-descriptions-item>
        <a-descriptions-item label="会话 ID">{{ detailSession.id }}</a-descriptions-item>
        <a-descriptions-item label="目标 URL">
          <a-typography-paragraph copyable class="url-text">{{ detailSession.targetUrl }}</a-typography-paragraph>
        </a-descriptions-item>
        <a-descriptions-item label="状态">
          <span :class="`status-pill ${statusClass(detailSession.status)}`">{{ statusLabel(detailSession.status) }}</span>
        </a-descriptions-item>
        <a-descriptions-item label="HTTP 请求">{{ detailSession.requestCount || 0 }}</a-descriptions-item>
        <a-descriptions-item label="静态资源">{{ detailSession.staticResourceCount || 0 }}</a-descriptions-item>
        <a-descriptions-item label="总流量">{{ detailSession.totalTrafficCount || 0 }}</a-descriptions-item>
        <a-descriptions-item label="失败请求">{{ detailSession.failedCount || 0 }}</a-descriptions-item>
        <a-descriptions-item label="开始时间">{{ detailSession.startedAt || '-' }}</a-descriptions-item>
        <a-descriptions-item label="停止时间">{{ detailSession.stoppedAt || '-' }}</a-descriptions-item>
        <a-descriptions-item label="Session 目录">
          <a-typography-paragraph copyable class="url-text">{{ detailSession.sessionDir }}</a-typography-paragraph>
        </a-descriptions-item>
        <a-descriptions-item label="HAR 文件">
          <a-typography-paragraph copyable class="url-text">{{ detailSession.harPath }}</a-typography-paragraph>
        </a-descriptions-item>
      </a-descriptions>
    </a-drawer>
  </div>
</template>

<script setup>
import { computed, h, onMounted, ref } from 'vue';
import { Modal, message } from 'ant-design-vue';
import {
  CloudSyncOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  DesktopOutlined,
  FileDoneOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
  SaveOutlined,
} from '@ant-design/icons-vue';
import DashboardMetricCard from '../common/DashboardMetricCard.vue';
import PageSectionHeader from '../common/PageSectionHeader.vue';
import { deleteSession, getWorkspace, listSessions, saveWorkspace } from '../../utils/workbench-api.js';
import {
  formatSessionTime,
  sessionDisplayName,
  statusClass,
  statusLabel,
} from '../../utils/formatters.js';

const workspacePath = ref('');
const summary = ref({});
const sessions = ref([]);
const sessionKeyword = ref('');
const workspaceDetailOpen = ref(false);
const detailOpen = ref(false);
const detailSession = ref(null);
const saving = ref(false);

const columns = [
  { title: '会话名称', dataIndex: 'name', key: 'name', width: 210 },
  { title: '会话 ID', dataIndex: 'id', key: 'id', width: 250 },
  { title: '目标 URL', dataIndex: 'targetUrl', key: 'targetUrl', ellipsis: true },
  { title: '状态', dataIndex: 'status', key: 'status', width: 120 },
  { title: '开始时间', dataIndex: 'startedAt', key: 'startedAt', width: 180 },
  { title: 'HTTP 请求', dataIndex: 'requestCount', key: 'requestCount', width: 100 },
  { title: '静态资源', dataIndex: 'staticResourceCount', key: 'staticResourceCount', width: 100 },
  { title: '报告数', dataIndex: 'reportCount', key: 'reportCount', width: 90 },
  { title: '目录', dataIndex: 'sessionDir', key: 'path', width: 260 },
  { title: '操作', key: 'action', fixed: 'right', width: 130 },
];

const filteredSessions = computed(() => {
  const keyword = sessionKeyword.value.trim().toLowerCase();
  if (!keyword) {
    return sessions.value;
  }
  return sessions.value.filter((session) =>
    [
      session.name,
      session.id,
      session.targetUrl,
      session.status,
      session.startedAt,
      session.sessionDir,
    ].some((value) => String(value || '').toLowerCase().includes(keyword))
  );
});

const loadWorkspace = async () => {
  summary.value = await getWorkspace();
  workspacePath.value = summary.value.workspacePath || '';
  sessions.value = await listSessions();
};

const save = async () => {
  saving.value = true;
  try {
    summary.value = await saveWorkspace(workspacePath.value);
    message.success('工作空间已保存');
    await loadWorkspace();
  } finally {
    saving.value = false;
  }
};

const openSessionDetail = (session) => {
  detailSession.value = session;
  detailOpen.value = true;
};

const confirmDeleteSession = (session) => {
  Modal.confirm({
    title: '确认删除抓包会话？',
    content: `会删除 ${sessionDisplayName(session)} 的请求、登录态配置、脚本和回放报告。`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    icon: h(DeleteOutlined),
    async onOk() {
      await deleteSession(session.id);
      if (detailSession.value?.id === session.id) {
        detailOpen.value = false;
        detailSession.value = null;
      }
      message.success('抓包会话已删除');
      await loadWorkspace();
    },
  });
};

onMounted(loadWorkspace);
</script>
