import type { Meta, StoryObj } from '@storybook/react-vite'

import s from './Tokens.stories.module.css'

/*
 * The design tokens in src/styles/tokens.css, drawn from the stylesheet
 * itself, so this page cannot drift from it. Every colour has one meaning;
 * the notes say which.
 */

interface Swatch {
  name: string
  note: string
}

const GROUPS: { title: string; swatches: Swatch[] }[] = [
  {
    title: 'Surfaces',
    swatches: [
      { name: '--n-0', note: 'the desk, behind the window' },
      { name: '--n-2', note: 'the page' },
      { name: '--n-1', note: 'raised: cards, sheets' },
      { name: '--n-3', note: 'hover, inputs' },
      { name: '--n-4', note: 'pressed, selected' },
      { name: '--n-5', note: 'strong fill' },
      { name: '--chrome', note: 'the window’s bars' },
    ],
  },
  {
    title: 'Ink',
    swatches: [
      { name: '--t-1', note: 'primary' },
      { name: '--t-2', note: 'secondary' },
      { name: '--t-3', note: 'metadata; the faintest text that informs' },
      { name: '--t-4', note: 'disabled and decoration only' },
    ],
  },
  {
    title: 'Meaning',
    swatches: [
      { name: '--live', note: 'cobalt: Althar, and work in motion' },
      { name: '--signal', note: 'violet: a decision that waits on a person' },
      { name: '--ok', note: 'additions and merges, nothing else' },
      { name: '--danger', note: 'deletions and failures, nothing else' },
      { name: '--linear', note: 'Linear’s mark, on its card only' },
    ],
  },
]

function Colours() {
  return (
    <div className={s.groups}>
      {GROUPS.map((g) => (
        <section key={g.title}>
          <h3 className={s.title}>{g.title}</h3>
          <ul className={s.swatches}>
            {g.swatches.map((w) => (
              <li key={w.name} className={s.swatch}>
                <span className={s.chip} style={{ background: `var(${w.name})` }} />
                <code className={s.name}>{w.name}</code>
                <span className={s.note}>{w.note}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function Type() {
  return (
    <div className={s.type}>
      <p style={{ font: '600 20px/1.3 var(--font-display)' }}>Rate-limit refunds like charges</p>
      <p style={{ font: 'var(--prose-size)/var(--prose-lh) var(--font-prose)', maxWidth: 560 }}>
        Refunds now share the partner budget with charges and answer 429 with Retry-After in seconds. Tests and lint pass.
      </p>
      <p style={{ font: '12px/1.4 var(--font)', color: 'var(--t-3)' }}>Worked for 12m · 2.4k tokens</p>
      <p style={{ font: '500 10.5px/1 var(--font-label)', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--t-3)' }}>
        Listening to
      </p>
      <p style={{ font: '12.5px/1.5 var(--mono)' }}>pnpm test refunds</p>
    </div>
  )
}

function Materials() {
  return (
    <ul className={s.materials}>
      {['--lift', '--lift-2', '--lift-pop'].map((shadow) => (
        <li key={shadow} className={s.material} style={{ boxShadow: `var(${shadow})` }}>
          <code>{shadow}</code>
        </li>
      ))}
      {['--r-sm', '--r', '--r-lg'].map((r) => (
        <li key={r} className={s.material} style={{ borderRadius: `var(${r})`, boxShadow: 'inset 0 0 0 1px var(--line-2)' }}>
          <code>{r}</code>
        </li>
      ))}
    </ul>
  )
}

const meta = { title: 'Foundations/Tokens', component: Colours } satisfies Meta<typeof Colours>
export default meta
type Story = StoryObj<typeof meta>

export const Colour: Story = {}
export const Typography: Story = { render: () => <Type /> }
export const ShadowsAndRadii: Story = { render: () => <Materials /> }
export const AllStates: Story = {
  name: 'All',
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      <Colours />
      <Type />
      <Materials />
    </div>
  ),
}
