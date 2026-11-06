// Scrappy: B's Preview face: the task's own run, in the task's own session, its path the only thing typed; comments to its lead.
// D draws the same face with the lead using it too.
import { Segmented } from '../../../src/primitives/Segmented/Segmented'
import { RUNS, runOf, shown, verdictOf } from '../addresses'
import { addressOf, proto, TASK, useProto, type Width } from '../state'
import { Bar, Line } from './Bar'
import { Driving, DrivingLine } from './Driving'
import { Frame, type Place } from './Frame'
import { Gathered } from './Gathered'
import s from './Screens.module.css'
import { NotRunning } from './Stand'

/** Where the page is drawn: the window's width, or a phone's. */
export function WidthSwitch() {
  const p = useProto()
  return (
    <Segmented<Width>
      label="Width"
      value={p.width}
      onChange={(width) => proto.set({ width })}
      options={[
        { value: 'wide', label: 'Desktop' },
        { value: 'narrow', label: 'Phone', tooltip: { label: '390 wide' } },
      ]}
    />
  )
}

/** A link in the task's run: on the run, it goes there; anywhere else is the person's browser, as today. */
export const followInRun = (next: string) => (runOf(next) === 'task' ? proto.navigate('preview', next) : proto.outside(next))

export function Preview() {
  const p = useProto()
  const page = p.preview
  const address = addressOf(page)
  const verdict = verdictOf(address)
  const driven = p.direction === 'D' && p.driving !== null && p.driving.by === 'lead'
  return (
    <div className={s.face}>
      <Bar
        scope="preview"
        page={page}
        host={shown(RUNS.task.address)}
        session="task"
        extra={<WidthSwitch />}
        pointable={p.running === 'up' && !driven}
      />
      <Line scope="preview" />
      {p.direction === 'D' && <DrivingLine />}
      {p.running !== 'up' ? (
        <NotRunning starting={p.running === 'starting'} />
      ) : verdict.kind === 'page' ? (
        <Frame
          scope="preview"
          address={address}
          src={verdict.src}
          reloads={page.reloads}
          onFollow={followInRun}
          pageWidth={p.width === 'narrow' ? 390 : null}
          {...(p.direction === 'D' ? { layer: (place: Place) => <Driving place={place} />, scrollY: p.driving?.scroll ?? null } : {})}
        />
      ) : (
        <NotRunning starting={false} />
      )}
      <Gathered
        scope="preview"
        to={{ kind: 'task', taskId: TASK.id }}
        openLabel="Conversation"
        onOpenSent={() => proto.set({ face: false })}
      />
    </div>
  )
}
