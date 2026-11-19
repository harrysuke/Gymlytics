<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../lib/api';
import { canCoach, canFrontDesk } from '../../lib/auth';
import { addDays, dateTime, humanize, isoDay, startOfWeek, time } from '../../lib/format';
import { describeError, notify } from '../../lib/toast';
import PageHeader from '../../components/PageHeader.vue';
import ModalDialog from '../../components/ModalDialog.vue';
import StatusBadge from '../../components/StatusBadge.vue';
import EmptyState from '../../components/EmptyState.vue';

interface ClassRow {
  id: string;
  programId: string;
  programName: string;
  discipline: string;
  coachName: string | null;
  title: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  bookedCount: number;
  checkedInCount: number;
  location: string | null;
  status: string;
  spotsLeft: number;
}

interface Program {
  id: string;
  name: string;
  discipline: string;
}

interface RosterEntry {
  bookingId: string;
  bookingStatus: string;
  userId: string;
  firstName: string;
  lastName: string;
  role: string;
  attendanceId: string | null;
  attendanceStatus: string | null;
  checkedInAt: string | null;
}

interface ClassDetail extends ClassRow {
  programDiscipline: string;
  roster: RosterEntry[];
  techniques: { id: string; name: string; category: string | null }[];
}

const weekStart = ref(startOfWeek(new Date()));
const classes = ref<ClassRow[]>([]);
const programs = ref<Program[]>([]);
const programFilter = ref('');
const loading = ref(true);

const detailOpen = ref(false);
const detail = ref<ClassDetail | null>(null);
const detailLoading = ref(false);

const createOpen = ref(false);
const saving = ref(false);
const form = ref({ programId: '', title: '', startsAt: '', endsAt: '', capacity: 20, location: '', coachId: '' });

const days = computed(() =>
  Array.from({ length: 7 }, (_, index) => {
    const value = addDays(weekStart.value, index);
    return {
      iso: isoDay(value),
      label: value.toLocaleDateString(undefined, { weekday: 'short' }),
      dayNumber: value.getDate(),
      isToday: isoDay(value) === isoDay(new Date()),
    };
  }),
);

const byDay = computed(() => {
  const map = new Map<string, ClassRow[]>();
  for (const day of days.value) map.set(day.iso, []);
  for (const item of classes.value) {
    const key = isoDay(new Date(item.startsAt));
    map.get(key)?.push(item);
  }
  for (const list of map.values()) list.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return map;
});

const weekLabel = computed(() => {
  const end = addDays(weekStart.value, 6);
  return `${weekStart.value.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
});

async function load(): Promise<void> {
  loading.value = true;
  try {
    const from = addDays(weekStart.value, 0);
    const to = addDays(weekStart.value, 7);
    const [{ data }, programResponse] = await Promise.all([
      api.get<ClassRow[]>('/v1/classes', {
        query: {
          from: from.toISOString(),
          to: to.toISOString(),
          programId: programFilter.value || undefined,
          limit: 200,
        },
      }),
      api.get<Program[]>('/v1/programs'),
    ]);
    classes.value = data;
    programs.value = programResponse.data;
  } catch (error) {
    notify.error(describeError(error));
  } finally {
    loading.value = false;
  }
}

function shiftWeek(delta: number): void {
  weekStart.value = addDays(weekStart.value, delta * 7);
  void load();
}

async function openClass(id: string): Promise<void> {
  detailOpen.value = true;
  detailLoading.value = true;
  detail.value = null;
  try {
    const { data } = await api.get<ClassDetail>(`/v1/classes/${id}`);
    detail.value = data;
  } catch (error) {
    notify.error(describeError(error));
    detailOpen.value = false;
  } finally {
    detailLoading.value = false;
  }
}

function openCreate(prefill?: { startsAt?: string }): void {
  const base = prefill?.startsAt ? new Date(prefill.startsAt) : new Date();
  if (!prefill?.startsAt) {
    base.setMinutes(0, 0, 0);
    base.setHours(base.getHours() + 1);
  }
  const end = new Date(base.getTime() + 90 * 60_000);
  form.value = {
    programId: programs.value[0]?.id ?? '',
    title: '',
    startsAt: toLocalInput(base),
    endsAt: toLocalInput(end),
    capacity: 20,
    location: '',
    coachId: '',
  };
  createOpen.value = true;
}

function toLocalInput(value: Date): string {
  const pad = (n: number) => `${n}`.padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

async function createClass(): Promise<void> {
  saving.value = true;
  try {
    const payload: Record<string, unknown> = {
      programId: form.value.programId,
      title: form.value.title.trim(),
      startsAt: new Date(form.value.startsAt).toISOString(),
      endsAt: new Date(form.value.endsAt).toISOString(),
      capacity: Number(form.value.capacity),
    };
    if (form.value.location.trim()) payload.location = form.value.location.trim();
    await api.post('/v1/classes', payload);
    notify.success('Class added to the schedule');
    createOpen.value = false;
    await load();
  } catch (error) {
    notify.error(describeError(error));
  } finally {
    saving.value = false;
  }
}

async function cancelBooking(bookingId: string): Promise<void> {
  if (!detail.value) return;
  try {
    await api.delete(`/v1/bookings/${bookingId}`);
    notify.success('Booking cancelled');
    await openClass(detail.value.id);
    await load();
  } catch (error) {
    notify.error(describeError(error));
  }
}

onMounted(load);
</script>

<template>
  <div>
    <PageHeader title="Schedule" :subtitle="weekLabel" :action-label="canCoach ? 'Add class' : undefined" @action="openCreate()">
      <template #actions>
        <select v-model="programFilter" class="input w-auto" @change="load">
          <option value="">All programs</option>
          <option v-for="program in programs" :key="program.id" :value="program.id">{{ program.name }}</option>
        </select>
        <button class="btn-ghost" @click="shiftWeek(-1)">← Prev</button>
        <button class="btn-ghost" @click="weekStart = startOfWeek(new Date()); load()">Today</button>
        <button class="btn-ghost" @click="shiftWeek(1)">Next →</button>
      </template>
    </PageHeader>

    <div v-if="loading" class="grid gap-3 lg:grid-cols-7">
      <div v-for="n in 7" :key="n" class="skeleton h-64" />
    </div>

    <div v-else class="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
      <div
        v-for="day in days"
        :key="day.iso"
        class="card flex min-h-[16rem] flex-col overflow-hidden"
        :class="day.isToday ? 'ring-2 ring-mat-500/40' : ''"
      >
        <header class="flex items-center justify-between border-b border-ink-100 px-3 py-2" :class="day.isToday ? 'bg-mat-50' : 'bg-ink-50/60'">
          <span class="text-[11px] font-semibold uppercase tracking-wide" :class="day.isToday ? 'text-mat-700' : 'text-ink-500'">
            {{ day.label }}
          </span>
          <span class="text-sm font-bold tabular" :class="day.isToday ? 'text-mat-700' : 'text-ink-700'">{{ day.dayNumber }}</span>
        </header>

        <div class="flex flex-1 flex-col gap-2 p-2">
          <button
            v-for="item in byDay.get(day.iso) ?? []"
            :key="item.id"
            class="group rounded-xl border border-ink-200 bg-white p-2.5 text-left transition hover:border-mat-400 hover:shadow-sm"
            @click="openClass(item.id)"
          >
            <p class="text-[11px] font-bold tabular text-mat-700">{{ time(item.startsAt) }}</p>
            <p class="mt-0.5 line-clamp-2 text-xs font-semibold leading-snug text-ink-900">{{ item.title }}</p>
            <p class="mt-0.5 truncate text-[11px] text-ink-500">{{ item.programName }}</p>
            <div class="mt-1.5 flex items-center justify-between">
              <span class="text-[11px] tabular text-ink-500">{{ item.checkedInCount }}/{{ item.capacity }}</span>
              <span
                v-if="item.spotsLeft === 0"
                class="rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600"
              >
                Full
              </span>
            </div>
          </button>

          <p v-if="!(byDay.get(day.iso) ?? []).length" class="mt-6 text-center text-[11px] text-ink-400">No classes</p>

          <button
            v-if="canCoach"
            class="mt-auto rounded-lg border border-dashed border-ink-300 py-1.5 text-[11px] font-semibold text-ink-400 transition hover:border-mat-400 hover:text-mat-700"
            @click="openCreate({ startsAt: `${day.iso}T09:00:00` })"
          >
            + Add
          </button>
        </div>
      </div>
    </div>

    <!-- Class detail -->
    <ModalDialog :open="detailOpen" :title="detail?.title ?? 'Class'" :description="detail ? `${detail.programName} · ${dateTime(detail.startsAt)}` : ''" width="max-w-2xl" @close="detailOpen = false">
      <div v-if="detailLoading" class="space-y-2">
        <div v-for="n in 4" :key="n" class="skeleton h-10 w-full" />
      </div>

      <div v-else-if="detail" class="space-y-5">
        <div class="grid grid-cols-3 gap-3">
          <div class="rounded-xl bg-ink-50 p-3">
            <p class="text-[11px] uppercase tracking-wide text-ink-400">Booked</p>
            <p class="font-display text-xl font-bold tabular text-ink-900">{{ detail.bookedCount }}/{{ detail.capacity }}</p>
          </div>
          <div class="rounded-xl bg-ink-50 p-3">
            <p class="text-[11px] uppercase tracking-wide text-ink-400">Checked in</p>
            <p class="font-display text-xl font-bold tabular text-ink-900">{{ detail.checkedInCount }}</p>
          </div>
          <div class="rounded-xl bg-ink-50 p-3">
            <p class="text-[11px] uppercase tracking-wide text-ink-400">Coach</p>
            <p class="truncate text-sm font-semibold text-ink-900">{{ detail.coachName ?? 'Unassigned' }}</p>
          </div>
        </div>

        <div>
          <h3 class="mb-2 text-sm font-semibold text-ink-900">Roster</h3>
          <div v-if="!detail.roster.length">
            <EmptyState title="Nobody booked yet" body="Members can book from the mobile app or the front desk." icon="👥" />
          </div>
          <ul v-else class="divide-y divide-ink-100 rounded-xl border border-ink-100">
            <li v-for="entry in detail.roster" :key="entry.bookingId" class="flex items-center gap-3 px-3 py-2.5">
              <span class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-mat-100 text-[11px] font-bold text-mat-700">
                {{ entry.firstName.charAt(0) }}{{ entry.lastName.charAt(0) }}
              </span>
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-ink-900">{{ entry.firstName }} {{ entry.lastName }}</p>
                <p class="text-[11px] text-ink-500">
                  {{ entry.checkedInAt ? `Checked in ${time(entry.checkedInAt)}` : 'Not yet arrived' }}
                </p>
              </div>
              <StatusBadge :value="entry.attendanceStatus ?? entry.bookingStatus" />
              <button
                v-if="canFrontDesk"
                class="text-xs text-ink-400 hover:text-rose-600"
                title="Cancel booking"
                @click="cancelBooking(entry.bookingId)"
              >
                ✕
              </button>
            </li>
          </ul>
        </div>

        <div v-if="detail.techniques.length">
          <h3 class="mb-2 text-sm font-semibold text-ink-900">Curriculum</h3>
          <div class="flex flex-wrap gap-2">
            <span v-for="technique in detail.techniques" :key="technique.id" class="chip bg-mat-50 text-mat-700">
              {{ technique.name }}
            </span>
          </div>
        </div>
      </div>
    </ModalDialog>

    <!-- Create class -->
    <ModalDialog :open="createOpen" title="Add a class" description="One-off session. Recurring templates live in Programs." width="max-w-xl" @close="createOpen = false">
      <form id="create-class" class="grid gap-4 sm:grid-cols-2" @submit.prevent="createClass">
        <div class="sm:col-span-2">
          <label class="label" for="c-program">Program</label>
          <select id="c-program" v-model="form.programId" class="input" required>
            <option value="">Select…</option>
            <option v-for="program in programs" :key="program.id" :value="program.id">
              {{ program.name }} · {{ humanize(program.discipline) }}
            </option>
          </select>
        </div>
        <div class="sm:col-span-2">
          <label class="label" for="c-title">Title</label>
          <input id="c-title" v-model="form.title" class="input" placeholder="e.g. Gi fundamentals" required />
        </div>
        <div>
          <label class="label" for="c-start">Starts</label>
          <input id="c-start" v-model="form.startsAt" class="input" type="datetime-local" required />
        </div>
        <div>
          <label class="label" for="c-end">Ends</label>
          <input id="c-end" v-model="form.endsAt" class="input" type="datetime-local" required />
        </div>
        <div>
          <label class="label" for="c-cap">Capacity</label>
          <input id="c-cap" v-model.number="form.capacity" class="input" type="number" min="1" max="300" required />
        </div>
        <div>
          <label class="label" for="c-loc">Location</label>
          <input id="c-loc" v-model="form.location" class="input" placeholder="Mat A" />
        </div>
      </form>
      <template #footer>
        <button class="btn-ghost" @click="createOpen = false">Cancel</button>
        <button class="btn-primary" form="create-class" type="submit" :disabled="saving">
          {{ saving ? 'Saving…' : 'Add class' }}
        </button>
      </template>
    </ModalDialog>
  </div>
</template>
