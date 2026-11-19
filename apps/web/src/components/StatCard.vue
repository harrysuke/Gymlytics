<script setup lang="ts">
defineProps<{
  label: string;
  value: string | number;
  hint?: string;
  trend?: string;
  icon?: string;
  tone?: 'default' | 'warn' | 'good';
}>();
</script>

<template>
  <div class="card-pad">
    <div class="flex items-start justify-between">
      <p class="text-xs font-semibold uppercase tracking-wide text-ink-500">{{ label }}</p>
      <span v-if="icon" class="text-lg leading-none opacity-60">{{ icon }}</span>
    </div>
    <p
      class="mt-3 font-display text-3xl font-bold tabular tracking-tight"
      :class="tone === 'warn' ? 'text-amber-600' : tone === 'good' ? 'text-emerald-600' : 'text-ink-900'"
    >
      {{ value }}
    </p>
    <p v-if="hint || trend" class="mt-1 text-xs text-ink-500">{{ trend ?? hint }}</p>
  </div>
</template>
