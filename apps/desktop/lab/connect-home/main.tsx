import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'

import { StrictMode, useEffect, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { Button } from '@althar/ui'

import { ConnectHome } from '../../src/renderer/features/homes/ConnectHome'
import { useFlow, type Method } from './flow'
import { failNext, homes } from './host'
import { DrawingDirection } from './directions/a'
import { SCENARIOS, type Scenario } from './directions/install'
import s from './lab.module.css'

/*
 * The Connect a home lab (README.md): directions for the dialog, each made
 * of the kit's components and the app's own connection form, on a home host
 * that answers after a while (F fails its next answer). The bar swaps the
 * direction in place (0 as built, A the drawing, with keys), the way of connecting
 * (P, S), and whether this is the person's first home (I). ?s= drives the
 * dialog to a scene, for shooting.
 */

const DIRECTIONS = [
  { key: '0', label: 'As built' },
  { key: 'a', label: 'The drawing' },
] as const
type Direction = (typeof DIRECTIONS)[number]['key']

const params = new URLSearchParams(location.search)
const scene = params.get('s')
document.documentElement.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light'

const read = () => {
  const now = new URLSearchParams(location.search)
  return {
    d: (DIRECTIONS.find((one) => one.key === now.get('d'))?.key ?? 'a') as Direction,
    m: (now.get('m') === 'ssh' ? 'ssh' : 'pair') as Method,
    first: now.get('first') === '1',
    x: (SCENARIOS.find((one) => one.key === now.get('x'))?.key ?? 'ok') as Scenario,
  }
}
type State = ReturnType<typeof read>

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const input = (label: string) => {
  const field = [...document.querySelectorAll('label')].find((one) => one.textContent?.trim() === label)
  const id = field?.getAttribute('for')
  return (id === null || id === undefined ? null : document.getElementById(id)) as HTMLInputElement | null
}
const type = (label: string, value: string) => {
  const field = input(label)
  if (field === null) throw new Error(`No field ${label}`)
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, value)
  field.dispatchEvent(new Event('input', { bubbles: true }))
}
const find = (name: string) =>
  [...document.querySelectorAll('[role=dialog] button, [role=dialog] [role=radio]')].find(
    (one) =>
      one.textContent?.trim() === name ||
      one.getAttribute('aria-label') === name ||
      (one.getAttribute('role') === 'radio' && one.textContent?.startsWith(name) === true),
  )
const press = (name: string, must = true) => {
  const button = find(name)
  if (!(button instanceof HTMLElement)) {
    if (must) throw new Error(`No button ${name}`)
    return
  }
  button.click()
}

/** Drives the dialog to the scene, as a person would. */
const drive = async ({ m, first }: State) => {
  await wait(200)
  if (scene === null || (first && scene === 'intro')) return
  const step = () => wait(90)
  if (first && scene.startsWith('setup')) {
    press('Set one up')
    await step()
    if (scene === 'setup-line') press('One command on the server')
    return
  }
  if (first && scene === 'installing') {
    press('Set one up')
    await step()
    press('Continue')
    await step()
    type('SSH host', 'deploy@vps.example.com')
    await step()
    press('Set it up')
    return
  }
  if (m === 'ssh') press('SSH', false)
  else press('Pairing code', false)
  await step()
  if (scene === 'form') return
  if (m === 'ssh') {
    type('SSH host', 'deploy@vps.example.com')
    await step()
    if (scene === 'draft') return
    if (scene === 'options') {
      press('Connection options')
      await step()
      type('Port', '2222')
      return
    }
    press('Check host')
    await step()
    if (scene === 'connecting' || scene === 'failed') {
      press('Connect')
      await step()
    }
    return
  }
  type('Pairing code', 'k7Qp-3xWm-9fTa')
  await step()
  press('Continue', false)
  await step()
  if (scene === 'connecting' || scene === 'failed') {
    press('Pair and open')
    await step()
  }
}

function Dialogs({
  state,
  shown,
  chipIn,
  onHide,
  onShow,
  onClose,
}: {
  state: State
  shown: boolean
  chipIn: Element | null
  onHide: () => void
  onShow: () => void
  onClose: () => void
}) {
  const flow = useFlow(homes, onClose, state.m)
  if (state.d === '0') return <ConnectHome homes={homes} onClose={onClose} />
  return (
    <DrawingDirection
      flow={flow}
      first={state.first}
      scenario={state.x}
      shown={shown}
      chipIn={chipIn}
      onHide={onHide}
      onShow={onShow}
      onClose={onClose}
    />
  )
}

const next = (x: Scenario) => SCENARIOS[(SCENARIOS.findIndex((one) => one.key === x) + 1) % SCENARIOS.length]!.key

let driven = false
function Lab() {
  const [state, setStateNow] = useState(read)
  const [open, setOpen] = useState(true)
  // Closed while setting a home up: it goes on, on the window's chip, until that brings it back.
  const [shown, setShown] = useState(true)
  const [chipIn, setChipIn] = useState<HTMLElement | null>(null)
  const [round, setRound] = useState(0)
  const failing = useSyncExternalStore(failNext.subscribe, failNext.get)
  const set = (next: Partial<State>) => {
    const merged = { ...state, ...next }
    const url = new URLSearchParams(location.search)
    url.set('d', merged.d)
    url.set('m', merged.m)
    url.set('x', merged.x)
    if (merged.first) url.set('first', '1')
    else url.delete('first')
    history.replaceState(null, '', `?${url.toString()}`)
    setStateNow(merged)
    setOpen(true)
    setShown(true)
    setRound((was) => was + 1)
  }
  useEffect(() => {
    if (driven) return
    driven = true
    void drive(state).then(() => document.body.setAttribute('data-driven', ''))
  }, [state])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return
      const key = event.key.toLowerCase()
      const direction = DIRECTIONS.find((one) => one.key === key)
      if (direction !== undefined) return set({ d: direction.key })
      if (key === 'p') return set({ m: 'pair' })
      if (key === 's') return set({ m: 'ssh' })
      if (key === 'i') return set({ first: !state.first })
      if (key === 'f') return failNext.set(!failNext.get())
      if (key === 'x') return set({ x: next(state.x) })
      if (key === 'r') return set({})
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  return (
    <div className={s.lab}>
      <div className={s.window}>
        {/* the window's bar, with its homes chip at the end: a setup under way shows there */}
        <div className={s.titlebar}>
          <span ref={setChipIn} className={s.chipSlot} />
        </div>
        {(!open || !shown) && <div className={s.closed}>{!open && <Button onClick={() => set({})}>Connect a home…</Button>}</div>}
        {open && (
          <Dialogs
            key={`${state.d}-${state.m}-${state.first}-${state.x}-${round}`}
            state={state}
            shown={shown}
            chipIn={chipIn}
            onHide={() => setShown(false)}
            onShow={() => setShown(true)}
            onClose={() => setOpen(false)}
          />
        )}
      </div>
      <div className={s.bar} role="toolbar" aria-label="Directions">
        {DIRECTIONS.map((one) => (
          <button key={one.key} type="button" aria-pressed={state.d === one.key} onClick={() => set({ d: one.key })}>
            <kbd>{one.key.toUpperCase()}</kbd>
            {one.label}
          </button>
        ))}
        <span className={s.rule} />
        <button type="button" aria-pressed={state.m === 'pair'} onClick={() => set({ m: 'pair' })}>
          <kbd>P</kbd>Pairing code
        </button>
        <button type="button" aria-pressed={state.m === 'ssh'} onClick={() => set({ m: 'ssh' })}>
          <kbd>S</kbd>SSH
        </button>
        <span className={s.rule} />
        <button type="button" aria-pressed={state.first} onClick={() => set({ first: !state.first })}>
          <kbd>I</kbd>First home
        </button>
        <span className={s.rule} />
        <button type="button" aria-pressed={state.x !== 'ok'} onClick={() => set({ x: next(state.x) })}>
          <kbd>X</kbd>Setup: {SCENARIOS.find((one) => one.key === state.x)?.label}
        </button>
        <span className={s.gap} />
        <button type="button" aria-pressed={failing} onClick={() => failNext.set(!failing)}>
          <kbd>F</kbd>Fail next answer
        </button>
        <button type="button" onClick={() => set({})}>
          <kbd>R</kbd>Start over
        </button>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Lab />
  </StrictMode>,
)
