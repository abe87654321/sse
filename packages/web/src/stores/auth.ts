import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import router from '@/router'
import { clearGraphViewState } from '@/components/ontology/graph-view-state'

export interface UserInfo {
  id: string
  name: string
  phone: string
  email?: string
  department?: string
  role: string
  avatarUrl?: string
}

export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem('token') || '')
  const user = ref<UserInfo | null>(
    localStorage.getItem('user') ? JSON.parse(localStorage.getItem('user')!) : null
  )

  const isLoggedIn = computed(() => !!token.value)

  function setAuth(t: string, u: UserInfo) {
    token.value = t
    user.value = u
    localStorage.setItem('token', t)
    localStorage.setItem('user', JSON.stringify(u))
  }

  async function logout() {
    token.value = ''
    user.value = null
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    try {
      await router.push('/login')
    } finally {
      clearGraphViewState()
    }
  }

  return { token, user, isLoggedIn, setAuth, logout }
})
