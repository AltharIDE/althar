# Downloads: a canvas in every format

Committed desktop canvas downloads in `01bf6fdd1`.

The window calls `host.canvases.download(request: CanvasDownload)`. It resolves to `{ kind: 'saved', path }`, `{ kind: 'cancelled' }`, or `{ kind: 'failed', why }`. The IPC validates the sender, version, format, and diagram payload. [Preload](/Users/balazs/Charrette/althar/.helpers/prototype-artifacts-for-design-engineers/hlp_01a200f5237d7861aa3ebc2cc4dcbda0/althar/apps/desktop/src/preload/preload.ts:398) · [IPC](/Users/balazs/Charrette/althar/.helpers/prototype-artifacts-for-design-engineers/hlp_01a200f5237d7861aa3ebc2cc4dcbda0/althar/apps/desktop/src/main/canvases/ipc.ts:37)

- **Source** copies the entry byte for byte. **Files** copies the version into a new, safely named folder.
- **SVG** saves the validated Mermaid drawing. **PNG** renders SVG and Mermaid at 2×, HTML at 1440 px wide up to 20,000 px tall, and boards at their declared sizes. Multiple board PNGs go under `<canvas>/<page>/<board>.png`.
- **PDF** prints HTML with backgrounds and puts every board in a single PDF, one page per board at its declared size. [Download implementation](/Users/balazs/Charrette/althar/.helpers/prototype-artifacts-for-design-engineers/hlp_01a200f5237d7861aa3ebc2cc4dcbda0/althar/apps/desktop/src/main/canvases/download.ts:242)

All 37 targeted tests passed. All 11 changed files passed `vp check --deny-warnings`. The full desktop check is blocked by four missing artifact API handlers in the existing [client test fixture](/Users/balazs/Charrette/althar/.helpers/prototype-artifacts-for-design-engineers/hlp_01a200f5237d7861aa3ebc2cc4dcbda0/althar/apps/desktop/tests/client.test.ts:228). Native dialogs and rendered PNG/PDF output remain unverified in Electron.

Its work is kept as commit 01bf6fdd1710 (refs/althar/helpers/task_01a2000ac8547cd39d7b03fc6f7bfd00/hlp_01a200f5237d7861aa3ebc2cc4dcbda0), never pushed. Bring it into your worktree with `git cherry-pick --no-commit e996c9faec99..01bf6fdd1710`, settling any conflict as you do with main, then commit it as yours.
