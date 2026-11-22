import { Icon } from '../../foundations/Icon/Icon'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { Menu, MenuRadioGroup, MenuRadioItem } from '../../primitives/Menu/Menu'
import { cx } from '../../lib/cx'
import s from './ArtifactHead.module.css'

/*
 * An artifact's own chat's top row (ADR-104, "Talking to an artifact"). The
 * chat is the artifact's, so the row is the artifact's, never a task's: no
 * step, no state, nothing that waits on the person. The way back to every
 * artifact, then the artifact by its name, which opens the project's
 * artifacts to go to another, and who made it, quietly. The canvas beside it
 * keeps its own head: its versions, comments, saving and sharing.
 */

export interface ArtifactHeadText {
  back: string
  /** The menu of the project's artifacts its name opens. */
  others: string
  /** One its chat is still drawing the first version of. */
  drawing: string
}

export const artifactHeadText: ArtifactHeadText = {
  back: 'Back to Artifacts',
  others: 'The project’s artifacts',
  drawing: 'Drawing',
}

export interface ArtifactHeadArtifact {
  readonly id: string
  readonly title: string
  readonly drawing?: boolean
}

export interface ArtifactHeadProps {
  /** The artifact the chat is about: its id among `artifacts`, and its title. */
  current: string
  title: string
  /** Who made it, in a few words: “Lead of Gift a class”, “Coordinator”. */
  by?: string | null
  /** The project's artifacts, to go to another: newest first. */
  artifacts: ReadonlyArray<ArtifactHeadArtifact>
  onPick: (id: string) => void
  onBack: () => void
  /** The key that goes back, said in its tooltip; the consumer binds it. */
  kbd?: string
  className?: string
  text?: Partial<ArtifactHeadText>
}

export function ArtifactHead({ current, title, by, artifacts, onPick, onBack, kbd, className, text }: ArtifactHeadProps) {
  const t = { ...artifactHeadText, ...text }
  return (
    <div className={cx(s.head, className)}>
      <IconButton icon="chevronL" label={t.back} {...(kbd === undefined ? {} : { kbd })} size="small" className={s.back} onClick={onBack} />
      <Menu
        label={t.others}
        width={300}
        trigger={
          <button type="button" className={s.name}>
            <span className={s.title}>{title}</span>
            <Icon name="chevronD" size={14} />
          </button>
        }
      >
        <MenuRadioGroup label={t.others} value={current} onChange={onPick}>
          {artifacts.map((one) => (
            <MenuRadioItem key={one.id} value={one.id} {...(one.drawing === true ? { description: t.drawing } : {})}>
              {one.title}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </Menu>
      {by !== undefined && by !== null && by !== '' && <span className={s.by}>{by}</span>}
    </div>
  )
}
