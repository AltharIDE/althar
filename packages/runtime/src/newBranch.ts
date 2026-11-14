import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from './Connections'
import { BranchRefused, NotFound } from './errors'
import { branchOn, fetchBranch, fetchInto, git, gitOutcome, namedRemotes, PUSHED, pushTo } from './git'
import { redacted } from './gitSaid'
import { Instance } from './Instance'
import { startOf } from './Projects'

/*
 * A branch the person makes from a branch list (ADR-093): Run's, the plan
 * card's or Work toward's, by typing a name it doesn't have. It is made on
 * the code host, on the remote the repository's tasks start from (a fork's
 * upstream, where its work goes there), from that remote's default branch,
 * pushed by Althar with its own sign-in. As the coordinator's create_branch,
 * it is never forced: only where the host has no such branch as it takes the
 * push (an empty lease). A branch there already, which the list didn't have
 * because this Mac hadn't fetched it, is left as it is and is the one the
 * person gets.
 */

const refused = (message: string) => new BranchRefused({ message })

export const makeBranch = (input: { readonly projectId: string; readonly repositoryId: string; readonly branch: string }) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const instance = yield* Instance
    const connections = yield* Connections
    const [binding] = yield* sql<{ name: string; path: string | null; base: string | null; changeTarget: string | null }>`
      SELECT b.display_name AS name, l.path, b.default_base_ref AS base, b.change_target FROM repository_bindings b
      LEFT JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${instance.deviceId}
      WHERE b.id = ${input.repositoryId} AND b.project_id = ${input.projectId} AND b.detached_at IS NULL`
    if (binding === undefined) return yield* new NotFound({ kind: 'repository', id: input.repositoryId })
    const clone = binding.path
    if (clone === null) return yield* refused(`${binding.name} has no clone on this computer to make a branch from.`)
    const branch = input.branch.trim().replace(/^refs\/heads\//, '')
    const named = yield* gitOutcome(clone, 'check-ref-format', '--branch', branch).pipe(Effect.orElseSucceed(() => ({ code: 1 })))
    if (branch === '' || branch.startsWith('-') || named.code !== 0)
      return yield* refused(`A branch can’t be called “${input.branch.trim()}”: no spaces, and no / or . at its end.`)

    const { remote, base } = yield* startOf({ repository: clone, base: binding.base, changeTarget: binding.changeTarget, toward: null })
    const url = (yield* namedRemotes(clone).pipe(Effect.orElseSucceed(() => []))).find((one) => one.name === remote)?.url
    const found = url === undefined ? null : yield* connections.hostOf([url]).pipe(Effect.orElseSucceed(() => null))
    if (found === null)
      return yield* refused(
        `${binding.name}’s remote isn’t on a code host Althar is connected to. Connect it in Settings, or make the branch with git.`,
      )
    const reached = yield* Effect.gen(function* () {
      const repository = yield* found.host.repository(found.path)
      return yield* found.host.pushTarget(repository)
    }).pipe(Effect.option)
    if (reached._tag === 'None') return yield* refused(`Althar couldn’t reach ${found.path.join('/')}. Try again.`)
    const target = reached.value
    const where = found.path.join('/')

    const there = yield* branchOn(clone, target, branch)
    if (there === undefined) return yield* refused(`Althar couldn’t reach ${where} to read its branches. Try again.`)
    const held = `refs/althar/start/${branch}`
    // From the default branch as the host has it now; or the one there already, which the person gets.
    const start = yield* fetchInto(clone, target, there === null ? base : branch, held)
    if (start === null) return yield* refused(`Althar couldn’t read ${there === null ? base : branch} on ${where}. Try again.`)
    let at = there ?? start
    if (there === null) {
      const failed = yield* pushTo(clone, target, branch, start, '').pipe(
        Effect.as(null),
        Effect.catch((error) => Effect.succeed(redacted(error.stderr.trim() || error.message))),
      )
      if (failed === null) yield* Effect.ignore(git(clone, 'update-ref', '-d', `${PUSHED}${branch}`))
      else {
        // Refused: by one made there meanwhile, left as it is and the person's now, where the host has it; otherwise, as a
        // hook or the host's rules refusing it, said as git said it.
        yield* Effect.ignore(git(clone, 'update-ref', '-d', held))
        const made = yield* fetchInto(clone, target, branch, held)
        if (made === null) {
          yield* Effect.ignore(git(clone, 'update-ref', '-d', held))
          return yield* refused(`${where} didn’t take the new branch: ${failed}`)
        }
        at = made
      }
    }
    yield* Effect.ignore(git(clone, 'update-ref', '-d', held))
    // Fetched, so the branch lists have it and Work toward finds it there; where the remote can't be fetched as the
    // person's git reaches it, the branch where Althar saw it there last.
    if (!(yield* fetchBranch(clone, branch, remote))) yield* Effect.ignore(git(clone, 'update-ref', `refs/remotes/${remote}/${branch}`, at))
    return branch
  })
