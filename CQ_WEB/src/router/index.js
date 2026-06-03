import { createRouter, createWebHashHistory } from 'vue-router'
import AdminLayout from '../layouts/AdminLayout.vue'
import LoginPage from '../pages/LoginPage.vue'
import PeoplePage from '../pages/PeoplePage.vue'
import HousePage from '../pages/HousePage.vue'
import SpecialAssetsPage from '../pages/SpecialAssetsPage.vue'
import BasicDataPage from '../pages/BasicDataPage.vue'
import ApprovalTasksPage from '../pages/ApprovalTasksPage.vue'
import DjlSyncLogsPage from '../pages/DjlSyncLogsPage.vue'
import FapaiHousePage from '../pages/FapaiHousePage.vue'
import { AUTH_KEY, getAuthRole, getAuthToken, getDefaultRouteByRole, hasRoleAtMostLevel } from '../constants/auth'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: LoginPage,
      meta: { requiresAuth: false },
    },
    {
      path: '/',
      component: AdminLayout,
      meta: { requiresAuth: true },
      children: [
        { path: '', redirect: () => getDefaultRouteByRole(getAuthRole()) },
        {
          path: 'people',
          name: 'people',
          component: PeoplePage,
          meta: { minLevel: 1 },
        },
        {
          path: 'houses',
          name: 'houses',
          component: HousePage,
        },
        {
          path: 'special-assets',
          name: 'special-assets',
          component: SpecialAssetsPage,
        },
        {
          path: 'basic-data',
          name: 'basic-data',
          component: BasicDataPage,
          meta: { minLevel: 1 },
        },
        {
          path: 'djl-sync-logs',
          name: 'djl-sync-logs',
          component: DjlSyncLogsPage,
          meta: { minLevel: 1 },
        },
        {
          path: 'fapai-houses',
          name: 'fapai-houses',
          component: FapaiHousePage,
          meta: { minLevel: 3 },
        },
        {
          path: 'approval-tasks',
          name: 'approval-tasks',
          component: ApprovalTasksPage,
          meta: { minLevel: 2 },
        },
      ],
    },
  ],
})

router.beforeEach((to) => {
  const isAuthenticated = window.localStorage.getItem(AUTH_KEY) === '1' && Boolean(getAuthToken())

  if (to.meta.requiresAuth && !isAuthenticated) {
    return '/login'
  }

  if (isAuthenticated && to.meta?.minLevel && !hasRoleAtMostLevel(to.meta.minLevel)) {
    return getDefaultRouteByRole(getAuthRole())
  }

  if (to.path === '/login' && isAuthenticated) {
    return getDefaultRouteByRole(getAuthRole())
  }

  return true
})

export default router
