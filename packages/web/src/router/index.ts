import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/pages/Login.vue'),
    meta: { guest: true }
  },
  {
    path: '/',
    component: () => import('@/layouts/DefaultLayout.vue'),
    redirect: '/dashboard',
    children: [
      {
        path: 'dashboard',
        name: 'Dashboard',
        component: () => import('@/pages/Dashboard.vue'),
        meta: { title: '工作台', icon: 'Monitor' }
      },
      {
        path: 'expenses',
        name: 'Expenses',
        component: () => import('@/pages/ExpenseList.vue'),
        meta: { title: '报销列表', icon: 'List' }
      },
      {
        path: 'expenses/new',
        name: 'ExpenseNew',
        component: () => import('@/pages/ExpenseForm.vue'),
        meta: { title: '新建报销', icon: 'Plus' }
      },
      {
        path: 'expenses/:id',
        name: 'ExpenseDetail',
        component: () => import('@/pages/ExpenseDetail.vue'),
        meta: { title: '报销详情', hidden: true }
      },
      {
        path: 'approvals',
        name: 'Approvals',
        component: () => import('@/pages/Approvals.vue'),
        meta: { title: '审批管理', icon: 'Checked' }
      },
      {
        path: 'statistics',
        name: 'Statistics',
        component: () => import('@/pages/Statistics.vue'),
        meta: { title: '统计分析', icon: 'DataAnalysis' }
      },
      {
        path: 'notifications',
        name: 'Notifications',
        component: () => import('@/pages/Notifications.vue'),
        meta: { title: '消息通知', icon: 'Bell' }
      },
      {
        path: 'profile',
        name: 'Profile',
        component: () => import('@/pages/Profile.vue'),
        meta: { title: '个人中心', icon: 'User' }
      },
      {
        path: 'admin',
        name: 'Admin',
        component: () => import('@/pages/Admin.vue'),
        meta: { title: '系统管理', icon: 'Setting' }
      },
      {
        path: 'admin/users',
        name: 'AdminUsers',
        component: () => import('@/pages/AdminUsers.vue'),
        meta: { title: '用户管理' }
      },
      {
        path: 'admin/departments',
        name: 'AdminDepartments',
        component: () => import('@/pages/AdminDepartments.vue'),
        meta: { title: '部门管理' }
      }
    ]
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach((to, _from, next) => {
  const auth = useAuthStore()
  if (to.meta.guest) {
    if (auth.isLoggedIn) return next('/dashboard')
    return next()
  }
  if (!auth.isLoggedIn) return next('/login')
  next()
})

export default router
