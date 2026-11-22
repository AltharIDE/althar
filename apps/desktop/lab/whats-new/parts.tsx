import { Fragment, type ReactNode } from 'react'

import { Caret, Code, Disclosure, DisclosureTrigger, Fold, Heading, Icon, LinkButton } from '@althar/ui'

import { showHomes } from '../../src/renderer/features/homes/useHomes'
import { CHANGELOG } from '../../src/renderer/shared/links'
import { go } from './go'
import { byKind, dated, FLAGSHIP, fromVersion, type Kind, named, newTo, NOW, type Release, RELEASES, type Way } from './notes'
import { useLab } from './state'
import s from './parts.module.css'

/*
 * What every look of What's new shares: a line's words, a release's notes
 * whole, the way into a feature, the fold with every change, and the
 * releases before, each opening in place. On the kit's tokens, so a look
 * that sets them dark (the flight log) has them dark too.
 */

const KIND_TITLE: Record<Kind, string> = { new: 'New', improved: 'Improved', fixed: 'Fixed' }

/** A line's words, its `code` set as code. */
export function Words({ text }: { text: string }) {
  return text
    .split(/(`[^`]+`)/)
    .map((part, i) =>
      part.startsWith('`') && part.endsWith('`') ? <Code key={i}>{part.slice(1, -1)}</Code> : <Fragment key={i}>{part}</Fragment>,
    )
}

/** A line of the notes: its name first where it has one, then what it does. */
function Line({ text }: { text: string }) {
  const { name, rest } = named(text)
  return (
    <li className={s.line}>
      {name !== null && <b className={s.lineName}>{name}. </b>}
      <Words text={name === null ? text : rest} />
    </li>
  )
}

export function Lines({ lines }: { lines: readonly { text: string }[] }) {
  return (
    <ul className={s.lines}>
      {lines.map((line) => (
        <Line key={line.text} text={line.text} />
      ))}
    </ul>
  )
}

/** Where a feature is set up or tried, in the app. */
export const open = (to: Way) => {
  if (to === 'homes') return showHomes()
  if (to === 'workers') return go.settings('this-mac')
  if (to === 'agents') return go.settings('agents')
}

/** A release, whole: its flagship where it has one, then what's new, improved and fixed. */
export function ReleaseNotes({ release }: { release: Release }) {
  return (
    <div className={s.notes}>
      {release === NOW && (
        <section className={s.part}>
          <Heading level={4} className={s.partTitle}>
            {FLAGSHIP.title}
          </Heading>
          <Lines lines={FLAGSHIP.lines} />
        </section>
      )}
      {(['new', 'improved', 'fixed'] as const).map((kind) => {
        const lines = byKind(release, kind)
        if (lines.length === 0) return null
        return (
          <section key={kind} className={s.part}>
            <Heading level={4} className={s.partTitle}>
              {release === NOW && kind === 'new' ? 'Also new' : KIND_TITLE[kind]}
            </Heading>
            <Lines lines={lines} />
          </section>
        )
      })}
    </div>
  )
}

/** A way into a feature. */
export function WayIn({ way, className }: { way: { label: string; to: Way } | undefined; className?: string }) {
  if (way === undefined) return null
  return (
    <LinkButton className={className} onClick={() => open(way.to)}>
      {way.label}
    </LinkButton>
  )
}

/** A release as a row, opening its notes in place. */
function ReleaseRow({ release, note, open: startOpen = false }: { release: Release; note: string; open?: boolean }) {
  return (
    <Disclosure className={s.release} defaultOpen={startOpen}>
      <DisclosureTrigger>
        <button type="button" className={s.releaseRow}>
          <span className={s.releaseVersion}>{release.version}</span>
          <span className={s.releaseTitle}>{release.title}</span>
          <span className={s.releaseWhen}>{note}</span>
          <Caret />
        </button>
      </DisclosureTrigger>
      <Fold bleed={false}>
        <div className={s.releaseNotes}>
          <ReleaseNotes release={release} />
        </div>
      </Fold>
    </Disclosure>
  )
}

/**
 * The foot every look ends on: every change in this release a fold away,
 * then the releases before, the ones new to the person first, and the
 * changelog on the site for the rest.
 */
export function Releases({ title = 'Every change, and before', className }: { title?: ReactNode; className?: string }) {
  const { skipped } = useLab()
  const fresh = newTo(skipped)
  const earlier = RELEASES.slice(1, 6)
  return (
    <section className={className === undefined ? s.releases : `${s.releases} ${className}`} aria-label="Releases">
      <Heading level={2} className={s.releasesTitle}>
        {title}
      </Heading>
      <ReleaseRow release={NOW} note={dated(NOW.date)} />
      {earlier.map((release) => (
        <ReleaseRow
          key={release.version}
          release={release}
          note={fresh.includes(release) ? `New since ${fromVersion(skipped)}` : dated(release.date)}
        />
      ))}
      <a className={s.out} href={CHANGELOG} target="_blank" rel="noreferrer">
        {RELEASES[6]?.version} and earlier
        <Icon name="external" size={11} />
      </a>
    </section>
  )
}

export { ReleaseRow }
