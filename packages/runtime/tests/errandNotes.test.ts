import { assert, describe, it } from '@effect/vitest'

import { DETAILS_MOST, failedNote, labelOf, stepNote } from '../src/errandNotes'

const PR = 'https://github.com/AltharIDE/althar/pull/698'
/** A host's answer as the tools keep it: its status and a body full of urls, as the person's screencast showed. */
const hostAnswer = (status = 200, body: unknown = undefined) =>
  JSON.stringify({
    status,
    next: null,
    body: body ?? {
      url: 'https://api.github.com/repos/AltharIDE/althar/pulls/698',
      html_url: PR,
      body: 'A long pull request description. '.repeat(30),
      user: { login: 'ninemate', url: 'https://api.github.com/users/ninemate' },
    },
  })

describe('an errand step leaves one short line', () => {
  it('a known tool says what happened in words, with its link as its label', () => {
    const note = stepNote('request_pull_request_reviewers', PR, { reviewers: ['balazsotakomaiya'], teams: [] }, hostAnswer())
    assert.strictEqual(note.title, 'Asked balazsotakomaiya to review #698')
    assert.deepStrictEqual(note.links, [{ label: '#698', url: PR }])
  })

  it('names several reviewers and says how many more', () => {
    assert.strictEqual(
      stepNote('request_pull_request_reviewers', PR, { reviewers: ['a', 'b'] }, hostAnswer()).title,
      'Asked a and b to review #698',
    )
    assert.strictEqual(
      stepNote('request_pull_request_reviewers', PR, { reviewers: ['a', 'b', 'c', 'd'] }, hostAnswer()).title,
      'Asked a, b and 2 more to review #698',
    )
  })

  it('never puts the raw answer, an address or the person’s words in the line', () => {
    const { title } = stepNote('request_pull_request_reviewers', PR, { reviewers: ['x'] }, hostAnswer())
    assert.notInclude(title, 'http')
    assert.notInclude(title, 'Asked:')
    assert.isBelow(title.length, 80)
  })

  it('keeps the raw answer pretty-printed for the fold, cut to a size', () => {
    const { details } = stepNote('request_pull_request_reviewers', PR, { reviewers: ['x'] }, hostAnswer())
    assert.include(details ?? '', '\n  "status": 200')
    const huge = stepNote('request_pull_request_reviewers', PR, {}, hostAnswer(200, { text: 'x'.repeat(20000) }))
    assert.isBelow(huge.details!.length, DETAILS_MOST + 80)
    assert.include(huge.details!, 'more characters cut')
  })

  it('a tool without a phrase of its own says its name, a short target and the status', () => {
    const note = stepNote('save_linear_resource', 'conn_1:issue:DEV-145', {}, hostAnswer(200))
    assert.strictEqual(note.title, 'save linear resource: issue:DEV-145 — done (HTTP 200)')
  })

  it('a failure says plainly what went wrong, in the line', () => {
    const note = stepNote(
      'request_pull_request_reviewers',
      PR,
      { reviewers: ['nobody'] },
      hostAnswer(422, { message: 'Reviews may only be requested from collaborators.' }),
    )
    assert.strictEqual(
      note.title,
      'Couldn’t do this: asked nobody to review #698 — failed: Reviews may only be requested from collaborators. (HTTP 422)',
    )
  })

  it('a sentence Althar wrote is the line as it is, and a long one is cut with the rest folded', () => {
    assert.strictEqual(stepNote('merge_pull_request', PR, {}, '#698 is in the queue.').title, '#698 is in the queue.')
    const long = stepNote('merge_pull_request', PR, {}, `${'It waits for the queue. '.repeat(30)}`)
    assert.isBelow(long.title.length, 260)
    assert.isDefined(long.details)
  })

  it('reads a link as its label', () => {
    assert.deepStrictEqual(labelOf('https://linear.app/acme/issue/DEV-145/short-title')?.label, 'DEV-145')
    assert.deepStrictEqual(labelOf('https://gitlab.com/a/b/-/merge_requests/12')?.label, '!12')
    assert.isNull(labelOf('conn_1:/users'))
  })
})

describe('addresses in a sentence become linked labels', () => {
  it('an opened pull request keeps its own #N, linked, and loses its address', () => {
    const note = stepNote('open_pull_request', 'AltharIDE/althar:feature', {}, `Opened PR #698 (${PR}): Short title.`)
    assert.strictEqual(note.title, 'Opened PR #698: Short title.')
    assert.deepStrictEqual(note.links, [{ label: '#698', url: PR }])
    assert.include(note.details ?? '', PR)
  })

  it('a release address becomes its tag', () => {
    const note = stepNote('publish_release', 'v1.2', {}, 'v1.2 is published already: https://github.com/a/b/releases/tag/v1.2.')
    assert.strictEqual(note.title, 'v1.2 is published already: v1.2.')
    assert.notInclude(note.title, 'http')
  })
})

describe('a step that did not go through says why in its line', () => {
  it('a refusal says it could not be done, with the reason', () => {
    const note = failedNote(
      'request_pull_request_reviewers',
      PR,
      { reviewers: ['x'] },
      'Reviews may only be requested from collaborators.',
      false,
    )
    assert.strictEqual(note.title, 'Couldn’t do this: asked x to review #698 — failed: Reviews may only be requested from collaborators.')
    assert.deepStrictEqual(note.links, [{ label: '#698', url: PR }])
  })

  it('an unknown outcome says it is not known', () => {
    const note = failedNote('mark_pull_request_draft', PR, {}, 'The host did not answer.', true)
    assert.strictEqual(note.title, 'Not sure this went through: marked #698 as a draft — The host did not answer.')
  })
})
