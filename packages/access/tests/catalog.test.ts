import { describe, expect, it } from 'vitest'

import {
  catalog,
  isPermission,
  organizationPermissions,
  organizationRoles,
  permissionInfo,
  permissions,
  projectAccessLevels,
  projectPermissions,
  teamAdminPermissions,
} from '../src'

describe('the catalog and the roles', () => {
  it('names every permission as resource.action, in lower case', () => {
    for (const permission of permissions) expect(permission).toMatch(/^[a-z_]+(\.[a-z_]+)+$/)
    expect(isPermission('tasks.run')).toBe(true)
    expect(isPermission('toString')).toBe(false)
  })

  it('gives each role only permissions of its own scope', () => {
    for (const role of organizationRoles)
      for (const permission of organizationPermissions[role]) expect(permissionInfo(permission).scope).toBe('organization')
    for (const level of projectAccessLevels)
      for (const permission of projectPermissions[level]) expect(permissionInfo(permission).scope).toBe('project')
    for (const permission of teamAdminPermissions) expect(permissionInfo(permission).scope).toBe('team')
  })

  it('makes each level of project access hold everything the one below does', () => {
    for (const [lower, higher] of projectAccessLevels.slice(0, -1).map((level, at) => [level, projectAccessLevels[at + 1]!] as const))
      for (const permission of projectPermissions[lower]) expect(projectPermissions[higher].has(permission)).toBe(true)
  })

  it('reaches every project permission from Admin, so none is left unreachable', () => {
    const project = permissions.filter((permission) => catalog[permission].scope === 'project')
    expect(project.filter((permission) => !projectPermissions.admin.has(permission))).toEqual([])
  })
})
