import type { ReactNode } from 'react'

import { BackCrumb } from '../../chrome/BackCrumb/BackCrumb'
import { TitleBar } from '../../chrome/TitleBar/TitleBar'
import { Icon } from '../../foundations/Icon/Icon'
import { Menu, MenuRadioGroup, MenuRadioItem } from '../../primitives/Menu/Menu'
import s from './ArtifactHead.module.css'

/*
 * An artifact's top row (ADR-104, "Talking to an artifact"): opened from the
 * project's Artifacts, the artifact takes the window as a task does, and this
 * is its one row, in place of the project's. The chat beside it is the
 * artifact's, so the row is the artifact's, never a task's: no step, no
 * state, nothing that waits on the person. The way back to every artifact,
 * then the artifact by its name, which opens the project's artifacts to go to
 * another, and who made it, quietly; at its end what is for the whole
 * artifact (its versions, comments, saving and downloading), which its canvas
 * puts there. The canvas keeps only what floats on it.
 */

export interface ArtifactHeadText {
  back: string
  /** The menu of the project's artifacts its name opens. */
  others: string
  /** One its chat is still drawing the first version of. */
  drawing: string
}

export const artifactHeadText: ArtifactHeadText = {
  back: 'Artifacts',
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
  /** What is for the whole artifact, at the row's end: its canvas's versions and actions. */
  end?: ReactNode
  className?: string
  text?: Partial<ArtifactHeadText>
}

export function ArtifactHead({ current, title, by, artifacts, onPick, onBack, kbd, end, className, text }: ArtifactHeadProps) {
  const t = { ...artifactHeadText, ...text }
  return (
    <TitleBar lights="none" end={end} {...(className === undefined ? {} : { className })}>
      <BackCrumb to={t.back} onBack={onBack} {...(kbd === undefined ? {} : { kbd })} />
      <span className={s.sep} aria-hidden="true">
        /
      </span>
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
    </TitleBar>
  )
}
