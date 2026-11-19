<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api } from '../../lib/api';
import { canManage } from '../../lib/auth';
import { describeError, notify } from '../../lib/toast';
import PageHeader from '../../components/PageHeader.vue';
import ModalDialog from '../../components/ModalDialog.vue';
import EmptyState from '../../components/EmptyState.vue';

interface Location {
  id: string;
  name: string;
  slug: string;
  parentAcademyId: string | null;
  city: string | null;
  isRoot: boolean;
  activeMembers: number;
}

interface Overview {
  locationCount: number;
  activeMembers: number;
  locations: Location[];
}

const overview = ref<Overview | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const open = ref(false);
const busy = ref(false);
const form = reactive({ name: '', slug: '', city: '', state: '', currency: 'MYR' });

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    overview.value = (await api.get<Overview>('/v1/network/overview')).data;
  } catch (caught) {
    error.value = describeError(caught);
  } finally {
    loading.value = false;
  }
}

async function create(): Promise<void> {
  busy.value = true;
  try {
    await api.post('/v1/network/locations', {
      ...form,
      slug: form.slug.trim().toLowerCase().replace(/\s+/g, '-'),
    });
    notify.success('Branch location created');
    open.value = false;
    await load();
  } catch (caught) {
    notify.error(describeError(caught));
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      title="Network"
      subtitle="One view across every branch. Roster data stays isolated to each location."
    >
      <template #actions>
        <button v-if="canManage" class="btn-primary" type="button" @click="open = true">Add location</button>
      </template>
    </PageHeader>

    <div v-if="error" class="card border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
      {{ error }} — <RouterLink class="underline" to="/admin/plan">review your plan</RouterLink>.
    </div>

    <template v-if="overview">
      <div class="grid gap-4 sm:grid-cols-3">
        <div class="card p-5">
          <p class="text-xs uppercase tracking-wide text-ink-500">Locations</p>
          <p class="mt-1 font-display text-3xl font-bold text-ink-900">{{ overview.locationCount }}</p>
        </div>
        <div class="card p-5">
          <p class="text-xs uppercase tracking-wide text-ink-500">Active members</p>
          <p class="mt-1 font-display text-3xl font-bold text-ink-900">{{ overview.activeMembers }}</p>
        </div>
        <div class="card p-5">
          <p class="text-xs uppercase tracking-wide text-ink-500">Root academy</p>
          <p class="mt-2 text-sm font-semibold text-ink-800">
            {{ overview.locations.find((row) => row.isRoot)?.name ?? '—' }}
          </p>
        </div>
      </div>

      <div class="card overflow-hidden">
        <table class="w-full text-left text-sm">
          <thead class="bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
            <tr><th class="th">Location</th><th class="th">Slug</th><th class="th">City</th><th class="th">Members</th><th class="th">Role</th></tr>
          </thead>
          <tbody class="divide-y divide-ink-100">
            <tr v-for="row in overview.locations" :key="row.id">
              <td class="td font-medium text-ink-900">{{ row.name }}</td>
              <td class="td font-mono text-xs text-ink-500">{{ row.slug }}</td>
              <td class="td text-ink-600">{{ row.city ?? '—' }}</td>
              <td class="td text-ink-700">{{ row.activeMembers }}</td>
              <td class="td"><span class="chip">{{ row.isRoot ? 'Network root' : 'Branch' }}</span></td>
            </tr>
          </tbody>
        </table>
        <EmptyState v-if="!overview.locations.length" title="No locations yet" message="Add a branch to start a network." />
      </div>
    </template>

    <div v-else-if="loading" class="card p-8 text-center text-sm text-ink-500">Loading network…</div>

    <ModalDialog :open="open" title="Add a branch location" @close="open = false">
      <form class="space-y-4" @submit.prevent="create">
        <div><label class="label" for="branch-name">Name</label><input id="branch-name" v-model="form.name" class="input" required /></div>
        <div><label class="label" for="branch-slug">Slug</label><input id="branch-slug" v-model="form.slug" class="input font-mono" required /></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="label" for="branch-city">City</label><input id="branch-city" v-model="form.city" class="input" /></div>
          <div><label class="label" for="branch-state">State</label><input id="branch-state" v-model="form.state" class="input" /></div>
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button class="btn-ghost" type="button" @click="open = false">Cancel</button>
          <button class="btn-primary" type="submit" :disabled="busy">{{ busy ? 'Creating…' : 'Create branch' }}</button>
        </div>
      </form>
    </ModalDialog>
  </div>
</template>
