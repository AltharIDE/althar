# @althar/ui

Althar's interface components: the thread (messages, tool calls, steps, permissions), the composer, the coordinator's cards, the board, the dock beside it, a task's outputs, the window's chrome, and the primitives they are built from. Each component has Storybook stories for its states.

The components are presentational. Data comes in as props, already resolved, and effects go out as callbacks. Nothing inside fetches, stores, or knows which project it is in. The app that uses them wires them to its own state.

It is early. Until the package has a second consumer, its API can change without notice.

## Use it

The package is private to this workspace and is consumed as TypeScript source. Add it to an app's dependencies as `"@althar/ui": "workspace:*"`.

```tsx
import '@althar/ui/styles.css'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'

import { Button, WorkedFor } from '@althar/ui'

export function Example({ onStart }: { onStart: () => void }) {
  return (
    <div className="ch-root">
      <Button variant="signal" onClick={onStart}>
        Start
      </Button>
      <WorkedFor took="12m" text={{ took: (d) => `Travaillé pendant ${d}` }}>
        …
      </WorkedFor>
    </div>
  )
}
```

- **Styles.** Import `@althar/ui/styles.css` once. It holds only the tokens and a base layer that any component rule overrides. Wrap the UI in `.ch-root`, which sets the type the components inherit, in portals too.
- **Fonts.** The tokens ask for Inter and JetBrains Mono, and fall back to system fonts. The consumer loads them; the example uses the Fontsource packages Storybook uses.
- **Copy.** A component's own words come from its `text` prop, with English defaults exported beside it (`workedForText`). Translations live in the consumer. Content such as a message or a title is an ordinary prop.
- **Screens.** Whole screens (Welcome, Start, NewProject, ProjectRules) are on a separate entry, `@althar/ui/screens`, so the main entry stays general.
- **Peers.** React 19. Overlays are built on Radix (`radix-ui`), which comes with the package.

## Work on it

From the repository root, run `bun install`. Then, from `packages/ui`:

| Command | What it does |
| --- | --- |
| `bun run storybook` | Storybook at `http://localhost:6006`, with the accessibility addon on every story |
| `bun run check` | Format, type-aware lint and type checks |
| `bun run fix` | The same, fixing what can be fixed |
| `bun run test` | Vitest in jsdom: every story rendered, with its `play` function, plus unit tests |
| `bun run test:coverage` | The tests with the coverage gate: 90% of lines and branches in `src` |
| `bun run build` | The static Storybook, into `dist/storybook` |
| `bun run verify` | Check, coverage and build, as CI runs them |

A new component gets a folder under its layer with the component (`Name.tsx`), its styles (`Name.module.css`) and its stories (`Name.stories.tsx`), and is exported from `src/index.ts`. Every state is a story: hover, focus, pressed, disabled, busy, selected, empty, error. Behaviour is specified in `play` functions, which also run as tests.

## Layout

| Folder | What it holds |
| --- | --- |
| `src/foundations` | Tokens, icons, brand marks, the logo, and the domain vocabularies |
| `src/primitives` | General parts: buttons, menus, popovers, fields, panels |
| `src/thread`, `src/composer` | What appears in a conversation, and what writes into one |
| `src/coordinator`, `src/board`, `src/dock` | The coordinator's cards, the board of work, and what opens beside it |
| `src/outputs`, `src/chrome`, `src/setup` | What a task made, the window's furniture, and what comes before a project |
| `src/screens` | Whole screens made from the rest |
| `src/fixtures`, `src/storybook` | The demo world and helpers that stories and tests use; not exported |
| `tests` | Vitest: every story, plus unit tests for what a story can't reach |

## More

- [ARCHITECTURE.md](ARCHITECTURE.md): the principles every component follows, the layers and what may import what, the public API, and the known gaps.
- [The repository's engineering standards](../../ARCHITECTURE.md).
- [The glossary](../../docs/glossary.md): the words the interface uses. Check it before naming anything on screen.
