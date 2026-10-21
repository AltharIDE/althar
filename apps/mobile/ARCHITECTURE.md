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
| `lib/device.ts` | Face ID before the person's word; haptics |

## Principles

- **The Mac is canonical.** The phone keeps nothing but its key and its pairing. What it shows is read from the runtime, and says how old it is while the Mac is away. Nothing is queued against a sleeping Mac.
- **The runtime's API, not a phone's own.** The client's calls are the contract's, by name and shape, so the relay carries the same RPC as the window's port. Where the phone needs a call the API lacks, it's added to the contract, not invented here.
- **The person's word is the phone's to give.** A paired phone may answer, where a client on the Mac's socket can't (ADR-048). Answers that let an agent do more (allow, always allow, merge) ask for Face ID first; refusing never does.
- **The desktop's words and colours.** Every word on screen is the glossary's; violet means a person's call, cobalt what runs.
- **Pure modules, tested.** `model/` and the demo client are fully tested. Screens are shown with screenshots of the web build.

## Gaps

- No relay yet: the client is the demo. The relay client is a `PortLike` over the relay's WebSocket, carrying the contract's RPC as JSON, after a version handshake.
- Pairing is drawn, not real: the Secure Enclave key, the QR's contents and the four words from both keys are still to do.
- No notifications, dictation of its own, or Live Activity yet; [docs/design.md](docs/design.md) says how each is meant to work.
- Screens have no component tests; they're checked by the shots.
