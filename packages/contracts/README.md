# @charrette/contracts

The contract between Charrette's runtime and its clients: the API, as Effect RPC schemas, and the transport it runs over a message port. The runtime serves it (`@charrette/runtime`'s `connection`); the desktop app's window calls it.

## Use it

On the runtime's side, over an Electron `MessagePortMain` or a Node port:

```ts
import { emitterPort } from '@charrette/contracts'
import { connection } from '@charrette/runtime'

Layer.launch(connection(emitterPort(port)))
```

On a client's side, over a DOM `MessagePort`:

```ts
import { Api, clientProtocol, domPort } from '@charrette/contracts'
import { RpcClient } from 'effect/rpc'

const client = yield* RpcClient.make(Api).pipe(Effect.provideContext(yield* Layer.build(clientProtocol(domPort(port)))))
const status = yield* client.Status()
```

- **`Api`** holds every call: status and sign-in, projects, tasks, a task's thread (`GetThread`), sessions (start, switch, model, interrupt, stop), sending to a thread, answering a call, and `Watch`, the stream of what changes.
- **`ApiError`** is the one error a call fails with: the runtime's own error tag as `reason`, and a message a person can read.
- **`serverProtocol` and `clientProtocol`** run Effect's RPC over any port, as a worker would: the server says it is ready, and ends when the client closes or its port does.

## Work on it

From `packages/contracts`:

| Command | What it does |
| --- | --- |
| `bun run check` | Format, type-aware lint and type checks |
| `bun run test` | A server and a client over a `MessageChannel`: calls, errors and a stream |
| `bun run test:coverage` | The same, with the coverage gate |
| `bun run verify` | Check and coverage, as CI runs them |

See [ARCHITECTURE.md](ARCHITECTURE.md) for the rules this package follows.
