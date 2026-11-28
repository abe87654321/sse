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

function pdfFile(name: string, content = 'x') {
  return new File([content], name, { type: 'application/pdf' })
}

async function selectFiles(
  wrapper: ReturnType<typeof mountPage>,
  selector: string,
  files: File[],
) {
  const input = wrapper.find(selector)
  Object.defineProperty(input.element, 'files', { value: files, configurable: true })
  await input.trigger('change')
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

  it('opens an invoice picker menu with file and folder options', async () => {
    const wrapper = mountPage()
    await flushPromises()
    await openAI(wrapper)

    await wrapper.find('.ai-invoice-picker-btn').trigger('click')
    const menu = wrapper.find('.ai-invoice-menu')
    expect(menu.exists()).toBe(true)
    expect(menu.text()).toContain('选择发票文件')
    expect(menu.text()).toContain('选择发票文件夹')
  })

  it('adds multiple PDF/OFD files and ignores other extensions', async () => {
    const wrapper = mountPage()
    await flushPromises()
    await openAI(wrapper)

    await selectFiles(wrapper, '.ai-text-invoice-input', [
      pdfFile('a.pdf'),
      pdfFile('b.ofd', 'yy'),
      new File(['x'], 'c.txt', { type: 'text/plain' }),
    ])

    expect(wrapper.findAll('.ai-file-chip')).toHaveLength(2)
    expect(wrapper.find('.ai-file-notice').text()).toContain('忽略')
  })

  it('caps folder selection at 20 invoice files', async () => {
    const wrapper = mountPage()
    await flushPromises()
    await openAI(wrapper)

    const files = Array.from({ length: 22 }, (_, index) => pdfFile(`f${index}.pdf`))
    await selectFiles(wrapper, '.ai-text-invoice-dir', files)

    expect(wrapper.findAll('.ai-file-chip')).toHaveLength(20)
    expect(wrapper.find('.ai-file-notice').text()).toContain('忽略')
  })

  it('parses the text and every selected invoice, merging the results', async () => {
    mocks.post.mockImplementation((url: string) => {
      if (url === '/ai/parse') {
        return Promise.resolve({
          data: { items: [{ categoryName: '交通', amount: 50, expenseDate: '2026-11-27', description: '打车' }] },
        })
      }
      if (url === '/ai/parse-invoice') {
        return Promise.resolve({
          data: { items: [{ categoryName: '餐饮', amount: 88, expenseDate: '2026-11-27', description: '午饭' }] },
        })
      }
      return Promise.reject(new Error(`unexpected ${url}`))
    })
    const wrapper = mountPage()
    await flushPromises()
    await openAI(wrapper)

    await selectFiles(wrapper, '.ai-text-invoice-input', [pdfFile('a.pdf'), pdfFile('b.pdf')])
    await wrapper.find('.ai-input-row textarea').setValue('打车50元')
    await wrapper.find('.btn-ai').trigger('click')
    await flushPromises()

    expect(mocks.post.mock.calls.filter(call => call[0] === '/ai/parse')).toHaveLength(1)
    const invoiceCalls = mocks.post.mock.calls.filter(call => call[0] === '/ai/parse-invoice')
    expect(invoiceCalls).toHaveLength(2)
    expect(invoiceCalls[0][2]).toMatchObject({ timeout: 120000 })
    expect(wrapper.findAll('.ai-result-item')).toHaveLength(3)
  })

  it('keeps successful invoices and lists the failed ones', async () => {
    let invoiceCall = 0
    mocks.post.mockImplementation((url: string) => {
      if (url === '/ai/parse-invoice') {
        invoiceCall += 1
        if (invoiceCall === 1) {
          return Promise.reject({ response: { data: { error: { message: 'MinerU 解析失败' } } } })
        }
        return Promise.resolve({
          data: { items: [{ categoryName: '餐饮', amount: 88, expenseDate: '2026-11-27', description: '午饭' }] },
        })
      }
      return Promise.resolve({ data: { items: [] } })
    })
    const wrapper = mountPage()
    await flushPromises()
    await openAI(wrapper)

    await selectFiles(wrapper, '.ai-text-invoice-input', [pdfFile('bad.pdf'), pdfFile('good.pdf')])
    await wrapper.find('.btn-ai').trigger('click')
    await flushPromises()

    expect(mocks.post.mock.calls.filter(call => call[0] === '/ai/parse-invoice')).toHaveLength(2)
    expect(wrapper.find('.ai-file-errors').text()).toContain('bad.pdf')
    expect(wrapper.findAll('.ai-result-item')).toHaveLength(1)
  })

  it('attaches the uploaded invoice file to the filled expense item', async () => {
    mocks.post.mockResolvedValue({
      data: { items: [{ categoryName: '餐饮', amount: 88, expenseDate: '2026-11-27', description: '午饭' }] },
    })
    const wrapper = mountPage()
    await flushPromises()
    await openAI(wrapper)

    await wrapper.findAll('.ai-tab').find(tab => tab.text().includes('上传发票'))!.trigger('click')
    await selectFiles(wrapper, '.ai-file-row input[type="file"]', [pdfFile('invoice.pdf')])
    await wrapper.find('.btn-ai').trigger('click')
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text().includes('填入表单'))!.trigger('click')
    await flushPromises()

    expect(wrapper.findAll('.invoice-row').map(row => row.text()).join(' ')).toContain('invoice.pdf')
  })

  it('attaches each selected invoice file to its recognized item', async () => {
    mocks.post.mockImplementation((url: string) => {
      if (url === '/ai/parse-invoice') {
        return Promise.resolve({
          data: { items: [{ categoryName: '餐饮', amount: 88, expenseDate: '2026-11-27', description: '午饭' }] },
        })
      }
      return Promise.resolve({ data: { items: [] } })
    })
    const wrapper = mountPage()
    await flushPromises()
    await openAI(wrapper)

    await selectFiles(wrapper, '.ai-text-invoice-input', [pdfFile('a.pdf'), pdfFile('b.ofd')])
    await wrapper.find('.btn-ai').trigger('click')
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text().includes('填入表单'))!.trigger('click')
    await flushPromises()

    const invoiceText = wrapper.findAll('.invoice-row').map(row => row.text()).join(' ')
    expect(invoiceText).toContain('a.pdf')
    expect(invoiceText).toContain('b.ofd')
  })

  it('keeps the recognize button disabled until text or invoice files are provided', async () => {
    const wrapper = mountPage()
    await flushPromises()
    await openAI(wrapper)

    expect(wrapper.find('.btn-ai').attributes('disabled')).toBeDefined()

    await selectFiles(wrapper, '.ai-text-invoice-input', [pdfFile('a.pdf')])
    expect(wrapper.find('.btn-ai').attributes('disabled')).toBeUndefined()
  })
})
