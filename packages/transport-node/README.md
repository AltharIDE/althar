# @althar/transport-node

Node clients for the versioned Althar API. It depends on contracts and Effect,
and opens no database, runtime, provider sign-in or credential store.

```ts
const connection = yield* openSshConnection({ target: 'my-vps', homeId: expectedHome })
const { api, info } = yield* apiClient(connection)
const projects = yield* api.ListProjects()
```

Run this in an Effect scope. Closing the scope releases the connection and its
dedicated SSH process; the home and its work continue independently. For a
local running home use `openLocalConnection(absoluteProfile, expectedHome)`.
`inspectSshHost` reads public status without changing the home or pairing a device.
Verify the home identity before supplying it to a command connection.

OpenSSH must already authenticate noninteractively and trust the server's key.
Host aliases, config and ProxyJump work through system OpenSSH. Althar requires
strict host-key checking, disables agent forwarding and multiplexing, and never
accepts an unknown key. A rejected key must be verified independently. Remote
launchers and profiles are absolute Linux paths, quoted as literal arguments.
The managed launcher is selected by default. `configFile` and `port` can select
an explicit SSH configuration and port. Interactive login and host installation
remain operator steps; this package neither bootstraps a VPS nor provisions keys.

An SSH bridge has **socket authority**. It cannot approve permissions, register
devices or masquerade as a paired person. The private endpoint secret stays on
the host. No SSH stderr, private endpoint contents or provider credentials are
included in transport errors. The environment passed to SSH is allowlisted.

From this package, `bun run check` checks types, lint and formatting;
`bun run test --maxWorkers=1` runs scoped tests. CI also gates coverage at 90%.
The host's integration tests exercise the built bridge with an isolated real
OpenSSH daemon, generated keys and a fixture known-hosts file.

See [ARCHITECTURE.md](ARCHITECTURE.md) for protocol, ownership and limits.
