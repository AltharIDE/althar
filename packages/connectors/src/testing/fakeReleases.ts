import { createHash } from 'node:crypto'

import { Effect } from 'effect'

import { ConnectorFailed } from '../errors'
import { type CheckState, notOurBuild, type Product, type Repository } from '../model'
import {
  anotherServices,
  type Gate,
  type GateKind,
  type HostReleases,
  noDraft,
  noFiles,
  noReleases,
  notApprovable,
  onlyOnTheHost,
  type Release,
  type ReleaseFile,
  type ReleaseWay,
  type Run,
  tagTaken,
} from '../releases'

/*
 * The fake's releases, as each product's adapter has them (ADR-081, "A
 * release"): tags made, moved and deleted; GitHub's drafts published,
 * GitLab's releases made, Bitbucket Cloud's files put in Downloads, and Data
 * Center's tag alone; runs on a tag that wait on a gate, approved where the
 * account may, and failed ones run again. A test acts as CI and as other
 * people: it starts runs, drafts releases, and moves branches.
 */

/** How each product releases, as its adapter says. */
export const RELEASING: Readonly<Record<Product, ReleaseWay>> = {
  github: 'draft',
  gitlab: 'made',
  bitbucket_cloud: 'downloads',
  bitbucket_dc: 'tag',
  linear: 'draft',
  jira_cloud: 'draft',
  jira_dc: 'draft',
  trello: 'draft',
}

/** A gate a run waits on, as a test starts it: the kind its product has unless said; the account may give it unless said. */
export interface FakeGate {
  readonly name: string
  readonly kind?: GateKind
  readonly approvable?: boolean
}

export interface FakeReleaseControls {
  /** A branch's head moves, as a push or a merge moves it. Each branch starts at a commit of its own. */
  moveBranch(path: ReadonlyArray<string>, branch: string, commit: string): void
  /** Someone else tags a commit on the host. */
  tagByHand(path: ReadonlyArray<string>, name: string, commit: string): void
  /** CI starts a run on a branch or a tag: waiting on its gates, else running, unless `state` says. */
  startRun(
    path: ReadonlyArray<string>,
    run: { readonly ref: string; readonly name?: string; readonly state?: CheckState; readonly gates?: ReadonlyArray<FakeGate> },
  ): Run
  /** A run ends, as CI ends it. */
  finishRun(id: string, state: CheckState): void
  /** CI drafts a tag's release with its files, as release.yml does on GitHub. */
  draftRelease(path: ReadonlyArray<string>, tag: string, files?: ReadonlyArray<string>): Release
  /** Every tag made or moved, in order, by Althar or by hand. */
  readonly tagsPushed: ReadonlyArray<{ readonly name: string; readonly commit: string; readonly moved: boolean }>
  readonly tagsDeleted: ReadonlyArray<string>
  /** Every gate given, in order, by the run it was on. */
  readonly approvals: ReadonlyArray<{ readonly run: string; readonly gate: string }>
  /** Every release published, by its tag, in order; on Bitbucket Cloud, each publishing that put files in Downloads. */
  readonly published: ReadonlyArray<string>
  /** Every run whose failed jobs ran again, by its id, in order. */
  readonly rerunRuns: ReadonlyArray<string>
}

export const makeFakeReleases = (input: {
  readonly product: Product
  /** Records a call, and fails it where a test asked (`failNext`). */
  readonly called: (method: string) => Effect.Effect<void, ConnectorFailed>
}): HostReleases & FakeReleaseControls => {
  const { product } = input
  const releasing = RELEASING[product]
  const keyOf = (path: ReadonlyArray<string>) => path.join('/').toLowerCase()
  const heads = new Map<string, string>()
  const tags = new Map<string, string>()
  const releases = new Map<string, { id: string; tag: string; name: string | null; draft: boolean; files: Array<ReleaseFile> }>()
  const downloads = new Map<string, Array<ReleaseFile>>()
  const runs: Array<Run & { readonly path: string }> = []
  const pushed: Array<{ readonly name: string; readonly commit: string; readonly moved: boolean }> = []
  const deleted: Array<string> = []
  const approvals: Array<{ readonly run: string; readonly gate: string }> = []
  const published: Array<string> = []
  const reran: Array<string> = []
  let ids = 0

  const missing = (what: string) => new ConnectorFailed({ product, reason: 'not_found', message: `No ${what}` })
  const headOf = (path: string, branch: string) =>
    heads.get(`${path} ${branch}`) ?? createHash('sha1').update(`${path} ${branch}`).digest('hex')
  const tagUrl = (repository: Repository, name: string) => `${repository.webUrl}/releases/tag/${encodeURIComponent(name)}`
  const kindOf = (gate: FakeGate): GateKind =>
    gate.kind ?? (product === 'gitlab' ? 'deployment' : product === 'bitbucket_cloud' ? 'manual_step' : 'environment')
  const runNow = (id: string) => {
    const index = runs.findIndex((run) => run.id === id)
    return { index, run: runs[index] }
  }
  const setRun = (index: number, set: Partial<Run>) => {
    const run = runs[index]
    if (run !== undefined) runs[index] = { ...run, ...set }
  }
  const releaseOf = (repository: Repository, name: string): Release | null => {
    const path = keyOf(repository.path)
    if (releasing === 'downloads' || releasing === 'tag') {
      if (!tags.has(`${path} ${name}`)) return null
      return {
        id: name,
        tag: name,
        name: null,
        state: 'tagged',
        url: releasing === 'downloads' ? `${repository.webUrl}/downloads/` : tagUrl(repository, name),
        files: releasing === 'downloads' ? [...(downloads.get(path) ?? [])] : [],
      }
    }
    const found = releases.get(`${path} ${name}`)
    return found === undefined
      ? null
      : {
          id: found.id,
          tag: found.tag,
          name: found.name,
          state: found.draft ? 'draft' : 'published',
          url: tagUrl(repository, name),
          files: [...found.files],
        }
  }

  return {
    releasing,
    commitOf: (repository, ref) =>
      Effect.andThen(input.called('commitOf'), () => {
        const path = keyOf(repository.path)
        const tagged = tags.get(`${path} ${ref}`)
        if (tagged !== undefined) return Effect.succeed(tagged)
        if (/^[0-9a-f]{7,64}$/i.test(ref)) return Effect.succeed(ref)
        // A branch: the default branch, or any a test moved.
        if (ref === repository.defaultBranch || heads.has(`${path} ${ref}`)) return Effect.succeed(headOf(path, ref))
        return Effect.fail(missing(`commit or branch ${ref}`))
      }),
    tag: (repository, name) =>
      Effect.andThen(input.called('tag'), () => {
        const commit = tags.get(`${keyOf(repository.path)} ${name}`)
        return Effect.succeed(commit === undefined ? null : { name, commit, url: tagUrl(repository, name) })
      }),
    pushTag: (repository, wanted) =>
      Effect.andThen(input.called('pushTag'), () => {
        const key = `${keyOf(repository.path)} ${wanted.name}`
        const now = tags.get(key)
        if (now === wanted.commit) return Effect.succeed({ name: wanted.name, commit: now, url: tagUrl(repository, wanted.name) })
        if (now !== undefined && wanted.move !== true) return Effect.fail(tagTaken(product, wanted.name, now))
        tags.set(key, wanted.commit)
        pushed.push({ name: wanted.name, commit: wanted.commit, moved: now !== undefined })
        return Effect.succeed({ name: wanted.name, commit: wanted.commit, url: tagUrl(repository, wanted.name) })
      }),
    deleteTag: (repository, name) =>
      Effect.andThen(input.called('deleteTag'), () => {
        if (tags.delete(`${keyOf(repository.path)} ${name}`)) deleted.push(name)
        return Effect.void
      }),
    release: (repository, name) => Effect.andThen(input.called('release'), () => Effect.succeed(releaseOf(repository, name))),
    publishRelease: (repository, name, wanted) =>
      Effect.andThen(input.called('publishRelease'), (): Effect.Effect<Release, ConnectorFailed> => {
        const path = keyOf(repository.path)
        switch (releasing) {
          case 'tag':
            return Effect.fail(noReleases(product))
          case 'downloads': {
            const files = wanted.files ?? []
            if (files.length === 0) return Effect.fail(noFiles(product))
            const there = downloads.get(path) ?? []
            const added = files.filter((file) => !there.some((one) => one.name === file.name))
            downloads.set(path, [
              ...there,
              ...added.map((file) => ({
                name: file.name,
                size: file.bytes.byteLength,
                url: `${repository.webUrl}/downloads/${file.name}`,
              })),
            ])
            if (added.length > 0) published.push(name)
            return Effect.succeed(releaseOf(repository, name) ?? { id: name, tag: name, name: null, state: 'tagged', url: null, files: [] })
          }
          case 'made': {
            if (releases.has(`${path} ${name}`)) return Effect.succeed(releaseOf(repository, name)!)
            if (!tags.has(`${path} ${name}`))
              return Effect.fail(new ConnectorFailed({ product, reason: 'rejected', status: 422, message: 'Tag does not exist' }))
            releases.set(`${path} ${name}`, { id: `release-${(ids += 1)}`, tag: name, name: wanted.name ?? name, draft: false, files: [] })
            published.push(name)
            return Effect.succeed(releaseOf(repository, name)!)
          }
          case 'draft': {
            const found = releases.get(`${path} ${name}`)
            if (found === undefined) return Effect.fail(noDraft(product, name))
            if (found.draft) {
              found.draft = false
              if (wanted.name !== undefined) found.name = wanted.name
              published.push(name)
            }
            return Effect.succeed(releaseOf(repository, name)!)
          }
        }
      }),
    runs: (repository, ref) =>
      Effect.andThen(input.called('runs'), () =>
        Effect.succeed(
          runs
            .filter((run) => run.path === keyOf(repository.path) && run.ref === ref)
            .toReversed()
            .map(({ path: _, ...run }) => run),
        ),
      ),
    approveRun: (_repository, run, gate) =>
      Effect.andThen(input.called('approveRun'), (): Effect.Effect<Run, ConnectorFailed> => {
        if (product === 'bitbucket_cloud') return Effect.fail(onlyOnTheHost(product, gate))
        if (product === 'bitbucket_dc') return Effect.fail(anotherServices(product, run))
        const { index, run: now } = runNow(run.id)
        if (now === undefined) return Effect.fail(missing(`run ${run.id}`))
        const waiting = now.gates.find((one) => one.id === gate.id)
        // As GitHub: what doesn't wait (given already, or never asked) can't be given.
        if (waiting === undefined)
          return Effect.fail(new ConnectorFailed({ product, reason: 'rejected', status: 422, message: `${gate.name} isn’t waiting` }))
        if (!waiting.approvable) return Effect.fail(notApprovable(product, waiting))
        approvals.push({ run: run.id, gate: gate.id })
        const gates = now.gates.filter((one) => one.id !== gate.id)
        setRun(index, { gates, state: gates.length === 0 ? 'running' : now.state })
        const { path: _, ...after } = runs[index]!
        return Effect.succeed(after)
      }),
    rerunFailed: (repository, run) =>
      Effect.andThen(input.called('rerunFailed'), (): Effect.Effect<boolean, ConnectorFailed> => {
        if (product === 'bitbucket_dc') return Effect.fail(notOurBuild(product, { name: run.name, url: run.url }))
        const { index, run: now } = runNow(run.id)
        if (now === undefined) return Effect.fail(missing(`run ${run.id}`))
        if (now.state !== 'failed') return Effect.succeed(false)
        reran.push(run.id)
        // Bitbucket runs the pipeline again whole, as a new one; the others run the failed jobs again within it.
        if (product === 'bitbucket_cloud') {
          const id = String((ids += 1))
          runs.push({ ...now, id, name: `Pipeline #${id}`, state: 'running', url: `${repository.webUrl}/pipelines/results/${id}` })
        } else setRun(index, { state: 'running' })
        return Effect.succeed(true)
      }),

    moveBranch: (path, branch, commit) => void heads.set(`${keyOf(path)} ${branch}`, commit),
    tagByHand: (path, name, commit) => {
      tags.set(`${keyOf(path)} ${name}`, commit)
      pushed.push({ name, commit, moved: false })
    },
    startRun: (path, wanted) => {
      const id = String((ids += 1))
      const webUrl = `https://fake.example/${path.join('/')}`
      const gates = (wanted.gates ?? []).map((gate, index): Gate => ({
        id: `gate-${id}-${index}`,
        name: gate.name,
        kind: kindOf(gate),
        // A manual step on Bitbucket Cloud is the person's alone; Data Center's builds have nothing Althar gives.
        approvable: product !== 'bitbucket_cloud' && product !== 'bitbucket_dc' && gate.approvable !== false,
        url: `${webUrl}/runs/${id}`,
      }))
      const run: Run & { readonly path: string } = {
        path: keyOf(path),
        id,
        name: wanted.name ?? 'release',
        ref: wanted.ref,
        sha: tags.get(`${keyOf(path)} ${wanted.ref}`) ?? null,
        state: wanted.state ?? (gates.length > 0 ? 'queued' : 'running'),
        url: `${webUrl}/runs/${id}`,
        gates: product === 'bitbucket_dc' ? [] : gates,
      }
      runs.push(run)
      const { path: _, ...shown } = run
      return shown
    },
    finishRun: (id, state) => {
      const { index } = runNow(id)
      setRun(index, { state, gates: [] })
    },
    draftRelease: (path, tag, files = []) => {
      const key = `${keyOf(path)} ${tag}`
      const release = {
        id: `release-${(ids += 1)}`,
        tag,
        name: tag,
        draft: true,
        files: files.map((name) => ({ name, size: 1, url: null })),
      }
      releases.set(key, release)
      return { id: release.id, tag, name: tag, state: 'draft', url: null, files: [...release.files] }
    },
    // The lists themselves, not copies, so they stay live where the fake is spread into another.
    tagsPushed: pushed,
    tagsDeleted: deleted,
    approvals,
    published,
    rerunRuns: reran,
  }
}
