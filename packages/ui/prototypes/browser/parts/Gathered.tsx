// Scrappy: the comments gathered on a page, at its foot, as DEV-175 gathers the diff's: each a chip with its crop on hover,
// then where they go and Send. One message carries them all.
import { Icon } from '../../../src/foundations/Icon/Icon'
import { cx } from '../../../src/lib/cx'
import { Button } from '../../../src/primitives/Button/Button'
import { HoverCard } from '../../../src/primitives/HoverCard/HoverCard'
import { IconButton } from '../../../src/primitives/IconButton/IconButton'
import { LinkButton } from '../../../src/primitives/LinkButton/LinkButton'
import { Menu, MenuGroup, MenuItem } from '../../../src/primitives/Menu/Menu'
import { TaskGlyph } from '../../../src/primitives/TaskGlyph/TaskGlyph'
import { TaskStatus } from '../../../src/foundations/vocabulary'
import { type Destination, OTHER, proto, TASK, useComments, useProto } from '../state'
import { CommentCard } from './CommentCard'
import s from './Gathered.module.css'

const nameOf = (to: Destination) => (to.kind === 'coordinator' ? 'althar’s coordinator' : to.taskId === TASK.id ? TASK.title : OTHER.title)

export interface GatheredProps {
  scope: string
  /** Once sent: where to go to read what the lead got. */
  onOpenSent: (to: Destination) => void
  openLabel?: string
  /** Where they go: fixed to the task's lead (B, C), or picked (A). */
  to: Destination
  onTo?: (to: Destination) => void
}

export function Gathered({ scope, to, onTo, onOpenSent, openLabel }: GatheredProps) {
  const comments = useComments(scope)
  const line = useProto().lines[scope]
  if (comments.length === 0 && line?.kind === 'sent')
    return (
      <div className={s.strip} role="status">
        <Icon name="check" size={13} />
        <span className={s.said}>
          {line.count === 1 ? 'Comment' : `${line.count} comments`} sent to {nameOf(line.to)}.
        </span>
        <LinkButton onClick={() => onOpenSent(line.to)}>
          {openLabel ?? (line.to.kind === 'coordinator' ? 'Open the conversation' : 'Open the task')}
        </LinkButton>
        <span className={s.grow} />
        <IconButton icon="close" label="Dismiss" size="small" onClick={() => proto.line(scope, undefined)} />
      </div>
    )
  if (comments.length === 0) return null
  const drawing = comments.some((one) => one.crop === 'drawing')
  return (
    <div className={s.strip}>
      <ol className={s.chips}>
        {comments.map((one, at) => (
          <li key={one.id}>
            <HoverCard placement="above" width={340} card={<CommentCard comment={one} n={at + 1} />}>
              <button type="button" className={s.chip} onClick={() => proto.edit(one.id)}>
                <span className={s.n}>{at + 1}</span>
                <span className={s.note}>{one.note}</span>
              </button>
            </HoverCard>
          </li>
        ))}
      </ol>
      <span className={s.grow} />
      <LinkButton onClick={() => proto.discard(scope)}>Discard</LinkButton>
      {onTo !== undefined ? (
        <Menu
          label="Send to"
          align="end"
          width={320}
          trigger={
            <button type="button" className={s.to}>
              <span className={s.toWord}>To</span>
              {to.kind === 'task' ? <TaskGlyph status={TaskStatus.Yours} /> : <Icon name="agents" size={13} />}
              <span className={s.toName}>{nameOf(to)}</span>
              <Icon name="chevronD" size={12} />
            </button>
          }
        >
          <MenuGroup label="A task’s lead">
            {[TASK, OTHER].map((task) => (
              <MenuItem
                key={task.id}
                lead={<TaskGlyph status={task.id === TASK.id ? TaskStatus.Yours : TaskStatus.Running} />}
                onSelect={() => onTo({ kind: 'task', taskId: task.id })}
              >
                {task.title}
              </MenuItem>
            ))}
          </MenuGroup>
          <MenuGroup label="Or">
            <MenuItem icon="agents" onSelect={() => onTo({ kind: 'coordinator' })}>
              althar’s coordinator
            </MenuItem>
          </MenuGroup>
        </Menu>
      ) : null}
      <Button className={cx(s.send)} busy={drawing} icon="arrow" onClick={() => proto.send(scope, to)}>
        {onTo !== undefined ? 'Send' : comments.length === 1 ? 'Send to the lead' : `Send ${comments.length} to the lead`}
      </Button>
    </div>
  )
}
