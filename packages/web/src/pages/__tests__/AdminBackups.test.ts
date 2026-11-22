import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
}))

vi.mock('../../api/index', () => ({ default: mocks }))

import AdminBackups from '../AdminBackups.vue'

function arrange(backups: any[] = [], drills: any[] = []) {
  mocks.get.mockImplementation((url: string) => {
    if (url === '/admin/backups/drills') return Promise.resolve({ data: { items: drills } })
    return Promise.resolve({ data: { items: backups } })
  })
}

beforeEach(() => {
  mocks.get.mockReset()
  mocks.post.mockReset()
  mocks.delete.mockReset()
  arrange()
})

describe('AdminBackups page', () => {
  it('lists backups and starts a create job', async () => {
    arrange([
      {
        id: 'b1',
        manifest: { createdAt: '2026-11-21', counts: { tables: 1, rows: 2, objects: 0 } },
        locations: ['local', 'minio'],
      },
    ])
    mocks.post.mockResolvedValue({ data: { id: 'job-1', status: 'running' } })

    const wrapper = mount(AdminBackups)
    await flushPromises()
    expect(wrapper.text()).toContain('b1')
    expect(wrapper.text()).toContain('local + minio')

    await wrapper.find('[data-test="create-backup"]').trigger('click')
    expect(mocks.post).toHaveBeenCalledWith('/admin/backups', {
      includeSecrets: false,
      upload: true,
    })
  })

  it('keeps the success message when the list refresh fails after create', async () => {
    let backupCalls = 0
    mocks.get.mockImplementation((url: string) => {
      if (url === '/admin/backups/drills') return Promise.resolve({ data: { items: [] } })
      backupCalls += 1
      if (backupCalls === 1) return Promise.resolve({ data: { items: [] } })
      return Promise.reject({ response: { data: { error: { message: '服务器内部错误' } } } })
    })
    mocks.post.mockResolvedValue({ data: { id: 'job-1', status: 'running' } })

    const wrapper = mount(AdminBackups)
    await flushPromises()
    await wrapper.find('[data-test="create-backup"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('备份任务已启动')
  })

  it('requires the restore confirmation phrase', async () => {
    arrange([{ id: 'b1', manifest: { counts: {} }, locations: ['local'] }])
    const wrapper = mount(AdminBackups)
    await flushPromises()

    await wrapper.find('[data-test="open-restore"]').trigger('click')
    await wrapper.find('[data-test="restore-confirm"]').setValue('wrong')
    await wrapper.find('[data-test="submit-restore"]').trigger('click')
    expect(wrapper.text()).toContain('确认短语不正确')
  })

  it('lists drills and clears one with a confirmation phrase', async () => {
    arrange([], [{
      id: 'restore-1',
      targetDb: 'sse_drill_b1',
      targetMinioPrefix: 'drills/b1/',
      status: 'active',
    }])
    mocks.post.mockResolvedValue({ data: { id: 'job-clean', status: 'running' } })

    const wrapper = mount(AdminBackups)
    await flushPromises()
    expect(wrapper.text()).toContain('sse_drill_b1')

    await wrapper.find('[data-test="open-cleanup"]').trigger('click')
    await wrapper.find('[data-test="cleanup-confirm"]').setValue('CLEANUP sse_drill_b1')
    await wrapper.find('[data-test="submit-cleanup"]').trigger('click')

    expect(mocks.post).toHaveBeenCalledWith(
      '/admin/backups/drills/restore-1/cleanup',
      expect.objectContaining({ confirm: 'CLEANUP sse_drill_b1' })
    )
  })
})
