# @althar/mobile — Architecture

A thin client of the runtime on the paired Mac, reached through the relay. The repository's [ARCHITECTURE.md](../../ARCHITECTURE.md) sets the general engineering target.

- **Owner:** Repository maintainers
- **Dependency direction:** depends on `@althar/contracts` for the API's types, by path, and on nothing else of the repository. Nothing depends on it.

## What it holds

| Module | What it does |
| --- | --- |
| `client/AltharClient.ts` | The seam: the runtime's calls a phone needs, by their names, with the contract's shapes, plus pairing and how the phone stands with the Mac |
| `client/demo` | The demo client: the same calls, on an afternoon kept in memory |
| `client/react.tsx` | React Query over the client; the watch reads queries again as records change, and holds what agents are saying as it streams |
| `model/` | Pure rules and words: what needs you (the desktop's `shared/calls.ts`, kept in step), what's at work, a thread's rounds, a diff line's pieces |
| `components/`, `app/` | What the screens draw |
| `client/relay` | The relay client: the contract's RPC over a port carrying JSON; the phone's scheduler; the pairing code and its words; the self-test |
| `notify/` | What taps the person, as data (pure), and the bridge to `expo-notifications` |
| `lib/device.ts` | Face ID before the person's word; haptics |
| `polyfills.ts` | `crypto.getRandomValues`, which React Native and Expo don't install |

## Principles

- **The Mac is canonical.** The phone keeps nothing but its key and its pairing. What it shows is read from the runtime, and says how old it is while the Mac is away. Nothing is queued against a sleeping Mac.
- **The runtime's API, not a phone's own.** The client's calls are the contract's, by name and shape, so the relay carries the same RPC as the window's port. Where the phone needs a call the API lacks, it's added to the contract, not invented here.
- **The person's word is the phone's to give.** A paired phone may answer, where a client on the Mac's socket can't (ADR-048). Answers that let an agent do more (allow, always allow, merge) ask for Face ID first; refusing never does.
- **The desktop's words and colours.** Every word on screen is the glossary's; violet means a person's call, cobalt what runs.
- **One Effect, on the phone's scheduler.** Metro resolves `effect` from the app for every file, the contract's included; the relay client runs everything on a scheduler that yields with `setTimeout`, as React Native's `setImmediate` doesn't let anything else run ([docs/hermes-spike.md](docs/hermes-spike.md)).
- **Pure modules, tested.** `model/`, `notify/notices.ts`, the pairing code, the demo client and the relay client are tested. Screens are shown with screenshots of the web build.

## Gaps

- No relay yet: the app runs the demo. The relay client is built and tested; it needs the relay's channel (a WebSocket, and an encrypted session over it).
- Pairing reads the code and draws the words, but makes no key yet: the Secure Enclave key is still to do.
- Notifications are local: the service extension that opens encrypted pushes, and Deny from a killed app, are still to do. No dictation of its own or Live Activity yet; [docs/design.md](docs/design.md) says how each is meant to work.
- Screens have no component tests; they're checked by the shots.
