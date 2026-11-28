import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  agents,
  type AgentDefinition,
  type AgentId,
  claudeProgram,
  codexProgram,
  isMusl,
  type Located,
  usingLocated,
  usualDirs,
} from '@althar/provider-adapters'
import { Installs, type InstallFailed, type Progress } from '@althar/runtime/installs'
import { Effect } from 'effect'

/*
 * The agents a worker runs (docs/plans/agents-on-first-use.md): every agent Althar runs as a program of its own, each
 * found as on any computer Althar runs on. The person's own install on the worker where it fits; else, for Claude Code
 * and Codex, the program a release from before agents came on first use carries beside its adapter; else the copy
 * Althar downloads, kept under the worker's own folder (`programs`) and reused until its pin moves. Nothing of an
 * agent ships in a worker's release but its adapter.
 */

/** Every agent a worker can run: those Althar runs as a program of its own (Copilot's own loop runs in Althar itself). */
export const WORKER_AGENTS: ReadonlyArray<AgentId> = (Object.keys(agents) as AgentId[]).filter((id) => agents[id].cli !== undefined)

const ARCH = process.arch === 'arm64' ? 'arm64' : 'x64'

/** The package folder in a release where one from before agents came on first use carries Claude Code's or Codex's program. */
const packageInRelease = (release: string, id: AgentId): { readonly folder: string; readonly program: string } | undefined => {
  const program = id === 'claude-code' ? claudeProgram('linux', ARCH, false) : id === 'codex' ? codexProgram('linux', ARCH) : undefined
  const name = program?.platforms[0]
  if (program === undefined || name === undefined) return undefined
  const folder = join(release, 'node_modules', ...name.split('/'))
  return { folder, program: join(folder, ...program.program.split(/[\\/]/u)) }
}

/** Claude Code's or Codex's program in a release that carries it, by its path; null where it doesn't. */
export const programInRelease = (release: string, id: AgentId): string | null => {
  const found = packageInRelease(release, id)
  return found !== undefined && existsSync(found.program) ? found.program : null
}

/** An agent as a worker has it: how it starts, where its program is if anywhere, and whether Althar can bring it. */
export interface WorkerAgent {
  readonly id: AgentId
  /** Its definition, every command it runs pointed at its program: the one found, else where Althar keeps it. */
  readonly definition: AgentDefinition
  /** Where its program is now: the person's own, a release's, Althar's; null where it isn't on the worker yet. */
  readonly located: Located | null
  /** Althar can download it for this worker. */
  readonly downloadable: boolean
  /** Its maker's page on installing it, for one Althar can't download. */
  readonly guide: string | undefined
}

/** How a worker's installs look: its own folder for what Althar downloads, the worker's PATH and the usual places for the person's. */
const layerFor = (
  folder: string,
  path: string,
  fetcher?: typeof fetch,
  usual: ReadonlyArray<string> = usualDirs('linux', homedir(), process.env),
) =>
  Installs.layer({
    root: join(folder, 'programs'),
    ...(fetcher === undefined ? {} : { fetch: fetcher }),
    platform: 'linux',
    arch: ARCH,
    musl: isMusl(),
    search: { env: { PATH: path }, dirs: usual },
  })

/** The agent's definition as `release` has it: Claude Code's and Codex's program beside its adapter where it carries one. */
const definitionIn = (release: string, id: AgentId): AgentDefinition => {
  const base = agents[id]
  if (base.cli === undefined) return base
  const inRelease = programInRelease(release, id)
  return { ...base, cli: { ...base.cli, bundled: () => inRelease } }
}

/**
 * Every agent as the worker has it, for `release` (the one its launches run from): found now, through the worker's
 * PATH (`path`) and its own folder (`folder`).
 */
export const workerAgentsIn = (
  folder: string,
  release: string,
  path: string,
  /** Where installers put commands outside the PATH: the usual places, unless said. */
  usual?: ReadonlyArray<string>,
): ReadonlyArray<WorkerAgent> =>
  Effect.runSync(
    Effect.provide(
      Effect.map(Installs, (installs) =>
        WORKER_AGENTS.map((id) => {
          const definition = definitionIn(release, id)
          const located = installs.locate(definition)
          const kept = installs.keptAt(definition)
          const name = definition.cli?.name ?? id
          // Where it isn't on the worker yet, its launch names where Althar will keep it, or its command by name, as the
          // person's own install would be found on the run's PATH.
          const find = (): Located => located ?? (kept !== null ? { command: kept, whose: 'althar' } : { command: name, whose: 'theirs' })
          const state = Effect.runSync(installs.state(definition))
          return {
            id,
            definition: usingLocated(definition, find),
            located,
            downloadable: state.downloadable,
            guide: definition.cli?.guide,
          }
        }),
      ),
      layerFor(folder, path, undefined, usual),
    ),
  )

/**
 * Brings an agent's program onto the worker: Claude Code's or Codex's adopted from a release on this computer that
 * carries the one pinned (`releases`, the release it runs first), else downloaded, checked and kept. `progress` hears
 * a download's bytes.
 */
export const bringProgram = (
  folder: string,
  path: string,
  id: AgentId,
  releases: ReadonlyArray<string>,
  progress?: Progress,
  fetcher?: typeof fetch,
): Promise<'adopted' | 'downloaded'> =>
  Effect.runPromise(
    Effect.provide(
      Effect.flatMap(Installs, (installs) =>
        Effect.gen(function* () {
          const definition = agents[id]
          for (const release of releases) {
            const found = packageInRelease(release, id)
            if (found !== undefined && existsSync(found.program) && (yield* installs.adopt(definition, found.folder)))
              return 'adopted' as const
          }
          yield* installs.install(definition, progress)
          return 'downloaded' as const
        }),
      ),
      layerFor(folder, path, fetcher),
    ),
  )

export type { InstallFailed }
