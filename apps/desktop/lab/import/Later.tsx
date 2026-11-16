import { type ReactNode, useState } from 'react'

import {
  Button,
  Caret,
  device,
  Dialog,
  Disclosure,
  DisclosureTrigger,
  Fold,
  Icon,
  LinkButton,
  SettingList,
  SettingSwitch,
} from '@althar/ui'

import { ByKind, Mark, type Picks, SetupPick, text as foundText, usePicks, WorktreeFacts } from './Found'
import { useLab } from './state'
import {
  AGENTS,
  type Agent,
  CONVERSATIONS,
  notYet,
  SETUPS,
  TOOLS,
  type Tool,
  useBrought,
  when,
  world,
  WORKTREES,
  worktreesOf,
} from './world'
import s from './later.module.css'

/*
 * What other tools left, after the move: on the board (C's found group, and
 * later what's new since), and in Settings, three ways. 1: the project's
 * settings, Other tools: what's new since the last look, to bring in, and
 * what came in from each tool. 2: Althar's settings, Other tools: every tool
 * on this computer and each repository it knows, projects or not yet. 3: the
 * project's settings, keeping in step: a switch a tool, and what a tool
 * makes from then on comes in by itself.
 */

const SOURCES: ReadonlyArray<Tool | Agent> = ['conductor', 'orca', 't3', 'cursor', 'paradev', 'git', 'claude-code', 'codex']
const nameOf = (who: Tool | Agent) => (who in AGENTS ? AGENTS[who as Agent].name : TOOLS[who as Tool].name)
const isAgent = (who: Tool | Agent): who is Agent => who in AGENTS

/** Bringing in from a dialog, over whatever opened it: the not-yet-brought-in, by kind. */
export function BringDialog({ onClose, only }: { onClose: () => void; only?: 'new' | 'left' }) {
  const b = useBrought()
  const picks = usePicks(world.era(), b, only)
  const go = picks.go()
  return (
    <Dialog
      title={only === 'left' ? 'Left out on the way in' : 'Bring in from other tools'}
      width={640}
      tall
      onClose={onClose}
      actions={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="signal"
            disabled={go === null}
            onClick={() => {
              world.bring({ worktrees: [...picks.worktrees], conversations: [...picks.conversations] })
              onClose()
            }}
          >
            {go ?? 'Bring in'}
          </Button>
        </>
      }
    >
      <ByKind picks={picks} setup={false} />
    </Dialog>
  )
}

/** What the found group offers: arriving, only in C, which leaves it to the board; later, in every direction, but what a tool kept in step brings by itself. */
const useFound = () => {
  const { d } = useLab()
  const b = useBrought()
  if (world.era() === 'arriving' && d !== 'c') return { worktrees: [], conversations: [] }
  const left = notYet(b)
  const now = (one: { readonly later?: true }) => world.era() === 'arriving' || one.later === true
  return {
    worktrees: left.worktrees.filter((one) => now(one) && !(d === '3' && b.follow.has(one.tool))),
    conversations: left.conversations.filter((one) => now(one) && !(d === '3' && b.follow.has(one.agent))),
  }
}
export const useFoundShown = () => {
  const found = useFound()
  return found.worktrees.length + found.conversations.length > 0
}

/** Up next's found group: what other tools have that isn't in yet, each a press to bring in or leave. */
export function FoundGroup() {
  const { worktrees, conversations } = useFound()
  const [choosing, setChoosing] = useState(false)
  const era = world.era()
  if (worktrees.length + conversations.length === 0) return null
  const agents = [...new Set(conversations.map((one) => one.agent))]
  return (
    <section className={s.found} aria-label="Found in other tools">
      <header className={s.foundHead}>
        <span className={s.foundTitle}>{era === 'later' ? 'New in other tools' : 'Found in other tools'}</span>
      </header>
      <ul className={s.foundList}>
        {worktrees.map((one) => (
          <li key={one.id} className={s.foundRow}>
            <Mark of={one.tool} size={14} />
            <div className={s.foundMain}>
              <span className={s.foundName} title={one.title}>
                {one.title}
              </span>
              <WorktreeFacts one={one} first />
            </div>
            <div className={s.foundActions}>
              <button type="button" className={s.foundLeave} onClick={() => world.leave([one.id])} aria-label={`Leave ${one.title}`}>
                <Icon name="close" size={12} />
              </button>
              <Button
                size="small"
                onClick={() =>
                  world.bring({ worktrees: [one.id], conversations: CONVERSATIONS.filter((c) => c.in === one.id).map((c) => c.id) })
                }
              >
                Bring in
              </Button>
            </div>
          </li>
        ))}
        {conversations.length > 0 && (
          <li className={s.foundRow}>
            <span className={s.markPair}>
              {agents.map((one) => (
                <Mark key={one} of={one} size={14} />
              ))}
            </span>
            <div className={s.foundMain}>
              <span className={s.foundName}>{conversations.length === 1 ? '1 conversation' : `${conversations.length} conversations`}</span>
              <span className={s.foundSub}>{agents.map((one) => AGENTS[one].name).join(' and ')}</span>
            </div>
            <div className={s.foundActions}>
              <Button size="small" onClick={() => setChoosing(true)}>
                Choose…
              </Button>
            </div>
          </li>
        )}
      </ul>
      <footer className={s.foundFoot}>
        <button
          type="button"
          onClick={() => world.bring({ worktrees: worktrees.map((one) => one.id), conversations: conversations.map((one) => one.id) })}
        >
          Bring in all
        </button>
      </footer>
      {choosing && <BringDialog onClose={() => setChoosing(false)} />}
    </section>
  )
}

function Part({ title, end, children }: { title: string; end?: ReactNode; children: ReactNode }) {
  return (
    <section className={s.part}>
      <div className={s.partHead}>
        <h3 className={s.partTitle}>{title}</h3>
        <span className={s.grow} />
        {end}
      </div>
      {children}
    </section>
  )
}

/** What came in from one tool, and what of it was left out. */
function Source({ who }: { who: Tool | Agent }) {
  const b = useBrought()
  const era = world.era()
  const theirs = isAgent(who)
    ? CONVERSATIONS.filter((one) => one.agent === who && (era === 'later' || one.later !== true))
    : worktreesOf(era).filter((one) => one.tool === who)
  const inNow = theirs.filter((one) => ('agent' in one ? b.conversations.has(one.id) : b.worktrees.has(one.id)))
  // What was passed over on the way in; what's new since is offered above.
  const out = theirs.filter((one) => one.later !== true).length - inNow.filter((one) => one.later !== true).length
  const setup = !isAgent(who) && b.setup === who
  if (theirs.length === 0) return null
  const noun = isAgent(who) ? 'conversation' : 'worktree'
  return (
    <li className={s.source}>
      <Mark of={who} />
      <div className={s.sourceMain}>
        <span className={s.sourceName}>{nameOf(who)}</span>
        <code className={s.mono}>{isAgent(who) ? AGENTS[who].where : TOOLS[who].where}</code>
      </div>
      <div className={s.sourceFacts}>
        <span>
          {inNow.length} {noun}
          {inNow.length === 1 ? '' : 's'} in
        </span>
        {setup && <span>its setup</span>}
        {out > 0 && <span className={s.quiet}>{out} left out</span>}
      </div>
    </li>
  )
}

/** Settings' first direction, in the project's settings: what's new since, then what came in, tool by tool. */
function ProjectOtherTools() {
  const b = useBrought()
  const picks = usePicks(world.era(), b, 'new')
  const [leftOut, setLeftOut] = useState(false)
  const [looked, setLooked] = useState('2 minutes ago')
  const go = picks.go()
  const anyNew = picks.offeredWorktrees.length + picks.offeredConversations.length > 0
  return (
    <div className={s.section}>
      {anyNew && (
        <Part
          title="New since the last look"
          end={
            <Button
              size="small"
              variant="signal"
              disabled={go === null}
              onClick={() => world.bring({ worktrees: [...picks.worktrees], conversations: [...picks.conversations] })}
            >
              {go ?? 'Bring in'}
            </Button>
          }
        >
          <ByKind picks={picks} setup={false} />
        </Part>
      )}
      <Part title="Brought in" end={<LinkButton onClick={() => setLeftOut(true)}>Left out…</LinkButton>}>
        <ul className={s.sources}>
          {SOURCES.map((who) => (
            <Source key={who} who={who} />
          ))}
        </ul>
      </Part>
      {leftOut && <BringDialog only="left" onClose={() => setLeftOut(false)} />}
      <Part title="Setup">
        <SetupPick
          picks={{ ...picks, setSetup: ((id: string | null) => world.bring({ setup: id })) as Picks['setSetup'], setup: b.setup }}
          compact
        />
      </Part>
      <p className={s.foot}>
        <Icon name="lock" size={12} />
        Read only: nothing in these folders changes.
        <span className={s.grow} />
        <span className={s.quiet}>Looked {looked}</span>
        <LinkButton onClick={() => setLooked('just now')}>Look again</LinkButton>
      </p>
    </div>
  )
}

/** Settings' third: a switch for each tool, and what it makes from then on comes in by itself. */
function KeepInStep() {
  const b = useBrought()
  const follow = world.keep
  const lately = [
    ...WORKTREES.filter((one) => one.later === true && b.worktrees.has(one.id)).map((one) => ({
      id: one.id,
      who: one.tool as Tool | Agent,
      what: one.title,
      at: one.touched,
    })),
    ...CONVERSATIONS.filter((one) => one.later === true && b.conversations.has(one.id)).map((one) => ({
      id: one.id,
      who: one.agent as Tool | Agent,
      what: one.title,
      at: one.at,
    })),
  ]
  return (
    <div className={s.section}>
      <Part title="Keep in step">
        <SettingList>
          {(['conductor', 'orca', 'cursor', 'claude-code', 'codex'] as const).map((who) => (
            <SettingSwitch
              key={who}
              title={nameOf(who)}
              mark={<Mark of={who} />}
              note={
                isAgent(who)
                  ? 'Its new conversations come in: as their task’s history, or as chats on Scratch.'
                  : 'Its new worktrees come in as tasks, where it makes them.'
              }
              checked={b.follow.has(who)}
              onChange={(on) => follow(who, on)}
            />
          ))}
        </SettingList>
      </Part>
      {lately.length > 0 && (
        <Part title="Came in since">
          <ul className={s.sources}>
            {lately.map((one) => (
              <li key={one.id} className={s.source}>
                <Mark of={one.who} />
                <div className={s.sourceMain}>
                  <span className={s.sourceName}>{one.what}</span>
                </div>
                <div className={s.sourceFacts}>
                  <span className={s.quiet}>{when(one.at)}</span>
                </div>
              </li>
            ))}
          </ul>
        </Part>
      )}
      <p className={s.foot}>
        <Icon name="lock" size={12} />
        Read only: nothing in these folders changes.
      </p>
    </div>
  )
}

const REPOS: Record<
  Tool | Agent,
  ReadonlyArray<{ readonly name: string; readonly project: boolean; readonly has: string; readonly fresh?: string }>
> = {
  conductor: [
    { name: 'althar', project: true, has: '3 worktrees, its setup', fresh: '1 new' },
    { name: 'meridian', project: true, has: '2 worktrees' },
    { name: 'dotfiles', project: false, has: '1 worktree' },
  ],
  orca: [{ name: 'althar', project: true, has: '1 worktree' }],
  cursor: [
    { name: 'althar', project: true, has: '1 worktree, its setup' },
    { name: 'site', project: false, has: '2 worktrees' },
  ],
  t3: [{ name: 'althar', project: true, has: '1 worktree' }],
  paradev: [{ name: 'althar', project: true, has: '1 worktree' }],
  git: [],
  'claude-code': [
    { name: 'althar', project: true, has: '23 conversations', fresh: '2 new' },
    { name: 'meridian', project: true, has: '12 conversations' },
    { name: 'dotfiles', project: false, has: '4 conversations' },
    { name: 'site', project: false, has: '7 conversations' },
  ],
  codex: [
    { name: 'althar', project: true, has: '9 conversations', fresh: '1 new' },
    { name: 'meridian', project: true, has: '3 conversations' },
  ],
}

/** Settings' second, in Althar's own settings: each tool on this computer, and every repository it knows. */
function AppOtherTools() {
  const [look, setLook] = useState(true)
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set(['conductor']))
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set())
  const [choosing, setChoosing] = useState(false)
  return (
    <div className={s.section}>
      <Part title={`On ${device.this}`}>
        <ul className={s.tools}>
          {(['conductor', 'orca', 'cursor', 't3', 'paradev', 'claude-code', 'codex'] as const).map((who) => {
            const repos = REPOS[who]
            const isOpen = open.has(who)
            const fresh = repos.filter((one) => one.fresh !== undefined).length
            return (
              <li key={who} className={s.tool}>
                <Disclosure
                  open={isOpen}
                  onOpenChange={(next) =>
                    setOpen((now) => {
                      const set = new Set(now)
                      if (next) set.add(who)
                      else set.delete(who)
                      return set
                    })
                  }
                >
                  <DisclosureTrigger>
                    <button type="button" className={s.toolHead}>
                      <Mark of={who} />
                      <span className={s.toolName}>{nameOf(who)}</span>
                      <code className={s.mono}>{isAgent(who) ? AGENTS[who].where : TOOLS[who].where.replace('/althar', '')}</code>
                      <span className={s.grow} />
                      <span className={s.quiet}>
                        {repos.length === 1 ? '1 repository' : `${repos.length} repositories`}
                        {fresh > 0 && <span className={s.fresh}> · new work</span>}
                      </span>
                      <Caret open={isOpen} />
                    </button>
                  </DisclosureTrigger>
                  <Fold>
                    <ul className={s.repos}>
                      {repos.map((repo) => (
                        <li key={repo.name} className={s.repo}>
                          <span className={s.repoName}>{repo.name}</span>
                          <span className={s.quiet}>{repo.project ? 'project' : 'not a project'}</span>
                          <span className={s.grow} />
                          <span className={s.repoHas}>
                            {repo.has}
                            {repo.fresh !== undefined && <span className={s.fresh}> · {repo.fresh}</span>}
                          </span>
                          {repo.project ? (
                            repo.fresh !== undefined ? (
                              <Button size="small" onClick={() => setChoosing(true)}>
                                Bring in…
                              </Button>
                            ) : (
                              <span className={s.inAlready}>
                                <Icon name="check" size={12} /> Brought in
                              </span>
                            )
                          ) : opened.has(repo.name) ? (
                            <span className={s.inAlready}>
                              <Icon name="check" size={12} /> Added
                            </span>
                          ) : (
                            <Button size="small" icon="plus" onClick={() => setOpened((now) => new Set([...now, repo.name]))}>
                              Add as a project
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </Fold>
                </Disclosure>
              </li>
            )
          })}
        </ul>
      </Part>
      <SettingList>
        <SettingSwitch
          title="Look for other tools’ work when a project is added"
          note="Its worktrees, setup and conversations are offered on the way in."
          checked={look}
          onChange={setLook}
        />
      </SettingList>
      <p className={s.foot}>
        <Icon name="lock" size={12} />
        Read only: nothing in these folders changes.
      </p>
      {choosing && <BringDialog onClose={() => setChoosing(false)} />}
    </div>
  )
}

/** The section the lab adds to Settings, by direction. */
export function OtherToolsSection({ where }: { where: 'project' | 'app' }) {
  const { d } = useLab()
  if (where === 'app') return <AppOtherTools />
  return d === '3' ? <KeepInStep /> : <ProjectOtherTools />
}

export { SETUPS, foundText }
