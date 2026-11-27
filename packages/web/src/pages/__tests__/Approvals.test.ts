import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}))

vi.mock('../../api/index', () => ({
  default: {
    get: mocks.get,
    post: mocks.post,
  },
}))

import Approvals from '../Approvals.vue'

const pending = [
  {
    id: 'ar-1',
    reportId: 'r-1',
    step: 1,
    approverId: 'u-1',
    stepStartedAt: '2026-11-27T00:00:00.000Z',
    result: 'pending',
    serialNo: 'RE-1',
    title: '差旅报销',
    totalAmount: 600,
    userId: 'owner-1',
    applicantName: '张三',
    department: '技术部',
  },
]

function mountPage() {
  mocks.get.mockResolvedValue({ data: pending })
  return mount(Approvals)
}

beforeEach(() => {
  mocks.get.mockReset()
  mocks.post.mockReset()
})

describe('Approvals quick approve', () => {
  it('sends the approve request without acknowledgement by default', async () => {
    const wrapper = mountPage()
    await flushPromises()

    mocks.post.mockResolvedValue({ data: {} })
    await wrapper.find('.approval-actions .btn-primary').trigger('click')
    await flushPromises()

    expect(mocks.post).toHaveBeenCalledWith('/approvals/r-1/approve', {
      acknowledgeVerification: false,
    })
    expect(wrapper.text()).toContain('审批通过')
  })

  it('shows the AI verification dialog on 409 and resubmits with acknowledgement', async () => {
    const wrapper = mountPage()
    await flushPromises()

    mocks.post
      .mockRejectedValueOnce({
        response: {
          status: 409,
          data: { error: { message: '该报销单存在 AI 核对差异或尚未核对，请确认后再审批' } },
        },
      })
      .mockResolvedValueOnce({ data: {} })

    await wrapper.find('.approval-actions .btn-primary').trigger('click')
    await flushPromises()

    expect(mocks.post).toHaveBeenNthCalledWith(1, '/approvals/r-1/approve', {
      acknowledgeVerification: false,
    })
    expect(wrapper.find('.ack-dialog').exists()).toBe(true)
    expect(wrapper.text()).toContain('该报销单存在 AI 核对差异或尚未核对')

    expect(wrapper.find('.ack-actions .btn-primary').attributes('disabled')).toBeDefined()

    await wrapper.find('.ack-check input').setValue(true)
    await wrapper.find('.ack-actions .btn-primary').trigger('click')
    await flushPromises()

    expect(mocks.post).toHaveBeenNthCalledWith(2, '/approvals/r-1/approve', {
      acknowledgeVerification: true,
    })
    expect(wrapper.find('.ack-dialog').exists()).toBe(false)
    expect(wrapper.text()).toContain('审批通过')
  })

  it('surfaces the server error message for non-409 failures', async () => {
    const wrapper = mountPage()
    await flushPromises()

    mocks.post.mockRejectedValueOnce({
      response: {
        status: 400,
        data: { error: { message: '未找到下一审批步骤的审批人' } },
      },
    })

    await wrapper.find('.approval-actions .btn-primary').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('未找到下一审批步骤的审批人')
    expect(wrapper.text()).not.toContain('操作失败')
  })
})
