<template>
  <div class="tab-strip">
    <a-button :class="['home-tab', { 'is-active': activeKey === 'workspace' }]" type="text" @click="onHomeClick">
      <template #icon><HomeOutlined /></template>
      首页
    </a-button>
    <button
      v-for="tab in tabs"
      :key="tab.key"
      type="button"
      :class="['active-tab', { 'is-active': activeKey === tab.key }]"
      @click="onTabClick(tab.key)"
    >
      {{ tab.label }}
      <CloseOutlined class="tab-close-icon" @click.stop="onTabClose(tab.key)" />
    </button>
  </div>
</template>

<script setup>
import { CloseOutlined, HomeOutlined } from '@ant-design/icons-vue';

defineProps({
  activeKey: { type: String, required: true },
  tabs: { type: Array, required: true },
  onHomeClick: { type: Function, required: true },
  onTabClick: { type: Function, required: true },
  onTabClose: { type: Function, required: true },
});
</script>
