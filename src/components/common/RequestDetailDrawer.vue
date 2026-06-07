<template>
  <a-drawer
    :title="request ? `${request.method} ${request.id}` : '请求详情'"
    :open="open"
    :width="760"
    @close="emit('close')"
  >
    <a-empty v-if="!request" :image="Empty.PRESENTED_IMAGE_SIMPLE" />
    <div v-else class="request-detail">
      <a-descriptions bordered size="small" :column="1">
        <a-descriptions-item label="URL">
          <a-typography-paragraph copyable class="url-text">{{ request.url }}</a-typography-paragraph>
        </a-descriptions-item>
        <a-descriptions-item label="方法 / 类型">
          <a-space>
            <a-tag :color="methodColor(request.method)">{{ request.method }}</a-tag>
            <a-tag>{{ request.resourceType || '-' }}</a-tag>
            <span :class="`status-pill ${statusClass(request.status)}`">{{ statusLabel(request.status) }}</span>
          </a-space>
        </a-descriptions-item>
        <a-descriptions-item label="分类">{{ categoryLabel(request.category) }}</a-descriptions-item>
        <a-descriptions-item label="耗时">{{ request.durationMs ?? '-' }} ms</a-descriptions-item>
        <a-descriptions-item v-if="hasReplayResult" label="回测结果">
          <a-space wrap>
            <a-tag :color="replayResultColor">{{ replayResultLabel }}</a-tag>
            <a-tag v-if="replayStatusCode !== null" :color="responseStatusColor(replayStatusCode)">
              {{ replayStatusCode || 'ERR' }}
            </a-tag>
            <a-typography-text v-if="request.retestCount" type="secondary">
              已重测 {{ request.retestCount }} 次
            </a-typography-text>
          </a-space>
        </a-descriptions-item>
      </a-descriptions>

      <a-tabs class="detail-tabs">
        <a-tab-pane v-if="hasReplayResult" key="replay-result" tab="回测结果">
          <a-space direction="vertical" class="full-width" :size="12">
            <a-descriptions bordered size="small" :column="1">
              <a-descriptions-item label="执行结果">
                <a-tag :color="replayResultColor">{{ replayResultLabel }}</a-tag>
              </a-descriptions-item>
              <a-descriptions-item label="状态码">
                <a-tag :color="responseStatusColor(replayStatusCode)">{{ replayStatusCode || 'ERR' }}</a-tag>
                <span v-if="replayStatusText"> {{ replayStatusText }}</span>
              </a-descriptions-item>
              <a-descriptions-item label="耗时">{{ request.durationMs ?? '-' }} ms</a-descriptions-item>
              <a-descriptions-item label="登录态来源">{{ authSourceLabel(request.authSource) }}</a-descriptions-item>
              <a-descriptions-item label="开始时间">{{ formatSessionTime(request.startedAt) }}</a-descriptions-item>
              <a-descriptions-item label="结束时间">{{ formatSessionTime(request.finishedAt) }}</a-descriptions-item>
              <a-descriptions-item v-if="request.retestedAt" label="最近重测">
                第 {{ request.retestCount || 1 }} 次，{{ formatSessionTime(request.retestedAt) }}
              </a-descriptions-item>
              <a-descriptions-item v-if="request.error" label="错误">
                <a-typography-text type="danger">{{ request.error }}</a-typography-text>
              </a-descriptions-item>
            </a-descriptions>

            <a-divider orientation="left">实际请求 Header</a-divider>
            <pre class="code-block">{{ prettyJson(request.headers) || '无请求 Header' }}</pre>
            <a-divider orientation="left">实际请求 Body</a-divider>
            <pre class="code-block">{{ prettyJson(request.postData) || '无请求体' }}</pre>
            <a-divider orientation="left">响应 Header</a-divider>
            <pre class="code-block">{{ prettyJson(request.response?.headers || request.responseHeaders) || '无响应 Header' }}</pre>
            <a-divider orientation="left">响应 Body</a-divider>
            <pre class="code-block">{{ responseBodyText }}</pre>
          </a-space>
        </a-tab-pane>
        <a-tab-pane v-if="retestHistory.length" key="retest-history" tab="重测记录">
          <a-collapse>
            <a-collapse-panel
              v-for="item in retestHistory"
              :key="item.attempt"
              :header="retestHistoryTitle(item)"
            >
              <a-space direction="vertical" class="full-width" :size="12">
                <a-descriptions bordered size="small" :column="1">
                  <a-descriptions-item label="执行结果">
                    <a-tag :color="item.ok ? 'green' : 'red'">{{ item.ok ? '通过' : '失败' }}</a-tag>
                  </a-descriptions-item>
                  <a-descriptions-item label="状态码">
                    <a-tag :color="responseStatusColor(item.status)">{{ item.status || 'ERR' }}</a-tag>
                    <span v-if="item.statusText"> {{ item.statusText }}</span>
                  </a-descriptions-item>
                  <a-descriptions-item label="耗时">{{ item.durationMs ?? '-' }} ms</a-descriptions-item>
                  <a-descriptions-item label="登录态来源">{{ authSourceLabel(item.authSource) }}</a-descriptions-item>
                  <a-descriptions-item label="重测时间">{{ formatSessionTime(item.retestedAt || item.finishedAt) }}</a-descriptions-item>
                  <a-descriptions-item v-if="item.error" label="错误">
                    <a-typography-text type="danger">{{ item.error }}</a-typography-text>
                  </a-descriptions-item>
                </a-descriptions>

                <a-divider orientation="left">请求 Header</a-divider>
                <pre class="code-block">{{ prettyJson(item.headers) || '无请求 Header' }}</pre>
                <a-divider orientation="left">响应 Header</a-divider>
                <pre class="code-block">{{ prettyJson(item.response?.headers || item.responseHeaders) || '无响应 Header' }}</pre>
                <a-divider orientation="left">响应 Body</a-divider>
                <pre class="code-block">{{ bodyText(item.response?.body || item.responseBody) }}</pre>
              </a-space>
            </a-collapse-panel>
          </a-collapse>
        </a-tab-pane>
        <a-tab-pane key="headers" tab="请求 Header">
          <pre class="code-block">{{ prettyJson(request.headers) }}</pre>
        </a-tab-pane>
        <a-tab-pane key="body" tab="请求 Body">
          <pre class="code-block">{{ prettyJson(request.postData) || '无请求体' }}</pre>
        </a-tab-pane>
        <a-tab-pane key="response" tab="响应">
          <a-alert
            v-if="request.failure"
            type="error"
            show-icon
            :message="request.failure.errorText || '请求失败'"
          />
          <a-space v-if="request.response" direction="vertical" class="full-width" :size="12">
            <a-space>
              <a-tag :color="responseStatusColor(request.response.status)">
                {{ request.response.status }} {{ request.response.statusText }}
              </a-tag>
              <a-typography-text type="secondary">{{ request.response.receivedAt }}</a-typography-text>
            </a-space>
            <pre class="code-block">{{ prettyJson(request.response.headers) }}</pre>
            <pre class="code-block">{{ responseBodyText }}</pre>
          </a-space>
          <a-empty v-else :image="Empty.PRESENTED_IMAGE_SIMPLE" description="暂无响应" />
        </a-tab-pane>
      </a-tabs>
    </div>
  </a-drawer>
</template>

<script setup>
import { computed } from 'vue';
import { Empty } from 'ant-design-vue';
import {
  categoryLabel,
  formatSessionTime,
  methodColor,
  prettyJson,
  responseStatusColor,
  statusClass,
  statusLabel,
} from '../../utils/formatters.js';

const props = defineProps({
  open: { type: Boolean, required: true },
  request: { type: Object, default: null },
});

const emit = defineEmits(['close']);

const hasReplayResult = computed(() =>
  Boolean(
    props.request?.replayed
      || props.request?.runStatus
      || props.request?.authSource
      || props.request?.retest
      || props.request?.latestRetestResult
      || props.request?.retestResults
  )
);

const replayResultLabel = computed(() => {
  if (props.request?.runStatus === 'running') {
    return '执行中';
  }
  if (props.request?.ok === true) {
    return '通过';
  }
  if (props.request?.ok === false) {
    return '失败';
  }
  return '待执行';
});

const replayResultColor = computed(() => {
  if (props.request?.runStatus === 'running') {
    return 'processing';
  }
  if (props.request?.ok === true) {
    return 'green';
  }
  if (props.request?.ok === false) {
    return 'red';
  }
  return 'default';
});

const replayStatusCode = computed(() => {
  const status = props.request?.httpStatus ?? props.request?.response?.status ?? props.request?.status;
  return typeof status === 'number' ? status : null;
});

const replayStatusText = computed(() =>
  props.request?.httpStatusText || props.request?.response?.statusText || props.request?.statusText || ''
);

const retestHistory = computed(() =>
  [...(Array.isArray(props.request?.retestResults) ? props.request.retestResults : [])]
    .sort((first, second) => Number(second.attempt || 0) - Number(first.attempt || 0))
);

const bodyText = (body) => {
  if (!body) {
    return '无响应体';
  }
  if (body.text) {
    return prettyJson(body.text);
  }
  return prettyJson(body);
};

const responseBodyText = computed(() => bodyText(props.request?.response?.body || props.request?.responseBody));

const authSourceLabel = (source) => ({
  raw: '原样',
  override: '统一替换',
  'login-request': '登录接口',
  'login-cookie': '登录接口 Cookie',
  retest: '重新测试',
}[source] || source || '-');

const retestHistoryTitle = (item) => {
  const status = item.ok ? '通过' : '失败';
  const statusCode = item.status || 'ERR';
  const time = formatSessionTime(item.retestedAt || item.finishedAt);
  return `第 ${item.attempt} 次 | ${status} | ${statusCode} | ${item.durationMs ?? '-'} ms | ${time}`;
};
</script>
