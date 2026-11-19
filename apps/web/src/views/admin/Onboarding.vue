<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../lib/api';
import { canManage } from '../../lib/auth';
import { describeError, notify } from '../../lib/toast';
import PageHeader from '../../components/PageHeader.vue';

interface Onboarding {
  currentStep: string;
  completedSteps: string[];
  completedAt: string | null;
  progressPercent: number;
}

const state = ref<Onboarding | null>(null);
const busy = ref(false);
const steps = [
  { slug: 'profile', label: 'Academy profile', hint: 'Name, currency, timezone and branding', to: '/admin' },
  { slug: 'locations', label: 'Locations', hint: 'Add branches and staff access', to: '/admin/network' },
  { slug: 'programs', label: 'Programs & belts', hint: 'Set up disciplines and rank ladders', to: '/admin/programs' },
  { slug: 'members', label: 'Import members', hint: 'Bring over your roster from CSV', to: '/admin/imports' },
  { slug: 'billing', label: 'Billing', hint: 'Plans, products and payment providers', to: '/admin/billing' },
  { slug: 'team', label: 'Invite your team', hint: 'Coaches and front-desk PINs', to: '/admin/members' },
] as const;

const doneCount = computed(() => state.value?.completedSteps.length ?? 0);

async function load(): Promise<void> {
  try {
    state.value = (await api.get<Onboarding>('/v1/saas/onboarding')).data;
  } catch (caught) {
    notify.error(describeError(caught));
  }
}

async function complete(step: string): Promise<void> {
  busy.value = true;
  try {
    state.value = (await api.post<Onboarding>('/v1/saas/onboarding/steps', { step })).data;
    notify.success('Step completed');
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
    <PageHeader title="Guided setup" subtitle="Everything you need to take your academy live, in six short steps." />

    <div class="card p-6">
      <div class="flex items-center justify-between text-sm">
        <span class="font-semibold text-ink-800">{{ doneCount }} of {{ steps.length }} complete</span>
        <span class="text-ink-500">{{ state?.progressPercent ?? 0 }}%</span>
      </div>
      <div class="mt-3 h-2 overflow-hidden rounded-full bg-ink-100">
        <div class="h-full rounded-full bg-mat-600 transition-all" :style="{ width: `${state?.progressPercent ?? 0}%` }" />
      </div>
      <p v-if="state?.completedAt" class="mt-3 text-sm text-mat-700">Setup complete — welcome to Gymlytics.</p>
    </div>

    <ol class="space-y-3">
      <li v-for="(step, index) in steps" :key="step.slug" class="card flex flex-wrap items-center gap-4 p-5">
        <span class="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold"
          :class="state?.completedSteps.includes(step.slug) ? 'bg-mat-600 text-white' : 'bg-ink-100 text-ink-600'">
          {{ state?.completedSteps.includes(step.slug) ? '✓' : index + 1 }}
        </span>
        <div class="min-w-0 flex-1">
          <p class="font-semibold text-ink-900">{{ step.label }}</p>
          <p class="text-sm text-ink-500">{{ step.hint }}</p>
        </div>
        <span v-if="state?.currentStep === step.slug" class="chip border-accent-200 bg-accent-50 text-accent-700">Next</span>
        <RouterLink class="btn-ghost" :to="step.to">Open</RouterLink>
        <button v-if="canManage && !state?.completedSteps.includes(step.slug)" class="btn-primary" type="button"
          :disabled="busy" @click="complete(step.slug)">Mark done</button>
      </li>
    </ol>
  </div>
</template>
