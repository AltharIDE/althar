import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { branchFor, branchPatternOf, keepsTemplate, namingIn, titleFor, titlePatternOf } from '../src/conventions'
import { bodyOf } from '../src/pullRequestWords'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, runtime, task } from './support'

/*
 * A team's conventions (DEV-42): what a repository's docs say of naming,
 * the names Althar gives with them, with a rule, or with neither, and a
 * description in a template.
 */

const doc = (text: string, path = 'CONTRIBUTING.md') => [{ path, text }]

describe('what a repository’s docs say of naming', () => {
  it('reads an example or a pattern, from the first doc that says it', () => {
    assert.deepStrictEqual(
      namingIn([
        { path: 'CONTRIBUTING.md', text: 'Branches look like `feature/PROJ-123-short-description`.' },
        { path: 'README.md', text: 'Name your branch `bugfix/<description>`.' },
      ]).branch,
      { pattern: 'feature/{key}-{slug}', from: 'CONTRIBUTING.md' },
    )
    assert.strictEqual(
      namingIn(doc('## Branches\n\n```\ngit checkout -b feat/<ticket>/<short-name>\n```')).branch?.pattern,
      'feat/{key}/{slug}',
    )
    assert.strictEqual(
      namingIn(doc('## Pull requests\n\nStart the title with the ticket: `PROJ-123: Add login`.')).title?.pattern,
      '{key}: {title}',
    )
    assert.strictEqual(namingIn(doc('Title your PR like `[PROJ-123] Short summary`.')).title?.pattern, '[{key}] {title}')
  })

  it('reads nothing where the docs leave it to judgement, or only name branches', () => {
    // Several kinds, `feature/` or `fix/`: which is a judgement, not a pattern.
    assert.isNull(namingIn(doc('Branch from `main` as `feature/<description>` or `fix/<description>`.')).branch)
    assert.isNull(namingIn(doc('Always branch off `origin/main`, never `develop`.')).branch)
    assert.isNull(namingIn(doc('Branches are named `<type>/<description>`.')).branch)
    assert.isNull(namingIn(doc('Branch names: `users/<name>/<topic>`.')).branch)
    // The contributing guide leaves it open: an older readme further down doesn't decide it.
    assert.isNull(
      namingIn([
        { path: 'CONTRIBUTING.md', text: 'Branch as `feature/<description>` or `fix/<description>`.' },
        { path: 'README.md', text: 'Branches: `feature/<description>`.' },
      ]).branch,
    )
    // Conventional Commits: the type is the author's call.
    assert.isNull(namingIn(doc('PR titles follow Conventional Commits, as in `feat(api): add login`.')).title)
  })
})

describe('a doc’s pattern, as Althar reads it', () => {
  it('takes Althar’s own placeholders as they are, and none that leaves only a description', () => {
    assert.strictEqual(branchPatternOf('feature/{key}-{slug}'), 'feature/{key}-{slug}')
    assert.strictEqual(titlePatternOf('{key}: {title}'), '{key}: {title}')
    // A branch that is the description alone is no convention.
    assert.isNull(branchPatternOf('<description>'))
    assert.isNull(branchPatternOf('{slug}'))
  })

  it('reads a title only of the issue’s key and the title, with nothing it can’t fill and no other words', () => {
    assert.strictEqual(titlePatternOf('<ticket>: <title>'), '{key}: {title}')
    assert.isNull(titlePatternOf('<type>: <title>'))
    assert.isNull(titlePatternOf('feat: PROJ-123 add login'))
  })
})

describe('the names Althar gives', () => {
  it('without a rule or a doc, as it always has', () => {
    assert.strictEqual(branchFor(null, { key: null, slug: 'fix-login' }), 'althar/fix-login')
    assert.strictEqual(branchFor(null, { key: 'MER-231', slug: 'fix-login' }), 'althar/mer-231-fix-login')
    assert.strictEqual(titleFor(null, { title: 'Fix login', issue: { key: 'MER-231', sameHost: false } }), 'MER-231: Fix login')
    assert.strictEqual(titleFor(null, { title: 'Fix login', issue: { key: '#12', sameHost: true } }), 'Fix login')
  })

  it('by a pattern, with the key as the tracker writes it, even where the issue is on the same host', () => {
    assert.strictEqual(branchFor('feature/{key}-{slug}', { key: 'PROJ-123', slug: 'fix-login' }), 'feature/PROJ-123-fix-login')
    assert.strictEqual(branchFor('feature/{key}-{slug}', { key: '#12', slug: 'fix-login' }), 'feature/12-fix-login')
    assert.strictEqual(titleFor('{key}: {title}', { title: 'Fix login', issue: { key: '#12', sameHost: true } }), '#12: Fix login')
    // From no issue, the title alone.
    assert.strictEqual(titleFor('{key}: {title}', { title: 'Fix login', issue: null }), 'Fix login')
    // A name git would refuse, from a key it can't take or a pattern that starts badly, is Althar's own instead.
    assert.strictEqual(branchFor('feature/{key}-{slug}', { key: 'A..B', slug: 'fix-login' }), 'feature/A-B-fix-login')
    assert.strictEqual(branchFor('{key}-{slug}', { key: '-1', slug: 'fix-login' }), 'althar/-1-fix-login')
  })
})

describe('a description in the repository’s template', () => {
  const template = '## Summary\n\n<!-- What and why. -->\n\n## How to test\n\n## Checklist\n\n- [ ] Tests pass\n'
  const nothingElse = { issue: null } as const

  it('is the template itself, unticked, where nothing was written or done to put in it', () => {
    assert.strictEqual(
      bodyOf({ lead: null, ...nothingElse, template: '## Summary\n\n- [x] Done\n', written: null }),
      '## Summary\n\n- [ ] Done\n\nOpened by [Althar](https://github.com/AltharIDE/althar).',
    )
  })

  it('isn’t kept where the lead’s leaves out an item of the template’s checklist', () => {
    assert.isFalse(keepsTemplate('## Checklist\n\n- [ ] Tests pass\n', '## Checklist\n\nDone.'))
    assert.isTrue(keepsTemplate('## Checklist\n\n- [ ] Tests pass\n', '## Checklist\n\n- [x] Tests pass\n'))
  })

  it('with no template, is the lead’s own, else what it did', () => {
    assert.strictEqual(
      bodyOf({ lead: 'Did it.', ...nothingElse, template: null, written: null }),
      'Did it.\n\nOpened by [Althar](https://github.com/AltharIDE/althar).',
    )
    assert.strictEqual(
      bodyOf({ built: 'Built it.', lead: 'Did it.', ...nothingElse, template: null, written: 'Why, and what.' }),
      'Why, and what.\n\nOpened by [Althar](https://github.com/AltharIDE/althar).',
    )
  })

  it('reads no heading in a template’s fenced code', () => {
    const fenced = '## Summary\n\n```sh\n# run the tests\nbun test\n```\n'
    assert.strictEqual(
      bodyOf({ lead: 'Did it.', ...nothingElse, template: fenced, written: '## Summary\n\nDid it.' }),
      '## Summary\n\nDid it.\n\nOpened by [Althar](https://github.com/AltharIDE/althar).',
    )
  })

  it('takes the lead’s, unticked, where it keeps the template, with nothing of what the task built above it', () => {
    const written = '## Summary\n\nDid it.\n\n## How to test\n\nRun it.\n\n## Checklist\n\n- [x] Tests pass\n'
    assert.strictEqual(
      bodyOf({ built: 'Built it. Try it at localhost.', lead: 'Did it.', ...nothingElse, template, written }),
      '## Summary\n\nDid it.\n\n## How to test\n\nRun it.\n\n## Checklist\n\n- [ ] Tests pass\n\nOpened by [Althar](https://github.com/AltharIDE/althar).',
    )
  })

  it('puts the summary in the template’s place for it where the lead’s drops a heading, or below where it has none', () => {
    assert.strictEqual(
      bodyOf({ lead: 'Did it.', ...nothingElse, template, written: 'Did it, my own way.' }),
      '## Summary\n\n<!-- What and why. -->\n\nDid it.\n\n## How to test\n\n## Checklist\n\n- [ ] Tests pass\n\nOpened by [Althar](https://github.com/AltharIDE/althar).',
    )
    // `What type of change` is a checklist; the summary goes under Description.
    assert.strictEqual(
      bodyOf({ lead: 'Did it.', ...nothingElse, template: '## What type of change?\n\n- [ ] Fix\n\n## Description\n', written: null }),
      '## What type of change?\n\n- [ ] Fix\n\n## Description\n\nDid it.\n\nOpened by [Althar](https://github.com/AltharIDE/althar).',
    )
    assert.strictEqual(
      bodyOf({ lead: 'Did it.', ...nothingElse, template: '## Checklist\n\n- [ ] Tests pass', written: null }),
      '## Checklist\n\n- [ ] Tests pass\n\n### Summary\n\nDid it.\n\nOpened by [Althar](https://github.com/AltharIDE/althar).',
    )
  })
})

describe('the descriptions a lead gives', () => {
  it.live('are kept by the repository each is for, and refused for one the task doesn’t change', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { project, task: made } = yield* task('Say hello')
      const lead: ToolAccess = {
        role: 'lead',
        projectId: project.projectId,
        threadId: made.threadId,
        sessionId: 'none',
        taskId: made.taskId,
      }
      const elsewhere = yield* callTool(lead, 'finish_step', {
        summary: 'Did it.',
        built: 'A hello.',
        descriptions: [{ repository: 'elsewhere', text: 'x' }],
      })
      assert.match(elsewhere, /^Say which repository each description is for: /)
      // A task of one needn't name it.
      const kept = yield* callTool(lead, 'finish_step', {
        summary: 'Did it.',
        built: 'A hello.',
        descriptions: [{ text: '## Summary\n\nDid it.' }],
      })
      assert.strictEqual(kept, 'Althar has your summary.')
      const [item] = yield* sql<{ content: string }>`
        SELECT content FROM thread_items WHERE thread_id = ${made.threadId} AND kind = 'step_result'`
      const [slug] = yield* sql<{ slug: string }>`SELECT slug FROM repository_bindings`
      assert.deepStrictEqual((JSON.parse(item?.content ?? '{}') as { descriptions?: unknown }).descriptions, {
        [slug?.slug ?? '']: '## Summary\n\nDid it.',
      })
    }).pipe(Effect.provide(runtime())),
  )
})
