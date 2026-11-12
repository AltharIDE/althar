import { describe, expect, it } from 'vitest'

import type { ProjectRepository, ProjectRulesView } from '@althar/contracts'
import { TaskEnd } from '@althar/ui'

import { branchesOf, finishOf } from '../src/renderer/features/projectSettings/TasksSection'
import { projectRules, repositories } from './fixtures'

/*
 * A project's Tasks, for each way its branches are named and a task ends: by the person's pattern, as its
 * repositories' docs say, all or some, on a host Althar doesn't know, or pushed with no pull request.
 */

const [api] = repositories as [ProjectRepository, ...ProjectRepository[]]
const notConnected = { ...api, host: { ...api.host!, account: null } }
const unknownHost = {
  ...api,
  host: { product: null, name: 'git.northwind.io', instance: null, path: 'ops/infra', url: null, account: null },
}

const rulesWith = (overrides: Partial<ProjectRulesView> = {}): ProjectRulesView => ({ ...projectRules, ...overrides })

describe('what a task ends with', () => {
  it('is pushed only where the person said so, whatever its hosts', () => {
    expect(finishOf('none', [unknownHost])).toEqual({ kind: 'end', end: TaskEnd.PushOnly })
  })

  it('stays on its branch where no repository is on a host Althar knows', () => {
    expect(finishOf(null, [{ host: null }, unknownHost])).toEqual({ kind: 'unknown' })
  })

  it('is the person’s choice on a known host, or a draft once Althar is signed in to one; else on its branch until it is', () => {
    expect(finishOf('ready', [notConnected])).toEqual({ kind: 'end', end: TaskEnd.ReadyPr })
    expect(finishOf(null, [api])).toEqual({ kind: 'end', end: TaskEnd.DraftPr })
    expect(finishOf(null, [notConnected])).toEqual({ kind: 'unconnected', host: 'GitHub' })
  })
})

describe('how its branches are named', () => {
  /** A repository's conventions: its docs' branch pattern, where they say one. */
  const convention = (repository: string, branch: string | null) => ({
    repository,
    branch: branch === null ? null : { pattern: branch, from: 'CONTRIBUTING.md' },
    title: null,
    template: null,
  })

  it('is the person’s pattern, else what every repository’s docs say, else Althar’s own where they say nothing or some do', () => {
    expect(branchesOf(rulesWith({ branchPattern: 'feat/{slug}' }))).toBe('feat/{slug}')
    expect(branchesOf(rulesWith({ conventions: [convention('api', null)] }))).toBe('althar/{key}-{slug}')
    expect(branchesOf(rulesWith({ conventions: [convention('api', 'feature/*'), convention('web', 'feat/*')] }))).toBe(
      'As each repository’s docs say',
    )
    expect(branchesOf(rulesWith({ conventions: [convention('api', 'feature/*'), convention('web', null)] }))).toBe(
      'As each repository’s docs say, else althar/{key}-{slug}',
    )
  })
})
