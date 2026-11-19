<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../lib/api';
import { date, time } from '../../lib/format';
import { describeError } from '../../lib/toast';

interface ScheduleData {
  academyName: string;
  title: string;
  accentColor: string;
  classes: {
    id: string;
    title: string;
    startsAt: string;
    endsAt: string;
    programName: string;
    spotsLeft: number;
  }[];
}
interface WaiverData {
  title: string;
  documentTitle: string;
  signUrl: string;
}

const route = useRoute();
const token = computed(() => String(route.params.token ?? ''));
const kind = computed(() => String(route.params.kind ?? ''));
const schedule = ref<ScheduleData | null>(null);
const waiver = ref<WaiverData | null>(null);
const error = ref<string | null>(null);
const submitted = ref(false);
const busy = ref(false);
const form = ref({ firstName: '', lastName: '', email: '', phone: '' });

async function load(): Promise<void> {
  try {
    if (kind.value === 'schedule') {
      schedule.value = (await api.get<ScheduleData>(`/v1/widgets/public/${token.value}/schedule`, { anonymous: true })).data;
    } else if (kind.value === 'waiver_link') {
      waiver.value = (await api.get<WaiverData>(`/v1/widgets/public/${token.value}/waiver`, { anonymous: true })).data;
    }
  } catch (caught) {
    error.value = describeError(caught);
  }
}

async function submit(): Promise<void> {
  busy.value = true;
  try {
    await api.post(`/v1/widgets/public/${token.value}/trials`, {
      firstName: form.value.firstName,
      lastName: form.value.lastName,
      email: form.value.email || undefined,
      phone: form.value.phone || undefined,
    }, { anonymous: true });
    submitted.value = true;
  } catch (caught) {
    error.value = describeError(caught);
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="min-h-screen bg-white p-4 font-sans text-ink-900">
    <div v-if="error" class="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{{ error }}</div>

    <template v-if="kind === 'schedule' && schedule">
      <header class="mb-4 flex items-center justify-between border-b pb-3" :style="{ borderColor: schedule.accentColor }">
        <div>
          <p class="text-xs uppercase tracking-wide text-ink-500">{{ schedule.academyName }}</p>
          <h1 class="font-display text-xl font-bold">{{ schedule.title }}</h1>
        </div>
        <span class="h-8 w-8 rounded-full" :style="{ backgroundColor: schedule.accentColor }" />
      </header>
      <ul v-if="schedule.classes.length" class="divide-y divide-ink-100">
        <li v-for="row in schedule.classes" :key="row.id" class="flex items-center gap-3 py-3">
          <div class="min-w-0 flex-1">
            <p class="font-semibold">{{ row.title }}</p>
            <p class="text-xs text-ink-500">{{ row.programName }} · {{ date(row.startsAt) }} · {{ time(row.startsAt) }}</p>
          </div>
          <span class="chip">{{ row.spotsLeft }} spots</span>
        </li>
      </ul>
      <p v-else class="py-8 text-center text-sm text-ink-500">No upcoming classes scheduled.</p>
    </template>

    <template v-else-if="kind === 'trial_form'">
      <div v-if="submitted" class="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
        <p class="font-display text-xl font-bold text-emerald-800">Thanks — we'll be in touch</p>
        <p class="mt-1 text-sm text-emerald-700">Your trial request has reached the academy.</p>
      </div>
      <form v-else class="space-y-3" @submit.prevent="submit">
        <h1 class="font-display text-xl font-bold">Book a trial class</h1>
        <input v-model="form.firstName" class="input" placeholder="First name" required />
        <input v-model="form.lastName" class="input" placeholder="Last name" required />
        <input v-model="form.email" class="input" type="email" placeholder="Email" />
        <input v-model="form.phone" class="input" placeholder="Phone" />
        <button class="btn-primary w-full" type="submit" :disabled="busy">{{ busy ? 'Sending…' : 'Request a trial' }}</button>
      </form>
    </template>

    <template v-else-if="kind === 'waiver_link' && waiver">
      <div class="rounded-xl border border-ink-200 p-6 text-center">
        <h1 class="font-display text-xl font-bold">{{ waiver.title }}</h1>
        <p class="mt-2 text-sm text-ink-500">{{ waiver.documentTitle }}</p>
        <a class="btn-primary mt-5 inline-block" :href="waiver.signUrl">Sign the waiver</a>
      </div>
    </template>
  </div>
</template>
