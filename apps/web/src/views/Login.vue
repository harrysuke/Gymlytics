<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { login, session } from '../lib/auth';
import { describeError } from '../lib/toast';

const route = useRoute();
const router = useRouter();

const email = ref('owner@gymlytics.test');
const password = ref('Password123!');
const slug = ref('gymlytics-demo');
const busy = ref(false);
const error = ref<string | null>(null);

async function submit(): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    await login(email.value.trim(), password.value, slug.value.trim());
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/admin';
    await router.push(redirect);
  } catch (caught) {
    error.value = describeError(caught);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="grid min-h-full lg:grid-cols-2">
    <!-- Brand panel -->
    <div class="relative hidden flex-col justify-between overflow-hidden bg-ink-900 p-12 lg:flex">
      <div class="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-mat-700/40 blur-3xl" />
      <div class="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-mat-500/20 blur-3xl" />

      <div class="relative flex items-center gap-3">
        <span class="grid h-10 w-10 place-items-center rounded-xl bg-mat-600 font-display text-xl font-extrabold text-white">G</span>
        <span class="font-display text-xl font-bold text-white">Gymlytics</span>
      </div>

      <div class="relative max-w-md">
        <h1 class="font-display text-4xl font-extrabold leading-tight text-white">
          Run the mat.<br />Not the spreadsheet.
        </h1>
        <p class="mt-4 text-sm leading-relaxed text-ink-300">
          Offline-first check-in, belt and stripe progression, family billing and digital waivers —
          built for academies that teach more than one discipline.
        </p>
        <ul class="mt-8 space-y-3 text-sm text-ink-300">
          <li v-for="line in [
            'Kiosk keeps checking members in when the Wi-Fi drops',
            'Promotion eligibility computed from real mat hours',
            'One invoice per family, not per child',
          ]" :key="line" class="flex items-start gap-3">
            <span class="mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-accent-500/20 text-[10px] text-accent-500">✓</span>
            {{ line }}
          </li>
        </ul>
      </div>

      <p class="relative text-xs text-ink-500">© {{ new Date().getFullYear() }} Gymlytics · Demo academy seeded locally</p>
    </div>

    <!-- Form -->
    <div class="flex items-center justify-center p-6 sm:p-12">
      <form class="w-full max-w-sm" @submit.prevent="submit">
        <div class="mb-8 lg:hidden">
          <span class="grid h-10 w-10 place-items-center rounded-xl bg-mat-600 font-display text-xl font-extrabold text-white">G</span>
        </div>

        <h2 class="font-display text-2xl font-bold text-ink-900">Sign in</h2>
        <p class="mt-1 text-sm text-ink-500">Staff console for your academy.</p>

        <div class="mt-8 space-y-4">
          <div>
            <label class="label" for="email">Email</label>
            <input id="email" v-model="email" class="input" type="email" autocomplete="username" required />
          </div>
          <div>
            <label class="label" for="password">Password</label>
            <input id="password" v-model="password" class="input" type="password" autocomplete="current-password" required />
          </div>
          <div>
            <label class="label" for="slug">Academy slug</label>
            <input id="slug" v-model="slug" class="input font-mono text-xs" required />
          </div>
        </div>

        <p v-if="error" class="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {{ error }}
        </p>

        <button class="btn-primary mt-6 w-full" type="submit" :disabled="busy">
          {{ busy ? 'Signing in…' : 'Sign in' }}
        </button>

        <div class="mt-6 rounded-xl border border-ink-200 bg-white p-3 text-xs text-ink-500">
          <p class="font-semibold text-ink-600">Seeded demo accounts</p>
          <p class="mt-1 font-mono">owner@gymlytics.test · Password123!</p>
          <p class="font-mono">coach@ · frontdesk@ · parent@ — same password</p>
        </div>
      </form>
    </div>
  </div>
</template>
