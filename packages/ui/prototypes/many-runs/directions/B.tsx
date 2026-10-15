// Scrappy: B · a Runs panel, as the app's settings panel is made: every runnable a round switch with its state under it; each opens out to its output.
import { useState } from 'react'

import { Icon } from '../../../src/foundations/Icon/Icon'
import { Button } from '../../../src/primitives/Button/Button'
import { Code } from '../../../src/primitives/Code/Code'
import { KeyValues } from '../../../src/primitives/KeyValues/KeyValues'
import { LinkButton } from '../../../src/primitives/LinkButton/LinkButton'
import { LiveDot } from '../../../src/primitives/LiveDot/LiveDot'
import { Spinner } from '../../../src/primitives/Spinner/Spinner'
import { Switch } from '../../../src/primitives/Switch/Switch'
import {
  ControlCenter,
  ControlDetail,
  ControlFoot,
  ControlGrid,
  ControlModule,
  ControlSheet,
  ControlToggle,
  ControlWords,
} from '../../../src/setup/ControlCenter/ControlCenter'
import { Terminal } from '../../../src/thread/Terminal/Terminal'
import { addressOf } from '../../../../../apps/desktop/src/renderer/shared/running'
import { AddForm, type AddWay, css, EditForm, isLive, label, outputOf, RunGlyph, sourceText, stateOf, useRuns, whereOf } from '../parts'
import { type Opening, proto, RUNNABLES, TASK } from '../state'

type Showing = { kind: 'all' } | { kind: 'one'; id: string } | { kind: 'edit'; id: string } | { kind: 'add'; way: AddWay }

const showingOf = (opening: Opening, task: boolean): Showing =>
  opening === 'detail' || opening === 'output'
    ? { kind: 'one', id: task ? 'storybook' : 'dev' }
    : opening === 'edit'
      ? { kind: 'edit', id: 'storybook' }
      : opening === 'add' || opening === 'scripts' || opening === 'ask' || opening === 'asked'
        ? { kind: 'add', way: opening === 'scripts' ? 'scripts' : opening === 'add' ? 'type' : 'ask' }
        : { kind: 'all' }

const opensPanel = (opening: Opening) =>
  opening !== null && ['menu', 'detail', 'output', 'edit', 'add', 'scripts', 'ask', 'asked'].includes(opening)

export function B() {
  const r = useRuns()
  const task = r.screen.place === 'task'
  const [open, setOpen] = useState(opensPanel(r.opening))
  const [showing, setShowing] = useState<Showing>(showingOf(r.opening, task))
  const all = () => setShowing({ kind: 'all' })

  const def = r.def
  const defRun = def === null ? null : r.runOf(def)

  // The default, one press, as today: while it runs, where it answers.
  const today =
    def === null ? null : isLive(defRun) ? (
      <Button size="small" variant="quiet" busy={defRun.state === 'starting'} onClick={() => r.open(defRun)}>
        <span className={css.inline}>
          <LiveDot />
          {defRun.url === null ? label(def) : `${label(def)} · ${addressOf(defRun.url)}`}
        </span>
      </Button>
    ) : (
      <Button size="small" variant="quiet" icon="terminal" onClick={() => r.start(def)}>
        {`Run ${label(def)}`}
      </Button>
    )

  const live = r.live.length + r.inTasks.length
  const trigger =
    def === null ? (
      <Button size="small" variant="quiet" icon="terminal">
        Run
      </Button>
    ) : live > 0 ? (
      <Button size="small" variant="quiet" trailingIcon="chevronD">
        <span className={css.inline}>
          <LiveDot />
          {`${live} running`}
        </span>
      </Button>
    ) : (
      <Button size="small" variant="quiet" icon="list" trailingIcon="chevronD">
        {r.runnables.length === 1 ? 'More' : `${r.runnables.length} to run`}
      </Button>
    )

  const panel = (() => {
    if (showing.kind === 'add')
      return (
        <ControlDetail title="Add something to run" onBack={all} text={{ back: 'Back to what runs' }}>
          <ControlSheet>
            <AddForm way={showing.way} compact onDone={all} />
          </ControlSheet>
        </ControlDetail>
      )
    if (showing.kind === 'edit') {
      const one = r.runnables.find((each) => each.id === showing.id)
      return (
        <ControlDetail title={`Edit ${one === undefined ? '' : label(one)}`} onBack={all} text={{ back: 'Back to what runs' }}>
          <ControlSheet>
            <EditForm id={showing.id} onDone={all} />
          </ControlSheet>
        </ControlDetail>
      )
    }
    if (showing.kind === 'one') {
      const one = r.runnables.find((each) => each.id === showing.id)
      if (one === undefined) return null
      const run = r.runOf(one)
      const output = outputOf(one, run)
      return (
        <ControlDetail
          title={label(one)}
          onBack={all}
          text={{ back: 'Back to what runs' }}
          aside={<Switch checked={isLive(run)} onChange={() => r.toggle(one)} label={`${label(one)} running`} />}
        >
          <ControlSheet>
            <KeyValues
              keyWidth={92}
              items={[
                ['Command', <Code key="c">{one.command}</Code>],
                ['Runs', one.where === 'main' ? 'Always on main' : task ? 'In this task’s worktree' : 'On main'],
                ['Now', stateOf(one, run, r.now) ?? 'Not running'],
                ['Came from', one.source === 'repository' ? 'Worked out from package.json' : sourceText[one.source]],
                [
                  'Default',
                  r.defaultId === one.id ? (
                    'The one Run runs'
                  ) : (
                    <LinkButton key="d" onClick={() => proto.makeDefault(one.id)}>
                      Make it the default
                    </LinkButton>
                  ),
                ],
              ]}
            />
          </ControlSheet>
          {run !== null && (
            <ControlSheet>
              <Terminal {...output} />
            </ControlSheet>
          )}
          <ControlFoot>
            <Button size="small" icon="pencil" onClick={() => setShowing({ kind: 'edit', id: one.id })}>
              Edit
            </Button>
            {run?.url != null && (
              <Button size="small" icon="external" onClick={() => r.open(run)}>
                {`Open ${addressOf(run.url)}`}
              </Button>
            )}
            <span className={css.grow} />
            <Button
              size="small"
              variant="danger"
              icon="close"
              onClick={() => {
                proto.remove(one.id)
                all()
              }}
            >
              Remove
            </Button>
          </ControlFoot>
        </ControlDetail>
      )
    }
    if (def === null)
      return (
        <>
          <ControlGrid>
            <ControlModule title="Nothing to run yet" onClick={() => setShowing({ kind: 'add', way: 'ask' })}>
              <ControlWords
                title="Ask the coordinator to work it out"
                line="It reads package.json and DEVELOPMENT.md, and says what it would keep."
                mark={<Icon name="agents" size={22} />}
              />
            </ControlModule>
          </ControlGrid>
          <ControlFoot>
            <Button size="small" icon="list" onClick={() => setShowing({ kind: 'add', way: 'scripts' })}>
              Pick from package.json
            </Button>
            <Button size="small" icon="terminal" onClick={() => setShowing({ kind: 'add', way: 'type' })}>
              Type a command
            </Button>
          </ControlFoot>
        </>
      )
    return (
      <>
        <ControlGrid>
          {r.runnables.map((one) => {
            const run = r.runOf(one)
            const on = isLive(run)
            const there = r.elsewhere(one)
            return (
              <ControlToggle
                key={one.id}
                title={r.defaultId === one.id ? `${label(one)} · default` : label(one)}
                line={
                  <span className={css.inline}>
                    {run !== null && !on && <RunGlyph run={run} />}
                    {stateOf(one, run, r.now) ??
                      (there !== null
                        ? `${there.place === 'main' ? 'On main' : 'In a task'} · ${there.url === null ? 'running' : addressOf(there.url)}`
                        : `${whereOf(one, r.screen)} · ${sourceText[one.source]}`)}
                  </span>
                }
                on={on}
                onChange={() => r.toggle(one)}
                glyph={
                  run?.state === 'starting' ? <Spinner size="small" tone="onFill" /> : <Icon name={on ? 'square' : 'play'} size={15} />
                }
                onOpen={() => setShowing({ kind: 'one', id: one.id })}
              />
            )
          })}
          {r.inTasks.length > 0 && (
            <ControlModule title="Running in tasks" aside={String(r.inTasks.length)} onClick={() => undefined}>
              <ControlWords
                title={r.inTasks
                  .map((run) => {
                    const one = RUNNABLES[run.runnableId]
                    return one === undefined ? '' : `${label(one)}${run.url === null ? '' : ` · ${addressOf(run.url)}`}`
                  })
                  .join(', ')}
                line={`In “${TASK.title}”`}
              />
            </ControlModule>
          )}
        </ControlGrid>
        <ControlFoot>
          <Button size="small" icon="plus" onClick={() => setShowing({ kind: 'add', way: 'type' })}>
            Add something to run
          </Button>
          <Button size="small" variant="quiet" icon="agents" onClick={() => setShowing({ kind: 'add', way: 'ask' })}>
            Ask the coordinator
          </Button>
        </ControlFoot>
      </>
    )
  })()

  return (
    <>
      {today}
      <ControlCenter
        trigger={trigger}
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (next) all()
        }}
        onEscapeKeyDown={(event) => {
          if (event.defaultPrevented || showing.kind === 'all') return
          event.preventDefault()
          all()
        }}
        width={showing.kind === 'one' ? 560 : showing.kind === 'all' ? 480 : 520}
        text={{ label: task ? 'What this task runs' : 'What althar runs' }}
      >
        {panel}
      </ControlCenter>
    </>
  )
}
