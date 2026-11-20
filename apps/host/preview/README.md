# Althar host and worker preview

Download the artifact for your Linux machine from a successful **worker**
workflow run. Extract its `althar-preview-linux-*.tar.gz` archive as an ordinary
user. The archive contains the host with Node and its provider adapters, the
native worker and a smoke test. Keep the directory at a stable location if
you install a host service from it.

The Linux user needs systemd 254 or later, a working user service manager,
cgroup v2, Git and OpenSSL. Ubuntu 24.04 is an example. The worker runs
commands from trusted checkouts with that user's file access.

## Try the complete loop on one machine

From the extracted directory run:

```sh
./demo
```

The demo creates a temporary home, Git checkout, certificates and worker
journal. It starts the bundled host on loopback and enrolls the bundled
worker. It runs a Git check and prints the output. It restarts the home, waits
for the worker to reconnect, cancels another run and checks that its detached
subprocess stopped. The demo removes its temporary
data when it ends. It requires no account or provider sign-in.

## Run your own project

Use this package's `./althar-host` for the [host setup and worker configuration
steps](https://github.com/AltharIDE/althar/blob/main/apps/host/README.md#native-worker-diagnostic).
Use the supplied `./althar-worker` instead of building a worker from source.

For a persistent home, initialize it with the repository and install its
systemd user service:

```sh
./althar-host init --json --project /absolute/path/to/repository
./althar-host install-service --start
./althar-host status --wait --json
```

Configure the host's worker listener and enroll a worker certificate. Each
worker should have its own client certificate and private key. Restart the
host after changing the listener. For a worker on another machine, set the
host's bind address, use a private network such as Tailscale, and use a DNS
name covered by the home certificate. Copy the worker binary, the CA public
certificate and the enrolled worker's certificate and private key to that
machine. Keep the key and the journal private to the worker user.

On the worker, create the [private project command
file](https://github.com/AltharIDE/althar/blob/main/apps/host/README.md#run-a-project-command-on-a-linux-worker).
Its project ID is the one printed when you initialized the home. Start the
worker in watch mode with that file:

```sh
./althar-worker https://home.example:6770 "$HOME_ID" "$WORKER_ID" \
  /private/ca.pem /private/worker.pem /private/worker.key /private/worker-journal \
  --project-config /private/project-command --watch
```

Watch mode stays available for later runs and reconnects after an
interruption. Stop it with Ctrl-C or run the same command as a systemd user
service. On the home use `worker-project-run` to queue the command,
`worker-log` to read its output and `worker-cancel` to stop an active run.

This is a self-hosted preview delivered as a GitHub Actions artifact. The
official managed updater uses the independently trusted release key and
published signed host feed.
