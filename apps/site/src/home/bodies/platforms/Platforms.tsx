import { cx } from '../../../lib/cx'
import { HomeWindow, type System } from '../kit/app'
import { Desktop, LinuxDesktop, MacWindow, WindowsDesktop } from '../kit/Mac'
import { useNarrow } from '../kit/narrow'
import { Reel } from '../kit/Reel'
import { Shot } from '../kit/Shot'
import t from '../kit/type.module.css'
import s from './Platforms.module.css'

/*
 * Althar runs on macOS, Windows and Linux: the same window on each, in its
 * own system's frame. Prototype: three ways to say so between the first
 * screen and the rest.
 *
 *  - Rise: three windows, one a system, rising out of the first screen's
 *    light, the Mac's in front, Windows' and Linux's turned in either side.
 *  - Morph: one screen straddling the first screen's edge, its desktop
 *    turning from macOS to Windows to Linux while the window stays.
 *  - Row: three screens side by side under the first one, each a whole
 *    desktop with Althar on it, named under it.
 */

export type PlatformsLook = 'rise' | 'morph' | 'row'

export const SYSTEMS: ReadonlyArray<{ id: System; name: string; note: string }> = [
  { id: 'mac', name: 'macOS', note: 'Apple silicon and Intel' },
  { id: 'windows', name: 'Windows', note: 'Windows 10 and 11' },
  { id: 'linux', name: 'Linux', note: 'Ubuntu, Fedora and the rest' },
]

/** A system's whole desktop with Althar's home on it. */
export function SystemDesktop({ system, narrow = false }: { system: System; narrow?: boolean }) {
  const win = narrow
    ? system === 'linux'
      ? { left: 80, top: 12, width: 330, height: 660 }
      : { left: 10, top: 12, width: 400, height: system === 'windows' ? 640 : 680 }
    : system === 'linux'
      ? { left: 150, top: 40, width: 1180, height: 740 }
      : { left: 130, top: 34, width: 1180, height: system === 'windows' ? 760 : 720 }
  const home = <HomeWindow system={system} narrow={narrow} />
  if (system === 'windows')
    return (
      <WindowsDesktop wallpaper="light">
        <MacWindow style={{ ...win, borderRadius: 8 }}>{home}</MacWindow>
      </WindowsDesktop>
    )
  if (system === 'linux')
    return (
      <LinuxDesktop wallpaper="dark">
        <MacWindow style={{ ...win, borderRadius: 12 }}>{home}</MacWindow>
      </LinuxDesktop>
    )
  return (
    <Desktop wallpaper="light" compact={narrow} dock={!narrow}>
      <MacWindow style={win}>{home}</MacWindow>
    </Desktop>
  )
}

function Head({ center = true }: { center?: boolean }) {
  return (
    <div className={cx(s.head, !center && s.left)}>
      <h2 className={cx(t.title, s.title)}>
        One app, <b>every desktop.</b>
      </h2>
      <p className={t.lead}>
        The same Althar on macOS, Windows and Linux: your projects, your agents and your plans, wherever you sit down.
      </p>
    </div>
  )
}

/* ---- Rise ---- */

function Rise() {
  const narrow = useNarrow()
  const W = narrow ? 420 : 1440
  const H = narrow ? 720 : 900
  const windowOf = (system: System) => <SystemDesktop system={system} narrow={narrow} />
  return (
    <section className={cx(s.platforms, s.rise)} aria-labelledby="platforms-h">
      <div className={s.fan}>
        {(['mac', 'linux', 'windows'] as const).map((system) => (
          <figure key={system} className={cx(s.fanItem, s[system])}>
            <Shot w={W} h={H} label={`Althar on ${SYSTEMS.find((x) => x.id === system)!.name}`} frame={s.fanFrame}>
              {windowOf(system)}
            </Shot>
          </figure>
        ))}
      </div>
      <p className={s.names}>
        <span>macOS</span>
        <span>Linux</span>
        <span>Windows</span>
      </p>
      <span id="platforms-h" hidden>
        Platforms
      </span>
      <Head />
    </section>
  )
}

/* ---- Morph ---- */

function Morph() {
  const narrow = useNarrow()
  return (
    <section className={cx(s.platforms, s.morph)} aria-labelledby="platforms-h">
      <div className={s.morphScreen}>
        <div className={s.bezel}>
          <Reel
            moments={SYSTEMS.map((x) => ({
              label: x.name,
              at: x.note,
              stays: 3400,
              render: () =>
                narrow ? (
                  <Shot w={420} h={720} label={`Althar on ${x.name}`} frame={s.screen}>
                    <SystemDesktop system={x.id} narrow />
                  </Shot>
                ) : (
                  <Shot w={1440} h={900} label={`Althar on ${x.name}`} frame={s.screen}>
                    <SystemDesktop system={x.id} />
                  </Shot>
                ),
            }))}
          />
        </div>
      </div>
      <span id="platforms-h" hidden>
        Platforms
      </span>
      <Head />
    </section>
  )
}

/* ---- Row ---- */

function Row() {
  return (
    <section className={cx(s.platforms, s.row)} aria-labelledby="platforms-h">
      <span id="platforms-h" hidden>
        Platforms
      </span>
      <Head />
      <ul className={s.screens}>
        {SYSTEMS.map((x) => (
          <li key={x.id}>
            <div className={s.smallBezel}>
              <Shot w={1440} h={900} label={`Althar on ${x.name}`} frame={s.smallScreen}>
                <SystemDesktop system={x.id} />
              </Shot>
            </div>
            <p className={s.name}>
              <b>{x.name}</b>
              <span>{x.note}</span>
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function Platforms({ look }: { look: PlatformsLook }) {
  if (look === 'morph') return <Morph />
  if (look === 'row') return <Row />
  return <Rise />
}
