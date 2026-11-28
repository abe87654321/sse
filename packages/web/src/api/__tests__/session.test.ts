import { describe, expect, it } from 'vitest'
import { shouldMarkSessionExpired } from '../session'

describe('shouldMarkSessionExpired', () => {
  it('marks a 401 from a normal API call', () => {
    expect(shouldMarkSessionExpired(401, '/notifications/unread-count')).toBe(true)
    expect(shouldMarkSessionExpired(401, '/expenses')).toBe(true)
  })

  it('ignores auth endpoints so a wrong password is not treated as an expired session', () => {
    expect(shouldMarkSessionExpired(401, '/auth/login')).toBe(false)
    expect(shouldMarkSessionExpired(401, '/auth/api-key-login')).toBe(false)
    expect(shouldMarkSessionExpired(401, '/auth/refresh')).toBe(false)
  })

  it('ignores non-401 responses', () => {
    expect(shouldMarkSessionExpired(403, '/expenses')).toBe(false)
    expect(shouldMarkSessionExpired(undefined, '/expenses')).toBe(false)
  })
})
