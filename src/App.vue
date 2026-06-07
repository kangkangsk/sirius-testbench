<template>
  <a-config-provider :locale="zhCN" :theme="themeConfig">
    <a-layout class="app-shell">
      <AppHeader
        project-name="Sirius自动化测试工作台"
        :active-label="activeLabel"
        :role="role"
        :on-role-change="setRole"
        :role-options="roleOptions"
      />
      <a-layout class="body-shell">
        <AppSidebar
          :collapsed="collapsed"
          :active-key="activeKey"
          :system-menu-items="systemMenuItems"
          :business-menu-items="businessMenuItems"
          @collapse="setCollapsed"
          @menu-click="switchPage"
        />
        <a-layout class="main-shell">
          <AppTabStrip
            :active-key="activeKey"
            :tabs="openedTabs"
            :on-home-click="() => switchPage(defaultKey)"
            :on-tab-click="switchPage"
            :on-tab-close="closeTab"
          />
          <a-layout-content class="app-content">
            <WorkspacePage v-if="activeKey === 'workspace'" />
            <CaptureSessionPage v-else-if="activeKey === 'capture'" />
            <RequestReviewPage v-else-if="activeKey === 'review'" />
            <AuthOverridePage v-else-if="activeKey === 'auth'" />
            <ReplayTestPage v-else-if="activeKey === 'replay'" />
            <PressureTestPage v-else-if="activeKey === 'pressure'" />
            <ScriptExportPage v-else />
          </a-layout-content>
        </a-layout>
      </a-layout>
    </a-layout>
  </a-config-provider>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import zhCN from 'ant-design-vue/es/locale/zh_CN';
import AppHeader from './components/layout/AppHeader.vue';
import AppSidebar from './components/layout/AppSidebar.vue';
import AppTabStrip from './components/layout/AppTabStrip.vue';
import WorkspacePage from './components/pages/WorkspacePage.vue';
import CaptureSessionPage from './components/pages/CaptureSessionPage.vue';
import RequestReviewPage from './components/pages/RequestReviewPage.vue';
import AuthOverridePage from './components/pages/AuthOverridePage.vue';
import ReplayTestPage from './components/pages/ReplayTestPage.vue';
import PressureTestPage from './components/pages/PressureTestPage.vue';
import ScriptExportPage from './components/pages/ScriptExportPage.vue';
import {
  businessMenuItems,
  defaultPageKey,
  pageLabels,
  roleOptions,
  systemMenuItems,
  validPageKeys,
} from './constants/appShell.js';
import { readHashKey } from './utils/navigation.js';

const pageKeys = computed(() => validPageKeys());
const defaultKey = defaultPageKey();
const collapsed = ref(false);
const role = ref(roleOptions[0]?.value || 'local');
const activeKey = ref(defaultKey);
const openedTabKeys = ref([]);

const themeConfig = {
  token: {
    borderRadius: 6,
    colorPrimary: '#1769aa',
    colorSuccess: '#2e7d32',
    colorWarning: '#b7791f',
    colorError: '#b42318',
    fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
  },
};

const activeLabel = computed(() => pageLabels[activeKey.value] || '工作空间');
const openedTabs = computed(() =>
  openedTabKeys.value.map((key) => ({
    key,
    label: pageLabels[key] || key,
  }))
);

const openTab = (key) => {
  if (key === defaultKey || openedTabKeys.value.includes(key)) {
    return;
  }
  openedTabKeys.value = [...openedTabKeys.value, key];
};

const syncHash = () => {
  const nextKey = readHashKey(pageKeys.value, defaultKey);
  activeKey.value = nextKey;
  openTab(nextKey);
};

const switchPage = (key) => {
  const nextKey = pageKeys.value.includes(key) ? key : defaultKey;
  activeKey.value = nextKey;
  openTab(nextKey);
  if (window.location.hash !== `#${nextKey}`) {
    window.location.hash = nextKey;
  }
};

const closeTab = (key) => {
  openedTabKeys.value = openedTabKeys.value.filter((item) => item !== key);
  if (activeKey.value !== key) {
    return;
  }
  const nextKey = openedTabKeys.value[openedTabKeys.value.length - 1] || defaultKey;
  switchPage(nextKey);
};

const setCollapsed = (value) => {
  collapsed.value = value;
};

const setRole = (value) => {
  role.value = value;
};

onMounted(() => {
  window.addEventListener('hashchange', syncHash);
  syncHash();
});

onBeforeUnmount(() => {
  window.removeEventListener('hashchange', syncHash);
});
</script>
