import { Fragment, type ReactNode, useEffect } from 'react'

import {
  BackCrumb,
  Button,
  Caret,
  Code,
  Disclosure,
  DisclosureTrigger,
  Fold,
  Heading,
  Icon,
  LinkButton,
  Logo,
  TaskHeader,
  TaskStatus,
  TitleBar,
} from '@althar/ui'

import { showHomes } from '../../src/renderer/features/homes/useHomes'
import { CHANGELOG } from '../../src/renderer/shared/links'
import { go } from './go'
import {
  byKind,
  dated,
  FLAGSHIP,
  FLAGSHIP_BRIEF,
  fromVersion,
  HIGHLIGHTS,
  type Kind,
  named,
  newTo,
  NOW,
  type Release,
  RELEASES,
  ROADMAP,
  STAGE_TITLE,
  type Way,
} from './notes'
import { lab, useLab, type View } from './state'
import s from './whatsNew.module.css'

/*
 * What's new, as each direction reads it: A's notes, whole, as the release
 * wrote them; B's highlights, the flagship and the things to try, each with
 * the way into it, and the rest a fold away; C's notes in the home's place;
 * D's page of Althar's own, a tab like a project's with its bar, its views
 * What's new (every release, the ones new to you open) and Coming next (the
 * roadmap, in lanes as the board has them).
 */

const KIND_TITLE: Record<Kind, string> = { new: 'New', improved: 'Improved', fixed: 'Fixed' }

/** A line's words, its `code` set as code. */
function Words({ text }: { text: string }) {
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

function Lines({ lines }: { lines: readonly { text: string }[] }) {
  return (
    <ul className={s.lines}>
      {lines.map((line) => (
        <Line key={line.text} text={line.text} />
      ))}
    </ul>
  )
}

/** Where a highlight goes: the place in the app it is set up or tried. */
const open = (to: Way) => {
  if (to === 'homes') return showHomes()
  if (to === 'workers') return go.settings('this-mac')
  if (to === 'agents') return go.settings('agents')
}

/** A release, whole: its flagship where it has one, then what's new, improved and fixed. */
function ReleaseNotes({ release, level = 2 }: { release: Release; level?: 2 | 3 }) {
  const sub = level === 2 ? 3 : 4
  return (
    <>
      {release === NOW && (
        <section className={s.part}>
          <Heading level={sub} className={s.partTitle}>
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
            <Heading level={sub} className={s.partTitle}>
              {release === NOW && kind === 'new' ? 'Also new' : KIND_TITLE[kind]}
            </Heading>
            <Lines lines={lines} />
          </section>
        )
      })}
    </>
  )
}

/** The head of a release: its version and date, then its title. */
function ReleaseHead({ release, level = 1 }: { release: Release; level?: 1 | 2 }) {
  return (
    <header className={s.head}>
      <p className={s.eyebrow}>
        <span>Althar {release.version}</span>
        <span>{dated(release.date)}</span>
      </p>
      <Heading level={level} className={level === 1 ? s.title : s.titleTwo}>
        {release.title}
      </Heading>
    </header>
  )
}

/** The foot of the notes: where the earlier releases are. */
function Earlier({ after }: { after: Release }) {
  const older = RELEASES[RELEASES.indexOf(after) + 1]
  if (older === undefined) return null
  return (
    <footer className={s.foot}>
      <span>{older.version} and earlier</span>
      <a className={s.out} href={CHANGELOG} target="_blank" rel="noreferrer">
        Changelog
        <Icon name="external" size={11} />
      </a>
    </footer>
  )
}

/** A: the notes, whole, for every release new to you. */
export function Notes({ back }: { back?: ReactNode }) {
  const { skipped } = useLab()
  const releases = newTo(skipped)
  return (
    <div className={s.page}>
      <article className={s.column}>
        {back}
        {releases.map((release, i) => (
          <section key={release.version} className={i === 0 ? undefined : s.next}>
            <ReleaseHead release={release} level={i === 0 ? 1 : 2} />
            <ReleaseNotes release={release} />
          </section>
        ))}
        <Earlier after={releases.at(-1) ?? NOW} />
      </article>
    </div>
  )
}

/** A way into something, at the end of its row. */
function WayIn({ way }: { way: { label: string; to: Way } | undefined }) {
  if (way === undefined) return null
  return (
    <LinkButton className={s.way} onClick={() => open(way.to)}>
      {way.label}
    </LinkButton>
  )
}

/** B: the flagship and the things to try first, the rest a fold away. */
export function Highlights({ back }: { back?: ReactNode }) {
  const { skipped } = useLab()
  const earlier = newTo(skipped).slice(1)
  return (
    <div className={s.page}>
      <article className={s.wide}>
        {back}
        <ReleaseHead release={NOW} />
        <section className={s.flagship} aria-labelledby="flagship">
          <div className={s.flagWords}>
            <Heading level={2} id="flagship" className={s.flagTitle}>
              {FLAGSHIP.title}
            </Heading>
            <ul className={s.brief}>
              {FLAGSHIP_BRIEF.map((one) => (
                <li key={one.name}>
                  <span className={s.briefName}>{one.name}</span>
                  <span className={s.briefLine}>{one.line}</span>
                  <WayIn way={one.way} />
                </li>
              ))}
            </ul>
          </div>
          <Where />
        </section>
        <section aria-labelledby="also">
          <Heading level={2} id="also" className={s.partTitle}>
            Also new
          </Heading>
          <ul className={s.tiles}>
            {HIGHLIGHTS.map((one) => (
              <li key={one.name} className={s.tile}>
                <span className={s.tileName}>{one.name}</span>
                <span className={s.tileLine}>
                  <Words text={one.line} />
                </span>
                <WayIn way={one.way} />
              </li>
            ))}
          </ul>
        </section>
        <Disclosure className={s.every}>
          <DisclosureTrigger>
            <button type="button" className={s.everyLine}>
              <span>Every change in {NOW.version}</span>
              <Caret />
            </button>
          </DisclosureTrigger>
          <Fold bleed={false}>
            <div className={s.everyNotes}>
              <ReleaseNotes release={NOW} level={3} />
            </div>
          </Fold>
        </Disclosure>
        {earlier.map((release) => (
          <Disclosure key={release.version} className={s.every}>
            <DisclosureTrigger>
              <button type="button" className={s.everyLine}>
                <span>
                  {release.version} · {release.title}
                </span>
                <Caret />
              </button>
            </DisclosureTrigger>
            <Fold bleed={false}>
              <div className={s.everyNotes}>
                <ReleaseNotes release={release} level={3} />
              </div>
            </Fold>
          </Disclosure>
        ))}
        <Earlier after={newTo(skipped).at(-1) ?? NOW} />
      </article>
    </div>
  )
}

/** Where the work runs now, as the flagship has it: your computer, your home, your worker. */
function Where() {
  const rows = [
    { icon: 'computer' as const, name: 'This computer', code: false, what: 'The window. Close it; the work goes on.' },
    { icon: 'home' as const, name: 'build-01', code: true, what: 'Your home: projects, tasks and their agents.' },
    { icon: 'terminal' as const, name: 'runner-1', code: true, what: 'A worker: a task’s lead, its setup and Run.' },
  ]
  return (
    <ol className={s.where} aria-label="Where the work runs">
      {rows.map((row) => (
        <li key={row.name}>
          <Icon name={row.icon} size={14} className={s.whereIcon} />
          {row.code ? <code className={s.whereCode}>{row.name}</code> : <span className={s.whereName}>{row.name}</span>}
          <span className={s.whereWhat}>{row.what}</span>
        </li>
      ))}
    </ol>
  )
}

/** D: Althar's own page, a tab like a project's: its bar, and its two views. */
export function AltharPage() {
  const { view, skipped } = useLab()
  const fresh = newTo(skipped)
  return (
    <div className={s.project}>
      <TitleBar
        lights="none"
        className={s.bar}
        end={
          <TaskHeader<View>
            title="Althar"
            status={TaskStatus.Done}
            state="Up to date"
            faces={[
              { value: 'new', label: 'What’s new' },
              { value: 'coming', label: 'Coming next' },
            ]}
            face={view}
            onFace={(next) => lab.set({ view: next })}
            text={{ faces: 'View' }}
          />
        }
      >
        <Heading level={1} className={s.crumb}>
          <span className={s.crumbName}>
            <Logo size={18} />
            Althar
          </span>
        </Heading>
      </TitleBar>
      {view === 'new' ? (
        <div className={s.page}>
          <div className={s.column}>
            {RELEASES.map((release) => {
              const isNew = fresh.includes(release)
              return (
                <Disclosure key={release.version} className={s.release} defaultOpen={release === NOW}>
                  <DisclosureTrigger>
                    <button type="button" className={s.releaseRow}>
                      <span className={s.releaseVersion}>{release.version}</span>
                      <span className={s.releaseTitle}>{release.title}</span>
                      <span className={s.releaseWhen}>{isNew ? `New since ${fromVersion(skipped)}` : dated(release.date)}</span>
                      <Caret />
                    </button>
                  </DisclosureTrigger>
                  <Fold bleed={false}>
                    <div className={s.releaseNotes}>
                      <ReleaseNotes release={release} level={3} />
                    </div>
                  </Fold>
                </Disclosure>
              )
            })}
          </div>
        </div>
      ) : (
        <div className={s.lanes}>
          {(['now', 'next', 'later'] as const).map((stage) => (
            <section key={stage} className={s.lane} aria-labelledby={`stage-${stage}`}>
              <header className={s.laneHead}>
                <Heading level={2} id={`stage-${stage}`} className={s.laneTitle}>
                  {STAGE_TITLE[stage]}
                </Heading>
              </header>
              <ul className={s.laneCards}>
                {ROADMAP.filter((one) => one.stage === stage).map((one) => (
                  <li key={one.title} className={s.card}>
                    <span className={s.cardTitle}>{one.title}</span>
                    <span className={s.cardDetail}>{one.detail}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

/** The lab's route: what What's new's tab shows in each direction. */
export function WhatsNewScreen() {
  const { d, reading } = useLab()
  // Opening it is looking at it: B's line and D's dot go.
  useEffect(() => {
    if (lab.get().unseen) lab.set({ unseen: false })
  }, [])
  if (d === 'd') return <AltharPage />
  return reading === 'highlights' ? <Highlights /> : <Notes />
}

/** C: the notes in the home's place, with the way back to it. */
export function HomeNotes() {
  const { reading } = useLab()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') lab.set({ homeNotes: false })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const back = (
    <div className={s.back}>
      <BackCrumb to="Home" onBack={() => lab.set({ homeNotes: false })} kbd="Esc" title="What’s new" />
    </div>
  )
  return <div className={s.inHome}>{reading === 'highlights' ? <Highlights back={back} /> : <Notes back={back} />}</div>
}

/** C: what the home at rest says of the update, under what it says already. */
export function HomeUpdate() {
  return (
    <div className={s.homeUpdate}>
      <p className={s.homeEyebrow}>Althar {NOW.version}</p>
      <p className={s.homeTitle}>{NOW.title}</p>
      <p className={s.homeLine}>Your own host and workers, computer use, artifacts you talk to, goals, and more.</p>
      <Button size="small" onClick={go.whatsNew}>
        What’s new
      </Button>
    </div>
  )
}

/** B: in the window's bar, where "Althar 0.10.0 is ready" stood before the restart. */
export function UpdatedLine() {
  return (
    <output className={s.updated}>
      <span className={s.updatedWords}>Updated to {NOW.version}</span>
      <LinkButton onClick={go.whatsNew}>What’s new</LinkButton>
    </output>
  )
}
