<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, fetchBlobUrl } from '../../lib/api';
import { canManage } from '../../lib/auth';
import { shortDate } from '../../lib/format';
import { describeError, notify } from '../../lib/toast';
import PageHeader from '../../components/PageHeader.vue';
import EmptyState from '../../components/EmptyState.vue';

interface ImportJob {
  id: string;
  type: string;
  status: string;
  fileName: string | null;
  totalRows: number;
  importedRows: number;
  errors: { row: number; message: string }[];
  createdAt: string;
}
interface ImportResult extends ImportJob {
  skippedRows: number;
}

const jobs = ref<ImportJob[]>([]);
const result = ref<ImportResult | null>(null);
const type = ref<'members' | 'belt_ranks' | 'billing_mandates'>('members');
const file = ref<File | null>(null);
const busy = ref(false);
const error = ref<string | null>(null);

const typeLabels: Record<string, string> = {
  members: 'Members',
  belt_ranks: 'Belt ranks',
  billing_mandates: 'Billing mandates',
};

async function load(): Promise<void> {
  try {
    jobs.value = (await api.get<ImportJob[]>('/v1/imports')).data;
  } catch (caught) {
    error.value = describeError(caught);
  }
}

function onFile(event: Event): void {
  const input = event.target as HTMLInputElement;
  file.value = input.files?.[0] ?? null;
}

async function upload(): Promise<void> {
  if (!file.value) return;
  busy.value = true;
  error.value = null;
  try {
    const csv = await file.value.text();
    result.value = (await api.post<ImportResult>('/v1/imports', {
      type: type.value,
      fileName: file.value.name,
      csv,
    })).data;
    notify.success(`Imported ${result.value.importedRows} rows`);
    file.value = null;
    await load();
  } catch (caught) {
    error.value = describeError(caught);
    notify.error(error.value);
  } finally {
    busy.value = false;
  }
}

async function downloadTemplate(): Promise<void> {
  try {
    const url = await fetchBlobUrl(`/v1/imports/template/${type.value}`);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${type.value}-template.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  } catch (caught) {
    notify.error(describeError(caught));
  }
}

onMounted(load);
</script>

<template>
  <div class="space-y-6">
    <PageHeader title="Data import" subtitle="Bring your roster, ranks and billing mandates across from a spreadsheet." />

    <div v-if="error" class="card border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
      {{ error }} — <RouterLink class="underline" to="/admin/plan">upgrade your plan</RouterLink> if this module is locked.
    </div>

    <div class="grid gap-6 lg:grid-cols-2">
      <div class="card space-y-5 p-6">
        <h2 class="font-display text-lg font-bold text-ink-900">New import</h2>
        <div v-if="!canManage" class="rounded-xl bg-ink-50 p-3 text-sm text-ink-600">
          Imports are limited to owners and admins.
        </div>
        <div>
          <label class="label" for="import-type">What are you importing?</label>
          <select id="import-type" v-model="type" class="input">
            <option value="members">Members</option>
            <option value="belt_ranks">Belt ranks</option>
            <option value="billing_mandates">Billing mandates</option>
          </select>
        </div>
        <div>
          <label class="label" for="import-file">CSV file</label>
          <input id="import-file" class="input" type="file" accept=".csv,text/csv" @change="onFile" />
          <p class="mt-1 text-xs text-ink-500">UTF-8, up to 2 MB. A header row is required.</p>
        </div>
        <div class="flex gap-2">
          <button class="btn-primary" type="button" :disabled="!file || busy || !canManage" @click="upload">
            {{ busy ? 'Importing…' : 'Import CSV' }}
          </button>
          <button class="btn-ghost" type="button" @click="downloadTemplate">Download template</button>
        </div>

        <div v-if="result" class="rounded-xl border border-ink-200 bg-ink-50 p-4 text-sm">
          <p class="font-semibold text-ink-900">
            {{ result.importedRows }} imported · {{ result.skippedRows }} skipped
          </p>
          <ul v-if="result.errors.length" class="mt-2 max-h-40 space-y-1 overflow-auto text-rose-700">
            <li v-for="issue in result.errors" :key="`${issue.row}-${issue.message}`">
              Row {{ issue.row }}: {{ issue.message }}
            </li>
          </ul>
        </div>
      </div>

      <div class="card overflow-hidden">
        <div class="border-b border-ink-100 px-6 py-4">
          <h2 class="font-display text-lg font-bold text-ink-900">Import history</h2>
        </div>
        <table class="w-full text-left text-sm">
          <thead class="bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
            <tr><th class="th">File</th><th class="th">Type</th><th class="th">Rows</th><th class="th">Date</th></tr>
          </thead>
          <tbody class="divide-y divide-ink-100">
            <tr v-for="job in jobs" :key="job.id">
              <td class="td font-medium text-ink-900">{{ job.fileName }}</td>
              <td class="td text-ink-600">{{ typeLabels[job.type] ?? job.type }}</td>
              <td class="td text-ink-700">{{ job.importedRows }}/{{ job.totalRows }}</td>
              <td class="td text-ink-500">{{ shortDate(job.createdAt) }}</td>
            </tr>
          </tbody>
        </table>
        <EmptyState v-if="!jobs.length" title="No imports yet" message="Upload a CSV to get started." />
      </div>
    </div>
  </div>
</template>
