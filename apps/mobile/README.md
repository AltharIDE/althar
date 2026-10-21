# @althar/mobile

Althar on a phone: what needs you, answered in place; what's at work; and
starting work, from anywhere your Mac can be reached. An Expo app (SDK 58,
React Native 0.88) for iOS, and Android later. It runs on demo data until
the relay exists ([ADR-048](../../docs/decisions/048-where-the-runtime-runs-and-who-may-reach-it.md)).

The design, the competitor research behind it, and what's left to decide:
[docs/design.md](docs/design.md).

## Work on it

It keeps its own lockfile, outside the Bun workspace (the root
`package.json` lists the other apps by name), so Expo's exact React can't
move the desktop's, and so it can move to a repository of its own. It reads
`@althar/contracts`' types by path, so install the root too.

```bash
bun install --frozen-lockfile            # at the root, for @althar/contracts
cd apps/mobile && bun install
bun run web                              # in a browser, at a phone's width
bun run ios                              # in the iOS simulator, on a Mac
```

| Command | What it does |
| --- | --- |
| `bun run check` | Type checks, the contract's types included |
| `bun run test` | The models' and the demo client's unit tests |
| `bun run export:web` | Builds the web version into `dist` |
| `bun run shots [name…]` | Screenshots of each screen from `dist`, at 390×844, into `test-results/shots` |

The demo reads the page's address on the web: `?connection=away` or
`?connection=unpaired` for those states, `?live=0` to hold still (the shots
use it), `?theme=dark`.

## Where things are

| Path | What's there |
| --- | --- |
| `src/app` | The screens, by route (Expo Router) |
| `src/client` | `AltharClient`, the seam: the runtime's calls a phone needs, with the contract's shapes; React hooks over it |
| `src/client/demo` | The demo: an afternoon of three projects, kept in memory, changing as the runtime would |
| `src/model` | Pure: what needs you, at work, words, a thread's rounds, a diff line's pieces |
| `src/components` | Cards, rows, the thread, the composer, and the kit's primitives drawn for a phone |
| `src/theme` | The kit's tokens, light and dark |
| `docs` | The design, and the research behind it |
