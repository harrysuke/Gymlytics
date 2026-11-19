<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../lib/api';
import { canCoach } from '../../lib/auth';
import { date } from '../../lib/format';
import { describeError, notify } from '../../lib/toast';
import PageHeader from '../../components/PageHeader.vue';
import EmptyState from '../../components/EmptyState.vue';

interface Video {
  id: string;
  title: string;
  description: string | null;
  url: string;
  beltSlug: string | null;
  durationSeconds: number;
  sortOrder: number;
  published: boolean;
}
interface ClassRow { id: string; title: string; startsAt: string }
interface Recap {
  id: string;
  classId: string;
  summary: string;
  videoUrl: string | null;
  techniques: string[];
  coachName: string | null;
}

const videos = ref<Video[]>([]);
const classes = ref<ClassRow[]>([]);
const recap = ref<Recap | null>(null);
const activeBelt = ref('all');
const selectedClass = ref('');
const error = ref<string | null>(null);
const videoForm = ref({ title: '', description: '', url: '', beltSlug: 'white', durationSeconds: 0 });
const recapForm = ref({ summary: '', videoUrl: '', techniques: '' });

const belts = computed(() => [...new Set(videos.value.map((row) => row.beltSlug ?? 'unassigned'))]);
const filtered = computed(() => activeBelt.value === 'all'
  ? videos.value
  : videos.value.filter((row) => (row.beltSlug ?? 'unassigned') === activeBelt.value));

async function load(): Promise<void> {
  try {
    const [videoRows, classRows] = await Promise.all([
      api.get<Video[]>('/v1/curriculum/videos'),
      api.get<ClassRow[]>('/v1/classes?limit=100'),
    ]);
    videos.value = videoRows.data;
    classes.value = classRows.data;
  } catch (caught) {
    error.value = describeError(caught);
  }
}

async function addVideo(): Promise<void> {
  try {
    await api.post('/v1/curriculum/videos', {
      title: videoForm.value.title,
      description: videoForm.value.description || undefined,
      url: videoForm.value.url,
      beltSlug: videoForm.value.beltSlug,
      durationSeconds: Number(videoForm.value.durationSeconds) || 0,
      sortOrder: videos.value.length,
    });
    videoForm.value = { title: '', description: '', url: '', beltSlug: 'white', durationSeconds: 0 };
    notify.success('Technique added to the library');
    await load();
  } catch (caught) {
    notify.error(describeError(caught));
  }
}

async function removeVideo(id: string): Promise<void> {
  try {
    await api.delete(`/v1/curriculum/videos/${id}`);
    await load();
  } catch (caught) {
    notify.error(describeError(caught));
  }
}

async function loadRecap(): Promise<void> {
  if (!selectedClass.value) return;
  try {
    recap.value = (await api.get<Recap | null>(`/v1/classes/${selectedClass.value}/recap`)).data;
    recapForm.value = recap.value
      ? {
          summary: recap.value.summary,
          videoUrl: recap.value.videoUrl ?? '',
          techniques: recap.value.techniques.join(', '),
        }
      : { summary: '', videoUrl: '', techniques: '' };
  } catch (caught) {
    notify.error(describeError(caught));
  }
}

async function saveRecap(): Promise<void> {
  if (!selectedClass.value) return;
  try {
    await api.put(`/v1/classes/${selectedClass.value}/recap`, {
      summary: recapForm.value.summary,
      ...(recapForm.value.videoUrl ? { videoUrl: recapForm.value.videoUrl } : {}),
      techniques: recapForm.value.techniques.split(',').map((item) => item.trim()).filter(Boolean),
    });
    notify.success('Recap saved');
    await loadRecap();
  } catch (caught) {
    notify.error(describeError(caught));
  }
}

onMounted(load);
</script>

<template>
  <div class="space-y-6">
    <PageHeader title="Curriculum library" subtitle="Technique videos by belt, plus coaching recaps on the sessions that mattered." />

    <div v-if="error" class="card border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
      {{ error }} — <RouterLink class="underline" to="/admin/plan">upgrade your plan</RouterLink> for video curriculum.
    </div>

    <div class="grid gap-6 lg:grid-cols-3">
      <div class="card p-5 lg:col-span-2">
        <div class="flex flex-wrap items-center gap-2">
          <h2 class="mr-auto font-display text-lg font-bold text-ink-900">Technique videos</h2>
          <button class="chip" :class="activeBelt === 'all' ? 'bg-mat-600 text-white' : ''" type="button" @click="activeBelt = 'all'">All</button>
          <button v-for="belt in belts" :key="belt" class="chip capitalize"
            :class="activeBelt === belt ? 'bg-mat-600 text-white' : ''" type="button" @click="activeBelt = belt">
            {{ belt }}
          </button>
        </div>

        <div v-if="filtered.length" class="mt-5 grid gap-4 sm:grid-cols-2">
          <article v-for="video in filtered" :key="video.id" class="overflow-hidden rounded-xl border border-ink-200">
            <a :href="video.url" target="_blank" rel="noopener" class="block bg-ink-900 p-6 text-center">
              <span class="text-4xl">▶</span>
            </a>
            <div class="space-y-1 p-4">
              <p class="font-semibold text-ink-900">{{ video.title }}</p>
              <p class="text-sm text-ink-500">{{ video.description }}</p>
              <div class="flex items-center gap-2 pt-2">
                <span class="chip capitalize">{{ video.beltSlug ?? 'unassigned' }}</span>
                <span v-if="video.durationSeconds" class="text-xs text-ink-500">{{ Math.round(video.durationSeconds / 60) }} min</span>
                <button v-if="canCoach" class="ml-auto text-xs text-rose-600 hover:underline" type="button" @click="removeVideo(video.id)">Remove</button>
              </div>
            </div>
          </article>
        </div>
        <EmptyState v-else title="Nothing in this belt yet" message="Add a technique video to get started." />
      </div>

      <div class="space-y-6">
        <div v-if="canCoach" class="card space-y-3 p-5">
          <h2 class="font-display text-lg font-bold text-ink-900">Add a technique</h2>
          <div><label class="label" for="video-title">Title</label><input id="video-title" v-model="videoForm.title" class="input" /></div>
          <div><label class="label" for="video-url">Video URL</label><input id="video-url" v-model="videoForm.url" class="input" type="url" placeholder="https://…" /></div>
          <div><label class="label" for="video-belt">Belt level</label><input id="video-belt" v-model="videoForm.beltSlug" class="input" /></div>
          <div><label class="label" for="video-duration">Duration (seconds)</label><input id="video-duration" v-model.number="videoForm.durationSeconds" class="input" type="number" min="0" /></div>
          <div><label class="label" for="video-desc">Notes</label><textarea id="video-desc" v-model="videoForm.description" class="input" rows="2" /></div>
          <button class="btn-primary w-full" type="button" :disabled="!videoForm.title || !videoForm.url" @click="addVideo">Add video</button>
        </div>

        <div class="card space-y-3 p-5">
          <h2 class="font-display text-lg font-bold text-ink-900">Post-class recap</h2>
          <div>
            <label class="label" for="recap-class">Class session</label>
            <select id="recap-class" v-model="selectedClass" class="input" @change="loadRecap">
              <option value="">Choose a class…</option>
              <option v-for="row in classes" :key="row.id" :value="row.id">{{ row.title }} · {{ date(row.startsAt) }}</option>
            </select>
          </div>
          <template v-if="selectedClass">
            <div><label class="label" for="recap-summary">Summary</label><textarea id="recap-summary" v-model="recapForm.summary" class="input" rows="4" /></div>
            <div><label class="label" for="recap-techniques">Techniques (comma separated)</label><input id="recap-techniques" v-model="recapForm.techniques" class="input" /></div>
            <div><label class="label" for="recap-video">Optional video URL</label><input id="recap-video" v-model="recapForm.videoUrl" class="input" type="url" /></div>
            <button v-if="canCoach" class="btn-primary w-full" type="button" :disabled="!recapForm.summary" @click="saveRecap">Save recap</button>
            <p v-if="recap?.coachName" class="text-xs text-ink-500">Posted by {{ recap.coachName }}</p>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
