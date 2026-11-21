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

import AdminMessages from '../AdminMessages.vue'

const draft = {
  id: 'msg-1',
  title: '测试通知',
  body: '原始正文',
  body_ai: '',
  body_ai_instruction: '',
  target_roles: ['employee'],
  target_user_ids: [],
  delivery_channels: [],
  status: 'draft',
  updated_at: '2026-11-20T00:00:00.000Z',
}

function mountPage(messages: any[] = [draft]) {
  mocks.get.mockImplementation((url: string) => {
    if (url === '/admin/messages') return Promise.resolve({ data: messages })
    return Promise.resolve({ data: [] })
  })
  return mount(AdminMessages, {
    global: { stubs: { UserPicker: true } },
  })
}

async function openDraft(wrapper: ReturnType<typeof mountPage>) {
  const edit = wrapper.findAll('button').find(button => button.text() === '编辑')
  expect(edit).toBeTruthy()
  await edit!.trigger('click')
  await flushPromises()
}

beforeEach(() => {
  mocks.get.mockReset()
  mocks.post.mockReset()
  mocks.put.mockReset()
  mocks.delete.mockReset()
})

describe('AdminMessages AI polish', () => {
  it('calls the admin-configured AI endpoint with a long timeout and previews the result', async () => {
    mocks.post.mockResolvedValue({ data: { polished_body: '润色后的正文', model: 'admin-selected-model' } })
    const wrapper = mountPage()
    await flushPromises()
    await openDraft(wrapper)

    await wrapper.find('[data-test="ai-polish"]').trigger('click')
    await flushPromises()

    expect(mocks.post).toHaveBeenCalledWith(
      '/ai/polish',
      { body: '原始正文', instruction: undefined, previous: undefined },
      { timeout: 120000 }
    )
    expect(wrapper.text()).toContain('润色后的正文')
    expect(wrapper.text()).toContain('使用模型：admin-selected-model')
  })

  it('applies the polished text but keeps the original so it can be undone', async () => {
    mocks.post.mockResolvedValue({ data: { polished_body: '润色后的正文', model: 'admin-selected-model' } })
    const wrapper = mountPage()
    await flushPromises()
    await openDraft(wrapper)

    await wrapper.find('[data-test="ai-polish"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-test="accept-polish"]').trigger('click')
    await flushPromises()

    const textarea = wrapper.find('.composer-modal textarea')
    expect((textarea.element as HTMLTextAreaElement).value).toBe('润色后的正文')

    await wrapper.find('[data-test="undo-polish"]').trigger('click')
    await flushPromises()
    expect((textarea.element as HTMLTextAreaElement).value).toBe('原始正文')
  })

  it('persists the original body, polished body and polish instruction separately', async () => {
    mocks.post.mockResolvedValue({ data: { polished_body: '润色后的正文', model: 'admin-selected-model' } })
    mocks.put.mockResolvedValue({ data: {} })
    const wrapper = mountPage()
    await flushPromises()
    await openDraft(wrapper)

    await wrapper.find('input[placeholder^="例如：更正式"]').setValue('更正式一些')
    await wrapper.find('[data-test="ai-polish"]').trigger('click')
    await flushPromises()

    expect(mocks.post).toHaveBeenCalledWith(
      '/ai/polish',
      { body: '原始正文', instruction: '更正式一些', previous: undefined },
      { timeout: 120000 }
    )

    await wrapper.find('[data-test="accept-polish"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-test="save-draft"]').trigger('click')
    await flushPromises()

    expect(mocks.put).toHaveBeenCalledWith(
      `/admin/messages/${draft.id}`,
      expect.objectContaining({
        body: '原始正文',
        body_ai: '润色后的正文',
        body_ai_instruction: '更正式一些',
      })
    )
  })

  it('restores an existing polished draft with the original still available', async () => {
    const polishedDraft = {
      ...draft,
      body: '原始正文',
      body_ai: '已保存的润色版',
      body_ai_instruction: '更简洁',
    }
    const wrapper = mountPage([polishedDraft])
    await flushPromises()
    await openDraft(wrapper)

    const textarea = wrapper.find('.composer-modal textarea')
    expect((textarea.element as HTMLTextAreaElement).value).toBe('已保存的润色版')
    expect(wrapper.find('[data-test="undo-polish"]').exists()).toBe(true)

    await wrapper.find('[data-test="undo-polish"]').trigger('click')
    await flushPromises()
    expect((textarea.element as HTMLTextAreaElement).value).toBe('原始正文')
  })
})
