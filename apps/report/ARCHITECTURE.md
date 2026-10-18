# @althar/report — Architecture

A Cloudflare Worker that turns a problem report from the app into an issue in Linear. The repository's [ARCHITECTURE.md](../../ARCHITECTURE.md) sets the general engineering target.

- **Owner:** Repository maintainers
- **Consumer:** the desktop app's main process, which sends a report when the person asks it to.
- **Dependency direction:** depends on nothing but the Workers runtime and Linear's GraphQL API. No other package imports it, and it imports none of the workspace's.

## What it holds

| Module | What it does |
| --- | --- |
| `index.ts` | The fetch handler: the route, the configuration, the checks in order, and the answers |
| `report.ts` | Reads the request: the body held to 8 MB, the form, the report checked field by field, and the files |
| `limits.ts` | The `Limiter` the handler counts with, and the adapter over a Rate Limiting binding |
| `linear.ts` | The GraphQL calls: the triage state, the label (found or made), uploads, and the issue |
| `describe.ts` | The issue's title and description |
| `values.ts` | Checks for values whose shape isn't known yet |
| `testing/fakeLinear.ts` | A fake Linear and its storage, for the tests and `bun run fake-linear`. Not bundled |

## The API: `POST /reports`

The app sends `multipart/form-data` with these fields:

| Field | Kind | Rules |
| --- | --- | --- |
| `report` | Text, required | The JSON below, at most 256 KiB |
| `screenshot` | File, optional | `image/png` or `image/jpeg`, and its first bytes must say so; at most 4 MiB |
| `logs` | File, optional | `text/plain` (a charset is fine), at most 2 MiB. An empty file counts as none |

The whole request is at most 8 MiB. A larger `Content-Length` is turned away before the body is read; a body without one is read until it passes 8 MiB, then cancelled. Either way the answer is 413.

The report, version 1:

```json
{
  "version": 1,
  "installId": "0f6c2a8e-3b1d-4c5e-9a7f-2d4e6b8c1a3f",
  "text": "What happened, in the person's words",
  "email": "ada@example.com",
  "app": { "version": "0.4.2", "os": "macOS 26.5", "arch": "arm64", "electron": "44.5.0" },
  "context": { "screen": "task", "projectId": "proj_7Hq2", "taskId": "task_19xk", "threadId": "thr_a81", "about": "Stuck: Implement" },
  "agents": [{ "id": "claude-code", "name": "Claude Code", "version": "2.1.263", "adapter": "0.88.0", "signIn": "signed_in" }],
  "migrations": { "count": 18, "last": "0018_questions" },
  "errors": ["2026-10-11T09:12:03Z error turn failed: ProviderTimeout after 600s"]
}
```

| Field | Rules |
| --- | --- |
| `version` | `1` |
| `installId` | A lowercase UUID v4 |
| `text` | 1 to 20,000 characters once the space around it is trimmed |
| `email` | An email address of at most 254 characters, or null |
| `app.version`, `app.os`, `app.electron` | One line of at most 64 characters, not blank |
| `app.arch` | Letters, digits and `_`, at most 16 |
| `context.screen` | An id: letters, digits, `_` and `-`, at most 64 |
| `context.projectId`, `taskId`, `threadId` | An id, or null |
| `context.about` | One line of at most 200 characters, or null |
| `agents` | At most 10. Each: `id` an id; `name` one line of at most 64; `version` and `adapter` one line of at most 64, or null; `signIn` one of `signed_in`, `signed_out`, `unknown`, `not_installed` |
| `migrations` | `count` a whole number from 0 to 100,000; `last` an id, or null |
| `errors` | At most 50 strings of at most 500 characters each, masked by the app before sending |

"One line" means no control characters. A field that may be null may also be left out. Fields the contract doesn't name are ignored.

The answers are JSON:

| Status | Body | When |
| --- | --- | --- |
| 201 | `{ "ok": true }` | The issue was made |
| 400 | `{ "ok": false, "error": "…" }` | The form can't be read, the report breaks a rule (the error names the field), or a file is the wrong type |
| 404 | the same | Any other path |
| 405 | the same, with `Allow: POST` | Any other method |
| 413 | the same | The request, the report field, the screenshot or the logs is over its cap |
| 415 | the same | The body isn't `multipart/form-data` |
| 429 | the same, with `Retry-After: 60` | Over the per-IP or the per-install limit |
| 500 | the same | The Worker isn't configured (the error names what is missing), or something unforeseen failed |
| 502 | the same | Linear failed at some step |

**Compatibility.** The Worker reads every version 1 report, as this document describes it, for as long as any released app sends them. Adding an optional field is not a new version: the Worker ignores fields it doesn't know, so the app can send one first. Tightening a rule, removing a field or changing what one means takes `version: 2`, which the Worker learns to read before any app sends it, while it goes on reading version 1. The answers' statuses and the `ok` field are part of the contract; the error messages are for people and may change.

## State and data flow

1. The route and method, then the configuration (`LINEAR_API_KEY`, `LINEAR_TEAM_ID`, an http or https `LINEAR_API_URL`, both rate limits bound).
2. The content type and the declared length, then the per-IP limit, before any of the body is read.
3. The body, read with the 8 MiB cap, then the form, the report and the files.
4. The per-install limit, keyed by `installId`.
5. Linear: the team's triage state if Triage is on, then the label in the team, else the workspace's, else made in the team. Both ids are kept in module scope for the isolate's life; a failed `issueCreate` forgets them.
6. Each file: `fileUpload`, then a `PUT` of its bytes to the address Linear signed, with `Content-Type`, `Cache-Control` and every header Linear handed out.
7. `issueCreate`: the title is the text's first line, at most 80 characters (cut at a word, with "…"); the description is the text in full, a rule, a line per fact, the screenshot, a link to the logs and the last errors in a fenced block. Values from the app are escaped or put in code spans.

The Worker keeps nothing of the report. What it sends stays in Linear: the issue, the files, and the reply address in the description, which everyone who can see the Development team's issues can read.

## Trust boundaries

- **The endpoint is public.** Anyone with the address can post. Every field is checked at runtime before use, and nothing from the request reaches Linear except as checked text in the title and description, or as checked files.
- **The person's text is posted as they wrote it**, as Markdown. Links and images in it render in Linear; an image from another host loads when the issue is viewed. Whoever triages treats a report's content as untrusted.
- **The API key never leaves the Worker** except in the `Authorization` header of calls to `LINEAR_API_URL`. Uploads go to Linear's signed storage address without it. No answer carries it or any configuration value.
- **Linear's answers are checked** before use: upload addresses must be http or https, headers must be names and values a request can carry.
- **What is logged**, with `console.error` into Workers Logs: the step that failed with the HTTP status and Linear's error codes, and Linear's own words for every call but `issueCreate` (an error about the issue may quote its input); a missing setting by name; an unforeseen error or a failed rate limiter by its kind. Never the API key, the person's text, their address, the install id or the IP address. Cloudflare's own invocation log records each request's method, path and status besides.

## Failure modes

- **Linear down, slow or refusing.** Each call times out (15 s for GraphQL, 30 s for an upload) and any failure answers 502, after which the app can send the report again.
- **A failure after the uploads.** The files stay in Linear's storage, linked from nothing.
- **Triage turned off, or the label deleted, after the ids were cached.** If Linear refuses the stale id, that report gets 502 and the cache is forgotten, so the next one looks again.
- **A rate limiter failing.** The report goes through and the failure is logged: a lost report costs more than a minute without a limit.
- **Missing configuration.** 500, naming what is missing, before any call to Linear.

## Checks

- `bun run check`: format, type-aware lint and type checks.
- `bun run test:coverage`: the handler against the fake Linear and fake rate-limit bindings, on Node's Request, FormData and File, gated at 90% of lines and branches. `src/testing` is test tooling and not counted.
- CI runs both (`.github/workflows/report.yml`). Running the Worker for real is by hand: `bun run fake-linear` and `bun run dev`, as the README says.

## Gaps

- **The limits are per minute only.** There is no daily cap, and Cloudflare counts per location and approximately.
- **Anyone with the address can post.** The install id is whatever the sender says, so the per-install limit only slows an honest app that loops; the per-IP limit is the real one. Junk lands in Triage. The way forward is a token the app proves it holds, once there is something to sign it with.
- **A retried report can make a second issue**, if the app sends it again after a 201 it never received. An optional `reportId` (a UUID) in version 1, passed to `issueCreate` as the issue's `id`, would make a retry harmless.
- **Two isolates' first reports can both make the label**, if they arrive together before it exists. Making the label by hand before the first deploy avoids it.
- **Linear's API is exercised against a fake.** The calls follow Linear's documented schema (including `eqIgnoreCase` in the label lookup), but no request has gone to Linear itself yet. The first real report confirms them.
- **CI doesn't build the Worker's bundle.** `wrangler dev` bundles it locally; a `wrangler deploy --dry-run` step in CI would catch a bundling failure before deploy.
