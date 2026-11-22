import { useEffect, useMemo, useRef, useState } from 'react'

import { Button, Code, CopyButton, Icon, LinkButton } from '@althar/ui'

import { lab, useLab } from '../state'
import { linkOf, pairingCode, qrOf } from './code'
import { printDots } from './print'
import { type LabHome, mmss, phones, seedOf, useLeft, usePhones, wordsOfHome } from './world'
import { PHONE } from './icons'
import s from './pairing.module.css'

/*
 * Pairing a phone with the window's home, as every direction shows it: the
 * QR, with the home's print and its three words beside it (the phone shows
 * the same once it reads the code, and asks the person to check them), the
 * code itself to copy and paste on the phone, and its five minutes running
 * down while it waits for the phone. Paired, the print's point lights, as it
 * does on the phone. Before a phone can reach the home at all, it says what
 * that takes instead. Wide in a sheet or a dialog; narrow in a popover.
 */

/** The QR, dark on light in either appearance, as a phone's camera reads it best. */
export function Qr({ text, size }: { text: string; size: number }) {
  const matrix = useMemo(() => qrOf(text), [text])
  const quiet = 2
  const n = matrix.size + quiet * 2
  const path = useMemo(() => {
    let d = ''
    for (let y = 0; y < matrix.size; y++)
      for (let x = 0; x < matrix.size; x++) if (matrix.dark(x, y)) d += `M${x + quiet} ${y + quiet}h1v1h-1z`
    return d
  }, [matrix])
  return (
    <svg className={s.qr} width={size} height={size} viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges">
      <title>Pairing code</title>
      <path d={path} />
    </svg>
  )
}

/** The home's print, as the phone draws it: lit at its point once a phone is paired. */
export function Print({ home, size, lit = false }: { home: LabHome; size: number; lit?: boolean }) {
  const dots = useMemo(() => printDots(seedOf(home), size >= 120 ? 1.4 : 1.66), [home, size])
  return (
    <svg className={s.print} width={size} height={size} viewBox="0 0 60 60" aria-hidden="true">
      {dots.map((dot, i) => (
        <circle key={i} cx={dot.x} cy={dot.y} r={dot.r} />
      ))}
      <circle className={s.point} data-lit={lit || undefined} cx={30} cy={30} r={2.5} />
      <circle className={s.halo} data-lit={lit || undefined} cx={30} cy={30} r={4.2} />
    </svg>
  )
}

const REACH = {
  mac: {
    title: (home: string) => `Phones can't reach ${home} yet`,
    note: 'Althar would answer them at macbook.tail4a2b.ts.net, on your tailnet, while this computer is awake.',
  },
  studio: {
    title: (home: string) => `${home} doesn't take phones yet`,
    note: 'A phone reaches a home over HTTPS. Run this on it, restart its host, and the code shows here.',
    command:
      'althar-host configure-network --origin https://studio.tail4a2b.ts.net:6769 --listen-address 0.0.0.0 --tls-certificate cert.pem --tls-key key.pem',
  },
}

/** What a phone needs before it can pair: This Mac to let phones in, or a remote home to listen over HTTPS. */
function Reach({ home, layout }: { home: LabHome; layout: 'wide' | 'narrow' }) {
  return (
    <div className={s.pairing} data-layout={layout}>
      <div className={s.tile} data-empty="">
        <span className={s.unreached}>
          <Icon name={PHONE} size={22} />
        </span>
      </div>
      <div className={s.side}>
        <span className={s.lead}>{home.key === 'mac' ? REACH.mac.title(home.name) : REACH.studio.title(home.name)}</span>
        <span className={s.note}>{home.key === 'mac' ? REACH.mac.note : REACH.studio.note}</span>
        {home.key === 'mac' ? (
          <span className={s.actions}>
            <Button onClick={() => lab.set({ reach: true })}>Let phones in</Button>
          </span>
        ) : (
          <span className={s.command}>
            <Code className={s.commandLine}>{REACH.studio.command}</Code>
            <CopyButton value={REACH.studio.command} ghost />
          </span>
        )}
      </div>
    </div>
  )
}

/** Where a phone's camera goes to get Althar: a page that sends iPhones to the App Store and the rest to Google Play (a stand-in; TestFlight today). */
const GET_APP = 'https://althar.dev/phone'

export interface PairingProps {
  layout: 'wide' | 'narrow'
  /** Done, once a phone is paired: back to where it was opened from. */
  onDone: () => void
}

export function Pairing(props: PairingProps) {
  const frame = useRef<HTMLDivElement>(null)
  // Opened in a dialog, the dialog takes focus rather than the code's Copy, as Manage homes does.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const dialog = frame.current?.closest('[role=dialog]')
      if (dialog instanceof HTMLElement && frame.current?.contains(document.activeElement)) dialog.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <div ref={frame} className={s.frame}>
      <Body {...props} />
    </div>
  )
}

function Body({ layout, onDone }: PairingProps) {
  const { reach, short, link } = useLab()
  const { home, invitation } = usePhones()
  const left = useLeft(home.key, invitation)
  // No Althar on the phone yet: the tile shows where to get it, for the phone's own camera, and back.
  const [getting, setGetting] = useState(false)
  // The code is made as the panel opens, and put away as it goes: it ran out, or it paired.
  useEffect(() => {
    if (!reach) return
    if (phones.get().invitations[home.key] === undefined) phones.issue(home.key)
    return () => phones.drop(home.key)
  }, [reach, home.key])
  if (!reach) return <Reach home={home} layout={layout} />
  if (invitation === null) return <div className={s.pairing} data-layout={layout} />
  const code = pairingCode(home, invitation, short)
  const qrSize = layout === 'wide' ? 232 : 236
  if (invitation.state === 'paired' && invitation.phone !== undefined)
    return (
      <div className={s.pairing} data-layout={layout}>
        <div className={s.tile} data-paired="">
          <Print home={home} size={layout === 'wide' ? 148 : 132} lit />
        </div>
        <div className={s.side}>
          <span className={s.lead}>{invitation.phone.name} is paired</span>
          <span className={s.note}>It opens {home.key === 'mac' ? 'This Mac' : home.name} now, with its projects and tasks.</span>
          <span className={s.actions}>
            <Button onClick={onDone}>Done</Button>
            <LinkButton onClick={() => phones.issue(home.key)}>Pair another phone</LinkButton>
          </span>
        </div>
      </div>
    )
  const expired = invitation.state === 'expired'
  if (getting && !expired && !link)
    return (
      <div className={s.pairing} data-layout={layout}>
        <div className={s.qrColumn}>
          <div className={s.tile}>
            <Qr text={GET_APP} size={qrSize} />
          </div>
          <span className={s.under}>
            <span className={s.waiting}>The pairing code waits</span>
            <span className={s.left} aria-label={`${mmss(left)} left`}>
              {mmss(left)}
            </span>
          </span>
        </div>
        <div className={s.side}>
          <span className={s.lead}>Get Althar on your phone</span>
          <span className={s.note}>Scan this with your phone's camera. It opens the App Store on an iPhone, Google Play on Android.</span>
          <span className={s.stores}>
            <span className={s.store}>
              <Icon name={PHONE} size={13} />
              iPhone · iOS 17 or later
            </span>
            <span className={s.store}>
              <Icon name={PHONE} size={13} />
              Android 10 or later
            </span>
          </span>
          <span className={s.actions}>
            <Button onClick={() => setGetting(false)}>I have it, show the code</Button>
          </span>
        </div>
      </div>
    )
  return (
    <div className={s.pairing} data-layout={layout}>
      <div className={s.qrColumn}>
        <div className={s.tile} data-expired={expired || undefined}>
          <Qr text={link ? linkOf(code) : code} size={qrSize} />
          {expired && (
            <span className={s.again}>
              <Button onClick={() => phones.issue(home.key)}>New code</Button>
            </span>
          )}
        </div>
        <span className={s.under}>
          {expired ? (
            <span className={s.waiting}>This code ran out</span>
          ) : (
            <>
              <span className={s.waiting}>
                <i className={s.beat} aria-hidden="true" />
                Waiting for your phone
              </span>
              <span className={s.left} aria-label={`${mmss(left)} left`}>
                {mmss(left)}
              </span>
            </>
          )}
        </span>
      </div>
      <div className={s.side}>
        {link ? (
          <span className={s.leadPair}>
            <span className={s.lead}>Scan it with your phone's camera</span>
            <span className={s.note}>It opens Althar, or the App Store or Google Play to get it first.</span>
          </span>
        ) : (
          <span className={s.lead}>Scan it with Althar on your phone</span>
        )}
        <span className={s.check}>
          <Print home={home} size={52} />
          <span className={s.checkWords}>
            <span>Your phone shows this print</span>
            <span className={s.words}>{wordsOfHome(home)}</span>
          </span>
        </span>
        <span className={s.or}>Or paste the code there</span>
        <span className={s.command} data-off={expired || undefined}>
          <Code className={s.commandLine}>{code}</Code>
          <CopyButton value={code} ghost disabled={expired} />
        </span>
        {!expired && !link && (
          <span className={s.getApp}>
            No Althar on your phone yet? <LinkButton onClick={() => setGetting(true)}>Get it</LinkButton>
          </span>
        )}
      </div>
    </div>
  )
}
