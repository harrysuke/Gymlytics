<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { api } from '../../lib/api';
import { canFrontDesk, canManage, session } from '../../lib/auth';
import { date, money, shortDate } from '../../lib/format';
import { describeError, notify } from '../../lib/toast';
import PageHeader from '../../components/PageHeader.vue';
import StatusBadge from '../../components/StatusBadge.vue';
import ModalDialog from '../../components/ModalDialog.vue';
import EmptyState from '../../components/EmptyState.vue';

interface Plan {
  id: string;
  name: string;
  planType: string;
  billingInterval: string;
  priceCents: number;
  currency: string;
  classesPerWeek: number | null;
  classPackCount: number | null;
  freezeAllowed: boolean;
  isActive: boolean;
}

interface MembershipRow {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  classesUsedInPeriod: number;
  freezeUntil: string | null;
  planId: string;
  planName: string;
  planType: string;
  priceCents: number;
  currency: string;
}

interface TransactionRow {
  id: string;
  type: string;
  status: string;
  totalCents: number;
  currency: string;
  provider: string | null;
  createdAt: string;
  userId: string | null;
  firstName: string | null;
  lastName: string | null;
}

type Tab = 'memberships' | 'plans' | 'transactions';

const tab = ref<Tab>('memberships');
const plans = ref<Plan[]>([]);
const memberships = ref<MembershipRow[]>([]);
const transactions = ref<TransactionRow[]>([]);
const statusFilter = ref('');
const loading = ref(true);

const freezeOpen = ref(false);
const freezeTarget = ref<MembershipRow | null>(null);
const freezeDays = ref(14);
const freezeReason = ref('');
const busy = ref(false);

const planOpen = ref(false);
const newPlan = ref({
  name: '',
  planType: 'unlimited',
  billingInterval: 'monthly',
  price: 0,
  classesPerWeek: 2,
  classPackCount: 10,
  freezeAllowed: true,
});

const mrr = computed(() =>
  memberships.value
    .filter((row) => ['active', 'trialing'].includes(row.status))
    .reduce((sum, row) => {
      if (row.planType === 'class_pack') return sum;
      return sum + row.priceCents;
    }, 0),
);

const pastDue = computed(() => memberships.value.filter((row) => row.status === 'past_due'));

const filteredMemberships = computed(() =>
  statusFilter.value ? memberships.value.filter((row) => row.status === statusFilter.value) : memberships.value,
);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [planResponse, membershipResponse, transactionResponse] = await Promise.all([
      api.get<Plan[]>('/v1/billing/plans'),
      api.get<MembershipRow[]>('/v1/billing/memberships'),
      api.get<TransactionRow[]>('/v1/billing/transactions'),
    ]);
    plans.value = planResponse.data;
    memberships.value = membershipResponse.data;
    transactions.value = transactionResponse.data;
  } catch (error) {
    notify.error(describeError(error));
  } finally {
    loading.value = false;
  }
}

function openFreeze(row: MembershipRow): void {
  freezeTarget.value = row;
  freezeDays.value = 14;
  freezeReason.value = '';
  freezeOpen.value = true;
}

async function freeze(): Promise<void> {
  if (!freezeTarget.value) return;
  busy.value = true;
  try {
    await api.post(`/v1/billing/memberships/${freezeTarget.value.id}/freeze`, {
      days: Number(freezeDays.value),
      ...(freezeReason.value.trim() ? { reason: freezeReason.value.trim() } : {}),
    });
    notify.success(`Membership frozen for ${freezeDays.value} days`);
    freezeOpen.value = false;
    await load();
  } catch (error) {
    notify.error(describeError(error));
  } finally {
    busy.value = false;
  }
}

async function unfreeze(row: MembershipRow): Promise<void> {
  try {
    await api.post(`/v1/billing/memberships/${row.id}/unfreeze`, {});
    notify.success('Membership resumed');
    await load();
  } catch (error) {
    notify.error(describeError(error));
  }
}

async function cancel(row: MembershipRow): Promise<void> {
  if (!window.confirm(`Cancel ${row.firstName}'s ${row.planName} membership?`)) return;
  const allowed = ['too_expensive', 'relocated', 'time_constraints', 'injury', 'switched_gym', 'dissatisfied', 'other'];
  const answer = window.prompt('Cancellation reason for churn reporting?', 'other');
  const reason = answer && allowed.includes(answer) ? answer : 'other';
  try {
    await api.post(`/v1/billing/memberships/${row.id}/cancel`, { reason });
    notify.success('Membership cancelled');
    await load();
  } catch (error) {
    notify.error(describeError(error));
  }
}

async function createPlan(): Promise<void> {
  busy.value = true;
  try {
    const payload: Record<string, unknown> = {
      name: newPlan.value.name.trim(),
      planType: newPlan.value.planType,
      billingInterval: newPlan.value.billingInterval,
      priceCents: Math.round(Number(newPlan.value.price) * 100),
      currency: session.academy?.currency ?? 'MYR',
      freezeAllowed: newPlan.value.freezeAllowed,
    };
    if (newPlan.value.planType === 'weekly_limit') payload.classesPerWeek = Number(newPlan.value.classesPerWeek);
    if (newPlan.value.planType === 'class_pack') payload.classPackCount = Number(newPlan.value.classPackCount);
    await api.post('/v1/billing/plans', payload);
    notify.success('Plan created');
    planOpen.value = false;
    newPlan.value.name = '';
    newPlan.value.price = 0;
    await load();
  } catch (error) {
    notify.error(describeError(error));
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <PageHeader title="Billing" subtitle="Plans, memberships and the money ledger." :action-label="canManage && tab === 'plans' ? 'New plan' : undefined" @action="planOpen = true">
      <template #actions>
        <RouterLink v-if="canFrontDesk" to="/admin/pos" class="btn-ghost">Point of sale →</RouterLink>
      </template>
    </PageHeader>

    <div class="mb-4 grid gap-3 sm:grid-cols-3">
      <div class="card-pad">
        <p class="text-xs font-semibold uppercase tracking-wide text-ink-500">Recurring revenue</p>
        <p class="mt-2 font-display text-2xl font-bold tabular text-ink-900">{{ money(mrr, session.academy?.currency) }}</p>
        <p class="mt-1 text-xs text-ink-500">per month, excluding class packs</p>
      </div>
      <div class="card-pad">
        <p class="text-xs font-semibold uppercase tracking-wide text-ink-500">Active memberships</p>
        <p class="mt-2 font-display text-2xl font-bold tabular text-ink-900">
          {{ memberships.filter((m) => ['active', 'trialing'].includes(m.status)).length }}
        </p>
      </div>
      <div class="card-pad">
        <p class="text-xs font-semibold uppercase tracking-wide text-ink-500">Past due</p>
        <p class="mt-2 font-display text-2xl font-bold tabular" :class="pastDue.length ? 'text-amber-600' : 'text-emerald-600'">
          {{ pastDue.length }}
        </p>
        <p class="mt-1 text-xs text-ink-500">dunning retries scheduled automatically</p>
      </div>
    </div>

    <!-- Tabs -->
    <div class="mb-4 flex gap-1 rounded-xl bg-ink-200/50 p-1">
      <button
        v-for="entry in [
          { key: 'memberships', label: 'Memberships' },
          { key: 'plans', label: 'Plans' },
          { key: 'transactions', label: 'Transactions' },
        ]"
        :key="entry.key"
        class="flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition"
        :class="tab === entry.key ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-700'"
        @click="tab = entry.key as Tab"
      >
        {{ entry.label }}
      </button>
    </div>

    <!-- Memberships -->
    <div v-if="tab === 'memberships'" class="card overflow-hidden">
      <header class="flex items-center justify-between border-b border-ink-100 px-4 py-3">
        <h2 class="text-sm font-semibold text-ink-900">All memberships</h2>
        <select v-model="statusFilter" class="input w-auto">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="past_due">Past due</option>
          <option value="frozen">Frozen</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </header>

      <div v-if="loading" class="space-y-2 p-4">
        <div v-for="n in 6" :key="n" class="skeleton h-12 w-full" />
      </div>

      <EmptyState v-else-if="!filteredMemberships.length" title="No memberships" body="Start a plan from a member's profile." icon="🎟️" />

      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[820px]">
          <thead class="border-b border-ink-100 bg-ink-50/60">
            <tr>
              <th class="th">Member</th>
              <th class="th">Plan</th>
              <th class="th">Price</th>
              <th class="th">Period</th>
              <th class="th">Used</th>
              <th class="th">Status</th>
              <th class="th" />
            </tr>
          </thead>
          <tbody class="divide-y divide-ink-100">
            <tr v-for="row in filteredMemberships" :key="row.id" class="row-hover">
              <td class="td">
                <RouterLink :to="{ name: 'member-detail', params: { id: row.userId } }" class="font-medium text-mat-700 hover:underline">
                  {{ row.firstName }} {{ row.lastName }}
                </RouterLink>
              </td>
              <td class="td text-xs">{{ row.planName }}</td>
              <td class="td text-sm font-semibold tabular">{{ money(row.priceCents, row.currency) }}</td>
              <td class="td text-xs text-ink-500">
                {{ shortDate(row.currentPeriodStart) }} → {{ shortDate(row.currentPeriodEnd) }}
                <p v-if="row.freezeUntil" class="text-amber-600">frozen until {{ shortDate(row.freezeUntil) }}</p>
              </td>
              <td class="td text-xs tabular">{{ row.classesUsedInPeriod }}</td>
              <td class="td"><StatusBadge :value="row.status" /></td>
              <td class="td text-right">
                <div v-if="canFrontDesk" class="flex justify-end gap-1">
                  <button
                    v-if="row.status === 'active' || row.status === 'past_due'"
                    class="btn-ghost btn-sm"
                    @click="openFreeze(row)"
                  >
                    Freeze
                  </button>
                  <button v-if="row.status === 'frozen'" class="btn-ghost btn-sm" @click="unfreeze(row)">Resume</button>
                  <button
                    v-if="!['cancelled'].includes(row.status)"
                    class="btn-danger btn-sm"
                    @click="cancel(row)"
                  >
                    Cancel
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Plans -->
    <div v-else-if="tab === 'plans'" class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <div v-for="plan in plans" :key="plan.id" class="card-pad flex flex-col">
        <div class="flex items-start justify-between">
          <h3 class="font-display text-base font-bold text-ink-900">{{ plan.name }}</h3>
          <StatusBadge :value="plan.isActive ? 'active' : 'inactive'" />
        </div>
        <p class="mt-3 font-display text-2xl font-bold tabular text-mat-700">
          {{ money(plan.priceCents, plan.currency) }}
          <span class="text-xs font-medium text-ink-400">/ {{ plan.billingInterval }}</span>
        </p>
        <dl class="mt-4 space-y-1 text-xs text-ink-500">
          <div class="flex justify-between"><dt>Type</dt><dd class="font-medium text-ink-700">{{ plan.planType.replace(/_/g, ' ') }}</dd></div>
          <div v-if="plan.classesPerWeek" class="flex justify-between"><dt>Classes</dt><dd class="font-medium text-ink-700">{{ plan.classesPerWeek }} / week</dd></div>
          <div v-if="plan.classPackCount" class="flex justify-between"><dt>Pack size</dt><dd class="font-medium text-ink-700">{{ plan.classPackCount }} classes</dd></div>
          <div class="flex justify-between"><dt>Freeze</dt><dd class="font-medium text-ink-700">{{ plan.freezeAllowed ? 'Allowed' : 'Not allowed' }}</dd></div>
        </dl>
        <p class="mt-4 text-xs text-ink-400">
          {{ memberships.filter((m) => m.planId === plan.id && m.status === 'active').length }} active members
        </p>
      </div>
    </div>

    <!-- Transactions -->
    <div v-else class="card overflow-hidden">
      <div v-if="loading" class="space-y-2 p-4">
        <div v-for="n in 6" :key="n" class="skeleton h-12 w-full" />
      </div>
      <EmptyState v-else-if="!transactions.length" title="No transactions yet" body="Membership charges and retail sales land here." icon="🧾" />
      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[680px]">
          <thead class="border-b border-ink-100 bg-ink-50/60">
            <tr>
              <th class="th">Date</th>
              <th class="th">Type</th>
              <th class="th">Member</th>
              <th class="th">Provider</th>
              <th class="th">Amount</th>
              <th class="th">Status</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-ink-100">
            <tr v-for="row in transactions" :key="row.id" class="row-hover">
              <td class="td text-xs text-ink-500">{{ date(row.createdAt) }}</td>
              <td class="td text-xs capitalize">{{ row.type }}</td>
              <td class="td text-xs">
                <RouterLink v-if="row.userId" :to="{ name: 'member-detail', params: { id: row.userId } }" class="text-mat-700 hover:underline">
                  {{ row.firstName }} {{ row.lastName }}
                </RouterLink>
                <span v-else class="text-ink-400">Walk-in</span>
              </td>
              <td class="td text-xs capitalize text-ink-500">{{ row.provider ?? '—' }}</td>
              <td class="td text-sm font-semibold tabular">{{ money(row.totalCents, row.currency) }}</td>
              <td class="td"><StatusBadge :value="row.status" /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Freeze modal -->
    <ModalDialog :open="freezeOpen" title="Freeze membership" :description="freezeTarget ? `${freezeTarget.firstName} ${freezeTarget.lastName} · ${freezeTarget.planName}` : ''" @close="freezeOpen = false">
      <div class="space-y-4">
        <div>
          <label class="label" for="days">Days to freeze</label>
          <input id="days" v-model.number="freezeDays" class="input" type="number" min="1" max="180" />
        </div>
        <div>
          <label class="label" for="reason">Reason</label>
          <input id="reason" v-model="freezeReason" class="input" placeholder="Injury, travel, school…" />
        </div>
        <p class="rounded-xl bg-ink-50 p-3 text-xs text-ink-600">
          The billing period is extended by the frozen days when the membership resumes.
        </p>
      </div>
      <template #footer>
        <button class="btn-ghost" @click="freezeOpen = false">Cancel</button>
        <button class="btn-primary" :disabled="busy" @click="freeze">{{ busy ? 'Freezing…' : 'Freeze' }}</button>
      </template>
    </ModalDialog>

    <!-- New plan -->
    <ModalDialog :open="planOpen" title="New plan" description="Plans drive entitlements: how many classes a member can book per week." width="max-w-xl" @close="planOpen = false">
      <form id="new-plan" class="grid gap-4 sm:grid-cols-2" @submit.prevent="createPlan">
        <div class="sm:col-span-2">
          <label class="label" for="p-name">Name</label>
          <input id="p-name" v-model="newPlan.name" class="input" placeholder="e.g. 3x per week" required />
        </div>
        <div>
          <label class="label" for="p-type">Plan type</label>
          <select id="p-type" v-model="newPlan.planType" class="input">
            <option value="unlimited">Unlimited</option>
            <option value="weekly_limit">Weekly limit</option>
            <option value="class_pack">Class pack</option>
            <option value="dropin_pack">Drop-in pack</option>
            <option value="family">Family</option>
          </select>
        </div>
        <div>
          <label class="label" for="p-interval">Billing interval</label>
          <select id="p-interval" v-model="newPlan.billingInterval" class="input">
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="annual">Annual</option>
            <option value="one_time">One time</option>
          </select>
        </div>
        <div>
          <label class="label" for="p-price">Price</label>
          <input id="p-price" v-model.number="newPlan.price" class="input" type="number" min="0" step="0.01" required />
        </div>
        <div v-if="newPlan.planType === 'weekly_limit'">
          <label class="label" for="p-week">Classes per week</label>
          <input id="p-week" v-model.number="newPlan.classesPerWeek" class="input" type="number" min="1" max="21" />
        </div>
        <div v-if="newPlan.planType === 'class_pack'">
          <label class="label" for="p-pack">Classes in pack</label>
          <input id="p-pack" v-model.number="newPlan.classPackCount" class="input" type="number" min="1" max="500" />
        </div>
        <label class="flex items-center gap-2 text-sm text-ink-600 sm:col-span-2">
          <input v-model="newPlan.freezeAllowed" type="checkbox" class="accent-mat-600" />
          Allow members to freeze this plan
        </label>
      </form>
      <template #footer>
        <button class="btn-ghost" @click="planOpen = false">Cancel</button>
        <button class="btn-primary" form="new-plan" type="submit" :disabled="busy">Create plan</button>
      </template>
    </ModalDialog>
  </div>
</template>
