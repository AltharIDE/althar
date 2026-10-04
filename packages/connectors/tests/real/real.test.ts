import { describe } from '@effect/vitest'
import { Effect } from 'effect'

import type { Credential } from '../../src/credential'
import { makeGitHub } from '../../src/github'
import { makeLinear } from '../../src/linear'
import { hostContract, trackerContract } from '../contract'

/*
 * The contracts against real accounts. Each service runs when its variables
 * are set, and is skipped otherwise:
 *
 * - GitHub: ALTHAR_GITHUB_TOKEN (a fine-grained token with contents,
 *   pull requests and issues on the repository), ALTHAR_GITHUB_REPO
 *   (owner/name, a scratch repository), ALTHAR_GITHUB_ISSUE (owner/name#12).
 *   It pushes a branch with one file, opens a draft pull request, comments on
 *   it, then closes it and deletes the branch.
 * - Linear: ALTHAR_LINEAR_KEY (a personal API key), ALTHAR_LINEAR_ISSUE
 *   (MER-231, an issue it may comment on and link to).
 */

const env = (name: string) => process.env[name] ?? ''

const github = env('ALTHAR_GITHUB_TOKEN')
const repo = env('ALTHAR_GITHUB_REPO')
describe.skipIf(github === '' || repo === '')('GitHub', () => {
  const credential = Effect.succeed<Credential>({ kind: 'bearer', token: github })
  const host = makeGitHub({ fetch, apiUrl: 'https://api.github.com', webUrl: 'https://github.com', credential })
  const api = (method: string, path: string, body?: unknown) =>
    Effect.promise(() =>
      fetch(`https://api.github.com/repos/${repo}${path}`, {
        method,
        headers: { authorization: `Bearer ${github}`, accept: 'application/vnd.github+json', 'user-agent': 'Althar' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }).then((response) => response.json() as Promise<Record<string, unknown>>),
    )
  hostContract({
    name: 'GitHub',
    host,
    path: repo.split('/'),
    branch: Effect.gen(function* () {
      const branch = `althar/contract-${Date.now()}`
      const repository = yield* host.repository(repo.split('/'))
      const base = (yield* api('GET', `/git/ref/heads/${repository.defaultBranch}`)) as { object: { sha: string } }
      yield* api('POST', '/git/refs', { ref: `refs/heads/${branch}`, sha: base.object.sha })
      yield* api('PUT', `/contents/${branch.replace('/', '-')}.md`, {
        message: 'Althar contract',
        content: Buffer.from('Opened by the Althar connectors contract.\n').toString('base64'),
        branch,
      })
      return branch
    }),
    cleanup: (change) =>
      Effect.gen(function* () {
        yield* api('PATCH', `/pulls/${change.number}`, { state: 'closed' })
        yield* api('DELETE', `/git/refs/heads/${change.source}`)
      }),
  })
  const issue = env('ALTHAR_GITHUB_ISSUE')
  if (issue !== '') trackerContract({ name: 'GitHub', tracker: host, ref: issue })
})

const linear = env('ALTHAR_LINEAR_KEY')
const linearIssue = env('ALTHAR_LINEAR_ISSUE')
describe.skipIf(linear === '' || linearIssue === '')('Linear', () => {
  trackerContract({
    name: 'Linear',
    tracker: makeLinear({
      fetch,
      apiUrl: 'https://api.linear.app',
      webUrl: 'https://linear.app',
      credential: Effect.succeed({ kind: 'key', token: linear }),
    }),
    ref: linearIssue,
  })
})
