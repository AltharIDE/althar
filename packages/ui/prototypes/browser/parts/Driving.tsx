// Scrappy: D: the lead using the task's preview, the same browser the person sees: its pointer, a flash where it takes a screenshot,
// and one line saying who has the preview, with Take over and Give it back. Pressing the page takes it over too.
import { Icon } from '../../../src/foundations/Icon/Icon'
import { Button } from '../../../src/primitives/Button/Button'
import { Spinner } from '../../../src/primitives/Spinner/Spinner'
import { proto, TASK, useProto } from '../state'
import s from './Driving.module.css'
import type { Place } from './Frame'
import { glyph } from './icons'

/** Over the page: the lead's pointer and its screenshots' flash; while it has the page, a press takes it over. */
export function Driving({ place }: { place: Place }) {
  const p = useProto()
  const driving = p.driving
  if (driving === null || driving.by === 'done') return null
  const left = place.left + (driving.cursor?.x ?? 0) * place.width * place.scale
  const top = (driving.cursor?.y ?? 0) * place.height * place.scale
  return (
    <>
      {driving.by === 'lead' && <div className={s.catch} onPointerDown={() => proto.takeOver()} aria-hidden="true" />}
      {driving.flash && <div className={s.flash} style={{ left: place.left, width: place.width * place.scale }} />}
      {driving.cursor !== null && driving.by === 'lead' && (
        <div className={s.pointer} style={{ transform: `translate(${left}px, ${top}px)` }}>
          <Icon name={glyph('cursor')} size={18} className={s.arrow} />
          <span className={s.who}>{TASK.lead.replace(/ \d.*$/, '')}</span>
        </div>
      )}
    </>
  )
}

/** Who has the preview, under its bar. */
export function DrivingLine() {
  const p = useProto()
  const driving = p.driving
  if (driving === null) return null
  if (driving.by === 'done')
    return (
      <div className={s.line}>
        <Icon name="check" size={13} />
        <span className={s.words}>
          {TASK.lead} took {driving.shots.length} screenshots here.
        </span>
        <span className={s.grow} />
        <Button size="small" variant="quiet" onClick={() => proto.set({ face: false })}>
          Conversation
        </Button>
      </div>
    )
  if (driving.by === 'person')
    return (
      <div className={s.line}>
        <Icon name={glyph('cursor')} size={13} />
        <span className={s.words}>You have the preview. {TASK.lead} waits.</span>
        <span className={s.grow} />
        <Button size="small" onClick={() => proto.giveBack()}>
          Give it back
        </Button>
      </div>
    )
  return (
    <div className={`${s.line} ${s.lead}`}>
      <Spinner size="small" />
      <span className={s.words}>
        <b>{TASK.lead}</b> · {driving.said}
      </span>
      <span className={s.grow} />
      <Button size="small" onClick={() => proto.takeOver()}>
        Take over
      </Button>
    </div>
  )
}
