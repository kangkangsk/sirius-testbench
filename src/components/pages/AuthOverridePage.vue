<template>
  <div class="page-stack">
    <a-card class="panel-card">
      <PageSectionHeader
        title="登录态替换"
        description="原始抓包保持不变；这里的 Cookie、Header 和替换规则只在回放或脚本生成时覆盖。"
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
            @change="loadAuth"
          />
        </a-form-item>
        <a-form-item label="覆盖模式">
          <a-radio-group v-model:value="mode">
            <a-radio-button value="raw">原样</a-radio-button>
            <a-radio-button value="override">统一替换</a-radio-button>
          </a-radio-group>
        </a-form-item>
        <a-form-item label="登录接口">
          <a-select
            v-model:value="loginRequestId"
            allow-clear
            show-search
            option-filter-prop="label"
            :filter-option="filterSessionOption"
            :options="loginRequestOptions"
            placeholder="先执行该接口并接续 Set-Cookie"
          />
        </a-form-item>
      </div>
    </a-card>

    <div class="page-grid content-grid-main-side">
      <a-card class="panel-card">
        <PageSectionHeader title="统一 Cookie" description="例如 SESSION=xxx; JSESSIONID=yyy。" />
        <a-textarea v-model:value="cookie" :rows="8" placeholder="SESSION=xxx; JSESSIONID=yyy" />
      </a-card>

      <a-card class="panel-card">
        <PageSectionHeader title="统一 Header" description="JSON 对象，键名会原样写入回放请求。" />
        <a-textarea v-model:value="headersJson" :rows="8" placeholder='{"Authorization":"Bearer xxx"}' />
      </a-card>
    </div>

    <a-card class="panel-card">
      <PageSectionHeader title="目标 IP / 端口替换" description="统一替换回放 URL 的协议、IP 或域名、端口，路径和参数保持不变。" />
      <div class="filter-grid">
        <a-form-item label="协议">
          <a-select
            v-model:value="endpointProtocol"
            allow-clear
            :options="protocolOptions"
            placeholder="不替换"
          />
        </a-form-item>
        <a-form-item label="目标 IP / 域名">
          <a-input v-model:value="endpointHostname" placeholder="10.10.10.20 或 test.example.com" />
        </a-form-item>
        <a-form-item label="目标端口">
          <a-input v-model:value="endpointPort" placeholder="8080，留空则使用协议默认端口" />
        </a-form-item>
      </div>
    </a-card>

    <a-card class="panel-card">
      <PageSectionHeader
        title="URL / Body 替换规则"
        description="适合替换 sessionId、tenantId 等出现在 URL 或请求体中的值。"
      />
      <a-textarea
        v-model:value="replacementsJson"
        :rows="7"
        placeholder='[{"scope":"all","from":"old-session","to":"new-session"}]'
      />
      <div class="toolbar-row auth-save-row">
        <a-button type="primary" :loading="saving" :disabled="!selectedSessionId" @click="save">
          <template #icon><SaveOutlined /></template>
          保存覆盖配置
        </a-button>
      </div>
    </a-card>

    <a-card class="detail-card">
      <PageSectionHeader title="配置文件" description="保存位置和生效范围。" />
      <a-descriptions bordered size="small" :column="1">
        <a-descriptions-item label="会话">{{ selectedSessionId || '-' }}</a-descriptions-item>
        <a-descriptions-item label="保存文件"><code>auth.override.json</code></a-descriptions-item>
        <a-descriptions-item label="覆盖模式">{{ mode === 'raw' ? '原样' : '统一替换' }}</a-descriptions-item>
        <a-descriptions-item label="登录接口">{{ loginRequestLabel }}</a-descriptions-item>
        <a-descriptions-item label="生效阶段">回放测试、curl 脚本生成</a-descriptions-item>
        <a-descriptions-item label="原始抓包">不修改 `capture.json` / `requests.json` / `resources.json` 中原始认证信息</a-descriptions-item>
      </a-descriptions>
    </a-card>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { message } from 'ant-design-vue';
import { SaveOutlined } from '@ant-design/icons-vue';
import PageSectionHeader from '../common/PageSectionHeader.vue';
import { getAuthOverride, getSession, listSessions, saveAuthOverride } from '../../utils/workbench-api.js';
import { filterSessionOption, sessionOptionLabel, shortUrl } from '../../utils/formatters.js';

const sessions = ref([]);
const selectedSessionId = ref(null);
const currentSession = ref({ meta: null, requests: [] });
const mode = ref('override');
const loginRequestId = ref(undefined);
const cookie = ref('');
const headersJson = ref('{}');
const replacementsJson = ref('[]');
const endpointProtocol = ref('');
const endpointHostname = ref('');
const endpointPort = ref('');
const saving = ref(false);

const protocolOptions = [
  { value: 'http', label: 'http' },
  { value: 'https', label: 'https' },
];

const sessionOptions = computed(() =>
  sessions.value.map((session) => ({
    value: session.id,
    label: sessionOptionLabel(session),
  }))
);
const requests = computed(() => currentSession.value.requests || []);
const loginRequestOptions = computed(() =>
  requests.value.map((request) => ({
    value: request.id,
    label: `${request.id} | ${request.method} | ${shortUrl(request.url)}${request.enabled === false ? ' | 已禁用' : ''}`,
  }))
);
const loginRequestLabel = computed(() => {
  const request = requests.value.find((item) => item.id === loginRequestId.value);
  return request ? `${request.id} | ${request.method} | ${shortUrl(request.url)}` : '未设置';
});

const parseJson = (text, fallback, label) => {
  try {
    return text.trim() ? JSON.parse(text) : fallback;
  } catch (error) {
    throw new Error(`${label} 不是合法 JSON: ${error.message}`);
  }
};

const applyAuthConfig = (auth, session = currentSession.value) => {
  currentSession.value = session || { meta: null, requests: [] };
  mode.value = auth.mode || 'override';
  cookie.value = auth.cookie || '';
  loginRequestId.value = auth.loginRequestId || (auth.updatedAt ? undefined : guessLoginRequestId());
  headersJson.value = JSON.stringify(auth.headers || {}, null, 2);
  replacementsJson.value = JSON.stringify(auth.replacements || [], null, 2);
  endpointProtocol.value = auth.endpoint?.protocol || '';
  endpointHostname.value = auth.endpoint?.hostname || '';
  endpointPort.value = auth.endpoint?.port || '';
};

const loadSessions = async () => {
  sessions.value = await listSessions();
  if (!selectedSessionId.value && sessions.value[0]) {
    selectedSessionId.value = sessions.value[0].id;
  }
};

const loadAuth = async () => {
  if (!selectedSessionId.value) {
    return;
  }
  const [auth, session] = await Promise.all([
    getAuthOverride(selectedSessionId.value),
    getSession(selectedSessionId.value),
  ]);
  applyAuthConfig(auth, session);
};

const guessLoginRequestId = () => {
  const loginRequest = requests.value.find((request) => request.category === 'login')
    || requests.value.find((request) => /login/i.test(request.url) && request.method !== 'GET')
    || requests.value.find((request) => /login|auth|token|session/i.test(request.url));
  return loginRequest?.id;
};

const save = async () => {
  saving.value = true;
  try {
    const headers = parseJson(headersJson.value, {}, '统一 Header');
    const replacements = parseJson(replacementsJson.value, [], '替换规则');
    if (!Array.isArray(replacements)) {
      throw new Error('替换规则必须是数组');
    }
    const payload = {
      cookie: cookie.value,
      headers,
      loginRequestId: loginRequestId.value || '',
      endpoint: {
        protocol: endpointProtocol.value || '',
        hostname: endpointHostname.value.trim(),
        port: endpointPort.value.trim(),
      },
      replacements,
      mode: mode.value,
    };
    const saved = await saveAuthOverride(selectedSessionId.value, payload);
    applyAuthConfig(saved);
    if (saved.mode !== payload.mode || (saved.loginRequestId || '') !== payload.loginRequestId) {
      message.error('保存接口未写入覆盖模式或登录接口，请重启后端服务后再保存');
      return;
    }
    message.success('登录态覆盖配置已保存');
  } catch (error) {
    message.error(error.message);
  } finally {
    saving.value = false;
  }
};

onMounted(async () => {
  await loadSessions();
  await loadAuth();
});
</script>
