<script setup lang="ts">
withDefaults(defineProps<{ title: string; body?: string; icon?: string }>(), {
  body: undefined,
  icon: '🥋',
});
</script>

<template>
  <div class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-ink-300 bg-white/60 px-6 py-14 text-center">
    <span class="text-3xl">{{ icon }}</span>
    <p class="mt-3 font-semibold text-ink-800">{{ title }}</p>
    <p v-if="body" class="mt-1 max-w-sm text-sm text-ink-500">{{ body }}</p>
    <div class="mt-4"><slot /></div>
  </div>
</template>
