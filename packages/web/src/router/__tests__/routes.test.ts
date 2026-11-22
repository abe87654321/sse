import { describe, expect, it } from 'vitest'
import router from '@/router'
import { NAV_ITEMS } from '@/permissions'

describe('navigation routes', () => {
  it('only links to routes that exist', () => {
    for (const item of NAV_ITEMS) {
      expect(router.resolve(item.path).matched.length, item.path).toBeGreaterThan(0)
    }
  })
})
