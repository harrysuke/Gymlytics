<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import type { AttendanceAnalytics } from '@gymlytics/shared';
import { api } from '../../../lib/api';
import { describeError, notify } from '../../../lib/toast';
import PageHeader from '../../../components/PageHeader.vue';
import ChartCard from '../../../components/analytics/ChartCard.vue';
import MetricRow from '../../../components/analytics/MetricRow.vue';
import RangePicker from '../../../components/analytics/RangePicker.vue';
import BarChart from '../../../components/charts/BarChart.vue';
import LineChart from '../../../components/charts/LineChart.vue';
import DonutChart from '../../../components/charts/DonutChart.vue';

const days = ref(90);
const data = ref<AttendanceAnalytics | null>(null);
const loading = ref(true);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const { data: result } = await api.get<AttendanceAnalytics>('/v1/analytics/attendance', {
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
    <PageHeader title="Attendance & coaching impact" subtitle="Class demand, capacity, no-shows and instructor performance">
      <template #actions><RangePicker :days="days" @change="(value: number) => (days = value)" /></template>
    </PageHeader>
    <div v-if="loading" class="grid gap-4"><div class="skeleton h-28" /><div class="skeleton h-72" /></div>
    <template v-else-if="data">
      <MetricRow :metrics="data.metrics" />

      <div class="mt-5 grid gap-5 lg:grid-cols-2">
        <ChartCard title="Check-ins over time" subtitle="Monthly attendance"><LineChart :series="data.attendanceSeries" /></ChartCard>
        <ChartCard title="Peak weekdays" subtitle="Which days fill the mat"><BarChart :series="data.byWeekday" color="#f59e0b" /></ChartCard>
        <ChartCard title="Peak hours" subtitle="Check-ins by start hour"><BarChart :series="data.byHour" color="#0ea5e9" /></ChartCard>
        <ChartCard title="Style mix" subtitle="Gi, No-Gi, Kids and striking"><DonutChart :series="data.styleMix" /></ChartCard>
      </div>

      <div class="mt-5 grid gap-5 lg:grid-cols-2">
        <ChartCard title="Class popularity" subtitle="Average attendance, utilisation and waitlist">
          <div class="max-h-80 overflow-auto">
            <table class="w-full text-sm">
              <thead><tr class="border-b border-ink-200 text-left text-xs uppercase text-ink-500"><th class="py-2">Class</th><th class="py-2 text-right">Avg</th><th class="py-2 text-right">Util.</th><th class="py-2 text-right">No-shows</th><th class="py-2 text-right">Waitlist</th></tr></thead>
              <tbody>
                <tr v-for="(row, index) in data.classPopularity" :key="`${row.classTitle}-${index}`" class="border-b border-ink-100">
                  <td class="py-2"><span class="font-medium text-ink-800">{{ row.classTitle }}</span><span class="block text-[11px] text-ink-400">{{ row.programName }}</span></td>
                  <td class="py-2 text-right tabular">{{ row.avgAttendance }}</td>
                  <td class="py-2 text-right tabular">{{ row.avgUtilization }}%</td>
                  <td class="py-2 text-right tabular">{{ row.noShows }}</td>
                  <td class="py-2 text-right tabular">{{ row.waitlist }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </ChartCard>
        <ChartCard title="Coach impact" subtitle="Sessions, headcount and Gi / No-Gi split">
          <div class="max-h-80 overflow-auto">
            <table class="w-full text-sm">
              <thead><tr class="border-b border-ink-200 text-left text-xs uppercase text-ink-500"><th class="py-2">Coach</th><th class="py-2 text-right">Classes</th><th class="py-2 text-right">Students</th><th class="py-2 text-right">Returning</th><th class="py-2 text-right">Util.</th><th class="py-2 text-right">Gi / No-Gi</th></tr></thead>
              <tbody>
                <tr v-for="coach in data.coachImpact" :key="coach.coachId" class="border-b border-ink-100">
                  <td class="py-2 font-medium text-ink-800">{{ coach.coachName }}</td>
                  <td class="py-2 text-right tabular">{{ coach.classes }}</td>
                  <td class="py-2 text-right tabular">{{ coach.uniqueStudents }}</td>
                  <td class="py-2 text-right tabular">{{ coach.returningStudents }}</td>
                  <td class="py-2 text-right tabular">{{ coach.avgUtilization }}%</td>
                  <td class="py-2 text-right tabular">{{ coach.giClasses }} / {{ coach.nogiClasses }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </ChartCard>
      </div>

      <div class="mt-5"><ChartCard title="Skill level mix" subtitle="Check-ins by current belt"><DonutChart :series="data.levelMix" /></ChartCard></div>
    </template>
  </div>
</template>
