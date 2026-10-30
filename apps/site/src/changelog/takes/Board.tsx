import {
  Board as Lanes,
  BoardColumn,
  BoardDivider,
  type BoardFolds,
  BoardLane,
  BoardList,
  Brand,
  type CodeHost,
  Icon,
  ProjectTabs,
  PullChip,
  projectInk,
} from '@althar/ui'
import { Fragment, type ReactNode, useId, useState } from 'react'

import {
  type Change,
  KIND_WORD,
  type Kind,
  ON_MAIN,
  type Merged,
  pullUrl,
  RELEASES,
  type Release,
  releaseUrl,
  ROADMAP,
  STAGE_WORD,
  type Stage,
} from '../../content/changelog'
import { LINKS } from '../../content/facts'
import { cx } from '../../lib/cx'
import { useDownload } from '../../lib/download'
import { LightUnder } from '../../shared/lightUnder'
import s from './Board.module.css'

/*
 * The changelog as Althar shows its own work: the app open on a project
 * called Althar, its board on the desk. Up next is the roadmap, Running is
 * what has merged on main for the next release, and Settled is the releases,
 * newest first, each opening in place to what it changed. The board is the
 * app's own, so it folds as the app does: where the lanes don't fit, they
 * fold to rails, and opening one folds the others.
 */

const GITHUB: CodeHost = { name: 'GitHub', brand: Brand.GitHub }
const PLANS = `${LINKS.repo}/tree/main/docs/plans`
const MERGED = `${LINKS.repo}/pulls?q=is%3Apr+is%3Amerged`

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** An ISO date as the board says it: 20 Oct. */
const day = (iso: string) => {
  const [, m = '1', d = '1'] = iso.split('-')
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? ''}`
}

/** A line of the release notes, with `code` set as code. */
const said = (text: string): ReactNode =>
  text.split('`').map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : <Fragment key={i}>{part}</Fragment>))

/** Items grouped by a key, in the order the keys first appear. */
function grouped<T, K>(items: readonly T[], key: (item: T) => K): [K, T[]][] {
  const groups = new Map<K, T[]>()
  for (const item of items) {
    const k = key(item)
    groups.set(k, [...(groups.get(k) ?? []), item])
  }
  return [...groups]
}

const KINDS: readonly Kind[] = ['new', 'improved', 'fixed']
const STAGES: readonly Stage[] = ['now', 'next', 'later']
const LATEST = RELEASES[0]

/* ---- the bar: Althar's tabs, the home's and this project's, and at its end the line the app shows when an update is ready ---- */

function Ready() {
  const download = useDownload()
  if (!LATEST) return null
  return (
    <p className={s.ready}>
      <span className={s.readyWhat}>
        Althar <span className={s.readyVersion}>{LATEST.version}</span> is ready
      </span>
      <a href={download.href} className={s.readyGo} aria-label={download.label}>
        Download
      </a>
    </p>
  )
}

const TABS = [{ id: 'althar', name: 'Althar', seed: 'althar', ink: projectInk('althar'), running: true, yours: 0 }]

function Bar() {
  return (
    <ProjectTabs
      className={s.bar}
      tabs={TABS}
      current="althar"
      onSelect={(id) => {
        if (id === null) window.location.assign('/')
      }}
      onClose={() => {}}
      lights="space"
      end={<Ready />}
    />
  )
}

/* ---- Up next: the roadmap, by stage ---- */

function Planned() {
  return (
    <>
      {STAGES.map((stage) => {
        const items = ROADMAP.filter((one) => one.stage === stage)
        if (items.length === 0) return null
        return (
          <Fragment key={stage}>
            <BoardDivider>{STAGE_WORD[stage]}</BoardDivider>
            <BoardList>
              {items.map((one) => (
                <article key={one.title} className={cx(s.plan, stage === 'now' && s.now)}>
                  <h3 className={s.planTitle}>{one.title}</h3>
                  <p className={s.planDetail}>{one.detail}</p>
                </article>
              ))}
            </BoardList>
          </Fragment>
        )
      })}
      <p className={s.laneFoot}>
        A draft, from{' '}
        <a href={PLANS}>
          the plans <Icon name="external" size={10} />
        </a>
      </p>
    </>
  )
}

/* ---- Running: what has merged on main since the last release, by day ---- */

function PullCard({ pull }: { pull: Merged }) {
  return (
    <a className={s.pull} href={pullUrl(pull.pr)}>
      <h3 className={s.pullTitle}>{pull.text}</h3>
      <PullChip host={GITHUB} repo="althar" number={pull.pr} className={s.chip} />
    </a>
  )
}

function OnMain() {
  return (
    <>
      <p className={s.laneLead}>Merged since {LATEST?.version}, for the next release.</p>
      {grouped(ON_MAIN, (one) => one.date).map(([date, pulls]) => (
        <Fragment key={date}>
          <BoardDivider>{day(date)}</BoardDivider>
          {pulls.map((pull) => (
            <PullCard key={pull.pr} pull={pull} />
          ))}
        </Fragment>
      ))}
      <p className={s.laneFoot}>
        <a href={MERGED}>
          Everything merged <Icon name="external" size={10} />
        </a>
      </p>
    </>
  )
}

/* ---- Settled: the releases, each opening in place to what it changed ---- */

function Changes({ changes }: { changes: readonly Change[] }) {
  return (
    <>
      {KINDS.map((kind) => {
        const these = changes.filter((one) => one.kind === kind)
        if (these.length === 0) return null
        return (
          <section key={kind} className={cx(s.group, s[kind])}>
            <h4 className={s.kind}>{KIND_WORD[kind]}</h4>
            <ul className={s.list}>
              {these.map((one) => (
                <li key={one.text}>{said(one.text)}</li>
              ))}
            </ul>
          </section>
        )
      })}
    </>
  )
}

function ReleaseCard({ release, open, onToggle }: { release: Release; open: boolean; onToggle: () => void }) {
  const body = useId()
  const latest = release === LATEST
  const download = useDownload()
  return (
    <article className={cx(s.release, open && s.open)} aria-current={open || undefined}>
      <h3 className={s.releaseHead}>
        <button type="button" className={s.toggle} aria-expanded={open} aria-controls={body} onClick={onToggle}>
          <span className={s.releaseTop}>
            <span className={s.version}>
              <Icon name="check" size={11} />
              {release.version}
            </span>
            {latest && <span className={s.latest}>Latest</span>}
            <span className={s.at}>{day(release.date)}</span>
          </span>
          <span className={s.releaseTitle}>{release.title}</span>
          <Icon name="chevronD" size={12} className={s.chevron} />
        </button>
      </h3>
      <div id={body} className={s.body} inert={!open}>
        <div className={s.bodyInner}>
          <Changes changes={release.changes} />
          <p className={s.releaseLinks}>
            <a href={releaseUrl(release.version)}>
              Release on GitHub <Icon name="external" size={10} />
            </a>
            {latest && (
              <a href={download.href} className={s.get}>
                <Icon name="download" size={12} />
                {download.label}
              </a>
            )}
          </p>
        </div>
      </div>
    </article>
  )
}

function Releases() {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(LATEST ? [LATEST.version] : []))
  const toggle = (version: string) =>
    setOpen((was) => {
      const next = new Set(was)
      if (next.has(version)) next.delete(version)
      else next.add(version)
      return next
    })
  return (
    <>
      {RELEASES.map((release) => (
        <ReleaseCard key={release.version} release={release} open={open.has(release.version)} onToggle={() => toggle(release.version)} />
      ))}
      <p className={s.laneFoot}>
        <a href={LINKS.releases}>
          Every release on GitHub <Icon name="external" size={10} />
        </a>
      </p>
    </>
  )
}

/* ---- the page ---- */

/** Settled stays open where the lanes don't all fit; opening another lane from its rail folds the rest, so one reads at a time. */
const FIRST_FOLDS: BoardFolds = { collapsed: [], opened: [BoardLane.Settled] }

export function Board() {
  const [folds, setFolds] = useState<BoardFolds>(FIRST_FOLDS)
  return (
    <main id="main" tabIndex={-1} className={s.page}>
      <div className={s.desk}>
        <LightUnder tone="ink" className={s.under} />
        <h1 className={s.hidden}>Changelog</h1>
        <div className={cx(s.window, 'ch-root')}>
          <Bar />
          <Lanes
            label="Althar’s changelog"
            className={s.board}
            folds={folds}
            onFoldsChange={(next) => setFolds({ collapsed: next.collapsed, opened: next.opened.slice(-1) })}
          >
            <BoardColumn lane={BoardLane.Next} count={ROADMAP.length}>
              <Planned />
            </BoardColumn>
            <BoardColumn lane={BoardLane.Running} count={ON_MAIN.length}>
              <OnMain />
            </BoardColumn>
            <BoardColumn lane={BoardLane.Settled} count={RELEASES.length}>
              <Releases />
            </BoardColumn>
          </Lanes>
        </div>
      </div>
    </main>
  )
}
