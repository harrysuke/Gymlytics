<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { api, fetchBlobUrl } from '../../lib/api';
import { canFrontDesk, canManage, session } from '../../lib/auth';
import { age, date, dateTime, humanize, money, shortDate } from '../../lib/format';
import { describeError, notify } from '../../lib/toast';
import PageHeader from '../../components/PageHeader.vue';
import StatusBadge from '../../components/StatusBadge.vue';
import ModalDialog from '../../components/ModalDialog.vue';
import EmptyState from '../../components/EmptyState.vue';

const props = defineProps<{ id: string }>();

interface Detail {
  id: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  email: string | null;
  phone: string | null;
  role: string;
  status: string;
  dateOfBirth: string | null;
  notes: string | null;
  medicalNotes: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  pinHash: string | null;
  createdAt: string;
  attendanceCount: number;
  guardians: {
    linkId: string;
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    relationship: string;
    isPrimaryBilling: boolean;
    canSignWaivers: boolean;
  }[];
  dependents: {
    linkId: string;
    id: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string | null;
    canBookClasses: boolean;
    canSignWaivers: boolean;
  }[];
  memberships: {
    id: string;
    status: string;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    classesUsedInPeriod: number;
    planId: string;
    planName: string;
    planType: string;
    priceCents: number;
  }[];
  waivers: {
    id: string;
    waiverType: string;
    documentVersion: number;
    signedAt: string;
    status: string;
    expiresAt: string | null;
  }[];
  promotions: {
    id: string;
    promotedAt: string;
    toStripes: number;
    rankName: string;
    rankColor: string | null;
    programName: string;
  }[];
}

interface Plan {
  id: string;
  name: string;
  priceCents: number;
  planType: string;
}

const member = ref<Detail | null>(null);
const plans = ref<Plan[]>([]);
const loading = ref(true);

const pinOpen = ref(false);
const pin = ref('');
const planOpen = ref(false);
const selectedPlan = ref('');
const busy = ref(false);

const activeMembership = computed(
  () => member.value?.memberships.find((m) => ['active', 'trialing', 'past_due', 'frozen'].includes(m.status)) ?? null,
);

const latestWaiver = computed(() => member.value?.waivers[0] ?? null);

const waiverValid = computed(() => {
  const waiver = latestWaiver.value;
  if (!waiver || waiver.status !== 'signed') return false;
  if (!waiver.expiresAt) return true;
  return new Date(waiver.expiresAt) > new Date();
});

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [{ data }, planResponse] = await Promise.all([
      api.get<Detail>(`/v1/members/${props.id}`),
      api.get<Plan[]>('/v1/billing/plans'),
    ]);
    member.value = data;
    plans.value = planResponse.data.filter((plan) => plan.planType !== 'dropin_pack');
  } catch (error) {
    notify.error(describeError(error));
  } finally {
    loading.value = false;
  }
}

async function savePin(): Promise<void> {
  busy.value = true;
  try {
    await api.post(`/v1/members/${props.id}/pin`, { pin: pin.value.trim() });
    notify.success('Kiosk PIN updated');
    pinOpen.value = false;
    pin.value = '';
    await load();
  } catch (error) {
    notify.error(describeError(error));
  } finally {
    busy.value = false;
  }
}

async function setStatus(status: string): Promise<void> {
  busy.value = true;
  try {
    await api.patch(`/v1/members/${props.id}`, { status });
    notify.success(`Member marked ${humanize(status).toLowerCase()}`);
    await load();
  } catch (error) {
    notify.error(describeError(error));
  } finally {
    busy.value = false;
  }
}

async function addMembership(): Promise<void> {
  busy.value = true;
  try {
    await api.post('/v1/billing/memberships', {
      userId: props.id,
      planId: selectedPlan.value,
      provider: 'manual',
    });
    notify.success('Membership started');
    planOpen.value = false;
    selectedPlan.value = '';
    await load();
  } catch (error) {
    notify.error(describeError(error));
  } finally {
    busy.value = false;
  }
}

async function openWaiverPdf(waiverId: string): Promise<void> {
  try {
    const url = await fetchBlobUrl(`/v1/waivers/${waiverId}/pdf`);
    window.open(url, '_blank', 'noopener');
  } catch (error) {
    notify.error(describeError(error));
  }
}

onMounted(load);
</script>

<template>
  <div>
    <div v-if="loading" class="space-y-4">
      <div class="skeleton h-10 w-64" />
      <div class="skeleton h-40 w-full" />
    </div>

    <template v-else-if="member">
      <PageHeader
        :title="`${member.firstName} ${member.lastName}`"
        :subtitle="`${humanize(member.role)} · member since ${date(member.createdAt)}`"
      >
        <template #actions>
          <RouterLink to="/admin/members" class="btn-ghost">← All members</RouterLink>
          <RouterLink :to="`/admin/analytics/member/${member.id}`" class="btn-ghost">View analytics</RouterLink>
          <button v-if="canFrontDesk" class="btn-ghost" @click="pinOpen = true">Set kiosk PIN</button>
          <button v-if="canFrontDesk && !activeMembership" class="btn-primary" @click="planOpen = true">
            Start membership
          </button>
        </template>
      </PageHeader>

      <div class="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div class="space-y-6">
          <!-- Snapshot -->
          <section class="card-pad">
            <div class="flex flex-wrap items-start justify-between gap-4">
              <div class="flex items-center gap-4">
                <span class="grid h-16 w-16 place-items-center rounded-2xl bg-mat-100 font-display text-xl font-bold text-mat-700">
                  {{ member.firstName.charAt(0) }}{{ member.lastName.charAt(0) }}
                </span>
                <div>
                  <p class="font-display text-lg font-bold text-ink-900">
                    {{ member.firstName }} {{ member.lastName }}
                  </p>
                  <p class="text-sm text-ink-500">
                    <span v-if="age(member.dateOfBirth) !== null">{{ age(member.dateOfBirth) }} years · </span>
                    {{ member.email ?? 'no email' }}
                  </p>
                  <div class="mt-2 flex flex-wrap gap-2">
                    <StatusBadge :value="member.status" />
                    <StatusBadge v-if="activeMembership" :value="activeMembership.status" />
                    <span v-if="!waiverValid" class="chip bg-rose-50 text-rose-700 ring-1 ring-rose-600/15">Waiver missing</span>
                  </div>
                </div>
              </div>
              <div class="text-right">
                <p class="font-display text-2xl font-bold tabular text-ink-900">{{ member.attendanceCount }}</p>
                <p class="text-xs text-ink-500">classes attended</p>
              </div>
            </div>

            <dl class="mt-6 grid gap-4 border-t border-ink-100 pt-5 sm:grid-cols-3">
              <div>
                <dt class="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Phone</dt>
                <dd class="mt-0.5 text-sm text-ink-800">{{ member.phone ?? '—' }}</dd>
              </div>
              <div>
                <dt class="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Date of birth</dt>
                <dd class="mt-0.5 text-sm text-ink-800">{{ date(member.dateOfBirth) }}</dd>
              </div>
              <div>
                <dt class="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Kiosk PIN</dt>
                <dd class="mt-0.5 text-sm text-ink-800">{{ member.pinHash ? 'Configured' : 'Not set' }}</dd>
              </div>
              <div>
                <dt class="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Emergency contact</dt>
                <dd class="mt-0.5 text-sm text-ink-800">{{ member.emergencyContactName ?? '—' }}</dd>
              </div>
              <div>
                <dt class="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Emergency phone</dt>
                <dd class="mt-0.5 text-sm text-ink-800">{{ member.emergencyContactPhone ?? '—' }}</dd>
              </div>
              <div>
                <dt class="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Medical notes</dt>
                <dd class="mt-0.5 text-sm text-ink-800">{{ member.medicalNotes ?? '—' }}</dd>
              </div>
            </dl>

            <p v-if="member.notes" class="mt-4 rounded-xl bg-ink-50 p-3 text-sm text-ink-600">{{ member.notes }}</p>

            <div v-if="canFrontDesk" class="mt-5 flex flex-wrap gap-2 border-t border-ink-100 pt-4">
              <button class="btn-ghost btn-sm" :disabled="busy" @click="setStatus(member.status === 'active' ? 'inactive' : 'active')">
                {{ member.status === 'active' ? 'Deactivate' : 'Reactivate' }}
              </button>
              <RouterLink
                :to="{ name: 'waiver', query: { userId: member.id } }"
                class="btn-ghost btn-sm"
                target="_blank"
              >
                Sign a waiver
              </RouterLink>
            </div>
          </section>

          <!-- Memberships -->
          <section class="card">
            <header class="border-b border-ink-100 px-5 py-4">
              <h2 class="font-display text-base font-bold text-ink-900">Memberships</h2>
            </header>
            <div v-if="!member.memberships.length" class="p-5">
              <EmptyState title="No membership yet" body="Start a plan to unlock booking and billing." icon="🎟️" />
            </div>
            <ul v-else class="divide-y divide-ink-100">
              <li v-for="plan in member.memberships" :key="plan.id" class="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div>
                  <p class="text-sm font-semibold text-ink-900">{{ plan.planName }}</p>
                  <p class="text-xs text-ink-500">
                    {{ shortDate(plan.currentPeriodStart) }} → {{ shortDate(plan.currentPeriodEnd) }} ·
                    {{ plan.classesUsedInPeriod }} classes used
                  </p>
                </div>
                <div class="flex items-center gap-3">
                  <span class="text-sm font-semibold tabular text-ink-800">
                    {{ money(plan.priceCents, session.academy?.currency) }}
                  </span>
                  <StatusBadge :value="plan.status" />
                </div>
              </li>
            </ul>
          </section>

          <!-- Promotions -->
          <section class="card">
            <header class="flex items-center justify-between border-b border-ink-100 px-5 py-4">
              <h2 class="font-display text-base font-bold text-ink-900">Rank history</h2>
              <RouterLink to="/admin/promotions" class="text-xs font-semibold text-mat-700 hover:underline">
                Eligibility →
              </RouterLink>
            </header>
            <div v-if="!member.promotions.length" class="p-5">
              <EmptyState title="No promotions recorded" body="Promotions logged from the promotions page appear here." icon="🥋" />
            </div>
            <ol v-else class="divide-y divide-ink-100">
              <li v-for="promotion in member.promotions" :key="promotion.id" class="flex items-center gap-4 px-5 py-3">
                <span
                  class="h-8 w-2 rounded-full"
                  :style="{ backgroundColor: promotion.rankColor ?? '#94a3b8' }"
                />
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-semibold text-ink-900">
                    {{ promotion.rankName }}
                    <span v-if="promotion.toStripes" class="text-ink-500">· {{ promotion.toStripes }} stripes</span>
                  </p>
                  <p class="text-xs text-ink-500">{{ promotion.programName }}</p>
                </div>
                <span class="text-xs text-ink-500">{{ date(promotion.promotedAt) }}</span>
              </li>
            </ol>
          </section>
        </div>

        <!-- Sidebar -->
        <div class="space-y-6">
          <!-- Waivers -->
          <section class="card">
            <header class="flex items-center justify-between border-b border-ink-100 px-5 py-4">
              <h2 class="font-display text-base font-bold text-ink-900">Waivers</h2>
              <span
                class="chip"
                :class="waiverValid ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'"
              >
                {{ waiverValid ? 'On file' : 'Missing' }}
              </span>
            </header>
            <div v-if="!member.waivers.length" class="p-5 text-sm text-ink-500">
              No waiver on file — this member cannot check in from the kiosk.
            </div>
            <ul v-else class="divide-y divide-ink-100">
              <li v-for="waiver in member.waivers" :key="waiver.id" class="px-5 py-3">
                <div class="flex items-center justify-between gap-2">
                  <p class="text-sm font-semibold text-ink-900">{{ humanize(waiver.waiverType) }}</p>
                  <StatusBadge :value="waiver.status" />
                </div>
                <p class="mt-0.5 text-xs text-ink-500">
                  v{{ waiver.documentVersion }} · signed {{ date(waiver.signedAt) }}
                  <span v-if="waiver.expiresAt"> · expires {{ shortDate(waiver.expiresAt) }}</span>
                </p>
                <button class="mt-2 text-xs font-semibold text-mat-700 hover:underline" @click="openWaiverPdf(waiver.id)">
                  View signed PDF
                </button>
              </li>
            </ul>
          </section>

          <!-- Family -->
          <section class="card">
            <header class="border-b border-ink-100 px-5 py-4">
              <h2 class="font-display text-base font-bold text-ink-900">Family</h2>
            </header>
            <div class="space-y-4 p-5">
              <div>
                <p class="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Guardians</p>
                <ul v-if="member.guardians.length" class="mt-2 space-y-2">
                  <li v-for="guardian in member.guardians" :key="guardian.linkId" class="flex items-center justify-between gap-2">
                    <RouterLink :to="{ name: 'member-detail', params: { id: guardian.id } }" class="text-sm font-medium text-mat-700 hover:underline">
                      {{ guardian.firstName }} {{ guardian.lastName }}
                    </RouterLink>
                    <span class="text-xs text-ink-500">{{ humanize(guardian.relationship) }}</span>
                  </li>
                </ul>
                <p v-else class="mt-1 text-sm text-ink-400">None linked</p>
              </div>

              <div>
                <p class="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Dependents</p>
                <ul v-if="member.dependents.length" class="mt-2 space-y-2">
                  <li v-for="child in member.dependents" :key="child.linkId" class="flex items-center justify-between gap-2">
                    <RouterLink :to="{ name: 'member-detail', params: { id: child.id } }" class="text-sm font-medium text-mat-700 hover:underline">
                      {{ child.firstName }} {{ child.lastName }}
                    </RouterLink>
                    <span class="text-xs text-ink-500">{{ age(child.dateOfBirth) ?? '—' }} yrs</span>
                  </li>
                </ul>
                <p v-else class="mt-1 text-sm text-ink-400">None linked</p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </template>

    <!-- PIN modal -->
    <ModalDialog :open="pinOpen" title="Set kiosk PIN" description="Four to eight digits. Used for offline check-in at the front desk." @close="pinOpen = false">
      <label class="label" for="pin">New PIN</label>
      <input id="pin" v-model="pin" class="input font-mono text-lg tracking-[0.4em]" inputmode="numeric" maxlength="8" />
      <template #footer>
        <button class="btn-ghost" @click="pinOpen = false">Cancel</button>
        <button class="btn-primary" :disabled="busy || !/^\d{4,8}$/.test(pin)" @click="savePin">Save PIN</button>
      </template>
    </ModalDialog>

    <!-- Plan modal -->
    <ModalDialog :open="planOpen" title="Start a membership" description="Charges are recorded against the member's ledger." @close="planOpen = false">
      <label class="label" for="plan">Plan</label>
      <select id="plan" v-model="selectedPlan" class="input">
        <option value="">Select a plan…</option>
        <option v-for="plan in plans" :key="plan.id" :value="plan.id">
          {{ plan.name }} — {{ money(plan.priceCents, session.academy?.currency) }}
        </option>
      </select>
      <template #footer>
        <button class="btn-ghost" @click="planOpen = false">Cancel</button>
        <button class="btn-primary" :disabled="busy || !selectedPlan" @click="addMembership">Start plan</button>
      </template>
    </ModalDialog>
  </div>
</template>
