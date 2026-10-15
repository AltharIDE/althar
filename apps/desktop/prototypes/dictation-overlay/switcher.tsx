// Throwaway: the slim bar under the window: which idea, which state, where to go, and what the idea is.
import { useEffect } from 'react'

import { LinkButton, Segmented, Select } from '@althar/ui'

import { navigate } from './nav'
import { A_PLACES, act, type APlace, type Crowd, CROWDS, type Idea, IDEAS, type Preset, PRESETS, useLive } from './voice'
import s from './page.module.css'

const PLACES: ReadonlyArray<[string, string]> = [
  ['Home', '/'],
  ['Board', '/projects/p1?room=board'],
  ['Coordinator', '/projects/p1?room=talk'],
  ['A task', '/threads/th-scroll'],
  ['Another task', '/threads/th-quick'],
]

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || target.closest('input, textarea, select, [role="textbox"], [role="menu"], [role="listbox"]') !== null)

export function Switcher() {
  const live = useLive()
  // 1–6 for an idea, ← and → for the one before or after, ⇧← and ⇧→ for the state; ⌘⇧D stops and starts, as in the app.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'd' && (event.metaKey || event.ctrlKey) && event.shiftKey) {
        event.preventDefault()
        const now = live.session
        if (now.phase === 'listening' || now.phase === 'paused') act.stop()
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return
      const ideas = IDEAS.map((one) => one.value)
      const at = ideas.indexOf(live.idea)
      if (/^[1-9]$/.test(event.key)) {
        const idea = ideas[Number(event.key) - 1]
        if (idea !== undefined) act.setIdea(idea)
        return
      }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      const step = event.key === 'ArrowLeft' ? -1 : 1
      event.preventDefault()
      if (event.shiftKey) {
        const presets = PRESETS.map((one) => one.value)
        act.setPreset(presets[(presets.indexOf(live.preset) + step + presets.length) % presets.length] as Preset)
      } else act.setIdea(ideas[(at + step + ideas.length) % ideas.length] as Idea)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [live.idea, live.preset, live.session])

  const note =
    live.idea === 'A'
      ? (A_PLACES.find((one) => one.value === live.place)?.note ?? '')
      : (IDEAS.find((one) => one.value === live.idea)?.note ?? '')
  return (
    <div className={s.switcher}>
      <Segmented<Idea>
        label="Idea"
        value={live.idea}
        onChange={act.setIdea}
        options={IDEAS.map((one, index) => ({ value: one.value, label: one.label, kbd: String(index + 1) }))}
      />
      {live.idea === 'A' && (
        <Segmented<APlace>
          label="Where A goes among the pills"
          value={live.place}
          onChange={act.setPlace}
          options={A_PLACES.map((one) => ({ value: one.value, label: one.label }))}
        />
      )}
      <Select<Preset> label="State" value={live.preset} onChange={act.setPreset} options={PRESETS} width={200} />
      <Select<Crowd> label="What else runs" value={live.crowd} onChange={act.setCrowd} options={CROWDS} width={200} />
      <LinkButton onClick={() => act.setPreset(live.preset)}>Start over</LinkButton>
      <span className={s.places}>
        {PLACES.map(([label, path]) => (
          <LinkButton key={label} onClick={() => navigate(path)}>
            {label}
          </LinkButton>
        ))}
      </span>
      <span className={s.note} title={note}>
        {note}
      </span>
    </div>
  )
}
