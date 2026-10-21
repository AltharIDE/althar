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

### On a phone

Notifications, Face ID and the camera need a build of the app, not Expo Go.
On a Mac with Xcode, `bun run ios` builds and runs it in the simulator
(`npx expo run:ios --device` for a phone on the cable). Without one, EAS
builds it ([eas.json](eas.json)); the Apple developer account and signing
are the person's:

```bash
npx eas-cli build --profile development --platform ios   # a development build, installed from a link
npx eas-cli build --profile preview --platform ios       # the demo, to hand to someone
```

It runs on the demo. Settings › Diagnostics checks, on the phone's own
Hermes, the way it will talk to Althar once the relay exists.

| Command | What it does |
| --- | --- |
| `bun run check` | Type checks, the contract's types included |
| `bun run test` | Unit tests: the models, notifications, pairing, the demo client, and the relay client against a server of the contract's own |
| `bun run lint` | The repository's lint and format checks, on this app |
| `bun run export:web` | Builds the web version into `dist` |
| `bun run shots [name…]` | Screenshots of each screen from `dist`, at 390×844, into `test-results/shots` |

The demo reads the page's address on the web: `?connection=away`,
`?connection=unpaired` or `?connection=outdated` for those states,
`?live=0` to hold still (the shots use it), `?theme=dark`.

## Where things are

| Path | What's there |
| --- | --- |
| `src/app` | The screens, by route (Expo Router) |
| `src/client` | `AltharClient`, the seam: the runtime's calls a phone needs, with the contract's shapes; React hooks over it |
| `src/client/demo` | The demo: an afternoon of three projects, kept in memory, changing as the runtime would |
| `src/client/relay` | The relay client over the contract's RPC as JSON, the phone's scheduler, the pairing code and words, and the self-test Diagnostics runs |
| `src/notify` | Notifications: what each says and does (pure), and the bridge to the system |
| `src/model` | Pure: what needs you, at work, words, a thread's rounds, a diff line's pieces |
| `src/components` | Cards, rows, the thread, the composer, and the kit's primitives drawn for a phone |
| `src/theme` | The kit's tokens, light and dark |
| `docs` | The design, the research behind it, and the Hermes spike's report |
| `spikes/hermes` | The spike itself: `./run.sh` builds React Native 0.88's Hermes and runs Effect and the contract on it |
