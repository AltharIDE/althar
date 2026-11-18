import { useEffect, useState } from 'react'

import { Icon, IconButton } from '@althar/ui'

import { type Foot, FootBody, FootEnd, FootTitle, same, useFoot } from './Below'
import { cx, HeightEdge, helpMeFix, RunMark, RunState, shellName, text } from './parts'
import { useLab } from './state'
import { openTerminal } from './terminal'
import { phaseOf, world } from './world'
import s from './directions.module.css'

/*
 * B1 · A status line. The foot is a line of words, an editor's status bar,
 * not a band of tabs: each run by its mark, its name and how it stands, each
 * terminal by its folder, there only while something runs or ran or a
 * terminal is open. A press raises a drawer over the window's lower part,
 * floating, so nothing under it moves; its top edge drags it taller, and
 * Escape, or the same press, lowers it. Help me fix it lowers it to reach the
 * composer it covers.
 */

const LINE = 28
const HEIGHT = 380

/** The line's own: what is chosen while the drawer is up shows so; the rest are words in a row. */
function Line({ foot }: { foot: Foot }) {
  const chosen = (kind: 'run' | 'shell', id: string) => foot.raised && same(foot.focus, { kind, id })
  return (
    <footer className={s.line} style={{ height: LINE }} aria-label="Runs and terminals">
      {foot.runs.map((one) => (
        <button
          key={one.id}
          type="button"
          className={cx(s.lineItem, chosen('run', one.id) && s.lineChosen)}
          aria-pressed={chosen('run', one.id)}
          onClick={() => foot.press({ kind: 'run', id: one.id })}
        >
          <RunMark run={one} />
          <span className={s.lineName}>{one.name}</span>
          <span className={cx(s.lineState, phaseOf(one) === 'running' && s.lineAddress)}>
            <RunState run={one} short inPress />
          </span>
        </button>
      ))}
      {foot.shells.map((one) => (
        <button
          key={one.id}
          type="button"
          className={cx(s.lineItem, chosen('shell', one.id) && s.lineChosen)}
          aria-pressed={chosen('shell', one.id)}
          onClick={() => foot.press({ kind: 'shell', id: one.id })}
        >
          <Icon name="terminal" size={12} className={s.faint} />
          <span className={s.lineName}>{shellName(one, foot.shells)}</span>
        </button>
      ))}
      <span className={s.gap} />
      <IconButton
        icon="terminal"
        label={text.newTerminal}
        kbd="Ctrl `"
        size="small"
        tooltipAlign="end"
        className={s.lineEnd}
        onClick={() => openTerminal()}
      />
    </footer>
  )
}

export function StatusLine() {
  const { d } = useLab()
  const foot = useFoot()
  const [height, setHeight] = useState(HEIGHT)
  const [room, setRoom] = useState(600)
  const raised = d === 'b1' && foot?.raised === true
  // How tall it may be: the window, less its tabs and the project's header.
  useEffect(() => {
    if (!raised) return
    const window_ = document.querySelector<HTMLElement>('[data-lab-window]')
    if (window_ === null) return
    const measure = () => setRoom(window_.clientHeight - LINE - 140)
    measure()
    const seen = new ResizeObserver(measure)
    seen.observe(window_)
    return () => seen.disconnect()
  }, [raised])
  if (d !== 'b1' || foot === null) return null
  return (
    <>
      {foot.raised && (
        <section
          className={s.drawer}
          style={{ height: Math.min(height, room), bottom: LINE + 6 }}
          aria-label="Runs and terminals"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              world.hide()
            }
          }}
        >
          <HeightEdge
            value={Math.min(height, room)}
            min={180}
            max={room}
            onChange={setHeight}
            onReset={() => setHeight(HEIGHT)}
            label="Height of the drawer"
          />
          <div className={s.drawerHead}>
            <FootTitle foot={foot} />
            <FootEnd foot={foot} lower="close" folder={false} />
          </div>
          <FootBody
            foot={foot}
            onHelp={(run) => {
              // The drawer covers the composer: down first, then the run said there.
              world.hide()
              helpMeFix(run)
            }}
          />
        </section>
      )}
      <Line foot={foot} />
    </>
  )
}
