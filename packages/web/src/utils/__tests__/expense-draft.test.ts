import { beforeEach, describe, expect, it } from 'vitest'
import {
  NEW_EXPENSE_DRAFT_KEY,
  clearDraftFields,
  clearDraftFiles,
  hasDraftContent,
  loadDraftFields,
  loadDraftFiles,
  saveDraftFields,
  saveDraftFiles,
} from '../expense-draft'

beforeEach(() => {
  localStorage.clear()
})

describe('hasDraftContent', () => {
  it('treats a blank new form as empty', () => {
    expect(hasDraftContent(null)).toBe(false)
    expect(hasDraftContent({
      title: '',
      description: '',
      items: [{ categoryId: '', amount: 0, expenseDate: '2026-11-28', description: '' }],
    })).toBe(false)
  })

  it('detects title, description and item content', () => {
    expect(hasDraftContent({ title: '差旅', description: '', items: [] })).toBe(true)
    expect(hasDraftContent({ title: '', description: '备注', items: [] })).toBe(true)
    expect(hasDraftContent({
      title: '',
      description: '',
      items: [{ categoryId: '', amount: 12, expenseDate: '', description: '' }],
    })).toBe(true)
    expect(hasDraftContent({
      title: '',
      description: '',
      items: [{ categoryId: 'c1', amount: 0, expenseDate: '', description: '' }],
    })).toBe(true)
  })
})

describe('draft fields', () => {
  it('round-trips and clears', () => {
    const draft = {
      version: 1 as const,
      title: '差旅',
      description: '备注',
      aiTab: 'text',
      items: [{ categoryId: 'c1', amount: 12, expenseDate: '2026-11-28', description: '打车' }],
      updatedAt: 1,
    }
    saveDraftFields(draft)
    expect(loadDraftFields()).toEqual(draft)
    clearDraftFields()
    expect(loadDraftFields()).toBeNull()
    expect(localStorage.getItem(NEW_EXPENSE_DRAFT_KEY)).toBeNull()
  })

  it('ignores malformed data', () => {
    localStorage.setItem(NEW_EXPENSE_DRAFT_KEY, '{bad json')
    expect(loadDraftFields()).toBeNull()
  })
})

describe('draft files without IndexedDB', () => {
  it('resolves safely instead of throwing', async () => {
    await expect(saveDraftFiles([null])).resolves.toBeUndefined()
    await expect(loadDraftFiles()).resolves.toEqual([])
    await expect(clearDraftFiles()).resolves.toBeUndefined()
  })
})
