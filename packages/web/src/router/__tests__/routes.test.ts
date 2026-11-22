import { describe, expect, it } from 'vitest'
import router from '@/router'
import { NAV_ITEMS } from '@/permissions'

describe('navigation routes', () => {
  it('only links to routes that exist', () => {
    for (const item of NAV_ITEMS) {
      expect(router.resolve(item.path).matched.length, item.path).toBeGreaterThan(0)
    }
  })

  it('never shows a nav link to a role the route denies', () => {
    for (const item of NAV_ITEMS) {
      const { meta } = router.resolve(item.path)
      if (meta.allowedRoles === undefined) continue
      for (const role of item.roles) {
        expect(meta.allowedRoles, `${item.path} -> ${role}`).toContain(role)
      }
    }
  })
})
