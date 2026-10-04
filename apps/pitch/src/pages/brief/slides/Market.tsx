/* oxlint-disable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/prefer-tag-over-role -- The labelled overflow region must be keyboard-scrollable on narrow screens. */
import { cx } from '../../../lib/cx'
import { Slide } from '../Slide'
import ui from '../ui.module.css'
import s from './Market.module.css'

/** Who decides: the vendor, you, or partly you. */
type Say = 'lock' | 'part' | 'free'
type Cell = readonly [Say, string]

interface Row {
  name: string
  note?: string
  agents: Cell
  models: Cell
  automation: Cell
  open: Cell
  memory: Cell
}

/* Simplified from each product's own docs and announcements, September 2026. */
const ROWS: readonly Row[] = [
  {
    name: 'GitHub Copilot',
    note: 'Microsoft, OpenAI’s largest backer',
    agents: ['part', 'Copilot, Claude and Codex, inside GitHub'],
    models: ['part', '20+ from five labs, GitHub’s pick'],
    automation: ['lock', 'Agentic Workflows, in preview: an event starts one agent'],
    open: ['part', 'The editor extension, the workflow tool'],
    memory: ['lock', 'Inside GitHub'],
  },
  {
    name: 'Cursor',
    note: 'Owned by SpaceX, with xAI',
    agents: ['lock', 'Cursor’s own'],
    models: ['part', 'About a dozen, Grok and Composer first'],
    automation: ['lock', 'Automations: an event starts a Cursor agent'],
    open: ['lock', 'No'],
    memory: ['lock', 'Inside Cursor'],
  },
  {
    name: 'Devin',
    note: 'Cognition, owner of Windsurf',
    agents: ['lock', 'Devin only'],
    models: ['part', 'The widest: 160+, through Cognition'],
    automation: ['lock', 'Automations and playbooks, for Devin only'],
    open: ['lock', 'No'],
    memory: ['lock', 'Inside Devin'],
  },
  {
    name: 'Claude Code',
    agents: ['lock', 'Claude Code'],
    models: ['lock', 'Anthropic’s'],
    automation: ['lock', 'Routines, in preview: an event starts one run'],
    open: ['lock', 'No'],
    memory: ['lock', 'Its own files'],
  },
  {
    name: 'Codex',
    agents: ['lock', 'Codex'],
    models: ['lock', 'OpenAI’s, or a local open model'],
    automation: ['lock', 'Automations: scheduled runs in the app'],
    open: ['part', 'The CLI'],
    memory: ['lock', 'Its own files'],
  },
]

const US: Row = {
  name: 'Althar',
  agents: ['free', 'Any, mixed within one task'],
  models: ['free', 'Any, including self-hosted'],
  automation: ['free', 'Next step decided from evidence, across labs'],
  open: ['free', 'All of it'],
  memory: ['free', 'With the project, in an open format'],
}

const COLS = [
  ['agents', 'Which agents'],
  ['models', 'Which models'],
  ['automation', 'What runs the work'],
  ['open', 'Open source'],
  ['memory', 'Where memory lives'],
] as const

function Line({ row, us }: { row: Row; us?: boolean }) {
  return (
    <tr className={cx(us && s.us)}>
      <th scope="row">
        {row.name}
        {row.note && <small>{row.note}</small>}
      </th>
      {COLS.map(([key]) => {
        const [say, text] = row[key]
        return (
          <td key={key} className={cx(s[say], key === 'automation' && s.auto)}>
            {text}
          </td>
        )
      })}
    </tr>
  )
}

export function Market() {
  return (
    <Slide id="market" tone="dark" name="The market" className={s.market}>
      <div className={ui.wrap}>
        <p className={cx(ui.kicker, s.kicker)}>The market</p>
        <div className={s.head}>
          <h2>Everyone is building this layer, inside their own product.</h2>
          <p className={cx(ui.body, s.body)}>
            Agents are interchangeable and the best model changes hands every few weeks. What lasts is what a project knows and how its work
            moves, so every vendor wants to own that. It validates the category, and it is why none of them will make it portable.
          </p>
        </div>
        <div className={s.tblWrap} tabIndex={0} role="region" aria-label="How the products compare. Scrolls sideways on small screens">
          <table className={s.tbl}>
            <thead>
              <tr>
                <th scope="col">Product</th>
                {COLS.map(([key, label]) => (
                  <th key={key} scope="col" className={cx(key === 'automation' && s.auto)}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <Line key={r.name} row={r} />
              ))}
              <Line row={US} us />
            </tbody>
          </table>
        </div>
        <p className={s.key}>
          <span>
            <i className={s.kLock}></i>Decided by the vendor
          </span>{' '}
          <span>
            <i className={s.kPart}></i>Some choice, inside their product
          </span>{' '}
          <span>
            <i className={s.kFree}></i>Decided by you
          </span>{' '}
          <span>Simplified, September 2026</span>
        </p>
        <p className={s.pull}>
          Every automation here is a trigger that starts one agent on one job.{' '}
          <b>None decides the next step from what the last one found,</b> across labs, and none keeps what was learned where the next tool
          can read it.
        </p>
      </div>
    </Slide>
  )
}
