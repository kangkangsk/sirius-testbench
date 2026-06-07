<template>
  <div :class="`section-head ${compact ? 'compact' : ''}`">
    <div>
      <a-typography-title :level="4">{{ title }}</a-typography-title>
      <a-typography-text v-if="description" type="secondary">{{ description }}</a-typography-text>
    </div>
    <a-space v-if="$slots.extra" wrap>
      <slot name="extra" />
    </a-space>
  </div>
</template>

<script setup>
defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  compact: { type: Boolean, default: false },
});
</script>
