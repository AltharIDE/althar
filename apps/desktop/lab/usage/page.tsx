import { Segmented, Select } from '@althar/ui'

import { TipLayer } from './charts.tsx'
import { Receipts } from './directions/a.tsx'
import { Team } from './directions/b.tsx'
import { Plans } from './directions/c.tsx'
import { Compare } from './directions/d.tsx'
import { periodOf, type Range, type Scope } from './measures.ts'
import { lab, scopeOf, useLab } from './state.ts'
import { span } from './words.ts'
import s from './page.module.css'

/*
 * A project's Usage view, as the lab draws it (vite.config.ts's seam puts it
 * after Artifacts): its heading, the period (7, 30 or 90 days) and the scope
 * (the project, or all of them), and under them the direction the lab's bar
 * picks. The period and scope stay as the directions change.
 */

export interface DirectionProps {
  readonly range: Range
  readonly scope: Scope
}

const PROJECTS: Readonly<Record<string, string>> = { p_althar: 'althar', p_meridian: 'meridian' }

export function LabUsage({ projectId }: { projectId: string }) {
  const { d, range, all } = useLab()
  const project = PROJECTS[projectId] ?? 'althar'
  const scope = scopeOf(project, all)
  const period = periodOf(range)
  const props = { range, scope }
  return (
    <div className={s.view}>
      <TipLayer>
        <div className={s.column} data-direction={d}>
          <header className={s.head}>
            <div className={s.headWords}>
              <h1 className={s.title}>Usage</h1>
              <p className={s.line}>{d === 'c' ? 'This week, and the weeks before' : span(period.from, period.to)}</p>
            </div>
            <div className={s.tools}>
              <Select
                label="Projects"
                variant="quiet"
                options={[
                  { value: 'one', label: project },
                  { value: 'all', label: 'All projects' },
                ]}
                value={all ? 'all' : 'one'}
                onChange={(value) => lab.set({ all: value === 'all' })}
              />
              <Segmented
                label="Period"
                options={[
                  { value: '7', label: '7 days' },
                  { value: '30', label: '30 days' },
                  { value: '90', label: '90 days' },
                ]}
                value={String(range)}
                onChange={(value) => lab.set({ range: Number(value) as Range })}
              />
            </div>
          </header>
          {d === 'a' ? (
            <Receipts {...props} />
          ) : d === 'b' ? (
            <Team {...props} />
          ) : d === 'c' ? (
            <Plans {...props} />
          ) : (
            <Compare {...props} />
          )}
        </div>
      </TipLayer>
    </div>
  )
}
