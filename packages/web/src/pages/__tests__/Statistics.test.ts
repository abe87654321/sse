import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
}))

vi.mock('../../api/index', () => ({
  default: { get: mocks.get },
}))

vi.mock('../../stores/auth', () => ({
  useAuthStore: () => ({ user: { role: 'finance' } }),
}))

import Statistics from '../Statistics.vue'

beforeEach(() => {
  mocks.get.mockReset()
})

describe('Statistics page', () => {
  it('renders the scoped statistics returned by the API', async () => {
    mocks.get.mockResolvedValue({
      data: {
        scope: 'self',
        scopeLabel: '本人',
        overview: {
          totalAmount: 1234,
          totalCount: 2,
          approvedCount: 1,
          rejectedCount: 0,
          pendingCount: 1,
        },
        byCategory: [{ category: '交通', totalAmount: 1234, reportCount: 2 }],
        monthly: [{ month: '2026-11', totalAmount: 1234, reportCount: 2 }],
      },
    })

    const wrapper = mount(Statistics)
    await flushPromises()

    expect(mocks.get).toHaveBeenCalledWith('/statistics')
    expect(wrapper.text()).toContain('本人')
    expect(wrapper.text()).toContain('统计口径：已通过 + 已付款')
    expect(wrapper.text()).toContain('¥1.2k')
    expect(wrapper.text()).toContain('2 笔报销')
    expect(wrapper.text()).toContain('交通')
    expect(wrapper.text()).toContain('11月')
  })

  it('lets finance export XLSX via the export endpoint', async () => {
    mocks.get.mockResolvedValue({
      data: {
        scope: 'all',
        scopeLabel: '全公司',
        overview: {},
        byCategory: [],
        monthly: [],
      },
    })
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:x'), configurable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    const wrapper = mount(Statistics)
    await flushPromises()
    expect(wrapper.find('[data-test="export-xlsx"]').exists()).toBe(true)

    await wrapper.find('[data-test="export-xlsx"]').trigger('click')
    await flushPromises()
    expect(mocks.get).toHaveBeenCalledWith('/statistics/export', {
      params: { format: 'xlsx' },
      responseType: 'blob',
    })
  })

  it('shows the API error instead of silently rendering empty data', async () => {
    mocks.get.mockRejectedValue({
      response: { data: { error: { message: '当前角色无权查看统计' } } },
    })

    const wrapper = mount(Statistics)
    await flushPromises()

    expect(wrapper.text()).toContain('当前角色无权查看统计')
  })
})
