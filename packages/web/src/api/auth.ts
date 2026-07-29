import api from './index'

export const authApi = {
  login(data: { phone: string; password: string }) {
    return api.post<{ accessToken: string; refreshToken: string; user: { id: string; name: string; phone: string; role: string } }>('/auth/login', data)
  },
  profile() {
    return api.get('/auth/profile')
  },
  updateProfile(data: { name?: string; email?: string }) {
    return api.put('/auth/profile', data)
  },
  changePassword(data: { oldPassword: string; newPassword: string }) {
    return api.put('/auth/password', data)
  },
  uploadAvatar(file: File) {
    const formData = new FormData()
    formData.append('file', file)
    return api.post<{ message: string; avatarUrl: string }>(
      '/auth/profile/avatar', formData,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    )
  },
}
