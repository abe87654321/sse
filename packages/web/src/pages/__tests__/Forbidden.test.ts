import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  back: vi.fn(),
  resolve: vi.fn((path: string) => ({
    meta: path === '/statistics' ? { title: '统计分析' } : {},
  })),
}))

const routeMock = vi.hoisted(() => ({ query: { from: '/statistics' } }))

const authMock = vi.hoisted(() => ({
  user: { id: 'u1', name: '员工', phone: '13800000001', role: 'employee' },
}))

vi.mock('vue-router', () => ({
  useRouter: () => routerMock,
  useRoute: () => routeMock,
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => authMock,
}))

import Forbidden from '../Forbidden.vue'

beforeEach(() => {
  routerMock.push.mockReset()
  routerMock.back.mockReset()
  window.history.replaceState({}, '')
})

describe('Forbidden page', () => {
  it('explains the denied page and the current role', () => {
    const wrapper = mount(Forbidden)

    expect(wrapper.text()).toContain('无权访问')
    expect(wrapper.text()).toContain('员工')
    expect(wrapper.text()).toContain('统计分析')
  })

  it('returns to the dashboard', async () => {
    const wrapper = mount(Forbidden)
    const buttons = wrapper.findAll('button')

    await buttons[0].trigger('click')

    expect(routerMock.push).toHaveBeenCalledWith('/dashboard')
  })

  it('goes back when there is an in-app history entry', async () => {
    window.history.replaceState({ back: '/expenses' }, '')
    const wrapper = mount(Forbidden)
    const buttons = wrapper.findAll('button')

    await buttons[1].trigger('click')

    expect(routerMock.back).toHaveBeenCalled()
  })

  it('falls back to the dashboard when there is no in-app history entry', async () => {
    window.history.replaceState({ back: null }, '')
    const wrapper = mount(Forbidden)
    const buttons = wrapper.findAll('button')

    await buttons[1].trigger('click')

    expect(routerMock.push).toHaveBeenCalledWith('/dashboard')
  })
})
