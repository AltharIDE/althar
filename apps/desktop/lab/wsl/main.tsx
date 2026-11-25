import './platform'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'

import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { DIRECTIONS, type DirectionKey, TOUCHPOINTS, type TouchpointKey, variantsOf } from './catalog'
import { Scene } from './scenes'
import s from './lab.module.css'

/*
 * The WSL lab (README.md): how a person whose code, agents and sign-ins live
 * in WSL meets it in Althar on Windows, in three directions, on the app's own
 * screens. The bar along the bottom swaps in place: the direction (A, B, C),
 * the touchpoint (1–6), its state (X, or Shift+X back), and light or dark (T).
 */

interface State {
  readonly d: DirectionKey
  readonly t: TouchpointKey
  readonly x: string
  readonly dark: boolean
}

const fit = (d: DirectionKey, t: TouchpointKey, x: string | null) => {
  const variants = variantsOf(d, t)
  return variants.find((one) => one.key === x)?.key ?? variants[0]!.key
}

const read = (): State => {
  const params = new URLSearchParams(location.search)
  const d = (DIRECTIONS.find((one) => one.key === params.get('d'))?.key ?? 'a') as DirectionKey
  const t = (TOUCHPOINTS.find((one) => one.key === params.get('t'))?.key ?? '1') as TouchpointKey
  return { d, t, x: fit(d, t, params.get('x')), dark: params.get('theme') === 'dark' }
}

const write = (state: State) => {
  const params = new URLSearchParams({ d: state.d, t: state.t, x: state.x })
  if (state.dark) params.set('theme', 'dark')
  history.replaceState(null, '', `?${params.toString()}`)
  document.documentElement.dataset.theme = state.dark ? 'dark' : 'light'
}

function Lab() {
  const [state, setState] = useState(read)
  const { d, t, x, dark } = state
  const go = (next: Partial<State>) =>
    setState((was) => {
      const d = next.d ?? was.d
      const t = next.t ?? was.t
      // A state kept across directions where the other has it, so A and B compare the same moment.
      return { d, t, x: fit(d, t, next.x ?? was.x), dark: next.dark ?? was.dark }
    })
  useEffect(() => write(state), [state])
  const variants = variantsOf(d, t)
  const at = variants.findIndex((one) => one.key === x)
  const variant = variants[at]!
  const step = (by: number) => go({ x: variants[(at + by + variants.length) % variants.length]!.key })
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === 'a' || key === 'b' || key === 'c') return go({ d: key })
      if (TOUCHPOINTS.some((one) => one.key === key)) return go({ t: key as TouchpointKey })
      if (key === 'x') return step(event.shiftKey ? -1 : 1)
      if (key === 't') return go({ dark: !dark })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })
  return (
    <div className={s.lab}>
      <div className={s.stage} key={`${d}${t}${x}`}>
        <Scene d={d} t={t} x={x} />
      </div>
      <div className={s.bar} role="toolbar" aria-label="Lab">
        <div className={s.row}>
          {DIRECTIONS.map((one) => (
            <button key={one.key} type="button" aria-pressed={d === one.key} onClick={() => go({ d: one.key })} title={one.line}>
              <kbd>{one.key.toUpperCase()}</kbd>
              {one.name}
            </button>
          ))}
          <span className={s.rule} />
          {TOUCHPOINTS.map((one) => (
            <button key={one.key} type="button" aria-pressed={t === one.key} onClick={() => go({ t: one.key })}>
              <kbd>{one.key}</kbd>
              {one.name}
            </button>
          ))}
          <span className={s.gap} />
          <button type="button" aria-pressed={dark} onClick={() => go({ dark: !dark })}>
            <kbd>T</kbd>
            {dark ? 'Dark' : 'Light'}
          </button>
        </div>
        <div className={s.row}>
          {variants.length > 1 ? (
            <span className={s.variants}>
              <kbd>X</kbd>
              {variants.map((one) => (
                <button key={one.key} type="button" aria-pressed={one.key === x} onClick={() => go({ x: one.key })}>
                  {one.label}
                </button>
              ))}
            </span>
          ) : (
            <span className={s.variants}>
              <button type="button" aria-pressed>
                {variant.label}
              </button>
            </span>
          )}
          <span className={s.caption} title={variant.caption}>
            {variant.caption}
          </span>
        </div>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Lab />
  </StrictMode>,
)
