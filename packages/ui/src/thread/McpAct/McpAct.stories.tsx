import type { Meta, StoryObj } from '@storybook/react-vite'

import { Brand } from '../../foundations/brands/brands'
import { ToolKind, ToolState } from '../../foundations/vocabulary'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { Tool } from '../Tool/Tool'
import { McpAct, McpServer } from './McpAct'

const meta = {
  title: 'Thread/MCP act',
  component: McpAct,
  decorators: [threadDecorator],
  args: {
    server: 'github',
    brand: Brand.GitHub,
    did: 'Posted on #612',
    words: 'The tour’s second card sits 12px lower than its Storybook story, and its title wraps at 900px where the story’s doesn’t.',
    link: 'https://github.com/AltharIDE/althar/pull/612#pullrequestreview-1',
  },
} satisfies Meta<typeof McpAct>
export default meta
type Story = StoryObj<typeof meta>

/** A review posted through the person's GitHub server: what it said, and Open. */
export const Posted: Story = {}

/** An issue moved: nothing said, no words. */
export const Moved: Story = { args: { server: 'linear', brand: Brand.Linear, did: 'Moved DEV-188 to In Review', words: undefined } }

/** Reads stay rows of the work, each with its server; an act stands out under them. */
export const InTheWork: Story = {
  render: (args) => (
    <>
      <Tool
        kind={ToolKind.Mcp}
        verb="Get"
        target="pull request #612"
        state={ToolState.Done}
        meta={<McpServer name="github" brand={Brand.GitHub} />}
      />
      <Tool kind={ToolKind.Mcp} verb="Browser" target="take screenshot" state={ToolState.Done} meta={<McpServer name="playwright" />} />
      <Tool
        kind={ToolKind.Comment}
        verb="Posted"
        target="on #612"
        state={ToolState.Done}
        meta={<McpServer name="github" brand={Brand.GitHub} />}
      />
      <McpAct {...args} />
    </>
  ),
}
