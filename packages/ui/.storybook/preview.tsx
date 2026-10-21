// oxlint-disable-next-line typescript/triple-slash-reference -- the pre-commit hook checks staged files from the root, where env.d.ts is out of view
/// <reference path="./env.d.ts" />
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '../src/styles/global.css'

import type { Preview } from '@storybook/react-vite'

import { theme } from './theme'

const preview: Preview = {
  parameters: {
    layout: 'padded',
    // In the theme's own shades, so they follow the toolbar's Light and Dark.
    backgrounds: {
      options: {
        page: { name: 'Page', value: 'var(--n-2)' },
        raised: { name: 'Raised', value: 'var(--n-1)' },
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
  // Light or dark, from the toolbar: the kit's tokens follow the root's data-theme (styles/dark.css).
  globalTypes: {
    theme: {
      description: 'Light or dark',
      toolbar: {
        title: 'Theme',
        icon: 'mirror',
        items: [
          { value: 'light', title: 'Light', icon: 'sun' },
          { value: 'dark', title: 'Dark', icon: 'moon' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { backgrounds: { value: 'page' }, theme: 'light' },
  /* A play drives a story the way a person would and leaves focus where it ended.
     Put it down afterwards, so the story shows at rest and not focused. */
  afterEach: () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  },
  decorators: [
    (Story, { globals }) => {
      document.documentElement.dataset.theme = globals.theme === 'dark' ? 'dark' : 'light'
      return (
        <div className="ch-root">
          <Story />
        </div>
      )
    },
  ],
}
export default preview
