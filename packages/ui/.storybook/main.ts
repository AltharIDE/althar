import type { StorybookConfig } from '@storybook/react-vite'

const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: [
    '../src/Introduction.mdx',
    '../src/Principles.mdx',
    /* An exploration's page is read before its stories, so it opens its group, which comes after everything else. */
    '../src/explorations/**/*.mdx',
    '../src/**/*.stories.tsx',
    '../workbench/**/*.stories.tsx',
  ],
  addons: ['@storybook/addon-a11y', '@storybook/addon-docs', 'storybook-addon-pseudo-states'],
  core: { disableTelemetry: true },
  staticDirs: [
    { from: './public', to: '/' },
    { from: '../node_modules/@fontsource-variable/inter/files', to: '/fonts/inter' },
    { from: '../node_modules/@fontsource-variable/jetbrains-mono/files', to: '/fonts/jetbrains-mono' },
  ],
  typescript: { reactDocgen: 'react-docgen' },
}
export default config
