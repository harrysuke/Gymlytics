<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { api, fetchBlobUrl } from '../../lib/api';
import { canManage } from '../../lib/auth';
import { date, humanize, shortDate } from '../../lib/format';
import { describeError, notify } from '../../lib/toast';
import PageHeader from '../../components/PageHeader.vue';
import ModalDialog from '../../components/ModalDialog.vue';
import StatusBadge from '../../components/StatusBadge.vue';
import EmptyState from '../../components/EmptyState.vue';

interface Template {
  id: string;
  waiverType: string;
  version: number;
  title: string;
  bodyMarkdown: string;
  isActive: boolean;
}

interface SignedWaiver {
  id: string;
  userId: string;
  memberFirstName: string | null;
  memberLastName: string | null;
  waiverType: string;
  documentVersion: number;
  documentTitle: string | null;
  signedAt: string;
  expiresAt: string | null;
  status: string;
  signerName: string | null;
}

const templates = ref<Template[]>([]);
const waivers = ref<SignedWaiver[]>([]);
const loading = ref(true);
const statusFilter = ref('');
const search = ref('');

const templateOpen = ref(false);
const busy = ref(false);
const form = ref({ waiverType: 'general', version: 1, title: '', bodyMarkdown: '' });

const filtered = computed(() => {
  const needle = search.value.trim().toLowerCase();
  return waivers.value.filter((row) => {
    if (statusFilter.value && row.status !== statusFilter.value) return false;
    if (!needle) return true;
    return `${row.memberFirstName ?? ''} ${row.memberLastName ?? ''} ${row.signerName ?? ''}`
      .toLowerCase()
      .includes(needle);
  });
});

const stats = computed(() => ({
  signed: waivers.value.filter((row) => row.status === 'signed').length,
  expiringSoon: waivers.value.filter((row) => {
    if (!row.expiresAt || row.status !== 'signed') return false;
    const days = (new Date(row.expiresAt).getTime() - Date.now()) / 86_400_000;
    return days > 0 && days <= 30;
  }).length,
  expired: waivers.value.filter((row) => row.status === 'expired' || (row.expiresAt && new Date(row.expiresAt) < new Date())).length,
}));

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [templateResponse, waiverResponse] = await Promise.all([
      api.get<Template[]>('/v1/waivers/templates'),
      api.get<SignedWaiver[]>('/v1/waivers', { query: { limit: 200 } }),
    ]);
    templates.value = templateResponse.data;
    waivers.value = waiverResponse.data;
  } catch (error) {
    notify.error(describeError(error));
  } finally {
    loading.value = false;
  }
}

function openTemplate(): void {
  form.value = {
    waiverType: 'general',
    version: (templates.value.find((t) => t.waiverType === 'general')?.version ?? 0) + 1,
    title: '',
    bodyMarkdown: '',
  };
  templateOpen.value = true;
}

async function createTemplate(): Promise<void> {
  busy.value = true;
  try {
    await api.post('/v1/waiver-templates', {
      waiverType: form.value.waiverType,
      version: Number(form.value.version),
      title: form.value.title.trim(),
      bodyMarkdown: form.value.bodyMarkdown.trim(),
    });
    notify.success('Template published — the document hash is now pinned to this version');
    templateOpen.value = false;
    await load();
  } catch (error) {
    notify.error(describeError(error));
  } finally {
    busy.value = false;
  }
}

async function viewPdf(id: string): Promise<void> {
  try {
    const url = await fetchBlobUrl(`/v1/waivers/${id}/pdf`);
    window.open(url, '_blank', 'noopener');
  } catch (error) {
    notify.error(describeError(error));
  }
}

onMounted(load);
</script>

<template>
  <div>
    <PageHeader
      title="Waivers"
      subtitle="Signed documents are immutable: version, hash, timestamp and IP are captured at signing."
      :action-label="canManage ? 'Publish template' : undefined"
      @action="openTemplate"
    />

    <div class="mb-4 grid gap-3 sm:grid-cols-3">
      <div class="card-pad">
        <p class="text-xs font-semibold uppercase tracking-wide text-ink-500">Signed</p>
        <p class="mt-2 font-display text-2xl font-bold tabular text-emerald-600">{{ stats.signed }}</p>
      </div>
      <div class="card-pad">
        <p class="text-xs font-semibold uppercase tracking-wide text-ink-500">Expiring in 30 days</p>
        <p class="mt-2 font-display text-2xl font-bold tabular text-amber-600">{{ stats.expiringSoon }}</p>
      </div>
      <div class="card-pad">
        <p class="text-xs font-semibold uppercase tracking-wide text-ink-500">Expired</p>
        <p class="mt-2 font-display text-2xl font-bold tabular" :class="stats.expired ? 'text-rose-600' : 'text-ink-400'">
          {{ stats.expired }}
        </p>
      </div>
    </div>

    <div class="grid gap-6 lg:grid-cols-[1fr_320px]">
      <!-- Register -->
      <section class="card overflow-hidden">
        <header class="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-4 py-3">
          <h2 class="text-sm font-semibold text-ink-900">Signed register</h2>
          <div class="flex gap-2">
            <input v-model="search" class="input w-44 py-1.5 text-xs" placeholder="Search member" />
            <select v-model="statusFilter" class="input w-auto py-1.5 text-xs">
              <option value="">All</option>
              <option value="signed">Signed</option>
              <option value="expired">Expired</option>
              <option value="revoked">Revoked</option>
            </select>
          </div>
        </header>

        <div v-if="loading" class="space-y-2 p-4">
          <div v-for="n in 6" :key="n" class="skeleton h-11 w-full" />
        </div>

        <EmptyState v-else-if="!filtered.length" title="No waivers on file" body="Have a member sign from the kiosk or send them the waiver link." icon="📄" />

        <div v-else class="overflow-x-auto">
          <table class="w-full min-w-[640px]">
            <thead class="border-b border-ink-100 bg-ink-50/60">
              <tr>
                <th class="th">Member</th>
                <th class="th">Document</th>
                <th class="th">Signed</th>
                <th class="th">Expires</th>
                <th class="th">Status</th>
                <th class="th" />
              </tr>
            </thead>
            <tbody class="divide-y divide-ink-100">
              <tr v-for="row in filtered" :key="row.id" class="row-hover">
                <td class="td">
                  <RouterLink :to="{ name: 'member-detail', params: { id: row.userId } }" class="font-medium text-mat-700 hover:underline">
                    {{ row.memberFirstName ?? 'Unknown' }} {{ row.memberLastName ?? '' }}
                  </RouterLink>
                  <p v-if="row.signerName" class="text-[11px] text-ink-400">signed by {{ row.signerName }}</p>
                </td>
                <td class="td">
                  <p class="text-xs font-medium text-ink-800">{{ humanize(row.waiverType) }}</p>
                  <p class="text-[11px] text-ink-500">v{{ row.documentVersion }}</p>
                </td>
                <td class="td text-xs text-ink-500">{{ date(row.signedAt) }}</td>
                <td class="td text-xs text-ink-500">{{ row.expiresAt ? shortDate(row.expiresAt) : 'Never' }}</td>
                <td class="td"><StatusBadge :value="row.status" /></td>
                <td class="td text-right">
                  <button class="text-xs font-semibold text-mat-700 hover:underline" @click="viewPdf(row.id)">PDF</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Templates -->
      <section class="card h-fit">
        <header class="border-b border-ink-100 px-4 py-3">
          <h2 class="text-sm font-semibold text-ink-900">Templates</h2>
          <p class="text-xs text-ink-500">Each version has its own document hash.</p>
        </header>
        <ul class="divide-y divide-ink-100">
          <li v-for="template in templates" :key="template.id" class="px-4 py-3">
            <div class="flex items-start justify-between gap-2">
              <p class="text-sm font-semibold text-ink-900">{{ humanize(template.waiverType) }}</p>
              <StatusBadge :value="template.isActive ? 'active' : 'inactive'" />
            </div>
            <p class="mt-0.5 text-xs text-ink-500">v{{ template.version }} · {{ template.title }}</p>
          </li>
          <li v-if="!templates.length" class="px-4 py-6 text-center text-xs text-ink-400">No templates yet</li>
        </ul>
      </section>
    </div>

    <ModalDialog :open="templateOpen" title="Publish a waiver template" description="The body is hashed with SHA-256 and stored with the version. Signatures must match this hash." width="max-w-2xl" @close="templateOpen = false">
      <form id="new-template" class="grid gap-4 sm:grid-cols-2" @submit.prevent="createTemplate">
        <div>
          <label class="label" for="w-type">Type</label>
          <select id="w-type" v-model="form.waiverType" class="input">
            <option value="general">General</option>
            <option value="participation">Participation</option>
            <option value="photo_release">Photo release</option>
            <option value="medical">Medical</option>
            <option value="dropin">Drop-in</option>
          </select>
        </div>
        <div>
          <label class="label" for="w-version">Version</label>
          <input id="w-version" v-model.number="form.version" class="input" type="number" min="1" />
        </div>
        <div class="sm:col-span-2">
          <label class="label" for="w-title">Title</label>
          <input id="w-title" v-model="form.title" class="input" placeholder="Participation and liability waiver" required />
        </div>
        <div class="sm:col-span-2">
          <label class="label" for="w-body">Body (markdown)</label>
          <textarea id="w-body" v-model="form.bodyMarkdown" class="input font-mono text-xs" rows="10" required />
        </div>
      </form>
      <template #footer>
        <button class="btn-ghost" @click="templateOpen = false">Cancel</button>
        <button class="btn-primary" form="new-template" type="submit" :disabled="busy">Publish</button>
      </template>
    </ModalDialog>
  </div>
</template>
