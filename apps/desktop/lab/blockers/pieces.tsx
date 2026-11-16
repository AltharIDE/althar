import { useState } from 'react'

import {
  BoardCard,
  CallCard,
  Icon,
  IconButton,
  LinkButton,
  Menu,
  MenuGroup,
  MenuItem,
  MenuSeparator,
  NextStep,
  NoteForm,
  TaskKind,
  TaskStatus,
  Wait,
} from '@althar/ui'

import { direction, move, openTask, useStore, useWorld } from './state'
import {
  allAfter,
  type Ask,
  choicesFor,
  followersFor,
  listed,
  openBlockers,
  shortOf,
  specOf,
  stateWord,
  type TaskNow,
  unstarted,
  waitingOn,
  type WorldNow,
} from './world'
import s from './pieces.module.css'

/*
 * What the directions share: how a waiting task is said in each, the
 * choices for what waited on an abandoned task (A's card and B's put them
 * on the card; C's coordinator asks them), the menu that sets what a task
 * waits for (A), and the chain that rides under a blocker's card (B).
 */

/* ——— a waiting task, in words ——— */

/** What it still waits for, each with how it stands: "Pairing, in review". */
const standing = (world: WorldNow, task: TaskNow): string =>
  listed(openBlockers(world, task).map((one) => `${shortOf(one.key)}${one.phase === 'waits' ? '' : `, ${stateWord(one).toLowerCase()}`}`))

/** Its row's line in Up next, and its header's words: each direction says it its own way; null where nothing holds it but the person. */
export const waitWords = (
  world: WorldNow,
  task: TaskNow,
): { readonly row: string; readonly state: string; readonly why?: string } | null => {
  if (task.phase !== 'waits') return null
  const open = openBlockers(world, task)
  if (open.length === 0) return null
  const names = listed(open.map((one) => shortOf(one.key)))
  switch (direction.get()) {
    // The row names what it waits for; how each stands is at its foot (BlockersFoot).
    case 'a':
      return {
        row: task.held ? `Held · after ${names}` : `After ${names}`,
        state: task.held ? 'Held' : 'Waiting',
        why: `For ${standing(world, task)}`,
      }
    case 'b':
      return { row: `After ${names}`, state: `After ${names}`, ...(task.held ? { why: 'Held' } : {}) }
    // The kit's own words for a row that starts after another task: "Starts when 419 merges".
    // Once one is abandoned it won't merge: the row says so, and that it waits for the person (the coordinator's question).
    case 'c': {
      const left = open.find((one) => one.phase === 'abandoned')
      if (left !== undefined) return { row: `${shortOf(left.key)} was abandoned`, state: 'Needs you' }
      const when = `Starts when ${names} ${open.length === 1 ? 'merges' : 'merge'}`
      const said = task.held ? `Held. ${when}, and you say` : when
      return { row: said, state: said }
    }
  }
}

/** A: at a waiting row's foot, each task it waits for and how it stands, a line each. */
export function BlockersFoot({ task }: { task: TaskNow }) {
  const world = useWorld()
  return (
    <ul className={s.blockers}>
      {openBlockers(world, task).map((one) => (
        <li key={one.key} className={s.blocker} data-phase={one.phase}>
          <span className={s.blockerName}>{shortOf(one.key)}</span>
          <span className={s.blockerState}>{stateWord(one)}</span>
        </li>
      ))}
    </ul>
  )
}

export const waitGlyph = (world: WorldNow, task: TaskNow): Wait | null =>
  waitWords(world, task) === null
    ? null
    : task.held || openBlockers(world, task).some((one) => one.phase === 'abandoned')
      ? Wait.You
      : Wait.After

/* ——— the choices for what waited on an abandoned task ——— */

interface Choice {
  readonly label: string
  readonly act: () => void
}

/** The one choice the card offers first, for every task that waited: go on without the abandoned one. */
const goOn = (world: WorldNow, blocker: string, dep: TaskNow): Choice => {
  const others = openBlockers(world, dep).filter((one) => one.key !== blocker)
  return others.length > 0
    ? {
        label: `Wait only for ${listed(others.map((one) => shortOf(one.key)))}`,
        act: () => move({ kind: 'unblock', key: dep.key, on: blocker }),
      }
    : { label: `Start ${shortOf(dep.key)} anyway`, act: () => move({ kind: 'start', key: dep.key }) }
}

/** The strip's words for that, short enough for a lane: the menu says it whole. */
const short = (world: WorldNow, blocker: string, dep: TaskNow): string =>
  openBlockers(world, dep).some((one) => one.key !== blocker) ? 'Go on without it' : `Start ${shortOf(dep.key)}`

/** The rest, for one task that waited: start with a word, wait for another task in its place, or abandon it too. */
const more = (world: WorldNow, blocker: string, dep: TaskNow, write: () => void) => {
  const after = allAfter(world, dep.key)
  const others = openBlockers(world, dep).filter((one) => one.key !== blocker)
  return {
    word: { label: `Start ${shortOf(dep.key)} now, with a word to its lead…`, act: write },
    instead: choicesFor(world, dep.key)
      .filter((one) => one.task.key !== blocker && !others.includes(one.task))
      .map((one) => ({
        label: shortOf(one.task.key),
        act: () => move({ kind: 'swap', key: dep.key, from: blocker, to: one.task.key }),
        hint: one.loops ? `waits for ${shortOf(dep.key)}` : stateWord(one.task),
        loops: one.loops,
      })),
    abandon: {
      label:
        after.length === 0
          ? `Abandon ${shortOf(dep.key)} too`
          : `Abandon ${shortOf(dep.key)} and ${listed(after.map((one) => shortOf(one.key)))}`,
      act: () => {
        move({ kind: 'abandon', key: dep.key })
        for (const one of after) move({ kind: 'abandon', key: one.key })
      },
    },
  }
}

/** The strip's step: go on without it, for the one that waited, or each; and the rest in its menu, with Reopen. */
function Decide({ ask, onWrite }: { ask: Ask; onWrite: (key: string) => void }) {
  const world = useWorld()
  const first = ask.waiting.map((dep) => goOn(world, ask.blocker.key, dep))
  const one = ask.waiting.length === 1
  return (
    <NextStep
      signal
      onPress={() => {
        for (const choice of first) choice.act()
      }}
      moreLabel="More choices"
      menu={(trigger) => (
        <Menu trigger={trigger} label={`What waits on ${shortOf(ask.blocker.key)}`} placement="below" align="end" width={300}>
          {ask.waiting.map((dep, i) => {
            const rest = more(world, ask.blocker.key, dep, () => onWrite(dep.key))
            const body = (
              <>
                <MenuItem icon="play" onSelect={(first[i] as Choice).act}>
                  {(first[i] as Choice).label}
                </MenuItem>
                <MenuItem icon="comment" onSelect={rest.word.act}>
                  {rest.word.label}
                </MenuItem>
                {rest.instead.length > 0 && (
                  <MenuGroup label={`Or have ${shortOf(dep.key)} wait for`}>
                    {rest.instead.map((item) => (
                      <MenuItem key={item.label} icon="after" onSelect={item.act} disabled={item.loops} hint={item.hint}>
                        {item.label}
                      </MenuItem>
                    ))}
                  </MenuGroup>
                )}
                <MenuSeparator />
                <MenuItem icon="close" tone="danger" quiet onSelect={rest.abandon.act}>
                  {rest.abandon.label}
                </MenuItem>
              </>
            )
            return one ? (
              <div key={dep.key}>{body}</div>
            ) : (
              <MenuGroup key={dep.key} label={shortOf(dep.key)}>
                {body}
              </MenuGroup>
            )
          })}
          <MenuItem icon="reload" onSelect={() => move({ kind: 'reopen', key: ask.blocker.key })}>
            Reopen {shortOf(ask.blocker.key)}
          </MenuItem>
        </Menu>
      )}
    >
      {one ? short(world, ask.blocker.key, ask.waiting[0] as TaskNow) : 'Go on without it'}
    </NextStep>
  )
}

/** Words for the lead of a task started now, written on the card, under it. */
function Word({ dep, onDone }: { dep: string; onDone: () => void }) {
  return (
    <NoteForm
      className={s.word}
      text={{ placeholder: `What should ${shortOf(dep)}’s lead know?`, submit: 'Start' }}
      onSubmit={(word) => {
        move({ kind: 'start', key: dep, word })
        onDone()
      }}
      onCancel={onDone}
    />
  )
}

/** Why the card came to the person: what waits on the abandoned task, and what waits on that. */
const because = (world: WorldNow, ask: Ask): string => {
  const direct = ask.waiting.map((one) => shortOf(one.key))
  const later = ask.waiting.flatMap((one) => allAfter(world, one.key)).filter((one, i, all) => all.indexOf(one) === i)
  return `${listed(direct)} ${direct.length === 1 ? 'waits' : 'wait'} for it${later.length === 0 ? '.' : `, and ${listed(later.map((one) => shortOf(one.key)))} ${later.length === 1 ? 'waits' : 'wait'} on that.`}`
}

/** A: one card in Needs you for an abandoned task something waits on, its choices on it. */
export function AskCard({ ask, at }: { ask: Ask; at: string }) {
  const world = useWorld()
  const [writing, setWriting] = useState<string | null>(null)
  return (
    <div className={s.ask} data-move={`ask_${ask.blocker.key}`}>
      <CallCard
        kind="Blocker abandoned"
        title={`${shortOf(ask.blocker.key)} was abandoned`}
        because={because(world, ask)}
        options={[]}
        at={at}
        onOpen={() => openTask(ask.blocker.key)}
        next={<Decide ask={ask} onWrite={setWriting} />}
      />
      {writing !== null && <Word dep={writing} onDone={() => setWriting(null)} />}
    </div>
  )
}

/* ——— B: the chain under a blocker's card ——— */

/** What waits for a task, and what waits for that, a line each, under its card: the chain read at a glance. */
export function Followers({ of, depth = 0 }: { of: string; depth?: number }) {
  const world = useWorld()
  const after = waitingOn(world, of)
  if (after.length === 0) return null
  return (
    <ul className={s.followers} data-depth={depth}>
      {after.map((one) => {
        const also = openBlockers(world, one).filter((blocker) => blocker.key !== of)
        return (
          <li key={one.key}>
            <span className={s.follower}>
              <Icon name="after" size={11} className={s.afterMark} />
              <LinkButton className={s.followerName} onClick={() => openTask(one.key)}>
                {shortOf(one.key)}
              </LinkButton>
              {also.length > 0 && <span className={s.also}>· also {listed(also.map((blocker) => shortOf(blocker.key)))}</span>}
              {one.held && <span className={s.also}>· held</span>}
            </span>
            {depth < 2 && <Followers of={one.key} depth={depth + 1} />}
          </li>
        )
      })}
    </ul>
  )
}

/** B: an abandoned task something waits on keeps its own card, in Needs you, with what waits on it and the choices. */
export function AbandonedCard({ ask, at }: { ask: Ask; at: string }) {
  const [writing, setWriting] = useState<string | null>(null)
  return (
    <div className={s.ask} data-move={`ask_${ask.blocker.key}`}>
      <BoardCard
        status={TaskStatus.Yours}
        word="Abandoned"
        kind={TaskKind.Change}
        at={at}
        title={specOf(ask.blocker.key).title}
        why={`${listed(ask.waiting.map((one) => shortOf(one.key)))} ${ask.waiting.length === 1 ? 'waits' : 'wait'} for it`}
        foot={<Followers of={ask.blocker.key} />}
        next={<Decide ask={ask} onWrite={setWriting} />}
        onOpen={() => openTask(ask.blocker.key)}
      />
      {writing !== null && <Word dep={writing} onDone={() => setWriting(null)} />}
    </div>
  )
}

/* ——— setting what a task waits for ——— */

/** A: what a task that hasn't started can wait for, and what it can stop waiting for, as a menu. */
export function WaitMenu({ task, trigger }: { task: TaskNow; trigger?: React.ReactElement }) {
  const world = useWorld()
  const open = openBlockers(world, task)
  const can = choicesFor(world, task.key)
  return (
    <Menu
      trigger={trigger ?? <IconButton icon="more" label="What it waits for" size="small" />}
      label={`What ${shortOf(task.key)} waits for`}
      align="end"
      width={280}
    >
      <MenuGroup label="Wait for">
        {can.map((one) => (
          <MenuItem
            key={one.task.key}
            icon="after"
            disabled={one.loops}
            {...(one.loops ? { hint: `waits for ${shortOf(task.key)}` } : { hint: stateWord(one.task) })}
            onSelect={() => move({ kind: 'block', key: task.key, on: one.task.key })}
          >
            {shortOf(one.task.key)}
          </MenuItem>
        ))}
      </MenuGroup>
      {open.length > 0 && <MenuSeparator />}
      {open.map((one) => (
        <MenuItem key={one.key} icon="close" onSelect={() => move({ kind: 'unblock', key: task.key, on: one.key })}>
          Stop waiting for {shortOf(one.key)}
        </MenuItem>
      ))}
    </Menu>
  )
}

/** A: under a task's header, while it hasn't started: what it waits for, each with how it stands and a way off, and Wait for. */
export function WaitsLine({ task }: { task: TaskNow }) {
  const world = useWorld()
  useStore(direction)
  if (!unstarted(task)) return null
  const all = task.blockers.map((key) => world.byKey.get(key)).filter((one): one is TaskNow => one !== undefined)
  return (
    <div className={s.line} aria-label="What it waits for">
      <span className={s.lineHead}>Waits for</span>
      {all.length === 0 && <span className={s.none}>Nothing</span>}
      {all.map((one) => (
        <span key={one.key} className={s.chip} data-phase={one.phase}>
          <LinkButton className={s.chipName} onClick={() => openTask(one.key)}>
            {shortOf(one.key)}
          </LinkButton>
          <span className={s.chipState}>{stateWord(one)}</span>
          {one.phase !== 'merged' && (
            <button
              type="button"
              className={s.chipOff}
              aria-label={`Stop waiting for ${shortOf(one.key)}`}
              onClick={() => move({ kind: 'unblock', key: task.key, on: one.key })}
            >
              <Icon name="close" size={10} />
            </button>
          )}
        </span>
      ))}
      <WaitMenu
        task={task}
        trigger={
          <button type="button" className={s.add}>
            <Icon name="plus" size={11} />
            Wait for…
          </button>
        }
      />
      {task.held && <span className={s.note}>Held: it waits for your word too.</span>}
    </div>
  )
}

/** B: under a task's header: what it comes after, and what comes after it, with a way to add one after it. */
export function ChainLine({ task }: { task: TaskNow }) {
  const world = useWorld()
  const before = task.blockers.map((key) => world.byKey.get(key)).filter((one): one is TaskNow => one !== undefined)
  const after = waitingOn(world, task.key)
  const can = followersFor(world, task.key)
  if (task.phase === 'merged' && after.length === 0) return null
  return (
    <div className={s.line} aria-label="Before and after it">
      {before.length > 0 && (
        <>
          <span className={s.lineHead}>After</span>
          {before.map((one) => (
            <span key={one.key} className={s.chip} data-phase={one.phase}>
              <LinkButton className={s.chipName} onClick={() => openTask(one.key)}>
                {shortOf(one.key)}
              </LinkButton>
              <span className={s.chipState}>{stateWord(one)}</span>
            </span>
          ))}
        </>
      )}
      <span className={s.lineHead}>Then</span>
      {after.length === 0 && <span className={s.none}>Nothing waits for it</span>}
      {after.map((one) => (
        <span key={one.key} className={s.chip} data-phase={one.phase}>
          <LinkButton className={s.chipName} onClick={() => openTask(one.key)}>
            {shortOf(one.key)}
          </LinkButton>
        </span>
      ))}
      {task.phase !== 'merged' && task.phase !== 'abandoned' && can.length > 0 && (
        <Menu
          trigger={
            <button type="button" className={s.add}>
              <Icon name="plus" size={11} />
              Then…
            </button>
          }
          label={`What starts after ${shortOf(task.key)}`}
          width={280}
        >
          {can.map((one) => (
            <MenuItem
              key={one.task.key}
              icon="after"
              disabled={one.loops}
              {...(one.loops ? { hint: `${shortOf(task.key)} waits for it` } : { hint: one.task.held ? 'Held' : 'Not started' })}
              onSelect={() => move({ kind: 'block', key: one.task.key, on: task.key })}
            >
              {shortOf(one.task.key)}
            </MenuItem>
          ))}
        </Menu>
      )}
    </div>
  )
}
