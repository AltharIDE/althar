# Worker control protocol

The home owns the scheduler and chooses a protocol version. The worker opens
the control stream. The first messages bind it to its enrolled home and worker
identity and one session. The home compares the worker ID in the offer with
the identity established by transport authentication. The Rust worker checks
the response against its enrollment and the version it offered. Each side
rejects missing or malformed messages and handshakes over 4 KiB.

The gRPC handshake listener requires mutual TLS. It maps the verified client
certificate to a current enrollment, then checks that the worker's offer
matches that enrollment. The Rust probe verifies the server certificate and
the home ID from its local enrollment. The probe closes after the handshake.
The transport fixture supplies the certificates and enrollment records.
Host lifecycle integration, certificate provisioning and leased command
execution with durable recovery are subsequent steps.

From the repository root, use the pinned Bun and Rust toolchains:

```sh
bun install --frozen-lockfile --ignore-scripts --filter althar --filter @althar/worker-protocol
cargo test --locked -p althar-worker
cargo build --locked -p althar-worker --examples
cd packages/worker-protocol
bun run generate
bun run check
bun run test --maxWorkers=1
bun run test:interop
```

The gRPC integration test uses OpenSSL to create temporary certificates.

Edit the schema under `proto` and regenerate the checked-in TypeScript bindings.
Cargo generates Rust bindings during the build using the locked compiler
dependency. CI checks that regeneration produces the checked-in output.
Once the schema is on main, CI compares it with the base revision and rejects
changes that would break existing bindings or wire compatibility.
