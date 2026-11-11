import { BUILT_IN, type Preset, type PresetParts } from './runtime'

/*
 * When the coordinator offers to keep parts as a preset: today's rule, as
 * `offerPreset` has it, and the rules proposed, side by side, on the same
 * setups. Each setup is a plan that started, newest last, with who set its
 * parts.
 */

/** Who set a plan's parts: the coordinator's plan taken as it was, the person's correction of it, or the person by hand. */
export type By = 'coordinator' | 'corrected' | 'person'

export interface Setup {
  readonly title: string
  readonly parts: PresetParts
  readonly by: By
  /** What the person changed, on a corrected plan. */
  readonly changed?: string
}

export type Verdict =
  | { readonly kind: 'none'; readonly why: string }
  | { readonly kind: 'offer'; readonly name: string; readonly parts: PresetParts; readonly why: string }
  | { readonly kind: 'near'; readonly preset: Preset; readonly differs: string; readonly parts: PresetParts; readonly why: string }

/** As `offerPreset`'s private `alike`: where it works, how it's checked and ends, where it sits, its kind; leads alike where both are named. */
const alike = (a: PresetParts, b: PresetParts) =>
  a.workspace === b.workspace &&
  a.checked === b.checked &&
  a.end === b.end &&
  a.shelf === b.shelf &&
  (a.reviews ?? false) === (b.reviews ?? false) &&
  (a.lead === null || b.lead === null || a.lead === b.lead)

const leadName = (lead: string | null) => lead?.split('/').at(-1) ?? 'My'

/** Today: the last two plans alike, the same lead, no preset of the person's alike; named from the lead and a key. */
export function today(setups: ReadonlyArray<Setup>): Verdict {
  const [b, a] = setups.slice(-2)
  if (a === undefined || b === undefined) return { kind: 'none', why: 'Fewer than two plans.' }
  if (!alike(a.parts, b.parts) || a.parts.lead === null || a.parts.lead !== b.parts.lead)
    return { kind: 'none', why: 'The last two plans differ.' }
  const p = a.parts
  const name = `${leadName(p.lead)} ${p.workspace === 'local' ? 'Local ' : ''}${p.checked === 'none' ? 'unchecked' : 'change'}`
  return { kind: 'offer', name, parts: p, why: 'The last two plans are alike, whoever set them up.' }
}

/** Parts in words, as Settings › Presets names them. */
export const words = {
  workspace: { copy: 'A copy', worktree: 'A worktree', local: 'Local' },
  checked: { before: 'Before it ships', after: 'After it merges', none: 'Nobody' },
  end: { draft: 'Draft pull request', ready: 'Ready for review', none: 'On its branch' },
} as const

/** A name in plain words: how it differs from Change, the plain task, two things at most. */
export function plainName(p: PresetParts): string {
  const said = [
    p.workspace === 'local' ? 'Local' : p.workspace === 'copy' ? 'In a copy' : null,
    p.checked === 'none' ? 'no review' : p.checked === 'after' ? 'reviewed after merge' : null,
    p.end === 'ready' ? 'ready PR' : p.end === 'none' ? 'no PR' : null,
  ].filter((one): one is string => one !== null)
  const name = said.slice(0, 2).join(', ')
  return name === '' ? 'My change' : name.charAt(0).toUpperCase() + name.slice(1)
}

/** What differs between a built-in preset and parts, in words; null where more than one thing does. */
function nearly(preset: Preset, p: PresetParts): string | null {
  const q = preset.parts
  if (q.workspace !== p.workspace || q.shelf !== p.shelf || (q.reviews ?? false) !== (p.reviews ?? false)) return null
  const differs = [
    q.checked === p.checked
      ? null
      : p.checked === 'none'
        ? 'without its review after merge'
        : `reviewed ${words.checked[p.checked].toLowerCase()}`,
    q.end === p.end ? null : `ending in a ${words.end[p.end].toLowerCase()}`,
  ].filter((one): one is string => one !== null)
  return differs.length <= 1 ? (differs[0] ?? 'as it is') : null
}

/** How many of the person's own setups, among their last few, must be alike before it offers. */
export const TIMES = 3
const WINDOW = 6

/**
 * Proposed: only setups the person made themselves count, three alike among
 * their last six; parts one step from a built-in preset say so instead of
 * offering a new one; a name in plain words; once per set of parts.
 */
export function proposed(setups: ReadonlyArray<Setup>, own: ReadonlyArray<Preset> = []): Verdict {
  const last = setups.at(-1)
  if (last === undefined) return { kind: 'none', why: 'Nothing planned yet.' }
  if (last.by !== 'person')
    return {
      kind: 'none',
      why:
        last.by === 'corrected'
          ? 'You corrected the coordinator’s plan. That teaches the coordinator; it isn’t a setup of yours.'
          : 'The coordinator set these parts up, not you.',
    }
  const mine = setups.filter((one) => one.by === 'person').slice(-WINDOW)
  const times = mine.filter((one) => alike(one.parts, last.parts) && one.parts.lead === last.parts.lead).length
  if (times < TIMES)
    return { kind: 'none', why: `You set these parts up ${times === 1 ? 'once' : `${times} times`}; it waits for ${TIMES}.` }
  if (own.some((one) => alike(one.parts, last.parts))) return { kind: 'none', why: 'A preset of yours has these parts.' }
  for (const preset of BUILT_IN) {
    const differs = nearly(preset, last.parts)
    if (differs !== null)
      return {
        kind: 'near',
        preset,
        differs,
        parts: last.parts,
        why: `One step from ${preset.name}: it says so, and offers no new preset.`,
      }
  }
  return {
    kind: 'offer',
    name: plainName(last.parts),
    parts: last.parts,
    why: `You set these parts up ${times} times, and no preset has them.`,
  }
}
