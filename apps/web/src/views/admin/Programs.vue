<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../lib/api';
import { canCoach, canManage } from '../../lib/auth';
import { humanize } from '../../lib/format';
import { describeError, notify } from '../../lib/toast';
import PageHeader from '../../components/PageHeader.vue';
import ModalDialog from '../../components/ModalDialog.vue';
import EmptyState from '../../components/EmptyState.vue';

interface Rank {
  id: string;
  name: string;
  orderIndex: number;
  maxStripes: number;
  colorHex: string | null;
  minMonthsInRank: number;
  minClassesInRank: number;
  minMatHours: number;
}

interface Program {
  id: string;
  name: string;
  discipline: string;
  description: string | null;
  defaultDurationMinutes: number;
  defaultCapacity: number;
  isActive: boolean;
  ranks: Rank[];
}

interface Technique {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
}

const programs = ref<Program[]>([]);
const techniques = ref<Record<string, Technique[]>>({});
const activeId = ref<string | null>(null);
const loading = ref(true);

const programOpen = ref(false);
const rankOpen = ref(false);
const techniqueOpen = ref(false);
const busy = ref(false);

const programForm = ref({ name: '', discipline: 'bjj', defaultDurationMinutes: 90, defaultCapacity: 24, description: '' });
const rankForm = ref({ name: '', maxStripes: 4, minMonthsInRank: 0, minClassesInRank: 0, minMatHours: 0, colorHex: '#e5e7eb' });
const techniqueForm = ref({ name: '', category: 'sweep', description: '' });

const DISCIPLINES = [
  'bjj', 'nogi', 'muay_thai', 'boxing', 'wrestling', 'judo', 'karate', 'mma',
];

const activeProgram = computed(() => programs.value.find((program) => program.id === activeId.value) ?? null);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const { data } = await api.get<Program[]>('/v1/programs');
    programs.value = data;
    activeId.value ??= data[0]?.id ?? null;
    if (activeId.value) await loadTechniques(activeId.value);
  } catch (error) {
    notify.error(describeError(error));
  } finally {
    loading.value = false;
  }
}

async function loadTechniques(programId: string): Promise<void> {
  try {
    const { data } = await api.get<Technique[]>(`/v1/programs/${programId}/techniques`);
    techniques.value = { ...techniques.value, [programId]: data };
  } catch {
    techniques.value = { ...techniques.value, [programId]: [] };
  }
}

async function selectProgram(id: string): Promise<void> {
  activeId.value = id;
  if (!techniques.value[id]) await loadTechniques(id);
}

async function createProgram(): Promise<void> {
  busy.value = true;
  try {
    await api.post('/v1/programs', {
      name: programForm.value.name.trim(),
      discipline: programForm.value.discipline,
      defaultDurationMinutes: Number(programForm.value.defaultDurationMinutes),
      defaultCapacity: Number(programForm.value.defaultCapacity),
      ...(programForm.value.description.trim() ? { description: programForm.value.description.trim() } : {}),
    });
    notify.success('Program created with a standard belt ladder');
    programOpen.value = false;
    programForm.value.name = '';
    await load();
  } catch (error) {
    notify.error(describeError(error));
  } finally {
    busy.value = false;
  }
}

async function createRank(): Promise<void> {
  if (!activeId.value) return;
  busy.value = true;
  try {
    await api.post(`/v1/programs/${activeId.value}/ranks`, {
      name: rankForm.value.name.trim(),
      maxStripes: Number(rankForm.value.maxStripes),
      minMonthsInRank: Number(rankForm.value.minMonthsInRank),
      minClassesInRank: Number(rankForm.value.minClassesInRank),
      minMatHours: Number(rankForm.value.minMatHours),
      colorHex: rankForm.value.colorHex,
      orderIndex: (activeProgram.value?.ranks.length ?? 0),
    });
    notify.success('Rank added');
    rankOpen.value = false;
    rankForm.value.name = '';
    await load();
  } catch (error) {
    notify.error(describeError(error));
  } finally {
    busy.value = false;
  }
}

async function createTechnique(): Promise<void> {
  if (!activeId.value) return;
  busy.value = true;
  try {
    await api.post(`/v1/programs/${activeId.value}/techniques`, {
      name: techniqueForm.value.name.trim(),
      category: techniqueForm.value.category,
      ...(techniqueForm.value.description.trim() ? { description: techniqueForm.value.description.trim() } : {}),
    });
    notify.success('Technique added to the curriculum');
    techniqueOpen.value = false;
    techniqueForm.value.name = '';
    await loadTechniques(activeId.value);
  } catch (error) {
    notify.error(describeError(error));
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <PageHeader title="Programs" subtitle="Disciplines, belt ladders and the curriculum behind promotion eligibility." :action-label="canManage ? 'New program' : undefined" @action="programOpen = true" />

    <div v-if="loading" class="grid gap-4 lg:grid-cols-[260px_1fr]">
      <div class="skeleton h-64" />
      <div class="skeleton h-96" />
    </div>

    <EmptyState v-else-if="!programs.length" title="No programs yet" body="Create your first discipline to start scheduling classes." icon="🥋" />

    <div v-else class="grid gap-4 lg:grid-cols-[260px_1fr]">
      <!-- Program list -->
      <aside class="card h-fit overflow-hidden">
        <ul class="divide-y divide-ink-100">
          <li v-for="program in programs" :key="program.id">
            <button
              class="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition"
              :class="activeId === program.id ? 'bg-mat-50' : 'hover:bg-ink-50'"
              @click="selectProgram(program.id)"
            >
              <div class="min-w-0">
                <p class="truncate text-sm font-semibold" :class="activeId === program.id ? 'text-mat-800' : 'text-ink-800'">
                  {{ program.name }}
                </p>
                <p class="text-[11px] capitalize text-ink-500">{{ humanize(program.discipline) }}</p>
              </div>
              <span class="chip bg-ink-100 text-ink-600">{{ program.ranks.length }}</span>
            </button>
          </li>
        </ul>
      </aside>

      <!-- Detail -->
      <div v-if="activeProgram" class="space-y-4">
        <section class="card-pad">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 class="font-display text-lg font-bold text-ink-900">{{ activeProgram.name }}</h2>
              <p class="text-sm text-ink-500">
                {{ humanize(activeProgram.discipline) }} · {{ activeProgram.defaultDurationMinutes }} min ·
                capacity {{ activeProgram.defaultCapacity }}
              </p>
            </div>
            <div class="flex gap-2">
              <button v-if="canCoach" class="btn-ghost btn-sm" @click="rankOpen = true">Add rank</button>
              <button v-if="canCoach" class="btn-ghost btn-sm" @click="techniqueOpen = true">Add technique</button>
            </div>
          </div>
          <p v-if="activeProgram.description" class="mt-3 text-sm text-ink-600">{{ activeProgram.description }}</p>
        </section>

        <!-- Belt ladder -->
        <section class="card overflow-hidden">
          <header class="border-b border-ink-100 px-5 py-3">
            <h3 class="text-sm font-semibold text-ink-900">Belt ladder</h3>
            <p class="text-xs text-ink-500">Promotion thresholds are checked against real attendance.</p>
          </header>
          <div class="overflow-x-auto">
            <table class="w-full min-w-[560px]">
              <thead class="border-b border-ink-100 bg-ink-50/60">
                <tr>
                  <th class="th">#</th>
                  <th class="th">Rank</th>
                  <th class="th">Stripes</th>
                  <th class="th">Min months</th>
                  <th class="th">Min classes</th>
                  <th class="th">Min mat hours</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-ink-100">
                <tr v-for="(rank, index) in activeProgram.ranks" :key="rank.id" class="row-hover">
                  <td class="td text-xs text-ink-400">{{ index + 1 }}</td>
                  <td class="td">
                    <span class="flex items-center gap-2">
                      <span class="h-4 w-4 rounded-sm border border-ink-200" :style="{ backgroundColor: rank.colorHex ?? '#e5e7eb' }" />
                      <span class="font-medium">{{ rank.name }}</span>
                    </span>
                  </td>
                  <td class="td text-xs tabular">{{ rank.maxStripes }}</td>
                  <td class="td text-xs tabular">{{ rank.minMonthsInRank }}</td>
                  <td class="td text-xs tabular">{{ rank.minClassesInRank }}</td>
                  <td class="td text-xs tabular">{{ rank.minMatHours }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- Techniques -->
        <section class="card">
          <header class="border-b border-ink-100 px-5 py-3">
            <h3 class="text-sm font-semibold text-ink-900">Curriculum</h3>
          </header>
          <div v-if="!(techniques[activeProgram.id] ?? []).length" class="p-5">
            <EmptyState title="No techniques yet" body="Add the techniques coaches teach for this program." icon="📚" />
          </div>
          <ul v-else class="grid gap-2 p-4 sm:grid-cols-2 xl:grid-cols-3">
            <li v-for="technique in techniques[activeProgram.id]" :key="technique.id" class="rounded-xl border border-ink-200 p-3">
              <p class="text-sm font-semibold text-ink-900">{{ technique.name }}</p>
              <p class="mt-0.5 text-xs capitalize text-ink-500">{{ humanize(technique.category) }}</p>
            </li>
          </ul>
        </section>
      </div>
    </div>

    <!-- New program -->
    <ModalDialog :open="programOpen" title="New program" description="A discipline taught at the academy. A standard IBJJF belt ladder is seeded automatically." width="max-w-xl" @close="programOpen = false">
      <form id="new-program" class="grid gap-4 sm:grid-cols-2" @submit.prevent="createProgram">
        <div class="sm:col-span-2">
          <label class="label" for="pr-name">Name</label>
          <input id="pr-name" v-model="programForm.name" class="input" placeholder="e.g. Brazilian Jiu-Jitsu" required />
        </div>
        <div>
          <label class="label" for="pr-disc">Discipline</label>
          <select id="pr-disc" v-model="programForm.discipline" class="input">
            <option v-for="discipline in DISCIPLINES" :key="discipline" :value="discipline">
              {{ humanize(discipline) }}
            </option>
          </select>
        </div>
        <div>
          <label class="label" for="pr-dur">Default duration (min)</label>
          <input id="pr-dur" v-model.number="programForm.defaultDurationMinutes" class="input" type="number" min="15" max="240" />
        </div>
        <div>
          <label class="label" for="pr-cap">Default capacity</label>
          <input id="pr-cap" v-model.number="programForm.defaultCapacity" class="input" type="number" min="1" max="300" />
        </div>
        <div class="sm:col-span-2">
          <label class="label" for="pr-desc">Description</label>
          <textarea id="pr-desc" v-model="programForm.description" class="input" rows="2" />
        </div>
      </form>
      <template #footer>
        <button class="btn-ghost" @click="programOpen = false">Cancel</button>
        <button class="btn-primary" form="new-program" type="submit" :disabled="busy">Create</button>
      </template>
    </ModalDialog>

    <!-- New rank -->
    <ModalDialog :open="rankOpen" :title="`Add rank to ${activeProgram?.name ?? ''}`" @close="rankOpen = false">
      <form id="new-rank" class="grid gap-4 sm:grid-cols-2" @submit.prevent="createRank">
        <div class="sm:col-span-2">
          <label class="label" for="rk-name">Name</label>
          <input id="rk-name" v-model="rankForm.name" class="input" placeholder="e.g. Purple" required />
        </div>
        <div>
          <label class="label" for="rk-stripes">Max stripes</label>
          <input id="rk-stripes" v-model.number="rankForm.maxStripes" class="input" type="number" min="0" max="4" />
        </div>
        <div>
          <label class="label" for="rk-color">Colour</label>
          <input id="rk-color" v-model="rankForm.colorHex" class="input h-11" type="color" />
        </div>
        <div>
          <label class="label" for="rk-months">Min months</label>
          <input id="rk-months" v-model.number="rankForm.minMonthsInRank" class="input" type="number" min="0" />
        </div>
        <div>
          <label class="label" for="rk-classes">Min classes</label>
          <input id="rk-classes" v-model.number="rankForm.minClassesInRank" class="input" type="number" min="0" />
        </div>
        <div class="sm:col-span-2">
          <label class="label" for="rk-hours">Min mat hours</label>
          <input id="rk-hours" v-model.number="rankForm.minMatHours" class="input" type="number" min="0" />
        </div>
      </form>
      <template #footer>
        <button class="btn-ghost" @click="rankOpen = false">Cancel</button>
        <button class="btn-primary" form="new-rank" type="submit" :disabled="busy">Add rank</button>
      </template>
    </ModalDialog>

    <!-- New technique -->
    <ModalDialog :open="techniqueOpen" title="Add technique" @close="techniqueOpen = false">
      <form id="new-tech" class="space-y-4" @submit.prevent="createTechnique">
        <div>
          <label class="label" for="tc-name">Name</label>
          <input id="tc-name" v-model="techniqueForm.name" class="input" placeholder="e.g. Scissor sweep" required />
        </div>
        <div>
          <label class="label" for="tc-cat">Category</label>
          <select id="tc-cat" v-model="techniqueForm.category" class="input">
            <option v-for="category in ['sweep', 'submission', 'escape', 'takedown', 'guard_pass', 'guard_retention', 'positional', 'self_defense']" :key="category" :value="category">
              {{ humanize(category) }}
            </option>
          </select>
        </div>
        <div>
          <label class="label" for="tc-desc">Description</label>
          <textarea id="tc-desc" v-model="techniqueForm.description" class="input" rows="2" />
        </div>
      </form>
      <template #footer>
        <button class="btn-ghost" @click="techniqueOpen = false">Cancel</button>
        <button class="btn-primary" form="new-tech" type="submit" :disabled="busy">Add technique</button>
      </template>
    </ModalDialog>
  </div>
</template>
