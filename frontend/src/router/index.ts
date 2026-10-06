import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

/**
 * 路由表：路径与提示词逐字一致。
 * /reefs、/reefs/:id/sites、/sites/:id/belts、/belts/:id/corals、/belts/:id/fishes、/coverage
 * 全部页面懒加载，构建时自动分包。
 */
const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/reefs' },
  {
    path: '/reefs',
    name: 'reef-list',
    component: () => import('@/pages/ReefList.vue'),
    meta: { title: '礁区台账', icon: 'Odometer' }
  },
  {
    path: '/reefs/:id/sites',
    name: 'site-list',
    component: () => import('@/pages/SiteList.vue'),
    meta: { title: '站位列表与水深标记', icon: 'Grid' }
  },
  {
    path: '/sites/:id/belts',
    name: 'belt-board',
    component: () => import('@/pages/BeltBoard.vue'),
    meta: { title: '样带布设', icon: 'Files' }
  },
  {
    path: '/belts/:id/corals',
    name: 'coral-entry',
    component: () => import('@/pages/CoralEntry.vue'),
    meta: { title: '底质与珊瑚分类计数', icon: 'Histogram' }
  },
  {
    path: '/belts/:id/fishes',
    name: 'fish-entry',
    component: () => import('@/pages/FishEntry.vue'),
    meta: { title: '鱼类与无脊椎动物计数', icon: 'DataLine' }
  },
  {
    path: '/coverage',
    name: 'coverage-view',
    component: () => import('@/pages/CoverageView.vue'),
    meta: { title: '白化等级评定与覆盖度汇总', icon: 'PieChart' }
  },
  { path: '/:pathMatch(.*)*', redirect: '/reefs' }
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 })
})

router.afterEach((to) => {
  const title = typeof to.meta.title === 'string' ? to.meta.title : '珊瑚礁样带普查与白化分级台'
  document.title = `${title} · 珊瑚礁样带普查与白化分级台`
})

export default router
