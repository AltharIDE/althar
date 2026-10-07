import { describe } from '@effect/vitest'
import { Effect } from 'effect'

import { makeBitbucketCloud } from '../../src/bitbucketCloud'
import { makeBitbucketDataCenter } from '../../src/bitbucketDataCenter'
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
 * - Bitbucket Cloud: ALTHAR_BITBUCKET_EMAIL (the Atlassian account's),
 *   ALTHAR_BITBUCKET_TOKEN (an API token with the scopes read:user,
 *   read:workspace, read:repository, write:repository, read:pullrequest,
 *   write:pullrequest and read:pipeline, all `:bitbucket`),
 *   ALTHAR_BITBUCKET_REPO (workspace/repo, a scratch repository). It commits
 *   one file to a new branch, opens a draft pull request, comments on it,
 *   then declines it and deletes the branch.
 * - Bitbucket Data Center: ALTHAR_BITBUCKET_DC_URL (the server's address),
 *   ALTHAR_BITBUCKET_DC_TOKEN (an HTTP access token with repository write),
 *   ALTHAR_BITBUCKET_DC_REPO (PROJECT/repo, a scratch repository). The same,
 *   on a server of 8.18 or later, which has drafts.
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

const bitbucket = env('ALTHAR_BITBUCKET_TOKEN')
const bitbucketEmail = env('ALTHAR_BITBUCKET_EMAIL')
const bitbucketRepo = env('ALTHAR_BITBUCKET_REPO')
describe.skipIf(bitbucket === '' || bitbucketEmail === '' || bitbucketRepo === '')('Bitbucket Cloud', () => {
  const credential = Effect.succeed<Credential>({ kind: 'basic', user: bitbucketEmail, token: bitbucket })
  const host = makeBitbucketCloud({ fetch, apiUrl: 'https://api.bitbucket.org/2.0', webUrl: 'https://bitbucket.org', credential })
  const api = (method: string, path: string, body?: URLSearchParams) =>
    Effect.promise(() =>
      fetch(`https://api.bitbucket.org/2.0/repositories/${bitbucketRepo}${path}`, {
        method,
        headers: { authorization: `Basic ${Buffer.from(`${bitbucketEmail}:${bitbucket}`).toString('base64')}`, 'user-agent': 'Althar' },
        ...(body === undefined ? {} : { body }),
      }).then((response) => response.text()),
    )
  hostContract({
    name: 'Bitbucket Cloud',
    host,
    path: bitbucketRepo.split('/'),
    // A commit to a branch that doesn't exist yet makes it, from the main branch.
    branch: Effect.gen(function* () {
      const branch = `althar/contract-${Date.now()}`
      yield* api(
        'POST',
        '/src',
        new URLSearchParams({
          [`/${branch.replace('/', '-')}.md`]: 'Opened by the Althar connectors contract.\n',
          message: 'Althar contract',
          branch,
        }),
      )
      return branch
    }),
    cleanup: (change) =>
      Effect.gen(function* () {
        yield* api('POST', `/pullrequests/${change.number}/decline`)
        yield* api('DELETE', `/refs/branches/${change.source}`)
      }),
  })
})

const bitbucketDc = env('ALTHAR_BITBUCKET_DC_TOKEN')
const bitbucketDcRepo = env('ALTHAR_BITBUCKET_DC_REPO')
const bitbucketDcUrl = env('ALTHAR_BITBUCKET_DC_URL').replace(/\/+$/, '')
describe.skipIf(bitbucketDc === '' || bitbucketDcRepo === '' || bitbucketDcUrl === '')('Bitbucket Data Center', () => {
  const credential = Effect.succeed<Credential>({ kind: 'bearer', token: bitbucketDc })
  const host = makeBitbucketDataCenter({ fetch, apiUrl: `${bitbucketDcUrl}/rest/api/latest`, webUrl: bitbucketDcUrl, credential })
  const [project = '', slug = ''] = bitbucketDcRepo.split('/')
  const api = (method: string, path: string, body?: FormData | Record<string, unknown>) =>
    Effect.promise(() =>
      fetch(
        `${bitbucketDcUrl}/rest/${path.startsWith('/branch-utils') ? path.slice(1) : `api/latest/projects/${project}/repos/${slug}${path}`}`,
        {
          method,
          headers: {
            authorization: `Bearer ${bitbucketDc}`,
            'user-agent': 'Althar',
            // Data Center refuses a form from anything it takes for a browser, unless told not to check.
            'x-atlassian-token': 'no-check',
            ...(body === undefined || body instanceof FormData ? {} : { 'content-type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
        },
      ).then((response) => response.text()),
    )
  hostContract({
    name: 'Bitbucket Data Center',
    host,
    path: [project, slug],
    // Editing a file onto a new branch makes the branch, from the default one.
    branch: Effect.gen(function* () {
      const branch = `althar/contract-${Date.now()}`
      const repository = yield* host.repository([project, slug])
      const form = new FormData()
      form.set('branch', branch)
      form.set('sourceBranch', repository.defaultBranch)
      form.set('content', 'Opened by the Althar connectors contract.\n')
      form.set('message', 'Althar contract')
      yield* api('PUT', `/browse/${branch.replace('/', '-')}.md`, form)
      return branch
    }),
    cleanup: (change) =>
      Effect.gen(function* () {
        const now = JSON.parse(yield* api('GET', `/pull-requests/${change.number}`)) as { version: number }
        yield* api('POST', `/pull-requests/${change.number}/decline?version=${now.version}`, {})
        yield* api('DELETE', `/branch-utils/latest/projects/${project}/repos/${slug}/branches`, { name: `refs/heads/${change.source}` })
      }),
  })
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
