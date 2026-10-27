import { execFileSync, spawn } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'

import { Fetches } from '../src/Fetches'
import { Launches } from '../src/Launches'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import type { ToolAccess } from '../src/ToolServer'
import { connect } from './conflictsSupport'
import { callTool, fakeConnectors, HOST, repository, runtime, until } from './support'

/*
 * Running a branch or a pull request (ADR-062) where the remote is on a
 * connected code host: Althar lists what the host has and fetches with the
 * connection's own sign-in, a header git sends, which the remote here
 * refuses to answer without, as a private repository's does. The origin the
 * repository names can't be reached at all: only the signed way gets there.
 */

const SIGNED = 'Authorization: Bearer fake-token'

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@althar.test', ...args], { cwd })
    .toString()
    .trim()

const serving = (port: number) =>
  `console.log('  VITE ready')\nconsole.log('  ➜  Local:   http://localhost:${port}/')\nsetInterval(() => {}, 1000)\n`

/**
 * Bare repositories under a folder, served over git's smart HTTP, as a host
 * serves them, to a request that carries the sign-in only. What came without
 * it is counted.
 */
const serve = (root: string) =>
  Effect.acquireRelease(
    Effect.promise(
      () =>
        new Promise<{ readonly server: Server; readonly url: string; readonly refused: { count: number } }>((resolve) => {
          const refused = { count: 0 }
          const server = createServer((request, response) => {
            if (`Authorization: ${request.headers.authorization ?? ''}` !== SIGNED) {
              refused.count += 1
              response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="fake"' }).end()
              return
            }
            const url = new URL(request.url ?? '/', 'http://localhost')
            const backend = spawn('git', ['http-backend'], {
              env: {
                ...process.env,
                GIT_PROJECT_ROOT: root,
                GIT_HTTP_EXPORT_ALL: '1',
                PATH_INFO: url.pathname,
                QUERY_STRING: url.search.slice(1),
                REQUEST_METHOD: request.method ?? 'GET',
                CONTENT_TYPE: request.headers['content-type'] ?? '',
                HTTP_CONTENT_ENCODING: request.headers['content-encoding'] ?? '',
                GIT_PROTOCOL: String(request.headers['git-protocol'] ?? ''),
              },
            })
            request.pipe(backend.stdin)
            const out: Buffer[] = []
            backend.stdout.on('data', (chunk: Buffer) => out.push(chunk))
            backend.on('close', () => {
              const all = Buffer.concat(out)
              const end = all.indexOf('\r\n\r\n')
              const headers = all.subarray(0, end).toString().split('\r\n')
              const status = Number(/^Status: (\d+)/m.exec(headers.join('\n'))?.[1] ?? 200)
              response.writeHead(
                status,
                Object.fromEntries(
                  headers
                    .filter((line) => !line.startsWith('Status:'))
                    .map((line) => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 1).trim()]),
                ),
              )
              response.end(all.subarray(end + 4))
            })
          })
          server.listen(0, '127.0.0.1', () =>
            resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, refused }),
          )
        }),
    ),
    ({ server }) => Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
  )

/**
 * The person's repository, its origin on the fake GitHub, and what is on the
 * host: a branch nobody here pulled, with a pull request open from it, and a
 * fork's pull request, its commit at the host's ref for it only.
 */
const onHost = () => {
  const path = repository()
  writeFileSync(join(path, 'package.json'), JSON.stringify({ name: 'meridian', scripts: { dev: 'node serve.js' } }))
  writeFileSync(join(path, 'serve.js'), serving(5211))
  git(path, 'add', '.')
  git(path, 'commit', '-q', '-m', 'Serve')
  git(path, 'remote', 'add', 'origin', `${HOST}/meridian/api.git`)
  const root = mkdtempSync(join(tmpdir(), 'althar-host-'))
  const bare = join(root, 'api.git')
  git(root, 'init', '-q', '--bare', '-b', 'main', bare)
  git(path, 'push', '-q', bare, 'main')
  const other = mkdtempSync(join(tmpdir(), 'althar-other-'))
  git(other, 'clone', '-q', bare, '.')
  git(other, 'switch', '-q', '-c', 'feature/find-a-pro')
  writeFileSync(join(other, 'serve.js'), serving(5212))
  git(other, 'commit', '-q', '-am', 'Add a services directory')
  git(other, 'push', '-q', 'origin', 'feature/find-a-pro')
  const branch = git(other, 'rev-parse', 'HEAD')
  git(other, 'switch', '-q', '--detach', 'main')
  writeFileSync(join(other, 'serve.js'), serving(5213))
  git(other, 'commit', '-q', '-am', 'Dark mode')
  git(other, 'push', '-q', 'origin', 'HEAD:refs/pull/2/head')
  const fork = git(other, 'rev-parse', 'HEAD')
  return { path, root, branch, fork }
}

describe('running a branch or a pull request on a connected code host', () => {
  it.live('lists and searches its pull requests, and fetches a branch’s and a fork’s with the connection’s sign-in', () => {
    const { path, root, branch, fork } = onHost()
    return Effect.gen(function* () {
      const { url, refused } = yield* serve(root)
      const github = makeFakeService({ pushUrl: () => `${url}/api.git`, pushHeader: SIGNED })
      github.addRepository(['meridian', 'api'])
      github.addPullRequest({ path: ['meridian', 'api'], title: 'Add a services directory', author: 'mira', source: 'feature/find-a-pro' })
      github.addPullRequest({ path: ['meridian', 'api'], title: 'Dark mode', author: 'sam', source: 'dark-mode', fork: ['sam', 'api'] })
      // Newer ones than a listing has room for.
      for (let n = 0; n < 50; n++)
        github.addPullRequest({ path: ['meridian', 'api'], title: `Tidy ${n}`, author: 'sam', source: `tidy-${n}` })
      return yield* Effect.gen(function* () {
        yield* connect
        const fetches = yield* Fetches
        const launches = yield* Launches
        const projects = yield* Projects
        const { projectId } = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path })

        // The newest fifty, saying there are more; the branches, by the signed way, the default first.
        const [listed] = yield* fetches.offered(projectId)
        assert.lengthOf(listed?.pullRequests ?? [], 50)
        assert.isTrue(listed?.more)
        assert.isNull(listed?.note)
        assert.deepStrictEqual(listed?.branches, ['main', 'feature/find-a-pro'])
        assert.notInclude(
          (listed?.pullRequests ?? []).map((one) => one.title),
          'Add a services directory',
        )
        // Words find those past it, on the host.
        const [searched] = yield* fetches.offered(projectId, 'services')
        assert.deepStrictEqual(searched?.pullRequests, [
          {
            number: 1,
            name: 'PR #1',
            title: 'Add a services directory',
            branch: 'feature/find-a-pro',
            author: 'mira',
            draft: false,
            fork: false,
          },
        ])
        assert.include((yield* fetches.offered(projectId, 'dark'))[0]?.pullRequests[0], { number: 2, fork: true })

        // A pull request from the repository's own branch: that branch, fetched with the sign-in.
        const own = yield* launches.start({ projectId, taskId: null, threadId: null, ref: { kind: 'pull_request', which: '1' } })
        assert.deepInclude(own, { taskId: null, branch: 'PR #1 · feature/find-a-pro' })
        assert.strictEqual(git(path, 'rev-parse', 'origin/feature/find-a-pro'), branch)
        const [up] = yield* until(launches.ofProject(projectId), (all) => all[0]?.url != null)
        assert.strictEqual(up?.url, 'http://localhost:5212/')
        yield* launches.stop(own.id)
        // A fork's, by its link: the host's ref for it.
        const forked = yield* launches.start({
          projectId,
          taskId: null,
          threadId: null,
          ref: { kind: 'pull_request', which: `${HOST}/meridian/api/pull/2` },
        })
        assert.deepInclude(forked, { branch: 'PR #2 · dark-mode' })
        assert.strictEqual(git(path, 'rev-parse', 'refs/althar/pull/2'), fork)
        yield* launches.stop(forked.id)
        // Nothing went without the sign-in, and nothing reached the remote any other way.
        assert.strictEqual(refused.count, 0)
        assert.includeMembers([...github.calls], ['pushTarget', 'listChanges', 'change'])
      }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }) })))))
    }).pipe(Effect.scoped)
  })

  it.live('refuses a pull request’s link on another host or repository, from the coordinator’s run and a lead’s fetch alike', () => {
    const { path, root } = onHost()
    return Effect.gen(function* () {
      const { url } = yield* serve(root)
      const github = makeFakeService({ pushUrl: () => `${url}/api.git`, pushHeader: SIGNED })
      github.addRepository(['meridian', 'api'])
      github.addRepository(['meridian', 'web'])
      github.addPullRequest({ path: ['meridian', 'api'], title: 'Add a services directory', author: 'mira', source: 'feature/find-a-pro' })
      return yield* Effect.gen(function* () {
        yield* connect
        const launches = yield* Launches
        const projects = yield* Projects
        const { projectId } = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path })
        // The same number, on GitLab: another change altogether.
        const elsewhere = 'https://gitlab.com/meridian/api/-/merge_requests/1'
        assert.deepInclude(
          yield* Effect.flip(launches.start({ projectId, taskId: null, threadId: null, ref: { kind: 'pull_request', which: elsewhere } })),
          { why: 'fetch', message: 'That pull request is on gitlab.com/meridian/api, not github.test/meridian/api.' },
        )
        assert.include(
          (
            (yield* Effect.flip(
              launches.start({
                projectId,
                taskId: null,
                threadId: null,
                ref: { kind: 'pull_request', which: `${HOST}/meridian/web/pull/1` },
              }),
            )) as { readonly message: string }
          ).message,
          'is on github.test/meridian/web, not github.test/meridian/api',
        )
        assert.lengthOf(yield* launches.ofProject(projectId), 0)
        const task = yield* projects.createTask({
          envelope: yield* Runtime.envelope('task.create', { title: 'Find a pro' }),
          projectId,
          title: 'Find a pro',
        })
        const lead: ToolAccess = { role: 'lead', projectId, threadId: task.threadId, sessionId: 'none', taskId: task.taskId }
        assert.include(
          yield* callTool(lead, 'fetch_from_remote', { pull_request: elsewhere }),
          'That pull request is on gitlab.com/meridian/api, not github.test/meridian/api.',
        )
        assert.throws(() => git(path, 'rev-parse', '--verify', '-q', 'origin/feature/find-a-pro'))
        // Its own link, it fetches.
        assert.include(
          yield* callTool(lead, 'fetch_from_remote', { pull_request: `${HOST}/meridian/api/pull/1` }),
          'origin/feature/find-a-pro',
        )
      }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }) })))))
    }).pipe(Effect.scoped)
  })
})
