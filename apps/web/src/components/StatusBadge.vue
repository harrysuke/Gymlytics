<script setup lang="ts">
import { STATUS_TONES } from '../lib/format';

const props = withDefaults(defineProps<{ value: string | null | undefined; tone?: string }>(), {
  tone: undefined,
});

const TONES: Record<string, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/15',
  amber: 'bg-amber-50 text-amber-700 ring-1 ring-amber-600/15',
  rose: 'bg-rose-50 text-rose-700 ring-1 ring-rose-600/15',
  sky: 'bg-sky-50 text-sky-700 ring-1 ring-sky-600/15',
  slate: 'bg-ink-100 text-ink-600 ring-1 ring-ink-300/50',
  violet: 'bg-mat-50 text-mat-700 ring-1 ring-mat-600/15',
};

function label(value: string | null | undefined): string {
  if (!value) return '—';
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
</script>

<template>
  <span class="chip" :class="TONES[props.tone ?? STATUS_TONES[props.value ?? ''] ?? 'slate']">
    {{ label(props.value) }}
  </span>
</template>
