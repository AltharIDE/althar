import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { makeBitbucketCloud } from '../src/bitbucketCloud'
import { makeBitbucketDataCenter } from '../src/bitbucketDataCenter'
import { makeGitHub } from '../src/github'
import { makeGitLab } from '../src/gitlab'
import type { Repository } from '../src/model'
import { type Route, stubFetch } from './stub'

/*
 * Releases on each host's own API (ADR-081, "A release"): what each adapter
 * asks, and what it makes of the answers. The answers follow the examples of
 * each host's REST reference, trimmed: GitHub's refs, releases and workflow
 * runs; GitLab's tags, releases, pipelines, jobs and deployments; Bitbucket
 * Cloud's refs, Downloads and pipelines; Data Center's tags and builds.
 */

const HEAD = '6dcb09b5b57875f334f61aebed695e2e4193db5e'
const OTHER = '7638417db6d59f3c431d3e1f261cc637155684cd'

const repository = (webUrl: string, path: ReadonlyArray<string> = ['octocat', 'hello']): Repository => ({
  id: '1296269',
  path,
  defaultBranch: 'main',
  webUrl,
  canPush: true,
  merges: ['merge'],
})

describe('GitHub’s releases', () => {
  const API = 'https://api.github.com/repos/octocat/hello'
  const repo = repository('https://github.com/octocat/hello')
  const github = (routes: ReadonlyArray<Route>) => {
    const { fetch, sent } = stubFetch(routes)
    return {
      host: makeGitHub({
        fetch,
        apiUrl: 'https://api.github.com',
        webUrl: 'https://github.com',
        credential: Effect.succeed({ kind: 'bearer', token: 'ghu_t' }),
      }),
      sent,
    }
  }

  it.effect('makes a tag as a ref, peels an annotated one, refuses one taken, and moves it only when asked', () =>
    Effect.gen(function* () {
      let at: string | null = null
      const { host, sent } = github([
        ['GET', `${API}/commits/main`, { json: { sha: HEAD } }],
        [
          'GET',
          `${API}/git/ref/tags/v0.7.0`,
          () => (at === null ? { status: 404, json: { message: 'Not Found' } } : { json: { object: { sha: at, type: 'commit' } } }),
        ],
        [
          'POST',
          `${API}/git/refs`,
          (request) => {
            at = (request.body as { sha: string }).sha
            return { status: 201, json: { ref: 'refs/tags/v0.7.0' } }
          },
        ],
        ['PATCH', `${API}/git/refs/tags/v0.7.0`, { json: {} }],
        ['GET', `${API}/git/ref/tags/v0.6.1`, { json: { object: { sha: 'aaa', type: 'tag' } } }],
        ['GET', `${API}/git/tags/aaa`, { json: { object: { sha: OTHER, type: 'commit' } } }],
      ])
      assert.strictEqual(host.releasing, 'draft')
      const head = yield* host.commitOf(repo, 'main')
      assert.isNull(yield* host.tag(repo, 'v0.7.0'))
      assert.deepStrictEqual(yield* host.pushTag(repo, { name: 'v0.7.0', commit: head }), {
        name: 'v0.7.0',
        commit: HEAD,
        url: 'https://github.com/octocat/hello/releases/tag/v0.7.0',
      })
      assert.deepStrictEqual(sent.find((one) => one.method === 'POST')?.body, { ref: 'refs/tags/v0.7.0', sha: HEAD })
      // There already, on the same commit: nothing is sent.
      yield* host.pushTag(repo, { name: 'v0.7.0', commit: HEAD })
      assert.lengthOf(
        sent.filter((one) => one.method === 'POST'),
        1,
      )
      const taken = yield* Effect.flip(host.pushTag(repo, { name: 'v0.7.0', commit: OTHER }))
      assert.match(taken.message, /^v0\.7\.0 is on 6dcb09b5 already\. Moving a tag must be asked for/)
      assert.isUndefined(sent.find((one) => one.method === 'PATCH'))
      yield* host.pushTag(repo, { name: 'v0.7.0', commit: OTHER, move: true })
      assert.deepStrictEqual(sent.find((one) => one.method === 'PATCH')?.body, { sha: OTHER, force: true })
      // An annotated tag is a tag object, peeled to its commit.
      assert.strictEqual((yield* host.tag(repo, 'v0.6.1'))?.commit, OTHER)
    }),
  )

  it.effect('finds a draft only in the list, publishes it by turning its draft off, and leaves one out already', () =>
    Effect.gen(function* () {
      let draft = true
      const release = () => ({
        id: 1,
        tag_name: 'v0.7.0',
        name: 'Althar 0.7.0',
        draft,
        html_url: 'https://github.com/octocat/hello/releases/tag/v0.7.0',
        assets: [{ name: 'Althar-0.7.0-arm64.dmg', size: 1024, browser_download_url: 'https://github.com/a.dmg' }],
      })
      const { host, sent } = github([
        ['GET', `${API}/releases?per_page=100`, () => ({ json: [{ ...release(), id: 2, tag_name: 'v0.6.1', draft: false }, release()] })],
        [
          'PATCH',
          `${API}/releases/1`,
          () => {
            draft = false
            return { json: release() }
          },
        ],
      ])
      assert.deepInclude(yield* host.release(repo, 'v0.7.0'), { state: 'draft', name: 'Althar 0.7.0' })
      const out = yield* host.publishRelease(repo, 'v0.7.0', {})
      assert.deepInclude(out, { state: 'published', id: '1' })
      assert.deepStrictEqual(out.files, [{ name: 'Althar-0.7.0-arm64.dmg', size: 1024, url: 'https://github.com/a.dmg' }])
      assert.deepStrictEqual(sent.find((one) => one.method === 'PATCH')?.body, { draft: false })
      yield* host.publishRelease(repo, 'v0.7.0', {})
      assert.lengthOf(
        sent.filter((one) => one.method === 'PATCH'),
        1,
      )
      assert.strictEqual((yield* Effect.flip(host.publishRelease(repo, 'v0.8.0', {}))).reason, 'not_found')
    }),
  )

  it.effect('reads a tag’s runs with the environments they wait on, approves one, refuses with its button, and reruns failed jobs', () =>
    Effect.gen(function* () {
      const run = {
        id: 30433642,
        name: 'release',
        head_branch: 'v0.7.0',
        head_sha: HEAD,
        status: 'waiting',
        conclusion: null,
        html_url: 'https://github.com/octocat/hello/actions/runs/30433642',
      }
      const { host, sent } = github([
        [
          'GET',
          `${API}/actions/runs?branch=v0.7.0&per_page=20`,
          {
            json: {
              workflow_runs: [run, { ...run, id: 1, head_branch: 'main' }, { ...run, id: 2, status: 'completed', conclusion: 'failure' }],
            },
          },
        ],
        [
          'GET',
          `${API}/actions/runs/30433642/pending_deployments`,
          {
            json: [
              { environment: { id: 161088068, name: 'release' }, current_user_can_approve: true },
              { environment: { id: 161088069, name: 'production' }, current_user_can_approve: false },
            ],
          },
        ],
        ['POST', `${API}/actions/runs/30433642/pending_deployments`, { json: [] }],
        ['GET', `${API}/actions/runs/30433642`, { json: { ...run, status: 'in_progress' } }],
        ['POST', `${API}/actions/runs/2/rerun-failed-jobs`, { status: 201, json: {} }],
      ])
      const runs = yield* host.runs(repo, 'v0.7.0')
      assert.deepStrictEqual(
        runs.map((one) => [one.id, one.state]),
        [
          ['30433642', 'queued'],
          ['2', 'failed'],
        ],
      )
      const [waiting, failed] = runs
      assert.deepStrictEqual(
        waiting?.gates.map((gate) => [gate.id, gate.name, gate.kind, gate.approvable]),
        [
          ['161088068', 'release', 'environment', true],
          ['161088069', 'production', 'environment', false],
        ],
      )
      const refused = yield* Effect.flip(host.approveRun(repo, waiting!, waiting!.gates[1]!))
      assert.strictEqual(refused.reason, 'forbidden')
      assert.include(refused.message, 'https://github.com/octocat/hello/actions/runs/30433642')
      const after = yield* host.approveRun(repo, waiting!, waiting!.gates[0]!)
      assert.strictEqual(after.state, 'running')
      assert.deepInclude(sent.find((one) => one.method === 'POST')?.body as object, { environment_ids: [161088068], state: 'approved' })
      assert.isTrue(yield* host.rerunFailed(repo, failed!))
    }),
  )
})

describe('GitLab’s releases', () => {
  const API = 'https://gitlab.com/api/v4/projects/1296269'
  const repo = repository('https://gitlab.com/octocat/hello')
  const gitlab = (routes: ReadonlyArray<Route>) => {
    const { fetch, sent } = stubFetch(routes)
    return {
      host: makeGitLab({
        fetch,
        apiUrl: 'https://gitlab.com/api/v4',
        webUrl: 'https://gitlab.com',
        credential: Effect.succeed({ kind: 'bearer', token: 'glpat-t' }),
      }),
      sent,
    }
  }

  it.effect('moves a tag by deleting and making it again, and makes the release, which is publishing it', () =>
    Effect.gen(function* () {
      let at: string | null = HEAD
      let released = false
      const { host, sent } = gitlab([
        [
          'GET',
          `${API}/repository/tags/v0.7.0`,
          () => (at === null ? { status: 404, json: { message: '404 Tag Not Found' } } : { json: { name: 'v0.7.0', commit: { id: at } } }),
        ],
        [
          'DELETE',
          `${API}/repository/tags/v0.7.0`,
          () => {
            at = null
            return { status: 204 }
          },
        ],
        [
          'POST',
          `${API}/repository/tags`,
          (request) => {
            at = (request.body as { ref: string }).ref
            return { status: 201, json: { name: 'v0.7.0', commit: { id: at } } }
          },
        ],
        [
          'GET',
          `${API}/releases/v0.7.0`,
          () => (released ? { json: { tag_name: 'v0.7.0', name: 'Althar 0.7.0' } } : { status: 404, json: { message: '404 Not Found' } }),
        ],
        [
          'POST',
          `${API}/releases`,
          () => {
            released = true
            return { status: 201, json: { tag_name: 'v0.7.0', name: 'Althar 0.7.0', _links: { self: 'https://gitlab.com/r' } } }
          },
        ],
      ])
      assert.strictEqual(host.releasing, 'made')
      assert.include((yield* Effect.flip(host.pushTag(repo, { name: 'v0.7.0', commit: OTHER }))).message, 'Moving a tag must be asked for')
      const moved = yield* host.pushTag(repo, { name: 'v0.7.0', commit: OTHER, move: true })
      assert.strictEqual(moved.commit, OTHER)
      assert.deepStrictEqual(
        sent.filter((one) => one.method !== 'GET').map((one) => one.method),
        ['DELETE', 'POST'],
      )
      assert.isNull(yield* host.release(repo, 'v0.7.0'))
      const made = yield* host.publishRelease(repo, 'v0.7.0', { name: 'Althar 0.7.0', notes: 'New: releases.' })
      assert.deepInclude(made, { state: 'published', url: 'https://gitlab.com/r' })
      assert.deepStrictEqual(sent.at(-1)?.body, { tag_name: 'v0.7.0', name: 'Althar 0.7.0', description: 'New: releases.' })
      yield* host.publishRelease(repo, 'v0.7.0', {})
      assert.lengthOf(
        sent.filter((one) => one.url === `${API}/releases` && one.method === 'POST'),
        1,
      )
    }),
  )

  it.effect('waits on a blocked deployment and a manual job; approves the one, plays the other, and says when GitLab refuses', () =>
    Effect.gen(function* () {
      let refuse = true
      const { host, sent } = gitlab([
        [
          'GET',
          `${API}/pipelines?ref=v0.7.0&order_by=id&sort=desc&per_page=20`,
          { json: [{ id: 47, ref: 'v0.7.0', sha: HEAD, status: 'manual', web_url: 'https://gitlab.com/p/47' }] },
        ],
        [
          'GET',
          `${API}/pipelines/47/jobs?scope[]=manual`,
          {
            json: [
              { id: 7, name: 'deploy', web_url: 'https://gitlab.com/j/7' },
              { id: 8, name: 'publish', web_url: 'https://gitlab.com/j/8' },
            ],
          },
        ],
        [
          'GET',
          `${API}/deployments?status=blocked&order_by=updated_at&sort=desc&per_page=50`,
          { json: [{ id: 41, environment: { name: 'production' }, deployable: { id: 7 } }] },
        ],
        [
          'POST',
          `${API}/deployments/41/approval`,
          () => (refuse ? { status: 403, json: { message: '403 Forbidden' } } : { json: { status: 'approved' } }),
        ],
        ['POST', `${API}/jobs/8/play`, { json: { id: 8 } }],
        ['GET', `${API}/pipelines/47`, { json: { id: 47, ref: 'v0.7.0', sha: HEAD, status: 'running' } }],
        ['GET', 'https://gitlab.com/api/v4/user', { json: { id: 1, username: 'you' } }],
        ['POST', `${API}/pipelines/47/retry`, { status: 201, json: { id: 47 } }],
      ])
      const [run] = yield* host.runs(repo, 'v0.7.0')
      assert.deepStrictEqual(
        run?.gates.map((gate) => [gate.id, gate.name, gate.kind]),
        [
          ['41', 'production', 'deployment'],
          ['8', 'publish', 'manual_job'],
        ],
      )
      const refused = yield* Effect.flip(host.approveRun(repo, run!, run!.gates[0]!))
      assert.strictEqual(refused.reason, 'forbidden')
      assert.include(refused.message, 'https://gitlab.com/j/7')
      refuse = false
      yield* host.approveRun(repo, run!, run!.gates[0]!)
      assert.deepInclude(sent.find((one) => one.url.endsWith('/approval') && one.body !== undefined)?.body as object, {
        status: 'approved',
      })
      yield* host.approveRun(repo, run!, run!.gates[1]!)
      assert.isTrue(sent.some((one) => one.url === `${API}/jobs/8/play`))
      assert.isTrue(yield* host.rerunFailed(repo, run!))
    }),
  )
})

describe('Bitbucket Cloud’s releases', () => {
  const API = 'https://api.bitbucket.org/2.0/repositories/meridian/desktop'
  const repo = repository('https://bitbucket.org/meridian/desktop', ['meridian', 'desktop'])
  const cloud = (routes: ReadonlyArray<Route>) => {
    const { fetch, sent } = stubFetch(routes)
    return {
      host: makeBitbucketCloud({
        fetch,
        apiUrl: 'https://api.bitbucket.org/2.0',
        webUrl: 'https://bitbucket.org',
        credential: Effect.succeed({ kind: 'basic', user: 'you@meridian.dev', token: 'ATATT3x' }),
      }),
      sent,
    }
  }

  it.effect('puts the files in Downloads once each, and links the manual step that only the person runs', () =>
    Effect.gen(function* () {
      const there = [{ name: 'Althar-0.7.0.zip', size: 3, links: { self: { href: 'https://bitbucket.org/d/zip' } } }]
      const { host, sent } = cloud([
        [
          'GET',
          `${API}/refs/tags/v0.7.0`,
          { json: { name: 'v0.7.0', target: { hash: HEAD }, links: { html: { href: 'https://bitbucket.org/t' } } } },
        ],
        ['GET', `${API}/downloads?pagelen=100`, () => ({ json: { values: there } })],
        [
          'POST',
          `${API}/downloads`,
          () => {
            there.push({ name: 'Althar-0.7.0.dmg', size: 3, links: { self: { href: 'https://bitbucket.org/d/dmg' } } })
            return { status: 201 }
          },
        ],
        [
          'GET',
          `${API}/pipelines?target.ref_name=v0.7.0&sort=-created_on&pagelen=20`,
          {
            json: {
              values: [
                {
                  uuid: '{p}',
                  build_number: 12,
                  state: { name: 'PAUSED' },
                  target: { ref_name: 'v0.7.0', ref_type: 'tag', commit: { hash: HEAD } },
                },
              ],
            },
          },
        ],
        [
          'GET',
          `${API}/pipelines/12/steps?pagelen=100`,
          {
            json: {
              values: [
                { uuid: '{a}', name: 'build', state: { name: 'COMPLETED' } },
                { uuid: '{b}', name: 'Publish', state: { name: 'PENDING' }, trigger: { type: 'pipeline_step_trigger_manual' } },
              ],
            },
          },
        ],
        ['GET', `${API}/pipelines/12`, { json: { uuid: '{p}', build_number: 12, target: { ref_name: 'v0.7.0', type: 'x' } } }],
        ['POST', `${API}/pipelines`, { status: 201, json: {} }],
      ])
      assert.strictEqual(host.releasing, 'downloads')
      assert.deepInclude(yield* host.release(repo, 'v0.7.0'), { state: 'tagged', url: 'https://bitbucket.org/meridian/desktop/downloads/' })
      const file = (name: string) => ({ name, bytes: new Uint8Array([1, 2, 3]), mediaType: 'application/octet-stream' })
      const out = yield* host.publishRelease(repo, 'v0.7.0', { files: [file('Althar-0.7.0.zip'), file('Althar-0.7.0.dmg')] })
      assert.deepStrictEqual(
        out.files.map((one) => one.name),
        ['Althar-0.7.0.zip', 'Althar-0.7.0.dmg'],
      )
      const uploads = sent.filter((one) => one.method === 'POST' && one.url === `${API}/downloads`)
      assert.lengthOf(uploads, 1, 'the zip was there already')
      assert.match(uploads[0]?.headers['content-type'] ?? '', /^multipart\/form-data; boundary=althar-/)
      assert.include(new TextDecoder().decode(uploads[0]?.bytes), 'name="files"; filename="Althar-0.7.0.dmg"')

      const [run] = yield* host.runs(repo, 'v0.7.0')
      assert.deepStrictEqual(run?.gates, [
        {
          id: '{b}',
          name: 'Publish',
          kind: 'manual_step',
          approvable: false,
          url: 'https://bitbucket.org/meridian/desktop/pipelines/results/12',
        },
      ])
      const refused = yield* Effect.flip(host.approveRun(repo, run!, run!.gates[0]!))
      assert.include(refused.message, 'no API to run the manual step Publish')
      assert.include(refused.message, 'https://bitbucket.org/meridian/desktop/pipelines/results/12')
      assert.isTrue(yield* host.rerunFailed(repo, run!))
      assert.deepStrictEqual(sent.at(-1)?.body, { target: { ref_name: 'v0.7.0', type: 'x' } })
    }),
  )
})

describe('Bitbucket Data Center’s releases', () => {
  const SERVER = 'https://bitbucket.example.com'
  const API = `${SERVER}/rest/api/latest/projects/MER/repos/desktop`
  const GIT = `${SERVER}/rest/git/latest/projects/MER/repos/desktop`
  const repo = repository(`${SERVER}/projects/MER/repos/desktop`, ['MER', 'desktop'])
  const center = (routes: ReadonlyArray<Route>) => {
    const { fetch, sent } = stubFetch(routes)
    return {
      host: makeBitbucketDataCenter({
        fetch,
        apiUrl: `${SERVER}/rest/api/latest`,
        webUrl: SERVER,
        credential: Effect.succeed({ kind: 'bearer', token: 'BBDC-t' }),
      }),
      sent,
    }
  }

  it.effect('makes the tag through its git API, which is the release, and says the builds are another service’s', () =>
    Effect.gen(function* () {
      let at: string | null = null
      const { host, sent } = center([
        [
          'GET',
          `${API}/tags/v0.7.0`,
          () =>
            at === null
              ? { status: 404, json: { errors: [{ message: 'Tag v0.7.0 does not exist' }] } }
              : { json: { id: 'refs/tags/v0.7.0', displayId: 'v0.7.0', latestCommit: at } },
        ],
        [
          'POST',
          `${GIT}/tags`,
          (request) => {
            at = (request.body as { startPoint: string }).startPoint
            return { json: { displayId: 'v0.7.0', latestCommit: at } }
          },
        ],
        ['GET', `${API}/commits/v0.7.0`, { json: { id: HEAD } }],
        [
          'GET',
          /build-status\/latest\/commits\//,
          { json: { values: [{ key: 'REL', name: 'Release', state: 'FAILED', url: 'https://ci.example/REL' }], isLastPage: true } },
        ],
      ])
      assert.strictEqual(host.releasing, 'tag')
      yield* host.pushTag(repo, { name: 'v0.7.0', commit: HEAD })
      assert.deepStrictEqual(sent.find((one) => one.method === 'POST')?.body, { name: 'v0.7.0', startPoint: HEAD, message: '' })
      assert.deepInclude(yield* host.release(repo, 'v0.7.0'), { state: 'tagged' })
      assert.include((yield* Effect.flip(host.publishRelease(repo, 'v0.7.0', {}))).message, 'the tag is the release')
      const [run] = yield* host.runs(repo, 'v0.7.0')
      assert.deepInclude(run, { id: 'REL', state: 'failed', sha: HEAD, gates: [] })
      const rerun = yield* Effect.flip(host.rerunFailed(repo, run!))
      assert.include(rerun.message, 'https://ci.example/REL')
      const approve = yield* Effect.flip(
        host.approveRun(repo, run!, { id: 'x', name: 'Release', kind: 'environment', approvable: true, url: null }),
      )
      assert.include(approve.message, 'only it can approve it')
    }),
  )
})
