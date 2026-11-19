<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import type { ReportDefinition } from '@gymlytics/shared';
import { api } from '../../../lib/api';
import { describeError, notify } from '../../../lib/toast';
import PageHeader from '../../../components/PageHeader.vue';

const definitions = ref<ReportDefinition[]>([]);
const loading = ref(true);
const groupOrder = ['Operations', 'Members', 'Finance', 'Compliance'];

const grouped = computed(() =>
  groupOrder
    .map((group) => ({ group, items: definitions.value.filter((definition) => definition.group === group) }))
    .filter((entry) => entry.items.length),
);

const GROUP_HINT: Record<string, string> = {
  Operations: 'Mat-side, timetable and payroll',
  Members: 'Lifecycle, retention and follow-up',
  Finance: 'Revenue, receivables and stock',
  Compliance: 'Waivers, contracts and safety',
};

onMounted(async () => {
  try {
    const { data } = await api.get<ReportDefinition[]>('/v1/reports');
    definitions.value = data;
  } catch (error) {
    notify.error(describeError(error));
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div>
    <PageHeader title="Report centre" subtitle="Operational, lifecycle, financial and compliance reports — always live from academy data" />
    <div v-if="loading" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"><div v-for="n in 6" :key="n" class="skeleton h-40" /></div>
    <template v-else>
      <section v-for="section in grouped" :key="section.group" class="mt-7">
        <h2 class="font-display text-lg font-bold text-ink-900">{{ section.group }}</h2>
        <p class="mt-0.5 text-xs text-ink-500">{{ GROUP_HINT[section.group] }}</p>
        <div class="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <RouterLink
            v-for="report in section.items"
            :key="report.slug"
            :to="`/admin/reports/${report.slug}`"
            class="card-pad group transition hover:-translate-y-0.5 hover:shadow-pop"
          >
            <div class="flex items-start justify-between gap-3">
              <p class="font-semibold text-ink-900 group-hover:text-mat-700">{{ report.title }}</p>
              <span class="chip shrink-0 bg-mat-50 text-mat-700">{{ report.cadence }}</span>
            </div>
            <p class="mt-2 text-xs leading-relaxed text-ink-500">{{ report.description }}</p>
            <p class="mt-3 text-[11px] font-medium text-mat-700">Open report →</p>
          </RouterLink>
        </div>
      </section>
    </template>
  </div>
</template>
