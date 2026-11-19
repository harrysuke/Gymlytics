<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../lib/api';
import { canManage, session } from '../../lib/auth';
import { describeError, notify } from '../../lib/toast';
import PageHeader from '../../components/PageHeader.vue';

interface Plan {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  features: string[];
  sortOrder: number;
}
interface Subscription {
  plan: Plan;
  status: string;
  currentPeriodEnd: string | null;
  features: string[];
}

const plans = ref<Plan[]>([]);
const subscription = ref<Subscription | null>(null);
const loading = ref(true);
const busySlug = ref<string | null>(null);
const featureLabels: Record<string, string> = {
  members: 'Member management',
  schedule: 'Class scheduling',
  attendance: 'Attendance & kiosk',
  billing: 'Billing & POS',
  waivers: 'Digital waivers',
  automated_marketing: 'Automated marketing',
  csv_import: 'CSV data import',
  widgets: 'Embeddable widgets',
  curriculum_video: 'Video curriculum',
  cross_training: 'Cross-training passes',
  advanced_analytics: 'Advanced analytics',
  multi_site: 'Multi-site rollups',
};

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [planRows, current] = await Promise.all([
      api.get<Plan[]>('/v1/saas/plans'),
      api.get<Subscription>('/v1/saas/subscription'),
    ]);
    plans.value = planRows.data;
    subscription.value = current.data;
  } catch (caught) {
    notify.error(describeError(caught));
  } finally {
    loading.value = false;
  }
}

async function change(slug: string): Promise<void> {
  busySlug.value = slug;
  try {
    await api.post('/v1/saas/subscription/change', { planSlug: slug });
    notify.success(`Switched to ${slug}`);
    await load();
  } catch (caught) {
    notify.error(describeError(caught));
  } finally {
    busySlug.value = null;
  }
}

onMounted(load);
</script>

<template>
  <div class="space-y-6">
    <PageHeader title="Plan & features" subtitle="Upgrade as the academy grows. Feature changes apply immediately.">
      <template #actions>
        <span class="chip">{{ session.academy?.name }}</span>
      </template>
    </PageHeader>

    <div v-if="subscription" class="card flex flex-wrap items-center justify-between gap-4 p-5">
      <div>
        <p class="text-xs uppercase tracking-wide text-ink-500">Current plan</p>
        <p class="mt-1 font-display text-2xl font-bold text-ink-900">{{ subscription.plan.name }}</p>
        <p class="text-sm text-ink-500">{{ subscription.status }} · {{ subscription.features.length }} modules enabled</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <span v-for="feature in subscription.features" :key="feature" class="chip border-mat-200 bg-mat-50 text-mat-800">
          {{ featureLabels[feature] ?? feature }}
        </span>
      </div>
    </div>

    <div class="grid gap-5 lg:grid-cols-3">
      <div v-for="plan in plans" :key="plan.id" class="card flex flex-col p-6"
        :class="subscription?.plan.slug === plan.slug ? 'ring-2 ring-mat-600' : ''">
        <div class="flex items-start justify-between">
          <div>
            <h2 class="font-display text-xl font-bold text-ink-900">{{ plan.name }}</h2>
            <p class="mt-1 text-sm text-ink-500">{{ plan.description }}</p>
          </div>
          <span v-if="subscription?.plan.slug === plan.slug" class="chip">Current</span>
        </div>
        <p class="mt-5 font-display text-3xl font-extrabold text-ink-900">
          {{ plan.priceCents === 0 ? 'Free' : `RM ${(plan.priceCents / 100).toFixed(0)}` }}
          <span v-if="plan.priceCents" class="text-sm font-normal text-ink-500">/ month</span>
        </p>
        <ul class="mt-5 flex-1 space-y-2 text-sm text-ink-700">
          <li v-for="feature in plan.features" :key="feature" class="flex gap-2">
            <span class="text-mat-600">✓</span>{{ featureLabels[feature] ?? feature }}
          </li>
        </ul>
        <button v-if="canManage && subscription?.plan.slug !== plan.slug" class="btn-primary mt-6 w-full"
          type="button" :disabled="busySlug === plan.slug" @click="change(plan.slug)">
          {{ busySlug === plan.slug ? 'Switching…' : `Switch to ${plan.name}` }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="card p-8 text-center text-sm text-ink-500">Loading plans…</div>
  </div>
</template>
