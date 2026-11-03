import type { Effect } from 'effect'

import { ConnectorFailed } from './errors'
import type { CheckState, Product, Repository } from './model'

/*
 * Releases on a code host (ADR-081, "A release"): the tag a release is cut
 * from, the release itself as each host has one, and the CI runs on the tag,
 * with what each waits on before it may go on. Each host releases its own
 * way, and where it can't do something it says so in its own words, with
 * the host's own page for the person's press (ADR-082): never a no-op that
 * looks done.
 */

/** A tag on the host: its name, the commit it is on (an annotated tag's, peeled), and its page. */
export interface Tag {
  readonly name: string
  readonly commit: string
  readonly url: string | null
}

/**
 * How a host releases. GitHub drafts a release, and publishing makes it
 * public (`draft`). GitLab has no drafts, so making the release is
 * publishing it (`made`). Bitbucket Cloud has no releases: the tag is the
 * release, and publishing puts its files in Downloads (`downloads`).
 * Bitbucket Data Center has neither: the tag is the release, and the
 * repository's own CI does the rest (`tag`).
 */
export type ReleaseWay = 'draft' | 'made' | 'downloads' | 'tag'

/** One of a release's files: a GitHub asset, a GitLab release's link, a file in Bitbucket Cloud's Downloads. */
export interface ReleaseFile {
  readonly name: string
  readonly size: number | null
  readonly url: string | null
}

/**
 * A release as the host has it. `draft`: made and not published, as only
 * GitHub has them; `published`: out, for everyone who can see the
 * repository; `tagged`: the host has no releases, and the tag is there.
 */
export interface Release {
  readonly id: string
  readonly tag: string
  readonly name: string | null
  readonly state: 'draft' | 'published' | 'tagged'
  readonly url: string | null
  readonly files: ReadonlyArray<ReleaseFile>
}

/** A file to put in a release where the host takes its files from Althar: Bitbucket Cloud's Downloads. */
export interface ReleaseUpload {
  readonly name: string
  readonly bytes: Uint8Array
  readonly mediaType: string
}

/**
 * What a run waits on before it goes on: GitHub's environment with required
 * reviewers (`environment`), GitLab's deployment approval (`deployment`) or
 * manual job (`manual_job`), Bitbucket Pipelines' manual step
 * (`manual_step`).
 */
export type GateKind = 'environment' | 'deployment' | 'manual_job' | 'manual_step'

export interface Gate {
  /** The host's own id for it: an environment's, a deployment's, a job's, a step's. */
  readonly id: string
  /** Its name, as the host shows it: `release`, a job's name. */
  readonly name: string
  readonly kind: GateKind
  /**
   * Whether the connected account may give it through the API. False where
   * only the person can, on the host: an environment whose reviewers leave
   * the account out (or that stops its own approver), and every manual step
   * on Bitbucket Cloud, which has no API to run one.
   */
  readonly approvable: boolean
  /** Where the person gives it on the host. */
  readonly url: string | null
}

/**
 * A CI run on a branch or a tag: a GitHub Actions workflow run, a GitLab
 * pipeline, a Bitbucket pipeline; on Bitbucket Data Center, a build another
 * service reported on the commit.
 */
export interface Run {
  readonly id: string
  readonly name: string
  /** The branch or tag it ran on. */
  readonly ref: string
  readonly sha: string | null
  readonly state: CheckState
  readonly url: string | null
  /** What it waits on now, before it goes on: empty where nothing does. */
  readonly gates: ReadonlyArray<Gate>
}

/** What a code host offers Althar for releases (ADR-081, "A release"). */
export interface HostReleases {
  readonly releasing: ReleaseWay
  /** The commit a branch, a tag or a commit is at now, as the host reads it: refused as `not_found` where there is none. */
  commitOf(repository: Repository, ref: string): Effect.Effect<string, ConnectorFailed>
  /** A tag, or null where the repository has none by that name. */
  tag(repository: Repository, name: string): Effect.Effect<Tag | null, ConnectorFailed>
  /**
   * Makes a tag on a commit, because the person said to. One already on that
   * commit is left as it is. One on another commit is refused (`tagTaken`)
   * unless `move` says to move it, which the person must have asked for:
   * people and CI may have read it where it was.
   */
  pushTag(
    repository: Repository,
    tag: { readonly name: string; readonly commit: string; readonly move?: boolean },
  ): Effect.Effect<Tag, ConnectorFailed>
  /** Deletes a tag, because the person said to. One already gone is nothing to do. */
  deleteTag(repository: Repository, name: string): Effect.Effect<void, ConnectorFailed>
  /** The release of a tag as the host has it, a draft included; null where there is none (on Bitbucket, no tag). */
  release(repository: Repository, tag: string): Effect.Effect<Release | null, ConnectorFailed>
  /**
   * Publishes a tag's release as the host does, because the person said to:
   * GitHub's draft made public; GitLab's release made, with `name` and
   * `notes`; on Bitbucket Cloud, `files` put in Downloads, each one not
   * there already. Read back after. One published already is left as it is.
   * Refused on Bitbucket Data Center (`noReleases`), and on GitHub where
   * there is no draft yet.
   */
  publishRelease(
    repository: Repository,
    tag: string,
    release: { readonly name?: string; readonly notes?: string; readonly files?: ReadonlyArray<ReleaseUpload> },
  ): Effect.Effect<Release, ConnectorFailed>
  /** The newest CI runs on a branch or a tag, newest first, each with what it waits on now. */
  runs(repository: Repository, ref: string): Effect.Effect<ReadonlyArray<Run>, ConnectorFailed>
  /**
   * Gives what a run waits on, because the person said to: approves
   * GitHub's environment or GitLab's deployment, plays GitLab's manual job.
   * Refused where the account can't (`notApprovable`), and where only the
   * person can, as Bitbucket's manual steps (`onlyOnTheHost`): each with
   * the host's own page. The run read back after.
   */
  approveRun(repository: Repository, run: Run, gate: Gate): Effect.Effect<Run, ConnectorFailed>
  /**
   * Runs a run's failed jobs again, as for ones that may have failed by
   * chance: GitHub's and GitLab's failed jobs, Bitbucket Cloud's pipeline
   * whole, on the same commit. True where the host began them again.
   * Refused on Bitbucket Data Center, whose builds are another service's.
   */
  rerunFailed(repository: Repository, run: Run): Effect.Effect<boolean, ConnectorFailed>
}

/** A tag that is on another commit already, and wasn't asked to move. */
export const tagTaken = (product: Product, name: string, commit: string): ConnectorFailed =>
  new ConnectorFailed({
    product,
    reason: 'rejected',
    message: `${name} is on ${commit.slice(0, 8)} already. Moving a tag must be asked for: people and CI may have read it there.`,
  })

/** A run's gate the connected account may not give: whoever may gives it on the host. */
export const notApprovable = (product: Product, gate: Pick<Gate, 'name' | 'url'>): ConnectorFailed =>
  new ConnectorFailed({
    product,
    reason: 'forbidden',
    message: `The connected account can’t approve ${gate.name}: one of its reviewers approves it on the host.${gate.url === null ? '' : ` Its button: ${gate.url}`}`,
  })

/** A run that is another service's, as every build is on Bitbucket Data Center: approved where it runs. */
export const anotherServices = (product: Product, run: Pick<Run, 'name' | 'url'>): ConnectorFailed =>
  new ConnectorFailed({
    product,
    reason: 'forbidden',
    message: `${run.name} is built by another service (Jenkins, Bamboo or the like), not by Bitbucket Data Center, so only it can approve it.${run.url === null ? '' : ` Its page: ${run.url}`}`,
  })

/** A gate only the person can give, on the host: Bitbucket Cloud's manual step, which no API runs. */
export const onlyOnTheHost = (product: Product, gate: Pick<Gate, 'name' | 'url'>): ConnectorFailed =>
  new ConnectorFailed({
    product,
    reason: 'rejected',
    message: `Bitbucket has no API to run the manual step ${gate.name}: the person runs it from the pipeline’s page.${gate.url === null ? '' : ` Its button: ${gate.url}`}`,
  })

/** A release on a host that has none to publish: Bitbucket Data Center, where the tag is the release. */
export const noReleases = (product: Product): ConnectorFailed =>
  new ConnectorFailed({
    product,
    reason: 'rejected',
    message: 'Bitbucket Data Center has no releases: the tag is the release, and the repository’s own CI does the rest.',
  })

/** Bitbucket Cloud's publishing with nothing to put in Downloads. */
export const noFiles = (product: Product): ConnectorFailed =>
  new ConnectorFailed({
    product,
    reason: 'rejected',
    message: 'Bitbucket Cloud has no releases: publishing puts the release’s files in Downloads, so it needs the files.',
  })

/** A draft that isn't there yet, on a host whose releases are drafted first (GitHub). */
export const noDraft = (product: Product, tag: string): ConnectorFailed =>
  new ConnectorFailed({
    product,
    reason: 'not_found',
    message: `There is no draft release of ${tag} yet: the release’s run makes it, once it is approved and done.`,
  })
