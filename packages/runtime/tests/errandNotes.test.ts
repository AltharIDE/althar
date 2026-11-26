import { assert, describe, it } from '@effect/vitest'

import {
  afterStep,
  calledOffNote,
  DETAILS_MOST,
  failedNote,
  heldNote,
  keptNote,
  labelOf,
  mergesLeft,
  plainReason,
  resumedNote,
  settledNote,
  stepNote,
  stillNote,
  unwatched,
} from '../src/errandNotes'

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

describe('a kept errand reads in plain words', () => {
  const merge = {
    tool: 'merge_pull_request',
    target: 'AltharIDE/althar pull request from althar/release-prep-althar-0-9-0',
    says: 'Merge the 0.9.0 pull request',
    waits: [
      { kind: 'pull_request_opened', says: 'it’s open' },
      { kind: 'checks_passed', says: 'its checks pass' },
    ],
  }
  const tag = { tool: 'push_tag', target: 'AltharIDE/althar v0.9.0', says: 'Tag v0.9.0', waits: [{ kind: 'merged' }] }

  it('says each step in its words, in order, with what the first waits for, and folds the ask and every wait', () => {
    const note = keptNote('Once 0.9.0 is ready and on prs, merge for me then tag', [merge, tag])
    assert.strictEqual(note.title, 'Kept your errand: merge the 0.9.0 pull request once it’s open and its checks pass, then tag v0.9.0')
    assert.strictEqual(
      note.details,
      'You said: “Once 0.9.0 is ready and on prs, merge for me then tag”\n\n1. Merge the 0.9.0 pull request once it’s open and its checks pass\n2. Tag v0.9.0 once it’s merged',
    )
  })

  it('without the agent’s words, says the tool and target short, and the waits Althar knows', () => {
    const note = keptNote('merge it', [{ tool: 'merge_pull_request', target: PR, waits: [{ kind: 'merge_line' }, { kind: 'checks' }] }])
    assert.strictEqual(note.title, 'Kept your errand: merge #698 once its turn to merge comes and its checks pass')
    assert.deepStrictEqual(note.links, [{ label: '#698', url: PR }])
    assert.notMatch(note.title, /merge_line|checks_|AltharIDE/)
  })

  it('without the agent’s words, never says a target that only a branch or a repository names', () => {
    const steps = [
      { ...merge, says: undefined, waits: [{ kind: 'pull_request_opened' }, { kind: 'checks_passed' }] },
      { ...tag, says: undefined },
    ]
    const note = keptNote('Once 0.9.0 is ready and on prs, merge for me then tag', steps)
    assert.strictEqual(note.title, 'Kept your errand: merge the pull request once it’s open and its checks pass, then tag v0.9.0')
    assert.notMatch(`${note.title}\n${(note.details ?? '').split('\n').slice(1).join('\n')}`, /AltharIDE|release-prep|althar\//)
    // A task's pull request, as errands bind it before it exists, and a tag named in the tool's arguments.
    const task = [
      { tool: 'merge_pull_request', target: 'task:release-prep-althar-0-9-0', waits: [{ kind: 'task_pull_request' }] },
      { tool: 'push_tag', target: 'AltharIDE/althar tag', request: { tag: 'v0.9.0' }, waits: [{ kind: 'task_merged' }] },
    ]
    assert.strictEqual(
      keptNote('merge then tag', task).title,
      'Kept your errand: merge the pull request once its pull request is ready, then tag v0.9.0',
    )
    assert.strictEqual(afterStep({ title: 'Merged #958', links: [] }, task[1]).title, 'Merged #958. Next: tag v0.9.0')
    assert.strictEqual(
      stillNote(false, null, [task[0]!]).title,
      'Errand still waits to merge the pull request once its pull request is ready',
    )
  })

  it('names three steps and counts the rest', () => {
    const steps = ['One', 'Two', 'Three', 'Four', 'Five'].map((says) => ({ tool: 'x', target: 'y', says, waits: [] }))
    assert.strictEqual(keptNote('all of it', steps).title, 'Kept your errand: one, then two, then three, then 2 more steps')
  })

  it('a step’s note says what comes next, or that the errand is done', () => {
    const merged = stepNote('merge_pull_request', PR, {}, hostAnswer())
    assert.strictEqual(afterStep(merged, tag).title, 'Merged #698. Next: tag v0.9.0')
    assert.strictEqual(afterStep({ title: 'Tagged v0.9.0.', links: [] }, undefined).title, 'Tagged v0.9.0. Errand done')
  })

  it('the daily reminder says where it waits, or why it is on hold', () => {
    assert.strictEqual(
      stillNote(false, null, [merge]).title,
      'Errand still waits to merge the 0.9.0 pull request once it’s open and its checks pass',
    )
    assert.strictEqual(
      stillNote(true, 'You asked to wait for the changelog.', [merge]).title,
      'Errand still on hold: merge the 0.9.0 pull request — you asked to wait for the changelog. Say go ahead to continue.',
    )
  })
})

describe('an errand on hold, called off, resumed or failed reads in plain words', () => {
  const merge = {
    tool: 'merge_pull_request',
    target: 'task:release-prep',
    says: 'Merge the 0.9.0 pull request',
    waits: [{ kind: 'merged' }],
  }
  const tag = { tool: 'push_tag', target: 'AltharIDE/althar v0.9.0', says: 'Tag v0.9.0', waits: [{ kind: 'task_merged' }] }
  const watched = ['task_pull_request', 'task_merged', 'merge_line', 'checks']

  it('says the step on hold, why in a phrase, and what to do; never a wait kind or an order to the agent', () => {
    const reason =
      'Althar cannot watch wait kinds: merged. Watched kinds: task_pull_request, task_merged, merge_line. Keep this errand again with watched waits on the person’s fresh word.'
    const note = heldNote([merge, tag], reason, unwatched([merge, tag], watched))
    assert.strictEqual(
      note.title,
      'Errand on hold: merge the 0.9.0 pull request, then tag v0.9.0 — Althar can’t tell when it’s merged. Ask for it again to keep it another way.',
    )
    assert.notMatch(note.title, /_|Watched|wait kinds|fresh word/)
  })

  it('an unwatched kind Althar has no words for still says nothing raw', () => {
    const odd = { ...merge, waits: [{ kind: 'imaginary_kind' }] }
    assert.strictEqual(unwatched([odd], watched)?.why, 'Althar can’t tell what it waits for')
    assert.isUndefined(unwatched([tag], watched))
  })

  it('an objection reads as the person’s: you, not “the person”, and the agent’s orders left out', () => {
    assert.strictEqual(plainReason('The person said to wait. It waits for the person’s word.'), 'you said to wait')
    assert.strictEqual(
      heldNote([merge], '#12 went back to a draft after the person asked.').title,
      'Errand on hold: merge the 0.9.0 pull request — #12 went back to a draft after you asked. Say go ahead to continue.',
    )
    // Only orders and tool names: no reason to give, so none is made up.
    assert.strictEqual(
      heldNote([merge], 'Taken out of the line with leave_queue: resume_errand puts it back.').title,
      'Errand on hold: merge the 0.9.0 pull request. Say go ahead to continue.',
    )
    assert.strictEqual(heldNote([], null).title, 'Errand on hold. Say go ahead to continue.')
  })

  it('called off by the person names what it was; called off by the world says why', () => {
    assert.strictEqual(
      calledOffNote([merge, tag], 'The person called it off.', true).title,
      'Errand called off: merge the 0.9.0 pull request, then tag v0.9.0',
    )
    assert.strictEqual(
      calledOffNote([merge], '#12 was closed on GitHub, so it isn’t merged.', false).title,
      'Errand called off: merge the 0.9.0 pull request — #12 was closed on GitHub, so it isn’t merged',
    )
  })

  it('resumed says what goes on, not the person’s own words again', () => {
    assert.strictEqual(resumedNote([merge, tag]).title, 'Errand resumed: merge the 0.9.0 pull request once it’s merged, then tag v0.9.0')
    assert.strictEqual(resumedNote([]).title, 'Errand resumed')
  })

  it('a failed step says what it tried in the step’s words, and folds what was meant for the agent', () => {
    const note = failedNote('merge_pull_request', PR, {}, 'The head moved. Read it again before asking for this action.', false, merge)
    assert.strictEqual(note.title, 'Couldn’t do this: merge the 0.9.0 pull request — failed: The head moved.')
    assert.strictEqual(note.details, 'The head moved. Read it again before asking for this action.')
  })

  it('long step words are cut before the reason is, and the whole line folds under Details', () => {
    const long = (says: string) => ({
      tool: 'x',
      target: 'y',
      says: `${says} ${'with a great many words about what it does '.repeat(4)}`,
      waits: [],
    })
    const steps = [long('First'), long('Second'), long('Third')]
    const held = heldNote(steps, '#958 went back to a draft after the person asked.')
    assert.isAtMost(held.title.length, 240)
    assert.include(held.title, '#958 went back to a draft after you asked')
    assert.match(held.title, /Say go ahead to continue\.$/)
    assert.include(held.details, 'then second with')
    assert.include(held.details, 'after you asked')
    const off = calledOffNote(steps, '#958 was closed on GitHub, so it isn’t merged.', false)
    assert.isAtMost(off.title.length, 240)
    assert.include(off.title, '#958 was closed on GitHub')
    assert.isDefined(off.details)
    // A reason too long for a line is cut itself, never the whole of it.
    const wordy = heldNote([merge], `${'Someone keeps writing to it and moving it on, '.repeat(8)}so it waits.`)
    assert.isAtMost(wordy.title.length, 240)
    assert.include(wordy.title, 'Someone keeps writing')
    assert.isDefined(wordy.details)
    assert.isUndefined(heldNote([merge], 'You asked to wait.').details)
  })

  it('the fallback for an objection with no reason still says there was one', () => {
    for (const fallback of ['A new objection needs the person’s word again.', 'An objection needs the person’s word again.'])
      assert.strictEqual(
        heldNote([merge], fallback).title,
        'Errand on hold: merge the 0.9.0 pull request — there was a new objection. Say go ahead to continue.',
      )
  })

  it('an unwatched wait explains the hold only where it caused it', () => {
    const waiting = { ...merge, waits: [{ kind: 'merged' }] }
    // Held for an objection, with an unwatched wait still on the errand: the objection is the reason.
    assert.strictEqual(
      heldNote([waiting], '#958 went back to a draft after the person asked.').title,
      'Errand on hold: merge the 0.9.0 pull request — #958 went back to a draft after you asked. Say go ahead to continue.',
    )
    assert.match(stillNote(true, '#958 went back to a draft after the person asked.', [waiting]).title, /went back to a draft/)
  })
})

describe('what a merge errand still has to merge', () => {
  const merge = (target: string, says?: string) => ({
    tool: 'merge_pull_request',
    target,
    says,
    waits: [{ kind: 'checks' }],
  })

  it('names each by its pull request, or its task while it has none, with what it waits for, leaving out what is done', () => {
    assert.deepStrictEqual(
      mergesLeft([
        { step: merge(PR), done: true, task: null },
        { step: merge('https://github.com/AltharIDE/althar/pull/699'), done: false, task: { id: 'task_plan', title: 'Plan card' } },
        {
          step: merge('task:keep-for-later', 'Merge Keep for later’s pull request'),
          done: false,
          task: { id: 'task_keep', title: 'Keep for later' },
        },
        { step: merge('task:workers', 'Merge the workers readiness pull request'), done: false, task: null },
      ]),
      [
        { label: '#699', url: 'https://github.com/AltharIDE/althar/pull/699', task: 'task_plan', once: 'once its checks pass' },
        { label: 'Keep for later', url: null, task: 'task_keep', once: 'once its checks pass' },
        { label: 'workers readiness pull request', url: null, task: null, once: 'once its checks pass' },
      ],
    )
  })

  it('is nothing for an errand that does anything else, whose lines stand as they are', () => {
    assert.isNull(mergesLeft([{ step: { tool: 'push_tag', target: 'v0.9.0', waits: [] }, done: false, task: null }]))
    assert.isNull(mergesLeft([]))
  })
})

describe('the line of a held errand that closed by itself', () => {
  const pull = { label: '#957', url: PR.replace('698', '957') }
  it('says what was done already, each linked, where nothing is left', () => {
    const note = settledNote([
      { said: '#957 merged already', links: [pull] },
      { said: 'v0.9.0 is tagged already', links: [] },
    ])
    assert.strictEqual(note.title, 'Errand done: #957 merged already; v0.9.0 is tagged already')
    assert.deepStrictEqual(note.links, [pull])
  })
  it('says what came that Althar couldn’t watch for, and what to ask for again', () => {
    const note = settledNote([], {
      steps: [
        { tool: 'push_tag', target: 'AltharIDE/althar tag v0.9.0', request: { tag: 'v0.9.0' }, waits: [{ kind: 'merged' }] },
        { tool: 'publish_release', target: 'AltharIDE/althar release v0.9.0', request: { tag: 'v0.9.0' }, waits: [{ kind: 'draft' }] },
      ],
      happened: { said: '#957 merged', links: [pull] },
    })
    assert.strictEqual(
      note.title,
      'Errand closed: #957 merged, which Althar couldn’t watch for. Ask again to tag v0.9.0, then publish the v0.9.0 release.',
    )
    assert.deepStrictEqual(note.links, [pull])
  })
  it('says a merge done already once, not again as what the next step waited for', () => {
    const note = settledNote([{ said: '#957 merged already', links: [pull] }], {
      steps: [{ tool: 'push_tag', target: 'AltharIDE/althar tag v0.9.0', request: { tag: 'v0.9.0' }, waits: [{ kind: 'merged' }] }],
      happened: { said: '#957 merged', links: [pull] },
    })
    assert.strictEqual(note.title, 'Errand closed: #957 merged already, which Althar couldn’t watch for. Ask again to tag v0.9.0.')
  })
})
