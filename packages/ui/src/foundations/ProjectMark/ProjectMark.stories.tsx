import type { Meta, StoryObj } from '@storybook/react-vite'

import { MARKED, SEEDS } from '../../fixtures/marks'
import { States } from '../../storybook/States'
import { ProjectInk, projectInk } from './drawing'
import { ProjectMark } from './ProjectMark'
import s from './ProjectMark.stories.module.css'

const meta = {
  title: 'Foundations/ProjectMark',
  component: ProjectMark,
  args: { seed: 'meridian', ink: ProjectInk.Teal, size: 40 },
} satisfies Meta<typeof ProjectMark>
export default meta
type Story = StoryObj<typeof meta>

export const Mark: Story = {}

/** The projects on this Mac, as a list of projects shows them: running, waiting on you, both, or quiet. */
export const Projects: Story = {
  render: () => (
    <ul className={s.list}>
      {MARKED.map((p) => (
        <li key={p.id} className={s.item}>
          <ProjectMark seed={p.id} ink={p.ink} running={p.running} yours={p.yours} quiet={!p.running && !p.yours} />
          <span className={s.name}>{p.name}</span>
        </li>
      ))}
    </ul>
  ),
}

/** The sizes it is drawn at: 15 beside a name, 18 in a window's bar, 24 and 32 in menus, 40 in a list of projects. */
export const Sizes: Story = {
  render: () => (
    <span className={s.row}>
      {[15, 18, 24, 32, 40, 56].map((size) => (
        <ProjectMark key={size} seed="meridian" ink={ProjectInk.Teal} size={size} />
      ))}
    </span>
  ),
}

/** One seed in every ink. */
export const Inks: Story = {
  render: () => (
    <span className={s.row}>
      {Object.values(ProjectInk).map((ink) => (
        <ProjectMark key={ink} seed="meridian" ink={ink} />
      ))}
    </span>
  ),
}

/* Inks given as an app would give them, one project after another: each passes
   over the inks of the seven before it, so neighbours never share one. */
const INKED = SEEDS.reduce<{ seed: string; ink: ProjectInk }[]>((given, seed) => {
  const taken = given.slice(-(Object.values(ProjectInk).length - 1)).map((g) => g.ink)
  return [...given, { seed, ink: projectInk(seed, taken) }]
}, [])

/** What the generator draws for names a person might give their repositories, in the inks `projectInk` gives them in turn. */
export const Seeds: Story = {
  render: () => (
    <ul className={s.grid}>
      {INKED.map(({ seed, ink }) => (
        <li key={seed} className={s.seed}>
          <ProjectMark seed={seed} ink={ink} />
          <span className={s.seedName}>{seed}</span>
        </li>
      ))}
    </ul>
  ),
}

/** Beside a project's name in a row of work, and in a project window's bar. */
export const BesideAName: Story = {
  render: () => (
    <div className={s.uses}>
      <p className={s.line}>
        <span className={s.kind}>Permission</span>
        <span className={s.project}>
          <ProjectMark seed="meridian" ink={ProjectInk.Teal} size={15} />
          Meridian
        </span>
        <span className={s.ref}>418</span>
      </p>
      <p className={s.line}>
        <span className={s.project}>
          <ProjectMark seed="halyard" ink={ProjectInk.Clay} size={15} />
          Halyard
        </span>
        <span className={s.ref}>212</span>
        <span className={s.meta}>Review · Sonnet 5</span>
      </p>
      <p className={s.bar}>
        <ProjectMark seed="tessera" ink={ProjectInk.Moss} size={18} />
        Tessera
      </p>
    </div>
  ),
}

/** Each thing a mark can say, and a mark on a raised sheet, where the dot is ringed in the sheet's colour. */
export const AllStates: Story = {
  render: () => (
    <States
      cells={[
        { state: 'rest', node: <ProjectMark seed="meridian" ink={ProjectInk.Teal} /> },
        { state: 'running', node: <ProjectMark seed="meridian" ink={ProjectInk.Teal} running /> },
        { state: 'waits on you', node: <ProjectMark seed="meridian" ink={ProjectInk.Teal} yours /> },
        { state: 'both', node: <ProjectMark seed="meridian" ink={ProjectInk.Teal} running yours /> },
        { state: 'quiet', node: <ProjectMark seed="meridian" ink={ProjectInk.Teal} quiet /> },
        { state: 'small', node: <ProjectMark seed="meridian" ink={ProjectInk.Teal} size={15} /> },
        {
          state: 'on a sheet',
          node: (
            <span className={s.sheet}>
              <ProjectMark seed="meridian" ink={ProjectInk.Teal} yours />
            </span>
          ),
        },
      ]}
    />
  ),
}
