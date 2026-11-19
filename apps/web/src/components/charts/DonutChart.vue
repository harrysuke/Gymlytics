<script setup lang="ts">
import { computed } from 'vue';
import type { NamedValue } from '@gymlytics/shared';

const props = withDefaults(defineProps<{ series: NamedValue[]; size?: number }>(), { size: 168 });
const palette = ['#4f46e5', '#0d9488', '#f59e0b', '#e11d48', '#7c3aed', '#0284c7', '#65a30d', '#94a3b8'];
const total = computed(() => props.series.reduce((sum, item) => sum + item.value, 0));
const segments = computed(() => {
  const circumference = 2 * Math.PI * 54;
  let offset = 0;
  return props.series.map((item, index) => {
    const fraction = total.value ? item.value / total.value : 0;
    const length = fraction * circumference;
    const segment = {
      ...item,
      color: palette[index % palette.length]!,
      dasharray: `${length} ${circumference - length}`,
      dashoffset: -offset,
      percent: Math.round(fraction * 1000) / 10,
    };
    offset += length;
    return segment;
  });
});
</script>

<template>
  <div v-if="series.length" class="flex flex-wrap items-center gap-6">
    <svg :width="size" :height="size" viewBox="0 0 140 140" role="img" aria-label="Distribution donut chart">
      <circle cx="70" cy="70" r="54" fill="none" stroke="#e2e8f0" stroke-width="18" />
      <circle
        v-for="(segment, index) in segments"
        :key="`${segment.label}-${index}`"
        cx="70"
        cy="70"
        r="54"
        fill="none"
        :stroke="segment.color"
        stroke-width="18"
        :stroke-dasharray="segment.dasharray"
        :stroke-dashoffset="segment.dashoffset"
        transform="rotate(-90 70 70)"
      >
        <title>{{ segment.label }}: {{ segment.value }} ({{ segment.percent }}%)</title>
      </circle>
      <text x="70" y="67" text-anchor="middle" class="fill-ink-900" font-size="20" font-weight="700">
        {{ total }}
      </text>
      <text x="70" y="84" text-anchor="middle" class="fill-ink-500" font-size="10">total</text>
    </svg>
    <ul class="min-w-[160px] flex-1 space-y-2">
      <li v-for="(segment, index) in segments" :key="`${segment.label}-legend-${index}`" class="flex items-center gap-2 text-sm">
        <span class="h-2.5 w-2.5 shrink-0 rounded-sm" :style="{ backgroundColor: segment.color }" />
        <span class="min-w-0 flex-1 truncate text-ink-600">{{ segment.label }}</span>
        <span class="font-semibold tabular text-ink-900">{{ segment.percent }}%</span>
      </li>
    </ul>
  </div>
  <p v-else class="py-8 text-center text-sm text-ink-400">No data in this range</p>
</template>
