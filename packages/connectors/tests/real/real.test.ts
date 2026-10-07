import { describe } from '@effect/vitest'
import { Effect } from 'effect'

import type { Credential } from '../../src/credential'
import { makeGitHub } from '../../src/github'
import { makeGitLab } from '../../src/gitlab'
import { makeJiraCloud, makeJiraDataCenter } from '../../src/jira'
import { makeLinear } from '../../src/linear'
import { products } from '../../src/products'
import { makeTrello } from '../../src/trello'
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
 * - GitLab: ALTHAR_GITLAB_TOKEN (a personal access token with `api`),
 *   ALTHAR_GITLAB_REPO (group/project, a scratch project),
 *   ALTHAR_GITLAB_ISSUE (group/project#12), and ALTHAR_GITLAB_URL for a
 *   self-managed instance (gitlab.com otherwise). It makes a branch with one
 *   file, opens a draft merge request, comments on it, then closes it and
 *   deletes the branch.
 * - Linear: ALTHAR_LINEAR_KEY (a personal API key), ALTHAR_LINEAR_ISSUE
 *   (MER-231, an issue it may comment on and link to).
 * - Jira Cloud: ALTHAR_JIRA_URL (the site, https://meridian.atlassian.net),
 *   ALTHAR_JIRA_EMAIL and ALTHAR_JIRA_TOKEN (the account's email and an API
 *   token, with or without scopes), ALTHAR_JIRA_ISSUE (PROJ-123, an issue it
 *   may comment on and link to).
 * - Jira Data Center: ALTHAR_JIRA_DC_URL (the instance), ALTHAR_JIRA_DC_TOKEN
 *   (a personal access token), ALTHAR_JIRA_DC_ISSUE.
 * - Trello: ALTHAR_TRELLO_KEY (a Power-Up's API key), ALTHAR_TRELLO_TOKEN
 *   (a token made for it, with read and write), ALTHAR_TRELLO_CARD (a card's
 *   short link, one it may comment on and attach a link to).
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

const gitlab = env('ALTHAR_GITLAB_TOKEN')
const gitlabRepo = env('ALTHAR_GITLAB_REPO')
describe.skipIf(gitlab === '' || gitlabRepo === '')('GitLab', () => {
  const webUrl = (env('ALTHAR_GITLAB_URL') || 'https://gitlab.com').replace(/\/+$/, '')
  const credential = Effect.succeed<Credential>({ kind: 'bearer', token: gitlab })
  const host = makeGitLab({ fetch, apiUrl: `${webUrl}/api/v4`, webUrl, credential })
  const api = (method: string, path: string, body?: unknown) =>
    Effect.promise(() =>
      fetch(`${webUrl}/api/v4/projects/${encodeURIComponent(gitlabRepo)}${path}`, {
        method,
        headers: { authorization: `Bearer ${gitlab}`, 'content-type': 'application/json', 'user-agent': 'Althar' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }).then((response) => response.text()),
    )
  hostContract({
    name: 'GitLab',
    host,
    path: gitlabRepo.split('/'),
    branch: Effect.gen(function* () {
      const branch = `althar/contract-${Date.now()}`
      const repository = yield* host.repository(gitlabRepo.split('/'))
      yield* api('POST', '/repository/branches', { branch, ref: repository.defaultBranch })
      yield* api('POST', `/repository/files/${encodeURIComponent(`${branch.replace('/', '-')}.md`)}`, {
        branch,
        content: 'Opened by the Althar connectors contract.\n',
        commit_message: 'Althar contract',
      })
      return branch
    }),
    cleanup: (change) =>
      Effect.gen(function* () {
        yield* api('PUT', `/merge_requests/${change.number}`, { state_event: 'close' })
        yield* api('DELETE', `/repository/branches/${encodeURIComponent(change.source)}`)
      }),
  })
  const issue = env('ALTHAR_GITLAB_ISSUE')
  if (issue !== '') trackerContract({ name: 'GitLab', tracker: host, ref: issue })
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

const jiraUrl = env('ALTHAR_JIRA_URL')
const jiraIssue = env('ALTHAR_JIRA_ISSUE')
describe.skipIf(jiraUrl === '' || env('ALTHAR_JIRA_TOKEN') === '' || jiraIssue === '')('Jira Cloud', () => {
  trackerContract({
    name: 'Jira Cloud',
    tracker: makeJiraCloud({
      fetch,
      apiUrl: products.jira_cloud.apiFor(jiraUrl),
      webUrl: jiraUrl,
      credential: Effect.succeed({ kind: 'basic', user: env('ALTHAR_JIRA_EMAIL'), token: env('ALTHAR_JIRA_TOKEN') }),
    }),
    ref: jiraIssue,
  })
})

const jiraDcUrl = env('ALTHAR_JIRA_DC_URL')
const jiraDcIssue = env('ALTHAR_JIRA_DC_ISSUE')
describe.skipIf(jiraDcUrl === '' || env('ALTHAR_JIRA_DC_TOKEN') === '' || jiraDcIssue === '')('Jira Data Center', () => {
  trackerContract({
    name: 'Jira Data Center',
    tracker: makeJiraDataCenter({
      fetch,
      apiUrl: products.jira_dc.apiFor(jiraDcUrl),
      webUrl: jiraDcUrl,
      credential: Effect.succeed({ kind: 'bearer', token: env('ALTHAR_JIRA_DC_TOKEN') }),
    }),
    ref: jiraDcIssue,
  })
})

const trelloKey = env('ALTHAR_TRELLO_KEY')
const trelloToken = env('ALTHAR_TRELLO_TOKEN')
const trelloCard = env('ALTHAR_TRELLO_CARD')
describe.skipIf(trelloKey === '' || trelloToken === '' || trelloCard === '')('Trello', () => {
  trackerContract({
    name: 'Trello',
    tracker: makeTrello({
      fetch,
      apiUrl: 'https://api.trello.com/1',
      webUrl: 'https://trello.com',
      credential: Effect.succeed({ kind: 'app', key: trelloKey, token: trelloToken }),
    }),
    ref: trelloCard,
  })
})
