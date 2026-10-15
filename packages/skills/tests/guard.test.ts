import { describe, expect, it } from 'vitest'
import { blockedBeforeCommit, blockedBeforePush, DEFAULT_REPOSITORY_FILES, protectedKind } from '../src/guard'

describe('protectedKind', () => {
  it.each([
    ['.claude/skills/x/SKILL.md', 'skills'],
    ['.agents/skills/x/SKILL.md', 'skills'],
    ['.opencode/skills/x/a.md', 'skills'],
    ['packages/app/.claude/skills/x/SKILL.md', 'skills'],
    ['./.Claude/Skills/x/SKILL.md', 'skills'],
    ['.claude\\skills\\x\\SKILL.md', 'skills'],
    ['openspec/changes/a/proposal.md', 'openspec'],
    ['OpenSpec/specs/a.md', 'openspec'],
  ])('puts %s under %s', (path, kind) => expect(protectedKind(path)).toBe(kind))

  it.each(['src/skills/a.ts', '.claude/settings.json', '.claude/skills', 'openspec', 'docs/openspec/a.md', 'skills/x/SKILL.md'])(
    'leaves %s alone',
    (path) => expect(protectedKind(path)).toBeNull(),
  )
})

describe('the commit check', () => {
  const paths = ['src/a.ts', '.claude/skills/x/SKILL.md', 'openspec/specs/a.md']

  it('blocks both classes by default, even for files nobody marked', () => {
    expect(blockedBeforeCommit(paths, DEFAULT_REPOSITORY_FILES)).toEqual([
      { path: '.claude/skills/x/SKILL.md', kind: 'skills', reason: 'write-off' },
      { path: 'openspec/specs/a.md', kind: 'openspec', reason: 'write-off' },
    ])
  })

  it('lets each class through on its own switch', () => {
    expect(blockedBeforeCommit(paths, { ...DEFAULT_REPOSITORY_FILES, writeSkills: true }).map(({ kind }) => kind)).toEqual(['openspec'])
    expect(blockedBeforeCommit(paths, { ...DEFAULT_REPOSITORY_FILES, writeOpenSpec: true }).map(({ kind }) => kind)).toEqual(['skills'])
  })

  it('lets a one-time grant through for the directory it names only', () => {
    expect(blockedBeforeCommit(paths, DEFAULT_REPOSITORY_FILES, ['.claude/skills/x/']).map(({ kind }) => kind)).toEqual(['openspec'])
    expect(blockedBeforeCommit(['.claude/skills/xy/a.md'], DEFAULT_REPOSITORY_FILES, ['.claude/skills/x'])).toHaveLength(1)
  })
})

describe('the push check', () => {
  const paths = ['src/a.ts', '.agents/skills/x/SKILL.md', 'openspec/a.md']

  it('blocks protected paths even when writing them is on', () => {
    const settings = { writeSkills: true, writeOpenSpec: true, pushProtected: false }
    expect(blockedBeforePush(paths, settings).map(({ reason }) => reason)).toEqual(['push-off', 'push-off'])
  })

  it('passes them only with the separate push switch', () => {
    expect(blockedBeforePush(paths, { ...DEFAULT_REPOSITORY_FILES, pushProtected: true })).toEqual([])
  })
})
