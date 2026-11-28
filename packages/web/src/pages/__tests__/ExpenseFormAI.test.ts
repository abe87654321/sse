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

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  useRoute: () => ({ name: 'ExpenseCreate', params: {} }),
}))

import ExpenseForm from '../ExpenseForm.vue'

function mountPage() {
  mocks.get.mockResolvedValue({ data: [] })
  return mount(ExpenseForm, {
    global: { stubs: { InvoiceVerificationPanel: true } },
  })
}

async function openAI(wrapper: ReturnType<typeof mountPage>) {
  await wrapper.find('.ai-card-header').trigger('click')
  await flushPromises()
}

async function submitText(wrapper: ReturnType<typeof mountPage>, text = '打车50元') {
  await wrapper.find('.ai-input-row textarea').setValue(text)
  await wrapper.find('.btn-ai').trigger('click')
  await flushPromises()
}

beforeEach(() => {
  mocks.get.mockReset()
  mocks.post.mockReset()
  mocks.put.mockReset()
  mocks.delete.mockReset()
})

describe('ExpenseForm AI recognition feedback', () => {
  it('gives AI requests a long timeout so slow models are not cut off', async () => {
    mocks.post.mockResolvedValue({
      data: { items: [{ categoryName: '交通', amount: 50, expenseDate: '2026-11-27', description: '打车' }] },
    })
    const wrapper = mountPage()
    await flushPromises()
    await openAI(wrapper)
    await submitText(wrapper)

    expect(mocks.post).toHaveBeenCalledWith(
      '/ai/parse',
      { text: '打车50元' },
      { timeout: 120000 }
    )
    expect(wrapper.text()).toContain('识别结果')
  })

  it('shows an inline message when recognition returns no items', async () => {
    mocks.post.mockResolvedValue({ data: { items: [] } })
    const wrapper = mountPage()
    await flushPromises()
    await openAI(wrapper)
    await submitText(wrapper)

    expect(wrapper.text()).toContain('未识别到内容')
  })

  it('appends recognized items to the existing expense details instead of clearing them', async () => {
    mocks.post.mockResolvedValue({
      data: { items: [{ categoryName: '餐饮', amount: 88, expenseDate: '2026-11-27', description: '午饭' }] },
    })
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.find('.items-table input[type="number"]').setValue(100)
    await wrapper.find('.items-table input[type="text"]').setValue('原有费用')

    await openAI(wrapper)
    await submitText(wrapper)

    const applyButton = wrapper.findAll('button').find(button => button.text().includes('填入表单'))
    expect(applyButton).toBeTruthy()
    await applyButton!.trigger('click')
    await flushPromises()

    const amounts = wrapper
      .findAll('.items-table input[type="number"]')
      .map(input => (input.element as HTMLInputElement).value)
    expect(amounts).toEqual(['100', '88'])

    const descriptions = wrapper
      .findAll('.items-table input[type="text"]')
      .map(input => (input.element as HTMLInputElement).value)
    expect(descriptions[0]).toBe('原有费用')
  })

  it('drops the blank placeholder row when the form had no real items yet', async () => {
    mocks.post.mockResolvedValue({
      data: { items: [{ categoryName: '交通', amount: 50, expenseDate: '2026-11-27', description: '打车' }] },
    })
    const wrapper = mountPage()
    await flushPromises()

    await openAI(wrapper)
    await submitText(wrapper)
    await wrapper.findAll('button').find(button => button.text().includes('填入表单'))!.trigger('click')
    await flushPromises()

    const amounts = wrapper
      .findAll('.items-table input[type="number"]')
      .map(input => (input.element as HTMLInputElement).value)
    expect(amounts).toEqual(['50'])
  })

  it('shows the AI error next to the AI card instead of only at the page footer', async () => {
    mocks.post.mockRejectedValue({
      response: { data: { error: { message: '截图识别视觉模型未启用，请在系统管理中配置' } } },
    })
    const wrapper = mountPage()
    await flushPromises()
    await openAI(wrapper)
    await submitText(wrapper)

    const alert = wrapper.find('.ai-card [role="alert"]')
    expect(alert.exists()).toBe(true)
    expect(alert.text()).toContain('截图识别视觉模型未启用')
    expect(wrapper.find('.error-msg').exists()).toBe(false)
  })
})
