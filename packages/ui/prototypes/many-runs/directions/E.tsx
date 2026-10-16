// Scrappy: E · a Runs dock beside the work, as the board's dock is: what runs here as the thread's run cards, the output of one, and the rest to run.
import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { Dock, PeekFoot, PeekSection } from '../../../src/dock/Dock/Dock'
import { ListPeek } from '../../../src/dock/ListPeek/ListPeek'
import { Button } from '../../../src/primitives/Button/Button'
import { LiveDot } from '../../../src/primitives/LiveDot/LiveDot'
import { Segmented } from '../../../src/primitives/Segmented/Segmented'
import { RunCard } from '../../../src/thread/RunCard/RunCard'
import { Terminal } from '../../../src/thread/Terminal/Terminal'
import { addressOf } from '../../../../../apps/desktop/src/renderer/shared/running'
import { ago, running } from '../../../../../apps/desktop/src/renderer/shared/time'
import { css, isLive, label, outputOf, sourceText, useDialogs, useRuns, whereOf } from '../parts'
import { proto, type Run, useProto } from '../state'

const WIDTH = 420
const iso = (ms: number) => new Date(ms).toISOString()

export function E() {
  const r = useRuns()
  const { bare } = useProto()
  const dialogs = useDialogs()
  const task = r.screen.place === 'task'
  const [open, setOpen] = useState(r.opening === 'rail' || r.opening === 'output')
  const [top, setTop] = useState(0)
  const anchor = useRef<HTMLSpanElement>(null)
  // The dock hangs under the bar its button is in: the project's front, or the task's bar.
  useLayoutEffect(() => {
    const bar = anchor.current?.closest('header') ?? anchor.current?.parentElement?.parentElement
    if (bar) setTop(bar.getBoundingClientRect().bottom)
  }, [open])

  const def = r.def
  const defRun = def === null ? null : r.runOf(def)
  const here = r.runnables.flatMap((one) => {
    const run = r.runOf(one)
    return run === null ? [] : [{ one, run }]
  })
  const resting = r.runnables.filter((one) => r.runOf(one) === null)
  const [picked, setPicked] = useState<string | null>(null)
  const shown =
    here.find(({ run }) => run.id === picked) ?? here.find(({ run }) => r.opening === 'output' && run.state === 'failed') ?? here[0]

  const card = ({ one, run }: { one: (typeof r.runnables)[number]; run: Run }) => (
    <RunCard
      key={run.id}
      where={whereOf(one, r.screen)}
      command={one.command}
      {...(run.url !== null
        ? { url: addressOf(run.url), onOpen: () => r.open(run) }
        : run.state === 'running'
          ? { url: 'its own window' }
          : {})}
      since={run.endedAt === null ? running(iso(run.startedAt), r.now) : ago(iso(run.endedAt), new Date(r.now))}
      {...(isLive(run) ? {} : { ended: { code: run.code, stopped: run.state === 'stopped' } })}
      onStop={() => proto.stop(run.id)}
      onRunAgain={() => proto.again(run.id)}
      text={{ running: label(one), ran: label(one) }}
    />
  )

  const dock = open && (
    <div style={{ position: 'fixed', top, right: 0, bottom: bare ? 0 : 44, width: WIDTH, zIndex: 3, display: 'flex' }} className="ch-root">
      <style>{`${task ? '[class*="__face__"]' : '[class*="__rooms__"]'} { margin-right: ${WIDTH}px; }`}</style>
      <Dock
        label="Runs"
        name="Runs"
        sub={`${task ? 'this task' : 'althar on main'} · ${r.live.length === 0 ? 'nothing running' : `${r.live.length} running`}`}
        onClose={() => setOpen(false)}
        className={css.grow}
      >
        {def === null ? (
          <PeekSection label="Nothing to run yet">
            <div className={css.stack}>
              <p className={css.meta} style={{ whiteSpace: 'normal', margin: 0 }}>
                Althar runs what you keep here itself, with no agent, and shows where it answers and what it printed.
              </p>
              <div className={css.row}>
                <Button size="small" icon="agents" onClick={() => dialogs.add('ask')}>
                  Ask the coordinator
                </Button>
                <Button size="small" variant="quiet" icon="list" onClick={() => dialogs.add('scripts')}>
                  Pick from package.json
                </Button>
              </div>
            </div>
          </PeekSection>
        ) : (
          <>
            {here.length > 0 && (
              <PeekSection label={task ? 'In this task' : 'On main'}>
                <div className={css.cards}>{here.map(card)}</div>
              </PeekSection>
            )}
            {shown !== undefined && (
              <PeekSection label="Output">
                <div className={css.stack}>
                  {here.length > 1 && (
                    <Segmented<string>
                      label="Whose output"
                      value={shown.run.id}
                      onChange={setPicked}
                      options={here.map(({ one, run }) => ({
                        value: run.id,
                        label: one.name ?? one.command,
                        ...(run.state === 'failed' ? { dot: 'yours' as const, dotLabel: 'failed' } : {}),
                      }))}
                    />
                  )}
                  <Terminal {...outputOf(shown.one, shown.run)} />
                </div>
              </PeekSection>
            )}
            {resting.length > 0 && (
              <ListPeek
                sections={[
                  {
                    label: here.length > 0 ? 'Not running' : 'To run',
                    entries: resting.map((one) => ({
                      id: one.id,
                      title: r.defaultId === one.id ? `${label(one)} · default` : label(one),
                      meta: `${one.name === undefined ? '' : `${one.command} · `}${whereOf(one, r.screen)} · ${sourceText[one.source]}`,
                    })),
                  },
                ]}
                onOpen={(id) => {
                  const one = r.runnables.find((each) => each.id === id)
                  if (one !== undefined) r.start(one)
                }}
              />
            )}
            {r.inTasks.length > 0 && (
              <PeekSection label="In tasks">
                <div className={css.cards}>
                  {r.inTasks.map((run) => {
                    const one = r.runnables.find((each) => each.id === run.runnableId)
                    return one === undefined ? null : (
                      <RunCard
                        key={run.id}
                        where="Give Download the installer…"
                        command={one.command}
                        {...(run.url !== null
                          ? { url: addressOf(run.url), onOpen: () => r.open(run) }
                          : run.state === 'running'
                            ? { url: 'its own window' }
                            : {})}
                        since={running(iso(run.startedAt), r.now)}
                        onStop={() => proto.stop(run.id)}
                        text={{ running: label(one) }}
                      />
                    )
                  })}
                </div>
              </PeekSection>
            )}
          </>
        )}
        {def !== null && (
          <PeekFoot>
            <div className={css.row}>
              <Button size="small" icon="plus" onClick={() => dialogs.add('type')}>
                Add
              </Button>
              <Button size="small" variant="quiet" icon="agents" onClick={() => dialogs.add('ask')}>
                Ask the coordinator
              </Button>
              <span className={css.grow} />
              <Button size="small" variant="quiet" icon="list" onClick={() => dialogs.manage()}>
                Edit the list
              </Button>
            </div>
          </PeekFoot>
        )}
      </Dock>
    </div>
  )

  return (
    <>
      <span ref={anchor} style={{ display: 'contents' }} />
      {def !== null &&
        (isLive(defRun) ? (
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
        ))}
      <Button size="small" variant={open ? 'default' : 'quiet'} icon="list" aria-expanded={open} onClick={() => setOpen(!open)}>
        {r.live.length > 0 ? `Runs · ${r.live.length}` : def === null ? 'Run' : 'Runs'}
      </Button>
      {dock !== false && createPortal(dock, document.body)}
      {dialogs.node}
    </>
  )
}
