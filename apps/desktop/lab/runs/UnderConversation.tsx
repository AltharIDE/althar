import { TaskFace as KitTaskFace, type TaskFaceProps } from '@althar/ui'

import { FootBody, FootEnd, FootTabs, useFoot } from './Below'
import { cx } from './parts'
import { useLab } from './state'
import s from './directions.module.css'

/*
 * B2 · Under the conversation. B's band, but the conversation's own: under
 * its composer, as wide as its column, holding what was run from it. Raised,
 * it takes its height from the thread alone; the board keeps all of its own,
 * and the composer stays just over the run, where Help me fix it puts it. In
 * a task, the band is under the task's conversation, and its terminals open
 * in the task's worktree: where the foot is says which folder.
 */

function ConversationFoot() {
  const foot = useFoot()
  if (foot === null) return null
  return (
    <section className={cx(s.underFoot, foot.raised && s.underRaised)} aria-label="Runs and terminals">
      <div className={cx(s.band, s.underBand)}>
        <FootTabs foot={foot} className={s.underTabs} />
        <FootEnd foot={foot} />
      </div>
      {foot.raised && <FootBody foot={foot} />}
    </section>
  )
}

/** The kit's conversation face, as the project's screen takes it in the lab: in B2, with its runs and terminals under it. */
export function TaskFace(props: TaskFaceProps) {
  const { d } = useLab()
  if (d !== 'b2') return <KitTaskFace {...props} />
  return (
    <>
      <KitTaskFace {...props} />
      <ConversationFoot />
    </>
  )
}
