<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../lib/api';
import { displayName, logout, session } from '../../lib/auth';
import { date, time } from '../../lib/format';
import { describeError, notify } from '../../lib/toast';
import PageHeader from '../../components/PageHeader.vue';
import EmptyState from '../../components/EmptyState.vue';

interface Dependent {
  id: string;
  firstName: string;
  lastName: string;
  relationship: string;
  canBookClasses: boolean;
  canSignWaivers: boolean;
  membershipStatus: string | null;
}
interface ChildClass {
  bookingId: string;
  classId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  bookingStatus: string;
  spotsLeft: number;
}
interface Progression {
  child: { firstName: string; lastName: string };
  history: {
    id: string;
    rankName: string;
    rankColor: string | null;
    toStripes: number;
    promotedAt: string;
  }[];
  eligibility: { programName: string; rankName: string; eligible: boolean; missing?: string[] }[];
}

const router = useRouter();
const children = ref<Dependent[]>([]);
const selected = ref<string | null>(null);
const schedule = ref<ChildClass[]>([]);
const progression = ref<Progression | null>(null);
const error = ref<string | null>(null);

async function load(): Promise<void> {
  try {
    children.value = (await api.get<Dependent[]>('/v1/family/dependents')).data;
    if (children.value.length && !selected.value) selected.value = children.value[0]!.id;
    if (selected.value) await select(selected.value);
  } catch (caught) {
    error.value = describeError(caught);
  }
}

async function select(id: string): Promise<void> {
  selected.value = id;
  try {
    const [classes, progress] = await Promise.all([
      api.get<ChildClass[]>(`/v1/family/dependents/${id}/schedule`),
      api.get<Progression>(`/v1/family/dependents/${id}/progression`),
    ]);
    schedule.value = classes.data;
    progression.value = progress.data;
  } catch (caught) {
    notify.error(describeError(caught));
  }
}

async function signOut(): Promise<void> {
  await logout();
  await router.push({ name: 'login' });
}

onMounted(load);
</script>

<template>
  <div class="min-h-full bg-ink-50">
    <header class="border-b border-ink-200 bg-white px-5 py-4">
      <div class="mx-auto flex max-w-6xl items-center justify-between">
        <div>
          <p class="font-display text-lg font-bold text-ink-900">Family portal</p>
          <p class="text-xs text-ink-500">{{ displayName(session.user) }} · {{ session.academy?.name }}</p>
        </div>
        <div class="flex gap-2">
          <RouterLink v-if="session.user" class="btn-ghost" to="/admin">Staff console</RouterLink>
          <button class="btn-ghost" type="button" @click="signOut">Sign out</button>
        </div>
      </div>
    </header>

    <main class="mx-auto max-w-6xl space-y-6 p-5">
      <PageHeader title="Your family on the mat" subtitle="Separate schedules, one billing account, individual rank progress." />

      <div v-if="error" class="card border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">{{ error }}</div>

      <div class="flex flex-wrap gap-2">
        <button v-for="child in children" :key="child.id" class="chip px-4 py-2"
          :class="selected === child.id ? 'bg-mat-600 text-white' : ''" type="button" @click="select(child.id)">
          {{ child.firstName }} {{ child.lastName }}
        </button>
        <EmptyState v-if="!children.length" title="No linked children" message="Ask the front desk to link your account." />
      </div>

      <template v-if="progression">
        <div class="grid gap-6 lg:grid-cols-2">
          <section class="card overflow-hidden">
            <div class="border-b border-ink-100 px-5 py-4">
              <h2 class="font-display text-lg font-bold text-ink-900">{{ progression.child.firstName }}'s upcoming classes</h2>
            </div>
            <div v-if="schedule.length" class="divide-y divide-ink-100">
              <div v-for="row in schedule" :key="row.bookingId" class="flex items-center gap-4 p-4">
                <div class="min-w-0 flex-1">
                  <p class="font-semibold text-ink-900">{{ row.title }}</p>
                  <p class="text-sm text-ink-500">{{ date(row.startsAt) }} · {{ time(row.startsAt) }}–{{ time(row.endsAt) }}</p>
                </div>
                <span class="chip">{{ row.bookingStatus }}</span>
              </div>
            </div>
            <EmptyState v-else title="No upcoming classes" message="Book a slot from the schedule." />
          </section>

          <section class="card p-5">
            <h2 class="font-display text-lg font-bold text-ink-900">{{ progression.child.firstName }}'s rank journey</h2>
            <ol v-if="progression.history.length" class="mt-4 space-y-3">
              <li v-for="item in progression.history" :key="item.id" class="flex items-center gap-3">
                <span class="h-5 w-5 rounded-full border border-ink-300" :style="{ backgroundColor: item.rankColor ?? '#fff' }" />
                <span class="font-medium text-ink-800">{{ item.rankName }} · {{ item.toStripes }} stripe{{ item.toStripes === 1 ? '' : 's' }}</span>
                <span class="ml-auto text-xs text-ink-500">{{ date(item.promotedAt) }}</span>
              </li>
            </ol>
            <EmptyState v-else title="No promotions yet" message="Rank history will appear here." />

            <div v-if="progression.eligibility.length" class="mt-5 border-t border-ink-100 pt-4">
              <p class="text-xs uppercase tracking-wide text-ink-500">Eligibility</p>
              <div v-for="row in progression.eligibility" :key="row.programName" class="mt-2 text-sm">
                <span class="font-medium text-ink-800">{{ row.programName }} · {{ row.rankName }}</span>
                <span class="ml-2" :class="row.eligible ? 'text-emerald-700' : 'text-ink-500'">
                  {{ row.eligible ? 'Ready for review' : (row.missing ?? []).join(', ') }}
                </span>
              </div>
            </div>
          </section>
        </div>
      </template>
    </main>
  </div>
</template>
