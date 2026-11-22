import {
  BackCrumb as KitBackCrumb,
  type BackCrumbProps,
  ProjectHeader as KitProjectHeader,
  type ProjectHeaderProps,
  Room,
  TaskHeader as KitTaskHeader,
  type TaskHeaderProps,
  TitleBar,
} from '@althar/ui'

import { artifactOf } from '../artifacts'
import { chat, useChat } from '../chat'
import { ChatEnd, ChatStart } from '../parts/ChatBar'
import { roundOf, useLab } from '../state'

/*
 * The kit, as the task's and the project's screens take it (in place of
 * @althar/ui, for TaskView and ProjectView), with their top rows the lab's
 * where the chat is an artifact's. Gift a class's chat is its artifact's: its
 * row names the artifact and who sees it, not a task's step. In the project's
 * Artifacts, an artifact opened there has the same row, its way back to
 * every artifact. Everything else is the kit's own.
 */

export * from '@althar/ui'

/** The chat that is an artifact's: Gift a class, where its lead drew it. */
const ARTIFACT_CHAT = 'Gift a class'

export function BackCrumb(props: BackCrumbProps) {
  const { beside } = useChat()
  useLab()
  if (props.title !== ARTIFACT_CHAT) return <KitBackCrumb {...props} />
  return (
    <ChatStart
      key={roundOf()}
      back={props.to}
      onBack={props.onBack}
      artifact={artifactOf(beside)}
      task={ARTIFACT_CHAT}
      onPick={chat.beside}
    />
  )
}

export function TaskHeader<F extends string>(props: TaskHeaderProps<F>) {
  const { beside } = useChat()
  const { d } = useLab()
  if (props.title !== ARTIFACT_CHAT) return <KitTaskHeader {...props} />
  return <ChatEnd key={roundOf()} artifact={artifactOf(beside)} talk={d === 'd' ? 'pin' : 'conversation'} />
}

export function ProjectHeader(props: ProjectHeaderProps) {
  const { room } = useChat()
  useLab()
  if (room === null || props.room !== Room.Artifacts) return <KitProjectHeader {...props} />
  const artifact = artifactOf(room)
  return (
    <TitleBar
      lights={props.lights ?? 'none'}
      {...(props.className === undefined ? {} : { className: props.className })}
      end={<ChatEnd key={`${roundOf()}|${room}`} artifact={artifact} talk="conversation" room />}
    >
      <ChatStart
        key={roundOf()}
        back="Artifacts"
        onBack={() => chat.room(null)}
        artifact={artifact}
        task={artifact.task}
        onPick={chat.room}
        room
      />
    </TitleBar>
  )
}
