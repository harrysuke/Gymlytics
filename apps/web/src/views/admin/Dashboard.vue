<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { api } from '../../lib/api';
import { session } from '../../lib/auth';
import { compactMoney, dateTime, money, relative, time } from '../../lib/format';
import { describeError, notify } from '../../lib/toast';
import type { DashboardSummary } from '@gymlytics/shared';
import PageHeader from '../../components/PageHeader.vue';
import StatCard from '../../components/StatCard.vue';
import StatusBadge from '../../components/StatusBadge.vue';
import EmptyState from '../../components/EmptyState.vue';

const summary = ref<DashboardSummary | null>(null);
const loading = ref(true);

const ALERT_STYLES: Record<string, { icon: string; ring: string }> = {
  past_due: { icon: '💳', ring: 'border-amber-200 bg-amber-50/70' },
  waiver_expiring: { icon: '📄', ring: 'border-sky-200 bg-sky-50/70' },
  belt_eligible: { icon: '🥋', ring: 'border-mat-200 bg-mat-50/70' },
  low_stock: { icon: '📦', ring: 'border-ink-200 bg-ink-50' },
  unpaid_day_pass: { icon: '🎟️', ring: 'border-rose-200 bg-rose-50/70' },
};

const greeting = computed(() => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
});

const occupancy = computed(() => {
  const classes = summary.value?.todayClasses ?? [];
  const booked = classes.reduce((sum, c) => sum + c.bookedCount, 0);
  const capacity = classes.reduce((sum, c) => sum + c.capacity, 0);
  return capacity === 0 ? 0 : Math.round((booked / capacity) * 100);
});

async function load(): Promise<void> {
  loading.value = true;
  try {
    const { data } = await api.get<DashboardSummary>('/v1/dashboard/summary');
    summary.value = data;
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
    <PageHeader
      :title="`${greeting}, ${session.user?.firstName ?? 'coach'}`"
      :subtitle="`${session.academy?.name ?? 'Academy'} · ${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}`"
    >
      <template #actions>
        <button class="btn-ghost" :disabled="loading" @click="load">Refresh</button>
      </template>
    </PageHeader>

    <!-- Metrics -->
    <div v-if="loading" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <div v-for="n in 4" :key="n" class="card-pad">
        <div class="skeleton h-3 w-24" />
        <div class="skeleton mt-4 h-8 w-16" />
      </div>
    </div>

    <div v-else-if="summary" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Active members" :value="summary.activeMembers" icon="👥"
        :trend="`+${summary.newMembersThisMonth} joined this month`" />
      <StatCard label="On the mat today" :value="summary.checkedInToday" icon="🥋"
        :trend="`${summary.classesToday} classes · ${occupancy}% of capacity booked`" />
      <StatCard label="Monthly recurring" :value="money(summary.mrrCents, session.academy?.currency)"
        icon="💰" :trend="`${compactMoney(summary.revenueLast30DaysCents, session.academy?.currency)} collected in 30 days`" />
      <StatCard label="Past-due bills" :value="summary.pastDueBills" icon="⚠️"
        :tone="summary.pastDueBills > 0 ? 'warn' : 'good'"
        :trend="summary.pastDueBills > 0 ? 'Dunning reminders are running' : 'All memberships current'" />
    </div>

    <div class="mt-6 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
      <!-- Today's schedule -->
      <section class="card">
        <header class="flex items-center justify-between border-b border-ink-100 px-5 py-4">
          <div>
            <h2 class="font-display text-base font-bold text-ink-900">Today's classes</h2>
            <p class="text-xs text-ink-500">Live check-in counts update as members scan in.</p>
          </div>
          <RouterLink to="/admin/schedule" class="text-xs font-semibold text-mat-700 hover:underline">
            Full schedule →
          </RouterLink>
        </header>

        <div v-if="!summary?.todayClasses.length" class="p-5">
          <EmptyState title="No classes scheduled today" body="Add a class from the schedule page or import a recurring template." icon="📅" />
        </div>

        <ul v-else class="divide-y divide-ink-100">
          <li v-for="item in summary.todayClasses" :key="item.id" class="row-hover flex items-center gap-4 px-5 py-4">
            <div class="w-16 shrink-0">
              <p class="font-display text-sm font-bold tabular text-ink-900">{{ time(item.startsAt) }}</p>
              <p class="text-[11px] text-ink-400">{{ time(item.endsAt) }}</p>
            </div>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-semibold text-ink-900">{{ item.title }}</p>
              <p class="truncate text-xs text-ink-500">
                {{ item.programName }}<span v-if="item.coachName"> · {{ item.coachName }}</span>
              </p>
            </div>
            <div class="text-right">
              <p class="text-sm font-semibold tabular text-ink-900">
                {{ item.checkedInCount }}<span class="text-ink-400">/{{ item.capacity }}</span>
              </p>
              <p class="text-[11px] text-ink-400">{{ item.bookedCount }} booked</p>
            </div>
            <div class="hidden w-24 sm:block">
              <div class="h-1.5 overflow-hidden rounded-full bg-ink-100">
                <div
                  class="h-full rounded-full bg-mat-600 transition-all"
                  :style="{ width: `${Math.min(100, (item.checkedInCount / Math.max(1, item.capacity)) * 100)}%` }"
                />
              </div>
            </div>
          </li>
        </ul>
      </section>

      <!-- Alerts -->
      <section class="card">
        <header class="flex items-center justify-between border-b border-ink-100 px-5 py-4">
          <h2 class="font-display text-base font-bold text-ink-900">Needs attention</h2>
          <span v-if="summary?.alerts.length" class="chip bg-rose-50 text-rose-700 ring-1 ring-rose-600/15">
            {{ summary.alerts.length }}
          </span>
        </header>

        <div v-if="!summary?.alerts.length" class="p-5">
          <EmptyState title="Nothing to chase" body="No past-due bills, expiring waivers or low stock." icon="✅" />
        </div>

        <ul v-else class="space-y-2 p-3">
          <li v-for="alert in summary.alerts" :key="alert.id">
            <RouterLink
              v-if="alert.href"
              :to="alert.href"
              class="flex items-start gap-3 rounded-xl border px-3 py-2.5 transition hover:brightness-[0.98]"
              :class="ALERT_STYLES[alert.kind]?.ring ?? 'border-ink-200 bg-ink-50'"
            >
              <span class="mt-0.5 text-sm">{{ ALERT_STYLES[alert.kind]?.icon ?? '•' }}</span>
              <div class="min-w-0">
                <p class="text-sm font-semibold text-ink-900">{{ alert.title }}</p>
                <p class="truncate text-xs text-ink-600">{{ alert.detail }}</p>
              </div>
            </RouterLink>
            <div
              v-else
              class="flex items-start gap-3 rounded-xl border px-3 py-2.5"
              :class="ALERT_STYLES[alert.kind]?.ring ?? 'border-ink-200 bg-ink-50'"
            >
              <span class="mt-0.5 text-sm">{{ ALERT_STYLES[alert.kind]?.icon ?? '•' }}</span>
              <div class="min-w-0">
                <p class="text-sm font-semibold text-ink-900">{{ alert.title }}</p>
                <p class="truncate text-xs text-ink-600">{{ alert.detail }}</p>
              </div>
            </div>
          </li>
        </ul>
      </section>
    </div>

    <!-- Quick actions -->
    <section class="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <RouterLink
        v-for="action in [
          { to: '/admin/members', label: 'Add a member', body: 'Profile, guardian links and PIN', icon: '👤' },
          { to: '/admin/pos', label: 'Ring up a sale', body: 'Gi, rashguard or day pass', icon: '🛒' },
          { to: '/admin/promotions', label: 'Review promotions', body: 'Belt and stripe eligibility', icon: '🎖️' },
          { to: '/kiosk', label: 'Front desk kiosk', body: 'PIN, QR and name check-in', icon: '🖥️' },
        ]"
        :key="action.to"
        :to="action.to"
        class="card flex items-start gap-3 p-4 transition hover:-translate-y-0.5 hover:shadow-pop"
      >
        <span class="text-xl">{{ action.icon }}</span>
        <div>
          <p class="text-sm font-semibold text-ink-900">{{ action.label }}</p>
          <p class="text-xs text-ink-500">{{ action.body }}</p>
        </div>
      </RouterLink>
    </section>

    <p v-if="summary" class="mt-6 text-center text-[11px] text-ink-400">
      Metrics computed live from the SQLite source of truth · last refreshed {{ relative(new Date().toISOString()) }}
    </p>
  </div>
</template>
