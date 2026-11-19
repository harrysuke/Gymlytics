<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { api } from '../../lib/api';
import { addDays, dateTime, humanize, isoDay, time } from '../../lib/format';
import { describeError, notify } from '../../lib/toast';
import PageHeader from '../../components/PageHeader.vue';
import StatusBadge from '../../components/StatusBadge.vue';
import EmptyState from '../../components/EmptyState.vue';

interface AttendanceRow {
  id: string;
  checkedInAt: string;
  checkedOutAt: string | null;
  method: string;
  status: string;
  userId: string;
  firstName: string;
  lastName: string;
  classId: string;
  classTitle: string;
  startsAt: string;
  programName: string;
}

interface Program {
  id: string;
  name: string;
}

const rows = ref<AttendanceRow[]>([]);
const programs = ref<Program[]>([]);
const from = ref(isoDay(addDays(new Date(), -7)));
const to = ref(isoDay(new Date()));
const programFilter = ref('');
const loading = ref(true);

const METHOD_ICON: Record<string, string> = {
  pin: '🔢',
  qr: '📷',
  name_search: '🔎',
  mobile: '📱',
  admin: '🛠️',
  guardian: '👨‍👩‍👧',
};

const grouped = computed(() => {
  const map = new Map<string, AttendanceRow[]>();
  for (const row of rows.value) {
    const key = isoDay(new Date(row.checkedInAt));
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }
  return [...map.entries()];
});

const summary = computed(() => ({
  total: rows.value.length,
  uniqueMembers: new Set(rows.value.map((row) => row.userId)).size,
  stillOnMat: rows.value.filter((row) => row.status === 'checked_in').length,
}));

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [{ data }, programResponse] = await Promise.all([
      api.get<AttendanceRow[]>('/v1/attendance', {
        query: {
          from: new Date(`${from.value}T00:00:00`).toISOString(),
          to: new Date(`${to.value}T23:59:59`).toISOString(),
          programId: programFilter.value || undefined,
          limit: 200,
        },
      }),
      api.get<Program[]>('/v1/programs'),
    ]);
    rows.value = data;
    programs.value = programResponse.data;
  } catch (error) {
    notify.error(describeError(error));
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <PageHeader title="Attendance" subtitle="Every check-in, however it was recorded.">
      <template #actions>
        <input v-model="from" class="input w-auto" type="date" @change="load" />
        <span class="text-sm text-ink-400">to</span>
        <input v-model="to" class="input w-auto" type="date" @change="load" />
        <select v-model="programFilter" class="input w-auto" @change="load">
          <option value="">All programs</option>
          <option v-for="program in programs" :key="program.id" :value="program.id">{{ program.name }}</option>
        </select>
      </template>
    </PageHeader>

    <div class="mb-4 grid gap-3 sm:grid-cols-3">
      <div class="card-pad">
        <p class="text-xs font-semibold uppercase tracking-wide text-ink-500">Check-ins</p>
        <p class="mt-2 font-display text-2xl font-bold tabular text-ink-900">{{ summary.total }}</p>
      </div>
      <div class="card-pad">
        <p class="text-xs font-semibold uppercase tracking-wide text-ink-500">Unique members</p>
        <p class="mt-2 font-display text-2xl font-bold tabular text-ink-900">{{ summary.uniqueMembers }}</p>
      </div>
      <div class="card-pad">
        <p class="text-xs font-semibold uppercase tracking-wide text-ink-500">Still on the mat</p>
        <p class="mt-2 font-display text-2xl font-bold tabular text-emerald-600">{{ summary.stillOnMat }}</p>
      </div>
    </div>

    <div v-if="loading" class="space-y-2">
      <div v-for="n in 8" :key="n" class="skeleton h-12 w-full" />
    </div>

    <EmptyState
      v-else-if="!rows.length"
      title="No check-ins in this range"
      body="Try widening the date range, or check that the kiosk has synced."
      icon="📋"
    />

    <div v-else class="space-y-6">
      <section v-for="[day, entries] in grouped" :key="day" class="card overflow-hidden">
        <header class="flex items-center justify-between border-b border-ink-100 bg-ink-50/60 px-4 py-2.5">
          <h2 class="text-sm font-semibold text-ink-800">
            {{ new Date(day).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) }}
          </h2>
          <span class="text-xs text-ink-500">{{ entries.length }} check-ins</span>
        </header>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[680px]">
            <thead>
              <tr class="border-b border-ink-100">
                <th class="th">Time</th>
                <th class="th">Member</th>
                <th class="th">Class</th>
                <th class="th">Method</th>
                <th class="th">Status</th>
                <th class="th">Out</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-ink-100">
              <tr v-for="row in entries" :key="row.id" class="row-hover">
                <td class="td font-mono text-xs tabular">{{ time(row.checkedInAt) }}</td>
                <td class="td">
                  <RouterLink :to="{ name: 'member-detail', params: { id: row.userId } }" class="font-medium text-mat-700 hover:underline">
                    {{ row.firstName }} {{ row.lastName }}
                  </RouterLink>
                </td>
                <td class="td">
                  <p class="text-xs font-medium text-ink-800">{{ row.classTitle }}</p>
                  <p class="text-[11px] text-ink-500">{{ row.programName }}</p>
                </td>
                <td class="td">
                  <span class="text-xs">{{ METHOD_ICON[row.method] ?? '•' }} {{ humanize(row.method) }}</span>
                </td>
                <td class="td"><StatusBadge :value="row.status" /></td>
                <td class="td text-xs text-ink-500">{{ row.checkedOutAt ? time(row.checkedOutAt) : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <p class="text-center text-[11px] text-ink-400">
        Showing {{ rows.length }} records · newest first · {{ dateTime(new Date().toISOString()) }}
      </p>
    </div>
  </div>
</template>
