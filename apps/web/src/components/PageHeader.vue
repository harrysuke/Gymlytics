<script setup lang="ts">
defineProps<{ title: string; subtitle?: string; actionLabel?: string; actionDisabled?: boolean }>();
const emit = defineEmits<{ action: [] }>();
</script>

<template>
  <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
    <div>
      <h1 class="font-display text-2xl font-bold tracking-tight text-ink-900">{{ title }}</h1>
      <p v-if="subtitle" class="mt-1 text-sm text-ink-500">{{ subtitle }}</p>
    </div>
    <div class="flex items-center gap-2">
      <slot name="actions" />
      <button
        v-if="actionLabel"
        class="btn-primary"
        :disabled="actionDisabled"
        @click="emit('action')"
      >
        {{ actionLabel }}
      </button>
    </div>
  </div>
</template>
