<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import type { ProgressionAnalytics } from '@gymlytics/shared';
import { api } from '../../../lib/api';
import { describeError, notify } from '../../../lib/toast';
import PageHeader from '../../../components/PageHeader.vue';
import ChartCard from '../../../components/analytics/ChartCard.vue';
import MetricRow from '../../../components/analytics/MetricRow.vue';
import DonutChart from '../../../components/charts/DonutChart.vue';
import BarChart from '../../../components/charts/BarChart.vue';
import EmptyState from '../../../components/EmptyState.vue';

const data = ref<ProgressionAnalytics | null>(null);
const loading = ref(true);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const { data: result } = await api.get<ProgressionAnalytics>('/v1/analytics/progression', {
      query: { limit: 100 },
    });
    data.value = result;
  } catch (error) {
    notify.error(describeError(error));
  } finally {
    loading.value = false;
  }
}
onMounted(load);
</script>

<template>
  <div>
    <PageHeader title="BJJ progression & coaching" subtitle="Rank distribution, time-in-rank and promotion readiness" />
    <div v-if="loading" class="grid gap-4"><div class="skeleton h-32" /><div class="skeleton h-72" /></div>
    <template v-else-if="data">
      <MetricRow :metrics="data.metrics" />

      <div class="mt-5 grid gap-5 lg:grid-cols-3">
        <ChartCard title="Belt distribution" subtitle="Current rank by member"><DonutChart :series="data.beltDistribution" :size="150" /></ChartCard>
        <ChartCard title="Stripe distribution" subtitle="Stripes in current rank"><DonutChart :series="data.stripeDistribution" :size="150" /></ChartCard>
        <ChartCard title="Age groups" subtitle="Kids vs adults"><DonutChart :series="data.ageGroups" :size="150" /></ChartCard>
      </div>

      <div class="mt-5 grid gap-5 lg:grid-cols-2">
        <ChartCard title="Promotions over time" subtitle="Promotions recorded per month">
          <BarChart :series="data.promotionTimeline" color="#7c3aed" />
        </ChartCard>
        <ChartCard title="Programme breakdown" subtitle="Students, mat hours and readiness by programme">
          <table class="w-full text-sm">
            <thead><tr class="border-b border-ink-200 text-left text-xs uppercase text-ink-500"><th class="py-2">Programme</th><th class="py-2 text-right">Students</th><th class="py-2 text-right">Avg hours</th><th class="py-2 text-right">Ready</th></tr></thead>
            <tbody>
              <tr v-for="program in data.programBreakdown" :key="program.programId" class="border-b border-ink-100">
                <td class="py-2 text-ink-800">{{ program.programName }}</td>
                <td class="py-2 text-right tabular">{{ program.students }}</td>
                <td class="py-2 text-right tabular">{{ program.avgMatHours }}</td>
                <td class="py-2 text-right tabular font-semibold text-mat-700">{{ program.eligible }}</td>
              </tr>
            </tbody>
          </table>
        </ChartCard>
      </div>

      <div class="mt-5">
        <h2 class="mb-3 font-display text-lg font-bold text-ink-900">Promotion ready roster</h2>
        <EmptyState v-if="!data.readiness.length" title="Nobody is promotion-ready yet" body="Students appear here once they meet the mat-hour, class-count and time-in-rank requirements." />
        <div v-else class="card overflow-x-auto">
          <table class="w-full min-w-[820px]">
            <thead><tr><th class="th">Member</th><th class="th">Programme</th><th class="th">Current rank</th><th class="th">Next</th><th class="th text-right">Mat hrs</th><th class="th text-right">Classes</th><th class="th text-right">Months</th><th class="th">Status</th></tr></thead>
            <tbody>
              <tr v-for="(row, index) in data.readiness" :key="`${row.userId}-${row.programId}-${index}`" class="row-hover">
                <td class="td"><RouterLink :to="`/admin/analytics/member/${row.userId}`" class="font-medium text-mat-700 hover:underline">{{ row.memberName }}</RouterLink></td>
                <td class="td">{{ row.programName }}</td>
                <td class="td">{{ row.currentRankName }} · {{ row.currentStripes }} stripe{{ row.currentStripes === 1 ? '' : 's' }}</td>
                <td class="td">{{ row.nextRankName ?? '—' }}</td>
                <td class="td text-right tabular">{{ row.matHoursSincePromotion }}</td>
                <td class="td text-right tabular">{{ row.classesSincePromotion }}</td>
                <td class="td text-right tabular">{{ row.monthsInRank }}</td>
                <td class="td"><span class="chip" :class="row.eligible ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'">{{ row.eligible ? 'Belt ready' : 'Stripe ready' }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>
