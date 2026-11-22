import type { ReactNode } from 'react'
import {
  Button,
  Code,
  CopyButton,
  Dialog,
  Icon,
  IconButton,
  KeepAwake,
  KeyValues,
  LinkButton,
  SettingList,
  SettingRow,
  SettingSwitch,
  Spinner,
} from '@althar/ui'

import { text as settingsText } from '../../../src/renderer/features/settings/text'
import { STUDIO, type Worker } from '../data'
import { Gauges, Readings, Slider } from '../parts'
import type { Ctx } from '../types'
import { words } from '../words'
import x from './settings.module.css'

/*
 * What the takes on Settings are made of, all the kit's own rows: a worker's
 * row, its health at the end, opening in place to what it is and its
 * settings; a worker's page, its readings beside what it is; This Mac's own
 * settings; and Add a worker.
 */

/** A worker's line, problems first: out of reach, taking nothing new, lowered for now, or how many work. */
export function Status({ ctx, worker }: { ctx: Ctx; worker: Worker }) {
  const said = (() => {
    if (worker.offline !== null)
      return (
        <>
          <span className={x.danger}>{words.away(worker)}</span> · {words.holding(worker)}
        </>
      )
    if (!ctx.taking(worker.id)) return words.notTaking
    return words.line(worker)
  })()
  return worker.home ? (
    <>
      {words.home} · {said}
    </>
  ) : (
    said
  )
}

/** Althar's version on it, and the way to the latest where it is behind. */
function Version({ ctx, worker }: { ctx: Ctx; worker: Worker }) {
  if (worker.version === STUDIO.latest) return <>{worker.version}</>
  return (
    <span className={x.version}>
      {worker.version}
      <LinkButton onClick={() => ctx.say(`Updates ${worker.name}: its agents finish their turns first`)}>
        {words.update(STUDIO.latest)}
      </LinkButton>
    </span>
  )
}

/** What a worker is, a fact a line. */
export function Facts({ ctx, worker }: { ctx: Ctx; worker: Worker }) {
  const items: [string, ReactNode][] = [
    [words.facts.computer, words.computer(worker)],
    ...(worker.address === null ? [] : ([[words.facts.address, <Code key="a">{worker.address}</Code>]] as [string, ReactNode][])),
    [words.facts.agents, worker.providers.join(', ')],
    [words.facts.version, <Version key="v" ctx={ctx} worker={worker} />],
    ...(worker.home && !worker.here ? ([[words.facts.devices, words.devices]] as [string, ReactNode][]) : []),
  ]
  return <KeyValues items={items} keyWidth={78} className={x.facts} />
}

/** Whether a worker takes new tasks: off, it finishes what runs there. */
export function Taking({ ctx, worker }: { ctx: Ctx; worker: Worker }) {
  return (
    <SettingSwitch
      title={words.takeTitle}
      note={words.takeNote}
      glyph={<Icon name="play" size={14} />}
      checked={ctx.taking(worker.id)}
      onChange={(on) => ctx.setTaking(worker.id, on)}
    />
  )
}

/** The home's: pausing every automation. */
export function PauseAll() {
  return (
    <SettingSwitch
      title={settingsText.pauseAllTitle}
      note={settingsText.pauseAllNote}
      glyph={<Icon name="hold" size={15} />}
      checked={false}
      onChange={() => undefined}
    />
  )
}

/** On a home this Mac isn't: lending it, so it runs the home's tasks too. */
export function Lend({ ctx }: { ctx: Ctx }) {
  return (
    <SettingSwitch
      title={words.lend(ctx.home.name)}
      note={words.lendNote}
      glyph={<Icon name="computer" size={15} />}
      checked={ctx.lent}
      onChange={ctx.setLent}
    />
  )
}

/** Taking a worker out of the home, apart at the foot, in the danger colour. */
export function Remove({ ctx, worker }: { ctx: Ctx; worker: Worker }) {
  return (
    <SettingRow title={words.remove} note="What runs there stops, and its tasks start again on another worker.">
      {() => (
        <Button size="small" variant="danger" onClick={() => ctx.say(`Asks first, then takes ${worker.name} out of ${ctx.home.name}`)}>
          Remove…
        </Button>
      )}
    </SettingRow>
  )
}

/** A worker opened in place: what it is, then its settings; the home's, and taking it out, where they apply. */
function Opened({ ctx, worker, pauseAll }: { ctx: Ctx; worker: Worker; pauseAll: boolean }) {
  return (
    <div className={x.well}>
      <Facts ctx={ctx} worker={worker} />
      <SettingList>
        {worker.here && !worker.home && <Lend ctx={ctx} />}
        {worker.offline === null && <Slider ctx={ctx} worker={worker} compact={false} />}
        <Taking ctx={ctx} worker={worker} />
        {worker.home && pauseAll && <PauseAll />}
        {!worker.home && !worker.here && <Remove ctx={ctx} worker={worker} />}
      </SettingList>
    </div>
  )
}

/** A worker as a row: its name and line, its health at the end; pressed, it opens in place. */
export function WorkerRow({
  ctx,
  worker,
  open,
  onToggle,
  pauseAll,
}: {
  ctx: Ctx
  worker: Worker
  open: boolean
  onToggle: () => void
  /** The home's row holds pausing every automation. */
  pauseAll: boolean
}) {
  return (
    <div id={`worker-${worker.id}`} className={x.rowWrap}>
      <SettingRow
        title={worker.name}
        glyph={<Icon name={worker.home && !worker.here ? 'home' : 'computer'} size={15} />}
        note={<Status ctx={ctx} worker={worker} />}
        {...(open ? { under: <Opened ctx={ctx} worker={worker} pauseAll={pauseAll} /> } : {})}
      >
        {() => (
          <>
            {worker.offline === null && (
              <span className={x.gauges}>
                <Gauges load={ctx.loadOf(worker)} />
              </span>
            )}
            <IconButton icon={open ? 'chevronU' : 'chevronD'} label={open ? 'Close' : 'Open'} size="small" onClick={onToggle} />
          </>
        )}
      </SettingRow>
    </div>
  )
}

/** The home and its workers, each a row opening in place; on a home this Mac isn't, lending it; then Add a worker. */
export function WorkersList({
  ctx,
  opened,
  onOpen,
  pauseAll,
}: {
  ctx: Ctx
  opened: string | null
  onOpen: (worker: string | null) => void
  pauseAll: boolean
}) {
  return (
    <SettingList>
      {ctx.workers.map((one) => (
        <WorkerRow
          key={one.id}
          ctx={ctx}
          worker={one}
          open={opened === one.id}
          onToggle={() => onOpen(opened === one.id ? null : one.id)}
          pauseAll={pauseAll}
        />
      ))}
      {ctx.pov === 'remote' && !ctx.lent && <Lend ctx={ctx} />}
      <SettingRow title={words.add} glyph={<Icon name="plus" size={15} />}>
        {() => (
          <Button size="small" onClick={ctx.add}>
            Add…
          </Button>
        )}
      </SettingRow>
    </SettingList>
  )
}

/** This Mac's own: kept awake, its number (the Mac's, whichever home's work it runs), the meter, opening at login; the home's pause where it is the home. */
export function MacList({ ctx, pauseAll, lend }: { ctx: Ctx; pauseAll: boolean; lend: boolean }) {
  return (
    <SettingList>
      {lend && <Lend ctx={ctx} />}
      <KeepAwake
        on
        onChange={() => undefined}
        onBattery={false}
        onBatteryChange={() => undefined}
        text={{ title: settingsText.awakeTitle, note: settingsText.awakeNote }}
      />
      <Slider ctx={ctx} worker={ctx.mac} compact={false} />
      <SettingSwitch title={settingsText.loadTitle} glyph={<Icon name="load" size={15} />} checked onChange={() => undefined} />
      <SettingSwitch
        title={settingsText.atLoginTitle}
        note={settingsText.atLoginNote}
        glyph={<Icon name="automation" size={15} />}
        checked={false}
        onChange={() => undefined}
      />
      {pauseAll && <PauseAll />}
    </SettingList>
  )
}

/** A worker's own page: its readings beside what it is, its settings, and taking it out at the foot. */
export function WorkerPage({ ctx, worker }: { ctx: Ctx; worker: Worker }) {
  const isMac = worker.here
  const runs = !isMac || ctx.pov === 'local' || ctx.lent
  return (
    <>
      <div className={x.top}>
        <div className={x.readings}>
          <Readings worker={worker} load={ctx.loadOf(worker)} waiting={worker.home ? ctx.waiting.length : 0} width={300} />
        </div>
        <Facts ctx={ctx} worker={worker} />
      </div>
      <SettingList>
        {isMac && ctx.pov === 'remote' && <Lend ctx={ctx} />}
        {isMac && (
          <KeepAwake
            on
            onChange={() => undefined}
            onBattery={false}
            onBatteryChange={() => undefined}
            text={{ title: settingsText.awakeTitle, note: settingsText.awakeNote }}
          />
        )}
        {worker.offline === null && <Slider ctx={ctx} worker={worker} compact={false} />}
        {runs && <Taking ctx={ctx} worker={worker} />}
        {worker.home && <PauseAll />}
        {isMac && (
          <>
            <SettingSwitch title={settingsText.loadTitle} glyph={<Icon name="load" size={15} />} checked onChange={() => undefined} />
            <SettingSwitch
              title={settingsText.atLoginTitle}
              note={settingsText.atLoginNote}
              glyph={<Icon name="automation" size={15} />}
              checked={false}
              onChange={() => undefined}
            />
          </>
        )}
      </SettingList>
      {!worker.home && !isMac && (
        <div className={x.foot}>
          <SettingList>
            <Remove ctx={ctx} worker={worker} />
          </SettingList>
        </div>
      )}
    </>
  )
}

/** Add a worker: one line to run on the computer, and the wait for it to join. */
export function AddWorker({ ctx, onClose }: { ctx: Ctx; onClose: () => void }) {
  const line = `curl -fsSL https://althar.dev/worker | sh -s -- join ${ctx.home.address ?? 'mac.tail9c2e.ts.net'} 7KQ2-M9XD`
  return (
    <Dialog
      title={words.addTitle(ctx.home.name)}
      description={words.addNote}
      onClose={onClose}
      actions={<Button onClick={onClose}>Cancel</Button>}
      width={520}
    >
      <div className={x.command}>
        <Code className={x.line}>{line}</Code>
        <CopyButton value={line} ghost />
      </div>
      <span className={x.waiting}>
        <Spinner size="small" />
        {words.addWaiting}
      </span>
    </Dialog>
  )
}
