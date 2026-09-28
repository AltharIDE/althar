import { composeStories } from '@storybook/react-vite'
import { describe, expect, it } from 'vitest'

/*
 * Every story renders, and every play function passes, in jsdom. A story is
 * a state the component must support, so this is the component suite's
 * floor; behaviour a play cannot reach is tested beside it.
 */
type StoryFile = Parameters<typeof composeStories>[0]
/* What composeStories gives back, as far as this suite uses it; its own type is lost to Object.entries. */
interface Runnable {
  run: () => Promise<void>
}
const files = import.meta.glob<StoryFile>('../src/**/*.stories.tsx', { eager: true })

/*
 * Plays that need what only a browser has run in Storybook only. A closed
 * Fold is inert, which removes it from the accessibility tree in a browser;
 * Testing Library in jsdom does not know inert, so it still finds what is
 * inside. And a click on a label forwards a pointer event jsdom cannot clone.
 */
const BROWSER_ONLY = new Set<string>([
  'primitives/Fold/Fold.stories.tsx#Opening',
  'thread/Snippet/Snippet.stories.tsx#ShowingAll',
  'thread/WorkedFor/WorkedFor.stories.tsx#Opening',
  'primitives/CheckList/CheckList.stories.tsx#Default',
])

for (const [path, file] of Object.entries(files)) {
  describe(path.replace('../src/', ''), () => {
    const rel = path.replace('../src/', '')
    for (const [name, Story] of Object.entries<Runnable>(composeStories(file))) {
      const id = `${rel}#${name}`
      it.skipIf(BROWSER_ONLY.has(id))(name, async () => {
        await Story.run()
        expect(document.body.childElementCount).toBeGreaterThan(0)
      })
    }
  })
}
