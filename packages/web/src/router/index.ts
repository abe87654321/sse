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
        path: 'expenses/:id/edit',
        name: 'ExpenseEdit',
        component: () => import('@/pages/ExpenseForm.vue'),
        meta: { title: '编辑报销', hidden: true }
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
        path: 'approvals/:reportId',
        name: 'ApprovalHandle',
        component: () => import('@/pages/ApprovalHandle.vue'),
        meta: { title: '审批处理', hidden: true }
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
        meta: { title: '系统管理', icon: 'Setting', requiresAdmin: true }
      },
      {
        path: 'admin/users',
        name: 'AdminUsers',
        component: () => import('@/pages/AdminUsers.vue'),
        meta: { title: '用户管理', requiresAdmin: true }
      },
      {
        path: 'admin/departments',
        name: 'AdminDepartments',
        component: () => import('@/pages/AdminDepartments.vue'),
        meta: { title: '部门管理', requiresAdmin: true }
      },
      {
        path: 'admin/messages',
        name: 'AdminMessages',
        component: () => import('@/pages/AdminMessages.vue'),
        meta: { title: '消息管理', requiresAdmin: true }
      },
      {
        path: 'admin/reasoning-rules',
        name: 'AdminReasoningRules',
        component: () => import('@/pages/AdminReasoningRules.vue'),
        meta: { title: '推理规则', requiresAdmin: true }
      },
      {
        path: '/ontology',
        name: 'ontology',
        component: () => import('../pages/Ontology.vue'),
        meta: { title: '本体可视化', icon: 'Share' },
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
  if (to.meta.requiresAdmin && auth.user?.role !== 'admin') return next('/dashboard')
  next()
})

export default router
