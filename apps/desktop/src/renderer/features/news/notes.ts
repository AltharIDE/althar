import { type Planned, type Release, RELEASES, ROADMAP } from '@althar/site/changelog'
import { HIGHLIGHTS } from '@althar/site/highlights'
import type { IconName } from '@althar/ui'
import {
  compareVersions,
  type FeatureArtKey,
  firstSentence,
  type FollowLink,
  named,
  type RoadmapItem,
  type RoadmapPictureKey,
} from '@althar/ui/screens'

import { COMMUNITY, ISSUES, LINKEDIN, REPOSITORY, X } from '../../shared/links'

/*
 * What Althar's page reads from the release notes and the roadmap, both the
 * site's (apps/site's content, bundled as the app is built, so they are
 * there offline and at once): the release this Althar is, its lead from the
 * site's highlights, the features the app draws a tile for, what feels
 * better, every release, and what's coming, with what the app draws for each.
 */

export { RELEASES }

/** Where a feature is set up in the app. */
export type Way = 'agents'

/** How the app draws a feature it knows, on its tile: matched by how its line in the notes starts. */
interface Drawn {
  readonly starts: string
  /** Its name, where its line's own is too long to be one. */
  readonly name?: string
  readonly icon: IconName
  readonly art: FeatureArtKey
  readonly way?: { readonly label: string; readonly to: Way }
}

const DRAWN: readonly Drawn[] = [
  { starts: 'Computer use:', icon: 'viewport', art: 'computer-use' },
  { starts: 'Artifacts you talk to:', icon: 'canvas', art: 'artifacts' },
  { starts: 'Goals:', icon: 'pin', art: 'goals' },
  { starts: 'More agents:', icon: 'agents', art: 'agents', way: { label: 'Add an agent', to: 'agents' } },
  { starts: 'Terminals in Althar:', icon: 'terminal', art: 'terminals' },
  { starts: 'Bring in work from', name: 'Bring in your work', icon: 'download', art: 'bring-in' },
]

/** A release with no feature the app draws shows its first named ones, as many as a page holds; with fewer than a row of them, its lines. */
const PLAIN_FEATURES = 6
const PLAIN_ROW = 3

/** What feels better: the release's first few improvements. */
const BETTER = 4

/** The release this Althar is: its own notes, or where it has none (a build between releases), the newest before it. */
export const releaseFor = (version: string | undefined): { readonly release: Release | undefined; readonly own: boolean } => {
  if (version === undefined) return { release: RELEASES[0], own: false }
  const own = RELEASES.find((release) => compareVersions(release.version, version) === 0)
  if (own !== undefined) return { release: own, own: true }
  return { release: RELEASES.find((release) => compareVersions(release.version, version) < 0) ?? RELEASES[0], own: false }
}

/** A release's lead: the site's first highlight for it, or its title and first new line's first sentence. */
export const leadOf = (
  release: Release,
): { readonly title: string; readonly why: string; readonly picture?: string; readonly covers: readonly number[] } => {
  const highlight = HIGHLIGHTS[release.version]?.[0]
  if (highlight !== undefined) return { title: highlight.title, why: highlight.why, picture: highlight.picture, covers: highlight.covers }
  const first = release.changes.find((change) => change.kind === 'new')
  return { title: release.title, why: first === undefined ? '' : firstSentence(first.text), covers: [] }
}

/** A line read as a feature: its name and what it is. */
const featureOf = (text: string, drawn: Drawn | undefined) => {
  const at = text.indexOf(': ')
  const { name, rest } = named(text)
  const whole = drawn?.name === undefined ? rest : at < 0 ? text : `${text.charAt(at + 2).toUpperCase()}${text.slice(at + 3)}`
  return { name: drawn?.name ?? name ?? '', line: firstSentence(whole), whole }
}

export interface Feature {
  readonly name: string
  readonly line: string
  readonly whole: string
  readonly icon?: IconName
  readonly art?: FeatureArtKey
  readonly way?: { readonly label: string; readonly to: Way }
}

/** The rest of what's new, as tiles: the features the app draws, in the notes' order; where it draws none, the first named ones, a row of them at least. */
export const featuresOf = (release: Release, covers: readonly number[] = []): readonly Feature[] => {
  const lines = release.changes.filter((change, i) => change.kind === 'new' && !covers.includes(i))
  const drawn = lines.flatMap((change) => {
    const how = DRAWN.find((one) => change.text.startsWith(one.starts))
    if (how === undefined) return []
    return [{ ...featureOf(change.text, how), icon: how.icon, art: how.art, ...(how.way === undefined ? {} : { way: how.way }) }]
  })
  if (drawn.length > 0) return drawn
  const plain = lines.filter((change) => named(change.text).name !== null)
  if (plain.length < PLAIN_ROW) return []
  return plain.slice(0, PLAIN_FEATURES).map((change) => featureOf(change.text, undefined))
}

/** Where no feature is drawn or named, the rest of what's new, a line each: the first few, past what the lead covers. */
export const alsoOf = (release: Release, covers: readonly number[] = []): readonly string[] =>
  release.changes
    .filter((change, i) => change.kind === 'new' && !covers.includes(i))
    .slice(0, PLAIN_FEATURES)
    .map((change) => {
      const { name } = named(change.text)
      const first = firstSentence(change.text)
      return name === null ? first : `${name}: ${first}`
    })

/** What feels better, a line each. */
export const betterOf = (release: Release): readonly string[] =>
  release.changes
    .filter((change) => change.kind === 'improved')
    .slice(0, BETTER)
    .map((change) => firstSentence(change.text))

/** Where Althar is followed. */
export const FOLLOW: readonly FollowLink[] = [
  { kind: 'github', href: REPOSITORY, handle: 'AltharIDE/althar' },
  { kind: 'discord', href: COMMUNITY, handle: 'Althar’s server' },
  { kind: 'x', href: X, handle: '@AltharAiUS' },
  { kind: 'linkedin', href: LINKEDIN, handle: 'althar-ai' },
]

/** What the kit draws for each thing on the roadmap, by its title. */
const ROADMAP_PICTURES: Readonly<Record<string, RoadmapPictureKey>> = {
  'Mobile app': 'phone',
  'Event-based automations': 'trigger',
  'Integrated simulators': 'simulator',
  'Project knowledge store': 'knowledge',
  'Windows signing': 'installer',
  'Teams, in the cloud': 'team',
}

const STAGE_ORDER: Readonly<Record<Planned['stage'], number>> = { now: 0, next: 1, later: 2 }

/** Where to say what you'd need from a thing on the roadmap: a new issue, its name filled in. */
export const sayFor = (title: string) => `${ISSUES}/new?title=${encodeURIComponent(`${title}: `)}`

/** What's coming: what's being built first, then next, then later, each with its picture where the kit has one. */
export const roadmapOf = (planned: readonly Planned[] = ROADMAP): readonly RoadmapItem[] =>
  [...planned]
    .sort((a, b) => STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage])
    .map((one) => {
      const picture = ROADMAP_PICTURES[one.title]
      return {
        stage: one.stage,
        title: one.title,
        detail: one.detail,
        say: sayFor(one.title),
        ...(picture === undefined ? {} : { picture }),
      }
    })
