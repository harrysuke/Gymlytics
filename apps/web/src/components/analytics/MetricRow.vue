<script setup lang="ts">
import type { Metric } from '@gymlytics/shared';
import StatCard from '../StatCard.vue';

defineProps<{ metrics: Metric[] }>();
</script>

<template>
  <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
    <StatCard
      v-for="metric in metrics"
      :key="metric.label"
      :label="metric.label"
      :value="metric.value"
      :hint="metric.hint"
      :tone="metric.tone ?? 'default'"
    />
  </div>
</template>
