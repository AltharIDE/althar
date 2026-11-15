import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'

import { StrictMode, useEffect, useMemo, useState } from 'react'

import { createRoot } from 'react-dom/client'

import { HoverCardProvider } from '@althar/ui'

import { ServicesProvider } from '../../src/renderer/data/services'
import { TaskView } from '../../src/renderer/features/task/TaskView'
import { useTask } from '../../src/renderer/features/task/useTask'
import { fakeClient, fakeHost } from '../../tests/fixtures'
import { servicesFor } from '../../tests/render'
import { DIRECTIONS, type DirectionKey, LabContext } from './directions'
import { MOMENTS, momentOf, type Moment } from './moments'
import { INTROS, type Intro, LOOKS, type Look, nextIntro, nextLook, setIntro, setLook, toggleShared, useOnto } from './onto'
import s from './lab.module.css'

/*
 * The ship lab (README.md): the app's own task screen, on its Outputs, at
 * each moment from Ship to merged. Keys 1–4 swap the direction, ← and → step
 * along the path, H holds every hover open and N narrows the window.
 * ?d=a&m=readyChecks&hover=1&narrow=1 opens on one, for pictures.
 */

const params = new URLSearchParams(location.search)
document.documentElement.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light'

/** The task's screen at a moment, from a client that answers with it: opened on its Outputs, as the person would look. */
function Screen({ moment }: { moment: Moment }) {
  const services = useMemo(() => servicesFor(fakeClient({ getThread: async () => moment.snapshot }).client, fakeHost()), [moment])
  return (
    <ServicesProvider value={services}>
      <Task />
    </ServicesProvider>
  )
}

function Task() {
  const model = useTask('th1')
  const loaded = model.snapshot !== null
  // Opened on its Outputs, whatever face the moment would open on: the card is what changes.
  useEffect(() => {
    if (!loaded) return
    const shown = () =>
      [...document.querySelectorAll('[data-lab-scene] [role="radio"][aria-checked="true"]')].some((one) =>
        one.textContent?.startsWith('Outputs'),
      )
    // The composer has the focus, so its key would be typing: the face's own tab, pressed, as soon as it is there.
    const press = () =>
      [...document.querySelectorAll<HTMLElement>('[data-lab-scene] [role="radio"]')]
        .find((one) => one.textContent?.trim().startsWith('Outputs'))
        ?.click()
    press()
    let tries = 0
    const t = window.setInterval(() => {
      if (shown() || ++tries > 40) return window.clearInterval(t)
      press()
    }, 25)
    return () => window.clearInterval(t)
  }, [loaded])
  return <TaskView model={model} onBack={() => undefined} />
}

const write = (key: string, value: string | null) => {
  const url = new URL(location.href)
  if (value === null) url.searchParams.delete(key)
  else url.searchParams.set(key, value)
  history.replaceState(null, '', url)
}

function Lab() {
  const [direction, setDirection] = useState<DirectionKey>((params.get('d') as DirectionKey | null) ?? 'today')
  const [moment, setMoment] = useState(() => momentOf(params.get('m')))
  const [hover, setHover] = useState(params.get('hover') === '1')
  const [narrow, setNarrow] = useState(params.get('narrow') === '1')
  const at = MOMENTS.indexOf(moment)
  const step = (by: number) => setMoment((now) => MOMENTS[Math.min(MOMENTS.length - 1, Math.max(0, MOMENTS.indexOf(now) + by))] ?? now)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable="true"]')) return
      const picked = DIRECTIONS[Number(event.key) - 1]
      if (picked !== undefined) setDirection(picked.key)
      else if (event.key === 'ArrowRight') step(1)
      else if (event.key === 'ArrowLeft') step(-1)
      else if (event.key === 'h') setHover((on) => !on)
      else if (event.key === 'n') setNarrow((on) => !on)
      else if (event.key === 't') toggleShared()
      else if (event.key === 's') nextLook()
      else if (event.key === 'e') nextIntro()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => write('d', direction), [direction])
  useEffect(() => write('m', moment.key), [moment])
  useEffect(() => write('hover', hover ? '1' : null), [hover])
  useEffect(() => write('narrow', narrow ? '1' : null), [narrow])

  const onto = useOnto()
  const chosen = DIRECTIONS.find((one) => one.key === direction) ?? DIRECTIONS[0]!
  const lab = useMemo(() => ({ direction, moment, hover }), [direction, moment, hover])
  return (
    <div className={s.lab}>
      <div className={s.about}>
        <p className={s.where}>
          <span className={s.count}>
            {at + 1}/{MOMENTS.length}
          </span>
          <strong>{moment.label}.</strong> {moment.what}
        </p>
        <p className={s.idea}>{direction === 'today' ? `Today: ${moment.today}` : chosen.idea}</p>
      </div>
      <main className={s.scene} data-lab-scene data-narrow={narrow || undefined}>
        <LabContext.Provider value={lab}>
          <Screen key={moment.key} moment={moment} />
        </LabContext.Provider>
      </main>
      <nav className={s.bar} aria-label="Directions and moments">
        <div className={s.group}>
          {DIRECTIONS.map((one, index) => (
            <button key={one.key} type="button" aria-pressed={direction === one.key} onClick={() => setDirection(one.key)}>
              <kbd>{index + 1}</kbd> {one.label}
            </button>
          ))}
        </div>
        <div className={s.group}>
          <button type="button" onClick={() => step(-1)} disabled={at === 0} aria-label="Previous moment">
            <kbd>←</kbd>
          </button>
          <select value={moment.key} onChange={(event) => setMoment(momentOf(event.target.value))} aria-label="Moment">
            {MOMENTS.map((one, index) => (
              <option key={one.key} value={one.key}>
                {index + 1}. {one.label}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => step(1)} disabled={at === MOMENTS.length - 1} aria-label="Next moment">
            <kbd>→</kbd>
          </button>
        </div>
        <div className={s.group}>
          <button type="button" aria-pressed={hover} onClick={() => setHover((on) => !on)}>
            <kbd>H</kbd> Hovers
          </button>
          <button type="button" aria-pressed={narrow} onClick={() => setNarrow((on) => !on)}>
            <kbd>N</kbd> Narrow
          </button>
          {direction === 'b2' && (
            <label className={s.look}>
              <kbd>S</kbd>
              <select value={onto.look} onChange={(event) => setLook(event.target.value as Look)} aria-label="How Ship shows">
                {LOOKS.map((one) => (
                  <option key={one.key} value={one.key}>
                    {one.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {direction === 'b2' && (
            <label className={s.look}>
              <kbd>E</kbd>
              <select value={onto.intro} onChange={(event) => setIntro(event.target.value as Intro)} aria-label="How Ship explains itself">
                {INTROS.map((one) => (
                  <option key={one.key} value={one.key}>
                    {one.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {direction === 'b2' && (
            <button type="button" onClick={toggleShared}>
              <kbd>T</kbd> {onto.shared ? 'Shared main' : 'Solo main'}
            </button>
          )}
        </div>
      </nav>
    </div>
  )
}

const root = document.getElementById('root')
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <HoverCardProvider>
        <Lab />
      </HoverCardProvider>
    </StrictMode>,
  )
