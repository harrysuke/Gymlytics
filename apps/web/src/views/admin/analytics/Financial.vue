<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import type { FinancialAnalytics } from '@gymlytics/shared';
import { api } from '../../../lib/api';
import { describeError, notify } from '../../../lib/toast';
import { date } from '../../../lib/format';
import PageHeader from '../../../components/PageHeader.vue';
import ChartCard from '../../../components/analytics/ChartCard.vue';
import MetricRow from '../../../components/analytics/MetricRow.vue';
import RangePicker from '../../../components/analytics/RangePicker.vue';
import LineChart from '../../../components/charts/LineChart.vue';
import DonutChart from '../../../components/charts/DonutChart.vue';

const days = ref(90);
const data = ref<FinancialAnalytics | null>(null);
const loading = ref(true);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const { data: result } = await api.get<FinancialAnalytics>('/v1/analytics/financial', {
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
    <PageHeader title="Financial & revenue analytics" subtitle="Recurring revenue, member value, failed payments and cash flow">
      <template #actions><RangePicker :days="days" @change="(value: number) => (days = value)" /></template>
    </PageHeader>
    <div v-if="loading" class="grid gap-4"><div class="skeleton h-28" /><div class="skeleton h-72" /></div>
    <template v-else-if="data">
      <MetricRow :metrics="data.metrics" />

      <div class="mt-5 grid gap-5 lg:grid-cols-2">
        <ChartCard title="Revenue trend" subtitle="Succeeded payments by month"><LineChart :series="data.revenueSeries" color="#0d9488" suffix=" cents" /></ChartCard>
        <ChartCard title="Revenue mix" subtitle="Memberships, drop-ins, retail, private and seminars"><DonutChart :series="data.revenueMix" /></ChartCard>
        <ChartCard title="Plan mix" subtitle="Monthly recurring value by plan"><DonutChart :series="data.planMix" :size="150" /></ChartCard>
        <ChartCard title="Projected cash flow" subtitle="Net monthly flow from current run rates"><LineChart :series="data.cashFlowProjection" color="#7c3aed" suffix=" cents" /></ChartCard>
      </div>

      <div class="mt-5 grid gap-5 lg:grid-cols-2">
        <ChartCard title="Failed payments" subtitle="Declined charges and retry attempts">
          <div v-if="!data.failedPayments.length" class="py-6 text-center text-sm text-ink-400">No failed payments in this range.</div>
          <table v-else class="w-full text-sm">
            <thead><tr class="border-b border-ink-200 text-left text-xs uppercase text-ink-500"><th class="py-2">Member</th><th class="py-2 text-right">Amount</th><th class="py-2">Reason</th><th class="py-2 text-right">Retries</th></tr></thead>
            <tbody>
              <tr v-for="(payment, index) in data.failedPayments" :key="`${payment.userId}-${index}`" class="border-b border-ink-100">
                <td class="py-2"><RouterLink :to="`/admin/members/${payment.userId}`" class="font-medium text-mat-700 hover:underline">{{ payment.memberName }}</RouterLink></td>
                <td class="py-2 text-right tabular">{{ (payment.amountCents / 100).toFixed(2) }}</td>
                <td class="py-2 text-ink-600">{{ payment.failureCode ?? 'Declined' }}</td>
                <td class="py-2 text-right tabular">{{ payment.retries }}</td>
              </tr>
            </tbody>
          </table>
        </ChartCard>
        <ChartCard title="Expiring cards" subtitle="Cards expiring within 60 days">
          <div v-if="!data.expiringCards.length" class="py-6 text-center text-sm text-ink-400">No cards need updating.</div>
          <table v-else class="w-full text-sm">
            <thead><tr class="border-b border-ink-200 text-left text-xs uppercase text-ink-500"><th class="py-2">Member</th><th class="py-2">Card</th><th class="py-2 text-right">Expires</th></tr></thead>
            <tbody>
              <tr v-for="(card, index) in data.expiringCards" :key="`${card.userId}-${index}`" class="border-b border-ink-100">
                <td class="py-2">{{ card.memberName }}</td>
                <td class="py-2">{{ card.brand ?? 'Card' }} •••• {{ card.last4 ?? '----' }}</td>
                <td class="py-2 text-right tabular">{{ card.expiry }}</td>
              </tr>
            </tbody>
          </table>
          <p class="mt-3 text-[11px] text-ink-400">As of {{ date(new Date().toISOString()) }}</p>
        </ChartCard>
      </div>
    </template>
  </div>
</template>
