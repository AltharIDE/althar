import type { ReactNode } from 'react'

import type { RootProps } from '../../lib/props'
import { cx } from '../../lib/cx'
import { Button } from '../../primitives/Button/Button'
import { Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { type HostedRepository, type ProjectSetupText, type SetupHost, SetupRepositories } from '../ProjectSetup/ProjectSetup'
import s from './RepositoryClone.module.css'

/*
 * A repository cloned into a project that has some already: one of the
 * person's own on the code hosts connected, found as it is typed, or one a
 * pasted URL names; then where it goes, the usual place unless they choose
 * another, and Clone. One on this computer already is added from where it
 * is, not cloned again. A host not connected yet connects in place, in the
 * room the list had, as a new project's does.
 */

export interface RepositoryCloneText {
  title: string
  into: (where: string) => string
  chooseWhere: string
  change: string
  cancel: string
  clone: string
  add: string
  list?: Partial<ProjectSetupText>
}

export const repositoryCloneText: RepositoryCloneText = {
  title: 'Clone a repository',
  into: (where) => `Into ${where}`,
  chooseWhere: 'Choose where it goes',
  change: 'Change',
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
  return (
    <section className={cx(s.clone, className)} aria-label={t.title} {...rest}>
      <Heading level={headingLevel} className={s.title}>
        {t.title}
      </Heading>
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
        height={height}
        {...(t.list === undefined ? {} : { text: t.list })}
      />
      {!walking && (
        <div className={s.foot}>
          <p className={s.where}>
            {here !== null ? (
              <span className={s.mono} title={here}>
                {here}
              </span>
            ) : where === null ? (
              <LinkButton onClick={onWhere}>{t.chooseWhere}</LinkButton>
            ) : (
              <>
                <span title={where}>{t.into(where)}</span>
                <LinkButton onClick={onWhere} aria-label={`${t.change}: ${t.into(where)}`}>
                  {t.change}
                </LinkButton>
              </>
            )}
          </p>
          <span className={s.actions}>
            <Button size="small" variant="quiet" onClick={onCancel}>
              {t.cancel}
            </Button>
            <Button
              size="small"
              variant="signal"
              icon={here === null ? 'download' : 'plus'}
              disabled={picked === undefined}
              onClick={onClone}
            >
              {here === null ? t.clone : t.add}
            </Button>
          </span>
        </div>
      )}
    </section>
  )
}
