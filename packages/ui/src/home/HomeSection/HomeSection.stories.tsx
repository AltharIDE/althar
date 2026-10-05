import type { Meta, StoryObj } from '@storybook/react-vite'

import { SINCE } from '../../fixtures/home'
import { HomeLane } from '../../foundations/vocabulary'
import { States } from '../../storybook/States'
import { SinceRow } from '../SinceRow/SinceRow'
import { HomeSection } from './HomeSection'
import s from './HomeSection.stories.module.css'

const meta = {
  title: 'Home/HomeSection',
  component: HomeSection,
  args: { lane: HomeLane.Yours, count: 3 },
} satisfies Meta<typeof HomeSection>
export default meta
type Story = StoryObj<typeof meta>

const Filler = ({ n }: { n: number }) => (
  <div className={s.filler}>
    {Array.from({ length: n }, (_, i) => (
      <span key={i} />
    ))}
  </div>
)

/** Calls that wait on you: violet, with how many. */
export const NeedsYou: Story = {
  render: (args) => (
    <HomeSection {...args}>
      <Filler n={3} />
    </HomeSection>
  ),
}

export const Running: Story = {
  args: { lane: HomeLane.Running, count: 5 },
  render: (args) => (
    <HomeSection {...args}>
      <Filler n={5} />
    </HomeSection>
  ),
}

/** What the loop did since you last looked, titled with when that was. */
export const SinceYouLooked: Story = {
  args: { lane: HomeLane.Since, count: 2, when: '3 h ago' },
  render: (args) => (
    <HomeSection {...args}>
      {SINCE.slice(0, 2).map(({ id, ...event }) => (
        <SinceRow key={id} {...event} />
      ))}
    </HomeSection>
  ),
}

/** Nothing in it: the section says so, and the glyph keeps its place without the violet. */
export const Empty: Story = { args: { count: 0 } }

export const AllStates: Story = {
  render: () => (
    <States
      size="wide"
      cells={[
        {
          state: 'needs you',
          node: (
            <HomeSection lane={HomeLane.Yours} count={2}>
              <Filler n={2} />
            </HomeSection>
          ),
        },
        { state: 'nothing needs you', node: <HomeSection lane={HomeLane.Yours} count={0} /> },
        {
          state: 'running',
          node: (
            <HomeSection lane={HomeLane.Running} count={2}>
              <Filler n={2} />
            </HomeSection>
          ),
        },
        { state: 'nothing running', node: <HomeSection lane={HomeLane.Running} count={0} /> },
        {
          state: 'since',
          node: (
            <HomeSection lane={HomeLane.Since} count={1} when="3 h ago">
              <Filler n={1} />
            </HomeSection>
          ),
        },
        { state: 'nothing since', node: <HomeSection lane={HomeLane.Since} count={0} when="3 h ago" /> },
        {
          state: 'answered, none left',
          node: (
            <HomeSection lane={HomeLane.Yours} count={0}>
              <Filler n={1} />
            </HomeSection>
          ),
        },
      ]}
    />
  ),
}
