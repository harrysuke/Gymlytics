<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { api } from '../../lib/api';
import { canFrontDesk } from '../../lib/auth';
import { age, date, money, shortDate } from '../../lib/format';
import { describeError, notify } from '../../lib/toast';
import PageHeader from '../../components/PageHeader.vue';
import StatusBadge from '../../components/StatusBadge.vue';
import ModalDialog from '../../components/ModalDialog.vue';
import EmptyState from '../../components/EmptyState.vue';

interface MemberRow {
  id: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  email: string | null;
  phone: string | null;
  role: string;
  status: string;
  dateOfBirth: string | null;
  createdAt: string;
  membership: {
    id: string;
    status: string;
    periodEnd: string | null;
    planName: string | null;
    planType: string | null;
  } | null;
}

const PAGE_SIZE = 25;

const rows = ref<MemberRow[]>([]);
const total = ref(0);
const offset = ref(0);
const search = ref('');
const statusFilter = ref('');
const roleFilter = ref('');
const loading = ref(true);

const createOpen = ref(false);
const saving = ref(false);
const form = ref({
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  dateOfBirth: '',
  role: 'student',
  pin: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  notes: '',
});
const formError = ref<string | null>(null);

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));
const page = computed(() => Math.floor(offset.value / PAGE_SIZE) + 1);

let searchTimer: ReturnType<typeof setTimeout> | null = null;

async function load(): Promise<void> {
  loading.value = true;
  try {
    const { data, pagination } = await api.get<MemberRow[]>('/v1/members', {
      query: {
        limit: PAGE_SIZE,
        cursor: offset.value,
        q: search.value.trim() || undefined,
        status: statusFilter.value || undefined,
        role: roleFilter.value || undefined,
      },
    });
    rows.value = data;
    total.value = pagination?.total ?? data.length;
  } catch (error) {
    notify.error(describeError(error));
  } finally {
    loading.value = false;
  }
}

watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    offset.value = 0;
    void load();
  }, 250);
});

watch([statusFilter, roleFilter], () => {
  offset.value = 0;
  void load();
});

function go(next: number): void {
  offset.value = (next - 1) * PAGE_SIZE;
  void load();
}

async function createMember(): Promise<void> {
  saving.value = true;
  formError.value = null;
  try {
    const payload: Record<string, unknown> = {
      firstName: form.value.firstName.trim(),
      lastName: form.value.lastName.trim(),
      role: form.value.role,
    };
    if (form.value.email.trim()) payload.email = form.value.email.trim();
    if (form.value.phone.trim()) payload.phone = form.value.phone.trim();
    if (form.value.dateOfBirth) payload.dateOfBirth = form.value.dateOfBirth;
    if (form.value.pin.trim()) payload.pin = form.value.pin.trim();
    if (form.value.emergencyContactName.trim()) payload.emergencyContactName = form.value.emergencyContactName.trim();
    if (form.value.emergencyContactPhone.trim()) payload.emergencyContactPhone = form.value.emergencyContactPhone.trim();
    if (form.value.notes.trim()) payload.notes = form.value.notes.trim();

    await api.post('/v1/members', payload);
    notify.success(`${form.value.firstName} added to the roster`);
    createOpen.value = false;
    form.value = {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      dateOfBirth: '',
      role: 'student',
      pin: '',
      emergencyContactName: '',
      emergencyContactPhone: '',
      notes: '',
    };
    await load();
  } catch (error) {
    formError.value = describeError(error);
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <PageHeader
      title="Members"
      :subtitle="`${total} people on the roster`"
      :action-label="canFrontDesk ? 'Add member' : undefined"
      @action="createOpen = true"
    />

    <!-- Filters -->
    <div class="card mb-4 flex flex-wrap items-center gap-3 p-3">
      <div class="relative min-w-[220px] flex-1">
        <svg class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" stroke-linecap="round" />
        </svg>
        <input v-model="search" class="input pl-9" placeholder="Search name, email or phone" />
      </div>
      <select v-model="statusFilter" class="input w-auto">
        <option value="">All statuses</option>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
        <option value="frozen">Frozen</option>
        <option value="pending_waiver">Pending waiver</option>
      </select>
      <select v-model="roleFilter" class="input w-auto">
        <option value="">All roles</option>
        <option value="student">Student</option>
        <option value="guardian">Guardian</option>
        <option value="coach">Coach</option>
        <option value="staff">Staff</option>
        <option value="dropin">Drop-in</option>
      </select>
    </div>

    <!-- Table -->
    <div class="card overflow-hidden">
      <div v-if="loading" class="space-y-2 p-4">
        <div v-for="n in 6" :key="n" class="skeleton h-12 w-full" />
      </div>

      <EmptyState
        v-else-if="!rows.length"
        title="No members match"
        body="Try a different search term or clear the filters."
        icon="🔍"
      />

      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[720px]">
          <thead class="border-b border-ink-100 bg-ink-50/60">
            <tr>
              <th class="th">Member</th>
              <th class="th">Contact</th>
              <th class="th">Membership</th>
              <th class="th">Status</th>
              <th class="th">Joined</th>
              <th class="th" />
            </tr>
          </thead>
          <tbody class="divide-y divide-ink-100">
            <tr v-for="member in rows" :key="member.id" class="row-hover">
              <td class="td">
                <div class="flex items-center gap-3">
                  <span class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-mat-100 text-xs font-bold text-mat-700">
                    {{ member.firstName.charAt(0) }}{{ member.lastName.charAt(0) }}
                  </span>
                  <div class="min-w-0">
                    <p class="truncate font-semibold text-ink-900">
                      {{ member.firstName }} {{ member.lastName }}
                    </p>
                    <p class="truncate text-xs capitalize text-ink-500">
                      {{ member.role }}
                      <span v-if="age(member.dateOfBirth) !== null"> · {{ age(member.dateOfBirth) }} yrs</span>
                    </p>
                  </div>
                </div>
              </td>
              <td class="td">
                <p class="truncate text-xs">{{ member.email ?? '—' }}</p>
                <p class="truncate text-xs text-ink-400">{{ member.phone ?? '—' }}</p>
              </td>
              <td class="td">
                <template v-if="member.membership">
                  <p class="text-xs font-semibold text-ink-800">{{ member.membership.planName ?? 'Plan' }}</p>
                  <p class="text-xs text-ink-500">
                    <StatusBadge :value="member.membership.status" />
                    <span v-if="member.membership.periodEnd" class="ml-1.5">
                      renews {{ shortDate(member.membership.periodEnd) }}
                    </span>
                  </p>
                </template>
                <span v-else class="text-xs text-ink-400">No active plan</span>
              </td>
              <td class="td"><StatusBadge :value="member.status" /></td>
              <td class="td text-xs text-ink-500">{{ date(member.createdAt) }}</td>
              <td class="td text-right">
                <RouterLink
                  :to="{ name: 'member-detail', params: { id: member.id } }"
                  class="btn-ghost btn-sm"
                >
                  Open
                </RouterLink>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <footer v-if="!loading && total > PAGE_SIZE" class="flex items-center justify-between border-t border-ink-100 px-4 py-3">
        <p class="text-xs text-ink-500">Page {{ page }} of {{ pageCount }}</p>
        <div class="flex gap-2">
          <button class="btn-ghost btn-sm" :disabled="page <= 1" @click="go(page - 1)">Previous</button>
          <button class="btn-ghost btn-sm" :disabled="page >= pageCount" @click="go(page + 1)">Next</button>
        </div>
      </footer>
    </div>

    <!-- Create -->
    <ModalDialog
      :open="createOpen"
      title="Add a member"
      description="Creates a profile. Waivers and memberships are added from the member page."
      width="max-w-2xl"
      @close="createOpen = false"
    >
      <form id="create-member" class="grid gap-4 sm:grid-cols-2" @submit.prevent="createMember">
        <div>
          <label class="label" for="first">First name</label>
          <input id="first" v-model="form.firstName" class="input" required />
        </div>
        <div>
          <label class="label" for="last">Last name</label>
          <input id="last" v-model="form.lastName" class="input" required />
        </div>
        <div>
          <label class="label" for="email">Email</label>
          <input id="email" v-model="form.email" class="input" type="email" />
        </div>
        <div>
          <label class="label" for="phone">Phone</label>
          <input id="phone" v-model="form.phone" class="input" />
        </div>
        <div>
          <label class="label" for="dob">Date of birth</label>
          <input id="dob" v-model="form.dateOfBirth" class="input" type="date" />
        </div>
        <div>
          <label class="label" for="role">Role</label>
          <select id="role" v-model="form.role" class="input">
            <option value="student">Student</option>
            <option value="guardian">Guardian</option>
            <option value="coach">Coach</option>
            <option value="staff">Staff</option>
            <option value="dropin">Drop-in</option>
          </select>
        </div>
        <div>
          <label class="label" for="pin">Kiosk PIN <span class="font-normal normal-case text-ink-400">(4–8 digits)</span></label>
          <input id="pin" v-model="form.pin" class="input font-mono" inputmode="numeric" maxlength="8" placeholder="e.g. 4821" />
        </div>
        <div>
          <label class="label" for="ecn">Emergency contact</label>
          <input id="ecn" v-model="form.emergencyContactName" class="input" />
        </div>
        <div class="sm:col-span-2">
          <label class="label" for="ecp">Emergency phone</label>
          <input id="ecp" v-model="form.emergencyContactPhone" class="input" />
        </div>
        <div class="sm:col-span-2">
          <label class="label" for="notes">Notes</label>
          <textarea id="notes" v-model="form.notes" class="input" rows="2" placeholder="Injuries, prior experience, anything the coaches should know" />
        </div>

        <p v-if="formError" class="sm:col-span-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {{ formError }}
        </p>
      </form>

      <template #footer>
        <button class="btn-ghost" @click="createOpen = false">Cancel</button>
        <button class="btn-primary" form="create-member" type="submit" :disabled="saving">
          {{ saving ? 'Saving…' : 'Add member' }}
        </button>
      </template>
    </ModalDialog>
  </div>
</template>
