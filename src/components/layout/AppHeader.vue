<template>
  <header class="app-header">
    <div class="brand-block">
      <img class="sirius-logo" :src="siriusLogoUrl" alt="Sirius" />
      <div>
        <a-typography-title :level="3" class="system-title">{{ projectName }}</a-typography-title>
        <a-typography-text type="secondary" class="system-subtitle">{{ activeLabel }}</a-typography-text>
      </div>
    </div>
    <a-space class="header-actions" :size="16">
      <a-button type="text" shape="circle" aria-label="搜索">
        <template #icon><SearchOutlined /></template>
      </a-button>
      <a-button type="text" shape="circle" aria-label="提醒">
        <template #icon><BellOutlined /></template>
      </a-button>
      <a-button type="text" shape="circle" aria-label="设置">
        <template #icon><SettingOutlined /></template>
      </a-button>
      <div class="user-block">
        <a-avatar :size="36"><template #icon><UserOutlined /></template></a-avatar>
        <a-select
          :value="role"
          :options="roleOptions"
          variant="borderless"
          class="role-select"
          @update:value="onRoleChange"
        />
      </div>
    </a-space>
  </header>
</template>

<script setup>
import {
  BellOutlined,
  SearchOutlined,
  SettingOutlined,
  UserOutlined,
} from '@ant-design/icons-vue';
import siriusLogoUrl from '../../../docs/assets/sirius-logo.png?url';

defineProps({
  projectName: { type: String, required: true },
  activeLabel: { type: String, required: true },
  role: { type: String, required: true },
  onRoleChange: { type: Function, required: true },
  roleOptions: { type: Array, required: true },
});
</script>
