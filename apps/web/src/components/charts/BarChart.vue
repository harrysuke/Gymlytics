<script setup lang="ts">
import { computed } from 'vue';
import type { SeriesPoint } from '@gymlytics/shared';

const props = withDefaults(
  defineProps<{
    series: SeriesPoint[];
    color?: string;
    height?: number;
    suffix?: string;
  }>(),
  { color: '#4f46e5', height: 180, suffix: '' },
);

const width = 640;
const chartHeight = computed(() => props.height);
const plotHeight = computed(() => Math.max(40, props.height - 34));
const max = computed(() => Math.max(1, ...props.series.map((point) => point.value)));
const barWidth = computed(() =>
  props.series.length ? Math.max(4, Math.min(46, (width - 24) / props.series.length - 6)) : 0,
);
const step = computed(() => (props.series.length ? (width - 24) / props.series.length : 0));

function barHeight(value: number): number {
  return Math.max(2, (value / max.value) * plotHeight.value);
}
function x(index: number): number {
  return 12 + index * step.value + (step.value - barWidth.value) / 2;
}
function label(index: number): string {
  const point = props.series[index];
  if (!point) return '';
  return point.label.length > 8 ? `${point.label.slice(0, 7)}…` : point.label;
}
</script>

<template>
  <div v-if="series.length" class="w-full overflow-hidden">
    <svg :viewBox="`0 0 ${width} ${chartHeight}`" class="w-full" role="img" aria-label="Bar chart">
      <line
        v-for="line in 4"
        :key="line"
        x1="12"
        :x2="width - 12"
        :y1="8 + ((line - 1) * plotHeight) / 3"
        :y2="8 + ((line - 1) * plotHeight) / 3"
        stroke="#e2e8f0"
        stroke-width="1"
      />
      <g v-for="(point, index) in series" :key="`${point.label}-${index}`">
        <rect
          :x="x(index)"
          :y="8 + plotHeight - barHeight(point.value)"
          :width="barWidth"
          :height="barHeight(point.value)"
          :fill="color"
          rx="3"
          opacity="0.85"
        >
          <title>{{ point.label }}: {{ point.value }}{{ suffix }}</title>
        </rect>
        <text
          :x="x(index) + barWidth / 2"
          :y="chartHeight - 4"
          text-anchor="middle"
          class="fill-ink-500"
          font-size="10"
        >
          {{ label(index) }}
        </text>
      </g>
    </svg>
  </div>
  <p v-else class="py-8 text-center text-sm text-ink-400">No data in this range</p>
</template>
