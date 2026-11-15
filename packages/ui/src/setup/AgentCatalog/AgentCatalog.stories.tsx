import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { AgentCatalog } from './AgentCatalog'

const connection = {
  id: 'acp-goose',
  name: 'Goose',
  command: 'goose',
  args: ['acp'],
  mode: 'approve',
  readerMode: 'approve',
  modeOption: 'mode',
  modelOption: 'model',
  effortOption: null,
  held: {},
  registryId: 'goose',
  registryVersion: '1.59.1',
}
const meta = {
  title: 'Setup/AgentCatalog',
  component: AgentCatalog,
  parameters: { layout: 'padded' },
  args: {
    items: [
      {
        id: 'goose',
        name: 'Goose',
        description: 'An extensible engineering agent.',
        version: '1.59.1',
        guide: 'https://block.github.io/goose/',
        command: 'goose',
        args: ['acp'],
        mode: 'approve',
        readerMode: 'approve',
      },
    ],
    connections: [],
    onRefresh: fn(),
    onSave: fn(),
    onCheck: fn(),
    onRemove: fn(),
    onGuide: fn(),
  },
} satisfies Meta<typeof AgentCatalog>
export default meta
type Story = StoryObj<typeof meta>
export const Empty: Story = {}
export const Connections: Story = {
  args: {
    connections: [
      { connection, state: 'ready', reason: null, version: '1.59.1' },
      { connection: { ...connection, id: 'acp-pi', name: 'Pi' }, state: 'checking', reason: null, version: null },
      {
        connection: { ...connection, id: 'acp-kiro', name: 'Kiro' },
        state: 'failed',
        reason: 'The reading mode allowed a file edit without approval. Edit the connection and check again.',
        version: null,
      },
    ],
  },
}
