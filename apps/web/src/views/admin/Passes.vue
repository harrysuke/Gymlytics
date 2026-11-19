<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api } from '../../lib/api';
import { canManage } from '../../lib/auth';
import { date, shortDate } from '../../lib/format';
import { describeError, notify } from '../../lib/toast';
import PageHeader from '../../components/PageHeader.vue';
import ModalDialog from '../../components/ModalDialog.vue';
import EmptyState from '../../components/EmptyState.vue';

interface Affiliation {
  id: string;
  name: string;
  contactEmail: string | null;
  verificationCode: string;
  verifiedAt: string | null;
}
interface Pass {
  id: string;
  userId: string;
  visitorName: string;
  affiliationName: string | null;
  passDate: string;
  status: string;
  qrToken: string;
  waiverId: string | null;
}
interface ClassRow { id: string; title: string; startsAt: string }
interface PublicPass {
  visitorName: string;
  affiliationName: string | null;
  status: string;
  waiverRequired: boolean;
  waiverSignUrl: string | null;
}

const affiliations = ref<Affiliation[]>([]);
const passes = ref<Pass[]>([]);
const classes = ref<ClassRow[]>([]);
const error = ref<string | null>(null);
const open = ref(false);
const busy = ref(false);
const selected = ref<Pass | null>(null);
const publicPass = ref<PublicPass | null>(null);
const checkInClass = ref('');
const affiliationForm = reactive({ name: '', contactEmail: '' });
const passForm = reactive({ visitorId: '', affiliationId: '', passDate: new Date().toISOString().slice(0, 10) });

async function load(): Promise<void> {
  try {
    const [affRows, passRows, classRows] = await Promise.all([
      api.get<Affiliation[]>('/v1/affiliations'),
      api.get<Pass[]>('/v1/passes'),
      api.get<ClassRow[]>('/v1/classes?limit=100'),
    ]);
    affiliations.value = affRows.data;
    passes.value = passRows.data;
    classes.value = classRows.data;
  } catch (caught) {
    error.value = describeError(caught);
  }
}

async function addAffiliation(): Promise<void> {
  busy.value = true;
  try {
    await api.post('/v1/affiliations', {
      name: affiliationForm.name,
      ...(affiliationForm.contactEmail ? { contactEmail: affiliationForm.contactEmail } : {}),
    });
    affiliationForm.name = '';
    affiliationForm.contactEmail = '';
    notify.success('Affiliation created — verify it before issuing passes');
    await load();
  } catch (caught) {
    notify.error(describeError(caught));
  } finally {
    busy.value = false;
  }
}

async function verify(id: string): Promise<void> {
  try {
    await api.post(`/v1/affiliations/${id}/verify`);
    await load();
  } catch (caught) {
    notify.error(describeError(caught));
  }
}

async function inspect(pass: Pass): Promise<void> {
  selected.value = pass;
  publicPass.value = null;
  try {
    publicPass.value = (await api.get<PublicPass>(`/v1/passes/public/${pass.qrToken}`, { anonymous: true })).data;
  } catch (caught) {
    notify.error(describeError(caught));
  }
}

async function checkIn(): Promise<void> {
  if (!selected.value || !checkInClass.value) return;
  busy.value = true;
  try {
    await api.post(`/v1/passes/${selected.value.id}/check-in`, {
      classId: checkInClass.value,
      mutationId: crypto.randomUUID(),
      hlc: `${new Date().toISOString()}-0000-web-console`,
      deviceId: 'web-console',
      checkedInAt: new Date().toISOString(),
    });
    notify.success('Visitor checked in');
    selected.value = null;
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
    <PageHeader title="Drop-in & cross-training" subtitle="Verify visiting academies, issue QR passes and gate mat access on a signed waiver." />

    <div v-if="error" class="card border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
      {{ error }} — <RouterLink class="underline" to="/admin/plan">upgrade your plan</RouterLink> for cross-training.
    </div>

    <div class="grid gap-6 lg:grid-cols-2">
      <section class="card overflow-hidden">
        <div class="border-b border-ink-100 px-5 py-4">
          <h2 class="font-display text-lg font-bold text-ink-900">Trusted affiliations</h2>
        </div>
        <div v-if="canManage" class="flex flex-wrap gap-2 border-b border-ink-100 bg-ink-50 p-4">
          <input v-model="affiliationForm.name" class="input min-w-40 flex-1" placeholder="Academy name" />
          <input v-model="affiliationForm.contactEmail" class="input min-w-40 flex-1" placeholder="Contact email" />
          <button class="btn-primary" type="button" :disabled="busy || !affiliationForm.name" @click="addAffiliation">Add</button>
        </div>
        <div v-if="affiliations.length" class="divide-y divide-ink-100">
          <div v-for="row in affiliations" :key="row.id" class="flex items-center gap-3 p-4">
            <div class="min-w-0 flex-1">
              <p class="font-semibold text-ink-900">{{ row.name }}</p>
              <p class="font-mono text-xs text-ink-500">{{ row.verificationCode }}</p>
            </div>
            <span class="chip" :class="row.verifiedAt ? 'text-emerald-700' : 'text-amber-700'">
              {{ row.verifiedAt ? 'Verified' : 'Pending' }}
            </span>
            <button v-if="!row.verifiedAt" class="btn-ghost" type="button" @click="verify(row.id)">Verify</button>
          </div>
        </div>
        <EmptyState v-else title="No affiliations" message="Add neighbouring academies you trust." />
      </section>

      <section class="card overflow-hidden">
        <div class="border-b border-ink-100 px-5 py-4">
          <h2 class="font-display text-lg font-bold text-ink-900">Visitor passes</h2>
        </div>
        <div v-if="passes.length" class="divide-y divide-ink-100">
          <button v-for="pass in passes" :key="pass.id" class="block w-full p-4 text-left hover:bg-ink-50" type="button" @click="inspect(pass)">
            <div class="flex items-center gap-3">
              <div class="min-w-0 flex-1">
                <p class="font-semibold text-ink-900">{{ pass.visitorName }}</p>
                <p class="text-xs text-ink-500">{{ pass.affiliationName ?? 'Independent visitor' }} · {{ shortDate(pass.passDate) }}</p>
              </div>
              <span class="chip capitalize">{{ pass.status }}</span>
            </div>
          </button>
        </div>
        <EmptyState v-else title="No passes issued" message="Issue a QR pass from the kiosk or member profile." />
      </section>
    </div>

    <ModalDialog :open="Boolean(selected)" title="Visitor pass" @close="selected = null">
      <div v-if="selected && publicPass" class="space-y-4">
        <div class="rounded-xl bg-ink-50 p-4">
          <p class="font-display text-xl font-bold text-ink-900">{{ publicPass.visitorName }}</p>
          <p class="text-sm text-ink-500">{{ publicPass.affiliationName ?? 'Independent visitor' }} · {{ date(selected.passDate) }}</p>
          <div class="mt-3 flex items-center gap-3">
            <span class="chip capitalize">{{ publicPass.status }}</span>
            <span class="chip" :class="publicPass.waiverRequired ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'">
              {{ publicPass.waiverRequired ? 'Waiver required' : 'Waiver on file' }}
            </span>
          </div>
        </div>
        <a v-if="publicPass.waiverSignUrl" class="btn-ghost" :href="publicPass.waiverSignUrl">Open waiver link</a>
        <div>
          <label class="label" for="pass-class">Check in to class</label>
          <select id="pass-class" v-model="checkInClass" class="input">
            <option value="">Choose a class…</option>
            <option v-for="row in classes" :key="row.id" :value="row.id">{{ row.title }} · {{ date(row.startsAt) }}</option>
          </select>
        </div>
        <button class="btn-primary w-full" type="button" :disabled="busy || !checkInClass || publicPass.waiverRequired" @click="checkIn">
          {{ busy ? 'Checking in…' : 'Check in visitor' }}
        </button>
        <p v-if="publicPass.waiverRequired" class="text-xs text-rose-600">
          A signed waiver must be captured before mat access is granted.
        </p>
      </div>
    </ModalDialog>
  </div>
</template>
