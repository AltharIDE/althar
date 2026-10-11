import { Fragment, type ReactNode, type Ref, useEffect, useRef, useState } from 'react'

import { ChromeButton } from '../../../chrome/ChromeButton/ChromeButton'
import { ProjectSwitcher } from '../../../chrome/ProjectSwitcher/ProjectSwitcher'
import { RoomSwitch } from '../../../chrome/RoomSwitch/RoomSwitch'
import { TitleBar, TitleBarRule } from '../../../chrome/TitleBar/TitleBar'
import { WorkStatus } from '../../../chrome/WorkStatus/WorkStatus'
import { Composer } from '../../../composer/Composer/Composer'
import { ContextRing } from '../../../composer/ContextRing/ContextRing'
import { ModelPick } from '../../../composer/ModelPick/ModelPick'
import { MERIDIAN, PROJECTS } from '../../../fixtures/chrome'
import { CODEX, effortFor, OPUS, SONNET } from '../../../fixtures/models'
import { Room } from '../../../foundations/vocabulary'
import { cx } from '../../../lib/cx'
import { reducedMotion } from '../../../lib/motion'
import { useOnScreen } from '../../../lib/onScreen'
import { liveAt, SAMPLES } from '../fixtures'
import { OverlayScheme } from '../scheme'
import type { Usage } from '../usage'
import s from './Stage.module.css'

/*
 * Where the stories put each direction: the window's bar or a task's
 * composer, as the app puts them together, on paper or on the dark
 * stand-in; a grid of each state in both; and a loop of made-up load
 * that ticks while it is on screen.
 */

const noop = () => {}

export type Scheme = 'light' | 'dark'

export interface StageProps {
  scheme?: Scheme
  /** page: the window's page. bar: the bar's own surface, for a readout on its own. */
  surface?: 'page' | 'bar'
  /** Room below for a detail that opens under what is staged, or above it. */
  room?: 'below' | 'above'
  children: ReactNode
  className?: string
}

/** A box in a scheme. Dark is a stand-in: Althar has no dark theme yet (see scheme.ts). */
export function Stage({ scheme = 'light', surface = 'page', room, children, className }: StageProps) {
  const box = (
    <div className={cx(s.stage, s[surface], room && s[room], scheme === 'dark' && s.dark, className)} data-scheme={scheme}>
      {children}
    </div>
  )
  return scheme === 'dark' ? <OverlayScheme.Provider value={s.dark}>{box}</OverlayScheme.Provider> : box
}

/** How many of a project's tasks are running: the bar's status counts this project's; the readout, every project's. */
export const runningIn = (usage: Usage, project = MERIDIAN.name) => usage.shares.filter((share) => share.project === project).length

export interface BarHostProps {
  /** The readout, before the work's status. Without it, the bar as it is today. */
  readout?: ReactNode
  /** This project's tasks running, for the work's status. */
  running: number
  /** The bar's next control after the readout, for focus to go to when the readout leaves. */
  nextRef?: Ref<HTMLButtonElement>
  /** Only the readout and the work's status, for a page narrower than a window. */
  bare?: boolean
}

/** A project window's bar, with a readout where the work's status starts. */
export function BarHost({ readout, running, nextRef, bare = false }: BarHostProps) {
  return (
    <TitleBar
      lights={bare ? 'none' : 'drawn'}
      end={
        <>
          {readout}
          <WorkStatus running={running} yours={2} onYours={noop} />
          {!bare && (
            <>
              <TitleBarRule />
              <ChromeButton ref={nextRef} icon="knowledge" label="Knowledge" kbd="k" onClick={noop} />
              <ChromeButton icon="artifact" label="Artifacts" kbd="a" onClick={noop} />
            </>
          )}
        </>
      }
    >
      {!bare && (
        <>
          <ProjectSwitcher current={MERIDIAN} projects={PROJECTS} onPick={noop} onRename={noop} onNew={noop} />
          <RoomSwitch value={Room.Board} onChange={noop} />
        </>
      )}
    </TitleBar>
  )
}

/** For the comparison page: what it is given, on paper and on the dark stand-in, one over the other. */
export function Specimen({ children }: { children: ReactNode }) {
  return (
    <div className={s.specimen}>
      <Stage>{children}</Stage>
      <Stage scheme="dark">{children}</Stage>
    </div>
  )
}

/** A task's composer, with the pie (or nothing) before its context ring. */
export function ComposerHost({ pie }: { pie?: ReactNode }) {
  const [value, setValue] = useState('')
  const effort = effortFor(OPUS)
  return (
    <div className={s.composer}>
      <Composer
        value={value}
        onChange={setValue}
        onSubmit={() => setValue('')}
        placeholder="Tell the lead"
        busy
        onStopAgent={noop}
        picker={
          <ModelPick
            model={OPUS}
            pinned={[OPUS, CODEX, SONNET]}
            effort={effort}
            defaultEffort={effort}
            owner="Lead"
            onChange={noop}
            onEffort={noop}
          />
        }
        meter={
          <>
            {pie}
            <ContextRing used={122} total={OPUS.context ?? 200} model={OPUS} />
          </>
        }
      />
    </div>
  )
}

export interface PairRow {
  state: string
  node: ReactNode
  /** Force a pointer or keyboard state on the row's button, with `pairsParameters`. */
  force?: 'hover' | 'focus'
}

/** Each state in a row, on paper and on the dark stand-in, side by side. */
export function Pairs({ rows, surface = 'bar' }: { rows: readonly PairRow[]; surface?: StageProps['surface'] }) {
  const cell = (row: PairRow) => (row.force === undefined ? row.node : <span data-force={row.force}>{row.node}</span>)
  return (
    <div className={s.pairs}>
      <span />
      <span className={s.label}>Light</span>
      <span className={s.label}>Dark</span>
      {rows.map((row) => (
        <Fragment key={row.state}>
          <span className={s.label}>{row.state}</span>
          <Stage surface={surface}>{cell(row)}</Stage>
          <Stage surface={surface} scheme="dark">
            {cell(row)}
          </Stage>
        </Fragment>
      ))}
    </div>
  )
}

/** For a story of Pairs: the rows marked hover or focus show it, without a pointer. */
export const pairsParameters = {
  pseudo: {
    hover: ["[data-force='hover'] button"],
    focusVisible: ["[data-force='focus'] button"],
    focus: ["[data-force='focus'] button"],
  },
}

/**
 * The live loop, a tick every `every` ms while `ref` is on screen. With
 * reduced motion nothing eases between ticks, and the ticks come three
 * times as far apart, so the bar changes seldom.
 */
export function useLive(every = 2000) {
  const ref = useRef<HTMLDivElement>(null)
  const onScreen = useOnScreen(ref)
  const [n, setN] = useState(SAMPLES)
  useEffect(() => {
    if (!onScreen) return
    const id = setInterval(() => setN((x) => x + 1), reducedMotion() ? every * 3 : every)
    return () => clearInterval(id)
  }, [onScreen, every])
  return { ref, usage: liveAt(n) }
}

/** A sheet of Settings, as the Control Center opens one out. */
export function Sheet({ children }: { children: ReactNode }) {
  return <div className={s.sheet}>{children}</div>
}

/** The live loop, on paper and on the dark stand-in, each its own region so two bars aren't two banners. */
export function LivePair({ children }: { children: (usage: Usage, scheme: Scheme) => ReactNode }) {
  const { ref, usage } = useLive()
  return (
    <div ref={ref} className={s.live}>
      <section aria-label="Light">{children(usage, 'light')}</section>
      <section aria-label="Dark">{children(usage, 'dark')}</section>
    </div>
  )
}

/** A story's frame: room around it, and a caption that says what to look at. */
export function Frame({ children, caption }: { children: ReactNode; caption?: ReactNode }) {
  return (
    <div className={s.frame}>
      {children}
      {caption !== undefined && <p className={s.caption}>{caption}</p>}
    </div>
  )
}
