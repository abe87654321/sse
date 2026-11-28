import axios from 'axios'
import { useAuthStore } from '@/stores/auth'
import { shouldMarkSessionExpired } from './session'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || '/api',
  timeout: 15000
})

api.interceptors.request.use(config => {
  const auth = useAuthStore()
  if (auth.token) {
    config.headers.Authorization = `Bearer ${auth.token}`
  }
  return config
})

api.interceptors.response.use(
  res => res,
  err => {
    if (shouldMarkSessionExpired(err.response?.status, err.config?.url)) {
      // Do not force logout/redirect: a background poll must not wipe an
      // in-progress form. The layout shows a banner so the user can re-login.
      useAuthStore().markSessionExpired()
    }
    return Promise.reject(err)
  }
)

export default api
