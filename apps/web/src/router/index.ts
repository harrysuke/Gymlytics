import { createRouter, createWebHistory } from 'vue-router';
import { isStaff, restoreSession, session } from '../lib/auth';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/admin' },
    {
      path: '/login',
      name: 'login',
      component: () => import('../views/Login.vue'),
      meta: { public: true },
    },
    {
      path: '/kiosk',
      name: 'kiosk',
      component: () => import('../views/kiosk/CheckIn.vue'),
      meta: { public: true },
    },
    {
      path: '/waiver',
      name: 'waiver',
      component: () => import('../views/waiver/Sign.vue'),
      meta: { public: true },
    },
    {
      path: '/embed/:kind/:token',
      name: 'widget-embed',
      component: () => import('../views/embed/Embed.vue'),
      props: true,
      meta: { public: true },
    },
    {
      path: '/family',
      name: 'family-home',
      component: () => import('../views/family/Home.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/admin',
      component: () => import('../components/AppShell.vue'),
      meta: { requiresAuth: true, staffOnly: true },
      children: [
        { path: '', name: 'dashboard', component: () => import('../views/admin/Dashboard.vue') },
        { path: 'members', name: 'members', component: () => import('../views/admin/Members.vue') },
        {
          path: 'members/:id',
          name: 'member-detail',
          component: () => import('../views/admin/MemberDetail.vue'),
          props: true,
        },
        { path: 'schedule', name: 'schedule', component: () => import('../views/admin/Schedule.vue') },
        { path: 'attendance', name: 'attendance', component: () => import('../views/admin/Attendance.vue') },
        { path: 'promotions', name: 'promotions', component: () => import('../views/admin/Promotions.vue') },
        { path: 'billing', name: 'billing', component: () => import('../views/admin/Billing.vue') },
        { path: 'pos', name: 'pos', component: () => import('../views/admin/Pos.vue') },
        { path: 'programs', name: 'programs', component: () => import('../views/admin/Programs.vue') },
        { path: 'waivers', name: 'waivers', component: () => import('../views/admin/Waivers.vue') },
        { path: 'analytics', name: 'analytics', component: () => import('../views/admin/analytics/Overview.vue') },
        { path: 'analytics/progression', name: 'analytics-progression', component: () => import('../views/admin/analytics/Progression.vue') },
        { path: 'analytics/attendance', name: 'analytics-attendance', component: () => import('../views/admin/analytics/Attendance.vue') },
        { path: 'analytics/retention', name: 'analytics-retention', component: () => import('../views/admin/analytics/Retention.vue') },
        { path: 'analytics/financial', name: 'analytics-financial', component: () => import('../views/admin/analytics/Financial.vue') },
        { path: 'analytics/leads', name: 'analytics-leads', component: () => import('../views/admin/analytics/Leads.vue') },
        {
          path: 'analytics/member/:id',
          name: 'analytics-member',
          component: () => import('../views/admin/analytics/Member.vue'),
          props: true,
        },
        { path: 'reports', name: 'reports', component: () => import('../views/admin/reports/Center.vue') },
        {
          path: 'reports/:slug',
          name: 'report-view',
          component: () => import('../views/admin/reports/View.vue'),
          props: true,
        },
        { path: 'network', name: 'network', component: () => import('../views/admin/Network.vue') },
        { path: 'plan', name: 'plan', component: () => import('../views/admin/Plan.vue') },
        { path: 'onboarding', name: 'onboarding', component: () => import('../views/admin/Onboarding.vue') },
        { path: 'imports', name: 'imports', component: () => import('../views/admin/Imports.vue') },
        { path: 'embeds', name: 'embeds', component: () => import('../views/admin/Embeds.vue') },
        { path: 'curriculum', name: 'curriculum', component: () => import('../views/admin/Curriculum.vue') },
        { path: 'passes', name: 'passes', component: () => import('../views/admin/Passes.vue') },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/admin' },
  ],
});

router.beforeEach(async (to) => {
  await restoreSession();

  if (to.meta.requiresAuth && !session.user) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }

  if (to.meta.staffOnly && session.user && !isStaff.value) {
    // Students and guardians have no admin console — send them to the kiosk.
    return { name: 'kiosk' };
  }

  if (to.name === 'login' && session.user && isStaff.value) {
    return { name: 'dashboard' };
  }

  return true;
});

export default router;
