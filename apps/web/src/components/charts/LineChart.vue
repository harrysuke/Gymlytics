<script setup lang="ts">
import { computed } from 'vue';
import type { SeriesPoint } from '@gymlytics/shared';

const props = withDefaults(
  defineProps<{ series: SeriesPoint[]; color?: string; height?: number; suffix?: string }>(),
  { color: '#0d9488', height: 180, suffix: '' },
);

const width = 640;
const plotHeight = computed(() => Math.max(40, props.height - 36));
const max = computed(() => Math.max(1, ...props.series.map((point) => point.value)));
const min = computed(() => Math.min(0, ...props.series.map((point) => point.value)));
const span = computed(() => Math.max(1, max.value - min.value));
const points = computed(() =>
  props.series.map((point, index) => ({
    ...point,
    x: props.series.length > 1 ? 12 + (index * (width - 24)) / (props.series.length - 1) : width / 2,
    y: 8 + plotHeight.value - ((point.value - min.value) / span.value) * plotHeight.value,
  })),
);
const line = computed(() => points.value.map((point) => `${point.x},${point.y}`).join(' '));
const area = computed(() => {
  if (!points.value.length) return '';
  const first = points.value[0]!;
  const last = points.value[points.value.length - 1]!;
  return `M ${first.x} ${8 + plotHeight.value} L ${points.value.map((p) => `${p.x} ${p.y}`).join(' L ')} L ${last.x} ${8 + plotHeight.value} Z`;
});
</script>

<template>
  <div v-if="series.length" class="w-full overflow-hidden">
    <svg :viewBox="`0 0 ${width} ${height}`" class="w-full" role="img" aria-label="Trend chart">
      <line
        v-for="lineIndex in 4"
        :key="lineIndex"
        x1="12"
        :x2="width - 12"
        :y1="8 + ((lineIndex - 1) * plotHeight) / 3"
        :y2="8 + ((lineIndex - 1) * plotHeight) / 3"
        stroke="#e2e8f0"
        stroke-width="1"
      />
      <path :d="area" :fill="color" opacity="0.12" />
      <polyline :points="line" fill="none" :stroke="color" stroke-width="2.5" stroke-linejoin="round" />
      <g v-for="(point, index) in points" :key="`${point.label}-${index}`">
        <circle :cx="point.x" :cy="point.y" r="3" :fill="color">
          <title>{{ point.label }}: {{ point.value }}{{ suffix }}</title>
        </circle>
        <text
          v-if="index === 0 || index === points.length - 1 || index === Math.floor(points.length / 2)"
          :x="point.x"
          :y="height - 4"
          text-anchor="middle"
          class="fill-ink-500"
          font-size="10"
        >
          {{ point.label }}
        </text>
      </g>
    </svg>
  </div>
  <p v-else class="py-8 text-center text-sm text-ink-400">No data in this range</p>
</template>
