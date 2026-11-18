# Worker control protocol

The home owns the scheduler and chooses a protocol version. The worker opens
the control stream. The first messages bind it to its enrolled home and worker
identity and one session. The home compares the worker ID in the offer with
the identity established by transport authentication. The Rust worker checks
the response against its enrollment and the version it offered. Each side
rejects missing or malformed messages and handshakes over 4 KiB.

The schema defines the bidirectional gRPC service for the transport trial.
The current slice builds both bindings and tests the handshake between a Node
process and a Rust fixture over pipes. The first production execution path adds
transport authentication, worker enrollment, leases, durable attempts and recovery.

From the repository root, use the pinned Bun and Rust toolchains:

```sh
bun install --frozen-lockfile --ignore-scripts --filter althar --filter @althar/worker-protocol
cargo test --locked -p althar-worker
cargo build --locked -p althar-worker --example worker_hello
cd packages/worker-protocol
bun run generate
bun run check
bun run test --maxWorkers=1
bun run test:interop
```

Edit the schema under `proto` and regenerate the checked-in TypeScript bindings.
Cargo generates Rust bindings during the build using the locked compiler
dependency. CI checks that regeneration produces the checked-in output.
