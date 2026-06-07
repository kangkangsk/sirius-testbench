<template>
  <a-layout-sider
    :width="208"
    :collapsed-width="64"
    :collapsed="collapsed"
    collapsible
    :class="`app-sider ${collapsed ? 'is-collapsed' : 'is-expanded'}`"
    @collapse="(value) => emit('collapse', value)"
  >
    <div class="sider-menu-wrap">
      <a-menu
        mode="inline"
        :inline-collapsed="collapsed"
        :selected-keys="systemSelectedKeys"
        :items="systemItems"
        class="app-menu system-menu"
        @click="({ key }) => emit('menuClick', key)"
      />
      <a-divider class="sider-menu-divider" />
      <a-menu
        mode="inline"
        :inline-collapsed="collapsed"
        :selected-keys="businessSelectedKeys"
        :items="businessItems"
        class="app-menu business-menu"
        @click="({ key }) => emit('menuClick', key)"
      />
    </div>
  </a-layout-sider>
</template>

<script setup>
import { computed, h } from 'vue';

const props = defineProps({
  collapsed: { type: Boolean, required: true },
  activeKey: { type: String, required: true },
  systemMenuItems: { type: Array, required: true },
  businessMenuItems: { type: Array, required: true },
});

const emit = defineEmits(['collapse', 'menuClick']);

const normalizeItems = (items) =>
  items.map((item) => ({
    ...item,
    icon: item.icon ? () => h(item.icon) : undefined,
  }));

const systemItems = computed(() => normalizeItems(props.systemMenuItems));
const businessItems = computed(() => normalizeItems(props.businessMenuItems));
const systemSelectedKeys = computed(() =>
  props.systemMenuItems.some((item) => item.key === props.activeKey) ? [props.activeKey] : []
);
const businessSelectedKeys = computed(() =>
  props.businessMenuItems.some((item) => item.key === props.activeKey) ? [props.activeKey] : []
);
</script>
