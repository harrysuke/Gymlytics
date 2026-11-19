<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import type { MemberAnalytics } from '@gymlytics/shared';
import { api } from '../../../lib/api';
import { describeError, notify } from '../../../lib/toast';
import { date } from '../../../lib/format';
import PageHeader from '../../../components/PageHeader.vue';
import ChartCard from '../../../components/analytics/ChartCard.vue';
import MetricRow from '../../../components/analytics/MetricRow.vue';
import BarChart from '../../../components/charts/BarChart.vue';
import LineChart from '../../../components/charts/LineChart.vue';
import EmptyState from '../../../components/EmptyState.vue';

const route = useRoute();
const data = ref<MemberAnalytics | null>(null);
const loading = ref(true);
const userId = computed(() => String(route.params.id ?? ''));

const riskTone = computed(() => {
  const risk = data.value?.retention.risk;
  return risk === 'critical' || risk === 'at_risk' ? 'text-amber-600' : 'text-emerald-600';
});

async function load(): Promise<void> {
  loading.value = true;
  try {
    const { data: result } = await api.get<MemberAnalytics>(`/v1/analytics/member/${userId.value}`);
    data.value = result;
  } catch (error) {
    notify.error(describeError(error));
  } finally {
    loading.value = false;
  }
}
watch(userId, load);
onMounted(load);
</script>

<template>
  <div>
    <PageHeader :title="data ? `${data.memberName} · analytics` : 'Member analytics'" subtitle="Individual progression, attendance, retention and value">
      <template #actions>
        <RouterLink v-if="data" :to="`/admin/members/${data.userId}`" class="btn-ghost">Member profile</RouterLink>
      </template>
    </PageHeader>

    <div v-if="loading" class="grid gap-4"><div class="skeleton h-28" /><div class="skeleton h-64" /></div>
    <EmptyState v-else-if="!data" title="Member not found" body="This profile may have been removed." />
    <template v-else>
      <MetricRow :metrics="data.metrics" />

      <div class="mt-5 grid gap-5 lg:grid-cols-3">
        <ChartCard title="Retention" subtitle="Membership and check-in health">
          <dl class="space-y-3 text-sm">
            <div class="flex justify-between gap-3"><dt class="text-ink-500">Risk level</dt><dd class="font-semibold capitalize" :class="riskTone">{{ data.retention.risk.replace('_', ' ') }}</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-ink-500">Last check-in</dt><dd class="font-medium">{{ data.retention.daysSinceCheckIn === null ? 'Never' : `${data.retention.daysSinceCheckIn} days ago` }}</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-ink-500">Weekly streak</dt><dd class="font-medium tabular">{{ data.retention.streakWeeks }} weeks</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-ink-500">Membership</dt><dd class="font-medium capitalize">{{ data.retention.membershipStatus ?? 'None' }}</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-ink-500">Plan</dt><dd class="font-medium">{{ data.retention.planName ?? '—' }}</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-ink-500">Member since</dt><dd class="font-medium">{{ date(data.joinedAt) }}</dd></div>
          </dl>
        </ChartCard>
        <ChartCard title="Value" subtitle="Payments and tenure">
          <dl class="space-y-3 text-sm">
            <div class="flex justify-between gap-3"><dt class="text-ink-500">Lifetime revenue</dt><dd class="font-medium tabular">{{ (data.financial.lifetimeCents / 100).toFixed(2) }}</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-ink-500">Last 90 days</dt><dd class="font-medium tabular">{{ (data.financial.last90DaysCents / 100).toFixed(2) }}</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-ink-500">Revenue / month</dt><dd class="font-medium tabular">{{ (data.financial.arpuCents / 100).toFixed(2) }}</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-ink-500">Months active</dt><dd class="font-medium tabular">{{ data.financial.monthsActive }}</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-ink-500">Waiver</dt><dd class="font-medium" :class="data.compliance.waiverStatus === 'Signed' ? 'text-emerald-600' : 'text-amber-600'">{{ data.compliance.waiverStatus }}</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-ink-500">Incidents</dt><dd class="font-medium tabular">{{ data.compliance.incidents }}</dd></div>
          </dl>
        </ChartCard>
        <ChartCard title="Classes by programme" subtitle="Last 90 days"><BarChart :series="data.attendanceByProgram" color="#4f46e5" /></ChartCard>
      </div>

      <div class="mt-5"><ChartCard title="Attendance trend" subtitle="Monthly check-ins"><LineChart :series="data.attendanceSeries" /></ChartCard></div>

      <div class="mt-5">
        <h2 class="mb-3 font-display text-lg font-bold text-ink-900">Progression</h2>
        <EmptyState v-if="!data.progression.length" title="No rank history yet" body="Progression appears once this member trains in a programme with a belt ladder." />
        <div v-else class="card overflow-x-auto">
          <table class="w-full min-w-[720px]">
            <thead><tr><th class="th">Programme</th><th class="th">Current rank</th><th class="th text-right">Classes</th><th class="th text-right">Mat hours</th><th class="th text-right">Months</th><th class="th">Next</th><th class="th">Status</th></tr></thead>
            <tbody>
              <tr v-for="(row, index) in data.progression" :key="`${row.programName}-${index}`" class="row-hover">
                <td class="td">{{ row.programName }}</td>
                <td class="td">{{ row.currentRankName }} · {{ row.stripes }} stripe{{ row.stripes === 1 ? '' : 's' }}</td>
                <td class="td text-right tabular">{{ row.classes }}</td>
                <td class="td text-right tabular">{{ row.matHours }}</td>
                <td class="td text-right tabular">{{ row.monthsInRank }}</td>
                <td class="td">{{ row.nextRankName ?? '—' }}</td>
                <td class="td"><span class="chip" :class="row.eligible ? 'bg-emerald-50 text-emerald-700' : 'bg-ink-100 text-ink-600'">{{ row.eligible ? 'Eligible' : 'In progress' }}</span><span v-if="row.missing.length" class="mt-1 block text-[11px] text-ink-400">{{ row.missing.join(', ') }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>
