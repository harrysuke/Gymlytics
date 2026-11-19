<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import type { ReportColumn, ReportResult, ReportRow } from '@gymlytics/shared';
import { api } from '../../../lib/api';
import { describeError, notify } from '../../../lib/toast';
import PageHeader from '../../../components/PageHeader.vue';
import MetricRow from '../../../components/analytics/MetricRow.vue';
import EmptyState from '../../../components/EmptyState.vue';

const route = useRoute();
const slug = computed(() => String(route.params.slug ?? ''));
const data = ref<ReportResult | null>(null);
const loading = ref(true);
const date = ref(new Date().toISOString().slice(0, 10));
const month = ref(new Date().toISOString().slice(0, 7));
const days = ref(90);

const needsDate = computed(() => slug.value === 'daily-roster');
const needsMonth = computed(() => ['membership-changes', 'revenue-tax'].includes(slug.value));
const needsDays = computed(() => ['mia-at-risk', 'incident-log'].includes(slug.value));

function query(): Record<string, string | number> {
  if (needsDate.value) return { date: date.value };
  if (needsMonth.value) return { month: month.value };
  if (needsDays.value) return { days: days.value };
  return {
    from: new Date(Date.now() - 90 * 86_400_000).toISOString(),
    limit: 200,
  };
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const { data: result } = await api.get<ReportResult>(`/v1/reports/${slug.value}`, { query: query() });
    data.value = result;
  } catch (error) {
    notify.error(describeError(error));
  } finally {
    loading.value = false;
  }
}
watch([slug, date, month, days], load);
onMounted(load);

function cellValue(row: ReportRow, column: ReportColumn): string {
  const value = row[column.key];
  return value === null || value === undefined ? '—' : String(value);
}

function exportCsv(): void {
  if (!data.value) return;
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const lines = [
    data.value.columns.map((column) => escape(column.label)).join(','),
    ...data.value.rows.map((row) => data.value!.columns.map((column) => escape(cellValue(row, column))).join(',')),
  ];
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${data.value.slug}-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <div>
    <PageHeader :title="data?.title ?? 'Report'" subtitle="Generated live from academy data">
      <template #actions>
        <RouterLink to="/admin/reports" class="btn-ghost">All reports</RouterLink>
        <button v-if="data?.rows.length" class="btn-primary" @click="exportCsv">Export CSV</button>
      </template>
    </PageHeader>

    <div class="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-ink-200 bg-white p-3">
      <label v-if="needsDate" class="text-xs font-medium text-ink-600">Date<input v-model="date" type="date" class="input mt-1 text-xs" /></label>
      <label v-if="needsMonth" class="text-xs font-medium text-ink-600">Month<input v-model="month" type="month" class="input mt-1 text-xs" /></label>
      <label v-if="needsDays" class="text-xs font-medium text-ink-600">Window (days)<input v-model.number="days" type="number" min="1" max="365" class="input mt-1 w-28 text-xs" /></label>
      <span class="ml-auto text-[11px] text-ink-400">Updated {{ data ? new Date(data.generatedAt).toLocaleTimeString() : '—' }}</span>
    </div>

    <div v-if="loading" class="space-y-4"><div class="skeleton h-24" /><div class="skeleton h-96" /></div>
    <template v-else-if="data">
      <MetricRow :metrics="data.summary" />
      <div class="mt-5">
        <EmptyState
          v-if="!data.rows.length"
          title="No rows for this period"
          body="Adjust the filters above or check that the relevant activity has been recorded."
        />
        <div v-else class="card overflow-x-auto">
          <table class="w-full min-w-[720px]">
            <thead>
              <tr>
                <th v-for="column in data.columns" :key="column.key" class="th" :class="column.type === 'number' || column.type === 'money' || column.type === 'percent' ? 'text-right' : ''">
                  {{ column.label }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, rowIndex) in data.rows" :key="rowIndex" class="row-hover">
                <td
                  v-for="column in data.columns"
                  :key="column.key"
                  class="td"
                  :class="[
                    column.type === 'number' || column.type === 'money' || column.type === 'percent' ? 'text-right tabular' : '',
                    column.type === 'text' && String(row[column.key] ?? '').length > 60 ? 'max-w-xs' : '',
                  ]"
                >
                  <RouterLink
                    v-if="column.type === 'link' && typeof row[column.key] === 'string' && String(row[column.key]).startsWith('/')"
                    :to="String(row[column.key])"
                    class="text-mat-700 hover:underline"
                  >
                    View
                  </RouterLink>
                  <span v-else-if="column.type === 'badge'" class="chip bg-ink-100 text-ink-700">{{ cellValue(row, column) }}</span>
                  <span v-else :class="rowIndex === data.rows.length - 1 && cellValue(row, data.columns[0]!) === 'Total' ? 'font-bold' : ''">
                    {{ cellValue(row, column) }}{{ column.type === 'percent' && row[column.key] !== null ? '%' : '' }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="mt-2 text-xs text-ink-400">{{ data.rows.length }} row{{ data.rows.length === 1 ? '' : 's' }}</p>
      </div>
    </template>
  </div>
</template>
