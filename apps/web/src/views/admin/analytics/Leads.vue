<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import type { LeadAnalytics } from '@gymlytics/shared';
import { api } from '../../../lib/api';
import { describeError, notify } from '../../../lib/toast';
import { date } from '../../../lib/format';
import PageHeader from '../../../components/PageHeader.vue';
import ChartCard from '../../../components/analytics/ChartCard.vue';
import MetricRow from '../../../components/analytics/MetricRow.vue';
import RangePicker from '../../../components/analytics/RangePicker.vue';
import BarChart from '../../../components/charts/BarChart.vue';
import LineChart from '../../../components/charts/LineChart.vue';

const days = ref(180);
const data = ref<LeadAnalytics | null>(null);
const loading = ref(true);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const { data: result } = await api.get<LeadAnalytics>('/v1/analytics/leads', {
      query: { from: new Date(Date.now() - days.value * 86_400_000).toISOString(), limit: 100 },
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
    <PageHeader title="Lead & marketing analytics" subtitle="Trial conversion speed and which sources bring retaining members">
      <template #actions><RangePicker :days="days" @change="(value: number) => (days = value)" /></template>
    </PageHeader>
    <div v-if="loading" class="grid gap-4"><div class="skeleton h-28" /><div class="skeleton h-72" /></div>
    <template v-else-if="data">
      <MetricRow :metrics="data.metrics" />

      <div class="mt-5 grid gap-5 lg:grid-cols-2">
        <ChartCard title="Lead funnel" subtitle="From first contact to paid member"><BarChart :series="data.funnel" color="#4f46e5" /></ChartCard>
        <ChartCard title="Leads over time" subtitle="New enquiries per month"><LineChart :series="data.leadSeries" color="#0d9488" /></ChartCard>
      </div>

      <div class="mt-5">
        <ChartCard title="Source & referral attribution" subtitle="Conversion rate and 90-day retention of converted students">
          <div class="overflow-x-auto">
            <table class="w-full min-w-[640px] text-sm">
              <thead><tr class="border-b border-ink-200 text-left text-xs uppercase text-ink-500"><th class="py-2">Source</th><th class="py-2 text-right">Leads</th><th class="py-2 text-right">Trials</th><th class="py-2 text-right">Converted</th><th class="py-2 text-right">Conversion</th><th class="py-2 text-right">Retained 90d</th></tr></thead>
              <tbody>
                <tr v-for="source in data.sourceAttribution" :key="source.source" class="border-b border-ink-100">
                  <td class="py-2 font-medium capitalize text-ink-800">{{ source.source }}</td>
                  <td class="py-2 text-right tabular">{{ source.leads }}</td>
                  <td class="py-2 text-right tabular">{{ source.trials }}</td>
                  <td class="py-2 text-right tabular">{{ source.converted }}</td>
                  <td class="py-2 text-right tabular font-semibold text-mat-700">{{ source.conversionRate }}%</td>
                  <td class="py-2 text-right tabular">{{ source.retained90Days }}%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </ChartCard>
      </div>

      <div class="mt-5">
        <ChartCard title="Follow-up queue" subtitle="Trials and enquiries waiting for a response">
          <div v-if="!data.followUps.length" class="py-6 text-center text-sm text-ink-400">No open follow-ups.</div>
          <table v-else class="w-full text-sm">
            <thead><tr class="border-b border-ink-200 text-left text-xs uppercase text-ink-500"><th class="py-2">Lead</th><th class="py-2">Source</th><th class="py-2">Status</th><th class="py-2">Last contact</th><th class="py-2 text-right">Days</th></tr></thead>
            <tbody>
              <tr v-for="lead in data.followUps" :key="lead.leadId" class="border-b border-ink-100">
                <td class="py-2 font-medium text-ink-800">{{ lead.leadName }}</td>
                <td class="py-2 capitalize text-ink-600">{{ lead.source }}</td>
                <td class="py-2"><span class="chip bg-ink-100 text-ink-600">{{ lead.status }}</span></td>
                <td class="py-2">{{ lead.lastContactAt ? date(lead.lastContactAt) : '—' }}</td>
                <td class="py-2 text-right tabular" :class="lead.daysSinceContact >= 7 ? 'font-semibold text-amber-600' : ''">{{ lead.daysSinceContact }}</td>
              </tr>
            </tbody>
          </table>
        </ChartCard>
      </div>
    </template>
  </div>
</template>
