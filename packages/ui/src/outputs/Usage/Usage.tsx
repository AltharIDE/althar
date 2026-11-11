import type { Brand } from '../../foundations/brands/brands'
import { BrandMark } from '../../foundations/Marks/Marks'
import { Caret, Disclosure, DisclosureTrigger, Fold } from '../../primitives/Fold/Fold'
import { HoverCard } from '../../primitives/HoverCard/HoverCard'
import s from './Usage.module.css'

/*
 * What a task, or the coordinator's day, used of each account its agents ran
 * on (ADR-084): a line each, its figure at the end, the models and their
 * tokens under it. On a plan, the figure is the share of its week; paid per
 * use, the dollars. There is no total: a share of a week and dollars don't
 * add up. A figure that can't be known stays a quiet "—", which says why as
 * it is pointed at or focused.
 */

/** One account's line. */
export interface UsageLine {
  readonly id: string
  /** The account as the person knows it: Claude Code Max. */
  readonly name: string
  readonly mark?: Brand
  /** On a plan, the points of its week it took; null where none was read. Absent where it is paid per use. */
  readonly took?: number | null
  /** Paid per use, the dollars spent; null where neither the agent nor a price said. */
  readonly spent?: number | null
  /** Whether the figure is an estimate: a plan's share, or dollars at list prices. */
  readonly estimated?: boolean
  /** The models that ran on it, by name. */
  readonly models: ReadonlyArray<string>
  readonly tokens: number
  /** Its tokens by model, where several ran on it: each model's share said beside its name. */
  readonly byModel?: ReadonlyArray<{ readonly name: string; readonly tokens: number }>
  /** Why there is no figure, where it can't be known: said on the "—". */
  readonly why?: string
}

export interface UsageText {
  /** The card's name. */
  title: string
  /** On a plan: the share of its week. */
  ofWeek: (points: number) => string
  /** Paid per use: the dollars. */
  dollars: (amount: number) => string
  /** Where nothing was read to say it. */
  unknown: string
  /** An estimated figure, said as one: ~8% of week. */
  estimate: (figure: string) => string
  /** On an estimated figure, as the pointer rests on it. */
  estimateNote: string
  /** Under the name: the models, and their tokens. */
  what: (models: ReadonlyArray<string>, tokens: number) => string
  /** Several models on one account: each with its tokens. */
  byModel: (models: ReadonlyArray<{ readonly name: string; readonly tokens: number }>) => string
}

const tokensWord = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n))

const shareWord = (points: number) => (points >= 1 ? `${Math.round(points)}%` : points >= 0.1 ? `${points.toFixed(1)}%` : '< 0.1%')

export const usageText: UsageText = {
  title: 'Usage',
  ofWeek: (points) => `${shareWord(points)} of week`,
  dollars: (amount) => (amount > 0 && amount < 0.01 ? '< $0.01' : `$${amount.toFixed(2)}`),
  unknown: '—',
  estimate: (figure) => `~${figure}`,
  estimateNote: 'An estimate',
  what: (models, tokens) => [...models, `${tokensWord(tokens)} tokens`].join(' · '),
  byModel: (models) => models.map((model) => `${model.name} ${tokensWord(model.tokens)}`).join(' · ') + ' tokens',
}

/** A known figure, said as an estimate where it is one. */
const said = (line: UsageLine, figure: string, t: UsageText) =>
  figure !== t.unknown && line.estimated === true ? t.estimate(figure) : figure

/** A line's figure, said whole: ~8% of week, or $21.59. */
const figureOf = (line: UsageLine, t: UsageText) => said(line, wholeOf(line, t), t)

const wholeOf = (line: UsageLine, t: UsageText) =>
  line.took !== undefined
    ? line.took === null
      ? t.unknown
      : t.ofWeek(line.took)
    : line.spent === undefined || line.spent === null
      ? t.unknown
      : t.dollars(line.spent)

/** The figure alone, for a glance: ~8%, or $21.59. */
const glanceOf = (line: UsageLine, t: UsageText) => said(line, briefOf(line, t), t)

const briefOf = (line: UsageLine, t: UsageText) =>
  line.took !== undefined
    ? line.took === null
      ? t.unknown
      : shareWord(line.took)
    : line.spent === undefined || line.spent === null
      ? t.unknown
      : t.dollars(line.spent)

export interface UsageLinesProps {
  lines: ReadonlyArray<UsageLine>
  /** Whose usage, above the lines: This task so far, Today. */
  heading?: string
  text?: Partial<UsageText>
}

/** A line for each account: its mark and name, the models and tokens under them, its figure centred at the end. */
export function UsageLines({ lines, heading, text }: UsageLinesProps) {
  const t = { ...usageText, ...text }
  return (
    <div className={s.usage}>
      {heading !== undefined && <span className={s.heading}>{heading}</span>}
      <ul className={s.lines}>
        {lines.map((line) => (
          <li key={line.id}>
            <span className={s.name}>
              {line.mark !== undefined && <BrandMark brand={line.mark} size={13} />}
              <span>{line.name}</span>
            </span>
            <span className={s.what} data-marked={line.mark !== undefined || undefined}>
              {line.byModel !== undefined && line.byModel.length > 1 ? t.byModel(line.byModel) : t.what(line.models, line.tokens)}
            </span>
            <Figure line={line} t={t} />
          </li>
        ))}
      </ul>
    </div>
  )
}

/** A line's figure; one that can't be known, with why, says it on hover or focus. */
function Figure({ line, t }: { line: UsageLine; t: UsageText }) {
  const figure = figureOf(line, t)
  if (figure !== t.unknown || line.why === undefined)
    return (
      <b className={s.figure} title={line.estimated === true ? t.estimateNote : undefined}>
        {figure}
      </b>
    )
  return (
    <HoverCard card={line.why} placement="above" align="end" width={240}>
      <button type="button" className={s.figure} data-why>
        {figure}
      </button>
    </HoverCard>
  )
}

export interface UsageCardProps {
  lines: ReadonlyArray<UsageLine>
  /** Whether it is open: the person's choice, kept by whoever holds it. */
  open: boolean
  onOpenChange: (open: boolean) => void
  text?: Partial<UsageText>
}

/**
 * Usage, as a card in Outputs: one row with each account's figure by its
 * mark, opening to the lines, as the pull request's checks do. Whether it is
 * open is the person's, kept for every task alike.
 */
export function UsageCard({ lines, open, onOpenChange, text }: UsageCardProps) {
  const t = { ...usageText, ...text }
  return (
    <Disclosure className={s.card} open={open} onOpenChange={onOpenChange}>
      <DisclosureTrigger>
        <button type="button" className={s.toggle}>
          <span className={s.title}>{t.title}</span>
          <span className={s.glance} aria-hidden={open || undefined}>
            {lines.map((line) => (
              <span key={line.id}>
                {line.mark !== undefined && <BrandMark brand={line.mark} size={12} />}
                {glanceOf(line, t)}
              </span>
            ))}
          </span>
          <Caret />
        </button>
      </DisclosureTrigger>
      <Fold bleed={false}>
        <div className={s.body}>
          <UsageLines lines={lines} text={text} />
        </div>
      </Fold>
    </Disclosure>
  )
}
