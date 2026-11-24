/*
 * A release's notes as What's new reads them: the kit's own shape for them,
 * which the site's changelog fits, and how a line is read: its name, where
 * it starts with one ("Goals: give a task's lead…"), and its first sentence.
 */

export type ChangeKind = 'new' | 'improved' | 'fixed'

export interface ReleaseChange {
  readonly kind: ChangeKind
  /** One line; `code` in backticks. */
  readonly text: string
}

export interface ReleaseNotes {
  /** As words: 0.10.0. */
  readonly version: string
  /** The day it was published, as an ISO date: 2026-11-20. */
  readonly date: string
  /** What it's about, in a few words. */
  readonly title: string
  readonly changes: readonly ReleaseChange[]
}

/** The kinds, in the order the notes give them. */
export const CHANGE_KINDS: readonly ChangeKind[] = ['new', 'improved', 'fixed']

/** A line's name, where it starts with a short one before a colon, and the rest, its first letter raised. */
export const named = (text: string): { readonly name: string | null; readonly rest: string } => {
  const at = text.indexOf(': ')
  if (at <= 0 || at > 34) return { name: null, rest: text }
  const rest = text.slice(at + 2)
  return { name: text.slice(0, at), rest: rest.charAt(0).toUpperCase() + rest.slice(1) }
}

/** A line's first sentence, past its name: what it is, in a line. */
export const firstSentence = (text: string): string => {
  const { rest } = named(text)
  const end = rest.indexOf('. ')
  return end < 0 ? rest : rest.slice(0, end + 1)
}

/** 20 November, in the window's language; the ISO date itself where it isn't one. */
export const dated = (iso: string, locale?: string): string => {
  const day = new Date(`${iso}T12:00:00Z`)
  if (Number.isNaN(day.getTime())) return iso
  return day.toLocaleDateString(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' })
}

/** Orders two versions, 0.9.0 before 0.10.0: below zero where the first is the older. Parts that aren't numbers count as 0. */
export const compareVersions = (a: string, b: string): number => {
  const parts = (version: string) => version.split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0)
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}
