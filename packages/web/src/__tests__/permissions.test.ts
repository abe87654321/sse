import { describe, expect, it } from 'vitest'
import {
  NAV_ITEMS,
  canAccessRoute,
  navItemsForRole,
  roleLabel,
} from '@/permissions'

const paths = (role?: string) => navItemsForRole(role).map((item) => item.path)

describe('navItemsForRole', () => {
  it('gives employees only shared entries', () => {
    expect(paths('employee')).toEqual(['/dashboard', '/expenses', '/ontology'])
  })

  it('adds approvals for dept approvers and finance', () => {
    expect(paths('dept_approver')).toEqual([
      '/dashboard',
      '/expenses',
      '/approvals',
      '/ontology',
    ])
    expect(paths('finance')).toEqual([
      '/dashboard',
      '/expenses',
      '/approvals',
      '/statistics',
      '/ontology',
    ])
  })

  it('gives admins every entry', () => {
    expect(paths('admin')).toEqual(NAV_ITEMS.map((item) => item.path))
  })

  it('fails closed for unknown or missing roles', () => {
    expect(paths(undefined)).toEqual([])
    expect(paths('ghost')).toEqual([])
  })
})

describe('canAccessRoute', () => {
  it('treats a missing allowed list as unrestricted', () => {
    expect(canAccessRoute('employee', undefined)).toBe(true)
  })

  it('checks role membership', () => {
    expect(canAccessRoute('finance', ['finance', 'admin'])).toBe(true)
    expect(canAccessRoute('employee', ['finance', 'admin'])).toBe(false)
  })

  it('denies an empty role or empty allow-list', () => {
    expect(canAccessRoute(undefined, ['employee'])).toBe(false)
    expect(canAccessRoute('employee', [])).toBe(false)
  })
})

describe('roleLabel', () => {
  it('maps known roles to Chinese labels', () => {
    expect(roleLabel('employee')).toBe('员工')
    expect(roleLabel('dept_approver')).toBe('部门审批人')
    expect(roleLabel('finance')).toBe('财务')
    expect(roleLabel('admin')).toBe('系统管理员')
  })

  it('falls back for unknown or missing roles', () => {
    expect(roleLabel(undefined)).toBe('未知角色')
    expect(roleLabel('ghost')).toBe('ghost')
  })
})
