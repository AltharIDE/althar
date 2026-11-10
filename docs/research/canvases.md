# Canvases: how others let an agent draw something beside the conversation

Research for a canvas in Althar: a place beside the conversation where the
project's agents put what they make to look at and iterate on (a page, a
mockup, a diagram, a chart, a document, a picture), make new versions of it,
and hear what the person says about it. The design it led to is
[ADR-104](../decisions/proposed/104-a-project-keeps-canvases-its-agents-draw-and-the-person-comments-on.md).

Read on 9 November 2026. **Read in source** means the repository, spec or docs
page was read directly. Each repository is linked at the commit read, and each
claim links the file and lines it comes from. The repositories:
[`modelcontextprotocol/ext-apps`](https://github.com/modelcontextprotocol/ext-apps/tree/19256f52cad5517ba8272581ed2e11d6a81273d5) (HEAD 2026-11-04,
v2.0.4), [`idosal/mcp-ui`](https://github.com/idosal/mcp-ui/tree/2b10490910943640deeb2d9012ad417d4c0e9025),
[`agentclientprotocol/agent-client-protocol`](https://github.com/agentclientprotocol/agent-client-protocol/tree/ab82539032aeaa3926cebfb001007fb8a9ba58a2) and
[`claude-agent-acp`](https://github.com/agentclientprotocol/claude-agent-acp/tree/2f7e386f3600658d905906f3b37301120b07605f), [`a2ui-project/a2ui`](https://github.com/a2ui-project/a2ui/tree/ee0fe3559340c38c01e6ada3267243d089830b0b)
(formerly `google/A2UI`), [`ag-ui-protocol/ag-ui`](https://github.com/ag-ui-protocol/ag-ui/tree/ecc6ba16d3e6384d4fb248a1b6ceb735ef8b1fb9),
[`openai/openai-apps-sdk-examples`](https://github.com/openai/openai-apps-sdk-examples/tree/18cc38e78a968712c357bacdc3c79fead5bfc6b4),
[`microsoft/vscode-docs`](https://github.com/microsoft/vscode-docs/tree/2558307808dfcdac2a566e14079578b18a56249f), [Electron's docs](https://github.com/electron/electron/tree/196b937797f9406da7e30059b64cc14989738448/docs),
[`tldraw/tldraw`](https://github.com/tldraw/tldraw/tree/e9ace9d470e5bdb87e28756b01cb61f098e20bb6), [`jgraph/drawio-mcp`](https://github.com/jgraph/drawio-mcp/tree/639186a5cdaea5a0d47215f5f404ac7b76ccf634),
[`excalidraw/excalidraw-mcp`](https://github.com/excalidraw/excalidraw-mcp/tree/157aa23ceb1976008aadc89eb05e3444060f09d6),
[`vercel-labs/json-render`](https://github.com/vercel-labs/json-render/tree/18194121c8f087afacd9a8ef65fbda18374ee039), [`assistant-ui/assistant-ui`](https://github.com/assistant-ui/assistant-ui/tree/3321a8bbb0b19534cff9d24744fec7dbeb434614),
[`marimo-team/marimo`](https://github.com/marimo-team/marimo/tree/dff6c015ad391104bbf80b6e8dbd1ae7ccf5a047), and Claude Code's
[changelog](https://github.com/anthropics/claude-code/blob/fd1f3c4263e54dc6128c25d6117f5c079ec9c38b/CHANGELOG.md#L3) (to 2.1.321). Docs on code.claude.com and claude.com have
no commits, so they are linked as pages, as read that day. **(search)** marks what
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
from [SEP-1865](https://github.com/modelcontextprotocol/ext-apps/blob/19256f52cad5517ba8272581ed2e11d6a81273d5/specification/draft/apps.mdx#L1-L38) (read in source). Stable as
[`specification/2026-01-26`](https://github.com/modelcontextprotocol/ext-apps/tree/19256f52cad5517ba8272581ed2e11d6a81273d5/specification/2026-01-26); the
draft keeps moving (last change 4 November 2026, "relax double sandboxed
iframe architecture requirements", [#717](https://github.com/modelcontextprotocol/ext-apps/pull/717)). Hosts at launch: Claude on web,
desktop and mobile, Goose, VS Code, ChatGPT; since then Postman, MCPJam,
LibreChat, Smithery and others. The README's
[supported clients](https://github.com/modelcontextprotocol/ext-apps/blob/19256f52cad5517ba8272581ed2e11d6a81273d5/README.md#L83-L93) are ChatGPT, Claude, VS Code,
Goose, Postman, MCPJam, mcp-use and Alpic Playground; LibreChat and Smithery
were not found at `19256f5`.

- **A tool names its view.** `_meta.ui = { resourceUri: "ui://…",
  visibility?: ["model", "app"] }` ([spec](https://github.com/modelcontextprotocol/ext-apps/blob/19256f52cad5517ba8272581ed2e11d6a81273d5/specification/draft/apps.mdx#L340-L352)). The resource's
  `mimeType` [MUST be](https://github.com/modelcontextprotocol/ext-apps/blob/19256f52cad5517ba8272581ed2e11d6a81273d5/specification/draft/apps.mdx#L277-L278)
  `text/html;profile=mcp-app`, its content a whole HTML document. A tool
  without `"model"` is kept from the agent; one without `"app"` is refused to
  the view ([visibility](https://github.com/modelcontextprotocol/ext-apps/blob/19256f52cad5517ba8272581ed2e11d6a81273d5/specification/draft/apps.mdx#L414-L420)).
- **What the model sees and what the view sees differ.** A result's `content`
  goes to the model; `structuredContent` and `_meta` go to the view. The
  [spec](https://github.com/modelcontextprotocol/ext-apps/blob/19256f52cad5517ba8272581ed2e11d6a81273d5/specification/draft/apps.mdx#L1762-L1765) says `structuredContent` is "not added to model
  context" and `_meta` is "not intended for model context".
- **The sandbox.** The host and the view "MUST have different origins"; the
  frame gets `allow-scripts allow-same-origin` ([spec](https://github.com/modelcontextprotocol/ext-apps/blob/19256f52cad5517ba8272581ed2e11d6a81273d5/specification/draft/apps.mdx#L491-L495)); CSP
  is set by HTTP headers from a server "the Host controls"
  ([spec](https://github.com/modelcontextprotocol/ext-apps/blob/19256f52cad5517ba8272581ed2e11d6a81273d5/specification/draft/apps.mdx#L506)), from the resource's `csp`
  (`connectDomains`, `resourceDomains`, `frameDomains`, `baseUriDomains`,
  [spec](https://github.com/modelcontextprotocol/ext-apps/blob/19256f52cad5517ba8272581ed2e11d6a81273d5/specification/draft/apps.mdx#L244-L247)), and "MUST NOT allow undeclared domains". The
  default is `default-src 'none'; script-src 'self' 'unsafe-inline'; …;
  connect-src 'none'` ([spec](https://github.com/modelcontextprotocol/ext-apps/blob/19256f52cad5517ba8272581ed2e11d6a81273d5/specification/draft/apps.mdx#L280-L296)). The
  [stable spec](https://github.com/modelcontextprotocol/ext-apps/blob/19256f52cad5517ba8272581ed2e11d6a81273d5/specification/2026-01-26/apps.mdx#L470-L480) requires a double iframe (an outer proxy
  on another origin that builds the inner frame); the
  [draft](https://github.com/modelcontextprotocol/ext-apps/blob/19256f52cad5517ba8272581ed2e11d6a81273d5/specification/draft/apps.mdx#L510-L522) allows a single frame on a `blob:` URL, as
  Google's SafeContentFrame does.
- **Claude's host** puts the view in "an iframe nested inside another iframe"
  ([troubleshooting](https://claude.com/docs/connectors/building/mcp-apps/troubleshooting#claude-desktop)) on
  `{sha256(serverURL)[:32]}.claudemcpcontent.com`
  ([getting started](https://claude.com/docs/connectors/building/mcp-apps/getting-started#set-ui-domain-for-claude),
  [`csp-cors.md`](https://github.com/modelcontextprotocol/ext-apps/blob/19256f52cad5517ba8272581ed2e11d6a81273d5/docs/csp-cors.md#L17-L24)), asks Allow or Always allow
  per server ([getting started](https://claude.com/docs/connectors/building/mcp-apps/getting-started#ask-claude-to-use-the-app)),
  keeps `frameDomains` "restricted in Claude pending security review"
  ([design guidelines](https://claude.com/docs/connectors/building/mcp-apps/design-guidelines#content-security-policy)), and
  on mobile uses a native web view with no camera, microphone or location
  ([design guidelines](https://claude.com/docs/connectors/building/mcp-apps/design-guidelines#mobile-guidelines)).
- **The view and the host speak JSON-RPC over `postMessage`.**
  `ui/initialize` (the host returns its [context](https://github.com/modelcontextprotocol/ext-apps/blob/19256f52cad5517ba8272581ed2e11d6a81273d5/specification/draft/apps.mdx#L618-L660): theme,
  [76 standard CSS variables](https://github.com/modelcontextprotocol/ext-apps/blob/19256f52cad5517ba8272581ed2e11d6a81273d5/specification/draft/apps.mdx#L915-L1009), fonts, display mode, size,
  locale), then the tool's input
  (`tool-input-partial` while it streams, `tool-input` once,
  [spec](https://github.com/modelcontextprotocol/ext-apps/blob/19256f52cad5517ba8272581ed2e11d6a81273d5/specification/draft/apps.mdx#L1387-L1401)) and its result.
  The view may call `tools/call` and `resources/read`, send `ui/message`
  (the host "SHOULD add the message to the conversation context",
  [spec](https://github.com/modelcontextprotocol/ext-apps/blob/19256f52cad5517ba8272581ed2e11d6a81273d5/specification/draft/apps.mdx#L1185-L1222), and messages "also trigger follow-ups"), set
  `ui/update-model-context` ("Each request overwrites the previous context",
  which the host may hold for the next message, [spec](https://github.com/modelcontextprotocol/ext-apps/blob/19256f52cad5517ba8272581ed2e11d6a81273d5/specification/draft/apps.mdx#L1279-L1286)),
  open links, ask for `inline`, `fullscreen` or `pip`
  ([spec](https://github.com/modelcontextprotocol/ext-apps/blob/19256f52cad5517ba8272581ed2e11d6a81273d5/specification/draft/apps.mdx#L892-L907)), and report its size
  ([spec](https://github.com/modelcontextprotocol/ext-apps/blob/19256f52cad5517ba8272581ed2e11d6a81273d5/specification/draft/apps.mdx#L838)).
- **SDKs.** `@modelcontextprotocol/ext-apps` (MIT, the project
  [moving to Apache-2.0](https://github.com/modelcontextprotocol/ext-apps/blob/19256f52cad5517ba8272581ed2e11d6a81273d5/LICENSE#L1)) has the view's
  [`App`](https://github.com/modelcontextprotocol/ext-apps/blob/19256f52cad5517ba8272581ed2e11d6a81273d5/src/app.ts#L340), the server's
  [`registerAppTool`](https://github.com/modelcontextprotocol/ext-apps/blob/19256f52cad5517ba8272581ed2e11d6a81273d5/src/server/index.ts#L277), and
  [`AppBridge`](https://github.com/modelcontextprotocol/ext-apps/blob/19256f52cad5517ba8272581ed2e11d6a81273d5/src/app-bridge.ts#L305), a host-side class for embedding
  views. `@mcp-ui/client`
  ([Apache-2.0](https://github.com/idosal/mcp-ui/blob/2b10490910943640deeb2d9012ad417d4c0e9025/sdks/typescript/client/package.json#L89)) has
  [`AppRenderer`](https://github.com/idosal/mcp-ui/blob/2b10490910943640deeb2d9012ad417d4c0e9025/README.md#L47). The repository says "There's no
  _supported_ host implementation in this repo" beyond an example
  ([README](https://github.com/modelcontextprotocol/ext-apps/blob/19256f52cad5517ba8272581ed2e11d6a81273d5/README.md#L170-L172)).
- **What is still open, and matters here:**
  - **One view per call.** [#430](https://github.com/modelcontextprotocol/ext-apps/issues/430): "the spec assumes a new view is
    rendered per tool call"; zoom, selection and edits are lost on the next
    call, and moving a frame between display modes destroys it. A shared id is
    proposed in [PR #295](https://github.com/modelcontextprotocol/ext-apps/pull/295); at its head
    ([`dc32ace`](https://github.com/modelcontextprotocol/ext-apps/blob/dc32ace1872e7c7861ae318f74af4a184a1daccd/specification/draft/apps.mdx#L1416-L1433))
    it is `widgetSessionId`, and `viewSessionId` was not found there.
  - **No view without a call.** [#672](https://github.com/modelcontextprotocol/ext-apps/issues/672): "opening a standalone MCP
    App requires a no-op tool call".
  - **CSP gaps:** `unsafe-eval` ([#199](https://github.com/modelcontextprotocol/ext-apps/issues/199), three.js),
    `wasm-unsafe-eval` ([#605](https://github.com/modelcontextprotocol/ext-apps/issues/605)), `frameDomains` ([#387](https://github.com/modelcontextprotocol/ext-apps/issues/387)).
  - **No state of the view's own,** unlike the Apps SDK's `widgetState`: the
    [migration guide](https://github.com/modelcontextprotocol/ext-apps/blob/19256f52cad5517ba8272581ed2e11d6a81273d5/docs/migrate_from_openai_apps.md#L281) says to use "alternative mechanisms
    (`localStorage`, server-side state, etc.)"

**The fact that decides most for Althar:** the MCP client, which the spec
calls the host, is the agent (Claude Code, Codex), not Althar. Claude Code
renders no MCP Apps; its [2.1.281 changelog](https://github.com/anthropics/claude-code/blob/fd1f3c4263e54dc6128c25d6117f5c079ec9c38b/CHANGELOG.md#L2945) "Changed MCP resource lists … to
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
  origin ([docs](https://code.claude.com/docs/en/artifacts#allowlist-the-viewer-domain)), private by default
  ([docs](https://code.claude.com/docs/en/artifacts#create-an-artifact)), with Docs, Slides and Design types
  ([docs](https://code.claude.com/docs/en/artifacts#start-from-a-slides-design-or-docs-template)).
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

1. **Artifacts** ([code.claude.com/docs/en/artifacts](https://code.claude.com/docs/en/artifacts)). This is the
   nearest precedent.
   - **Publishing.** The agent writes an `.html` or `.md` file (at most
     16 MiB, [page constraints](https://code.claude.com/docs/en/artifacts#page-constraints)) and publishes it by
     path with the `Artifact` tool, which can
     also take old and new strings to change it in place. The page lives at
     `claude.ai/code/artifact/<uuid>` ([docs](https://code.claude.com/docs/en/artifacts#update-an-artifact)).
   - **Versions.** "Each publish becomes a version"
     ([docs](https://code.claude.com/docs/en/artifacts#update-an-artifact)). A publish built on a
     stale copy is refused, and the agent merges what it is handed
     ([2.1.274](https://github.com/anthropics/claude-code/blob/fd1f3c4263e54dc6128c25d6117f5c079ec9c38b/CHANGELOG.md#L3346): "a publish built on an older version is stopped
     before it is sent, with the newer page to merge").
   - **Comments.** Comments sent with "Send to Claude" or `@claude` reach the
     publishing session ([docs](https://code.claude.com/docs/en/artifacts#collect-comments-on-an-artifact)), which
     watches up to ten published artifacts ([2.1.271](https://github.com/anthropics/claude-code/blob/fd1f3c4263e54dc6128c25d6117f5c079ec9c38b/CHANGELOG.md#L3534), said there
     of republishes made elsewhere). The session answers on its own where the
     permission mode allows, and stops after "60 sent comments or thread
     activations on that artifact within an hour"
     ([docs](https://code.claude.com/docs/en/artifacts#let-claude-reply-to-comments-on-its-own)).
   - **What the page can reach.** Scripts load only from five CDNs, fonts
     from Google Fonts, and `fetch` reaches only the page's own origin
     ([page constraints](https://code.claude.com/docs/en/artifacts#page-constraints)).
     Other powers are declared and asked for at publish
     ([docs](https://code.claude.com/docs/en/artifacts#when-claude-code-asks-before-publishing)): connectors, a
     shared database, downloads, "ask Claude", the viewer's identity, files.
   - **Needs.** A claude.ai sign-in ([availability](https://code.claude.com/docs/en/artifacts#availability)).
2. **The desktop app's Browser pane** ([desktop docs](https://code.claude.com/docs/en/desktop#preview-your-app)).
   It opens dev servers from
   `.claude/launch.json` ([docs](https://code.claude.com/docs/en/desktop#configure-preview-servers)),
   and Claude checks its own work there with
   screenshots, the DOM and clicks ([auto-verify](https://code.claude.com/docs/en/desktop#auto-verify-changes)).
   An HTML path pressed in the chat opens
   in it too. Cloud sessions tell the app their port with
   `report_preview_port` (not found in code.claude.com's docs).
3. **The IDE's MCP server** ([VS Code docs](https://code.claude.com/docs/en/vs-code#the-built-in-ide-mcp-server)).
   - **Connection.** The editor extension serves MCP over `ws://127.0.0.1`
     on a random port. Its token is in `~/.claude/ide/<port>.lock` (mode
     0600) and comes back in a header.
   - **Visibility.** Only two of its tools are shown to the model; the rest
     are the CLI's own calls.
   - **Blocking.** `openDiff` **blocks** until the person saves or rejects,
     and returns `FILE_SAVED` or `DIFF_REJECTED` (not found in
     code.claude.com's docs, which call these calls "internal RPC"). The
     person's answer comes back as the tool's result.
4. **Mods** ([2.1.287](https://github.com/anthropics/claude-code/blob/fd1f3c4263e54dc6128c25d6117f5c079ec9c38b/CHANGELOG.md#L2170), "Added Claude Mods";
   [overview](https://code.claude.com/docs/en/plugins/mods/overview)).
   - **What they draw.** A plugin draws a pane beside the transcript from
     declarative elements (Box, Text, Markdown, Button, Input, `Svg`, and
     `Client` for a region of one's own that posts events back;
     [elements](https://code.claude.com/docs/en/plugins/mods/reference#elements)).
   - **Limits.** No arbitrary HTML, and they
     [aren't sandboxed](https://code.claude.com/docs/en/plugins/mods/overview#what-a-mod-can-reach).
   - **Channels** ([research preview](https://code.claude.com/docs/en/channels#research-preview)) are a
     server's notifications that reach the model as events.

### ACP

- **Content.** ACP's `ContentBlock` is "compatible with, and a superset of,
  the … MCP 2025-06-18 `ContentBlock`" ([content](https://github.com/agentclientprotocol/agent-client-protocol/blob/ab82539032aeaa3926cebfb001007fb8a9ba58a2/docs/protocol/v1/content.mdx#L18)):
  text, image, audio, `resource_link`, and an embedded
  `resource` (behind [`embeddedContext`](https://github.com/agentclientprotocol/agent-client-protocol/blob/ab82539032aeaa3926cebfb001007fb8a9ba58a2/docs/protocol/v1/content.mdx#L123)).
  It has no interface or artifact of its own, and no RFD or issue was found
  for one.
- **Its security guidance is against running what an agent writes**
  ([security](https://github.com/agentclientprotocol/agent-client-protocol/blob/ab82539032aeaa3926cebfb001007fb8a9ba58a2/docs/protocol/v1/security.mdx#L21-L22)): "Clients
  **SHOULD NOT** run scripts from Agent content, and **SHOULD** disable or
  sanitize raw HTML when rendering Markdown", and "**SHOULD NOT**
  automatically run active content, such as diagram renderers".
- **What would help later.** [MCP-over-ACP](https://github.com/agentclientprotocol/agent-client-protocol/blob/ab82539032aeaa3926cebfb001007fb8a9ba58a2/docs/rfds/mcp-over-acp.mdx)
  (an [active RFD](https://github.com/agentclientprotocol/agent-client-protocol/blob/ab82539032aeaa3926cebfb001007fb8a9ba58a2/docs/docs.json#L209-L214)) lets a client
  serve MCP to the agent over the ACP connection. A client could then sit
  between the agent and the person's servers and see their views.

## Others

### OpenAI

- **Apps SDK** (read in source).
  - **What a tool returns.** It returns `structuredContent` for the model
    and `_meta` for the widget, and names an HTML template. ChatGPT
    implements MCP Apps and keeps `openai/outputTemplate` as an alias (the
    flat key mapping is in ext-apps'
    [`migrate_from_openai_apps.md`](https://github.com/modelcontextprotocol/ext-apps/blob/19256f52cad5517ba8272581ed2e11d6a81273d5/docs/migrate_from_openai_apps.md#L32)).
  - **The widget's API.** `window.openai` gives `setWidgetState` (state
    kept per widget, which the model sees on later turns,
    [shopping cart example](https://github.com/openai/openai-apps-sdk-examples/blob/18cc38e78a968712c357bacdc3c79fead5bfc6b4/shopping_cart_python/README.md#L35-L37)),
    `sendFollowUpMessage`, `callTool`, `requestDisplayMode`
    (`inline | pip | fullscreen`) ([types](https://github.com/openai/openai-apps-sdk-examples/blob/18cc38e78a968712c357bacdc3c79fead5bfc6b4/src/types.ts#L18-L38)) and
    `notifyIntrinsicHeight` (not in the examples' types; in the
    [migration guide](https://github.com/modelcontextprotocol/ext-apps/blob/19256f52cad5517ba8272581ed2e11d6a81273d5/docs/migrate_from_openai_apps.md#L273)).
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

- **A2UI v1.0** ([spec](https://github.com/a2ui-project/a2ui/blob/ee0fe3559340c38c01e6ada3267243d089830b0b/specification/v1_0/docs/a2ui_protocol.md), read in source, 8 June 2026; the date
  was not found at `ee0fe35`). "Safe like data, but
  expressive like code" ([README](https://github.com/a2ui-project/a2ui/blob/ee0fe3559340c38c01e6ada3267243d089830b0b/README.md#L24)): the agent asks only
  for components from the client's catalog.
  - **Messages.** [`createSurface`, `updateComponents`, `updateDataModel`,
    `deleteSurface`](https://github.com/a2ui-project/a2ui/blob/ee0fe3559340c38c01e6ada3267243d089830b0b/specification/v1_0/docs/a2ui_protocol.md#L26-L29). `updateComponents` is a flat list of
    components by id, streamed, missing ones drawn as placeholders
    ([spec](https://github.com/a2ui-project/a2ui/blob/ee0fe3559340c38c01e6ada3267243d089830b0b/specification/v1_0/docs/a2ui_protocol.md#L223)); `updateDataModel` takes a
    [JSON Pointer](https://github.com/a2ui-project/a2ui/blob/ee0fe3559340c38c01e6ada3267243d089830b0b/specification/v1_0/docs/a2ui_protocol.md#L265).
  - **The catalog** is Text, Image, Row, Column, List, Card, Tabs, Modal,
    Button, CheckBox, TextField, ChoicePicker, Slider and a few more
    ([basic catalog](https://github.com/a2ui-project/a2ui/blob/ee0fe3559340c38c01e6ada3267243d089830b0b/specification/v1_0/docs/a2ui_protocol.md#L1232-L1254)). It has
    no free HTML; charts and diagrams need components of the host's own.
  - **Feedback.** A button's [`action`](https://github.com/a2ui-project/a2ui/blob/ee0fe3559340c38c01e6ada3267243d089830b0b/specification/v1_0/docs/a2ui_protocol.md#L1439-L1445) goes to the
    agent, with the whole data model if
    [`sendDataModel`](https://github.com/a2ui-project/a2ui/blob/ee0fe3559340c38c01e6ada3267243d089830b0b/specification/v1_0/docs/a2ui_protocol.md#L186) is set.
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
  - **Integrated browser.** It has "Add element to chat"
    ([1.109](https://github.com/microsoft/vscode-docs/blob/2558307808dfcdac2a566e14079578b18a56249f/release-notes/v1_109.md#L906)), agent
    browser tools (`openBrowserPage`, `readPage`, `screenshotPage`,
    `clickElement`, [docs](https://github.com/microsoft/vscode-docs/blob/2558307808dfcdac2a566e14079578b18a56249f/docs/agents/run/browser-tools.md#L59-L61)),
    comments on several elements sent together
    ([1.132](https://github.com/microsoft/vscode-docs/blob/2558307808dfcdac2a566e14079578b18a56249f/release-notes/v1_132.md#L142-L146)), and
    Mermaid in chat ([1.121](https://github.com/microsoft/vscode-docs/blob/2558307808dfcdac2a566e14079578b18a56249f/release-notes/v1_121.md#L245)).
  - **MCP Apps** are drawn in chat since
    [1.109](https://github.com/microsoft/vscode-docs/blob/2558307808dfcdac2a566e14079578b18a56249f/release-notes/v1_109.md#L681-L685).
  - **Canvases** (preview, [1.142](https://github.com/microsoft/vscode-docs/blob/2558307808dfcdac2a566e14079578b18a56249f/release-notes/v1_142.md#L87-L91),
    [14 October 2026](https://github.com/microsoft/vscode-docs/blob/2558307808dfcdac2a566e14079578b18a56249f/release-notes/v1_142.md#L21)) are "interactive
    interfaces to collaborate with an agent". One "opens beside the chat,
    where you and the agent can inspect and update the same artifact". Each
    comes from an extension with actions the agent calls
    ([docs](https://github.com/microsoft/vscode-docs/blob/2558307808dfcdac2a566e14079578b18a56249f/docs/agents/run/canvases.md#L94-L100)).
  - **Limit:** "Canvases aren't supported in Claude, Codex, Local harness
    sessions, browser clients, or auxiliary windows"
    ([docs](https://github.com/microsoft/vscode-docs/blob/2558307808dfcdac2a566e14079578b18a56249f/docs/agents/run/canvases.md#L35)).
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

- **tldraw's agent kit** ([README](https://github.com/tldraw/tldraw/blob/e9ace9d470e5bdb87e28756b01cb61f098e20bb6/templates/agent/README.md#L35-L68),
  read in source). Every action is a tool call
  (create, update or delete shapes, align, move the agent's viewport). Each
  next request carries the person's selection and viewport, their recent
  actions, **a screenshot of the agent's view**, a simplified form of the
  shapes, and lints.
  - **The lesson:** the feedback is what the person picked and did, not only
    words. The agent sees what it drew.
- **Excalidraw** (read in source) has an official MCP App at
  `mcp.excalidraw.com` ([README](https://github.com/excalidraw/excalidraw-mcp/blob/157aa23ceb1976008aadc89eb05e3444060f09d6/README.md#L1-L13)). **draw.io** (read
  in source) offers [four routes](https://github.com/jgraph/drawio-mcp/blob/639186a5cdaea5a0d47215f5f404ac7b76ccf634/README.md#L9-L19):
  - an MCP App ([`create_diagram`](https://github.com/jgraph/drawio-mcp/blob/639186a5cdaea5a0d47215f5f404ac7b76ccf634/README.md#L54), from draw.io XML or
    Mermaid)
  - a [stdio server](https://github.com/jgraph/drawio-mcp/blob/639186a5cdaea5a0d47215f5f404ac7b76ccf634/README.md#L64-L66) that opens the editor
  - [skills](https://github.com/jgraph/drawio-mcp/blob/639186a5cdaea5a0d47215f5f404ac7b76ccf634/README.md#L78) that write `.drawio` files, with exports
    that keep the XML inside ([`--embed-diagram`](https://github.com/jgraph/drawio-mcp/blob/639186a5cdaea5a0d47215f5f404ac7b76ccf634/README.md#L116))
  - [instructions](https://github.com/jgraph/drawio-mcp/blob/639186a5cdaea5a0d47215f5f404ac7b76ccf634/README.md#L121) that build links

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
- **marimo pair** ([guide](https://github.com/marimo-team/marimo/blob/dff6c015ad391104bbf80b6e8dbd1ae7ccf5a047/docs/guides/generate_with_ai/marimo_pair.md#L3-L7),
  read in source). It connects Claude Code, Codex and
  OpenCode to a running notebook, where the agent "can inspect variables and
  try code in a scratchpad before it commits changes to the notebook".
- **Observable Notebook Kit** keeps a notebook as a local `.html` file
  (search): the artifact as a file a person can read.

## Drawing what an agent wrote, safely, in Electron

From Electron's [security guide](https://github.com/electron/electron/blob/196b937797f9406da7e30059b64cc14989738448/docs/tutorial/security.md) and [protocol API](https://github.com/electron/electron/blob/196b937797f9406da7e30059b64cc14989738448/docs/api/protocol.md) (read
in source):

- **Remote content.** "To display remote content, use the `<webview>` tag or a
  `WebContentsView` and make sure to disable the `nodeIntegration` and enable
  `contextIsolation`" ([guide](https://github.com/electron/electron/blob/196b937797f9406da7e30059b64cc14989738448/docs/tutorial/security.md#L78-L84)). The `webview` tag itself is
  [discouraged](https://github.com/electron/electron/blob/196b937797f9406da7e30059b64cc14989738448/docs/api/webview-tag.md#L3-L10).
- **Checklist.** Of the [guide's list](https://github.com/electron/electron/blob/196b937797f9406da7e30059b64cc14989738448/docs/tutorial/security.md#L96-L117), these apply: the
  process sandbox; `setPermissionRequestHandler`; CSP sent as
  [HTTP headers](https://github.com/electron/electron/blob/196b937797f9406da7e30059b64cc14989738448/docs/tutorial/security.md#L382-L384); limiting
  navigation and `setWindowOpenHandler`; checking every IPC sender; "Avoid
  usage of the `file://` protocol and prefer usage of custom protocols"
  ([guide](https://github.com/electron/electron/blob/196b937797f9406da7e30059b64cc14989738448/docs/tutorial/security.md#L780)).
- **Custom protocols.**
  [`protocol.registerSchemesAsPrivileged`](https://github.com/electron/electron/blob/196b937797f9406da7e30059b64cc14989738448/docs/api/protocol.md#L72-L118) with
  `standard` and `secure`, then [`protocol.handle`](https://github.com/electron/electron/blob/196b937797f9406da7e30059b64cc14989738448/docs/api/protocol.md#L125).
  - **Origins and headers.** A standard scheme has real origins
    (`scheme://host`), so a host per artifact is an origin per artifact.
    The handler writes every response header, CSP among them.
  - **Per session.** A `Session` has its own `protocol`
    ([protocol API](https://github.com/electron/electron/blob/196b937797f9406da7e30059b64cc14989738448/docs/api/protocol.md#L28-L35), [`ses.protocol`](https://github.com/electron/electron/blob/196b937797f9406da7e30059b64cc14989738448/docs/api/session.md#L1981-L1991)),
    so a scheme can be handled in one partition and nowhere else.
- **Three ways, compared:**
  - **A sandboxed iframe with a null origin** is simplest. It loses storage,
    forces `postMessage(…, "*")` and sends `Origin: null`
    ([assistant-ui's docs](https://github.com/assistant-ui/assistant-ui/blob/3321a8bbb0b19534cff9d24744fec7dbeb434614/apps/docs/content/docs-sites/safe-content-frame/how-it-works.mdx#L19-L24)).
    Chrome has isolated such frames since 127, but grouped by the origin that
    made them ([assistant-ui's docs](https://github.com/assistant-ui/assistant-ui/blob/3321a8bbb0b19534cff9d24744fec7dbeb434614/apps/docs/content/docs-sites/safe-content-frame/how-it-works.mdx#L65),
    not checked in Chromium).
  - **An iframe on an origin of its own per artifact** is what MCP Apps,
    the Apps SDK's `widgetDomain` ([mapping](https://github.com/modelcontextprotocol/ext-apps/blob/19256f52cad5517ba8272581ed2e11d6a81273d5/docs/migrate_from_openai_apps.md#L44)) and SafeContentFrame
    do. In Althar's window
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
  - tldraw's SDK needs a licence key for production, as understood
    ([licence](https://github.com/tldraw/tldraw/blob/e9ace9d470e5bdb87e28756b01cb61f098e20bb6/LICENSE.md#L28-L29)).
  - Excalidraw is [MIT](https://github.com/excalidraw/excalidraw/blob/701b901a0f1ba3d0b390d9cdf63d112e25abac4b/LICENSE#L1).

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

1. **A new view per call** (MCP Apps [#430](https://github.com/modelcontextprotocol/ext-apps/issues/430), [#672](https://github.com/modelcontextprotocol/ext-apps/issues/672)). What the person is
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
- **MCP Apps isn't the format for Althar's own canvases,** and a canvas
  doesn't meet its rules: an MCP App gets only the domains its resource
  declares, and a canvas follows the project's network. What a later MCP
  Apps adapter could reuse is the isolation (a view of its own, an origin
  per view's content, headers Althar writes, a bridge bound to its view);
  its policy would be that adapter's own decision, once something
  (MCP-over-ACP) lets Althar see such a view.
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
