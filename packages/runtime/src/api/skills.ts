import type { ApiHandlers, ApiError } from '@althar/contracts'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'
import {
  approve,
  checkUpdates,
  findSkills,
  type GitHubAccess,
  type Install,
  parseGitHubSource,
  resolveRef,
  resolveTree,
  rollBack,
  SkillRefused,
  stageFromGitHub,
  uninstall,
} from '@althar/skills'

import { Failures } from '../Failures'
import { RuntimeConfig } from '../Config'
import { describe, listSkills, type SkillsConfig } from '../Skills'
import { forgetSkillRoles } from '../agentTools'
import type { ApiKit } from './kit'

/**
 * The skills a task's lead is given: listing them, finding and staging one from GitHub, approving it.
 * Checking for updates, rolling back and uninstalling.
 */
export const skillsHandlers = ({ api, skillAct }: ApiKit) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const config = yield* RuntimeConfig
    const failures = yield* Failures
    /* GitHub as the skills page reaches it: over the app's own network, unauthenticated, for public repositories. */
    const github: GitHubAccess = config.fetch === undefined ? {} : { fetch: config.fetch }
    /**
     * A skills store operation as the window gets it, through `api()` (ADR-047): a refusal in the person's words, never
     * reported; anything else (a store that failed, a defect) in the log and reported by the call. Refused where the
     * runtime has no store.
     */
    const skills = <A, E>(work: (store: SkillsConfig) => Effect.Effect<A, E>): Effect.Effect<A, ApiError> => {
      const store = config.skills
      const effect: Effect.Effect<A, E | SkillRefused> =
        store === undefined ? Effect.fail(new SkillRefused({ message: 'Skills are off in this runtime' })) : work(store)
      return api(effect)
    }
    /** What the record keeps of a version: where it is from and which files, by their tree hash. */
    const versionSaid = (install: Install) => ({
      source: install.source,
      treeHash: install.treeHash,
      ...(install.repo === undefined ? {} : { repo: install.repo }),
      ...(install.subpath === undefined ? {} : { subpath: install.subpath }),
      ...(install.ref === undefined ? {} : { ref: install.ref }),
      ...(install.sha === undefined ? {} : { sha: install.sha }),
    })
    return {
      ListSkills: () =>
        config.skills === undefined ? Effect.succeed({ enabled: false, skills: [] }) : skills((store) => listSkills(store)),
      FindSkills: ({ source, ref }) =>
        skills(() =>
          Effect.gen(function* () {
            const parsed = parseGitHubSource(source)
            if (parsed === null)
              return yield* new SkillRefused({ message: `${source} isn't a GitHub repository; paste its address or owner/name` })
            // A pasted `/tree/` address names its ref and path; GitHub splits them.
            const at =
              parsed.tree === undefined
                ? { ref: ref ?? 'HEAD', sha: yield* resolveRef(github, parsed.repo, ref ?? 'HEAD') }
                : yield* resolveTree(github, parsed.repo, parsed.tree)
            const paths = at.subpath === undefined ? yield* findSkills(github, parsed.repo, at.sha) : [at.subpath]
            return { repo: parsed.repo, ref: at.ref, sha: at.sha, paths }
          }),
        ),
      StageSkill: ({ repo, ref, subpath }) => skills((store) => stageFromGitHub(store.root, github, { repo, ref, subpath })),
      ApproveSkill: ({ commandId, ...approval }) =>
        skills((store) =>
          Effect.gen(function* () {
            const installed = yield* approve(store.root, approval)
            yield* skillAct(commandId, installed.id, 'approved', {
              ...versionSaid(installed),
              active: installed.active,
              ...(approval.replace === true ? { replaced: true } : {}),
            })
            return yield* describe(store.root, installed)
          }),
        ),
      // One that can't be checked says why on its own; one that failed for no reason of the person's or GitHub's is reported too.
      CheckSkillUpdates: () =>
        skills((store) =>
          Effect.gen(function* () {
            const checks = []
            for (const check of yield* checkUpdates(store.root, github)) {
              if (check.state !== 'failed') {
                checks.push(check)
                continue
              }
              if (check.unexpected !== undefined) {
                yield* Effect.logWarning('A skill update check did not succeed', check.unexpected)
                yield* failures.report(check.unexpected, 'CheckSkillUpdates')
              }
              checks.push({ id: check.id, state: check.state, error: check.error })
            }
            return checks
          }),
        ),
      RollBackSkill: ({ commandId, id }) =>
        skills((store) =>
          Effect.gen(function* () {
            const restored = yield* rollBack(store.root, id)
            yield* skillAct(commandId, id, 'rolled_back', versionSaid(restored))
            return yield* describe(store.root, restored)
          }),
        ),
      UninstallSkill: ({ commandId, id }) =>
        skills((store) =>
          Effect.gen(function* () {
            const removed = yield* uninstall(store.root, id)
            if (removed !== undefined) {
              yield* forgetSkillRoles(id).pipe(Effect.provideService(SqlClient.SqlClient, sql))
              yield* skillAct(commandId, id, 'removed', versionSaid(removed))
            }
          }),
        ),
    } satisfies Partial<ApiHandlers>
  })
