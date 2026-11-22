import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { ADMIN_ROLES, ALL_ROLES, APPROVER_ROLES, resolveGuard } from '@/permissions'

declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    icon?: string
    guest?: boolean
    hidden?: boolean
    requiresAdmin?: boolean
    allowedRoles?: readonly string[]
  }
}

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
        meta: { title: '审批管理', icon: 'Checked', allowedRoles: APPROVER_ROLES }
      },
      {
        path: 'approvals/:reportId',
        name: 'ApprovalHandle',
        component: () => import('@/pages/ApprovalHandle.vue'),
        meta: { title: '审批处理', hidden: true, allowedRoles: APPROVER_ROLES }
      },
      {
        path: 'statistics',
        name: 'Statistics',
        component: () => import('@/pages/Statistics.vue'),
        meta: { title: '统计分析', icon: 'DataAnalysis', allowedRoles: ALL_ROLES }
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
        path: 'admin/snapshots',
        name: 'AdminSnapshots',
        component: () => import('@/pages/AdminSnapshots.vue'),
        meta: { title: '内容快照', allowedRoles: ADMIN_ROLES }
      },
      {
        path: 'admin',
        name: 'Admin',
        component: () => import('@/pages/Admin.vue'),
        meta: { title: '系统管理', icon: 'Setting', allowedRoles: ADMIN_ROLES }
      },
      {
        path: 'admin/users',
        name: 'AdminUsers',
        component: () => import('@/pages/AdminUsers.vue'),
        meta: { title: '用户管理', allowedRoles: ADMIN_ROLES }
      },
      {
        path: 'admin/departments',
        name: 'AdminDepartments',
        component: () => import('@/pages/AdminDepartments.vue'),
        meta: { title: '部门管理', allowedRoles: ADMIN_ROLES }
      },
      {
        path: 'admin/messages',
        name: 'AdminMessages',
        component: () => import('@/pages/AdminMessages.vue'),
        meta: { title: '消息管理', allowedRoles: ADMIN_ROLES }
      },
      {
        path: 'admin/reasoning-rules',
        name: 'AdminReasoningRules',
        component: () => import('@/pages/AdminReasoningRules.vue'),
        meta: { title: '推理规则', allowedRoles: ADMIN_ROLES }
      },
      {
        path: '/ontology',
        name: 'ontology',
        component: () => import('../pages/Ontology.vue'),
        meta: { title: '本体可视化', icon: 'Share' },
      },
      {
        path: 'forbidden',
        name: 'Forbidden',
        component: () => import('@/pages/Forbidden.vue'),
        meta: { title: '无权访问', hidden: true }
      }
    ]
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach((to) => {
  const auth = useAuthStore()
  const decision = resolveGuard({
    isLoggedIn: auth.isLoggedIn,
    role: auth.user?.role,
    meta: to.meta,
  })

  if (decision === 'login') return { path: '/login' }
  if (decision === 'dashboard') return { path: '/dashboard' }
  if (decision === 'forbidden') {
    return { path: '/forbidden', query: { from: to.fullPath } }
  }
  return true
})

export default router
