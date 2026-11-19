<script setup lang="ts">
withDefaults(defineProps<{ open: boolean; title: string; description?: string; width?: string }>(), {
  width: 'max-w-lg',
  description: undefined,
});
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-150"
      enter-from-class="opacity-0"
      leave-active-class="transition duration-100"
      leave-to-class="opacity-0"
    >
      <div v-if="open" class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
        <div class="fixed inset-0 bg-ink-900/40 backdrop-blur-[2px]" @click="emit('close')" />
        <div
          class="relative z-10 w-full rounded-2xl bg-white shadow-pop"
          :class="width"
          role="dialog"
          aria-modal="true"
        >
          <header class="flex items-start justify-between gap-4 border-b border-ink-100 px-6 py-5">
            <div>
              <h2 class="font-display text-lg font-bold text-ink-900">{{ title }}</h2>
              <p v-if="description" class="mt-1 text-sm text-ink-500">{{ description }}</p>
            </div>
            <button
              class="rounded-lg p-1.5 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
              aria-label="Close"
              @click="emit('close')"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M6 6l12 12M18 6L6 18" stroke-linecap="round" />
              </svg>
            </button>
          </header>
          <div class="px-6 py-5">
            <slot />
          </div>
          <footer v-if="$slots.footer" class="flex justify-end gap-2 border-t border-ink-100 px-6 py-4">
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
