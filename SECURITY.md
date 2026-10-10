# Security

Althar runs coding agents on your machine, with your accounts, your tokens and your repositories. We take problems in that seriously.

## Reporting a problem

Please don't open a public issue. Report it privately through GitHub instead: on the repository's **Security** tab, choose **[Report a vulnerability](https://github.com/AltharIDE/althar/security/advisories/new)**.

Tell us what you found, how to reproduce it, and what someone could do with it. We'll acknowledge the report within three working days, keep you told as we fix it, and credit you when the fix ships, unless you'd rather we didn't.

## What's in scope

Anything in this repository, in particular:

- how Althar stores and uses tokens for agents, code hosts and trackers
- what agents can do without asking, and whether project rules hold
- the boundary between the app's window, its runtime and the agents it starts
- the packaged app and its updates

Problems in the agents themselves (Claude Code, Codex, OpenCode) belong with their own projects. If you're not sure, report it to us and we'll pass it on.

## Supported versions

Althar is early. Fixes land on `main` and in the next release; older releases aren't patched.
