import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'

import { Button, LinkButton } from '@althar/ui'
import { StrictMode, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { codeOfHash } from './pairing/code'
import { Print } from './pairing/Pairing'
import { printSeed, wordsOf } from './pairing/print'
import { type LabHome, mmss } from './pairing/world'
import s from './phone.module.css'

/*
 * The phone pairing lab: what althar.ai/pair shows a phone that scanned the
 * Mac's QR with its camera and has no Althar yet (with Althar, the phone opens
 * the app instead and this page is never seen). The code is after the #, so it
 * never reaches the site: the page reads it here, shows the home's print and
 * words and the time left, sends the phone to its store, and once Althar is
 * installed, Open in Althar hands it the code (althar://pair#…), so nothing
 * needs scanning again. Its own bar: iPhone or Android, a code run out, a page
 * opened without a code, dark.
 */

type Platform = 'ios' | 'android'

interface Read {
  readonly home: LabHome
  readonly host: string
  readonly expiresAt: number
}

const read = (hash: string): Read | null => {
  const code = codeOfHash(hash)
  if (code === null) return null
  try {
    const body = code
      .slice(code.indexOf('.') + 1)
      .replace(/-/g, '+')
      .replace(/_/g, '/')
    const json = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(body), (c) => c.charCodeAt(0)))) as {
      homeId: string
      tlsKeyPin: string
      origin: string
      expiresAt: number
    }
    const host = new URL(json.origin).hostname.split('.')[0] ?? 'your computer'
    return {
      home: { key: 'mac', name: host, homeId: json.homeId, tlsKeyPin: json.tlsKeyPin, origin: json.origin },
      host,
      expiresAt: json.expiresAt,
    }
  } catch {
    return null
  }
}

const STORE: Record<Platform, { label: string; note: string }> = {
  ios: { label: 'Get Althar on the App Store', note: 'Free, for iPhone with iOS 17 or later.' },
  android: { label: 'Get Althar on Google Play', note: 'Free, for Android 10 or later.' },
}

function Page({ platform, gone, hash }: { platform: Platform; gone: boolean; hash: string }) {
  const code = useMemo(() => read(hash), [hash])
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(tick)
  }, [])
  if (code === null)
    return (
      <main className={s.page}>
        <span className={s.brand}>Althar</span>
        <h1 className={s.title}>Pair a phone from your computer</h1>
        <p className={s.note}>
          In Althar on your Mac, open Settings › Computers and Add a phone, then scan the code it shows with your phone's camera.
        </p>
      </main>
    )
  const left = gone ? 0 : Math.max(0, code.expiresAt - now)
  const words = wordsOf(printSeed(code.home.homeId, code.home.tlsKeyPin))
  const open = `althar://pair${hash.startsWith('#') ? hash : `#${hash}`}`
  return (
    <main className={s.page}>
      <span className={s.brand}>Althar</span>
      <h1 className={s.title}>Pair this phone with {code.host}</h1>
      <div className={s.home}>
        <Print home={code.home} size={64} />
        <span className={s.homeWords}>
          <span>Your computer shows this print</span>
          <span className={s.words}>{words}</span>
        </span>
      </div>
      <ol className={s.steps}>
        <li className={s.step}>
          <span className={s.num}>1</span>
          <span className={s.stepBody}>
            <a className={s.store} href={platform === 'ios' ? 'https://apps.apple.com/' : 'https://play.google.com/'}>
              {STORE[platform].label}
            </a>
            <span className={s.small}>{STORE[platform].note}</span>
          </span>
        </li>
        <li className={s.step}>
          <span className={s.num}>2</span>
          <span className={s.stepBody}>
            {left > 0 ? (
              <>
                <Button variant="ink" onClick={() => window.location.assign(open)}>
                  Open in Althar
                </Button>
                <span className={s.small}>
                  Once it's installed, come back here. The code works for <span className={s.time}>{mmss(left)}</span> more.
                </span>
              </>
            ) : (
              <>
                <span className={s.stepTitle}>This code ran out</span>
                <span className={s.small}>Once Althar is installed, make a new code on your computer and scan it again.</span>
              </>
            )}
          </span>
        </li>
      </ol>
      <p className={s.foot}>The code stays on this phone: it is after the # in this page's address, which never reaches althar.ai.</p>
    </main>
  )
}

function Lab() {
  const params = new URLSearchParams(window.location.search)
  const [platform, setPlatform] = useState<Platform>(params.get('platform') === 'android' ? 'android' : 'ios')
  const [gone, setGone] = useState(params.get('gone') === '1')
  const [none, setNone] = useState(false)
  const [dark, setDark] = useState(params.get('theme') === 'dark')
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }, [dark])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      if (key === 'i') setPlatform((was) => (was === 'ios' ? 'android' : 'ios'))
      if (key === 'x') setGone((was) => !was)
      if (key === 'e') setNone((was) => !was)
      if (key === 't') setDark((was) => !was)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className={s.lab}>
      <div className={s.phone} data-lab-phone>
        <div className={s.url}>althar.ai/pair</div>
        <Page platform={platform} gone={gone} hash={none ? '' : window.location.hash} />
      </div>
      <div className={s.bar}>
        <LinkButton onClick={() => setPlatform(platform === 'ios' ? 'android' : 'ios')}>
          I · {platform === 'ios' ? 'iPhone' : 'Android'}
        </LinkButton>
        <LinkButton onClick={() => setGone(!gone)}>X · {gone ? 'Ran out' : 'Code live'}</LinkButton>
        <LinkButton onClick={() => setNone(!none)}>E · {none ? 'No code' : 'With code'}</LinkButton>
        <LinkButton onClick={() => setDark(!dark)}>T · {dark ? 'Dark' : 'Light'}</LinkButton>
      </div>
    </div>
  )
}

const root = document.getElementById('root')
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <Lab />
    </StrictMode>,
  )
