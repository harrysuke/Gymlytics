<script setup lang="ts">
defineProps<{ title: string; subtitle?: string }>();
</script>

<template>
  <section class="card-pad">
    <h2 class="font-display text-sm font-bold text-ink-900">{{ title }}</h2>
    <p v-if="subtitle" class="mb-3 mt-0.5 text-xs text-ink-500">{{ subtitle }}</p>
    <div :class="subtitle ? 'mt-4' : 'mt-3'"><slot /></div>
  </section>
</template>
