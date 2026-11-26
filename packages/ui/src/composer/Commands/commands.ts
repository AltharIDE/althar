import type { IconName } from '../../foundations/Icon/icons'

/*
 * The composer's commands: what a screen hands its composer, and what the
 * words typed so far say of them. A command is the whole message, starting
 * with its slash; a slash inside ordinary words means nothing. The screen
 * decides which there are and what each does; the composer lists them, says
 * where each stands, and does the one picked.
 */

/** One of what a command takes, listed to pick from: /goal's pause, a model. */
export interface CommandOption {
  /** What is typed for it, one word: pause, opus-5.5. */
  name: string
  /** What it is called, where that isn't its typed name: Opus 5.5. Typing finds it by this too. */
  label?: string
  /** What it does or is, quieter after it. */
  does?: string
  icon?: IconName
  /** Where it stands now, at its row's end: Current. */
  now?: string
  /** Done as it is picked. */
  run?: () => void
  /** Or its words go in the field after the command's name, to go on from: /goal's edit puts the objective there. */
  fill?: string
}

/** What a command acts on, as it stands, at the head of its panel once it is picked: the goal itself. */
export interface CommandDetail {
  title: string
  /** Where it stands, at the head's end: Active · 3 of 12 turns. */
  now?: string
  /** What it is: the objective. */
  body?: string
  /** Quieter, under it: the last progress, or what it does where it isn't set. */
  note?: string
}

export interface ComposerCommand {
  /** What is typed after the slash, one word: goal. */
  name: string
  /** What it does, in a few words. */
  does: string
  icon: IconName
  /** Where it stands now, at its row's end: Active, 48% full, Opus 5.5. */
  now?: string
  /** Why it can't be done here, said where its state would be; it is listed, and nothing is done. */
  unavailable?: string
  /** What it takes after its name, in a few words, written ahead of the caret once it is picked. Without it and its options, it is done as it is picked. */
  takes?: string
  /** What it takes, to pick from: narrowed by what is typed after its name. */
  options?: readonly CommandOption[]
  /** What it acts on, as it stands, at the head of its panel once picked. */
  detail?: CommandDetail
  /** What Enter does with the words after its name, in a few words (Set the goal), the panel's last row; null while they make nothing to do. */
  action?: (words: string) => string | null
  /** Does it, with the words after its name, trimmed: empty for one that takes nothing. */
  run: (words: string) => void
}

export type CommandState =
  | { readonly kind: 'none' }
  /** A slash and the start of a name: the commands it could be, those it starts first. */
  | { readonly kind: 'finding'; readonly query: string; readonly matches: readonly ComposerCommand[] }
  /** A name none of them has: what is written goes as words. */
  | { readonly kind: 'unknown' }
  | {
      readonly kind: 'picked'
      readonly command: ComposerCommand
      /** The words after its name, as typed. */
      readonly words: string
      /** What it takes that the words could still be. */
      readonly options: readonly CommandOption[]
      /** The option the words are, whole. */
      readonly exact: CommandOption | null
      /** What Enter does with the words, where they make something to do. */
      readonly action: string | null
    }

const TYPED = /^\/(\S*)(\s?)([\s\S]*)$/

/** What the words in the composer say of its commands. */
export const commandState = (value: string, commands: readonly ComposerCommand[]): CommandState => {
  const typed = TYPED.exec(value)
  if (typed === null || commands.length === 0) return { kind: 'none' }
  const name = (typed[1] ?? '').toLowerCase()
  const words = typed[3] ?? ''
  if (typed[2] === '') {
    const starts = commands.filter((one) => one.name.startsWith(name))
    const within = commands.filter(
      (one) => !one.name.startsWith(name) && name !== '' && (one.name.includes(name) || one.does.toLowerCase().includes(name)),
    )
    const matches = [...starts, ...within]
    return matches.length === 0 ? { kind: 'unknown' } : { kind: 'finding', query: name, matches }
  }
  const command = commands.find((one) => one.name === name)
  if (command === undefined) return { kind: 'unknown' }
  const asked = words.trim().toLowerCase()
  const all = command.options ?? []
  const options =
    asked === '' ? all : all.filter((one) => one.name.startsWith(asked) || (one.label?.toLowerCase().includes(asked) ?? false))
  const exact = all.find((one) => one.name === asked) ?? null
  // One that takes nothing does what it says; one that takes something, what its words make of it.
  const action = command.action?.(words.trim()) ?? (doneAsPicked(command) ? command.does : null)
  return { kind: 'picked', command, words, options, exact, action: command.unavailable === undefined ? action : null }
}

/** Whether a command is done the moment it is picked: it takes nothing. */
export const doneAsPicked = (command: ComposerCommand) => command.takes === undefined && (command.options ?? []).length === 0
