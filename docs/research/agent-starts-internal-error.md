# Why every Claude Code start said "Internal error" on 24 November 2026

On 24 November 2026, from Althar's start at 19:54 until a restart at 20:00,
every Claude Code start on a Mac failed with "Claude Code couldn't start.
Internal error.": coordinator turns, leads, answering stuck steps, reading the
model list. Each attempt had an adapter process of its own, and each reached
`prepare-query` in `agents.log` before its `session/new` failed. The restart
seemed to fix it. It didn't: an install finished in between.

## What happened

```mermaid
sequenceDiagram
  participant Install as bun install (19:54:03)
  participant Store as node_modules/.bun
  participant Adapter as claude-agent-acp 0.110.1
  participant Old as Claude Code 2.1.326 (hoisted)
  Install->>Store: links Agent SDK 0.3.330 and its platform package's folder
  Note over Store: the 364 MB platform package for 0.3.330 isn't there yet
  Adapter->>Store: resolve @anthropic-ai/claude-agent-sdk-darwin-arm64/claude
  Store-->>Adapter: not beside the SDK: Node looks further up, finds 0.3.326
  Adapter->>Old: claude ... --initialize-fields=settings
  Old-->>Adapter: error: unknown option '--initialize-fields=settings' (exit 1)
  Adapter-->>Adapter: session/new fails: "Internal error", reason in data.details
  Note over Install,Store: 19:58:50: the 0.3.330 program arrives; the 20:00 restart starts cleanly
```

1. **Two versions of the adapter in one repository.** #1184 moved the
   desktop app and the provider adapters to claude-agent-acp 0.110.1 (Agent SDK
   0.3.330) and codex-acp 2.10.0 (Codex 0.171.0), but `apps/host` and
   `apps/cli` still pinned 0.108.0 (SDK 0.3.326) and 2.7.0 (Codex 0.166.0). Bun
   hoists one copy of each package to `node_modules/.bun/node_modules`, and it
   hoisted the older SDK's program, Claude Code 2.1.326, and Codex 0.166.0.
   Those two packages also ran their adapters without Althar's patch, which
   is keyed to the new versions.
2. **An install linked the new SDK before its program was there.** Bun's
   cache shows `@anthropic-ai/claude-agent-sdk@0.3.330` and
   `@openai/codex@0.171.0` unpacked at 19:54:03, and their platform packages,
   `claude-agent-sdk-darwin-arm64@0.3.330` (364 MB) and
   `codex@0.171.0-darwin-arm64`, only at 19:58:49 and 19:58:50. Until then the
   new SDK's own platform package wasn't in its folder.
3. **Node found the older program instead.** claude-agent-acp resolves the
   program from the SDK's folder; not finding it there, Node looks further up
   and found the hoisted 2.1.326. That older Claude Code doesn't know
   `--initialize-fields=settings`, which SDK 0.3.328 began sending, and exits
   at once. Codex had the same exposure through `@openai/codex`'s launcher.
4. **Althar dropped the reason.** The ACP SDK answers anything an adapter
   throws as `Internal error` with the reason in `data.details`:
   `Claude Code process exited with code 1. stderr: error: unknown option
   '--initialize-fields=settings'`. Althar kept only the message, so both the
   thread and `runtime.log` said "Internal error".

It was reproduced on 24 November 2026 by hiding the 0.3.330 platform package
in a checkout: `session/new` with Althar's settings answered exactly that
error, and started cleanly once the package was back.

## What the hints were

- `[authStatus] discarding a probe that predates the latest auth change` is
  ordinary: each session's new settings bump the adapter's auth epoch, so the
  probe `initialize` started is dropped. The probe itself succeeded, which is
  what showed the older program was there and runnable.
- `claude auth status did not answer within 5 s` right after the restart was
  most likely the first launch of the newly unpacked 364 MB program, slow as a
  new program's first run on macOS is. That session started.
- Grok's `AuthRequired` fatals were its MCP client for the Cloudflare server,
  which wants an OAuth sign-in: a server's sign-in, not Grok's. Grok started.

## What changed

- Every package pins one exact version of each adapter, with its patch,
  checked by `packages/provider-adapters/tests/adapterPins.test.ts`.
- Before Claude Code or Codex starts, `bundledPrograms.ts` looks for its own
  program as its adapter finds it and checks it against its SDK's version: a
  missing or older copy is said as that, before anything is spawned, and read
  afresh at each start, so a program installed meanwhile is found next time.
- An error's data is read (`failures.ts`): an "Internal error" says what it
  carried, in the thread and in the log.
- Start failures gain the classes a person acts on differently: a version
  mismatch, a part missing, a crash on the way (`startFailure.ts`), each in
  words that say what to do (`words.ts`), never a bare "Internal error".
- A first start that crashed, or failed for no reason the person can act on,
  starts again once by itself, afresh, after Althar forgets the agent's
  sign-in as last checked and its models (`sessionConnections.ts`).

## Each integration

Each was checked for how it fails to start and what Althar holds of it.

| Agent | Comes from | How it fails to start, as checked | What it gets |
|---|---|---|---|
| Claude Code | Althar (claude-agent-acp, Agent SDK) | Missing or hoisted program; Commander's `unknown option`; "too old to read MCP servers"; signed out in Claude Code's words; a process that exited | The program check; all the classes; a retry for a crash |
| Codex | Althar (codex-acp, `@openai/codex`) | The same hoisting: Codex 0.166.0 was the copy hoisted. Its launcher's `Missing optional dependency`; clap's `unexpected argument`; panics | The program check (skipped where `CODEX_PATH` names the person's own Codex); all the classes |
| OpenCode | The person | 2.3.0's `Unrecognized flag: … in command opencode`; its older database (already said) | Version mismatch: update it |
| Grok Build | The person | clap's `unexpected argument`, as 1.0.77 says it; an MCP server's `AuthRequired` is no class | Version mismatch; MCP lines stay out of its class |
| Kimi Code | The person | Click's `No such command 'acp'` where it has no ACP command | Version mismatch: update it |
| Gemini CLI, Qwen Code | The person | yargs' `Unknown argument` | Version mismatch: update it |
| Mistral Vibe | The person | argparse's `unrecognized arguments` | Version mismatch: update it |
| Junie | The person | picocli's `Unknown option` | Version mismatch: update it |
| Copilot CLI | The person | Commander's `unknown option`, as 1.0.30 says it | Version mismatch: update it |
| Other ACP agents | The person | Whatever they say | The same classes, the retry, and their own first error line |

The agents the person installs are each started afresh at every start; only
Claude Code and Codex come with Althar, so only they can be at the wrong
version without the person having changed anything. Kimi Code, Gemini CLI,
Qwen Code, Mistral Vibe and Junie weren't installed where this was checked:
their lines are their parsers' own wording rather than recorded.
