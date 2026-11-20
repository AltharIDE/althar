import { type ReactNode, useMemo } from 'react'

import { Model } from '@althar/ui'

import { Legend, PartsBar, TipLines, useTip } from '../charts.tsx'
import { FABLE_UNTIL, type Ink, MODELS, type ModelId } from '../facts.ts'
import { leadsIn, mixIn, pairsIn, periodOf, reviewersIn } from '../measures.ts'
import type { DirectionProps } from '../page.tsx'
import { date, duration, inkVar, modelInfo, money, percent, plural } from '../words.ts'
import sh from '../shared.module.css'
import s from './b.module.css'

/*
 * B · The team. The models as the people they are on the work: who led what
 * finished, for what each change cost and how long it took to merge, how much
 * its reviewers found in its work and how often it took another round; who
 * reviewed, how much each found and what became of it (fixed, set aside,
 * dismissed); which lead and reviewer go well together; and who led, week by
 * week. A few lines worth knowing first, from the same numbers.
 */

const inkOf = (model: ModelId): Ink => MODELS[model].ink

/** A figure and a thin bar under it, on its column's scale, in the model's ink. */
function Cell({ value, of, ink, children }: { value: number | null; of: number; ink: Ink; children: ReactNode }) {
  return (
    <span className={s.cell}>
      <span className={sh.num}>{children}</span>
      <span className={s.track}>
        {value !== null && (
          <span className={s.fill} style={{ width: `${Math.max(2, (value / Math.max(of, 1e-9)) * 100)}%`, background: inkVar(ink) }} />
        )}
      </span>
    </span>
  )
}

const max = (values: ReadonlyArray<number | null>) => Math.max(0, ...values.filter((v): v is number => v !== null))

const STATE_COLOR = { fixed: 'var(--t-2)', set_aside: 'var(--t-4)', dismissed: 'var(--line-3)' } as const

export function Team({ range, scope }: DirectionProps) {
  const tip = useTip()
  const period = useMemo(() => periodOf(range), [range])
  const leads = useMemo(() => leadsIn(period, scope), [period, scope])
  const reviewers = useMemo(() => reviewersIn(period, scope), [period, scope])
  const pairs = useMemo(() => pairsIn(period, scope), [period, scope])
  const mix = useMemo(() => mixIn(period, scope), [period, scope])

  // ——— worth knowing ———
  const worth: ReactNode[] = []
  const opus = leads.find((row) => row.model === 'opus-5.5')
  const fable = leads.find((row) => row.model === 'fable-5.2')
  if (fable?.perChange != null && opus?.perChange != null)
    worth.push(
      <>
        <strong>Fable 5.2</strong> cost {money(fable.perChange)} a merged change, {(fable.perChange / opus.perChange).toFixed(1)}× Opus
        5.5’s, until you stopped it on {date(FABLE_UNTIL)}.
      </>,
    )
  const judged = reviewers.filter((row) => row.reviews >= 10 && row.fixed !== null)
  const best = [...judged].sort((a, b) => b.fixed! - a.fixed!)[0]
  const worst = [...judged].sort((a, b) => a.fixed! - b.fixed!)[0]
  if (best !== undefined && worst !== undefined && best !== worst)
    worth.push(
      <>
        Leads fixed {percent(best.fixed)} of what <strong>{MODELS[best.model].short}</strong> found, and {percent(worst.fixed)} of{' '}
        <strong>{MODELS[worst.model].short}</strong>’s; {percent(worst.dismissed)} of its findings were dismissed.
      </>,
    )
  const steady = leads.filter((row) => row.led >= 20 && row.rework !== null)
  const most = [...steady].sort((a, b) => b.rework! - a.rework!)[0]
  const least = [...steady].sort((a, b) => a.rework! - b.rework!)[0]
  if (most !== undefined && least !== undefined && most !== least)
    worth.push(
      <>
        <strong>{MODELS[most.model].short}</strong>’s changes took another review round {percent(most.rework)} of the time;{' '}
        {MODELS[least.model].short}’s {percent(least.rework)}.
      </>,
    )

  const leadMax = {
    led: max(leads.map((row) => row.led)),
    perChange: max(leads.map((row) => row.perChange)),
    toMerge: max(leads.map((row) => row.toMerge)),
    found: max(leads.map((row) => row.foundFirst)),
    rework: max(leads.map((row) => row.rework)),
  }
  const reviewMax = {
    reviews: max(reviewers.map((row) => row.reviews)),
    per: max(reviewers.map((row) => row.perReview)),
    cost: max(reviewers.map((row) => row.cost)),
  }

  // Who reviews whom: those with enough reviews between them to say anything.
  const leadModels = leads
    .filter((row) => pairs.filter((pair) => pair.lead === row.model).reduce((n, pair) => n + pair.reviews, 0) >= 10)
    .map((row) => row.model)
  const reviewerModels = reviewers.filter((row) => row.reviews >= 10).map((row) => row.model)
  // A family's colour is its models': Opus clay, Sol indigo, Fable ochre, Sonnet plum, in that order.
  const FAMILY_INK: Readonly<Record<string, Ink>> = { Opus: 'clay', Sol: 'indigo', Fable: 'ochre', Sonnet: 'plum' }
  const familyInk = (family: string): Ink => FAMILY_INK[family] ?? 'neutral'
  const mixModels = [...new Set(mix.flatMap((bucket) => Object.keys(bucket.by)))].sort(
    (a, b) =>
      ['clay', 'indigo', 'ochre', 'plum', 'neutral'].indexOf(familyInk(a)) -
      ['clay', 'indigo', 'ochre', 'plum', 'neutral'].indexOf(familyInk(b)),
  )
  const mixTop = Math.max(1, ...mix.map((bucket) => bucket.total))

  if (leads.length === 0) return <p className={sh.empty}>No task finished in these days.</p>

  return (
    <>
      {worth.length > 0 && (
        <section className={sh.section}>
          <ul className={sh.worth}>
            {worth.slice(0, 3).map((line, i) => (
              <li key={i}>
                <span className={sh.worthMark}>•</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={sh.section}>
        <div className={sh.sectionHead}>
          <h2 className={sh.h2}>Leads</h2>
        </div>
        <div className={s.table} style={{ ['--cols' as string]: '1.5fr repeat(5, 1fr)' }}>
          <div className={s.head}>
            <span>Model</span>
            <span>Led</span>
            <span>Per merged change</span>
            <span>To merge</span>
            <span>Found in first review</span>
            <span>Another round</span>
          </div>
          {leads.map((row) => (
            <div key={row.model} className={s.row}>
              <span className={s.model}>
                <Model model={modelInfo(row.model)} />
                {row.model === 'fable-5.2' && <span className={s.note}>Not since {date(FABLE_UNTIL)}</span>}
              </span>
              <Cell value={row.led} of={leadMax.led} ink={inkOf(row.model)}>
                {row.led} <span className={sh.quiet}>· {row.merged} merged</span>
              </Cell>
              <Cell value={row.perChange} of={leadMax.perChange} ink={inkOf(row.model)}>
                {row.perChange === null ? '—' : money(row.perChange)}
              </Cell>
              <Cell value={row.toMerge} of={leadMax.toMerge} ink={inkOf(row.model)}>
                {duration(row.toMerge)}
              </Cell>
              <Cell value={row.foundFirst} of={leadMax.found} ink={inkOf(row.model)}>
                {row.foundFirst === null ? '—' : row.foundFirst.toFixed(1)}
              </Cell>
              <Cell value={row.rework} of={leadMax.rework} ink={inkOf(row.model)}>
                {percent(row.rework)}
              </Cell>
            </div>
          ))}
        </div>
      </section>

      <section className={sh.section}>
        <div className={sh.sectionHead}>
          <h2 className={sh.h2}>Reviewers</h2>
          <Legend
            items={[
              { label: 'Fixed', color: STATE_COLOR.fixed },
              { label: 'Set aside', color: STATE_COLOR.set_aside },
              { label: 'Dismissed', color: STATE_COLOR.dismissed },
            ]}
          />
        </div>
        <div className={s.table} style={{ ['--cols' as string]: '1.5fr 0.8fr 1fr 1.6fr 0.7fr 0.8fr' }}>
          <div className={s.head}>
            <span>Model</span>
            <span>Reviews</span>
            <span>Found per review</span>
            <span>What became of it</span>
            <span>Blocking</span>
            <span>Per review</span>
          </div>
          {reviewers.map((row) => (
            <div key={row.model} className={s.row}>
              <span className={s.model}>
                <Model model={modelInfo(row.model)} />
              </span>
              <Cell value={row.reviews} of={reviewMax.reviews} ink={inkOf(row.model)}>
                {row.reviews}
              </Cell>
              <Cell value={row.perReview} of={reviewMax.per} ink={inkOf(row.model)}>
                {row.perReview.toFixed(1)}
              </Cell>
              <span className={s.cell}>
                <span className={`${sh.num} ${sh.quiet}`}>{percent(row.fixed)} fixed</span>
                <PartsBar
                  height={6}
                  parts={(['fixed', 'set_aside', 'dismissed'] as const).map((state) => {
                    const share = state === 'fixed' ? row.fixed : state === 'set_aside' ? row.setAside : row.dismissed
                    return {
                      key: state,
                      value: share ?? 0,
                      color: STATE_COLOR[state],
                      tip: (
                        <TipLines
                          title={MODELS[row.model].short}
                          lines={[`${percent(share)} ${state === 'set_aside' ? 'set aside' : state}`]}
                        />
                      ),
                    }
                  })}
                />
              </span>
              <span className={`${s.cell} ${sh.num}`}>{row.blocking}</span>
              <Cell value={row.cost} of={reviewMax.cost} ink={inkOf(row.model)}>
                {row.cost === null ? '—' : money(row.cost)}
              </Cell>
            </div>
          ))}
        </div>
      </section>

      <section className={sh.section}>
        <div className={sh.sectionHead}>
          <h2 className={sh.h2}>Who reviews whom</h2>
          <span className={sh.quiet} style={{ fontSize: 12 }}>
            Found per review · the share fixed
          </span>
        </div>
        <div className={s.matrix} style={{ gridTemplateColumns: `150px repeat(${reviewerModels.length}, minmax(0, 1fr))` }}>
          <span className={s.corner}>Lead ↓ · Reviewer →</span>
          {reviewerModels.map((model) => (
            <span key={model} className={s.colHead}>
              <Model model={modelInfo(model)} short />
            </span>
          ))}
          {leadModels.map((lead) => (
            <MatrixRow key={lead} lead={lead} reviewers={reviewerModels} pairs={pairs} />
          ))}
        </div>
      </section>

      <section className={sh.section}>
        <div className={sh.sectionHead}>
          <h2 className={sh.h2}>Who led, {range <= 30 ? 'day by day' : 'week by week'}</h2>
          <Legend items={mixModels.map((family) => ({ label: family, ink: familyInk(family) }))} />
        </div>
        <div className={s.mix}>
          {mix.map((bucket, i) => (
            <div key={bucket.from} className={s.mixCol}>
              <div className={s.mixStack} style={{ height: `${(bucket.total / mixTop) * 100}%` }}>
                {mixModels
                  .filter((family) => (bucket.by[family] ?? 0) > 0)
                  .map((family) => (
                    <span
                      key={family}
                      className={s.mixPart}
                      style={{ flexGrow: bucket.by[family], background: inkVar(familyInk(family)) }}
                      {...tip(
                        <TipLines
                          title={`${range <= 30 ? date(bucket.from) : `Week of ${date(bucket.from)}`}`}
                          lines={[`${family} led ${plural(bucket.by[family] ?? 0, 'task')}`, `${bucket.total} in all`]}
                        />,
                      )}
                    />
                  ))}
              </div>
              {(mix.length <= 14 || i % Math.ceil(mix.length / 8) === 0) && <span className={s.mixLabel}>{date(bucket.from)}</span>}
            </div>
          ))}
        </div>
      </section>
    </>
  )
}

function MatrixRow({ lead, reviewers, pairs }: { lead: ModelId; reviewers: ReadonlyArray<ModelId>; pairs: ReturnType<typeof pairsIn> }) {
  const tip = useTip()
  const top = Math.max(...pairs.map((pair) => pair.perReview))
  return (
    <>
      <span className={s.rowHead}>
        <Model model={modelInfo(lead)} short />
      </span>
      {reviewers.map((reviewer) => {
        const pair = pairs.find((one) => one.lead === lead && one.reviewer === reviewer)
        if (pair === undefined || lead === reviewer)
          return (
            <span key={reviewer} className={s.pair} data-none>
              —
            </span>
          )
        const few = pair.reviews < 5
        return (
          <span
            key={reviewer}
            className={s.pair}
            data-few={few || undefined}
            style={{ ['--heat' as string]: `${Math.round((pair.perReview / top) * 100)}%` }}
            {...tip(
              <TipLines
                title={`${MODELS[lead].short} reviewed by ${MODELS[reviewer].short}`}
                lines={[
                  `${plural(pair.reviews, 'review')}`,
                  `${pair.perReview.toFixed(1)} found per review`,
                  `${percent(pair.fixed)} of it fixed`,
                ]}
              />,
            )}
          >
            <span className={s.pairValue}>{pair.perReview.toFixed(1)}</span>
            <span className={s.pairNote}>
              {percent(pair.fixed)} · {pair.reviews}
            </span>
          </span>
        )
      })}
    </>
  )
}
