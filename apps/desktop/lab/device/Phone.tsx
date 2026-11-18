import { type CSSProperties, type ReactNode, useLayoutEffect, useRef, useState } from 'react'

import { HalftoneMark } from '@althar/ui'

import type { Device, Screen } from './data'
import s from './phone.module.css'

/*
 * A device's screen, as the simulator or emulator draws it: the phone app's
 * first screen at the device's own points, with its status bar, its camera
 * and its home bar, scaled to fit the room it is given. It stands for the
 * pixels Althar would stream from the device; nothing here is the kit's.
 */

/** The largest scale at which a device fits a box, never past its own size. */
export const fitOf = (device: Device, room: { readonly width: number; readonly height: number }) =>
  Math.min(1, room.width / device.width, room.height / device.height)

/** The room an element has, as it changes. */
export function useRoom<E extends HTMLElement>() {
  const ref = useRef<E>(null)
  const [room, setRoom] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const at = ref.current
    if (at === null) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setRoom({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(at)
    return () => observer.disconnect()
  }, [])
  return { ref, room }
}

function StatusBar({ device }: { device: Device }) {
  const ios = device.platform === 'ios'
  return (
    <div className={ios ? s.statusIos : s.statusAndroid}>
      <span className={s.time}>9:41</span>
      {ios ? <span className={s.island} /> : <span className={s.camera} />}
      <span className={s.icons} aria-hidden="true">
        <svg width="17" height="11" viewBox="0 0 17 11">
          {[0, 1, 2, 3].map((bar) => (
            <rect key={bar} x={bar * 4.5} y={8 - bar * 2.5} width="3" height={3 + bar * 2.5} rx="0.8" fill="currentColor" />
          ))}
        </svg>
        <svg width="15" height="11" viewBox="0 0 15 11">
          <path
            d="M7.5 10.5 5.2 8a3.3 3.3 0 0 1 4.6 0Z M2.6 5.4a7 7 0 0 1 9.8 0l-1.3 1.3a5.2 5.2 0 0 0-7.2 0Z M0 2.8a10.7 10.7 0 0 1 15 0l-1.3 1.3a8.9 8.9 0 0 0-12.4 0Z"
            fill="currentColor"
          />
        </svg>
        <svg width="25" height="12" viewBox="0 0 25 12">
          <rect x="0.5" y="0.5" width="21" height="11" rx="3" fill="none" stroke="currentColor" opacity="0.4" />
          <rect x="2" y="2" width="18" height="8" rx="1.8" fill="currentColor" />
          <rect x="23" y="4" width="1.5" height="4" rx="0.7" fill="currentColor" opacity="0.4" />
        </svg>
      </span>
    </div>
  )
}

/** The phone app's first screen, with the task's new line under the buttons, and where a code comes from open on `where`. */
function FirstScreen({ screen }: { screen: Screen }) {
  return (
    <div className={s.app}>
      <div className={s.light} />
      <div className={s.top}>
        <HalftoneMark size={88} rise={false} />
        <h1 className={s.title}>Connect this phone to Althar</h1>
        <p className={s.sub}>Scan the code your home shows, or paste it. You do this once.</p>
      </div>
      <div className={s.foot}>
        {screen === 'where' && (
          <div className={s.where}>
            <strong>From a server</strong>
            <span>
              Run <code>althar-host pair</code> and copy the code it prints. It works for five minutes.
            </span>
          </div>
        )}
        <div className={s.row}>
          <span className={s.quiet}>Paste</span>
          <span className={s.ink}>Scan a code</span>
        </div>
        <span className={s.link}>{screen === 'where' ? 'Done' : 'Where do I get a code?'}</span>
        <span className={s.new}>Codes come from Althar on your computer, in Settings › Phones.</span>
      </div>
    </div>
  )
}

export interface PhoneProps {
  device: Device
  screen: Screen
  scale: number
  /** The lead is using it: a cobalt edge round the screen, as the page has while its lead drives it. */
  driving?: boolean
  /** Where the lead last tapped, in the device's points. */
  tap?: { readonly x: number; readonly y: number; readonly key: number } | null
  /** Over the screen: what stands in its place while it starts. */
  children?: ReactNode
  className?: string
}

export function Phone({ device, screen, scale, driving = false, tap = null, children, className }: PhoneProps) {
  const ios = device.platform === 'ios'
  const box: CSSProperties = { width: device.width * scale, height: device.height * scale }
  return (
    <div
      className={[s.phone, ios ? s.ios : s.android, driving && s.driving, className].filter(Boolean).join(' ')}
      style={{ ...box, borderRadius: (ios ? 55 : 34) * scale }}
    >
      <div className={s.points} style={{ width: device.width, height: device.height, transform: `scale(${scale})` }}>
        <StatusBar device={device} />
        <FirstScreen screen={screen} />
        <span className={ios ? s.homeIos : s.homeAndroid} />
        {tap !== null && <span key={tap.key} className={s.tap} style={{ left: tap.x, top: tap.y }} />}
      </div>
      {children}
    </div>
  )
}

/** Where the lab's lead taps: the first screen's "Where do I get a code?", in points from the top left. */
export const linkAt = (device: Device) => ({ x: device.width / 2, y: device.height - (device.platform === 'ios' ? 104 : 96) })
