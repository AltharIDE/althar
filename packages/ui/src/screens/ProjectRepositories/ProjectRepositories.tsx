import { BackCrumb } from '../../chrome/BackCrumb/BackCrumb'
import { cx } from '../../lib/cx'
import { useDragOver } from '../../lib/dragOver'
import type { RootProps } from '../../lib/props'
import { Button } from '../../primitives/Button/Button'
import { below, Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import { RepositoryMap, type RepositoryMapProps } from '../../setup/RepositoryMap/RepositoryMap'
import s from './ProjectRepositories.module.css'

/*
 * A project's repositories, after it is made: what its tasks may change,
 * and where their work goes. The folders on this device and the code hosts
 * their remotes are on, wired together; a folder adds the repositories it
 * is or holds, picked or dropped on the page. One left out stays with the
 * tasks made with it, and nothing in its folder changes; the last one
 * stays, as tasks need somewhere to work. Each change is kept at once.
 */

export interface ProjectRepositoriesText {
  title: string
  lede: (project: string) => string
  /** The key that goes back, as its cap shows it. */
  backKey: string
  drop: string
  /** While a folder is held over the page. */
  dropping: string
  add: string
  leaveOut: (project: string) => string
}

export const projectRepositoriesText: ProjectRepositoriesText = {
  title: 'Repositories',
  lede: (project) => `What ${project}’s tasks may change, and where their work goes`,
  backKey: 'esc',
  drop: 'or drop a folder here',
  dropping: 'Let go to add it',
  add: 'Add a folder',
  leaveOut: (project) => `Leave out of ${project}`,
}

export type ProjectRepositoriesProps = RootProps<
  'div',
  Pick<
    RepositoryMapProps,
    'repositories' | 'hosts' | 'reading' | 'worktrees' | 'onRoleChange' | 'onTargetChange' | 'onLeaveOut' | 'onOpen' | 'onConnect'
  > & {
    project: string
    /** Back to the project; the consumer binds its key. */
    onBack: () => void
    /** Opens the system's folder picker. Without it, nothing is added here. */
    onAdd?: () => void
    /** Folders dropped on the page. Without it, a drop does nothing. */
    onDrop?: (files: readonly File[]) => void
    /** A folder is being added. */
    adding?: boolean
    /** Why the last change didn't happen. */
    error?: string
    headingLevel?: HeadingLevel
    text?: Partial<ProjectRepositoriesText>
    mapText?: RepositoryMapProps['text']
  }
>

export function ProjectRepositories({
  project,
  onBack,
  onAdd,
  onDrop,
  adding = false,
  error,
  headingLevel = 1,
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
    <div className={cx(s.page, over && s.over, className)} {...handlers} {...rest}>
      <div className={s.crumb}>
        <BackCrumb to={project} kbd={t.backKey} onBack={onBack} />
      </div>
      <header className={s.head}>
        <div className={s.headText}>
          <Heading level={headingLevel} className={s.title}>
            {t.title}
          </Heading>
          <p className={s.lede}>{t.lede(project)}</p>
        </div>
        {onAdd !== undefined && (
          <div className={s.add}>
            {onDrop !== undefined && (
              <span className={s.drop} aria-live="polite">
                {over ? t.dropping : t.drop}
              </span>
            )}
            <Button icon="plus" busy={adding} onClick={onAdd}>
              {t.add}
            </Button>
          </div>
        )}
      </header>
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
        {...(reading === undefined ? {} : { reading })}
        {...(worktrees === undefined ? {} : { worktrees })}
        {...(onLeaveOut === undefined ? {} : { onLeaveOut })}
        {...(onOpen === undefined ? {} : { onOpen })}
        {...(onConnect === undefined ? {} : { onConnect })}
      />
    </div>
  )
}
