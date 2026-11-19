<script setup lang="ts">
import { dismissToast, toasts } from '../lib/toast';

const TONES = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  error: 'border-rose-200 bg-rose-50 text-rose-800',
  info: 'border-ink-200 bg-white text-ink-800',
} as const;
</script>

<template>
  <div class="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6">
    <TransitionGroup
      enter-active-class="transition duration-200"
      enter-from-class="translate-y-3 opacity-0"
      leave-active-class="transition duration-150"
      leave-to-class="translate-y-2 opacity-0"
    >
      <button
        v-for="toast in toasts"
        :key="toast.id"
        class="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border px-4 py-3 text-left text-sm shadow-pop"
        :class="TONES[toast.tone]"
        @click="dismissToast(toast.id)"
      >
        <span class="mt-0.5 text-base leading-none">
          {{ toast.tone === 'success' ? '✓' : toast.tone === 'error' ? '!' : 'i' }}
        </span>
        <span class="flex-1">{{ toast.message }}</span>
      </button>
    </TransitionGroup>
  </div>
</template>
