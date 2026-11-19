<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import type { RetentionAnalytics } from '@gymlytics/shared';
import { api } from '../../../lib/api';
import { describeError, notify } from '../../../lib/toast';
import PageHeader from '../../../components/PageHeader.vue';
import ChartCard from '../../../components/analytics/ChartCard.vue';
import MetricRow from '../../../components/analytics/MetricRow.vue';
import BarChart from '../../../components/charts/BarChart.vue';
import EmptyState from '../../../components/EmptyState.vue';
import { date } from '../../../lib/format';

const data = ref<RetentionAnalytics | null>(null);
const loading = ref(true);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const { data: result } = await api.get<RetentionAnalytics>('/v1/analytics/retention', { query: { limit: 100 } });
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
    <PageHeader title="Retention & churn" subtitle="Cohorts, member lifespan, drop-off points and at-risk alerts" />
    <div v-if="loading" class="grid gap-4"><div class="skeleton h-28" /><div class="skeleton h-72" /></div>
    <template v-else-if="data">
      <MetricRow :metrics="data.metrics" />

      <div class="mt-5 grid gap-5 lg:grid-cols-2">
        <ChartCard title="Monthly churn" subtitle="Cancellations as a share of the active base">
          <BarChart :series="data.monthlyChurn.map((row) => ({ label: row.month.slice(2), value: row.churnRate }))" color="#e11d48" suffix="%" />
        </ChartCard>
        <ChartCard title="Drop-off points" subtitle="Cancellation reasons and tenure at exit">
          <BarChart :series="data.dropOffPoints" color="#f59e0b" />
        </ChartCard>
      </div>

      <div class="mt-5 grid gap-5 lg:grid-cols-2">
        <ChartCard title="Tenure & churn" subtitle="Active versus cancelled memberships by lifespan">
          <table class="w-full text-sm">
            <thead><tr class="border-b border-ink-200 text-left text-xs uppercase text-ink-500"><th class="py-2">Tenure</th><th class="py-2 text-right">Active</th><th class="py-2 text-right">Churned</th><th class="py-2 text-right">Rate</th></tr></thead>
            <tbody>
              <tr v-for="bucket in data.tenureBuckets" :key="bucket.label" class="border-b border-ink-100">
                <td class="py-2 text-ink-800">{{ bucket.label }}</td>
                <td class="py-2 text-right tabular">{{ bucket.active }}</td>
                <td class="py-2 text-right tabular">{{ bucket.churned }}</td>
                <td class="py-2 text-right tabular font-semibold" :class="bucket.churnRate > 20 ? 'text-amber-600' : 'text-ink-800'">{{ bucket.churnRate }}%</td>
              </tr>
            </tbody>
          </table>
        </ChartCard>
        <ChartCard title="Signup cohort retention" subtitle="Share of each cohort still attending in later months">
          <table class="w-full text-sm">
            <thead><tr class="border-b border-ink-200 text-left text-xs uppercase text-ink-500"><th class="py-2">Cohort</th><th class="py-2 text-right">Size</th><th class="py-2 text-right">M1</th><th class="py-2 text-right">M2</th><th class="py-2 text-right">M3</th></tr></thead>
            <tbody>
              <tr v-for="cohort in data.cohorts" :key="cohort.cohort" class="border-b border-ink-100">
                <td class="py-2 font-medium text-ink-800">{{ cohort.cohort }}</td>
                <td class="py-2 text-right tabular">{{ cohort.size }}</td>
                <td class="py-2 text-right tabular">{{ cohort.month1 }}%</td>
                <td class="py-2 text-right tabular">{{ cohort.month2 }}%</td>
                <td class="py-2 text-right tabular">{{ cohort.month3 }}%</td>
              </tr>
            </tbody>
          </table>
        </ChartCard>
      </div>

      <div class="mt-6">
        <h2 class="mb-3 font-display text-lg font-bold text-ink-900">At-risk members</h2>
        <EmptyState v-if="!data.atRisk.length" title="Everyone is checking in" body="Members with a seven-day or longer gap appear here automatically." />
        <div v-else class="card overflow-x-auto">
          <table class="w-full min-w-[700px]">
            <thead><tr><th class="th">Member</th><th class="th">Last check-in</th><th class="th text-right">Days</th><th class="th text-right">Tenure</th><th class="th">Membership</th><th class="th">Risk</th></tr></thead>
            <tbody>
              <tr v-for="member in data.atRisk" :key="member.userId" class="row-hover">
                <td class="td"><RouterLink :to="`/admin/analytics/member/${member.userId}`" class="font-medium text-mat-700 hover:underline">{{ member.memberName }}</RouterLink></td>
                <td class="td">{{ member.lastCheckInAt ? date(member.lastCheckInAt) : 'Never' }}</td>
                <td class="td text-right tabular">{{ member.daysSinceCheckIn < 0 ? '—' : member.daysSinceCheckIn }}</td>
                <td class="td text-right tabular">{{ member.tenureDays }}</td>
                <td class="td">{{ member.membershipStatus ?? '—' }}</td>
                <td class="td"><span class="chip" :class="member.risk === 'critical' ? 'bg-rose-50 text-rose-700' : member.risk === 'at_risk' ? 'bg-amber-50 text-amber-700' : 'bg-ink-100 text-ink-600'">{{ member.risk.replace('_', ' ') }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>
