import { type ReactNode, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { BrandMark } from '../../foundations/Marks/Marks'
import { cx } from '../../lib/cx'
import type { HeadingLevel } from '../../primitives/Heading/Heading'
import { Button } from '../../primitives/Button/Button'
import { Dialog } from '../../primitives/Dialog/Dialog'
import { Tooltip } from '../../primitives/HoverCard/HoverCard'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Problem } from '../../primitives/Problem/Problem'
import { Skeleton } from '../../primitives/Skeleton/Skeleton'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import { ControlDetail } from '../ControlCenter/ControlCenter'
import { escapeBack, ProjectPicks, RoleSwitches, SheetFact, TilesFailed, toolWordsText, type ToolWordsText } from './ToolParts'
import type { ServerTileModel, ToolAgentView, ToolFileView, ToolProjectView, ToolRoleId } from './tools'
import s from './ToolTiles.module.css'

/*
 * A server, opened in place of the tiles: why its last start failed, and
 * where; what it runs; who gets it, as the three roles' round switches; the
 * projects that get it, each by its mark pressed in or out (absent with one
 * project); then each agent's own file, side by side, with the server's
 * lines as that agent keeps them: those Althar copied in green, those kept
 * out struck through, and where an agent runs it its own way, its own lines
 * beside the others'. Each file's foot says whose it is, what can be done
 * there, and its sign-in. Its tool count sits at the head's end, where it is
 * known; Remove… at its foot, in the danger colour, asks first.
 */

export interface ServerSheetText extends ToolWordsText {
  tools: (n: number) => string
  lastStart: string
  /** Why it failed, said by an agent. */
  failedIn: (agent: string, why: string) => string
  runs: string
  files: string
  reading: string
  tag: Record<ToolFileView['state'], string>
  missing: string
  takeOut: string
  putBack: string
  useThisWay: string
  /** The file's actions, for a screen reader, with the agent named. */
  takeOutOf: (name: string, agent: string) => string
  putBackIn: (name: string, agent: string) => string
  useThisWayOf: (agent: string) => string
  signedIn: string
  signIn: string
  /** A Sign in button's whole name: Sign in to linear in Codex. */
  signInTo: (name: string, agent: string) => string
  /** Said before lines, since their colour and stroke aren't seen by everyone. */
  copiedLines: string
  keptOutLines: string
  repository: string
  remove: string
  removeTitle: (name: string) => string
  removeFrom: (agents: string) => string
  removeConfirm: string
  cancel: string
}

export const serverSheetText: ServerSheetText = {
  ...toolWordsText,
  tools: (n) => `${n} ${n === 1 ? 'tool' : 'tools'}`,
  lastStart: 'Last start',
  failedIn: (agent, why) => `${agent}: ${why}`,
  runs: 'Runs',
  files: 'In each agent’s own file',
  reading: 'Reading each agent’s file…',
  tag: { yours: 'Yours', copied: 'Copied by Althar', differs: 'Its own way', out: 'Kept out', missing: '', cant: '' },
  missing: 'Not in its settings',
  takeOut: 'Take it out',
  putBack: 'Put it back',
  useThisWay: 'Use this way everywhere',
  takeOutOf: (name, agent) => `Take ${name} out of ${agent}`,
  putBackIn: (name, agent) => `Put ${name} back in ${agent}`,
  useThisWayOf: (agent) => `Use ${agent}’s way everywhere`,
  signedIn: 'Signed in',
  signIn: 'Sign in',
  signInTo: (name, agent) => `Sign in to ${name} in ${agent}`,
  copiedLines: 'Lines Althar copied:',
  keptOutLines: 'Lines kept out, as they would be:',
  repository: 'The repository',
  remove: 'Remove…',
  removeTitle: (name) => `Remove ${name}?`,
  removeFrom: (agents) => `It comes out of ${agents}.`,
  removeConfirm: 'Remove',
  cancel: 'Cancel',
}

export interface ServerSheetProps {
  server: ServerTileModel
  agents: readonly ToolAgentView[]
  projects: readonly ToolProjectView[]
  /** Same servers everywhere is on: each file offers to take it out, put it back, or use its way everywhere. */
  sync: boolean
  /** Each agent's file as it keeps the server; null while they are read. */
  files: readonly ToolFileView[] | null
  /** Why the files couldn't be read; with `onRetryFiles`, Try again beside it. */
  filesError?: string | null
  onRetryFiles?: () => void
  /** How many tools it offers, where Althar's own check could count them. */
  tools?: number | null
  onBack: () => void
  onRoles: (roles: readonly ToolRoleId[]) => void
  onProject?: (project: string, on: boolean) => void
  onKeepOut?: (agent: string, out: boolean) => void
  onUseWay?: (agent: string) => void
  onSignIn?: (agent: string) => void
  /** Takes it out of every agent that has it. Only for the person's own; without it, there is no Remove…. */
  onRemove?: () => void
  removing?: boolean
  removeError?: string | null
  headingLevel?: HeadingLevel
  className?: string
  text?: Partial<ServerSheetText>
}

const has = (state: ToolFileView['state']) => state === 'yours' || state === 'copied' || state === 'differs'

/** A server opened out: what it runs, who gets it, which projects, each agent's own file, and removing it. */
export function ServerSheet({
  server,
  agents,
  projects,
  sync,
  files,
  filesError = null,
  onRetryFiles,
  tools = null,
  onBack,
  onRoles,
  onProject,
  onKeepOut,
  onUseWay,
  onSignIn,
  onRemove,
  removing = false,
  removeError = null,
  headingLevel = 3,
  className,
  text,
}: ServerSheetProps) {
  const t = { ...serverSheetText, ...text }
  const [asking, setAsking] = useState(false)
  const nameOf = (id: string) => agents.find((one) => one.id === id)?.name ?? (id === 'repository' ? t.repository : id)
  const failedBy = server.failed?.agent ?? null
  const holders =
    files === null
      ? agents.filter((agent) => ['in', 'added', 'differs'].includes(server.here[agent.id] ?? 'missing')).map((agent) => agent.name)
      : files.filter((file) => has(file.state)).map((file) => nameOf(file.agent))
  const twoWays = files?.some((file) => file.state === 'differs') === true
  return (
    <div className={cx(s.opened, className)} onKeyDown={escapeBack(onBack)}>
      <ControlDetail
        title={server.name}
        onBack={onBack}
        headingLevel={headingLevel}
        text={{ back: t.back }}
        {...(tools === null ? {} : { aside: t.tools(tools) })}
      >
        <div className={s.sheet}>
          {server.failed !== null && (
            <SheetFact label={t.lastStart}>
              <Problem>{failedBy === null ? server.failed.why : t.failedIn(nameOf(failedBy), server.failed.why)}</Problem>
            </SheetFact>
          )}
          <SheetFact label={t.runs}>
            <code className={s.runs}>{server.runs}</code>
          </SheetFact>
          <SheetFact label={t.whoGetsLabel}>
            <RoleSwitches name={server.name} roles={server.roles} onChange={onRoles} text={t} />
          </SheetFact>
          {server.repository === null && projects.length > 1 && onProject !== undefined && (
            <SheetFact label={t.projectsLabel}>
              <ProjectPicks name={server.name} projects={projects} offIn={server.offIn} onChange={onProject} text={t} />
            </SheetFact>
          )}
          <section className={s.filesPart} aria-label={t.files}>
            {filesError !== null ? (
              <TilesFailed error={filesError} retry={t.retry} onRetry={onRetryFiles} />
            ) : files === null ? (
              <div className={s.files} role="status" aria-busy="true">
                <VisuallyHidden>{t.reading}</VisuallyHidden>
                {agents.map((agent) => (
                  <Skeleton key={agent.id} shape="sheet" height={150} />
                ))}
              </div>
            ) : (
              <div className={s.files}>
                {files.map((file) => (
                  <FileCard
                    key={file.agent}
                    file={file}
                    agent={agents.find((one) => one.id === file.agent)}
                    server={server.name}
                    acts={sync && server.repository === null}
                    twoWays={twoWays}
                    onKeepOut={onKeepOut}
                    onUseWay={onUseWay}
                    onSignIn={onSignIn}
                    t={t}
                  />
                ))}
              </div>
            )}
          </section>
          {server.repository === null && onRemove !== undefined && (
            <div className={s.foot}>
              <LinkButton className={s.danger} onClick={() => setAsking(true)}>
                {t.remove}
              </LinkButton>
            </div>
          )}
        </div>
      </ControlDetail>
      {asking && onRemove !== undefined && (
        <Dialog
          title={t.removeTitle(server.name)}
          description={holders.length === 0 ? undefined : t.removeFrom(t.and(holders))}
          holding={removing}
          onClose={() => setAsking(false)}
          actions={
            <>
              <Button variant="quiet" onClick={() => setAsking(false)}>
                {t.cancel}
              </Button>
              <Button variant="danger" busy={removing} onClick={onRemove}>
                {t.removeConfirm}
              </Button>
            </>
          }
        >
          {removeError !== null && <Problem>{removeError}</Problem>}
        </Dialog>
      )}
    </div>
  )
}

/** One agent's file: its lines as it keeps the server, whose they are, what can be done there, and its sign-in. */
function FileCard({
  file,
  agent,
  server,
  acts,
  twoWays,
  onKeepOut,
  onUseWay,
  onSignIn,
  t,
}: {
  file: ToolFileView
  agent: ToolAgentView | undefined
  server: string
  /** It can be changed here: sync is on and it is the person's own. */
  acts: boolean
  twoWays: boolean
  onKeepOut: ((agent: string, out: boolean) => void) | undefined
  onUseWay: ((agent: string) => void) | undefined
  onSignIn: ((agent: string) => void) | undefined
  t: ServerSheetText
}) {
  const name = agent?.name ?? (file.agent === 'repository' ? t.repository : file.agent)
  let action: ReactNode = null
  if (acts && file.state === 'copied' && onKeepOut !== undefined)
    action = (
      <LinkButton aria-label={t.takeOutOf(server, name)} onClick={() => onKeepOut(file.agent, true)}>
        {t.takeOut}
      </LinkButton>
    )
  else if (acts && file.state === 'out' && onKeepOut !== undefined)
    action = (
      <LinkButton aria-label={t.putBackIn(server, name)} onClick={() => onKeepOut(file.agent, false)}>
        {t.putBack}
      </LinkButton>
    )
  else if (acts && twoWays && (file.state === 'differs' || file.state === 'yours') && onUseWay !== undefined)
    action = (
      <LinkButton aria-label={t.useThisWayOf(name)} onClick={() => onUseWay(file.agent)}>
        {t.useThisWay}
      </LinkButton>
    )
  let signIn: ReactNode = null
  if (has(file.state) && file.signIn === 'yes')
    signIn = (
      <span className={s.signedIn}>
        <Icon name="check" size={11} />
        {t.signedIn}
      </span>
    )
  else if (has(file.state) && file.signIn === 'no' && onSignIn !== undefined)
    signIn = (
      <Button size="small" variant="signal" aria-label={t.signInTo(server, name)} onClick={() => onSignIn(file.agent)}>
        {t.signIn}
      </Button>
    )
  const tag = t.tag[file.state]
  const lines = file.state === 'missing' || file.state === 'cant' || file.lines.length === 0 ? null : file.lines
  return (
    <article className={s.file} aria-label={name}>
      <div className={s.fileHead}>
        <span className={s.fileMark} aria-hidden="true">
          {agent?.brand === undefined ? <Icon name="file" size={12} /> : <BrandMark brand={agent.brand} size={13} />}
        </span>
        <span className={s.fileAgent}>{name}</span>
        <Tooltip label={file.where}>
          <code className={cx(s.filePath, s.truncate)}>{file.where}</code>
        </Tooltip>
      </div>
      {lines === null ? (
        <span className={s.fileEmpty}>{file.state === 'cant' ? (file.why ?? t.missing) : t.missing}</span>
      ) : (
        <>
          {file.state === 'copied' && <VisuallyHidden>{t.copiedLines}</VisuallyHidden>}
          {file.state === 'out' && <VisuallyHidden>{t.keptOutLines}</VisuallyHidden>}
          <pre className={cx(s.lines, file.state === 'copied' && s.linesAdded, file.state === 'out' && s.linesOut)}>
            {lines.map((line, at) => (
              <span key={at} className={s.line}>
                {line}
                {'\n'}
              </span>
            ))}
          </pre>
        </>
      )}
      {(tag !== '' || action !== null || signIn !== null) && (
        <div className={s.fileFoot}>
          <span className={s.fileTag}>
            {tag}
            {tag !== '' && action !== null && ' · '}
            {action}
          </span>
          {signIn}
        </div>
      )}
    </article>
  )
}
