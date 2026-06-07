<template>
  <button v-if="onClick" type="button" class="metric-card" @click="onClick">
    <span class="metric-card__art">
      <span class="metric-card__icon"><component :is="icon" /></span>
    </span>
    <span class="metric-card__content">
      <span class="metric-card__label">{{ title }}</span>
      <strong class="metric-card__value">{{ value }}{{ suffix }}</strong>
    </span>
  </button>
  <div v-else class="metric-card">
    <span class="metric-card__art">
      <span class="metric-card__icon"><component :is="icon" /></span>
    </span>
    <span class="metric-card__content">
      <span class="metric-card__label">{{ title }}</span>
      <strong class="metric-card__value">{{ value }}{{ suffix }}</strong>
    </span>
  </div>
</template>

<script setup>
defineProps({
  title: { type: String, required: true },
  value: { type: [String, Number], required: true },
  suffix: { type: String, default: '' },
  icon: { type: [Object, Function], required: true },
  onClick: { type: Function, default: null },
});
</script>
