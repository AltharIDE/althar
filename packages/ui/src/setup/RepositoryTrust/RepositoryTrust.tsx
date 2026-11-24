import { useId, useState } from 'react'

import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { BrandMark } from '../../foundations/Marks/Marks'
import { Brand } from '../../foundations/brands/brands'
import { AskCard, AskFoot } from '../../primitives/Ask/Ask'
import { Button } from '../../primitives/Button/Button'
import { Dialog } from '../../primitives/Dialog/Dialog'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { AltharLine } from '../../thread/AltharLine/AltharLine'
import type { HeadingLevel } from '../../primitives/Heading/Heading'
import { Problem } from '../../primitives/Problem/Problem'
import s from './RepositoryTrust.module.css'

/*
 * A repository's own agent settings that run something on this computer
 * (DEV-280): its Claude Code hooks and helpers, Codex's hooks and
 * commands, OpenCode's plugins and servers, each under the file it is in,
 * with which agent runs it, when, and the command, set as code. Until the
 * person trusts them, a lead in the repository starts without them.
 *
 * Asked, as adding a project or a task's Review asks it, it is a quiet
 * card with Run without them and Trust these settings: nothing waits on
 * it, a lead starts either way. Kept, in the project's settings, it says
 * what was decided, with what turns it round: Take back, or Trust.
 */

export interface RepositoryTrustText {
  kicker: string
  /** What the card asks, of a repository. */
  what: (repository: string) => string
  /** Under the files: an agent that loads them however this is answered. */
  loadsAnyway: (agents: string) => string
  trust: string
  without: string
  takeBack: string
  /** What was decided of them, as the project's settings say it. */
  trusted: string
  declined: string
  undecided: string
  changed: string
  /** The task's line's way to them. */
  review: string
  /** The dialog Review opens, of a repository. */
  reviewTitle: (repository: string) => string
  /** Under the dialog's title, which names the repository already. */
  reviewLine: string
  /** Adding a project: the step's title, of the project. */
  stepTitle: (project: string) => string
  /** The task's line once answered from it. */
  answered: { trusted: string; without: string }
}

export const repositoryTrustText: RepositoryTrustText = {
  kicker: 'Agent settings',
  what: (repository) => `${repository}’s agent settings run these on this computer as agents work.`,
  loadsAnyway: (agents) => `${agents} can’t be started without them yet: it runs them either way.`,
  trust: 'Trust these settings',
  without: 'Run without them',
  takeBack: 'Take back',
  trusted: 'Trusted',
  declined: 'Leads start without them',
  undecided: 'Not decided: leads start without them',
  changed: 'Changed since you trusted them: leads start without them',
  review: 'Review',
  reviewTitle: (repository) => `${repository}’s agent settings`,
  reviewLine: 'Agents run these on this computer as they work.',
  stepTitle: (project) => `Before ${project}’s agents start`,
  answered: { trusted: 'Trusted: its next session starts with them.', without: 'Its leads start without them.' },
}

/** One thing a settings file runs: where in the file, when its agent runs it, and the command. */
export interface TrustRun {
  key: string
  when: string
  command: string
}

/** A settings file that runs something, as its repository has it now. */
export interface TrustFile {
  /** The agent that reads it, by its brand: `claude-code`, `codex` or `opencode`. */
  agent: string
  agentName: string
  file: string
  runs: ReadonlyArray<TrustRun>
  /** Its agent loads it whatever the person says (Codex, for now). */
  loadsAnyway?: boolean
}

const brandOf = (agent: string): Brand | null => ((Object.values(Brand) as ReadonlyArray<string>).includes(agent) ? (agent as Brand) : null)

/** The files and what each runs, a file's agent and path above its commands. */
export function TrustFiles({ files, className }: { files: ReadonlyArray<TrustFile>; className?: string }) {
  return (
    <ul className={cx(s.files, className)}>
      {files.map((file) => {
        const brand = brandOf(file.agent)
        return (
          <li key={`${file.agent}:${file.file}`} className={s.file}>
            <p className={s.fileHead}>
              {brand !== null && <BrandMark brand={brand} size={13} className={s.mark} />}
              <span className={s.agent}>{file.agentName}</span>
              <code className={s.path} title={file.file}>
                {file.file}
              </code>
            </p>
            <ul className={s.runs}>
              {file.runs.map((run) => (
                <li key={run.key} className={s.run}>
                  <span className={s.when} title={run.key}>
                    {run.when}
                  </span>
                  <code className={s.command}>{run.command}</code>
                </li>
              ))}
            </ul>
          </li>
        )
      })}
    </ul>
  )
}

/** The agents among the files that load them anyway, named once each. */
const anyway = (files: ReadonlyArray<TrustFile>) => [
  ...new Set(files.filter((file) => file.loadsAnyway === true).map((file) => file.agentName)),
]

export type RepositoryTrustAskProps = RootProps<
  'div',
  {
    repository: string
    files: ReadonlyArray<TrustFile>
    onTrust: () => void
    onWithout: () => void
    /** Why the last answer didn't go through. */
    error?: string
    text?: Partial<RepositoryTrustText>
  }
>

/** A repository's agent settings, asked: trust them, or have its leads start without them. */
export function RepositoryTrustAsk({ repository, files, onTrust, onWithout, error, text, ...rest }: RepositoryTrustAskProps) {
  const t = { ...repositoryTrustText, ...text }
  const loads = anyway(files)
  return (
    <AskCard icon="terminal" kicker={t.kicker} what={t.what(repository)} quiet {...rest}>
      <TrustFiles files={files} />
      {loads.length > 0 && <p className={s.note}>{t.loadsAnyway(loads.join(' and '))}</p>}
      {error !== undefined && <Problem size="small">{error}</Problem>}
      <AskFoot>
        <Button size="small" variant="quiet" onClick={onWithout}>
          {t.without}
        </Button>
        <Button size="small" onClick={onTrust}>
          {t.trust}
        </Button>
      </AskFoot>
    </AskCard>
  )
}

/** What was decided of a repository's settings as they are now. `changed`: trusted once, and different since. */
export type TrustDecided = 'trusted' | 'declined' | 'undecided' | 'changed'

export type RepositoryTrustKeptProps = RootProps<
  'section',
  {
    repository: string
    files: ReadonlyArray<TrustFile>
    decided: TrustDecided
    onTrust: () => void
    /** Takes trust back, or says no to what isn't decided yet. */
    onWithout: () => void
    error?: string
    headingLevel?: HeadingLevel
    text?: Partial<RepositoryTrustText>
  }
>

/** A repository's agent settings as the project's settings keep them: what was decided, and what turns it round. */
export function RepositoryTrustKept({
  repository,
  files,
  decided,
  onTrust,
  onWithout,
  error,
  headingLevel = 3,
  text,
  className,
  ...rest
}: RepositoryTrustKeptProps) {
  const t = { ...repositoryTrustText, ...text }
  const headingId = useId()
  const Heading = `h${headingLevel}` as const
  const loads = anyway(files)
  return (
    <section className={cx(s.kept, className)} aria-labelledby={headingId} {...rest}>
      <div className={s.keptHead}>
        <Heading id={headingId} className={s.repository}>
          {repository}
        </Heading>
        <span className={cx(s.decided, decided === 'trusted' && s.isTrusted)}>{t[decided]}</span>
      </div>
      <TrustFiles files={files} />
      {loads.length > 0 && <p className={s.note}>{t.loadsAnyway(loads.join(' and '))}</p>}
      {error !== undefined && <Problem size="small">{error}</Problem>}
      <div className={s.keptFoot}>
        {decided === 'trusted' ? (
          <Button size="small" variant="quiet" onClick={onWithout}>
            {t.takeBack}
          </Button>
        ) : (
          <>
            {decided !== 'declined' && (
              <Button size="small" variant="quiet" onClick={onWithout}>
                {t.without}
              </Button>
            )}
            <Button size="small" onClick={onTrust}>
              {t.trust}
            </Button>
          </>
        )}
      </div>
    </section>
  )
}

export type RepositoryTrustLineProps = {
  /** What the lead started without, or loads untrusted, as the runtime says it. */
  title: string
  repository: string
  files: ReadonlyArray<TrustFile>
  /** What the person said from it, once they have. */
  answered?: 'trusted' | 'without'
  onTrust: () => void
  onWithout: () => void
  error?: string
  text?: Partial<RepositoryTrustText>
}

/**
 * A task's one quiet line where its lead started without its repository's agent settings, which the person hasn't
 * trusted or its branch changed since (DEV-280): Review opens what they run, to trust them or go on without them. It
 * doesn't wait on anyone, so it never goes to Needs you.
 */
export function RepositoryTrustLine({ title, repository, files, answered, onTrust, onWithout, error, text }: RepositoryTrustLineProps) {
  const t = { ...repositoryTrustText, ...text }
  const [open, setOpen] = useState(false)
  const loads = anyway(files)
  const answer = (then: () => void) => () => {
    setOpen(false)
    then()
  }
  return (
    <>
      <AltharLine>
        {title}{' '}
        {answered === undefined ? (
          <LinkButton onClick={() => setOpen(true)}>{t.review}</LinkButton>
        ) : (
          <span className={s.answered}>{t.answered[answered]}</span>
        )}
        {error !== undefined && (
          <>
            {' '}
            <Problem as="span" size="small">
              {error}
            </Problem>
          </>
        )}
      </AltharLine>
      {open && (
        <Dialog
          title={t.reviewTitle(repository)}
          description={t.reviewLine}
          onClose={() => setOpen(false)}
          width={600}
          actions={
            <>
              <Button variant="quiet" onClick={answer(onWithout)}>
                {t.without}
              </Button>
              <Button onClick={answer(onTrust)}>{t.trust}</Button>
            </>
          }
        >
          <TrustFiles files={files} />
          {loads.length > 0 && <p className={s.note}>{t.loadsAnyway(loads.join(' and '))}</p>}
        </Dialog>
      )}
    </>
  )
}

export type RepositoryTrustStepProps = RootProps<
  'main',
  {
    project: string
    /** Each repository whose settings run something not decided on yet, still to answer. */
    repositories: ReadonlyArray<{ readonly id: string; readonly name: string; readonly files: ReadonlyArray<TrustFile> }>
    onAnswer: (repositoryId: string, trusted: boolean) => void
    text?: Partial<RepositoryTrustText>
  }
>

/**
 * Adding a project, once it is made and before its tab opens on it: each repository whose own agent settings run
 * something, asked once. A repository with none isn't here, and a project with none never comes here.
 */
export function RepositoryTrustStep({ project, repositories, onAnswer, text, className, ...rest }: RepositoryTrustStepProps) {
  const t = { ...repositoryTrustText, ...text }
  return (
    <main className={cx(s.step, className)} {...rest}>
      <h1 className={s.stepTitle}>{t.stepTitle(project)}</h1>
      {repositories.map((repository) => (
        <RepositoryTrustAsk
          key={repository.id}
          repository={repository.name}
          files={repository.files}
          onTrust={() => onAnswer(repository.id, true)}
          onWithout={() => onAnswer(repository.id, false)}
          {...(text === undefined ? {} : { text })}
        />
      ))}
    </main>
  )
}
