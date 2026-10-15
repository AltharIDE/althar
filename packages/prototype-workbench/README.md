# @althar/prototype-workbench

One live page for a prototype. The direction shown fills the page, and a slim bar at the bottom switches between the directions, A, B, C…, and the states they show, in place: the same screen, the same state, nothing to navigate out of. Today, the app as it is, stands beside them where the prototype draws it, and side by side puts them all next to each other at one state. The address says what is shown (`?d=B&s=pushing`), so a link or a screenshot points at one exact view.

It is for throwaway prototypes, drawn with the kit's real components (`@althar/ui`) on its tokens, light only. It isn't the kit's, and nothing here is built or shipped.

## A prototype

A folder with a `prototype.tsx`, anywhere in the repository: in a task's scratch folder (`.althar/scratch/<name>/`), which git ignores, or elsewhere. It needs no `index.html` and no packages of its own. [`example/prototype.tsx`](example/prototype.tsx) is a whole one to start from.

```tsx
import { prototype } from '@althar/prototype-workbench'

// TodaysCard, InTheFoot and OnTop are the prototype's own components, drawn with @althar/ui.
export default prototype<{ commits: number }>({
  title: 'Board card: commits not pushed',
  states: [
    { key: 'waiting', name: '3 to push' },
    { key: 'pushed', name: 'Pushed' },
  ],
  fixtures: (state) => ({ commits: state === 'pushed' ? 0 : 3 }),
  today: { render: () => <TodaysCard /> },
  directions: [
    { key: 'A', name: 'In the foot', render: ({ fixtures }) => <InTheFoot commits={fixtures.commits} /> },
    { key: 'B', name: 'On top', render: (view) => <OnTop {...view} /> },
  ],
})
```

- `directions`: `{ key, name, render }`, in the bar's order. `render` gets the view: the `direction`, the `state`, the `fixtures` for that state, and `side`, true when drawn beside the others.
- `states`: `{ key, name }`, every direction shown at each. Optional.
- `fixtures`: the data for a state, `(state) => data`. Optional.
- `today`: the app as it is, `{ name?, render }`, drawn first, as Today. Optional.
- `width`: the width the directions are designed at; side by side, each is scaled to fit its column. Optional.
- `useShared(name, initial)`: state every direction keeps as the person switches, as `useState`: the task opened, the tab chosen. Side by side, the directions share it too.

## Serve it

From the repository's root:

```bash
bun run prototype .althar/scratch/board-card
```

It serves at the first free port from 5400 and prints the address; the page is that address itself. Leave it running: in Althar, it shows in the task's Running pill, which opens the page. It polls for edits, so it sees them even started in an agent's sandbox, and an edit draws in place, keeping the direction and the state.

On the page: `1`–`9` show a direction (`0` is Today), `←` `→` step through them, `[` `]` through the states, `S` puts them side by side and back, `H` hides the bar. The bar's Keys lists them.

## Shoot it

With it served, from the root, outside an agent's sandbox (Chromium can't start in it on a Mac):

```bash
bun run prototype:shoot http://localhost:5400 --out test-results/board-card
```

It walks the live page through every direction at every state, Today first, then A1, A2…, and each state side by side, and writes them in order with a caption each, in the list it prints and in `shots.md` beside them. `--clean` leaves the bar out, `--no-side` the side by side shots, `--size 1440x900` sets the window, and `--scale 2` takes them sharper than the 1× evidence wants.

## Work on it

`bun run check` and `bun run test` here, as in every package; `bun run example` serves the example.
