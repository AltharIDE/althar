import { type Change, type Kind, type Release, RELEASES, ROADMAP } from './changelog'

/*
 * The release notes as the directions read them: the releases new to the
 * person (0.10.0, and 0.9.0 too where they came from 0.8.0), 0.10.0's
 * flagship (its first lines, the host and the workers) apart from the rest,
 * and the few highlights B leads with, each with the way into it where the
 * app has one.
 */

export { ROADMAP, RELEASES }
export type { Change, Kind, Release }

export const NOW = RELEASES[0]!

/** The releases the person hasn't had: 0.10.0, or 0.10.0 and 0.9.0 where they updated from 0.8.0. */
export const newTo = (skipped: boolean): readonly Release[] => RELEASES.slice(0, skipped ? 2 : 1)

/** The version they had. */
export const fromVersion = (skipped: boolean) => (skipped ? '0.8.0' : '0.9.0')

/** 0.10.0's lead, in the entry's own words: the host and the workers, its first thirteen lines. */
export const FLAGSHIP = { title: 'Your own host, your own workers', lines: NOW.changes.slice(0, 13) }

/** A release's lines, by kind, without the flagship's where it has one. */
export const byKind = (release: Release, kind: Kind, withFlagship = false): readonly Change[] => {
  const lines = release === NOW && !withFlagship ? release.changes.slice(FLAGSHIP.lines.length) : release.changes
  return lines.filter((line) => line.kind === kind)
}

/** A line's name, where it starts with one ("Goals: give a task's lead…"), and the rest. */
export const named = (text: string): { name: string | null; rest: string } => {
  const at = text.indexOf(': ')
  if (at < 0 || at > 34) return { name: null, rest: text }
  const rest = text.slice(at + 2)
  return { name: text.slice(0, at), rest: rest.charAt(0).toUpperCase() + rest.slice(1) }
}

/** 20 November. */
export const dated = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })

/** Where a highlight goes in the app. */
export type Way = 'homes' | 'workers' | 'agents' | 'layout' | 'dictation'

export interface Highlight {
  readonly name: string
  /** What it is, in a line: its release line, cut to its first sentence. */
  readonly line: string
  readonly way?: { readonly label: string; readonly to: Way }
}

const first = (text: string) => {
  const { rest } = named(text)
  const end = rest.indexOf('. ')
  return end < 0 ? rest : rest.slice(0, end + 1)
}

const lineOf = (start: string) => NOW.changes.find((change) => change.text.startsWith(start))?.text ?? start

/** What B leads with after the flagship: the new things a person would go and try, in the release's order. */
export const HIGHLIGHTS: readonly Highlight[] = [
  { name: 'Computer use', line: first(lineOf('Computer use')) },
  { name: 'Artifacts you talk to', line: first(lineOf('Artifacts you talk to')) },
  { name: 'Goals', line: first(lineOf('Goals')) },
  { name: 'More agents', line: first(lineOf('More agents')), way: { label: 'Add an agent', to: 'agents' } },
  { name: 'Terminals in Althar', line: first(lineOf('Terminals in Althar')) },
  { name: 'Bring in your work', line: first(lineOf('Bring in work from')) },
]

/** The flagship's few lines B shows, each its own line's first sentence. */
export const FLAGSHIP_BRIEF = [
  { name: 'A home on your server', line: first(lineOf('Your own host')), way: { label: 'Connect a home', to: 'homes' as const } },
  { name: 'Workers of your own', line: first(lineOf('Your own workers')), way: { label: 'Add a worker', to: 'workers' as const } },
  { name: 'Best available worker', line: first(lineOf('Choose a worker')) },
]

/** How many lines 0.10.0 has beyond what B and C lead with. */
export const restCount = (release: Release) => release.changes.length

/** The roadmap's stages, in D's lanes. */
export const STAGE_TITLE = { now: 'Now', next: 'Next', later: 'Later' } as const
