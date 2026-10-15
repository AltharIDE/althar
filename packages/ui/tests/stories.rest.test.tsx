import { runStories, type StoryFile } from './stories'

/* Every story the other stories files don't take. */
runStories(
  import.meta.glob<StoryFile>(
    [
      '../src/**/*.stories.tsx',
      '!../src/chrome/**/*.stories.tsx',
      '!../src/thread/**/*.stories.tsx',
      '!../src/setup/**/*.stories.tsx',
      '!../src/coordinator/**/*.stories.tsx',
      '!../src/screens/**/*.stories.tsx',
      '!../src/composer/**/*.stories.tsx',
    ],
    { eager: true },
  ),
)
