import { assert, describe, it } from '@effect/vitest'
import { Cause, Duration } from 'effect'

import { CliSignedOut } from '../src/Connections'
import { CoordinatorUnavailable } from '../src/Coordinator'
import { AlreadyDelivered, ChangedSinceSeen, ImageRefused, RuleOnAnotherList, RulesChanged } from '../src/errors'
import { ReviewDraftClosed, ReviewDraftIncomplete } from '../src/Reviews'
import { StartTimedOut } from '../src/Sessions'
import { agentSaid, expected, summarize, words } from '../src/words'
import { thisDevice } from '../src/device'

/*
 * What the window says when something the person asked for couldn't be done:
 * the errors the API's other tests don't reach, each in the sentence the
 * person reads, and which of them are theirs to put right.
 */

const name = (agentId: string) => (agentId === 'codex' ? 'Codex' : agentId)
const said = (error: unknown) => words(error, name).message

describe('the words for what went wrong', () => {
  it('says an agent that took too long to start as the runtime timed it', () => {
    const slow = new StartTimedOut({ agentId: 'codex', agentName: 'Codex', after: Duration.minutes(2) })
    assert.strictEqual(agentSaid(slow), 'Timed out after 2m waiting for Codex to set up a session.')
    // Through a failed start, and for the window: the same sentence.
    assert.strictEqual(summarize(Cause.fail(slow)), 'Timed out after 2m waiting for Codex to set up a session.')
    assert.strictEqual(said(slow), 'Timed out after 2m waiting for Codex to set up a session.')
  })

  it('says what went wrong in its first line, where no agent said it', () => {
    assert.strictEqual(summarize(Cause.fail(new Error('Disk full'))), 'Disk full.')
    assert.strictEqual(summarize(Cause.die('The store went away!')), 'The store went away!')
  })

  it('asks which repositories a task changes, where the project lists none', () => {
    assert.strictEqual(said({ _tag: 'RepositoriesNeeded' }), "Say which of the project's repositories the task changes: .")
    assert.strictEqual(said({ _tag: 'RepositoriesNeeded', unknown: ['mobile'] }), 'The project has no repository called mobile. It has .')
  })

  it('names an image refused without a name as an image', () => {
    assert.strictEqual(said(new ImageRefused({ reason: 'unsupported', name: null })), "An image isn't a PNG, JPEG, GIF or WebP image.")
    assert.strictEqual(said(new ImageRefused({ reason: 'missing', name: 'shot.png' })), "shot.png isn't kept any more. Add it again.")
    assert.strictEqual(said(new ImageRefused({ reason: 'too_many', name: null })), 'A message can carry at most 10 images.')
    assert.strictEqual(said(new ImageRefused({ reason: 'unkept', name: 'shot.png' })), 'Images can’t be sent here.')
  })

  it('says why the coordinator can’t start, and what to do', () => {
    assert.strictEqual(
      said(new CoordinatorUnavailable({ agentId: 'codex', agentName: 'Codex' })),
      "Codex isn't signed in. Sign it in, or pick another agent for the coordinator.",
    )
  })

  it('says an allow rule on another list as one command or as commands starting so, and which list', () => {
    assert.strictEqual(
      said(new RuleOnAnotherList({ pattern: 'git push', exact: false, list: 'never' })),
      'Commands starting “git push” are on “Never”. Take them off “Never” first.',
    )
    assert.strictEqual(
      said(new RuleOnAnotherList({ pattern: 'rm -rf dist', exact: true, list: 'never' })),
      '“rm -rf dist” is on “Never”. Take it off “Never” first.',
    )
    assert.strictEqual(
      said(new RulesChanged({ projectId: 'p', revision: 3, expected: 2 })),
      "The project's rules changed meanwhile. Make the change again.",
    )
  })

  it('says a message already with the agent can’t be taken back', () => {
    assert.strictEqual(said(new AlreadyDelivered({ itemId: 'i' })), 'The agent already has that message.')
  })

  it('says a git command it can’t name as git, with what git said', () => {
    assert.strictEqual(
      said({ _tag: 'GitFailed', stderr: 'fatal: not a git repository\n' }),
      "git  didn't work: fatal: not a git repository.",
    )
  })

  it('says a branch that moved since the person looked, so nothing was pushed', () => {
    assert.strictEqual(
      said(new ChangedSinceSeen({ taskId: 't', what: 'branch' })),
      'The branch changed since you looked. Look again, then push.',
    )
  })

  it('says why a review draft can’t change or be posted', () => {
    assert.deepStrictEqual(
      ['posted', 'discarded', 'posting', 'archived'].map((state) => said(new ReviewDraftClosed({ draftId: 'd', state }))),
      [
        'That review is posted already. Change it on GitHub.',
        'That review draft was discarded.',
        'That review is being posted now.',
        'That review draft can’t change now.',
      ],
    )
    assert.deepStrictEqual(
      (['verdict', 'summary', 'comment'] as const).map((missing) => said(new ReviewDraftIncomplete({ draftId: 'd', missing }))),
      ['Choose a verdict before you post the review.', 'A review needs a summary.', 'Write the comment, or drop it.'],
    )
  })

  it('says a command-line tool that isn’t signed in to the host', () => {
    assert.strictEqual(said(new CliSignedOut({ tool: 'gh', host: 'github.com' })), `gh isn't signed in to github.com on ${thisDevice()}.`)
  })

  it('counts the person’s mistakes as theirs to put right, and the runtime’s own as worth the log', () => {
    for (const reason of ['RuleOnAnotherList', 'RulesChanged', 'AlreadyDelivered', 'ReviewDraftClosed', 'CliSignedOut'])
      assert.isTrue(expected.has(reason), reason)
    for (const reason of ['GitFailed', 'StartTimedOut', 'CoordinatorUnavailable', 'Unknown']) assert.isFalse(expected.has(reason), reason)
  })
})
