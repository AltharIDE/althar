import { HomePrint, printSeed, wordsOf } from '@althar/ui'
import { useEffect, useState, useSyncExternalStore } from 'react'

import { PHONE_APP } from '../content/phone'
import s from './Pair.module.css'

/*
 * althar.ai/pair: what a phone's camera opens from the pairing QR in Althar on
 * a computer, where the phone has no Althar yet (with Althar, the phone opens
 * the app instead, and this page is never seen). The code is after the #, so
 * it never reaches this site: the page reads it here, shows the home's print
 * and words, the same the computer shows, and the time the code has left.
 * It sends the phone to its store, and once Althar is installed, Open in
 * Althar hands the app the code (althar://pair#…), so nothing is scanned
 * again. The address format is the contracts' pairingLinkOf.
 */

const APP_LINK = 'althar://pair'

interface Read {
  readonly seed: string
  readonly host: string
  readonly expiresAt: number
}

/** The home's id, pin, address and expiry, from the code after the #: nothing else of it is shown. */
export const readCode = (hash: string): Read | null => {
  const fragment = hash.replace(/^#/, '')
  if (!/^\d+\.[A-Za-z0-9_-]+$/.test(fragment)) return null
  try {
    const body = fragment
      .slice(fragment.indexOf('.') + 1)
      .replace(/-/g, '+')
      .replace(/_/g, '/')
    const json: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(body), (c) => c.charCodeAt(0))))
    if (typeof json !== 'object' || json === null) return null
    const { homeId, tlsKeyPin, origin, expiresAt } = json as Record<string, unknown>
    if (typeof homeId !== 'string' || typeof tlsKeyPin !== 'string' || typeof origin !== 'string' || typeof expiresAt !== 'number')
      return null
    return { seed: printSeed(homeId, tlsKeyPin), host: new URL(origin).hostname.split('.')[0] ?? 'your computer', expiresAt }
  } catch {
    return null
  }
}

const subscribe = (listener: () => void) => {
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}
/** The address's #, once the page runs; the built page has none. */
const useHash = () =>
  useSyncExternalStore(
    subscribe,
    () => window.location.hash,
    () => '',
  )

export type Platform = 'ios' | 'android' | 'other'
const usePlatform = (): Platform =>
  useSyncExternalStore(
    () => () => undefined,
    () => (/iPhone|iPad|iPod/.test(navigator.userAgent) ? 'ios' : /Android/.test(navigator.userAgent) ? 'android' : 'other'),
    () => 'other',
  )

const minutesLeft = (ms: number) => {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function useLeft(until: number | null) {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    if (until === null) return
    const tick = () => setNow(Date.now())
    const timer = setInterval(tick, 500)
    tick()
    return () => clearInterval(timer)
  }, [until])
  return until === null || now === null ? null : Math.max(0, until - now)
}

function Store({ platform }: { platform: Platform }) {
  const stores = [
    {
      key: 'ios',
      label: 'Get Althar on the App Store',
      link: PHONE_APP.appStore,
      note: `For iPhone, iOS ${PHONE_APP.iosVersion} or later.`,
    },
    {
      key: 'android',
      label: 'Get Althar on Google Play',
      link: PHONE_APP.googlePlay,
      note: `For Android ${PHONE_APP.androidVersion} or later.`,
    },
  ].filter((store) => platform === 'other' || store.key === platform)
  const listed = stores.filter((store) => store.link !== null)
  if (listed.length === 0)
    return <span className={s.small}>Althar for phones isn’t in the App Store or Google Play yet. It’s coming soon.</span>
  return (
    <>
      {listed.map((store) => (
        <span key={store.key} className={s.storeWay}>
          <a className={s.store} href={store.link ?? undefined}>
            {store.label}
          </a>
          <span className={s.small}>{store.note}</span>
        </span>
      ))}
    </>
  )
}

export function Pair() {
  const hash = useHash()
  const platform = usePlatform()
  const left = useLeft(readCode(hash)?.expiresAt ?? null)
  return <PairPage hash={hash} platform={platform} left={left} />
}

/** The page for an address's #, a phone's platform and what the code has left (null until the page runs). */
export function PairPage({ hash, platform, left }: { hash: string; platform: Platform; left: number | null }) {
  const code = readCode(hash)
  return (
    <main id="main" className={s.page}>
      <div className={s.column}>
        <a className={s.brand} href="/">
          Althar
        </a>
        {code === null ? (
          <>
            <h1 className={s.title}>Pair a phone with your computer</h1>
            <p className={s.lede}>
              In Althar on your computer, open the homes menu and choose Pair a phone…, then scan the code it shows with your phone’s
              camera.
            </p>
          </>
        ) : (
          <>
            <h1 className={s.title}>Pair this phone with {code.host}</h1>
            <div className={s.home}>
              <HomePrint seed={code.seed} size={64} />
              <span className={s.homeWords}>
                <span>Your computer shows this print</span>
                <span className={s.words}>{wordsOf(code.seed)}</span>
              </span>
            </div>
            <ol className={s.steps}>
              <li className={s.step}>
                <span className={s.num}>1</span>
                <span className={s.stepBody}>
                  <Store platform={platform} />
                </span>
              </li>
              <li className={s.step}>
                <span className={s.num}>2</span>
                <span className={s.stepBody}>
                  {left === 0 ? (
                    <>
                      <span className={s.stepTitle}>This code ran out</span>
                      <span className={s.small}>Once Althar is installed, make a new code on your computer and scan it again.</span>
                    </>
                  ) : (
                    <>
                      <a className={s.open} href={`${APP_LINK}${hash}`}>
                        Open in Althar
                      </a>
                      <span className={s.small}>
                        Once it’s installed, come back here.
                        {left !== null && (
                          <>
                            {' '}
                            The code works for <span className={s.time}>{minutesLeft(left)}</span> more.
                          </>
                        )}
                      </span>
                    </>
                  )}
                </span>
              </li>
            </ol>
            <p className={s.foot}>The code stays on this phone: it’s after the # in this page’s address, which never reaches althar.ai.</p>
          </>
        )}
      </div>
    </main>
  )
}
