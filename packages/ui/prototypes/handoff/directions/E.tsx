// Scrappy: E, answer first. The thread opens at its start, as a question with its answer under it: what the person asked,
// then where the task stands in the lead's words, then what needs them. How it got here follows, in order and quieter, as A
// draws it; the turn the handoff came from says only what came of it there, so nothing is said twice.
import { useRef } from 'react'

import { Round as KitRound, ThreadDivider } from '../../../src/index'
import { TaskThread as Thread, type TaskThreadProps } from '../../../../../apps/desktop/src/renderer/features/task/TaskThread'
import { Asks, HandoffWords, words } from '../calm'
import { Quieter } from './A'
import { useOpenAt, useStory, useWho } from './shared'

export function ThreadE(props: TaskThreadProps) {
  const { story } = useStory(props.rounds, props.threadId)
  const who = useWho(props.session)
  const top = useRef<HTMLElement>(null)
  useOpenAt(top, { start: true })
  const first = story.beats[0]
  const asked = first?.kind === 'block' && first.block.kind === 'you' ? first : null
  const handoff = story.handoff
  return (
    <>
      {asked !== null && <Thread {...props} rounds={[asked.block]} />}
      {handoff !== null && (
        <KitRound model={who.lead} at={handoff.from?.round.at ?? ''} data-item="handoff" ref={top}>
          <HandoffWords handoff={handoff} />
        </KitRound>
      )}
      <Asks calls={story.yours.calls} findings={story.yours.findings} onPassOn={props.onPassOn} />
      {handoff !== null && <ThreadDivider icon="clock">{words.howItGotHere}</ThreadDivider>}
      <Quieter props={props} story={story} who={who} from={asked === null ? 0 : 1} handoffHere={handoff === null} />
    </>
  )
}
