import { cx } from '../../lib/cx'
import { useDragOver } from '../../lib/dragOver'
import type { RootProps } from '../../lib/props'
import { Button } from '../../primitives/Button/Button'
import { below, type HeadingLevel } from '../../primitives/Heading/Heading'
import { SettingGroup } from '../../setup/Preferences/Preferences'
import { RepositoryMap, type RepositoryMapProps } from '../../setup/RepositoryMap/RepositoryMap'
import s from './ProjectRepositories.module.css'

/*
 * A project's repositories, in its settings: what its tasks may change, and
 * where their work goes. The folders on this computer and the code hosts
 * their remotes are on, wired together, under a heading with the way to add
 * a folder; one is picked, or dropped anywhere on them. One left out stays
 * with the tasks made with it, and nothing in its folder changes; the last
 * one stays, as tasks need somewhere to work. Each change is kept at once.
 */

export interface ProjectRepositoriesText {
  title: string
  /** What they are, under the heading, where the page around them doesn't say. */
  note?: string
  drop: string
  /** While a folder is held over them. */
  dropping: string
  add: string
  leaveOut: (project: string) => string
}

export const projectRepositoriesText: ProjectRepositoriesText = {
  title: 'Repositories',
  drop: 'or drop a folder here',
  dropping: 'Let go to add it',
  add: 'Add a folder',
  leaveOut: (project) => `Leave out of ${project}`,
}

export type ProjectRepositoriesProps = RootProps<
  'section',
  Pick<
    RepositoryMapProps,
    'repositories' | 'hosts' | 'reading' | 'worktrees' | 'onRoleChange' | 'onTargetChange' | 'onLeaveOut' | 'onOpen' | 'onConnect'
  > & {
    project: string
    /** Opens the system's folder picker. Without it, nothing is added here. */
    onAdd?: () => void
    /** Folders dropped on them. Without it, a drop does nothing. */
    onDrop?: (files: readonly File[]) => void
    /** A folder is being added. */
    adding?: boolean
    /** Why the last change didn't happen. */
    error?: string
    /** The heading's rank; the map's columns are one below. */
    headingLevel?: HeadingLevel
    text?: Partial<ProjectRepositoriesText>
    mapText?: RepositoryMapProps['text']
  }
>

export function ProjectRepositories({
  project,
  onAdd,
  onDrop,
  adding = false,
  error,
  headingLevel = 2,
  text,
  mapText,
  repositories,
  hosts,
  reading,
  worktrees,
  onRoleChange,
  onTargetChange,
  onLeaveOut,
  onOpen,
  onConnect,
  className,
  ...rest
}: ProjectRepositoriesProps) {
  const t = { ...projectRepositoriesText, ...text }
  const { over, handlers } = useDragOver(onDrop)
  return (
    <SettingGroup
      title={t.title}
      {...(t.note === undefined ? {} : { note: t.note })}
      headingLevel={headingLevel}
      {...(onAdd === undefined
        ? {}
        : {
            action: (
              <span className={s.add}>
                {onDrop !== undefined && (
                  <span className={s.drop} aria-live="polite">
                    {over ? t.dropping : t.drop}
                  </span>
                )}
                <Button size="small" icon="plus" busy={adding} onClick={onAdd}>
                  {t.add}
                </Button>
              </span>
            ),
          })}
      className={cx(s.repositories, over && s.over, className)}
      {...handlers}
      {...rest}
    >
      {error !== undefined && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      <RepositoryMap
        repositories={repositories}
        hosts={hosts}
        onRoleChange={onRoleChange}
        onTargetChange={onTargetChange}
        headingLevel={below(headingLevel)}
        text={{ leaveOut: t.leaveOut(project), ...mapText }}
        className={s.map}
        {...(reading === undefined ? {} : { reading })}
        {...(worktrees === undefined ? {} : { worktrees })}
        {...(onLeaveOut === undefined ? {} : { onLeaveOut })}
        {...(onOpen === undefined ? {} : { onOpen })}
        {...(onConnect === undefined ? {} : { onConnect })}
      />
    </SettingGroup>
  )
}
