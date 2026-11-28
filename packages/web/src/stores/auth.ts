import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import router from '@/router'
import { clearGraphViewState } from '@/components/ontology/graph-view-state'

export interface ApproverDepartment {
  id: string
  name: string
}

export interface UserCapabilities {
  canSubmit: boolean
  canApproveDepartment: boolean
  canApproveFinanceStep: boolean
  canFinalize: boolean
  canExport: boolean
  canManageUsers: boolean
  canManageRules: boolean
}

export interface UserInfo {
  id: string
  name: string
  phone: string
  email?: string
  department?: string
  role: string
  avatarUrl?: string
  approverDepartments?: ApproverDepartment[]
  capabilities?: UserCapabilities
}

export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem('token') || '')
  const user = ref<UserInfo | null>(
    localStorage.getItem('user') ? JSON.parse(localStorage.getItem('user')!) : null
  )
  const sessionExpired = ref(false)

  const isLoggedIn = computed(() => !!token.value)

  function setAuth(t: string, u: UserInfo) {
    token.value = t
    user.value = u
    sessionExpired.value = false
    localStorage.setItem('token', t)
    localStorage.setItem('user', JSON.stringify(u))
  }

  function markSessionExpired() {
    sessionExpired.value = true
  }

  async function logout() {
    token.value = ''
    user.value = null
    sessionExpired.value = false
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    try {
      await router.push('/login')
    } finally {
      clearGraphViewState()
    }
  }

  return { token, user, isLoggedIn, sessionExpired, setAuth, markSessionExpired, logout }
})
