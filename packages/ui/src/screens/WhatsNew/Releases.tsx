import { Fragment } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { safeHref } from '../../lib/safeHref'
import { Code } from '../../primitives/Code/Code'
import { Caret, Disclosure, DisclosureTrigger, Fold } from '../../primitives/Fold/Fold'
import { Heading } from '../../primitives/Heading/Heading'
import { CHANGE_KINDS, type ChangeKind, compareVersions, dated, named, type ReleaseNotes } from './notes'
import s from './Releases.module.css'

/*
 * Every release, each a row that opens its notes in place: this one first,
 * then the ones before, those new to the person said so, and the rest of the
 * changelog on the site.
 */

export interface ReleasesText {
  title: string
  kinds: Record<ChangeKind, string>
  /** A release the person hadn't had: new since the one they updated from. */
  newSince: (version: string) => string
  /** The rest, on the site. */
  earlier: (version: string) => string
}

export const releasesText: ReleasesText = {
  title: 'Every change, and before',
  kinds: { new: 'New', improved: 'Improved', fixed: 'Fixed' },
  newSince: (version) => `New since ${version}`,
  earlier: (version) => `${version} and earlier`,
}

/** A line's words, its `code` set as code. */
export function Words({ text }: { text: string }) {
  return text
    .split(/(`[^`]+`)/)
    .map((part, i) =>
      part.startsWith('`') && part.endsWith('`') && part.length > 2 ? (
        <Code key={i}>{part.slice(1, -1)}</Code>
      ) : (
        <Fragment key={i}>{part}</Fragment>
      ),
    )
}

/** A line of the notes: its name first where it has one, then what it does. */
function Line({ text }: { text: string }) {
  const { name, rest } = named(text)
  return (
    <li>
      {name !== null && <b className={s.lineName}>{name}. </b>}
      <Words text={name === null ? text : rest} />
    </li>
  )
}

/** A release, whole: what's new, improved and fixed. */
function Notes({ release, kinds }: { release: ReleaseNotes; kinds: ReleasesText['kinds'] }) {
  return (
    <div className={s.notes}>
      {CHANGE_KINDS.map((kind) => {
        const lines = release.changes.filter((change) => change.kind === kind)
        if (lines.length === 0) return null
        return (
          <section key={kind}>
            <Heading level={4} className={s.partTitle}>
              {kinds[kind]}
            </Heading>
            <ul className={s.lines}>
              {lines.map((line) => (
                <Line key={line.text} text={line.text} />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

/** A release as a row, opening its notes in place. */
function ReleaseRow({ release, note, kinds }: { release: ReleaseNotes; note: string; kinds: ReleasesText['kinds'] }) {
  return (
    <Disclosure className={s.release}>
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
          <Notes release={release} kinds={kinds} />
        </div>
      </Fold>
    </Disclosure>
  )
}

export interface ReleasesProps {
  /** Newest first, this one first of all. */
  releases: readonly ReleaseNotes[]
  /** The version the person updated from: the releases after it are new to them. */
  from?: string
  /** The changelog on the site, for the releases not listed. */
  more?: string
  /** The release after which the site has the rest. */
  moreFrom?: string
  text?: Partial<ReleasesText>
  className?: string
}

export function Releases({ releases, from, more, moreFrom, text, className }: ReleasesProps) {
  const t = { ...releasesText, ...text }
  const [now, ...before] = releases
  const href = safeHref(more)
  if (now === undefined) return null
  return (
    <section className={cx(s.releases, className)} aria-labelledby="releases-title">
      <Heading level={2} id="releases-title" className={s.releasesTitle}>
        {t.title}
      </Heading>
      <ReleaseRow release={now} note={dated(now.date)} kinds={t.kinds} />
      {before.map((release) => (
        <ReleaseRow
          key={release.version}
          release={release}
          note={from !== undefined && compareVersions(release.version, from) > 0 ? t.newSince(from) : dated(release.date)}
          kinds={t.kinds}
        />
      ))}
      {href !== undefined && moreFrom !== undefined && (
        <a className={s.out} href={href} target="_blank" rel="noreferrer">
          {t.earlier(moreFrom)}
          <Icon name="external" size={11} />
        </a>
      )}
    </section>
  )
}
