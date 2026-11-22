import {
  Brand,
  BrandMark,
  Button,
  Code,
  ControlDetail,
  CopyButton,
  Dialog,
  Icon,
  KeepAwake,
  LinkButton,
  Problem,
  SettingList,
  SettingSwitch,
  Spinner,
} from '@althar/ui'

import { SheetFact } from '../../../../../packages/ui/src/setup/ToolTiles/ToolParts'
import tt from '../../../../../packages/ui/src/setup/ToolTiles/ToolTiles.module.css'
import { text as settingsText } from '../../../src/renderer/features/settings/text'
import { STUDIO, type Worker } from '../data'
import { Glyph, pictureOf } from '../glyph'
import { HostedReadings, Readings, Slider } from '../parts'
import type { Ctx } from '../types'
import { words } from '../words'
import x from './settings.module.css'

/*
 * What Computers is made of in every take. A computer opened out is the same
 * sheet in all three, as an MCP server opens out of its tile: its readings
 * beside what it is, then its settings, and taking it out apart at the foot.
 * Althar Cloud's pieces are in cloud.tsx.
 */

/** The home's computers as Settings lists them: the home first, then the others; on studio, This Mac last, lent or not. */
export const computersOf = (ctx: Ctx): Worker[] => (ctx.workers.some((one) => one.here) ? [...ctx.workers] : [...ctx.workers, ctx.mac])

/** This Mac seen from a home it isn't: it runs that home's tasks only where it is lent. */
export const lendable = (ctx: Ctx, worker: Worker) => worker.here && !worker.home && ctx.pov !== 'local'

/** Whether a computer takes the home's new tasks: This Mac on studio where it is lent, the rest by their own switch. */
export const takingOf = (ctx: Ctx, worker: Worker) => (lendable(ctx, worker) ? ctx.lent : ctx.taking(worker.id))
export const setTakingOf = (ctx: Ctx, worker: Worker) => (on: boolean) =>
  lendable(ctx, worker) ? ctx.setLent(on) : ctx.setTaking(worker.id, on)

/** Where a computer stands, in a few words; This Mac on studio, unlent, runs your own projects only. */
export const stateOf = (ctx: Ctx, worker: Worker) =>
  lendable(ctx, worker) && !ctx.lent ? 'Your own projects only' : words.state(worker, takingOf(ctx, worker))

/** Its picture: the home's house, else a computer, or a server where two kinds are told apart. */
export function KindGlyph({ ctx, worker, size = 14, className }: { ctx: Ctx; worker: Worker; size?: number; className?: string }) {
  return <Glyph kind={pictureOf(worker, ctx.twoKinds)} size={size} {...(className === undefined ? {} : { className })} />
}

/** What it is, at the sheet's head: the home says so, the rest what they are. */
export const asideOf = (worker: Worker) => (worker.home ? words.home : worker.model)

const BRANDS = { 'Claude Code': Brand.ClaudeCode, Codex: Brand.Codex } as const

function Version({ ctx, worker }: { ctx: Ctx; worker: Worker }) {
  if (worker.version === STUDIO.latest) return <span>{worker.version}</span>
  return (
    <span className={x.inline}>
      {worker.version}
      <LinkButton onClick={() => ctx.say(`Updates ${worker.name} once its agents finish their turns`)}>
        {words.update(STUDIO.latest)}
      </LinkButton>
    </span>
  )
}

/** What a computer is, a fact a row; a hosted home, where it is. */
function Facts({ ctx, worker }: { ctx: Ctx; worker: Worker }) {
  if (worker.hosted !== null)
    return (
      <div className={x.facts}>
        <SheetFact label={words.facts.devices}>{words.devices}</SheetFact>
      </div>
    )
  return (
    <div className={x.facts}>
      <SheetFact label={words.facts.computer}>{words.computer(worker)}</SheetFact>
      {worker.address !== null && (
        <SheetFact label={words.facts.address}>
          <Code className={x.address}>{worker.address}</Code>
        </SheetFact>
      )}
      <SheetFact label={words.facts.agents}>
        <span className={x.marks}>
          {worker.providers.map((one) => (
            <span key={one} className={x.inline}>
              <BrandMark brand={BRANDS[one]} size={13} />
              {one}
            </span>
          ))}
        </span>
      </SheetFact>
      <SheetFact label={words.facts.version}>
        <Version ctx={ctx} worker={worker} />
      </SheetFact>
      {worker.home && !worker.here && <SheetFact label={words.facts.devices}>{words.devices}</SheetFact>}
    </div>
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

/**
 * A computer, as its sheet holds it: its readings beside what it is; its agents at once, whether it takes new tasks
 * (where the take doesn't put that on its tile) and the home's own; taking it out at the foot.
 */
export function ComputerBody({ ctx, worker, taking = true }: { ctx: Ctx; worker: Worker; taking?: boolean }) {
  const lent = lendable(ctx, worker)
  const runs = !lent || ctx.lent
  return (
    <div className={x.body}>
      <div className={`${tt.sheet} ${x.glance}`}>
        <div className={x.readings}>
          {worker.offline !== null ? (
            <Problem>
              {words.away(worker)}. {words.holding(worker)}.
            </Problem>
          ) : worker.hosted !== null ? (
            <HostedReadings ctx={ctx} />
          ) : (
            <Readings worker={worker} load={ctx.loadOf(worker)} waiting={worker.home ? ctx.waiting.length : 0} width={268} />
          )}
        </div>
        <Facts ctx={ctx} worker={worker} />
      </div>
      <div className={`${tt.sheet} ${x.settings}`}>
        <SettingList>
          {lent && <Lend ctx={ctx} />}
          {runs && worker.hosted === null && <Slider ctx={ctx} worker={worker} compact={false} note={null} />}
          {taking && !lent && worker.hosted === null && (
            <SettingSwitch
              title={words.takeTitle}
              note={words.takeNote}
              glyph={<Icon name="play" size={14} />}
              checked={ctx.taking(worker.id)}
              onChange={(on) => ctx.setTaking(worker.id, on)}
            />
          )}
          {worker.home && ctx.pov !== 'local' && (
            <SettingSwitch
              title={settingsText.pauseAllTitle}
              note={settingsText.pauseAllNote}
              glyph={<Icon name="hold" size={15} />}
              checked={false}
              onChange={() => undefined}
            />
          )}
        </SettingList>
      </div>
      {!worker.home && !worker.here && (
        <div className={tt.foot}>
          <LinkButton className={tt.danger} onClick={() => ctx.say(`Asks first, then takes ${worker.name} out of ${ctx.home.name}`)}>
            {words.remove(worker.name)}
          </LinkButton>
        </div>
      )}
    </div>
  )
}

/** A computer opened out in place, with a way back. */
export function ComputerSheet({
  ctx,
  worker,
  onBack,
  back = words.computers,
  taking = true,
}: {
  ctx: Ctx
  worker: Worker
  onBack: () => void
  back?: string
  taking?: boolean
}) {
  return (
    <div className={tt.opened}>
      <ControlDetail title={worker.name} onBack={onBack} text={{ back }} aside={asideOf(worker)}>
        <ComputerBody ctx={ctx} worker={worker} taking={taking} />
      </ControlDetail>
    </div>
  )
}

/** Work on this Mac: this Mac's own, whichever home the window is on; on studio, lending it first. */
export function MacSection({ ctx }: { ctx: Ctx }) {
  return (
    <SettingList>
      {ctx.pov !== 'local' && <Lend ctx={ctx} />}
      <KeepAwake
        on
        onChange={() => undefined}
        onBattery={false}
        onBatteryChange={() => undefined}
        text={{ title: settingsText.awakeTitle, note: settingsText.awakeNote }}
      />
      <SettingSwitch title={settingsText.loadTitle} glyph={<Icon name="load" size={15} />} checked onChange={() => undefined} />
      <SettingSwitch
        title={settingsText.atLoginTitle}
        note={settingsText.atLoginNote}
        glyph={<Icon name="automation" size={15} />}
        checked={false}
        onChange={() => undefined}
      />
      {ctx.pov === 'local' && (
        <SettingSwitch
          title={settingsText.pauseAllTitle}
          note={settingsText.pauseAllNote}
          glyph={<Icon name="hold" size={15} />}
          checked={false}
          onChange={() => undefined}
        />
      )}
    </SettingList>
  )
}

/** Add a computer: one line to run on it, and the wait for it to join. */
export function AddComputer({ ctx, onClose }: { ctx: Ctx; onClose: () => void }) {
  const line = `curl -fsSL https://althar.dev/join | sh -s -- ${ctx.home.address ?? 'mac.tail9c2e.ts.net'} 7KQ2-M9XD`
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
      <span className={x.joining}>
        <Spinner size="small" />
        {words.addWaiting}
      </span>
    </Dialog>
  )
}
