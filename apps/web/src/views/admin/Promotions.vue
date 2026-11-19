<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { api } from '../../lib/api';
import { canCoach } from '../../lib/auth';
import { describeError, notify } from '../../lib/toast';
import type { EligibilityRow } from '@gymlytics/shared';
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
  ranks: Rank[];
}

const rows = ref<EligibilityRow[]>([]);
const programs = ref<Program[]>([]);
const programFilter = ref('');
const loading = ref(true);
const onlyEligible = ref(false);

const promoteOpen = ref(false);
const target = ref<EligibilityRow | null>(null);
const stripes = ref(0);
const rankId = ref('');
const saving = ref(false);

const targetProgram = computed(() => programs.value.find((program) => program.id === target.value?.programId) ?? null);

const filtered = computed(() =>
  onlyEligible.value ? rows.value.filter((row) => row.eligible) : rows.value,
);

const counts = computed(() => ({
  stripe: rows.value.filter((row) => row.stripeEligible).length,
  belt: rows.value.filter((row) => row.beltEligible).length,
  total: rows.value.length,
}));

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [{ data }, programResponse] = await Promise.all([
      api.get<EligibilityRow[]>('/v1/promotions/eligibility', {
        query: { programId: programFilter.value || undefined },
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

function openPromote(row: EligibilityRow): void {
  target.value = row;
  const program = programs.value.find((entry) => entry.id === row.programId);
  const nextRank = program?.ranks.find((rank) => rank.id === row.nextRankId);
  const currentRank = program?.ranks.find((rank) => rank.id === row.currentRankId);

  // Stripe promotion keeps the belt; belt promotion jumps to the next rank at 0 stripes.
  if (row.suggestedAction === 'belt' && nextRank) {
    rankId.value = nextRank.id;
    stripes.value = 0;
  } else {
    rankId.value = currentRank?.id ?? nextRank?.id ?? '';
    stripes.value = Math.min((row.currentStripes ?? 0) + 1, (currentRank?.maxStripes ?? 4));
  }
  promoteOpen.value = true;
}

async function promote(): Promise<void> {
  if (!target.value) return;
  saving.value = true;
  try {
    await api.post('/v1/promotions', {
      userId: target.value.userId,
      programId: target.value.programId,
      toBeltRankId: rankId.value,
      toStripes: Number(stripes.value),
    });
    notify.success(`${target.value.memberName} promoted`);
    promoteOpen.value = false;
    await load();
  } catch (error) {
    notify.error(describeError(error));
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <PageHeader title="Promotions" subtitle="Eligibility is derived from mat hours, classes attended and curriculum progress.">
      <template #actions>
        <select v-model="programFilter" class="input w-auto" @change="load">
          <option value="">All programs</option>
          <option v-for="program in programs" :key="program.id" :value="program.id">{{ program.name }}</option>
        </select>
        <label class="flex cursor-pointer items-center gap-2 rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm">
          <input v-model="onlyEligible" type="checkbox" class="accent-mat-600" />
          Only eligible
        </label>
      </template>
    </PageHeader>

    <div class="mb-4 grid gap-3 sm:grid-cols-3">
      <div class="card-pad">
        <p class="text-xs font-semibold uppercase tracking-wide text-ink-500">Ready for a stripe</p>
        <p class="mt-2 font-display text-2xl font-bold tabular text-mat-700">{{ counts.stripe }}</p>
      </div>
      <div class="card-pad">
        <p class="text-xs font-semibold uppercase tracking-wide text-ink-500">Ready for a belt</p>
        <p class="mt-2 font-display text-2xl font-bold tabular text-emerald-600">{{ counts.belt }}</p>
      </div>
      <div class="card-pad">
        <p class="text-xs font-semibold uppercase tracking-wide text-ink-500">Tracked members</p>
        <p class="mt-2 font-display text-2xl font-bold tabular text-ink-900">{{ counts.total }}</p>
      </div>
    </div>

    <div class="card overflow-hidden">
      <div v-if="loading" class="space-y-2 p-4">
        <div v-for="n in 8" :key="n" class="skeleton h-12 w-full" />
      </div>

      <EmptyState v-else-if="!filtered.length" title="Nothing to review" body="No members match this filter yet." icon="🥋" />

      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[860px]">
          <thead class="border-b border-ink-100 bg-ink-50/60">
            <tr>
              <th class="th">Member</th>
              <th class="th">Program</th>
              <th class="th">Current rank</th>
              <th class="th">Time in rank</th>
              <th class="th">Classes</th>
              <th class="th">Mat hours</th>
              <th class="th">Curriculum</th>
              <th class="th">Status</th>
              <th class="th" />
            </tr>
          </thead>
          <tbody class="divide-y divide-ink-100">
            <tr v-for="row in filtered" :key="`${row.userId}-${row.programId}`" class="row-hover">
              <td class="td">
                <RouterLink :to="{ name: 'member-detail', params: { id: row.userId } }" class="font-medium text-mat-700 hover:underline">
                  {{ row.memberName }}
                </RouterLink>
              </td>
              <td class="td text-xs text-ink-600">{{ row.programName }}</td>
              <td class="td">
                <p class="text-xs font-semibold text-ink-800">{{ row.currentRankName ?? 'Unranked' }}</p>
                <p class="flex gap-0.5">
                  <span
                    v-for="n in row.currentStripes"
                    :key="n"
                    class="mt-1 inline-block h-1.5 w-3 rounded-sm bg-ink-700"
                  />
                </p>
              </td>
              <td class="td text-xs tabular">{{ row.monthsInRank }} mo</td>
              <td class="td text-xs tabular">{{ row.classesSincePromotion }}</td>
              <td class="td text-xs tabular">{{ row.matHoursSincePromotion }} h</td>
              <td class="td text-xs tabular">
                <span :class="row.techniquesCompleted >= row.techniquesRequired ? 'text-emerald-600' : 'text-ink-600'">
                  {{ row.techniquesCompleted }}/{{ row.techniquesRequired }}
                </span>
              </td>
              <td class="td">
                <span
                  class="chip"
                  :class="row.beltEligible
                    ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/15'
                    : row.stripeEligible
                      ? 'bg-mat-50 text-mat-700 ring-1 ring-mat-600/15'
                      : 'bg-ink-100 text-ink-500'"
                >
                  {{ row.beltEligible ? 'Belt ready' : row.stripeEligible ? 'Stripe ready' : 'In progress' }}
                </span>
                <p v-if="row.missing.length" class="mt-1 text-[11px] text-ink-400">
                  {{ row.missing.slice(0, 2).join(' · ') }}
                </p>
              </td>
              <td class="td text-right">
                <button v-if="canCoach" class="btn-ghost btn-sm" @click="openPromote(row)">Promote</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <ModalDialog
      :open="promoteOpen"
      title="Record a promotion"
      :description="target ? `${target.memberName} · ${target.programName}` : ''"
      @close="promoteOpen = false"
    >
      <div v-if="target" class="space-y-4">
        <div class="rounded-xl bg-ink-50 p-3 text-xs text-ink-600">
          <p>{{ target.monthsInRank }} months in rank · {{ target.classesSincePromotion }} classes · {{ target.matHoursSincePromotion }} mat hours</p>
          <p v-if="target.missing.length" class="mt-1 text-amber-700">Outstanding: {{ target.missing.join(', ') }}</p>
        </div>

        <div>
          <label class="label" for="rank">Belt</label>
          <select id="rank" v-model="rankId" class="input">
            <option v-for="rank in targetProgram?.ranks ?? []" :key="rank.id" :value="rank.id">
              {{ rank.name }}
            </option>
          </select>
        </div>

        <div>
          <label class="label" for="stripes">Stripes</label>
          <div class="flex gap-2">
            <button
              v-for="n in 5"
              :key="n"
              class="h-10 flex-1 rounded-lg border text-sm font-semibold transition"
              :class="stripes === n - 1 ? 'border-mat-600 bg-mat-600 text-white' : 'border-ink-200 bg-white text-ink-600 hover:border-mat-400'"
              @click="stripes = n - 1"
            >
              {{ n - 1 }}
            </button>
          </div>
        </div>
      </div>

      <template #footer>
        <button class="btn-ghost" @click="promoteOpen = false">Cancel</button>
        <button class="btn-primary" :disabled="saving || !rankId" @click="promote">
          {{ saving ? 'Recording…' : 'Confirm promotion' }}
        </button>
      </template>
    </ModalDialog>
  </div>
</template>
