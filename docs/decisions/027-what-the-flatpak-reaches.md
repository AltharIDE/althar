# ADR-027: What the Flatpak reaches, and what it does not

- **Status:** Accepted
- **Date:** 2026-10-10
- **Owner:** Repository maintainers
- **Context:** In a Flatpak the home is a fresh empty one and the filesystem
  is the runtime's: the person's own OpenCode and Codex, their editors, their
  git sign-in and their ssh agent are not in it, while the agents Althar
  bundles and downloads are. Claude Code's ACP adapter and CLI are bundled.
  Codex's own Linux
  sandbox builds a bubblewrap view and needs user namespaces for it; a Flatpak
  may not make them (measured on Flatpak 1.18.4: `unshare` is refused inside,
  so `codex sandbox` fails with "no permissions to create a new namespace").
- **Decision:**
  - **The person's own OpenCode and Codex, and their editors, run on the device through `flatpak-spawn`.**
    The manifest asks for `--talk-name=org.freedesktop.Flatpak`; at startup
    one host `sh` call finds where the person's own commands are (their PATH
    and the usual install places), and a launch goes out there with
    `--watch-bus`, `--clear-env` and `--directory`. Paths are translated at
    that boundary only: the document portal is `/run/flatpak/doc/<id>` in the
    sandbox and `/run/user/<uid>/doc/<id>` on the device; the profile and the
    worktrees are already the same absolute path on both sides. Everything is
    gated on `FLATPAK_ID`: dev, macOS, AppImage, deb, rpm and the CLI are
    unchanged.
  - **What reaches the device is built, not inherited.** Only the device's
    home, PATH and runtime directory, and what an executor set for the agent
    (an account's home, Althar's settings, the signed-out git settings) cross;
    nothing else does, so no ssh agent and no signed-in tool reaches an agent
    (ADR-011). The account homes and the profile are host-visible, so host runs
    read and write the same files the sandbox does. Where a worktree's `.git`
    file points through `/run/flatpak/doc`, the bridge passes translated
    `GIT_DIR` and `GIT_WORK_TREE` paths to host git.
  - **Editors are the person's own, out there.** The list is found on the
    device, opening one goes through `flatpak-spawn` with the device's own
    environment (an editor needs its display and its bus), and the file
    manager shows the file there.
  - **Codex runs on the device.** Its adapter stays in the sandbox and drives
    the person's own Codex installation through `CODEX_PATH` →
    `flatpak/codex-host.sh` (`/app/bin/althar-host-codex`): its own sandbox
    works where user namespaces do. The bridge passes the account's home and
    Althar's settings by name, nothing else, and a session without a Codex
    installed on the device stops with a sentence saying so. The bundled Codex
    cannot sandbox itself inside the Flatpak, and codex-acp has no mode that
    both drops the sandbox and keeps approval requests with Althar (its
    `agent-full-access` mode drops the requests too), so running the person's
    own is the only way that keeps every step asking.
  - **Claude Code's sessions use its bundled adapter, and its usual account
    gets one home both sides see.** The usual account keeps a persistent
    `claude-usual` home under the app's profile, with the person's settings
    linked in; its status and sign-in run the host's own `claude` where there
    is one, and the bundled CLI otherwise, so they inspect the same home its
    sessions use. The bundled CLI is a Bun-compiled executable, whose
    JavaScript payload sits in a trailer at the end of the file: the manifest
    keeps flatpak-builder's strip and debug-info step off it
    (`dev.althar.app.yml`), which would drop the payload and leave it running
    as plain `bun`, failing sign-in and sessions alike. In a reader role,
    commands reach Althar's reader rules, which refuse direct and wrapped
    `flatpak-spawn` commands.
  - **The desktop's tray carries the edge's icon.** The manifest asks for
    `--talk-name=org.kde.StatusNotifierWatcher`, so the StatusNotifierItem
    Electron registers for the tray (edgeWindows.ts) reaches the desktop's
    watcher. Registered from a Flatpak, the item sits on the app's own unique
    bus name, so the Flatpak needs no own-name permission.
  - **The keyring, and KWallet itself.** Besides the host's secret service
    (`--talk-name=org.freedesktop.secrets`), the manifest asks for
    `--talk-name=org.kde.kwalletd6` and `--talk-name=org.kde.kwalletd5`: on
    KDE the sealing key is kept in KWallet directly, since through libsecret
    in a sandbox it would be made anew at every start (ADR-028). It talks to
    the wallet service only, and owns none of its names.
  - **git has no ssh-agent socket.** Althar's own pushes use the code-host
    connections it keeps. The manifest does not expose the person's ssh
    agent to the sandbox.
  - **The profile is the app's own.** In a Flatpak it is
    `$XDG_DATA_HOME/althar` = `~/.var/app/dev.althar.app/data/althar`, with the
    worktrees beside it; the CLI keeps `~/.local/share/althar`. Projects reach
    the app through the document portal.
- **Alternatives considered:** swapping the bundled bubblewrap for a bridge or
  relaying Codex's sandbox to the device — drops Codex's own integrity check
  and escapes the Flatpak's confinement; running bundled Codex with its
  sandbox disabled — codex-acp's only such mode also stops the approval
  requests, so Althar could not deny anything; documenting Codex as
  unavailable in a Flatpak — rejected when the person's own Codex is right
  there on the device.
- **Trade-off:** `--talk-name=org.freedesktop.Flatpak` is a broad permission:
  it lets the app run commands on the device, which is exactly what reaching
  the person's own tools needs. It is not a security boundary against a
  compromised app or agent. Reader rules refuse direct and wrapped
  `flatpak-spawn` shell commands, but cannot make the permission itself
  narrow. The CLI's and the Flatpak's profiles stay separate.
- **Revisit when:** codex-acp offers a mode that drops its sandbox and still
  asks the client; Codex itself speaks ACP, so the person's own install could
  be the ACP endpoint and the bridge would carry ACP alone; Flatpak permits
  nested user namespaces; or Althar's pushes learn to run git itself on the
  device.
