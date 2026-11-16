import { type ReactNode, useState } from 'react'

import { BrandMark, Delta, Icon, LinkButton } from '@althar/ui'

import {
  AGENTS,
  type Agent,
  type Brought,
  type Conversation,
  conversationsOf,
  type Era,
  OLDER,
  pickedByDefault,
  recent,
  SETUPS,
  TOOLS,
  type Tool,
  when,
  type Worktree,
  worktreeOf,
  worktreesOf,
} from './world'
import s from './found.module.css'

/*
 * What Althar found of other tools in a project's folders, listed to pick
 * from, in two shapes: by kind (A: worktrees, setup, conversations, each its
 * own list) and by place (B: each worktree as the task it becomes, with the
 * conversations that ran in it under it, and the project's own folder's for
 * Scratch). The same picks either way; what's ticked at first is the work
 * not finished and the conversations of the last month.
 */

export const text = {
  worktrees: 'Worktrees',
  setup: 'Setup',
  conversations: 'Conversations',
  all: 'All',
  none: 'None',
  uncommitted: (files: number) => (files === 1 ? 'in 1 file' : `in ${files} files`),
  unpushed: (n: number) => (n === 1 ? '1 commit not pushed' : `${n} commits not pushed`),
  failing: (name: string) => `${name} failing`,
  merged: 'merged',
  draft: 'draft',
  theirs: (who: string) => `${who}’s, to review`,
  messages: (n: number) => `${n} messages`,
  older: (cc: number, cx: number) => `${cc + cx} older, from before ${monthAgo()}`,
  olderLine: (cc: number, cx: number) => `${cc} from Claude Code, ${cx} from Codex`,
  noSetup: 'Neither: the first task works it out',
  setupReads: (file: string) => file,
  ownFolder: 'In althar itself',
  ownFolderGoes: 'Chats on Scratch',
  becomes: 'Becomes a task where it is',
  history: 'Its history',
  replayed: 'Replayed before each task starts',
  ranIn: (where: string) => `in ${where}`,
  go: (worktrees: number, conversations: number) => {
    const parts = [
      worktrees > 0 ? (worktrees === 1 ? '1 worktree' : `${worktrees} worktrees`) : null,
      conversations > 0 ? (conversations === 1 ? '1 conversation' : `${conversations} conversations`) : null,
    ].filter((one) => one !== null)
    return parts.length === 0 ? null : `Bring in ${parts.join(' and ')}`
  },
}

const monthAgo = () => new Date(Date.now() - 30 * 86_400_000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

/** A tool's mark: its own where the kit has one, else its initial, quiet. */
export function Mark({ of, size = 16 }: { of: Tool | Agent; size?: number }) {
  const brand = of in AGENTS ? AGENTS[of as Agent].brand : TOOLS[of as Tool].brand
  const name = of in AGENTS ? AGENTS[of as Agent].name : TOOLS[of as Tool].name
  if (brand !== undefined)
    return (
      <span className={s.mark} role="img" aria-label={name} style={{ width: size, height: size }}>
        <BrandMark brand={brand} size={size} />
      </span>
    )
  if (of === 'git')
    return (
      <span className={s.mark} role="img" aria-label={name} style={{ width: size, height: size }}>
        <Icon name="branch" size={size - 2} />
      </span>
    )
  return (
    <span className={s.letter} role="img" aria-label={name} style={{ width: size, height: size, fontSize: size * 0.62 }}>
      {name[0]}
    </span>
  )
}

/** The kit's checkbox look, on a native box. */
export function Tick({
  on,
  onChange,
  label,
  mixed = false,
}: {
  on: boolean
  onChange: (on: boolean) => void
  label: string
  mixed?: boolean
}) {
  return (
    <span className={s.tickBox}>
      <input
        type="checkbox"
        className={s.tick}
        checked={on}
        aria-label={label}
        ref={(el) => {
          if (el !== null) el.indeterminate = mixed
        }}
        onChange={(event) => onChange(event.target.checked)}
      />
      {on && !mixed && <Icon name="check" size={10} className={s.tickMark} />}
    </span>
  )
}

/** What the person picks, ticked at first by the defaults; `except` is what's in already, not offered again. */
export function usePicks(era: Era, except?: Brought, only?: 'new' | 'left') {
  const fits = (one: { readonly later?: true }) => only === undefined || (only === 'new') === (one.later === true)
  const offeredWorktrees = worktreesOf(era).filter((one) => (except === undefined || !except.worktrees.has(one.id)) && fits(one))
  const offeredConversations = conversationsOf(era).filter(
    (one) => (except === undefined || !except.conversations.has(one.id)) && fits(one),
  )
  const [worktrees, setWorktrees] = useState<ReadonlySet<string>>(
    () => new Set(offeredWorktrees.filter((one) => one.later === true || (only !== 'left' && pickedByDefault(one))).map((one) => one.id)),
  )
  const [conversations, setConversations] = useState<ReadonlySet<string>>(
    () => new Set(offeredConversations.filter((one) => one.later === true || (only !== 'left' && recent(one))).map((one) => one.id)),
  )
  const [older, setOlder] = useState(false)
  const [setup, setSetup] = useState<string | null>(except === undefined ? 'conductor' : except.setup)
  const flip = (set: ReadonlySet<string>, id: string, on: boolean) => {
    const next = new Set(set)
    if (on) next.add(id)
    else next.delete(id)
    return next
  }
  const olderCount = only === 'new' ? 0 : OLDER['claude-code'] + OLDER.codex
  return {
    offeredWorktrees,
    offeredConversations,
    worktrees,
    conversations,
    older,
    setup,
    olderCount,
    worktree: (id: string, on: boolean) => {
      setWorktrees((now) => flip(now, id, on))
      // A worktree's conversations follow it, by place.
      setConversations((now) => {
        let next = now
        for (const one of offeredConversations.filter((c) => c.in === id)) next = flip(next, one.id, on)
        return next
      })
    },
    conversation: (id: string, on: boolean) => setConversations((now) => flip(now, id, on)),
    allWorktrees: (on: boolean) => setWorktrees(on ? new Set(offeredWorktrees.map((one) => one.id)) : new Set()),
    allConversations: (on: boolean) => {
      setConversations(on ? new Set(offeredConversations.map((one) => one.id)) : new Set())
      setOlder(on)
    },
    setOlder,
    setSetup,
    count: () => ({ worktrees: worktrees.size, conversations: conversations.size + (older ? olderCount : 0) }),
    go: () => text.go(worktrees.size, conversations.size + (older ? olderCount : 0)),
  }
}
export type Picks = ReturnType<typeof usePicks>

/** A worktree's facts, problems first: what's failing, what isn't saved, then its pull request. */
export function WorktreeFacts({ one, first = false }: { one: Worktree; first?: boolean }) {
  const facts: ReactNode[] = []
  if (one.pr !== null && one.pr.checks.failed > 0 && one.pr.checks.failing !== undefined)
    facts.push(
      <span key="fail" className={s.problem}>
        <Icon name="problem" size={12} />
        {text.failing(one.pr.checks.failing)}
      </span>,
    )
  if (one.uncommitted !== null)
    facts.push(
      <span key="dirty" className={s.fact}>
        <Delta add={one.uncommitted.add} del={one.uncommitted.del} /> {text.uncommitted(one.uncommitted.files)}
      </span>,
    )
  if (one.unpushed > 0)
    facts.push(
      <span key="ahead" className={s.fact}>
        <Icon name="up" size={12} />
        {text.unpushed(one.unpushed)}
      </span>,
    )
  if (one.pr !== null)
    facts.push(
      <span key="pr" className={s.fact}>
        <Icon name="pr" size={12} />#{one.pr.number}
        {one.pr.state === 'draft' && <span className={s.quiet}>{text.draft}</span>}
        {one.pr.state === 'merged' && <span className={s.quiet}>{text.merged}</span>}
        {one.pr.theirs !== undefined && <span className={s.quiet}>{text.theirs(one.pr.theirs)}</span>}
      </span>,
    )
  return <span className={s.facts}>{first ? facts.slice(0, 1) : facts}</span>
}

export function WorktreeRow({
  one,
  on,
  onChange,
  extra,
}: {
  one: Worktree
  on: boolean
  onChange: (on: boolean) => void
  extra?: ReactNode
}) {
  return (
    <li className={s.row} data-off={!on || undefined}>
      <label className={s.rowHit}>
        <Tick on={on} onChange={onChange} label={one.title} />
        <Mark of={one.tool} />
        <span className={s.main}>
          <span className={s.titleLine}>
            <span className={s.name} title={one.title}>
              {one.title}
            </span>
            <span className={s.at}>{when(one.touched)}</span>
          </span>
          <span className={s.where}>
            <code className={s.branch}>{one.branch}</code>
            <code className={s.path} title={one.path}>
              {one.path}
            </code>
          </span>
          <WorktreeFacts one={one} />
        </span>
      </label>
      {extra}
    </li>
  )
}

export function ConversationRow({
  one,
  on,
  onChange,
  showWhere = true,
  nested = false,
}: {
  one: Conversation
  on: boolean
  onChange: (on: boolean) => void
  showWhere?: boolean
  nested?: boolean
}) {
  const where = worktreeOf(one.in)
  return (
    <li className={nested ? s.nestedRow : s.row} data-off={!on || undefined}>
      <label className={s.rowHit}>
        {!nested && <Tick on={on} onChange={onChange} label={one.title} />}
        <Mark of={one.agent} size={nested ? 14 : 16} />
        <span className={s.main}>
          <span className={s.titleLine}>
            <span className={s.name} title={one.title}>
              {one.title}
            </span>
            <span className={s.at}>{when(one.at)}</span>
          </span>
          {!nested && (
            <span className={s.sub}>
              <span>{text.messages(one.messages)}</span>
              {showWhere && where !== undefined && <code className={s.path}>{where.path.split('/').at(-1)}</code>}
            </span>
          )}
        </span>
      </label>
    </li>
  )
}

function SectionHead({ title, count, children }: { title: string; count: number; children?: ReactNode }) {
  return (
    <div className={s.head}>
      <h3 className={s.headTitle}>
        {title}
        <span className={s.count}>{count}</span>
      </h3>
      <span className={s.grow} />
      {children}
    </div>
  )
}

function AllNone({ onAll, onNone }: { onAll: () => void; onNone: () => void }) {
  return (
    <span className={s.allNone}>
      <LinkButton onClick={onAll}>{text.all}</LinkButton>
      <LinkButton onClick={onNone}>{text.none}</LinkButton>
    </span>
  )
}

export function SetupPick({ picks, compact = false }: { picks: Picks; compact?: boolean }) {
  return (
    <ul className={s.setups} role="radiogroup" aria-label={text.setup}>
      {SETUPS.map((one) => (
        <li key={one.id}>
          <label className={s.setupRow} data-on={picks.setup === one.id || undefined}>
            <input type="radio" name="setup" className={s.radio} checked={picks.setup === one.id} onChange={() => picks.setSetup(one.id)} />
            <Mark of={one.tool} />
            <span className={s.main}>
              <span className={s.titleLine}>
                <span className={s.name}>{TOOLS[one.tool].name}’s</span>
                <code className={s.path}>{one.file}</code>
              </span>
              {(!compact || picks.setup === one.id) && <pre className={s.script}>{one.script}</pre>}
              {picks.setup === one.id && one.reads !== undefined && <span className={s.note}>{one.reads}</span>}
            </span>
          </label>
        </li>
      ))}
      <li>
        <label className={s.setupRow} data-on={picks.setup === null || undefined}>
          <input type="radio" name="setup" className={s.radio} checked={picks.setup === null} onChange={() => picks.setSetup(null)} />
          <span className={s.mark} style={{ width: 16, height: 16 }} />
          <span className={s.main}>
            <span className={s.name}>{text.noSetup}</span>
          </span>
        </label>
      </li>
    </ul>
  )
}

/** A: by kind. Worktrees, then setup, then conversations, each its own list. */
export function ByKind({ picks, setup = true }: { picks: Picks; setup?: boolean }) {
  const recentOnes = picks.offeredConversations.filter(recent)
  const olderOnes = picks.offeredConversations.filter((one) => !recent(one))
  return (
    <div className={s.picker}>
      {picks.offeredWorktrees.length > 0 && (
        <section>
          <SectionHead title={text.worktrees} count={picks.offeredWorktrees.length}>
            <AllNone onAll={() => picks.allWorktrees(true)} onNone={() => picks.allWorktrees(false)} />
          </SectionHead>
          <ul className={s.list}>
            {picks.offeredWorktrees.map((one) => (
              <WorktreeRow key={one.id} one={one} on={picks.worktrees.has(one.id)} onChange={(on) => picks.worktree(one.id, on)} />
            ))}
          </ul>
        </section>
      )}
      {setup && (
        <section>
          <SectionHead title={text.setup} count={SETUPS.length} />
          <SetupPick picks={picks} compact />
        </section>
      )}
      {picks.offeredConversations.length > 0 && (
        <section>
          <SectionHead title={text.conversations} count={picks.offeredConversations.length + picks.olderCount}>
            <AllNone onAll={() => picks.allConversations(true)} onNone={() => picks.allConversations(false)} />
          </SectionHead>
          <ul className={s.list}>
            {[...recentOnes, ...olderOnes].map((one) => (
              <ConversationRow
                key={one.id}
                one={one}
                on={picks.conversations.has(one.id)}
                onChange={(on) => picks.conversation(one.id, on)}
              />
            ))}
            {picks.olderCount > 0 && (
              <li className={s.row} data-off={!picks.older || undefined}>
                <label className={s.rowHit}>
                  <Tick on={picks.older} onChange={picks.setOlder} label={text.older(OLDER['claude-code'], OLDER.codex)} />
                  <span className={s.markPair}>
                    <Mark of="claude-code" size={14} />
                    <Mark of="codex" size={14} />
                  </span>
                  <span className={s.main}>
                    <span className={s.name}>{text.older(OLDER['claude-code'], OLDER.codex)}</span>
                    <span className={s.sub}>{text.olderLine(OLDER['claude-code'], OLDER.codex)}</span>
                  </span>
                </label>
              </li>
            )}
          </ul>
        </section>
      )}
    </div>
  )
}

/** B: by place. Each worktree as the task it becomes, its conversations under it; the project's own folder's go to Scratch. */
export function ByPlace({ picks, setup = true }: { picks: Picks; setup?: boolean }) {
  const own = picks.offeredConversations.filter((one) => one.in === null)
  return (
    <div className={s.picker}>
      {setup && (
        <section>
          <SectionHead title={text.setup} count={SETUPS.length}>
            <span className={s.goes}>{text.replayed}</span>
          </SectionHead>
          <SetupPick picks={picks} compact />
        </section>
      )}
      <section>
        <SectionHead title={text.worktrees} count={picks.offeredWorktrees.length}>
          <span className={s.goes}>{text.becomes}</span>
        </SectionHead>
        <ul className={s.cards}>
          {picks.offeredWorktrees.map((one) => {
            const said = picks.offeredConversations.filter((c) => c.in === one.id)
            const on = picks.worktrees.has(one.id)
            return (
              <WorktreeRow
                key={one.id}
                one={one}
                on={on}
                onChange={(next) => picks.worktree(one.id, next)}
                extra={
                  said.length > 0 && (
                    <ul className={s.nested} aria-label={text.history}>
                      {said.map((c) => (
                        <ConversationRow key={c.id} one={c} on={on} onChange={() => undefined} nested />
                      ))}
                    </ul>
                  )
                }
              />
            )
          })}
        </ul>
      </section>
      {own.length > 0 && (
        <section>
          <SectionHead title={text.ownFolder} count={own.length}>
            <span className={s.goes}>{text.ownFolderGoes}</span>
            <AllNone
              onAll={() => {
                for (const one of own) picks.conversation(one.id, true)
              }}
              onNone={() => {
                for (const one of own) picks.conversation(one.id, false)
              }}
            />
          </SectionHead>
          <ul className={s.list}>
            {own.map((one) => (
              <ConversationRow
                key={one.id}
                one={one}
                on={picks.conversations.has(one.id)}
                onChange={(on) => picks.conversation(one.id, on)}
                showWhere={false}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
