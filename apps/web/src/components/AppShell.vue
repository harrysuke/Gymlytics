<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import { displayName, initials, isStaff, logout, session } from '../lib/auth';

interface NavItem {
  label: string;
  to: string;
  icon: string;
  roles?: string[];
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const ICONS: Record<string, string> = {
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  users: 'M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 19v-1a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11',
  calendar: 'M8 2v4M16 2v4M3 10h18M5 6h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z',
  check: 'M20 6L9 17l-5-5',
  belt: 'M4 8h16v3H4zM9 11v6M15 11v6M7 20h10',
  card: 'M2 7h20v12H2zM2 11h20',
  cart: 'M3 4h2l2.4 11h10.2L20 7H6M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM18 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  book: 'M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2zM8 7h8M8 11h8',
  doc: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4',
  monitor: 'M3 5h18v11H3zM8 20h8M12 16v4',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  clipboard: 'M9 4h6v2H9zM8 4H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2M9 11h6M9 15h6',
  building: 'M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M8 7h4M8 11h4M8 15h4M2 21h20',
  spark: 'M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9zM19 17l.7 2.3L22 20l-2.3.7L19 23l-.7-2.3L16 20l2.3-.7z',
  rocket: 'M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2M9 19c-2-2-2-5-1-8l5-5c3-1 6-1 8-1s0 5-1 8l-5 5c-3 1-6 1-8-1zM14 7a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  upload: 'M12 16V4M7 9l5-5 5 5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  code: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16',
  play: 'M6 4l14 8-14 8z',
  ticket: 'M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4zM12 6v2M12 11v2M12 16v2',
};

const STAFF_ROLES = ['owner', 'admin', 'staff'];
const ADMIN_ROLES = ['owner', 'admin'];

// Grouped navigation keeps the 18 destinations scannable. Sections with no
// items left after the role filter are hidden entirely.
const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Overview',
    items: [{ label: 'Dashboard', to: '/admin', icon: 'grid' }],
  },
  {
    label: 'People',
    items: [
      { label: 'Members', to: '/admin/members', icon: 'users' },
      { label: 'Attendance', to: '/admin/attendance', icon: 'check' },
      { label: 'Waivers', to: '/admin/waivers', icon: 'doc' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { label: 'Schedule', to: '/admin/schedule', icon: 'calendar' },
      { label: 'Programs', to: '/admin/programs', icon: 'book' },
      { label: 'Curriculum', to: '/admin/curriculum', icon: 'play', roles: STAFF_ROLES },
      { label: 'Promotions', to: '/admin/promotions', icon: 'belt' },
    ],
  },
  {
    label: 'Sales & billing',
    items: [
      { label: 'Billing', to: '/admin/billing', icon: 'card', roles: STAFF_ROLES },
      { label: 'Point of sale', to: '/admin/pos', icon: 'cart', roles: STAFF_ROLES },
      { label: 'Passes', to: '/admin/passes', icon: 'ticket', roles: STAFF_ROLES },
    ],
  },
  {
    label: 'Insights',
    items: [
      { label: 'Analytics', to: '/admin/analytics', icon: 'chart' },
      { label: 'Reports', to: '/admin/reports', icon: 'clipboard', roles: STAFF_ROLES },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { label: 'Setup', to: '/admin/onboarding', icon: 'rocket', roles: ADMIN_ROLES },
      { label: 'Imports', to: '/admin/imports', icon: 'upload', roles: ADMIN_ROLES },
      { label: 'Embeds', to: '/admin/embeds', icon: 'code', roles: ADMIN_ROLES },
      { label: 'Network', to: '/admin/network', icon: 'building', roles: ADMIN_ROLES },
      { label: 'Plan', to: '/admin/plan', icon: 'spark', roles: ADMIN_ROLES },
    ],
  },
];

const route = useRoute();
const router = useRouter();
const mobileOpen = ref(false);

const role = computed(() => session.user?.role ?? '');
const visibleSections = computed(() =>
  NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.roles || item.roles.includes(role.value)),
  })).filter((section) => section.items.length > 0),
);

function isActive(to: string): boolean {
  return to === '/admin' ? route.path === '/admin' : route.path.startsWith(to);
}

async function signOut(): Promise<void> {
  await logout();
  void router.push({ name: 'login' });
}
</script>

<template>
  <div class="flex min-h-full">
    <!-- Sidebar -->
    <aside
      class="fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-gradient-to-b from-ink-900 to-ink-950 transition-transform duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 lg:self-start"
      :class="mobileOpen ? 'translate-x-0' : '-translate-x-full'"
    >
      <!-- Brand -->
      <div class="flex shrink-0 items-center gap-3 px-2 pb-4 pt-6">
        <RouterLink to="/admin" class="flex min-w-0 items-center gap-3" @click="mobileOpen = false">
          <span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-mat-600 font-display text-lg font-extrabold text-white shadow-lg shadow-mat-950/40">
            G
          </span>
          <span class="min-w-0">
            <span class="block truncate font-display text-base font-bold leading-tight text-white">Gymlytics</span>
            <span class="block truncate text-[11px] leading-tight text-ink-400">{{ session.academy?.name ?? 'Academy' }}</span>
          </span>
        </RouterLink>
        <button
          class="ml-auto shrink-0 rounded-lg p-1.5 text-ink-400 transition hover:bg-white/10 hover:text-white lg:hidden"
          title="Close menu"
          @click="mobileOpen = false"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div class="mx-2 h-px shrink-0 bg-white/10" />

      <!-- Grouped navigation -->
      <nav class="sidebar-scroll -mx-1 mt-5 min-h-0 flex-1 overflow-y-auto px-1 pb-5">
        <div v-for="section in visibleSections" :key="section.label" class="mb-5 last:mb-0">
          <p class="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
            {{ section.label }}
          </p>
          <div class="flex flex-col gap-0.5">
            <RouterLink
              v-for="item in section.items"
              :key="item.to"
              :to="item.to"
              class="nav-link"
              :class="{ 'nav-link-active': isActive(item.to) }"
              @click="mobileOpen = false"
            >
              <span
                v-if="isActive(item.to)"
                class="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-mat-400"
              />
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path :d="ICONS[item.icon]" />
              </svg>
              <span class="truncate">{{ item.label }}</span>
            </RouterLink>
          </div>
        </div>
      </nav>

      <!-- Footer: external tools + account -->
      <div class="shrink-0 border-t border-white/10 px-4 pb-6 pt-4">
        <a
          v-if="isStaff"
          href="/kiosk"
          target="_blank"
          rel="noopener"
          class="nav-link mb-3 border border-white/10"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path :d="ICONS.monitor" />
          </svg>
          Open kiosk
        </a>

        <div class="flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2.5">
          <span class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-mat-500 text-xs font-bold text-white">
            {{ initials(session.user) }}
          </span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-semibold text-white">{{ displayName(session.user) }}</p>
            <p class="truncate text-[11px] capitalize text-ink-400">{{ role }}</p>
          </div>
          <button
            class="rounded-lg p-1.5 text-ink-400 transition hover:bg-white/10 hover:text-white"
            title="Sign out"
            @click="signOut"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
            </svg>
          </button>
        </div>
      </div>
    </aside>

    <div
      v-if="mobileOpen"
      class="fixed inset-0 z-30 bg-ink-900/40 lg:hidden"
      @click="mobileOpen = false"
    />

    <!-- Content -->
    <div class="flex min-w-0 flex-1 flex-col">
      <header class="sticky top-0 z-20 flex items-center gap-3 border-b border-ink-200 bg-white/85 px-4 py-3 backdrop-blur lg:hidden">
        <button class="rounded-lg p-2 text-ink-600 hover:bg-ink-100" @click="mobileOpen = true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <span class="font-display font-bold text-ink-900">Gymlytics</span>
      </header>

      <main class="flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        <div class="mx-auto max-w-7xl">
          <RouterView />
        </div>
      </main>
    </div>
  </div>
</template>
