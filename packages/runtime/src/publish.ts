import type { CodeHost, ConnectorFailed, Repository, RepositoryOwner } from '@althar/connectors'
import { Effect } from 'effect'

import { type GitFailed, PublishRefused } from './errors'
import { askedRemoteTip, currentBranch, git, namedRemotes, pushTo } from './git'

/*
 * A project's repository, only on this computer, put on a host the person
 * is connected to: a repository made there, empty, under the owner they
 * chose; `origin` set to it; and the branch checked out pushed, followed
 * from then on, as a clone's is. From then, Althar finds the host by its
 * remote, as it does any repository's, and its tasks open changes there.
 *
 * Made and not pushed, as where the network went meanwhile, `origin` stays:
 * putting it on the host again finds the repository it made, still with
 * nothing on its branch, and pushes to it rather than making another. A
 * repository with a remote of any other kind is refused: it is on a host.
 */

export interface Published {
  /** As the host names it: northwind/app. */
  readonly remote: string
  readonly webUrl: string
  readonly branch: string
}

export const publishRepository = (input: {
  /** The repository's root on this computer. */
  readonly root: string
  readonly host: CodeHost
  /** The host's name, as the person knows it: GitHub. */
  readonly hostName: string
  readonly owner: RepositoryOwner
  readonly name: string
  readonly private: boolean
  /**
   * The host repository `origin` is, where it is on this host as this
   * connection reaches it: null where it is elsewhere, or not a host's.
   */
  readonly originOf: (url: string) => Effect.Effect<ReadonlyArray<string> | null>
}): Effect.Effect<Published, PublishRefused | GitFailed | ConnectorFailed> =>
  Effect.gen(function* () {
    const { root, host, hostName } = input
    const branch = (yield* currentBranch(root)) ?? 'main'
    const remotes = yield* namedRemotes(root)
    const origin = remotes.find((remote) => remote.name === 'origin')
    let made: Repository
    if (remotes.length > 0) {
      // Made here before, and not pushed to: picked up where it stopped. Anything else is a host's already.
      const path = origin === undefined ? null : yield* input.originOf(origin.url)
      const there = path === null ? null : yield* host.repository(path).pipe(Effect.option)
      const pushed =
        there === null || there._tag === 'None'
          ? true
          : yield* askedRemoteTip(root, yield* host.pushTarget(there.value), branch).pipe(
              Effect.map((tip) => tip !== null),
              Effect.orElseSucceed(() => true),
            )
      if (there === null || there._tag === 'None' || pushed)
        return yield* new PublishRefused({ reason: 'has_remote', remote: (origin ?? remotes[0])?.url ?? '', host: hostName })
      made = there.value
    } else {
      made = yield* host.createRepository({ owner: input.owner, name: input.name, private: input.private }).pipe(
        Effect.catchIf(
          (failed: ConnectorFailed) => failed.reason === 'rejected',
          (failed) =>
            Effect.fail(
              new PublishRefused({ reason: 'taken', remote: `${input.owner.id}/${input.name}`, host: hostName, detail: failed.message }),
            ),
        ),
      )
      const target = yield* host.pushTarget(made)
      yield* git(root, 'remote', 'add', 'origin', target.url)
    }
    const target = yield* host.pushTarget(made)
    const remote = made.path.join('/')
    yield* pushTo(root, target, branch).pipe(
      Effect.mapError((failed) => new PublishRefused({ reason: 'push_failed', remote, host: hostName, detail: failed.stderr })),
    )
    // Followed as a clone's branch is: its upstream, and where it is there, so the person's own git and Althar's agree on it.
    yield* git(root, 'update-ref', `refs/remotes/origin/${branch}`, 'HEAD')
    yield* git(root, 'config', `branch.${branch}.remote`, 'origin')
    yield* git(root, 'config', `branch.${branch}.merge`, `refs/heads/${branch}`)
    yield* Effect.ignore(git(root, 'symbolic-ref', 'refs/remotes/origin/HEAD', `refs/remotes/origin/${branch}`))
    return { remote, webUrl: made.webUrl, branch }
  })
