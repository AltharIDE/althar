import type { ReactNode } from 'react'

import type { RootProps } from '../../lib/props'
import { cx } from '../../lib/cx'
import { Button } from '../../primitives/Button/Button'
import { Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import { Menu, MenuItem } from '../../primitives/Menu/Menu'
import { SplitButton } from '../../primitives/SplitButton/SplitButton'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import { type HostedRepository, type ProjectSetupText, type SetupHost, SetupRepositories } from '../ProjectSetup/ProjectSetup'
import s from './RepositoryClone.module.css'

/*
 * A repository cloned into a project that has some already: one of the
 * person's own on the code hosts connected, found as it is typed, or one a
 * pasted URL names; then Clone. It lies flat in the section, between
 * hairlines, with no box of its own. Where it lands shows on the row
 * chosen, the usual place unless another is chosen from beside Clone. One
 * on this computer already is added from where it is, not cloned again. A
 * host not connected yet connects in place, in the room the list had, as a
 * new project's does.
 */

export interface RepositoryCloneText {
  title: string
  /** Beside Clone: the menu of where it lands. */
  where: string
  /** In it: another folder, through the system's picker. */
  elsewhere: string
  cancel: string
  clone: string
  add: string
  list?: Partial<ProjectSetupText>
}

export const repositoryCloneText: RepositoryCloneText = {
  title: 'Clone a repository',
  where: 'Choose where it goes',
  elsewhere: 'Another folder…',
  cancel: 'Cancel',
  clone: 'Clone',
  add: 'Add',
}

export type RepositoryCloneProps = RootProps<
  'section',
  {
    hosts: readonly SetupHost[]
    /** Null while they are read. */
    repositories: readonly HostedRepository[] | null
    /** The hosts whose repositories couldn't be read, by id. */
    failed?: readonly string[]
    onRetry?: () => void
    query: string
    onQuery: (query: string) => void
    /** A repository a pasted URL names: shown alone, in place of those found. */
    pasted?: HostedRepository | null
    chosen: string | null
    onChoose: (id: string) => void
    onConnect: (host: string) => void
    /** A host being connected, in place: its walk, in the room the list had. */
    connecting?: ReactNode
    /** The folder it is cloned into, as the person knows the place; null where there's nowhere usual yet. */
    where: string | null
    /** Asks the person where it goes. */
    onWhere: () => void
    onClone: () => void
    onCancel: () => void
    /** The list's height, kept whatever it shows. */
    height?: number
    headingLevel?: HeadingLevel
    text?: Partial<RepositoryCloneText>
  }
>

export function RepositoryClone({
  hosts,
  repositories,
  failed,
  onRetry,
  query,
  onQuery,
  pasted,
  chosen,
  onChoose,
  onConnect,
  connecting,
  where,
  onWhere,
  onClone,
  onCancel,
  height = 220,
  headingLevel = 4,
  text,
  className,
  ...rest
}: RepositoryCloneProps) {
  const t = { ...repositoryCloneText, ...text }
  const walking = connecting !== undefined && connecting !== null
  const picked = chosen === null ? undefined : pasted?.id === chosen ? pasted : (repositories ?? []).find((one) => one.id === chosen)
  const here = picked?.here ?? null
  // Where the one chosen lands: in the place shown, under its name.
  const landing = picked === undefined || here !== null || where === null ? null : `${where}/${picked.name}`
  return (
    <section className={cx(s.clone, className)} aria-label={t.title} {...rest}>
      <VisuallyHidden>
        <Heading level={headingLevel}>{t.title}</Heading>
      </VisuallyHidden>
      <SetupRepositories
        hosts={hosts}
        repositories={repositories}
        {...(failed === undefined ? {} : { failed })}
        {...(onRetry === undefined ? {} : { onRetry })}
        query={query}
        onQuery={onQuery}
        {...(pasted === undefined ? {} : { pasted })}
        chosen={chosen}
        onChoose={onChoose}
        onConnect={onConnect}
        {...(connecting === undefined ? {} : { connecting })}
        landing={landing}
        height={height}
        {...(t.list === undefined ? {} : { text: t.list })}
      />
      {!walking && (
        <div className={s.foot}>
          <Button size="small" variant="quiet" onClick={onCancel}>
            {t.cancel}
          </Button>
          {here !== null ? (
            <Button size="small" variant="signal" icon="plus" onClick={onClone}>
              {t.add}
            </Button>
          ) : (
            <SplitButton
              size="small"
              variant="signal"
              icon="download"
              disabled={picked === undefined}
              onClick={onClone}
              moreLabel={t.where}
              menu={(trigger) => (
                <Menu label={t.where} trigger={trigger} align="end">
                  {where !== null && (
                    <MenuItem icon="check" onSelect={() => undefined}>
                      {where}
                    </MenuItem>
                  )}
                  <MenuItem icon="folder" onSelect={onWhere}>
                    {t.elsewhere}
                  </MenuItem>
                </Menu>
              )}
            >
              {t.clone}
            </SplitButton>
          )}
        </div>
      )}
    </section>
  )
}
