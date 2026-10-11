import type { CSSProperties } from 'react'

import { Logo } from '../../foundations/Logo/Logo'
import { EdgeSpot, unreachable } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import s from './EdgeMini.module.css'

/*
 * Where Althar shows while you work in another app, in small: the top of a
 * screen or the corner of a taskbar, with Althar's mark or island where it
 * would be, drawn in a few strokes for a module that says where it shows.
 * Round a Mac's notch, beside it in the menu bar, in the menu bar of a Mac
 * without one, in Windows' tray beside the clock, in the tray at the end of
 * a Linux desktop's top bar, or nowhere at all on a desktop without a tray.
 * Only a picture: nothing in it says anything or can be pressed.
 */

export type EdgeMiniProps = RootProps<
  'span',
  {
    spot: EdgeSpot
    /** How much larger than a module draws it (58 by 36), for a page that shows it on its own. */
    scale?: number
  }
>

/** The edge of a screen in small, with Althar where it shows on this system. */
export function EdgeMini({ spot, scale, className, style, ...rest }: EdgeMiniProps) {
  const zoomed: CSSProperties | undefined = scale === undefined ? style : { ...style, zoom: scale }
  return (
    <span className={cx(s.mini, frameOf(spot), className)} style={zoomed} aria-hidden="true" {...rest}>
      {drawingOf(spot)}
    </span>
  )
}

const frameOf = (spot: EdgeSpot): string | undefined => {
  switch (spot) {
    case EdgeSpot.Island:
    case EdgeSpot.MenuBesideNotch:
    case EdgeSpot.MenuBar:
      return undefined
    case EdgeSpot.WindowsTray:
      return s.windows
    case EdgeSpot.LinuxTray:
    case EdgeSpot.WindowOnly:
      return s.linux
    default:
      return unreachable(spot)
  }
}

const mark = (
  <span className={s.mark}>
    <Logo size={8} />
  </span>
)

function drawingOf(spot: EdgeSpot) {
  switch (spot) {
    case EdgeSpot.Island:
      return (
        <span className={s.bar}>
          <span className={s.apple} />
          <span className={s.word} />
          <span className={s.island}>
            <span className={s.wing}>
              <Logo size={7} />
            </span>
            <span className={s.notch} />
            <span className={s.wing}>
              <i />
            </span>
          </span>
        </span>
      )
    case EdgeSpot.MenuBesideNotch:
    case EdgeSpot.MenuBar:
      return (
        <span className={s.bar}>
          <span className={s.apple} />
          <span className={s.word} />
          {spot === EdgeSpot.MenuBesideNotch && (
            <span className={cx(s.island, s.notchAlone)}>
              <span className={s.notch} />
            </span>
          )}
          <span className={s.end}>
            {mark}
            <span className={s.clock} />
          </span>
        </span>
      )
    case EdgeSpot.WindowsTray:
      return (
        <span className={s.taskbar}>
          <span className={s.tray}>
            <span className={s.caret} />
            <span className={cx(s.mark, s.inkMark)}>
              <Logo size={8} />
            </span>
            <span className={s.glyph} />
            <span className={s.date}>
              <i />
              <i />
            </span>
          </span>
        </span>
      )
    case EdgeSpot.LinuxTray:
    case EdgeSpot.WindowOnly:
      return (
        <span className={s.bar}>
          <span className={s.word} />
          <span className={s.clockMiddle} />
          <span className={s.end}>
            {spot === EdgeSpot.LinuxTray && mark}
            <span className={cx(s.glyph, s.light)} />
          </span>
        </span>
      )
    default:
      return unreachable(spot)
  }
}
