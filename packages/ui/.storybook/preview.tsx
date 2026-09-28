import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '../src/styles/global.css'

import type { Preview } from '@storybook/react-vite'

import { theme } from './theme'

const preview: Preview = {
  parameters: {
    layout: 'padded',
    backgrounds: {
      options: {
        page: { name: 'Page', value: '#f4f2ec' },
        raised: { name: 'Raised', value: '#fcfbf8' },
      },
    },
    a11y: { test: 'error' },
    controls: { expanded: true },
    /* Snippets show the story as written. Storybook's default prints the rendered tree instead,
       which for a States grid of whole components (a DocPanel and its document) never finishes. */
    docs: { theme, source: { type: 'code' } },
    options: {
      storySort: {
        order: [
          'Introduction',
          'Principles',
          'Foundations',
          'Primitives',
          'Chrome',
          'Thread',
          'Coordinator',
          'Board',
          'Dock',
          'Outputs',
          'Setup',
          'Composer',
          'Screens',
          ['Welcome', 'Opening', 'Start', 'NewProject', 'ProjectRules'],
          'Task',
          'Workbench',
        ],
      },
    },
  },
  initialGlobals: { backgrounds: { value: 'page' } },
  /* A play drives a story the way a person would and leaves focus where it ended.
     Put it down afterwards, so the story shows at rest and not focused. */
  afterEach: () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  },
  decorators: [
    (Story) => (
      <div className="ch-root">
        <Story />
      </div>
    ),
  ],
}
export default preview
