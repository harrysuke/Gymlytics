<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../lib/api';
import { canManage } from '../../lib/auth';
import { describeError, notify } from '../../lib/toast';
import PageHeader from '../../components/PageHeader.vue';
import EmptyState from '../../components/EmptyState.vue';

interface Widget {
  id: string;
  kind: 'schedule' | 'trial_form' | 'waiver_link';
  label: string;
  token: string;
  config: Record<string, unknown>;
  enabled: boolean;
  embedCode: string;
}

const widgets = ref<Widget[]>([]);
const error = ref<string | null>(null);
const label = ref('');
const kind = ref<Widget['kind']>('schedule');
const busy = ref(false);
const copied = ref<string | null>(null);

const kindLabels: Record<string, string> = {
  schedule: 'Class schedule',
  trial_form: 'Trial booking form',
  waiver_link: 'Waiver link',
};
const grouped = computed(() => ({
  schedule: widgets.value.filter((row) => row.kind === 'schedule'),
  trial_form: widgets.value.filter((row) => row.kind === 'trial_form'),
  waiver_link: widgets.value.filter((row) => row.kind === 'waiver_link'),
}));

async function load(): Promise<void> {
  try {
    widgets.value = (await api.get<Widget[]>('/v1/widgets')).data;
  } catch (caught) {
    error.value = describeError(caught);
  }
}

async function create(): Promise<void> {
  if (!label.value.trim()) return;
  busy.value = true;
  try {
    await api.post('/v1/widgets', { kind: kind.value, label: label.value.trim(), config: {} });
    label.value = '';
    notify.success('Widget created');
    await load();
  } catch (caught) {
    notify.error(describeError(caught));
  } finally {
    busy.value = false;
  }
}

async function toggle(widget: Widget): Promise<void> {
  try {
    await api.patch(`/v1/widgets/${widget.id}`, { enabled: !widget.enabled });
    await load();
  } catch (caught) {
    notify.error(describeError(caught));
  }
}

async function copy(widget: Widget): Promise<void> {
  try {
    await navigator.clipboard.writeText(widget.embedCode);
    copied.value = widget.id;
    setTimeout(() => { copied.value = null; }, 1800);
  } catch {
    notify.error('Clipboard unavailable — select the code manually');
  }
}

onMounted(load);
</script>

<template>
  <div class="space-y-6">
    <PageHeader title="Embeddable widgets" subtitle="Drop your schedule, trial form and waiver link straight into any website." />

    <div v-if="error" class="card border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
      {{ error }} — <RouterLink class="underline" to="/admin/plan">review your plan</RouterLink>.
    </div>

    <div class="card flex flex-wrap items-end gap-3 p-5">
      <div class="min-w-48 flex-1">
        <label class="label" for="widget-label">Widget name</label>
        <input id="widget-label" v-model="label" class="input" placeholder="Public schedule" />
      </div>
      <div>
        <label class="label" for="widget-kind">Type</label>
        <select id="widget-kind" v-model="kind" class="input">
          <option value="schedule">Class schedule</option>
          <option value="trial_form">Trial booking form</option>
          <option value="waiver_link">Waiver link</option>
        </select>
      </div>
      <button v-if="canManage" class="btn-primary" type="button" :disabled="busy || !label.trim()" @click="create">
        {{ busy ? 'Creating…' : 'Create widget' }}
      </button>
    </div>

    <div v-for="(group, groupKind) in grouped" :key="groupKind" class="card overflow-hidden">
      <div class="border-b border-ink-100 px-5 py-4">
        <h2 class="font-display text-lg font-bold text-ink-900">{{ kindLabels[groupKind] }}</h2>
      </div>
      <div v-if="group.length" class="divide-y divide-ink-100">
        <div v-for="widget in group" :key="widget.id" class="space-y-3 p-5">
          <div class="flex flex-wrap items-center gap-3">
            <span class="font-semibold text-ink-900">{{ widget.label }}</span>
            <span class="chip" :class="widget.enabled ? 'text-emerald-700' : 'text-ink-500'">
              {{ widget.enabled ? 'Live' : 'Disabled' }}
            </span>
            <code class="ml-auto rounded bg-ink-50 px-2 py-1 font-mono text-xs text-ink-600">{{ widget.token }}</code>
            <button class="btn-ghost" type="button" @click="toggle(widget)">{{ widget.enabled ? 'Disable' : 'Enable' }}</button>
            <button class="btn-ghost" type="button" @click="copy(widget)">{{ copied === widget.id ? 'Copied!' : 'Copy embed code' }}</button>
          </div>
          <textarea class="input font-mono text-xs" rows="2" readonly :value="widget.embedCode" />
        </div>
      </div>
      <EmptyState v-else title="No widgets yet" message="Create one above, then paste the embed code into your site." />
    </div>
  </div>
</template>
