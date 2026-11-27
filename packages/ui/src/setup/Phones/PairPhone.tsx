import { useMemo } from 'react'

import { cx } from '../../lib/cx'
import { Button } from '../../primitives/Button/Button'
import { Code } from '../../primitives/Code/Code'
import { CopyButton } from '../../primitives/CopyButton/CopyButton'
import { Icon } from '../../foundations/Icon/Icon'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { printDots, printSeed, wordsOf } from './print'
import { qrOf, qrPath } from './qr'
import s from './PairPhone.module.css'

/*
 * Pairing a phone with a home: the QR, which is a link a phone's own camera
 * opens (Althar where it has it, its store where it hasn't), the home's print
 * and three words beside it, which the phone shows too and asks the person to
 * check, and the code itself to paste. Under the QR, its five minutes run
 * down while it waits. Paired, the print takes the QR's place with its point
 * lit, as on the phone. Before phones can reach the home at all, it says what
 * that takes. Wide in a sheet or a dialog, narrow in a popover. It shows what
 * it is given: the app makes the code, ticks the time and hears the phone.
 */

export type PairPhoneState =
  /** The home is making the code. */
  | { readonly kind: 'making' }
  /** Phones can't reach the home: This Mac can let them in (switchable); a host's is set up on it. */
  | { readonly kind: 'closed'; readonly switchable: boolean; readonly letting?: boolean; readonly problem?: string }
  | { readonly kind: 'waiting'; readonly code: string; readonly link: string; readonly left: number }
  | { readonly kind: 'expired'; readonly code: string; readonly link: string }
  | { readonly kind: 'paired'; readonly code: string; readonly device: string }
  /** The home couldn't make a code: why, in its words; `again` where trying again may help. */
  | { readonly kind: 'failed'; readonly problem: string; readonly again?: boolean }

export interface PairPhoneProps {
  /** The home, as the window names it: This Mac, or a remote home's name. */
  readonly home: string
  readonly state: PairPhoneState
  readonly layout?: 'wide' | 'narrow'
  /** Where phones reach the home, in a line, under the code: "On the same Wi-Fi as this Mac." */
  readonly reach?: string
  readonly onLetIn?: () => void
  /** Stops letting phones in, where the window can (This Mac); paired phones stay paired for when they're let in again. */
  readonly onShutOut?: () => void
  /** Why stopping didn't take, in the home's words. */
  readonly shutProblem?: string
  readonly onNewCode: () => void
  readonly onDone: () => void
  readonly onPairAnother: () => void
}

const CONFIGURE =
  'althar-host configure-network --origin https://<this-host>:6769 --listen-address 0.0.0.0 --tls-certificate <certificate.pem> --tls-key <key.pem>'

export const minutesLeft = (ms: number) => {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** The home's id and key pin, from inside the code: what its print is drawn from, as the phone draws it. */
const seedOfCode = (code: string): string | null => {
  try {
    const body = code
      .slice(code.indexOf('.') + 1)
      .replace(/-/g, '+')
      .replace(/_/g, '/')
    const json: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(body), (c) => c.charCodeAt(0))))
    if (typeof json !== 'object' || json === null || !('homeId' in json) || !('tlsKeyPin' in json)) return null
    return typeof json.homeId === 'string' && typeof json.tlsKeyPin === 'string' ? printSeed(json.homeId, json.tlsKeyPin) : null
  } catch {
    return null
  }
}

/** The QR, dark on light in either appearance, as a phone's camera reads it best. */
export function Qr({ text, size, className }: { text: string; size: number; className?: string }) {
  const path = useMemo(() => {
    // A home whose certificate is large makes a code past what a QR holds: the code to paste stays.
    try {
      const matrix = qrOf(text)
      return { d: qrPath(matrix, 2), n: matrix.size + 4 }
    } catch {
      return null
    }
  }, [text])
  if (path === null)
    return (
      <span className={cx(s.tooLong, className)}>This home’s code is too long for a QR. Paste it in Althar on your phone instead.</span>
    )
  return (
    <svg className={cx(s.qr, className)} width={size} height={size} viewBox={`0 0 ${path.n} ${path.n}`} shapeRendering="crispEdges">
      <title>Pairing code</title>
      <path d={path.d} />
    </svg>
  )
}

/** A home's print, as the phone draws it: lit at its point once a phone is paired. */
export function HomePrint({ seed, size, lit = false }: { seed: string; size: number; lit?: boolean }) {
  const dots = useMemo(() => printDots(seed, size >= 120 ? 1.4 : 1.66), [seed, size])
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

function Closed({
  home,
  state,
  layout,
  onLetIn,
  onShutOut,
  shutProblem,
}: Pick<PairPhoneProps, 'home' | 'layout' | 'onLetIn' | 'onShutOut' | 'shutProblem'> & { state: PairPhoneState & { kind: 'closed' } }) {
  return (
    <div className={s.pairing} data-layout={layout}>
      <div className={s.tile} data-empty="">
        <span className={s.unreached}>
          <Icon name="phone" size={22} />
        </span>
      </div>
      <div className={s.side}>
        {state.switchable ? (
          <>
            <span className={s.lead}>Let phones in to {home}</span>
            <span className={s.note}>
              Phones on the same Wi-Fi reach it while this Mac is awake. Each one pairs with a code from here before it can open anything.
            </span>
            {state.problem !== undefined && <span className={s.problem}>{state.problem}</span>}
            <span className={s.actions}>
              <Button variant="ink" busy={state.letting === true} onClick={onLetIn}>
                Let phones in
              </Button>
              {onShutOut !== undefined && <LinkButton onClick={onShutOut}>Stop letting phones in</LinkButton>}
            </span>
            {shutProblem !== undefined && <span className={s.problem}>{shutProblem}</span>}
          </>
        ) : (
          <>
            <span className={s.lead}>{home} doesn’t take phones yet</span>
            <span className={s.note}>A phone reaches a home over HTTPS. Run this on it, restart its host, and the code shows here.</span>
            <span className={s.command}>
              <Code className={s.commandLine}>{CONFIGURE}</Code>
              <CopyButton value={CONFIGURE} ghost />
            </span>
          </>
        )}
      </div>
    </div>
  )
}

export function PairPhone({
  home,
  state,
  layout = 'wide',
  reach,
  onLetIn,
  onShutOut,
  shutProblem,
  onNewCode,
  onDone,
  onPairAnother,
}: PairPhoneProps) {
  const code = state.kind === 'waiting' || state.kind === 'expired' || state.kind === 'paired' ? state.code : null
  const seed = useMemo(() => (code === null ? null : seedOfCode(code)), [code])
  const frame = (body: React.ReactNode) => <div className={s.frame}>{body}</div>
  if (state.kind === 'closed')
    return frame(
      <Closed
        home={home}
        state={state}
        layout={layout}
        {...(onLetIn === undefined ? {} : { onLetIn })}
        {...(onShutOut === undefined ? {} : { onShutOut })}
        {...(shutProblem === undefined ? {} : { shutProblem })}
      />,
    )
  if (state.kind === 'failed')
    return frame(
      <div className={s.pairing} data-layout={layout}>
        <div className={s.tile} data-empty="" />
        <div className={s.side}>
          <span className={s.lead}>No code this time</span>
          <span className={s.problem}>{state.problem}</span>
          {state.again !== false && (
            <span className={s.actions}>
              <Button onClick={onNewCode}>Try again</Button>
            </span>
          )}
        </div>
      </div>,
    )
  if (state.kind === 'paired')
    return frame(
      <div className={s.pairing} data-layout={layout}>
        <div className={s.tile} data-paired="">
          {seed !== null && <HomePrint seed={seed} size={layout === 'wide' ? 148 : 132} lit />}
        </div>
        <div className={s.side}>
          <output className={s.lead}>{state.device} is paired</output>
          <span className={s.note}>It opens {home} now, with its projects and tasks.</span>
          <span className={s.actions}>
            <Button onClick={onDone}>Done</Button>
            <LinkButton onClick={onPairAnother}>Pair another phone</LinkButton>
          </span>
        </div>
      </div>,
    )
  const expired = state.kind === 'expired'
  const size = layout === 'wide' ? 232 : 236
  return frame(
    <div className={s.pairing} data-layout={layout}>
      <div className={s.qrColumn}>
        <div className={s.tile} data-expired={expired || undefined} data-making={state.kind === 'making' || undefined}>
          {state.kind !== 'making' && <Qr text={state.link} size={size} />}
          {expired && (
            <span className={s.again}>
              <Button onClick={onNewCode}>New code</Button>
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
              {state.kind === 'waiting' && (
                <span className={s.left} aria-label={`${minutesLeft(state.left)} left`}>
                  {minutesLeft(state.left)}
                </span>
              )}
            </>
          )}
        </span>
      </div>
      <div className={s.side}>
        <span className={s.leadPair}>
          <span className={s.lead}>Scan it with your phone’s camera</span>
          <span className={s.note}>It opens Althar on your phone.</span>
        </span>
        {seed !== null && (
          <span className={s.check}>
            <HomePrint seed={seed} size={52} />
            <span className={s.checkWords}>
              <span>Your phone shows this print</span>
              <span className={s.words}>{wordsOf(seed)}</span>
            </span>
          </span>
        )}
        {code !== null && (
          <>
            <span className={s.or}>Or paste the code in Althar on your phone</span>
            <span className={s.command} data-off={expired || undefined}>
              <Code className={s.commandLine}>{code}</Code>
              <CopyButton value={code} ghost disabled={expired} />
            </span>
          </>
        )}
        {(reach !== undefined || onShutOut !== undefined) && (
          <span className={s.reach}>
            {reach}
            {onShutOut !== undefined && (
              <>
                {' '}
                <LinkButton onClick={onShutOut}>Stop letting phones in</LinkButton>
              </>
            )}
          </span>
        )}
        {shutProblem !== undefined && <span className={s.problem}>{shutProblem}</span>}
      </div>
    </div>,
  )
}
