// Scrappy: E. A page opens on the conversation's workbench, the column on its right where a lead's documents and the files it names
// open; the conversation stays, narrower, beside it. What is pointed at on the page goes in the composer beside it, an attachment to
// what the person says next. The page's bar has the ways out: a tab of its own, or the person's browser.
import type { CSSProperties } from 'react'

import { IconButton } from '../../../src/primitives/IconButton/IconButton'
import { SidePanel } from '../../../src/primitives/SidePanel/SidePanel'
import { Workbench } from '../../../src/thread/Workbench/Workbench'
import { runOf, shown, verdictOf } from '../addresses'
import { addressOf, benchStart, type Page, proto, sideScope, useProto } from '../state'
import { Bar, Line } from './Bar'
import s from './Beside.module.css'
import { Frame } from './Frame'
import { glyph } from './icons'
import { pageSizeOf, ViewportMenu, Well } from './Viewport'
import { Absent, Blank, SignIn } from './Stand'

/** What the conversation keeps of the window beside it: a readable measure. */
const TALK = 440

/** The workbench's width now: as dragged, within what the window leaves. */
export const benchWidth = (wanted: number) => Math.max(360, Math.min(wanted, window.innerWidth - TALK))

/** Where the workbench opens over something to the conversation's right (the board), as the app's own does: its room there, and what it leaves of it. */
export interface Over {
  readonly room: number
  readonly keep: number
  readonly className?: string
  readonly style?: CSSProperties
}

export function Beside({ thread, page, over }: { thread: string; page: Page; over?: Over | undefined }) {
  const p = useProto()
  const scope = sideScope(thread)
  const address = addressOf(page)
  const verdict = verdictOf(address)
  // Over the board, a sliver of it beside the page is of no use: the page takes it all (as ThreadHost's workbench does).
  const whole = over !== undefined && p.bench > over.room - over.keep
  const max = over === undefined ? Math.max(360, window.innerWidth - TALK) : whole ? over.room : over.room - over.keep
  const width = over === undefined ? benchWidth(p.bench) : whole ? max : Math.min(p.bench, max)
  const size = pageSizeOf(p.viewports[scope])
  return (
    <Workbench
      width={width}
      min={whole ? max : 360}
      max={max}
      onWidth={(bench) => proto.set({ bench })}
      onReset={() => proto.set({ bench: benchStart() })}
      edge={over === undefined ? 'start' : 'end'}
      {...(over?.className === undefined ? {} : { className: over.className })}
      {...(over === undefined ? {} : { style: { ...over.style, width } })}
    >
      <SidePanel
        label={page.title ?? (shown(address) || 'Page')}
        className={s.panel}
        headClassName={s.head}
        onClose={() => proto.closeSide(thread)}
        head={
          <Bar
            scope={scope}
            page={page}
            // Every page beside a task is in that task's session: its run's, and any other it opens.
            session={thread === 'thc' ? 'page' : 'task'}
            pointable={verdict.kind === 'page'}
            className={s.bar}
            {...(verdict.kind === 'page' ? { extra: <ViewportMenu scope={scope} /> } : {})}
            after={<IconButton icon={glyph('tab')} label="Open as a tab" size="small" onClick={() => proto.toTab(thread)} />}
          />
        }
      >
        <Line scope={scope} />
        {verdict.kind === 'page' ? (
          <Well scope={scope}>
            <Frame
              key={page.id}
              scope={scope}
              address={address}
              src={verdict.src}
              reloads={page.reloads}
              onFollow={(next) => proto.navigate(scope, next)}
              onTitle={(title) => proto.title(scope, title)}
              {...size}
            />
          </Well>
        ) : verdict.kind === 'signin' ? (
          <SignIn verdict={verdict} scope={scope} first={page.at === 0} />
        ) : verdict.kind === 'absent' ? (
          <Absent verdict={verdict} />
        ) : (
          <Blank scope={scope} />
        )}
      </SidePanel>
    </Workbench>
  )
}

/** Whether the page beside is the task's run: its session is the task's own. */
export const onTaskRun = (page: Page | undefined) => page !== undefined && runOf(addressOf(page)) === 'task'
