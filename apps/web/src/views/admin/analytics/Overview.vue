<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import type { AnalyticsOverview } from '@gymlytics/shared';
import { api } from '../../../lib/api';
import { describeError, notify } from '../../../lib/toast';
import PageHeader from '../../../components/PageHeader.vue';
import ChartCard from '../../../components/analytics/ChartCard.vue';
import MetricRow from '../../../components/analytics/MetricRow.vue';
import RangePicker from '../../../components/analytics/RangePicker.vue';
import LineChart from '../../../components/charts/LineChart.vue';
import BarChart from '../../../components/charts/BarChart.vue';
import DonutChart from '../../../components/charts/DonutChart.vue';

const days = ref(90);
const data = ref<AnalyticsOverview | null>(null);
const loading = ref(true);

const sections = [
  { to: '/admin/analytics/progression', label: 'BJJ progression', detail: 'Belts, stripes and promotion readiness' },
  { to: '/admin/analytics/attendance', label: 'Attendance & coaching', detail: 'Class demand, no-shows and coach impact' },
  { to: '/admin/analytics/retention', label: 'Retention & churn', detail: 'Cohorts, lifespan and at-risk members' },
  { to: '/admin/analytics/financial', label: 'Financial & revenue', detail: 'MRR, ARPU, LTV and cash flow' },
  { to: '/admin/analytics/leads', label: 'Leads & marketing', detail: 'Trials, conversion and source attribution' },
];

async function load(): Promise<void> {
  loading.value = true;
  try {
    const from = new Date(Date.now() - days.value * 86_400_000).toISOString();
    const { data: result } = await api.get<AnalyticsOverview>('/v1/analytics/overview', {
      query: { from },
    });
    data.value = result;
  } catch (error) {
    notify.error(describeError(error));
  } finally {
    loading.value = false;
  }
}
watch(days, load);
onMounted(load);
</script>

<template>
  <div>
    <PageHeader title="Analytics overview" subtitle="A single view of the academy across the last few months">
      <template #actions><RangePicker :days="days" @change="(value: number) => (days = value)" /></template>
    </PageHeader>

    <div v-if="loading" class="space-y-4">
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><div v-for="n in 4" :key="n" class="skeleton h-28" /></div>
      <div class="grid gap-4 lg:grid-cols-2"><div v-for="n in 4" :key="n" class="skeleton h-64" /></div>
    </div>
    <template v-else-if="data">
      <MetricRow :metrics="data.metrics" />

      <div class="mt-5 grid gap-5 lg:grid-cols-2">
        <ChartCard title="Revenue" subtitle="Succeeded payments per month">
          <LineChart :series="data.revenueSeries" color="#0d9488" suffix=" cents" />
        </ChartCard>
        <ChartCard title="Check-ins" subtitle="Mat attendance per month">
          <BarChart :series="data.attendanceSeries" color="#4f46e5" />
        </ChartCard>
        <ChartCard title="Revenue mix" subtitle="By transaction type">
          <DonutChart :series="data.revenueMix" />
        </ChartCard>
        <ChartCard title="Program popularity" subtitle="Check-ins by programme">
          <BarChart :series="data.programPopularity" color="#f59e0b" />
        </ChartCard>
      </div>

      <div class="mt-6">
        <h2 class="font-display text-lg font-bold text-ink-900">Explore in depth</h2>
        <div class="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <RouterLink
            v-for="section in sections"
            :key="section.to"
            :to="section.to"
            class="card-pad group transition hover:-translate-y-0.5 hover:shadow-pop"
          >
            <p class="font-semibold text-ink-900 group-hover:text-mat-700">{{ section.label }}</p>
            <p class="mt-1 text-xs text-ink-500">{{ section.detail }}</p>
          </RouterLink>
        </div>
      </div>
    </template>
  </div>
</template>
