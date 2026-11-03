import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/*
 * The person's own skills, passed through rather than managed: each agent
 * finds them where it always does, and Althar only says what it saw (DEV-188).
 * What each said was read from the real agents on 3 November 2026: Claude Code
 * through claude-agent-acp 0.100.0, Codex 0.165.0 through codex-acp 2.5.0, and
 * OpenCode 1.19.5 and 2.2.5. Read them again after upgrading any
 * (`tests/agents/skills.test.ts`, no model call).
 *
 * Both adapters read Althar as a JetBrains AIR client (`terminalOutputCapability`
 * says why), and tell an AIR client each skill's `SKILL.md` among its commands,
 * and Claude Code which one a call loads. OpenCode's ACP lists skills as plain
 * commands (1.x) or not at all (2.x), so what it can see is read from the
 * folders it reads (`skillFolders` in the registry).
 *
 * A load: Claude Code's `Skill` tool and OpenCode's `skill` tool say which.
 * Codex has no such thing: its model reads the file, by a read or a shell
 * command, and a `$name` the person typed reaches it without either. So a read
 * of a `SKILL.md` it listed is all there is to show of it (`threads.ts`).
 */

/** A skill an agent could see, by the name it goes by and its `SKILL.md`. */
export interface SeenSkill {
  readonly name: string
  readonly path: string
}

const fieldsOf = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : undefined

const airOf = (meta: unknown) => fieldsOf(fieldsOf(fieldsOf(meta)?.jetbrains)?.air)

/** Codex's own, which it unpacks into its home: not the person's, nor the repository's. */
const AGENTS_OWN = /[/\\]skills[/\\]\.system[/\\]/

/**
 * The skills among an agent's commands, where it says which are: the name
 * without Codex's `$`. Undefined where none says so, as for an agent that
 * doesn't, whose commands say nothing of what it could see.
 */
export const skillsAmong = (
  commands: ReadonlyArray<{ readonly name: string; readonly _meta?: unknown }>,
): ReadonlyArray<SeenSkill> | undefined => {
  const seen = commands.flatMap((command) => {
    const path = airOf(command._meta)?.skillPath
    return typeof path === 'string' ? [{ name: command.name.replace(/^\$/, ''), path }] : []
  })
  return seen.length === 0 ? undefined : seen.filter((skill) => !AGENTS_OWN.test(skill.path))
}

/** The skill a tool call says it loads: Claude Code's by its `_meta`; OpenCode's by its title, `name` in 1.x and `id` in 2.x. */
export const skillLoadedBy = (update: {
  readonly title?: string | null | undefined
  readonly rawInput?: unknown
  readonly _meta?: unknown
}): string | undefined => {
  const named = fieldsOf(airOf(update._meta)?.skill)?.name
  if (typeof named === 'string' && named !== '') return named
  if (update.title?.startsWith('Loaded skill: ') === true) return update.title.slice('Loaded skill: '.length)
  if (update.title !== 'skill') return undefined
  const input = fieldsOf(update.rawInput)
  const name = input?.name ?? input?.id
  return typeof name === 'string' && name !== '' ? name : undefined
}

/** The name in a `SKILL.md`'s frontmatter, which an agent loads a skill by; without one, it loads none. */
const nameIn = (skill: string): string | undefined => {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skill)?.[1]
  const name = frontmatter === undefined ? undefined : /^name:[ \t]*(.+?)[ \t]*$/m.exec(frontmatter)?.[1]?.replace(/^(["'])(.*)\1$/, '$2')
  return name === '' ? undefined : name
}

/** The skills in these folders, each a folder with a `SKILL.md` in it: the first of a name, as folders may repeat one. */
export const skillsIn = (folders: ReadonlyArray<string>): ReadonlyArray<SeenSkill> => {
  const found = new Map<string, SeenSkill>()
  for (const folder of folders) {
    let names: ReadonlyArray<string>
    try {
      names = readdirSync(folder)
    } catch {
      continue
    }
    for (const entry of names) {
      const path = join(folder, entry, 'SKILL.md')
      try {
        const name = nameIn(readFileSync(path, 'utf8'))
        if (name !== undefined && !found.has(name)) found.set(name, { name, path })
      } catch {
        // Not a skill: a file, or a folder with none in it.
      }
    }
  }
  return [...found.values()]
}
