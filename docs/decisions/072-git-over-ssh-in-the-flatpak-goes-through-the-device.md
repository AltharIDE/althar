# ADR-072: git over SSH in the Flatpak: Althar's own goes through the device's ssh, and nothing asks

- **Status:** Accepted
- **Date:** 2026-10-24
- **Amends:** [ADR-027](027-what-the-flatpak-reaches.md) ("git has no
  ssh-agent socket"). Keeps [ADR-011](011-own-connectors-for-hosts-and-trackers.md)
  and makes [ADR-016](016-push-without-a-connection.md)'s push "with the
  person's SSH agent, as a terminal would" true in the Flatpak.
- **Owner:** Repository maintainers
- **Context:** In the Flatpak (dev.althar.app) git over SSH didn't work. The
  sandbox has no `~/.ssh`, so no keys and no known hosts: `ssh -o
  BatchMode=yes -T git@github.com` said "Host key verification failed".
  Without BatchMode, ssh asked the host-key question through
  `/usr/bin/ksshaskpass`, which isn't in the sandbox, or on the terminal
  Althar was started from. Started from a terminal, the coordinator folder's
  fetch of `origin` (`freshCopy`) waited there until someone typed "yes".
  Started from the desktop, it waited for good, and the person couldn't
  message the coordinator at all. Pushes, pull requests and task fetches over
  SSH remotes failed the same way. ADR-027 had said git has no ssh-agent
  socket in the Flatpak, and pointed under "Revisit when" at running
  Althar's pushes on the device. ADR-011 keeps the person's credentials,
  their SSH agent among them, away from agents.
- **Decision:**
  - **Althar's own git never waits on a question, on any platform.** Each
    git command Althar runs itself (`packages/runtime/src/git.ts`) starts
    in a session of its own, so it has no terminal: OpenSSH asks for a host
    key on the terminal, not on stdin. Its stdin is what Althar gives it, or
    closed. `GIT_ASKPASS` and `SSH_ASKPASS` are taken out of its
    environment, and it runs with `SSH_ASKPASS_REQUIRE=never`,
    `GIT_TERMINAL_PROMPT=0` and `GCM_INTERACTIVE=never`. When its time is
    up, the whole process group ends, ssh with git: an ssh left behind
    would keep git's output open, and Althar would wait on it. The
    coordinator's fetch of `origin` gets 15 seconds; after that, or on any
    failure, the copy is made from the last fetch, as offline.
  - **In the Flatpak, Althar's own SSH git runs the device's ssh.** For
    Althar's own git commands only, `git.ts` sets `GIT_SSH_COMMAND` to
    `/app/bin/althar-host-ssh` (`flatpak/host-ssh.sh`). git stays in the
    sandbox. Only its ssh transport runs on the device, through
    `flatpak-spawn --host`, and git's pack protocol crosses on stdin and
    stdout. The device's ssh has the person's agent, their keys, their
    `~/.ssh/config` (aliases, `IdentityFile`, `ProxyJump`) and their
    `~/.ssh/known_hosts`, as a terminal's would. It runs with
    `BatchMode=yes`, `StrictHostKeyChecking=yes`, `ConnectTimeout=15` and
    `SSH_ASKPASS_REQUIRE=never`, in `/`. It takes the session's
    `SSH_AUTH_SOCK`, or else the usual sockets in the runtime directory
    (systemd's `ssh-agent.socket`, GNOME's `gcr/ssh` and
    `keyring/ssh`). This covers fetches, pushes, `ls-remote` and the
    coordinator's fetch of `origin`. An HTTPS remote stays in the sandbox
    with the connection's header in git's environment, never in a
    `flatpak-spawn` argument.
  - **The sandbox gets neither the agent's socket nor `~/.ssh`.** The
    manifest has no `--socket=ssh-auth`. That permission puts the agent's
    socket at `/run/flatpak/ssh-auth` for every process in the sandbox:
    the bundled Claude Code adapter, its sessions and every command they
    run. Taking `SSH_AUTH_SOCK` out of an agent's environment wouldn't hide
    a socket at a known path. Nothing the rules could see would stand
    between an agent and the person's keys: `ssh`, `git push`, or a socket
    opened by any program.
  - **ssh in the sandbox trusts the pinned code hosts and never asks.**
    `/app/bin/ssh` (`flatpak/ssh.sh`) comes first on the sandbox's PATH, so
    git and any command an agent runs get it. It runs the runtime's ssh with
    `BatchMode=yes`, `StrictHostKeyChecking=yes`, `ConnectTimeout=15`,
    `UserKnownHostsFile=/dev/null` and Althar's pinned file as
    `GlobalKnownHostsFile`. It has no agent, so an agent's `git fetch`
    over SSH gets past the host check and is refused at sign-in. That is
    ADR-011's boundary, and it fails in under a second instead of hanging.
  - **Well-known code hosts are pinned, from their vendors' documents.**
    `flatpak/known_hosts`, installed as
    `/app/share/althar/ssh/known_hosts`, holds github.com,
    gitlab.com, bitbucket.org, codeberg.org and ssh.dev.azure.com, with
    `[ssh.github.com]:443`, `[altssh.gitlab.com]:443`,
    `[altssh.bitbucket.org]:443` and `vs-ssh.visualstudio.com`, which serve
    the same keys. Those are the hosts of Althar's code-host connections
    (GitHub, GitLab, Bitbucket Cloud; Bitbucket Data Center is the team's
    own host) plus Codeberg and Azure DevOps. The trackers (Linear, Jira,
    Trello) have no SSH. Each key comes from the vendor's published
    `known_hosts` lines where it publishes them (GitHub's API, GitLab's
    docs, `bitbucket.org/site/ssh`). For Codeberg and Azure DevOps, whose
    docs give only fingerprints, it comes from a scan. Every key was checked
    against the SHA256 fingerprints on the vendor's own page, cited in the
    file. `apps/desktop/tests/knownHosts.test.ts` holds those fingerprints
    and fails on any key that isn't one of them. Nothing runs `ssh-keyscan`
    at build time: a key changes only by hand, against those pages. The
    device's ssh reads the same file where the device sees the app
    (`app-path` in `/.flatpak-info`), beside its own system files.
  - **An unknown host fails at once, saying what to do. Althar doesn't ask
    in its own UI.** Through the device, ssh's "Host key verification
    failed" is followed by Althar's sentence: the key isn't one Althar
    trusts by default nor in the person's `~/.ssh/known_hosts`, so check
    it and accept it once from a terminal (`ssh -T <host>`). In the sandbox
    it says the host isn't one Althar trusts by default. A question in
    Althar's UI would need Althar to show a fingerprint and write the
    answer into `~/.ssh/known_hosts`: Althar writing the person's home
    folder, which the coordinator's sandbox denies (ADR-058) and nothing
    else of Althar's does. Or it would keep a second, Althar-only list of
    accepted hosts. The question would come from a fetch before the
    coordinator's turn, or from a push in the background, where nobody is
    looking to compare a fingerprint, and a yes/no there trains a click.
    A terminal is where the person checks a host key now, and what they
    accept there counts for Althar and every other tool.
  - **The person's own `~/.ssh/known_hosts` counts, without opening
    `~/.ssh`:** the device's ssh reads it where it is, as it is now. No copy
    goes into the app. A copy read once goes stale when the person accepts
    a new host, and it would give agents in the sandbox the list of hosts
    the person uses. ssh in the sandbox doesn't read it: it can't sign in
    anywhere, so it gains nothing by trusting more hosts.
  - **Agents don't reach the device's ssh.** `GIT_SSH_COMMAND` is set only
    in the environment of Althar's own git commands, never in
    `process.env`, so no session inherits it. The rules refuse a command
    that runs `althar-host-ssh` as a program, for leads and readers alike,
    as they refuse `flatpak-spawn`. They also refuse a line that sets
    either one for git to run, now or for a later plain `git fetch`: as a
    variable's value (`GIT_SSH_COMMAND=…`, `GIT_CONFIG_VALUE_0=…`, or `X=…`
    for a later `$X`, a value a substitution finds included:
    `"$(command -v althar-host-ssh)"`), with `-c` (`core.sshCommand=…`, an alias), on a line
    that sets `GIT_SSH*` or `GIT_CONFIG_*` to anything, with `git config`,
    or by writing into a git folder or config file. A line that only names
    it, a search or a commit message, even beside those settings' names,
    isn't refused for it, nor a substitution quoted in a `git commit` or
    `git tag` message in single quotes, which the shell leaves as text
    (unless the line hands it to `sh -c` or `eval`). Such a message stays
    on one line, and its start is read past comments, `$'…'`, escaped
    blanks and lines joined by a trailing `\` as the shell reads them, so a comment or a heredoc can't fake one to hide the
    lines after it. Other single-quoted
    text counts as source something may run (`python3 -c '…'`,
    `echo '…' | sh`): the programs that run it have no end. A git config
    edited with the file tools sits outside the task's worktree, in the
    repository's git folder, where the rules for outside the worktree
    apply. An environment variable Althar sets
    outranks a repository's `core.sshCommand`, so a config an agent wrote
    in a task's repository doesn't choose the ssh Althar's fetch runs.
- **Alternatives considered:**
  - **`--socket=ssh-auth`, with `SSH_AUTH_SOCK` scrubbed from agents**, as
    the person first suggested. It is simple, and only ssh would need the
    pinned file. But the socket sits at a fixed path every process in the
    sandbox can open, Claude Code's sessions among them. ADR-011 would hold
    only as long as no agent typed that path.
  - **Run the whole git command on the device.** It needs git on the device
    too, and paths translated for the document portal and for linked
    worktrees, as `codex-host.sh` does. Running only ssh there needs
    neither: ssh never touches the repository.
  - **Copy `~/.ssh/known_hosts` into the app once, through
    `flatpak-spawn`.** It is stale from the next host the person accepts,
    and it puts their hosts in reach of agents. The device's ssh reads the
    real one.
  - **Ask about an unknown host in Althar's UI.** See the decision above.
  - **Set `BatchMode` and `ConnectTimeout` through `GIT_SSH_COMMAND` on
    every platform.** It would override a person's own `core.sshCommand`
    (1Password's agent, a key for one host). Outside the Flatpak, git runs
    the ssh the person's would, and having no terminal and no askpass is
    what keeps OpenSSH from asking: BatchMode's effect on prompts. git's
    own timeout stands in for ConnectTimeout.
- **Trade-off:**
  - `--talk-name=org.freedesktop.Flatpak` still isn't a boundary (ADR-027).
    An agent in the sandbox that got past the rules could run
    `flatpak-spawn --host ssh` itself, as it could before this change, for
    example from a script it wrote and then ran, or under a name the rules
    don't read as the bridge's, such as a glob. Reading command text, the
    rules catch the plain ways of naming it, not every spelling. Nor can
    `althar-host-ssh` check that Althar's own git called it: everything it
    could check (the calling process, its parent, a token in the
    environment) an agent running as the same user in the same sandbox can
    imitate or read in `/proc`. So the rules are the guard, as they are for
    `flatpak-spawn`, and this adds no way in that they can't see. The
    socket would have added one.
  - Signing in depends on the device. Its ssh must be installed. Its agent
    must be in the session's environment or at one of the usual sockets.
    A key that needs a passphrase and isn't in an agent fails, since
    nothing asks. A device that can't be reached fails with a sentence
    saying how to give the permission.
  - ssh's own messages from both wrappers are shown when it ends, not as
    they come, so Althar can add its sentence. git sends a remote's
    progress over the protocol, so a fetch shows nothing later than it did.
  - Pinned keys are as fresh as the build. A vendor that rotates its key
    breaks the sandbox's ssh until Althar's file changes. The device's ssh
    still has the person's own known hosts.
- **Revisit when:** Flatpak offers a socket a single command can be given;
  an SSH agent portal appears; or people often need hosts nobody pinned, so
  an answer inside Althar is worth its cost.
