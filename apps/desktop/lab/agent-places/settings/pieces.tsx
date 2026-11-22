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
  Select,
  SettingList,
  SettingRow,
  SettingSwitch,
  Spinner,
} from '@althar/ui'

import { SheetFact } from '../../../../../packages/ui/src/setup/ToolTiles/ToolParts'
import tt from '../../../../../packages/ui/src/setup/ToolTiles/ToolTiles.module.css'
import { text as settingsText } from '../../../src/renderer/features/settings/text'
import { STUDIO, type Worker } from '../data'
import { Glyph } from '../glyph'
import { HostedReadings, Readings, RunnersSlider, Slider, SplitBar } from '../parts'
import type { Ctx } from '../types'
import { words } from '../words'
import x from './settings.module.css'

/*
 * What Computers is made of in every take. A computer opened out is the same
 * sheet in all three, as an MCP server opens out of its tile: its readings
 * beside what it is, then its settings, and taking it out apart at the foot.
 * The cloud runners open the same way, to what runs on them and what they
 * cost; a home hosted in Althar Cloud, to where it is and its storage.
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

/** Its picture: what it is, or unlinked where it is out of reach. */
export function KindGlyph({ worker, size = 14, className }: { worker: Worker; size?: number; className?: string }) {
  if (worker.offline !== null) return <Icon name="unlinked" size={size} {...(className === undefined ? {} : { className })} />
  return <Glyph kind={worker.kind} size={size} {...(className === undefined ? {} : { className })} />
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
        <SheetFact label={words.region}>{worker.hosted.region}</SheetFact>
        <SheetFact label={words.facts.version}>
          <Version ctx={ctx} worker={worker} />
        </SheetFact>
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
            <HostedReadings ctx={ctx} worker={worker} />
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

const LIMITS = ['20', '40', '100', 'none'] as const
type Limit = (typeof LIMITS)[number]

/** What runs on the runners, a row a task: its agent's mark, its title, its project and how long. */
export function Runs({ ctx, most = Number.POSITIVE_INFINITY }: { ctx: Ctx; most?: number }) {
  const running = ctx.runners!.running
  if (running.length === 0) return <span className={x.none}>{words.runnersNow(ctx.runners!)}</span>
  const shown = running.slice(0, running.length > most ? most - 1 : most)
  return (
    <span className={x.runs}>
      {shown.map((one) => (
        <span key={one.taskId} className={x.run}>
          <BrandMark brand={one.mark} size={12} />
          <span className={x.runTitle}>{one.title}</span>
          <span className={x.runLine}>{words.run(one.project, one.for)}</span>
        </span>
      ))}
      {shown.length < running.length && <span className={x.runMore}>{words.more(running.length - shown.length)}</span>}
    </span>
  )
}

/** The cloud runners opened out: what runs on them beside where and what they cost; their number, how they start, the limit. */
export function RunnersSheet({ ctx, onBack }: { ctx: Ctx; onBack: () => void }) {
  const runners = ctx.runners!
  const limit: Limit = runners.limit === null ? 'none' : (String(runners.limit) as Limit)
  return (
    <div className={tt.opened}>
      <ControlDetail title={words.runners} onBack={onBack} text={{ back: words.computers }} aside={words.cloud}>
        <div className={x.body}>
          <div className={`${tt.sheet} ${x.glance}`}>
            <div className={x.readings}>
              <h3 className={x.eyebrow}>{words.running}</h3>
              <Runs ctx={ctx} />
            </div>
            <div className={x.facts}>
              <SheetFact label={words.thisMonth}>
                <span className={x.spent}>
                  {words.spend(runners)}
                  <SplitBar total={runners.limit === null ? 0 : runners.spent / runners.limit} ours={0} />
                  <span className={x.spentNote}>{words.resets}</span>
                </span>
              </SheetFact>
              <SheetFact label={words.region}>{runners.region}</SheetFact>
              <SheetFact label={words.each}>{runners.size}</SheetFact>
              <SheetFact label={words.facts.agents}>{words.signedIn}</SheetFact>
            </div>
          </div>
          <div className={`${tt.sheet} ${x.settings}`}>
            <SettingList>
              <RunnersSlider ctx={ctx} compact={false} />
              <SettingSwitch
                title={words.autoTitle}
                note={words.autoNote}
                glyph={<Icon name="play" size={14} />}
                checked={runners.auto}
                onChange={ctx.setAuto}
              />
              <SettingRow title={words.limitTitle} note={words.limitNote} glyph={<Icon name="hold" size={15} />}>
                {() => (
                  <Select
                    label={words.limitTitle}
                    options={LIMITS.map((one) => ({ value: one, label: one === 'none' ? words.noLimit : words.dollars(Number(one)) }))}
                    value={limit}
                    onChange={(one) => ctx.setLimit(one === 'none' ? null : Number(one))}
                    width={110}
                  />
                )}
              </SettingRow>
            </SettingList>
          </div>
          {ctx.pov !== 'cloud' && (
            <div className={tt.foot}>
              <LinkButton className={tt.danger} onClick={() => ctx.say('Asks first; runners at work finish their tasks')}>
                {words.stopRunners}
              </LinkButton>
            </div>
          )}
        </div>
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
