import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}))

vi.mock('../../api/index', () => ({
  default: {
    get: mocks.get,
    post: mocks.post,
    patch: mocks.patch,
    delete: mocks.delete,
  },
}))

import AdminDepartments from '../AdminDepartments.vue'

const departments = [
  { id: 'd-unassigned', name: '未分配', userCount: 0, isProtected: true },
  { id: 'd-tech', name: '技术部', userCount: 3, isProtected: false },
  { id: 'd-empty', name: '空部门', userCount: 0, isProtected: false },
]

function mountPage() {
  mocks.get.mockResolvedValue({ data: departments })
  return mount(AdminDepartments)
}

beforeEach(() => {
  mocks.get.mockReset()
  mocks.post.mockReset()
  mocks.patch.mockReset()
  mocks.delete.mockReset()
  vi.stubGlobal('confirm', vi.fn(() => true))
})

describe('AdminDepartments', () => {
  it('renders departments from the API with counts and protection', async () => {
    const wrapper = mountPage()
    await flushPromises()

    const rows = wrapper.findAll('tbody tr')
    expect(rows).toHaveLength(3)
    expect(wrapper.text()).toContain('未分配')
    expect(wrapper.text()).toContain('系统保留')
    expect(rows[1].text()).toContain('3')
  })

  it('creates a department and refreshes the list', async () => {
    mocks.post.mockResolvedValue({ data: {} })
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.find('.add-input').setValue(' 市场部 ')
    await wrapper.find('.add-row button').trigger('click')
    await flushPromises()

    expect(mocks.post).toHaveBeenCalledWith('/admin/departments', { name: '市场部' })
    expect(mocks.get.mock.calls.filter(([url]) => url === '/admin/departments')).toHaveLength(2)
  })

  it('renames a department through PATCH by id', async () => {
    mocks.patch.mockResolvedValue({ data: { affectedUsers: 2 } })
    const wrapper = mountPage()
    await flushPromises()

    const techRow = wrapper.findAll('tbody tr')[1]
    await techRow.findAll('.row-actions button')[0].trigger('click')
    await techRow.find('.inline-input').setValue('研发部')
    await techRow.findAll('.row-actions button')[0].trigger('click')
    await flushPromises()

    expect(mocks.patch).toHaveBeenCalledWith('/admin/departments/d-tech', { name: '研发部' })
    expect(wrapper.text()).toContain('2 名用户需重新登录')
  })

  it('disables delete for protected and non-empty departments', async () => {
    const wrapper = mountPage()
    await flushPromises()

    const rows = wrapper.findAll('tbody tr')
    const deleteButton = (row: any) => row.findAll('.row-actions button').at(-1)
    expect(deleteButton(rows[0]).attributes('disabled')).toBeDefined()
    expect(deleteButton(rows[1]).attributes('disabled')).toBeDefined()
    expect(deleteButton(rows[2]).attributes('disabled')).toBeUndefined()
  })

  it('deletes an empty department by id', async () => {
    mocks.delete.mockResolvedValue({ data: {} })
    const wrapper = mountPage()
    await flushPromises()

    const emptyRow = wrapper.findAll('tbody tr')[2]
    await emptyRow.findAll('.row-actions button').at(-1)!.trigger('click')
    await flushPromises()

    expect(mocks.delete).toHaveBeenCalledWith('/admin/departments/d-empty')
  })
})
