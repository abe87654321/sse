import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}))

vi.mock('../../api/index', () => ({
  default: {
    get: mocks.get,
    post: mocks.post,
    put: mocks.put,
    delete: mocks.delete,
  },
}))

import AdminUsers from '../AdminUsers.vue'

const existingUser = {
  id: 'u1',
  name: 'Existing User',
  phone: '13800000001',
  email: 'existing@example.com',
  department: '技术部',
  role: 'employee',
  status: 'active',
}

function mountPage(users: any[] = []) {
  mocks.get.mockImplementation((url: string) => {
    if (url === '/admin/users/validate') {
      return Promise.resolve({ data: { employee: users.length, dept_approver: 0, finance: 0, admin: 0 } })
    }
    if (url === '/admin/users') {
      return Promise.resolve({ data: users })
    }
    return Promise.resolve({ data: [] })
  })

  return mount(AdminUsers, {
    global: { stubs: { teleport: true } },
  })
}

beforeEach(() => {
  mocks.get.mockReset()
  mocks.post.mockReset()
  mocks.put.mockReset()
  mocks.delete.mockReset()
})

describe('AdminUsers password field', () => {
  it('sends the password when creating a user', async () => {
    mocks.post.mockResolvedValue({ data: {} })
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.find('.toolbar .btn-primary').trigger('click')
    await wrapper.find('#user-name').setValue('New User')
    await wrapper.find('#user-phone').setValue('13900000000')
    await wrapper.find('#user-department').setValue('技术部')
    await wrapper.find('#user-role').setValue('employee')
    await wrapper.find('#user-password').setValue('secret123')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mocks.post).toHaveBeenCalledWith(
      '/admin/users',
      expect.objectContaining({ password: 'secret123' })
    )
  })

  it('omits the password when editing without changing it', async () => {
    mocks.put.mockResolvedValue({ data: {} })
    const wrapper = mountPage([existingUser])
    await flushPromises()

    await wrapper.findAll('.table-link')[0].trigger('click')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mocks.put).toHaveBeenCalledTimes(1)
    const payload = mocks.put.mock.calls[0][1]
    expect(payload).not.toHaveProperty('password')
  })

  it('sends the password when an admin resets it in the edit modal', async () => {
    mocks.put.mockResolvedValue({ data: {} })
    const wrapper = mountPage([existingUser])
    await flushPromises()

    await wrapper.findAll('.table-link')[0].trigger('click')
    await wrapper.find('#user-password').setValue('reset456')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mocks.put).toHaveBeenCalledWith(
      `/admin/users/${existingUser.id}`,
      expect.objectContaining({ password: 'reset456' })
    )
  })
})
