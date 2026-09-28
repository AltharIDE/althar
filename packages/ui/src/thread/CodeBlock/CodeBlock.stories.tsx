import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { ROUTER_CODE } from '../../fixtures/meridian'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { CodeBlock } from './CodeBlock'
import { States, statesOn } from '../../storybook/States'

const meta = {
  title: 'Thread/CodeBlock',
  component: CodeBlock,
  decorators: [threadDecorator],
  args: { file: 'src/refunds/router.ts', line: 18, lang: 'TypeScript', changed: [2, 4, 5, 6, 7], code: ROUTER_CODE, onOpen: fn() },
} satisfies Meta<typeof CodeBlock>
export default meta
type Story = StoryObj<typeof meta>

export const FromAFile: Story = {}
/** The consumer names the editor it opens. */
export const NamedEditor: Story = { args: { text: { open: 'Open in VS Code' } } }
export const Unchanged: Story = { args: { changed: [] } }
/** A language the built-in colouring does not know: plain, unless the host passes its own highlighter. */
export const OtherLanguage: Story = {
  args: { lang: 'Python', file: 'scripts/replay.py', line: 1, changed: [], code: 'def replay(day):\n    return run("pnpm replay", day)' },
}
/** The host's own highlighter, one line at a time. */
export const HostHighlighter: Story = { args: { highlight: (line) => <span style={{ color: 'var(--t-1)' }}>{line}</span> } }
/** Not from a file: only its language. */
export const Loose: Story = {
  args: {
    file: undefined,
    changed: [],
    lang: 'Shell',
    code: '# replay yesterday against the branch\npnpm replay --from 2026-09-25 refunds',
  },
}

/* The block's actions take the forced states: Copy hovered, focused, pressed. */
export const AllStates: Story = {
  parameters: statesOn({ hover: 'button:first-of-type', focus: 'button:first-of-type', pressed: 'button:first-of-type' }),
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'from a file', node: <CodeBlock {...args} /> },
        { state: 'unchanged', node: <CodeBlock {...args} changed={[]} /> },
        {
          state: 'loose',
          node: <CodeBlock {...args} file={undefined} changed={[]} lang="Shell" code="pnpm replay --from 2026-09-25 refunds" />,
        },
        { state: 'no editor', node: <CodeBlock {...args} onOpen={undefined} /> },
        { state: 'hover', node: <CodeBlock {...args} /> },
        { state: 'focus', node: <CodeBlock {...args} /> },
      ]}
    />
  ),
}
