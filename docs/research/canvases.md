# Canvases: how others let an agent draw something beside the conversation

Research for a canvas in Althar: a place beside the conversation where the
project's agents put what they make to look at and iterate on (a page, a
mockup, a diagram, a chart, a document, a picture), make new versions of it,
and hear what the person says about it. The design it led to is
[ADR-104](../decisions/proposed/104-a-project-keeps-canvases-its-agents-draw-and-the-person-comments-on.md).

Read on 9 November 2026. **Read in source** means the repository, spec or docs
page was read directly: `modelcontextprotocol/ext-apps` (HEAD 2026-11-04,
v2.0.4), `idosal/mcp-ui`, `agentclientprotocol/agent-client-protocol` and
`claude-agent-acp`, `a2ui-project/a2ui`, `ag-ui-protocol/ag-ui`,
`openai/openai-apps-sdk-examples`, `microsoft/vscode-docs`, Electron's docs,
`tldraw/tldraw`, `jgraph/drawio-mcp`, `excalidraw/excalidraw-mcp`,
`vercel-labs/json-render`, `assistant-ui/assistant-ui`, `marimo-team/marimo`,
and code.claude.com's docs and changelog (to 2.1.321). **(search)** marks what
was read only from search results, because the sandbox the research ran in
refused the site; its wording and dates may be a secondary source's. Leaked
system prompts are cited as leaks, never as documentation.

For each product, the same questions:

1. **What the agent emits:** HTML, a declarative tree, a file on disk, a
   document, tool calls.
2. **Where it is drawn,** and what holds it in: a frame, an origin, a process.
3. **Updates:** a new one per call, or one that is changed in place; versions.
4. **Feedback:** how what the person does reaches the model again.
5. **Scope:** whose it is (a call, a chat, a session, a project) and who else
   can reach it.

## At a glance

| Product | Emits | Drawn in | Updates | Feedback | Scope |
|---|---|---|---|---|---|
| MCP Apps | An HTML `ui://` resource a tool names | An iframe on an origin not the host's, CSP from the resource | A new view per tool call | `ui/message`, `ui/update-model-context`, `tools/call` | One tool call |
| Claude.ai artifacts (legacy) | Typed content in the reply (HTML, React, SVG, Mermaid, Markdown, code) | A sandboxed iframe on another origin | `update` (old/new strings) or `rewrite` | The person types | One chat |
| Claude Code Artifacts | A file on disk, published by path | A page on `claude.ai`, strict CSP | A version per publish; a publish on a stale copy is refused | Comments, sent to the publishing session it watches | A published page; editors can publish |
| Claude Code desktop | A running page | The Browser pane | Reload | Claude verifies by screenshots and clicks | A session |
| Claude Code IDE | `openDiff` and other calls to the editor's MCP server | The editor | Per call | The call **blocks** until the person accepts or rejects | A session |
| ChatGPT Apps SDK | MCP Apps resource (`openai/outputTemplate` alias) | Iframe on a dedicated sandbox origin | A new widget per call; `widgetState` per widget | `sendFollowUpMessage`, `callTool`, `widgetState` | One call |
| ChatGPT Canvas (removed May 2026) | A document or code file | First-party editor | Rewrite, or targeted edits on a selection | Comments on a selection | One chat |
| Codex app browser | A running page | In-app browser | Reload | Element or area comments, batched into a message | A thread |
| Gemini Canvas | A document or HTML/React | First-party editor and preview | Selection edits, versions | Highlight and ask; console errors | One chat |
| Antigravity | Markdown artifacts, screenshots, recordings | First-party viewers | The agent rewrites the artifact | Anchored comments, then Review or Proceed resumes the agent | A task |
| VS Code canvases (preview, Oct 2026) | An extension's UI with agent-callable actions | An editor tab | The agent calls actions | Direct use flows back through actions | Copilot's harness only |
| Cursor canvases | A `.canvas.tsx` file importing only `cursor/canvas` | First-party React kit | The agent rewrites the file | Canvas buttons run prompts; Design Mode sends an element | Outside the repository |
| A2UI | A declarative component tree and data model | The host's own components, no code | `updateComponents`, `updateDataModel` by JSON Pointer | `action` events and the whole data model | A surface |
| tldraw agent kit | Shape operations as tool calls | The tldraw canvas | Incremental | The person's selection, viewport, recent actions and a screenshot | A canvas |
| draw.io, Excalidraw MCP | XML or scene JSON | An MCP App, an editor tab or a file | Re-render | Editing, or the file | A call, or a file |
| Kiro, Augment Intent | Spec Markdown in the repository | The editor | Edit and Refine | The person edits the file | The repository |
| marimo pair, Jupyter AI | Cells (`.py`, `.ipynb`) | The notebook | Rewrite a cell, run it | The agent reads variables and outputs | A notebook |

## Anthropic and MCP

### MCP Apps

The MCP extension for interactive interfaces, `io.modelcontextprotocol/ui`,
from SEP-1865 (read in source). Stable as `specification/2026-01-26`; the
draft keeps moving (last change 4 November 2026, "relax double sandboxed
iframe architecture requirements", #717). Hosts at launch: Claude on web,
desktop and mobile, Goose, VS Code, ChatGPT; since then Postman, MCPJam,
LibreChat, Smithery and others.

- **A tool names its view.** `_meta.ui = { resourceUri: "ui://…",
  visibility?: ["model", "app"] }`. The resource's `mimeType` MUST be
  `text/html;profile=mcp-app`, its content a whole HTML document. A tool
  without `"model"` is kept from the agent; one without `"app"` is refused to
  the view.
- **What the model sees and what the view sees differ.** A result's `content`
  goes to the model; `structuredContent` and `_meta` go to the view and are
  "not added to model context".
- **The sandbox.** The host and the view "MUST have different origins"; the
  frame gets `allow-scripts allow-same-origin`; CSP is set by HTTP headers
  from a server "the Host controls", from the resource's `csp`
  (`connectDomains`, `resourceDomains`, `frameDomains`, `baseUriDomains`),
  and "MUST NOT allow undeclared domains". The default is `default-src
  'none'; script-src 'self' 'unsafe-inline'; …; connect-src 'none'`. The
  stable spec requires a double iframe (an outer proxy on another origin that
  builds the inner frame); the draft allows a single frame on a `blob:` URL,
  as Google's SafeContentFrame does.
- **Claude's host** nests "an iframe inside another iframe" on
  `{sha256(serverURL)[:32]}.claudemcpcontent.com`, asks Allow or Always allow
  per server, keeps `frameDomains` restricted, and on mobile uses a native
  web view with no camera, microphone or location.
- **The view and the host speak JSON-RPC over `postMessage`.**
  `ui/initialize` (the host returns its context: theme, about 36 CSS
  variables, fonts, display mode, size, locale), then the tool's input
  (`tool-input-partial` while it streams, `tool-input` once) and its result.
  The view may call `tools/call` and `resources/read`, send `ui/message`
  ("added to the conversation", which "also trigger[s] follow-ups"), set
  `ui/update-model-context` ("each request overwrites the previous context",
  which the host may hold for the next message), open links, ask for
  `inline`, `fullscreen` or `pip`, and report its size.
- **SDKs.** `@modelcontextprotocol/ext-apps` (MIT, the project moving to
  Apache-2.0) has the view's `App`, the server's `registerAppTool`, and
  `AppBridge`, a host-side class for embedding views. `@mcp-ui/client`
  (Apache-2.0) has `AppRenderer`. The repository says "There's no supported
  host implementation in this repo" beyond an example.
- **What is still open, and matters here:**
  - **One view per call.** #430: "the spec assumes a new view is rendered per
    tool call"; zoom, selection and edits are lost on the next call, and
    moving a frame between display modes destroys it. A `viewSessionId` is
    proposed (PR #295).
  - **No view without a call.** #672: "opening a standalone MCP App requires a
    no-op tool call".
  - **CSP gaps:** `unsafe-eval` (#199, three.js), `wasm-unsafe-eval` (#605),
    `frameDomains` (#387).
  - **No state of the view's own,** unlike the Apps SDK's `widgetState`: the
    migration guide says to use "localStorage, server-side state, etc."

**The fact that decides most for Althar:** the MCP client, which the spec
calls the host, is the agent (Claude Code, Codex), not Althar. Claude Code
renders no MCP Apps; its 2.1.281 changelog "Changed MCP resource lists … to
skip MCP Apps UI resources". `claude-agent-acp` doesn't forward `resourceUri`
or `_meta.ui`; a tool's output reaches it already turned into tool-result
blocks. No other ACP agent was found to forward them. So a view that one of
the person's MCP servers offers never reaches Althar. Althar sees its own
tools' calls, because it serves them.

### Claude.ai artifacts

- **Legacy chat artifacts** (no longer made since 16 September 2026) were
  typed content in Claude's reply: code, Markdown, a single HTML file (scripts
  "only … https://cdnjs.cloudflare.com"), SVG, Mermaid and React. They were
  changed with `update` (old and new strings, "fewer than 20 lines and fewer
  than 5 distinct locations") or `rewrite` (leaked prompt). Persistent
  storage (20 MB, text only), AI inside the artifact billed to the viewer, and
  MCP connectors inside artifacts on paid plans, each viewer with their own
  (help center).
- **Today's artifacts** are pages on a sandboxed `*.claudeusercontent.com`
  origin, private by default, with Docs, Slides and Design types.
- **When to make one instead of answering** (leaked prompt): "If the person is
  going to read the output and move on, Claude answers in a conversational
  reply"; a diagram that explains is drawn "inline in the conversation"; "If
  the output is something the person will keep, come back to, edit or share
  … Claude creates and publishes it as an artifact."
- **Imagine** (leaked prompt): `imagine_svg` and `imagine_html` stream
  fragments into an auto-sized frame, with the host's CSS variables and a
  `sendPrompt(text)` that "sends a message to chat as if the user typed it".
  "Text goes in your response, visuals go in the tool."

### Claude Code

Claude Code has four ways to show things, and each is a precedent for one
part of a canvas.

1. **Artifacts** (code.claude.com/docs/en/artifacts). This is the nearest
   precedent.
   - **Publishing.** The agent writes an `.html` or `.md` file (at most
     16 MiB) and publishes it by path with the `Artifact` tool, which can
     also take old and new strings to change it in place. The page lives at
     `claude.ai/code/artifact/<uuid>`.
   - **Versions.** "Each publish becomes a version." A publish built on a
     stale copy is refused, and the agent merges what it is handed
     (2.1.274).
   - **Comments.** Comments sent with "Send to Claude" or `@claude` reach the
     publishing session, which watches up to ten artifacts. The session
     answers on its own where the permission mode allows, at most 60 replies
     an hour.
   - **What the page can reach.** Scripts load only from five CDNs, fonts
     from Google Fonts, and `fetch` reaches only the page's own origin.
     Other powers are declared and asked for at publish: connectors, a
     shared database, downloads, "ask Claude", the viewer's identity, files.
   - **Needs.** A claude.ai sign-in.
2. **The desktop app's Browser pane.** It opens dev servers from
   `.claude/launch.json`, and Claude checks its own work there with
   screenshots, the DOM and clicks. An HTML path pressed in the chat opens
   in it too. Cloud sessions tell the app their port with
   `report_preview_port`.
3. **The IDE's MCP server.**
   - **Connection.** The editor extension serves MCP over `ws://127.0.0.1`
     on a random port. Its token is in `~/.claude/ide/<port>.lock` (mode
     0600) and comes back in a header.
   - **Visibility.** Only two of its tools are shown to the model; the rest
     are the CLI's own calls.
   - **Blocking.** `openDiff` **blocks** until the person saves or rejects,
     and returns `FILE_SAVED` or `DIFF_REJECTED`. The person's answer comes
     back as the tool's result.
4. **Mods** (2.1.286).
   - **What they draw.** A plugin draws a pane beside the transcript from
     declarative elements (Box, Text, Markdown, Button, Input, `Svg`, and
     `Client` for a region of one's own that posts events back).
   - **Limits.** No arbitrary HTML, and they aren't sandboxed.
   - **Channels** (research preview) are a server's notifications that
     reach the model as events.

### ACP

- **Content.** ACP's `ContentBlock` is "a superset of the MCP 2025-06-18
  `ContentBlock`": text, image, audio, `resource_link`, and an embedded
  `resource` (behind `embeddedContext`). It has no interface or artifact of
  its own, and no RFD or issue was found for one.
- **Its security guidance is against running what an agent writes:** "Clients
  **SHOULD NOT** run scripts from Agent content, and **SHOULD** disable or
  sanitize raw HTML when rendering Markdown", and "**SHOULD NOT**
  automatically run active content, such as diagram renderers".
- **What would help later.** MCP-over-ACP (an active RFD) lets a client
  serve MCP to the agent over the ACP connection. A client could then sit
  between the agent and the person's servers and see their views.

## Others

### OpenAI

- **Apps SDK** (read in source).
  - **What a tool returns.** It returns `structuredContent` for the model
    and `_meta` for the widget, and names an HTML template. ChatGPT
    implements MCP Apps and keeps `openai/outputTemplate` as an alias (the
    flat key mapping is in ext-apps' `migrate_from_openai_apps.md`).
  - **The widget's API.** `window.openai` gives `setWidgetState` (state
    kept per widget, which the model sees on later turns),
    `sendFollowUpMessage`, `callTool`, `requestDisplayMode`
    (`inline | pip | fullscreen`) and `notifyIntrinsicHeight`.
  - **Three ways back to the model:** a message, a call and state.
- **ChatGPT Canvas** (search). A document or code file beside the chat. The
  model was trained to "perform targeted edits when users explicitly select
  text… otherwise favoring rewrites". Suggest edits left comments on
  selections, applied one by one.
  - **Removed** from GPT-5.5 on 28 May 2026 for writing blocks in the chat,
    to complaints: "Canvas was a workspace. Writing Blocks are editable
    outputs inside a chat."
  - **The lesson:** people want a lasting thing they can come back to, not
    output that scrolls away.
- **Codex app's browser** (search, April 2026). It is "a shared view of
  rendered pages inside a thread, for previewing pages and attaching visual
  comments": pick an element, or Shift-select an area, comment, and send
  the comments together.

### Google

- **A2UI v1.0** (read in source, 8 June 2026). "Safe like data, but
  expressive like code": the agent asks only for components from the
  client's catalog.
  - **Messages.** `createSurface`, `updateComponents` (a flat list of
    components by id, streamed, missing ones drawn as placeholders),
    `updateDataModel` (JSON Pointer), `deleteSurface`.
  - **The catalog** is Text, Image, Row, Column, List, Card, Tabs, Modal,
    Button, CheckBox, TextField, ChoicePicker, Slider and a few more. It has
    no free HTML; charts and diagrams need components of the host's own.
  - **Feedback.** A button's `action` goes to the agent, with the whole
    data model if `sendDataModel` is set.
- **Gemini Canvas** (search). Documents and HTML/React previews beside the
  chat, changed by highlight-and-ask. It has versions to compare and revert,
  console errors shown, and sharing.
- **Antigravity** (official docs; finer points search).
  - **Artifacts.** The agent hands back a task list, an implementation plan,
    a walkthrough, screenshots and browser recordings.
  - **Comments.** The person comments on them, anchored to a passage, a line
    of the diff or a picture, "to steer the agent". "Once you have proceeded
    or left a review, Agent will continue its work."
  - **Review policy.** Request Review halts for approval; Always Proceed
    doesn't.
  - **Fixes.** The 7 August 2026 changelog fixes "whole-file comments landing
    on the first line".
  - **What it shows:** files the agent writes, comments anchored to them,
    gathered into one review that resumes the agent. Of everything read,
    this is the nearest to what this research is for.
- **Jules** closes on 31 December 2026, and Gemini CLI went to Antigravity's
  `agy` for individual users on 18 June 2026 (search). Neither had a canvas.

### Coding tools

- **VS Code** (read in source).
  - **Integrated browser.** It has "Add element to chat" (1.109), agent
    browser tools (`openBrowserPage`, `readPage`, `screenshotPage`,
    `clickElement`), comments on several elements sent together (1.132), and
    Mermaid in chat (1.121).
  - **MCP Apps** are drawn in chat since 1.109.
  - **Canvases** (preview, 1.142, 14 October 2026) are "an interactive
    interface… beside the chat, where you and the agent can inspect and
    update the same artifact". Each comes from an extension with actions the
    agent calls.
  - **Limit:** "Canvases aren't supported in Claude, Codex, Local harness
    sessions."
- **Cursor** (search).
  - **Canvases** (3.1, April 2026). The agent writes
    `~/.cursor/projects/<ws>/canvases/<name>.canvas.tsx`, importing only
    Cursor's own kit of tables, diagrams and charts. Canvases can be shared
    by link, and cloud agents make them too.
  - **The complaint** is that canvases live outside the repository.
  - **Design Mode** picks an element or area and sends it to the chat with
    its place in the code.
- **Lovable, v0, Bolt, Replit, Windsurf (now Devin Desktop)** (search). Each
  has a preview with an element picker, and comments or tweaks that go into
  the chat. v0's Apply makes a new version to diff or revert. Lovable pins a
  comment to an element; "Sending a comment thread to Lovable uses credits".
- **Warp, Conductor** (search). Comments on the diff are gathered and sent
  "in a single pass", Warp's to Claude Code, Codex and OpenCode alike.
- **Kiro and Augment Intent** (search). Specs are Markdown files in the
  repository (`.kiro/specs/<feature>/requirements.md`, `design.md`,
  `tasks.md`). Agents write them, and the person edits them.
- **Zed** draws Mermaid and pictures in its agent panel and runs agents over
  ACP, with no canvas. **Amp** draws charts, diagrams and clickable mockups
  in the thread ("Visualize This", October 2026, single source).

### Diagrams and whiteboards

- **tldraw's agent kit** (read in source). Every action is a tool call
  (create, update or delete shapes, align, move the agent's viewport). Each
  next request carries the person's selection and viewport, their recent
  actions, **a screenshot of the agent's view**, a simplified form of the
  shapes, and lints.
  - **The lesson:** the feedback is what the person picked and did, not only
    words. The agent sees what it drew.
- **Excalidraw** (read in source) has an official MCP App at
  `mcp.excalidraw.com`. **draw.io** (read in source) offers four routes:
  - an MCP App (`create_diagram`, from draw.io XML or Mermaid)
  - a stdio server that opens the editor
  - skills that write `.drawio` files, with exports that keep the XML inside
  - instructions that build links

  One producer, drawn inline, in an editor and as a file.
- **Figma's remote MCP** writes to the canvas (beta, March 2026); FigJam
  turns Mermaid into its own diagrams (search).
- **Miro** reports agents read boards more than they write them: "57% …
  Miro-to-code" against "41% code-to-Miro" (search).
  - **The lesson:** reading what the person drew matters as much as drawing.

### Notebooks

- **Jupyter.** Outputs are MIME bundles, and the front end picks how each is
  drawn. Jupyter AI v3 runs ACP agents with a Jupyter MCP server to edit
  and run cells (search). That is the same shape as Althar: ACP for the
  agent, MCP for the host's tools.
- **marimo pair** (read in source). It connects Claude Code, Codex and
  OpenCode to a running notebook, where the agent "can inspect variables and
  try code in a scratchpad before it commits changes to the notebook".
- **Observable Notebook Kit** keeps a notebook as a local `.html` file
  (search): the artifact as a file a person can read.

## Drawing what an agent wrote, safely, in Electron

From Electron's security guide and protocol API (read in source):

- **Remote content.** "To display remote content, use the `<webview>` tag or a
  `WebContentsView` and make sure to disable the `nodeIntegration` and enable
  `contextIsolation`." The `webview` tag itself is discouraged.
- **Checklist.** Of the guide's list, these apply: the process sandbox;
  `setPermissionRequestHandler`; CSP sent as HTTP headers; limiting
  navigation and `setWindowOpenHandler`; checking every IPC sender; "Avoid
  usage of the `file://` protocol and prefer usage of custom protocols".
- **Custom protocols.** `protocol.registerSchemesAsPrivileged` with
  `standard` and `secure`, then `protocol.handle`.
  - **Origins and headers.** A standard scheme has real origins
    (`scheme://host`), so a host per artifact is an origin per artifact.
    The handler writes every response header, CSP among them.
  - **Per session.** A `Session` has its own `protocol`, so a scheme can be
    handled in one partition and nowhere else.
- **Three ways, compared:**
  - **A sandboxed iframe with a null origin** is simplest. It loses storage,
    forces `postMessage(…, "*")` and sends `Origin: null`. Chrome has isolated
    such frames since 127, but grouped by the origin that made them
    (assistant-ui's docs, not checked in Chromium).
  - **An iframe on an origin of its own per artifact** is what MCP Apps,
    the Apps SDK's `widgetDomain` and SafeContentFrame do. In Althar's window
    it would share the renderer process that holds Althar's bridge, unless
    site isolation splits it. How Chromium assigns processes to a custom
    scheme's hosts wasn't checked.
  - **A `WebContentsView` in a session of its own** is heavier, but it is its
    own process, with its own permission handler. Althar's pages beside the
    conversation already work this way
    ([ADR-100](../decisions/desktop-app.md#a-web-page-beside-the-conversation)).
- **Libraries.**
  - Mermaid's `securityLevel: 'strict'` runs no script.
  - Vega-Lite is declarative JSON, with `vega-interpreter` for a CSP without
    `eval`.
  - Sandpack bundles React in a frame on its own bundler domain, to
    self-host for local use.
  - WebContainers need cross-origin isolation and, as understood, a
    commercial licence for production.
  - tldraw's SDK needs a licence key for production, as understood.
  - Excalidraw is MIT.

## Patterns and lessons

### What works

1. **Files the agent writes, then publishes.** Claude Code's Artifacts,
   Cursor's canvases, Antigravity, Kiro and draw.io's skills all do it.
   - **It works with every agent's own tools.** Every agent edits files
     well, with its own targeted edits, so no payload grows with every
     change.
   - **The alternative costs more.** Content inside a tool's arguments
     (legacy artifacts, Imagine, OpenGenerativeUI) has to be sent whole, or
     edited with a second edit language.
2. **A version per publish, and a stale copy refused** (Claude Code's
   Artifacts). Versions to compare and revert are everywhere: Gemini, v0,
   ChatGPT Canvas.
3. **One origin per artifact, the host's origin never,** with CSP the host
   writes (MCP Apps, the Apps SDK, SafeContentFrame, Claude's
   `claudemcpcontent.com`).
4. **Comments pinned to an element, a passage or an area, gathered and sent
   as one message.** Codex, VS Code, Lovable, Warp, Antigravity, Cursor and
   Windsurf all do it, and none streams comments to the agent live.
5. **State as a second way back**: the Apps SDK's `widgetState`, A2UI's
   data model, MCP Apps' `ui/update-model-context`, tldraw's selection. A
   form or a set of choices on the canvas reads better as data than as
   prose.
6. **The agent sees what it drew**: tldraw's screenshot of the agent's view,
   Claude Code's Browser pane, VS Code's and Codex's screenshot tools,
   Gemini's console errors. Drawing goes back into the loop, not only to the
   person.
7. **The host's look given to the content**: MCP Apps' CSS variables, Imagine's,
   Cursor's kit.

### What to avoid

1. **A new view per call** (MCP Apps #430, #672). What the person is
   iterating on has to stay one thing that changes.
2. **A tool call that blocks on the person** (`openDiff`). Althar learnt the
   same with helpers: a held turn hides the answer and holds the person's
   next message
   ([ADR-087](../decisions/proposed/087-a-lead-starts-helpers-on-any-agent-in-copies-of-their-own.md)).
3. **Output that scrolls away** (ChatGPT's writing blocks).
4. **A canvas only one agent can use** (VS Code canvases only in Copilot's
   harness, MCP Apps only in hosts that render them). Althar's own tools
   reach every agent it runs.
5. **Canvases only the session that made them knows.** Claude Code's
   Artifacts are watched by the session that published them. Cursor's sit
   per workspace, outside the repository.

### What this means for Althar

- **Althar's own MCP tools are the only route that works on every agent.**
  Althar serves them, so it knows every call without the agent forwarding
  anything.
- **Althar already has most of the parts:**
  - a sandboxed `WebContentsView` per owner, with point and comment and an
    overlay in an isolated world (ADR-100)
  - an offscreen `screenshot` (ADR-057)
  - the artifact store by digest (ADR-020)
  - the workbench (ADR-053)
  - Mermaid in Markdown
  - comments gathered into the composer
  - `.althar/` folders git ignores (ADR-064)
- **MCP Apps isn't the format for Althar's own canvases.** Its sandbox rules
  are worth meeting, so that a view from the person's MCP servers could be
  drawn the same way once something (MCP-over-ACP) lets Althar see one.
- **A declarative catalog (A2UI, json-render) is safe but narrow.**
  Prototypes and charts need HTML, which models write best.

### Not found

- Any ACP agent that forwards MCP Apps views to its client.
- Whether Claude Code will draw MCP Apps (2.1.281 skips their resources).
- How Chromium gives processes to a privileged custom scheme's hosts.
- An official date for Claude's AI-powered artifacts. The page read was dated
  25 July 2025, with earlier update notes.
- Cursor's, Codex's, Antigravity's and Lovable's docs could not be read
  directly. What they say here is from search results.
