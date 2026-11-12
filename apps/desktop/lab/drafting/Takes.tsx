import { useEffect, useState, type ReactNode } from 'react'

import { Brand, BrandMark, Icon, Menu, MenuRadioGroup, MenuRadioItem, type ModelInfo, ModelPick, TaskEnd, taskEndText } from '@althar/ui'

import { effortFor, model, useModelPrefs } from '../../../../packages/ui/src/fixtures/models'
import { Arrive, cx, type DirectionProps, ENDS, leadLabel, type Planned, SHUFFLE, TeamCard, usePlanned } from './Directions'
import k from './takes.module.css'

/*
 * Takes on C2, the team card that is the plan. In each, a whole seat is its
 * model's dropdown (the kit's ModelPick, its trigger stretched over the
 * seat), skipping the review is in the reviewer's dropdown, and the steps are
 * tied to who does them. The head and the foot are C2's.
 *
 *   Columns  each seat over its step, tied to it; the steps run as a chain.
 *   Relay    one row of pills, step and model on each, arrows between.
 *   Roster   a list down a line, a node for each, the model at the row's end.
 *   Map      who hands to whom: big marks, arrows that say what happens.
 */

interface Member {
  readonly key: 'lead' | 'review'
  readonly step: string
  readonly role: string
  readonly model: ModelInfo | null
  readonly effort: string | null
  /** Being chosen now: marks go round. */
  readonly choosing: boolean
  readonly skipped: boolean
}

/** Who does what, as far as the draft has come. */
function membersOf({ draft }: DirectionProps, planned: Planned | undefined): ReadonlyArray<Member> {
  const { spec } = draft
  const lead: Member = {
    key: 'lead',
    step: leadLabel(spec),
    role: 'Lead',
    model: draft.lead ? (planned?.lead ?? spec.lead) : null,
    effort: draft.lead ? (planned ? planned.leadEffort : spec.leadEffort) : null,
    choosing: draft.size && !draft.lead,
    skipped: false,
  }
  if (spec.review === null) return [lead]
  return [
    lead,
    {
      key: 'review',
      step: 'Review',
      role: 'Reviewer',
      model: draft.review ? (planned?.review ?? spec.review) : null,
      effort: null,
      choosing: draft.lead && !draft.review,
      skipped: planned?.reviewSkipped === true,
    },
  ]
}

const endWords = (draftProps: DirectionProps, planned: Planned | undefined) =>
  draftProps.draft.spec.onBranch ? 'Ends on its branch' : taskEndText[planned?.end ?? TaskEnd.DraftPr].title

/** A model's mark in a circle: empty, going round while it's chosen, then the one picked. */
function Avatar({ member, size = 30, end = false }: { member?: Member; size?: number; end?: boolean }) {
  const [turn, setTurn] = useState(0)
  const choosing = member?.choosing === true
  useEffect(() => {
    if (!choosing) return
    const id = window.setInterval(() => setTurn((n) => n + 1), 140)
    return () => window.clearInterval(id)
  }, [choosing])
  const filled = end || (member?.model != null && !member.skipped)
  const mark = Math.round(size * 0.55)
  return (
    <span className={cx(k.avatar, filled && k.filled, choosing && k.choosing)} style={{ width: size, height: size }}>
      {end ? (
        <Icon name="pr" size={mark - 2} />
      ) : member?.model?.mark !== undefined && !member.skipped ? (
        <BrandMark key="picked" brand={member.model.mark} size={mark} className={k.settle} />
      ) : choosing ? (
        <BrandMark key={turn} brand={SHUFFLE[turn % SHUFFLE.length] ?? Brand.Anthropic} size={mark} className={k.shuffle} />
      ) : null}
    </span>
  )
}

/** The model's name and effort, or where it stands while it's chosen. */
function Who({ member }: { member: Member }) {
  if (member.skipped) return <span className={k.faint}>No review</span>
  if (member.model === null) return <span className={k.faint}>{member.choosing ? 'Choosing…' : 'Open seat'}</span>
  return (
    <Arrive>
      {member.model.short}
      {member.effort !== null && <span className={k.effort}> {member.effort}</span>}
    </Arrive>
  )
}

/**
 * A seat that is its model's dropdown, whole: the kit's picker, its trigger
 * stretched over the seat and drawn by it. The reviewer's dropdown skips the
 * review; a skipped review is a press that adds it back.
 */
function WholePick({
  member,
  planned,
  className,
  children,
}: {
  member: Member
  planned: Planned | undefined
  className?: string
  children: ReactNode
}) {
  const prefs = useModelPrefs()
  if (planned === undefined || member.model === null) return <div className={cx(k.whole, className)}>{children}</div>
  if (member.skipped)
    return (
      <button
        type="button"
        className={cx(k.whole, k.pickable, k.skippedSeat, className)}
        onClick={() => planned.set({ reviewSkipped: false })}
      >
        {children}
      </button>
    )
  return (
    <div className={cx(k.whole, k.pickable, className)}>
      {children}
      <span className={k.cover}>
        <ModelPick
          variant="quiet"
          placement="below"
          owner={member.key === 'lead' ? 'Lead for this task' : 'Review'}
          model={member.model}
          pinned={prefs.pinned}
          effort={member.effort}
          defaultEffort={effortFor(member.model, prefs.efforts)}
          onChange={(id) => planned.set(member.key === 'lead' ? { lead: model(id) } : { review: model(id) })}
          onEffort={(level) => member.key === 'lead' && planned.set({ leadEffort: level })}
          {...(member.key === 'review'
            ? { onRemove: () => planned.set({ reviewSkipped: true }), text: { remove: 'Skip the review' } }
            : {})}
        />
      </span>
    </div>
  )
}

/** How the work ends, whole as its dropdown once planned. */
function EndPick({
  props,
  planned,
  className,
  children,
}: {
  props: DirectionProps
  planned: Planned | undefined
  className?: string
  children: ReactNode
}) {
  if (planned === undefined || props.draft.spec.onBranch) return <div className={cx(k.whole, className)}>{children}</div>
  return (
    <Menu
      label="When the work is done"
      width={320}
      trigger={
        <button type="button" className={cx(k.whole, k.pickable, className)}>
          {children}
        </button>
      }
    >
      <MenuRadioGroup
        label="When the work is done"
        value={planned.end}
        onChange={(v) => planned.set({ end: ENDS.find((x) => x === v) ?? planned.end })}
      >
        {ENDS.map((x) => (
          <MenuRadioItem key={x} value={x} hint={taskEndText[x].note}>
            {taskEndText[x].title}
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
    </Menu>
  )
}

const Chevron = ({ planned }: { planned: Planned | undefined }) => (planned ? <Icon name="chevronD" size={10} className={k.chev} /> : null)

/** A tie between two things, dashed until what it leads to is in place, then drawn; with what happens along it. */
function Arrow({ on, label, down = false }: { on: boolean; label?: string; down?: boolean }) {
  return (
    <span className={cx(down ? k.tie : k.arrow, on && k.on)} aria-hidden="true">
      <i />
      {label !== undefined && <em>{label}</em>}
    </span>
  )
}

/** Each take's body, and C2's head and foot around it. */
function useTake(props: DirectionProps) {
  const planned = usePlanned(props)
  return { planned, members: membersOf(props, planned) }
}

/* Columns: each seat over its step, tied to it; the steps run as a chain to how it ends. */
export function Columns(props: DirectionProps) {
  const { planned, members } = useTake(props)
  const { draft } = props
  const steps = [
    ...members.map((m) => ({ key: m.key, label: m.step, in: m.model !== null, skipped: m.skipped })),
    { key: 'end', label: endWords(props, planned), in: draft.end, skipped: false },
  ]
  const body = (
    <div className={k.columns} style={{ gridTemplateColumns: steps.map(() => 'minmax(0, auto)').join(' 22px ') }}>
      {members.map((member, i) => (
        <div key={member.key} className={k.colSeat} style={{ gridColumn: i * 2 + 1 }}>
          <WholePick member={member} planned={planned} className={k.seatPill}>
            <Avatar member={member} />
            <span className={k.twoLines}>
              <span className={k.role}>{member.role}</span>
              <span className={k.name}>
                <Who member={member} />
              </span>
            </span>
            <Chevron planned={planned} />
          </WholePick>
          <Arrow down on={member.model !== null} />
        </div>
      ))}
      {steps.map((step, i) => (
        <div key={step.key} className={k.colStep} style={{ gridColumn: i * 2 + 1 }}>
          {step.key === 'end' ? (
            <EndPick props={props} planned={planned} className={cx(k.chip, step.in && k.chipIn)}>
              <span className={k.chipN}>{i + 1}</span>
              {step.in ? <Arrive>{step.label}</Arrive> : null}
              <Chevron planned={planned} />
            </EndPick>
          ) : (
            <span className={cx(k.chip, step.in && k.chipIn, step.skipped && k.chipSkipped)}>
              <span className={k.chipN}>{i + 1}</span>
              {step.in ? <Arrive>{step.label}</Arrive> : null}
            </span>
          )}
        </div>
      ))}
      {steps.slice(1).map((step, i) => (
        <span key={step.key} className={k.colArrow} style={{ gridColumn: i * 2 + 2 }}>
          <Arrow on={step.in} />
        </span>
      ))}
      <p className={k.sizeNote}>
        {draft.size ? <Arrive>{draft.spec.size}</Arrive> : draft.briefDone ? null : <Arrive>Writing the brief…</Arrive>}
      </p>
    </div>
  )
  return <TeamCard {...props} {...(planned ? { planned } : {})} body={body} />
}

/* Relay: one row of pills, the step and who does it on each, arrows between, ending in how it ends. */
export function Relay(props: DirectionProps) {
  const { planned, members } = useTake(props)
  const { draft } = props
  const body = (
    <div className={k.relayWrap}>
      <div className={k.relay}>
        {members.map((member, i) => (
          <div key={member.key} className={k.relayItem}>
            {i > 0 && <Arrow on={member.model !== null} />}
            <WholePick member={member} planned={planned} className={k.relayPill}>
              <Avatar member={member} size={28} />
              <span className={k.twoLines}>
                <span className={k.role}>{member.key === 'lead' ? `${member.step} · Lead` : member.step}</span>
                <span className={k.name}>
                  <Who member={member} />
                </span>
              </span>
              <Chevron planned={planned} />
            </WholePick>
          </div>
        ))}
        <div className={k.relayItem}>
          <Arrow on={draft.end} />
          <EndPick props={props} planned={planned} className={cx(k.relayPill, !draft.end && k.waiting)}>
            <Avatar end={draft.end} size={28} />
            <span className={k.twoLines}>
              <span className={k.role}>When it’s done</span>
              <span className={k.name}>{draft.end ? <Arrive>{endWords(props, planned)}</Arrive> : <span className={k.faint}>…</span>}</span>
            </span>
            <Chevron planned={planned} />
          </EndPick>
        </div>
      </div>
      <p className={k.relayNote}>
        {draft.size ? <Arrive>{draft.spec.size}</Arrive> : draft.briefDone ? null : <Arrive>Writing the brief…</Arrive>}
      </p>
    </div>
  )
  return <TeamCard {...props} {...(planned ? { planned } : {})} body={body} />
}

/* Roster: a list down a line, a node for each step; the whole row opens who does it. */
export function Roster(props: DirectionProps) {
  const { planned, members } = useTake(props)
  const { draft } = props
  const body = (
    <ol className={k.roster}>
      {members.map((member) => (
        <li key={member.key} className={cx(k.rosterItem, member.model !== null && k.rosterOn)}>
          <WholePick member={member} planned={planned} className={k.rosterRow}>
            <Avatar member={member} size={28} />
            <span className={k.twoLines}>
              <span className={cx(k.rosterStep, member.skipped && k.struck)}>{member.step}</span>
              <span className={k.rosterWhy}>
                {member.key === 'lead' ? (
                  draft.size ? (
                    <Arrive>{draft.spec.size}</Arrive>
                  ) : draft.briefDone ? (
                    'Sizing it…'
                  ) : (
                    'Writing the brief…'
                  )
                ) : (
                  'Reads it over before the PR'
                )}
              </span>
            </span>
            <span className={k.rosterWho}>
              <Who member={member} />
              <Chevron planned={planned} />
            </span>
          </WholePick>
        </li>
      ))}
      <li className={cx(k.rosterItem, draft.end && k.rosterOn)}>
        <EndPick props={props} planned={planned} className={k.rosterRow}>
          <Avatar end={draft.end} size={28} />
          <span className={k.twoLines}>
            <span className={k.rosterStep}>When it’s done</span>
          </span>
          <span className={k.rosterWho}>
            {draft.end ? <Arrive>{endWords(props, planned)}</Arrive> : <span className={k.faint}>…</span>}
            <Chevron planned={planned} />
          </span>
        </EndPick>
      </li>
    </ol>
  )
  return <TeamCard {...props} {...(planned ? { planned } : {})} body={body} />
}

/* Map: who hands to whom. Big marks for each seat, and arrows that say what happens between them. */
export function MapTake(props: DirectionProps) {
  const { planned, members } = useTake(props)
  const { draft } = props
  const verbs: Record<Member['key'], string> = { lead: draft.spec.preset === 'Prototype' ? 'prototypes' : 'implements', review: 'reviews' }
  const body = (
    <div className={k.mapWrap}>
      <div className={k.map}>
        {members.map((member, i) => (
          <div key={member.key} className={k.mapItem}>
            {i > 0 && <Arrow on={member.model !== null} label={verbs[members[i - 1]?.key ?? 'lead']} />}
            <WholePick member={member} planned={planned} className={k.mapNode}>
              <Avatar member={member} size={46} />
              <span className={k.role}>{member.role}</span>
              <span className={k.name}>
                <Who member={member} />
                <Chevron planned={planned} />
              </span>
            </WholePick>
          </div>
        ))}
        <div className={k.mapItem}>
          <Arrow on={draft.end} label={verbs[members.at(-1)?.key ?? 'lead']} />
          <EndPick props={props} planned={planned} className={k.mapNode}>
            <Avatar end={draft.end} size={46} />
            <span className={k.role}>When it’s done</span>
            <span className={k.name}>
              {draft.end ? <Arrive>{endWords(props, planned)}</Arrive> : <span className={k.faint}>…</span>}
              <Chevron planned={planned} />
            </span>
          </EndPick>
        </div>
      </div>
      <p className={k.mapNote}>
        {draft.size ? <Arrive>{draft.spec.size}</Arrive> : draft.briefDone ? null : <Arrive>Writing the brief…</Arrive>}
      </p>
    </div>
  )
  return <TeamCard {...props} {...(planned ? { planned } : {})} body={body} />
}
