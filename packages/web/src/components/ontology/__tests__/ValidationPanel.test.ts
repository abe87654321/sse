import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const mocks = vi.hoisted(() => ({
  validate: vi.fn(),
}))

vi.mock('../../../api/ontology', () => ({
  ontologyApi: {
    validate: mocks.validate,
  },
}))

import ValidationPanel from '../ValidationPanel.vue'

const emptyResult = {
  valid: true,
  category: null,
  matched_rule: null,
  issues: [],
  suggestions: [],
  source: 'graph',
}

describe('ValidationPanel', () => {
  beforeEach(() => {
    mocks.validate.mockReset()
    mocks.validate.mockResolvedValue({ data: emptyResult })
  })

  it('maps the category ID and name to distinct validation fields', async () => {
    const wrapper = mount(ValidationPanel)

    await wrapper.find('input[aria-label="金额"]').setValue('1200')
    await wrapper.find('input[aria-label="类别 ID"]').setValue('cat-1')
    await wrapper.find('input[aria-label="类别名称"]').setValue('差旅')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mocks.validate).toHaveBeenCalledWith({
      amount: 1200,
      category_id: 'cat-1',
      category_name: '差旅',
    })
  })

  it('does not send an empty category ID as a name', async () => {
    const wrapper = mount(ValidationPanel)

    await wrapper.find('input[aria-label="金额"]').setValue('88')
    await wrapper.find('input[aria-label="类别名称"]').setValue('住宿')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mocks.validate).toHaveBeenCalledWith({
      amount: 88,
      category_name: '住宿',
    })
  })
})
