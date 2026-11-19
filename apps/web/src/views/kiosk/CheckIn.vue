<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { KioskClass, KioskMember } from '@gymlytics/shared';
import type { SyncState } from '@gymlytics/sync';
import { api } from '../../lib/api';
import { describeError } from '../../lib/toast';
import {
  cacheBootstrap,
  clearSession,
  fetchBootstrap,
  hashPin,
  loadSession,
  pairDevice,
  readCachedBootstrap,
  saveSession,
  suggestedClass,
  todayClasses,
  type KioskSession,
} from '../../lib/kiosk';
import { getKioskRuntime, resetKioskRuntime, type KioskRuntime } from '../../lib/sync';

type Mode = 'pin' | 'name' | 'qr';
type Phase = 'pairing' | 'booting' | 'ready';

const phase = ref<Phase>(loadSession() ? 'booting' : 'pairing');
const session = ref<KioskSession | null>(loadSession());
const runtime = ref<KioskRuntime | null>(null);
const syncState = ref<SyncState | null>(null);

const members = ref<KioskMember[]>([]);
const classes = ref<KioskClass[]>([]);
const selectedClassId = ref<string | null>(null);
const cacheAge = ref<string | null>(null);
const offline = ref(false);

const mode = ref<Mode>('pin');
const pin = ref('');
const nameQuery = ref('');
const qrToken = ref('');
const busy = ref(false);

const feedback = ref<
  | { kind: 'success'; title: string; detail: string; warnings: string[] }
  | { kind: 'error'; title: string; detail: string; userId?: string }
  | null
>(null);

const clock = ref(new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }));
const pairingForm = ref({ academySlug: 'gymlytics-demo', deviceId: 'kiosk-lobby-01', deviceKey: 'dev-kiosk-key' });
const pairingError = ref<string | null>(null);
const pairingBusy = ref(false);

const dropInOpen = ref(false);
const dropInForm = ref({ firstName: '', lastName: '', phone: '', email: '' });
const dropInBusy = ref(false);

let clockTimer: ReturnType<typeof setInterval> | null = null;
let feedbackTimer: ReturnType<typeof setTimeout> | null = null;

const todays = computed(() => todayClasses(classes.value));
const selectedClass = computed(() => classes.value.find((item) => item.id === selectedClassId.value) ?? null);

const nameResults = computed(() => {
  const needle = nameQuery.value.trim().toLowerCase();
  if (needle.length < 2) return [];
  return members.value
    .filter((member) => `${member.firstName} ${member.lastName}`.toLowerCase().includes(needle))
    .slice(0, 6);
});

const queued = computed(() => syncState.value?.queued ?? 0);
const online = computed(() => syncState.value?.online ?? navigator.onLine);

function showFeedback(next: NonNullable<typeof feedback.value>): void {
  feedback.value = next;
  if (feedbackTimer) clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => {
    feedback.value = null;
    pin.value = '';
    nameQuery.value = '';
    qrToken.value = '';
  }, 6000);
}

async function pair(): Promise<void> {
  pairingBusy.value = true;
  pairingError.value = null;
  try {
    const paired = await pairDevice({
      academySlug: pairingForm.value.academySlug.trim(),
      deviceId: pairingForm.value.deviceId.trim(),
      deviceKey: pairingForm.value.deviceKey.trim(),
    });
    session.value = paired;
    phase.value = 'booting';
    await boot();
  } catch (error) {
    pairingError.value = describeError(error);
  } finally {
    pairingBusy.value = false;
  }
}

async function boot(): Promise<void> {
  const paired = session.value ?? loadSession();
  if (!paired) {
    phase.value = 'pairing';
    return;
  }

  try {
    runtime.value = await getKioskRuntime((state) => {
      syncState.value = state;
    });
    syncState.value = runtime.value.engine.getState();
  } catch (error) {
    pairingError.value = describeError(error);
    phase.value = 'pairing';
    return;
  }

  await refreshData();
  phase.value = 'ready';
}

async function refreshData(): Promise<void> {
  const paired = session.value ?? loadSession();
  if (!paired || !runtime.value) return;

  try {
    const bootstrap = await fetchBootstrap(paired);
    members.value = bootstrap.members;
    classes.value = bootstrap.classes;
    cacheAge.value = bootstrap.generatedAt;
    offline.value = false;
    selectedClassId.value ??= suggestedClass(bootstrap.classes)?.id ?? null;
    await cacheBootstrap(runtime.value.sql, bootstrap);
  } catch {
    // Network gone — fall back to whatever the tablet stored last shift.
    const cached = await readCachedBootstrap(runtime.value.sql);
    if (cached) {
      members.value = cached.members;
      classes.value = cached.classes;
      cacheAge.value = cached.cachedAt;
      offline.value = true;
      selectedClassId.value ??= suggestedClass(cached.classes)?.id ?? null;
    }
  }
}

function resetPin(): void {
  pin.value = '';
}

function press(digit: string): void {
  if (pin.value.length >= 8) return;
  pin.value += digit;
  if (pin.value.length >= 4) void tryPin();
}

async function tryPin(): Promise<void> {
  if (!runtime.value || !session.value || pin.value.length < 4) return;
  const hash = await hashPin(session.value.academyId, pin.value);
  const member = members.value.find((entry) => entry.pinHash === hash);
  if (!member) {
    pin.value = '';
    showFeedback({ kind: 'error', title: 'PIN not recognised', detail: 'Try your name, or ask the front desk.' });
    return;
  }
  await checkIn(member, 'pin');
}

async function checkInByName(member: KioskMember): Promise<void> {
  await checkIn(member, 'name_search');
}

async function submitQr(): Promise<void> {
  const token = qrToken.value.trim();
  if (!token) return;
  const member = members.value.find((entry) => entry.qrToken === token);
  qrToken.value = '';
  if (!member) {
    showFeedback({ kind: 'error', title: 'Card not recognised', detail: 'Ask the front desk to re-issue your member card.' });
    return;
  }
  await checkIn(member, 'qr');
}

/**
 * Local-first check-in.
 *
 * The attendance row and its outbox mutation are committed in a single SQLite
 * transaction, so a power cut between the two can never lose a check-in. The
 * sync engine drains the queue whenever the tablet regains connectivity.
 */
async function checkIn(member: KioskMember, method: 'pin' | 'qr' | 'name_search'): Promise<void> {
  const target = selectedClass.value;
  if (!target) {
    showFeedback({ kind: 'error', title: 'Pick a class first', detail: 'Choose which session you are attending.' });
    return;
  }
  if (!member.waiverValid) {
    showFeedback({
      kind: 'error',
      title: 'Waiver needed',
      detail: `${member.firstName} needs a signed waiver before stepping on the mat.`,
      userId: member.id,
    });
    return;
  }

  busy.value = true;
  try {
    const instance = runtime.value!;
    const now = new Date().toISOString();
    const mutationId = crypto.randomUUID();
    const attendanceId = crypto.randomUUID();
    const hlc = instance.engine.getClock().tick();

    await instance.sql.execute('BEGIN IMMEDIATE');
    try {
      await instance.sql.execute(
        `INSERT INTO attendance_logs
          (id, academy_id, class_id, user_id, checked_in_at, method, status, kiosk_id,
           version, hlc, origin_device_id, sync_status, mutation_id, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          attendanceId,
          instance.academyId,
          target.id,
          member.id,
          now,
          method,
          'checked_in',
          instance.deviceId,
          1,
          hlc,
          instance.deviceId,
          'local',
          mutationId,
          now,
          now,
        ],
      );
      await instance.localDb.enqueue({
        mutationId,
        academyId: instance.academyId,
        deviceId: instance.deviceId,
        entity: 'attendance_log',
        entityId: attendanceId,
        operation: 'insert',
        payload: { classId: target.id, userId: member.id, checkedInAt: now, method },
        hlc,
        version: 1,
        status: 'pending',
        attempts: 0,
        nextAttemptAt: now,
        lastError: null,
        createdAt: now,
      });
      await instance.sql.execute('COMMIT');
    } catch (error) {
      await instance.sql.execute('ROLLBACK');
      throw error;
    }

    pin.value = '';
    nameQuery.value = '';
    const warnings: string[] = [];
    if (member.membershipStatus === 'past_due') warnings.push('Membership is past due — see the front desk');
    if (member.waiverExpiresAt) {
      const days = (new Date(member.waiverExpiresAt).getTime() - Date.now()) / 86_400_000;
      if (days < 14) warnings.push('Waiver expires soon');
    }
    showFeedback({
      kind: 'success',
      title: `Welcome, ${member.firstName}!`,
      detail: `${target.title} · ${new Date(target.startsAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`,
      warnings,
    });

    void instance.engine.syncNow();
  } catch (error) {
    showFeedback({ kind: 'error', title: 'Check-in failed', detail: describeError(error) });
  } finally {
    busy.value = false;
  }
}

async function registerDropIn(): Promise<void> {
  dropInBusy.value = true;
  try {
    const paired = session.value!;
    const payload: Record<string, unknown> = {
      firstName: dropInForm.value.firstName.trim(),
      lastName: dropInForm.value.lastName.trim(),
      phone: dropInForm.value.phone.trim(),
    };
    if (dropInForm.value.email.trim()) payload.email = dropInForm.value.email.trim();
    const { data } = await api.post<{ id: string }>('/v1/kiosk/drop-in', payload, { token: paired.token });

    showFeedback({
      kind: 'success',
      title: `Visitor added: ${dropInForm.value.firstName}`,
      detail: 'Send them to the waiver tablet before they step on the mat.',
      warnings: [],
    });
    dropInOpen.value = false;
    dropInForm.value = { firstName: '', lastName: '', phone: '', email: '' };
    await refreshData();
    window.open(`/waiver?userId=${data.id}`, '_blank', 'noopener');
  } catch (error) {
    showFeedback({ kind: 'error', title: 'Could not register visitor', detail: describeError(error) });
  } finally {
    dropInBusy.value = false;
  }
}

function unpair(): void {
  if (!window.confirm('Unpair this tablet? You will need the device key to set it up again.')) return;
  resetKioskRuntime();
  clearSession();
  session.value = null;
  phase.value = 'pairing';
}

async function syncNow(): Promise<void> {
  if (!runtime.value) return;
  syncState.value = await runtime.value.engine.syncNow();
  await refreshData();
}

watch(mode, () => {
  pin.value = '';
  nameQuery.value = '';
  qrToken.value = '';
  feedback.value = null;
});

onMounted(async () => {
  clockTimer = setInterval(() => {
    clock.value = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }, 15_000);

  if (phase.value === 'booting') await boot();
});

onBeforeUnmount(() => {
  if (clockTimer) clearInterval(clockTimer);
  if (feedbackTimer) clearTimeout(feedbackTimer);
});
</script>

<template>
  <!-- Pairing -->
  <div v-if="phase === 'pairing'" class="flex min-h-full items-center justify-center bg-ink-900 p-6">
    <div class="w-full max-w-md rounded-3xl bg-white p-8 shadow-pop">
      <span class="grid h-12 w-12 place-items-center rounded-2xl bg-mat-600 font-display text-2xl font-extrabold text-white">G</span>
      <h1 class="mt-5 font-display text-2xl font-bold text-ink-900">Pair this tablet</h1>
      <p class="mt-1 text-sm text-ink-500">
        One-time setup. The device key is issued by your academy administrator.
      </p>

      <form class="mt-6 space-y-4" @submit.prevent="pair">
        <div>
          <label class="label" for="k-slug">Academy slug</label>
          <input id="k-slug" v-model="pairingForm.academySlug" class="input" required />
        </div>
        <div>
          <label class="label" for="k-device">Device id</label>
          <input id="k-device" v-model="pairingForm.deviceId" class="input font-mono text-xs" required />
        </div>
        <div>
          <label class="label" for="k-key">Device key</label>
          <input id="k-key" v-model="pairingForm.deviceKey" class="input font-mono text-xs" type="password" required />
        </div>
        <p v-if="pairingError" class="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {{ pairingError }}
        </p>
        <button class="btn-primary w-full" type="submit" :disabled="pairingBusy">
          {{ pairingBusy ? 'Pairing…' : 'Pair device' }}
        </button>
      </form>

      <p class="mt-4 text-center text-[11px] text-ink-400">
        Demo key: <span class="font-mono">dev-kiosk-key</span>
      </p>
    </div>
  </div>

  <!-- Booting -->
  <div v-else-if="phase === 'booting'" class="flex min-h-full items-center justify-center bg-ink-900">
    <div class="text-center">
      <div class="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white" />
      <p class="mt-4 text-sm text-ink-300">Warming up the local mat…</p>
    </div>
  </div>

  <!-- Kiosk -->
  <div v-else class="flex min-h-full flex-col bg-ink-950 text-white">
    <!-- Header -->
    <header class="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-3">
      <div class="flex items-center gap-3">
        <span class="grid h-9 w-9 place-items-center rounded-xl bg-mat-600 font-display text-base font-extrabold">G</span>
        <div>
          <p class="text-sm font-semibold leading-tight">{{ session?.academyName }}</p>
          <p class="text-[11px] leading-tight text-ink-400">Front desk check-in</p>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <span
          class="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
          :class="online ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'"
        >
          <span class="h-1.5 w-1.5 rounded-full" :class="online ? 'bg-emerald-400' : 'bg-amber-400'" />
          {{ online ? 'Online' : 'Offline — queueing' }}
        </span>
        <span v-if="queued" class="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold">
          {{ queued }} queued
        </span>
        <span class="font-display text-lg font-bold tabular">{{ clock }}</span>
        <button class="rounded-lg px-2 py-1 text-[11px] text-ink-400 hover:bg-white/10 hover:text-white" @click="unpair">
          Unpair
        </button>
      </div>
    </header>

    <div class="grid flex-1 gap-4 p-4 lg:grid-cols-[300px_1fr]">
      <!-- Class picker -->
      <aside class="rounded-3xl bg-white/5 p-4">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold text-white">Which class?</h2>
          <button class="text-[11px] text-ink-400 hover:text-white" @click="refreshData">Refresh</button>
        </div>

        <div v-if="!todays.length" class="mt-6 rounded-2xl border border-dashed border-white/15 p-4 text-center text-xs text-ink-400">
          No classes scheduled today.
        </div>

        <ul v-else class="mt-3 space-y-2">
          <li v-for="item in todays" :key="item.id">
            <button
              class="w-full rounded-2xl border p-3 text-left transition"
              :class="selectedClassId === item.id
                ? 'border-mat-400 bg-mat-600/30'
                : 'border-white/10 bg-white/5 hover:border-white/25'"
              @click="selectedClassId = item.id"
            >
              <p class="text-xs font-bold tabular text-mat-300">
                {{ new Date(item.startsAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) }}
              </p>
              <p class="mt-0.5 text-sm font-semibold leading-snug">{{ item.title }}</p>
              <p class="mt-0.5 text-[11px] text-ink-400">{{ item.programName }}</p>
              <p class="mt-1 text-[11px] tabular text-ink-400">{{ item.bookedCount }}/{{ item.capacity }} booked</p>
            </button>
          </li>
        </ul>

        <button class="mt-4 w-full rounded-2xl border border-dashed border-white/20 py-2.5 text-xs font-semibold text-ink-300 transition hover:border-mat-400 hover:text-white" @click="dropInOpen = true">
          + Register a drop-in visitor
        </button>

        <p v-if="cacheAge" class="mt-4 text-[10px] leading-relaxed text-ink-500">
          {{ offline ? 'Offline cache' : 'Roster synced' }}
          {{ new Date(cacheAge).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) }}
          · {{ members.length }} members
        </p>
      </aside>

      <!-- Check-in panel -->
      <section class="relative flex flex-col rounded-3xl bg-white p-5 text-ink-900">
        <!-- Feedback overlay -->
        <Transition
          enter-active-class="transition duration-200"
          enter-from-class="opacity-0 scale-95"
          leave-active-class="transition duration-150"
          leave-to-class="opacity-0"
        >
          <div
            v-if="feedback"
            class="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-3xl p-8 text-center"
            :class="feedback.kind === 'success' ? 'bg-emerald-50' : 'bg-rose-50'"
          >
            <span class="text-5xl">{{ feedback.kind === 'success' ? '🥋' : '⚠️' }}</span>
            <h3 class="mt-4 font-display text-3xl font-extrabold" :class="feedback.kind === 'success' ? 'text-emerald-800' : 'text-rose-800'">
              {{ feedback.title }}
            </h3>
            <p class="mt-2 text-base text-ink-600">{{ feedback.detail }}</p>
            <ul v-if="feedback.kind === 'success' && feedback.warnings.length" class="mt-4 space-y-1">
              <li v-for="warning in feedback.warnings" :key="warning" class="text-sm text-amber-700">• {{ warning }}</li>
            </ul>
            <div class="mt-6 flex gap-3">
              <a
                v-if="feedback.kind === 'error' && feedback.userId"
                :href="`/waiver?userId=${feedback.userId}`"
                target="_blank"
                rel="noopener"
                class="btn-primary"
              >
                Open waiver
              </a>
              <button class="btn-ghost" @click="feedback = null">Done</button>
            </div>
          </div>
        </Transition>

        <div class="flex items-center justify-between">
          <div>
            <h2 class="font-display text-xl font-bold text-ink-900">Check in</h2>
            <p class="text-xs text-ink-500">
              {{ selectedClass ? `Signing in to ${selectedClass.title}` : 'Pick a class on the left' }}
            </p>
          </div>
          <div class="flex gap-1 rounded-xl bg-ink-100 p-1">
            <button
              v-for="entry in [{ key: 'pin', label: 'PIN' }, { key: 'name', label: 'Name' }, { key: 'qr', label: 'QR' }]"
              :key="entry.key"
              class="rounded-lg px-3 py-1.5 text-xs font-semibold transition"
              :class="mode === entry.key ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500'"
              @click="mode = entry.key as Mode"
            >
              {{ entry.label }}
            </button>
          </div>
        </div>

        <!-- PIN -->
        <div v-if="mode === 'pin'" class="mt-5 flex flex-1 flex-col">
          <div class="flex justify-center gap-3 py-2">
            <span
              v-for="n in 4"
              :key="n"
              class="h-3 w-3 rounded-full"
              :class="pin.length >= n ? 'bg-mat-600' : 'bg-ink-200'"
            />
          </div>
          <p class="mt-1 text-center text-sm text-ink-500">Enter your 4–8 digit PIN</p>

          <div class="mx-auto mt-5 grid w-full max-w-xs grid-cols-3 gap-2">
            <button
              v-for="digit in ['1', '2', '3', '4', '5', '6', '7', '8', '9']"
              :key="digit"
              class="rounded-2xl bg-ink-100 py-4 font-display text-2xl font-bold text-ink-800 transition active:scale-95 hover:bg-ink-200"
              :disabled="busy"
              @click="press(digit)"
            >
              {{ digit }}
            </button>
            <button class="rounded-2xl bg-ink-100 py-4 text-lg font-bold text-ink-500 transition hover:bg-ink-200" @click="resetPin">
              C
            </button>
            <button class="rounded-2xl bg-ink-100 py-4 font-display text-2xl font-bold text-ink-800 transition active:scale-95 hover:bg-ink-200" :disabled="busy" @click="press('0')">
              0
            </button>
            <button class="rounded-2xl bg-mat-700 py-4 text-lg font-bold text-white transition active:scale-95" :disabled="busy || pin.length < 4" @click="tryPin">
              ↵
            </button>
          </div>
        </div>

        <!-- Name -->
        <div v-else-if="mode === 'name'" class="mt-5 flex flex-1 flex-col">
          <input
            v-model="nameQuery"
            class="w-full rounded-2xl border border-ink-200 px-4 py-4 text-xl focus:border-mat-500 focus:outline-none"
            placeholder="Start typing your name…"
            autocomplete="off"
          />
          <ul class="mt-3 flex-1 space-y-2 overflow-y-auto">
            <li v-for="member in nameResults" :key="member.id">
              <button
                class="flex w-full items-center gap-3 rounded-2xl border border-ink-200 p-3 text-left transition hover:border-mat-400 hover:bg-mat-50"
                :disabled="busy"
                @click="checkInByName(member)"
              >
                <span class="grid h-11 w-11 place-items-center rounded-full bg-mat-100 font-bold text-mat-700">
                  {{ member.firstName.charAt(0) }}{{ member.lastName.charAt(0) }}
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-base font-semibold text-ink-900">{{ member.firstName }} {{ member.lastName }}</span>
                  <span class="block text-xs" :class="member.waiverValid ? 'text-ink-500' : 'text-rose-600'">
                    {{ member.waiverValid ? (member.membershipStatus ?? 'no plan') : 'Waiver missing' }}
                  </span>
                </span>
              </button>
            </li>
            <li v-if="nameQuery.length >= 2 && !nameResults.length" class="py-8 text-center text-sm text-ink-400">
              No match. Ask the front desk to add you.
            </li>
          </ul>
        </div>

        <!-- QR -->
        <div v-else class="mt-5 flex flex-1 flex-col items-center justify-center">
          <div class="grid h-32 w-32 place-items-center rounded-3xl border-2 border-dashed border-ink-300 text-4xl">📷</div>
          <p class="mt-4 text-center text-sm text-ink-500">
            Scan your member card, or type the code and press Enter.
          </p>
          <input
            v-model="qrToken"
            class="mt-4 w-full max-w-sm rounded-2xl border border-ink-200 px-4 py-3 text-center font-mono text-sm focus:border-mat-500 focus:outline-none"
            placeholder="gym_…"
            autocomplete="off"
            @keyup.enter="submitQr"
          />
          <button class="btn-primary mt-3" :disabled="!qrToken.trim()" @click="submitQr">Check in</button>
        </div>

        <footer class="mt-4 flex items-center justify-between border-t border-ink-100 pt-3 text-[11px] text-ink-400">
          <span>{{ members.length }} members cached · {{ todays.length }} classes today</span>
          <button class="font-semibold text-mat-700 hover:underline" @click="syncNow">Sync now</button>
        </footer>
      </section>
    </div>

    <!-- Drop-in modal -->
    <div v-if="dropInOpen" class="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
      <div class="w-full max-w-md rounded-3xl bg-white p-6 text-ink-900 shadow-pop">
        <h3 class="font-display text-xl font-bold">Drop-in visitor</h3>
        <p class="mt-1 text-sm text-ink-500">Creates a visitor profile. A waiver is still required before they train.</p>
        <form class="mt-5 space-y-3" @submit.prevent="registerDropIn">
          <div class="grid grid-cols-2 gap-3">
            <input v-model="dropInForm.firstName" class="input" placeholder="First name" required />
            <input v-model="dropInForm.lastName" class="input" placeholder="Last name" required />
          </div>
          <input v-model="dropInForm.phone" class="input" placeholder="Phone" required />
          <input v-model="dropInForm.email" class="input" type="email" placeholder="Email (optional)" />
          <div class="flex justify-end gap-2 pt-2">
            <button type="button" class="btn-ghost" @click="dropInOpen = false">Cancel</button>
            <button type="submit" class="btn-primary" :disabled="dropInBusy">
              {{ dropInBusy ? 'Saving…' : 'Register & open waiver' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
