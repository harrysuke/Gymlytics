<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api, fetchBlobUrl } from '../../lib/api';
import { describeError } from '../../lib/toast';
import { loadSession } from '../../lib/kiosk';

interface Template {
  id: string;
  waiverType: string;
  version: number;
  title: string;
  bodyMarkdown: string;
}

interface Member {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
}

const route = useRoute();
const session = loadSession();

const templates = ref<Template[]>([]);
const members = ref<Member[]>([]);
const selectedTemplateId = ref('');
const selectedUserId = ref(typeof route.query.userId === 'string' ? route.query.userId : '');
const signerName = ref('');
const dateOfBirth = ref('');
const guardianName = ref('');
const agreed = ref(false);

const loading = ref(true);
const submitting = ref(false);
const error = ref<string | null>(null);
const signedWaiverId = ref<string | null>(null);

const canvas = ref<HTMLCanvasElement | null>(null);
const drawing = ref(false);
const strokeCount = ref(0);
const paths: string[] = [];

const selectedTemplate = computed(() => templates.value.find((item) => item.id === selectedTemplateId.value) ?? null);
const selectedMember = computed(() => members.value.find((item) => item.id === selectedUserId.value) ?? null);

const isMinor = computed(() => {
  if (!dateOfBirth.value) return false;
  const dob = new Date(dateOfBirth.value);
  const age = (Date.now() - dob.getTime()) / (365.25 * 86_400_000);
  return age < 18;
});

const canSubmit = computed(
  () =>
    Boolean(selectedTemplate.value) &&
    Boolean(selectedUserId.value) &&
    signerName.value.trim().length > 2 &&
    agreed.value &&
    strokeCount.value > 0 &&
    (!isMinor.value || guardianName.value.trim().length > 2) &&
    !submitting.value,
);

/** Strip the markdown the API stores so the signer reads clean prose. */
const renderedBody = computed(() => {
  const body = selectedTemplate.value?.bodyMarkdown ?? '';
  return body
    .split('\n')
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .filter(Boolean);
});

async function load(): Promise<void> {
  loading.value = true;
  try {
    const templateResponse = await api.get<Template[]>(
      '/v1/waivers/templates',
      session ? { token: session.token } : {},
    );
    templates.value = templateResponse.data;
    // Prefer the general participation waiver; drop-in templates are for visitors.
    selectedTemplateId.value =
      templateResponse.data.find((template) => template.waiverType === 'general')?.id ??
      templateResponse.data[0]?.id ??
      '';

    if (session) {
      const bootstrap = await api.get<{ members: Member[] }>('/v1/kiosk/bootstrap', { token: session.token });
      members.value = bootstrap.data.members;
    }
  } catch (caught) {
    error.value = describeError(caught);
  } finally {
    loading.value = false;
  }
}

function canvasContext(): CanvasRenderingContext2D | null {
  const element = canvas.value;
  if (!element) return null;
  const ctx = element.getContext('2d');
  if (!ctx) return null;
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#0f172a';
  return ctx;
}

function start(event: PointerEvent): void {
  const ctx = canvasContext();
  if (!ctx) return;
  drawing.value = true;
  const rect = (event.target as HTMLCanvasElement).getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 700;
  const y = ((event.clientY - rect.top) / rect.height) * 220;
  paths.push(`M ${x.toFixed(1)} ${y.toFixed(1)}`);
  ctx.beginPath();
  ctx.moveTo(x, y);
  strokeCount.value += 1;
}

function move(event: PointerEvent): void {
  if (!drawing.value) return;
  const ctx = canvasContext();
  if (!ctx) return;
  const rect = (event.target as HTMLCanvasElement).getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 700;
  const y = ((event.clientY - rect.top) / rect.height) * 220;
  paths.push(`L ${x.toFixed(1)} ${y.toFixed(1)}`);
  ctx.lineTo(x, y);
  ctx.stroke();
}

function clear(): void {
  paths.length = 0;
  strokeCount.value = 0;
  canvas.value?.getContext('2d')?.clearRect(0, 0, 700, 220);
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function submit(): Promise<void> {
  if (!canSubmit.value || !selectedTemplate.value) return;
  submitting.value = true;
  error.value = null;
  try {
    const template = selectedTemplate.value;
    const payload: Record<string, unknown> = {
      academyId: session?.academyId,
      userId: selectedUserId.value,
      waiverType: template.waiverType,
      documentVersion: template.version,
      documentHash: await sha256Hex(template.bodyMarkdown),
      signatureData: paths.join(' '),
      signatureFormat: 'svg_path',
      signerName: signerName.value.trim(),
      signedAt: new Date().toISOString(),
      mutationId: crypto.randomUUID(),
      hlc: `${new Date().toISOString()}-0000-waiver-tablet`,
    };
    if (dateOfBirth.value) payload.dateOfBirth = dateOfBirth.value;
    if (isMinor.value) payload.guardianName = guardianName.value.trim();

    const { data } = await api.post<{ id: string }>('/v1/waivers', payload, session ? { token: session.token } : {});
    signedWaiverId.value = data.id;
  } catch (caught) {
    error.value = describeError(caught);
  } finally {
    submitting.value = false;
  }
}

async function openPdf(): Promise<void> {
  if (!signedWaiverId.value) return;
  try {
    const url = await fetchBlobUrl(`/v1/waivers/${signedWaiverId.value}/pdf`, session?.token);
    window.open(url, '_blank', 'noopener');
  } catch (caught) {
    error.value = describeError(caught);
  }
}

function restart(): void {
  signedWaiverId.value = null;
  signerName.value = '';
  dateOfBirth.value = '';
  guardianName.value = '';
  agreed.value = false;
  clear();
}

onMounted(load);
</script>

<template>
  <div class="min-h-full bg-ink-100 px-4 py-8">
    <div class="mx-auto max-w-3xl">
      <!-- Not paired -->
      <div v-if="!session" class="card-pad text-center">
        <span class="text-5xl">🔒</span>
        <h1 class="mt-4 font-display text-2xl font-bold text-ink-900">This tablet isn't paired</h1>
        <p class="mt-2 text-sm text-ink-600">
          Waivers are signed against a specific academy. Pair this tablet from the front desk screen first.
        </p>
        <a href="/kiosk" class="btn-primary mt-6">Go to pairing</a>
      </div>

      <!-- Done -->
      <div v-else-if="signedWaiverId" class="card-pad text-center">
        <span class="text-5xl">✅</span>
        <h1 class="mt-4 font-display text-2xl font-bold text-ink-900">Waiver signed</h1>
        <p class="mt-2 text-sm text-ink-600">
          A timestamped PDF has been stored. You're cleared to step on the mat.
        </p>
        <div class="mt-6 flex justify-center gap-3">
          <button class="btn-ghost" @click="openPdf">Download PDF</button>
          <button class="btn-primary" @click="restart">Sign another</button>
        </div>
      </div>

      <!-- Form -->
      <div v-else class="space-y-4">
        <header class="text-center">
          <span class="grid mx-auto h-11 w-11 place-items-center rounded-2xl bg-mat-600 font-display text-xl font-extrabold text-white">G</span>
          <h1 class="mt-4 font-display text-2xl font-bold text-ink-900">{{ selectedTemplate?.title ?? 'Digital waiver' }}</h1>
          <p class="mt-1 text-sm text-ink-500">Read, sign, and you're on the mat.</p>
        </header>

        <div v-if="loading" class="card-pad space-y-2">
          <div v-for="n in 5" :key="n" class="skeleton h-4 w-full" />
        </div>

        <template v-else>
          <!-- Document -->
          <section class="card-pad">
            <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 class="text-sm font-semibold text-ink-900">The agreement</h2>
              <div class="flex items-center gap-2">
                <select v-model="selectedTemplateId" class="input w-auto py-1.5 text-xs">
                  <option v-for="template in templates" :key="template.id" :value="template.id">
                    {{ template.waiverType.replace(/_/g, ' ') }} · v{{ template.version }}
                  </option>
                </select>
                <span class="chip bg-ink-100 text-ink-600">v{{ selectedTemplate?.version }}</span>
              </div>
            </div>
            <div class="max-h-64 space-y-2 overflow-y-auto rounded-xl bg-ink-50 p-4 text-sm leading-relaxed text-ink-700">
              <p v-for="(line, index) in renderedBody" :key="index">{{ line }}</p>
            </div>
          </section>

          <!-- Who -->
          <section class="card-pad space-y-4">
            <h2 class="text-sm font-semibold text-ink-900">Who is signing?</h2>

            <div v-if="members.length">
              <label class="label" for="member">Member</label>
              <select id="member" v-model="selectedUserId" class="input">
                <option value="">Select…</option>
                <option v-for="member in members" :key="member.id" :value="member.id">
                  {{ member.firstName }} {{ member.lastName }}
                </option>
              </select>
            </div>
            <div v-else>
              <label class="label" for="member-id">Member id</label>
              <input id="member-id" v-model="selectedUserId" class="input font-mono text-xs" placeholder="From the kiosk drop-in screen" />
            </div>

            <div class="grid gap-4 sm:grid-cols-2">
              <div>
                <label class="label" for="signer">Full legal name</label>
                <input id="signer" v-model="signerName" class="input" placeholder="As it appears on your ID" />
              </div>
              <div>
                <label class="label" for="dob">Date of birth</label>
                <input id="dob" v-model="dateOfBirth" class="input" type="date" />
              </div>
            </div>

            <div v-if="isMinor">
              <label class="label" for="guardian">Parent / guardian name</label>
              <input id="guardian" v-model="guardianName" class="input" placeholder="Required for under-18s" />
              <p class="mt-1 text-xs text-amber-700">A guardian must sign for a minor.</p>
            </div>
          </section>

          <!-- Signature -->
          <section class="card-pad">
            <div class="flex items-center justify-between">
              <h2 class="text-sm font-semibold text-ink-900">Signature</h2>
              <button class="text-xs font-semibold text-ink-500 hover:text-ink-800" @click="clear">Clear</button>
            </div>
            <canvas
              ref="canvas"
              width="700"
              height="220"
              class="mt-3 w-full touch-none rounded-xl border-2 border-dashed border-ink-300 bg-ink-50"
              @pointerdown="start"
              @pointermove="move"
              @pointerup="drawing = false"
              @pointerleave="drawing = false"
            />
            <p class="mt-2 text-xs text-ink-400">Sign with a finger, stylus or mouse.</p>

            <label class="mt-4 flex cursor-pointer items-start gap-3 rounded-xl bg-ink-50 p-3 text-sm text-ink-700">
              <input v-model="agreed" type="checkbox" class="mt-0.5 accent-mat-600" />
              <span>
                I have read and agree to this waiver. I understand my signature, timestamp and IP address
                are recorded and stored with the document hash.
              </span>
            </label>
          </section>

          <p v-if="error" class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {{ error }}
          </p>

          <button class="btn-primary w-full py-4 text-base" :disabled="!canSubmit" @click="submit">
            {{ submitting ? 'Signing…' : 'Sign and submit' }}
          </button>
        </template>
      </div>
    </div>
  </div>
</template>
