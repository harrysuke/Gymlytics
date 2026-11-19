<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{ days: number }>(), { days: 90 });
const emit = defineEmits<{ change: [days: number] }>();

const options = [
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
  { value: 180, label: 'Last 6 months' },
  { value: 365, label: 'Last 12 months' },
];
const selected = computed({
  get: () => props.days,
  set: (value: number) => emit('change', value),
});
</script>

<template>
  <label class="flex items-center gap-2 text-xs font-medium text-ink-600">
    <span class="hidden sm:inline">Period</span>
    <select v-model.number="selected" class="input py-1.5 text-xs">
      <option v-for="option in options" :key="option.value" :value="option.value">
        {{ option.label }}
      </option>
    </select>
  </label>
</template>
