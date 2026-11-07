# ADR-099: A web page opens beside the conversation, in a session of its own, and a comment pointed on it goes to the lead with what the person writes

- **Status:** Accepted
- **Date:** 2026-11-07
- **Owner:** Desktop app maintainers
- **Reopens:** [ADR-023](023-althar-runs-the-project.md)'s passed-over
  alternative, a browser of Althar's own for what runs. It places it as
  [ADR-053](053-the-code-an-agent-names-opens-beside-the-conversation.md)
  foresaw: on the conversation's workbench.
- **Context:** A task's run (ADR-023, ADR-044), and every link in a
  thread, opened in the person's own browser. To check what a lead built,
  the person left Althar, found the tab, and came back to say what was
  wrong in words: "the banner under the title is too tight". The lead then
  guessed which element was meant. DEV-83 asked for a browser in Althar, and
  for "point at the page, the lead gets it". A prototype tried five
  directions:
  - a browser tab;
  - a task's Preview face;
  - comparing main's run with the task's;
  - the lead driving the page;
  - the page beside the conversation.

  The person picked the last, E. The window has no sidebar, so its right
  side is free. The conversation's workbench already means "what opens
  beside the thread" (a lead's documents, the files it names). A page is
  looked at *with* the lead, so it belongs beside the lead's words, not in
  place of them. This sets aside DEV-83's first line, "no side panels", at
  the person's word.
- **Decision:**
  - **Where it opens.** A page opens on the conversation's workbench, with
    the thread and its composer beside it. It starts at half the window, and
    leaves the conversation at least 440 px.
    - A task's run always opens there: its card in the thread, the Running
      pill, Run's list, and `p` (which takes it away again).
    - Links in a thread open there too, unless the person keeps them in
      their browser (Settings › Browser). A link pressed with a modifier
      opens in a new tab, as before.
    - From the coordinator's thread, a project's run opens beside the
      coordinator's conversation. The project goes to its Conversation view
      for it, and the board steps aside.
    - Each task and project keeps its own page while the window is open.
      A document or file opened from the thread takes the workbench, and
      the page is still there to show again.
    - **Open as a tab** docks the page into a tab of its own, after the
      projects'. The page keeps its view, history and session.
      **Back beside the task** returns it.
  - **The bar.** Back, forward and reload; the address, in mono, with a
    shield that opens the page's session facts; Viewport; Comment; Open in
    your browser; Open as a tab; Close. Escape closes the panel when focus is
    in it, never when focus is in the page. One quiet line under the bar
    says when something was refused, sent out, asked for, or didn't answer,
    with the one action that helps.
  - **The page is a `WebContentsView` the main process owns.** It sits over
    the window at the place the window measures, and moves every frame of a
    drag. It runs in its owner's own persistent partition:
    `persist:task-<id>`, or `persist:project-<id>` beside the coordinator.
    - It has no preload. `sandbox` and `contextIsolation` are on, and
      `nodeIntegration` and the `webview` tag are off. It can't reach
      Althar's bridge, the runtime's port, or anything Althar keeps
      (sign-ins, tokens, the artifact store: `althar-picture:` is handled
      only in Althar's own session).
    - Every IPC call about pages checks that it comes from one of Althar's
      windows, and checks its arguments.
    - A page's crash is the web's, not a crash report of Althar's.
  - **What loads.** Only `http:` and `https:`. A typed address, a link, a
    redirect, a frame, or a pop-up to `file:`, `javascript:`, a top-level
    `data:` or `blob:`, `about:`, or another app's scheme is refused, and
    the page stays where it was. Inside a page, frames may hold its own
    blank, inline, data and blob documents. A `file:` link that Chromium
    blocks in the page itself is heard from the page's console, so the line
    says it too.
  - **Pop-ups** open in the same view. **Downloads are refused**, with a
    line offering to download in the person's browser where the download
    has a web address.
  - **Sign-ins stay in the person's browser** (DEV-79, DEV-75). A
    navigation, redirect, pop-up, or single-page app's own route to
    Claude's, GitHub's, GitLab's or Linear's sign-in, sign-up or
    app-granting pages goes to the person's browser instead. The browser
    opens the page that was asked for, where the person is signed in
    already. The line says where it went.
  - **Permissions.** Every web permission is refused, requested or checked:
    camera, microphone, location, notifications, reading the clipboard,
    devices (HID, serial, USB, Bluetooth), the screen, full screen and
    pointer lock. The one exception is writing to the clipboard what the
    person copies, sanitized, as a docs page's Copy needs. A refused request
    the person would notice is said in the line, with Open in your browser.
  - **The session's user agent** is Chrome's own, without Electron's and the
    app's names, which some sites refuse to serve.
  - **Viewport.** The panel's own size by default, or Desktop 1440 × 900,
    Laptop 1280 × 800, Tablet 820 × 1180 or Phone 390 × 844.
    - A device's size is laid out at that size and drawn whole, smaller
      where the panel is smaller, in a well. This uses the DevTools
      protocol's `Emulation.setDeviceMetricsOverride` through
      `webContents.debugger`, with its scale.
    - Tablet and phone are touch screens (`setTouchEmulationEnabled`,
      `setEmitTouchEventsForMouse`). They send Chrome on Android's user
      agent for this Chromium, and the page loads again for it, so a site
      that serves phones differently does.
  - **Point and comment.**
    - Comment (⌘⇧C, Ctrl+Shift+C) points at the page. The main process
      injects an overlay script (`src/overlay`, its own bundle) into an
      isolated world of the page, never the page's own world.
    - The overlay draws a layer in a closed shadow root that takes the
      pointer, so the page sees no hover and no press. It outlines the
      element under the pointer with its name and size. ↑ and ↓ widen and
      narrow it, Enter takes it, and Escape stops.
    - Pressed, it describes the element: a selector that finds it and no
      other, its words, rect, font, colour and background, and the page's
      size. Every name the page chose is escaped by CSSOM's rules, or
      quoted, never by the page's `CSS.escape`. The main process checks
      every field as untrusted.
    - The main process crops the spot with `webContents.capturePage(rect)`,
      and takes a picture of the page.
    - The comment is written in Althar's own window, over that picture,
      beside the outlined element. The page never sees it typed.
    - It goes in the conversation's composer as a chip, among the person's
      own attachments: the crop small, its number, the note. ✕ takes it off.
      Pointed at, the chip's card shows the crop, the comment, and the
      element's text, size, font, colour, background, the page and size it
      was made at, and its selector. Pressed, the chip opens the comment
      again on its element, to change or remove.
    - The page keeps numbered pins on the elements commented.
  - **What the lead gets.** Sent, the person's words go first, then each
    comment:
    - its note;
    - its element and words, and its size;
    - its selector;
    - the page's address and the size it was made at, naming the device;
    - which attached picture is its crop.

    The crops go as pictures after the person's own, where the agent takes
    pictures. A message Althar didn't take gives the comments back.
  - **Shared with diff comments.** The gathering (`renderer/shared/comments.ts`
    and the kit's `CommentChip` and `CommentCard`) is one place for every
    comment made beside a conversation. A spot on a page is one kind. A line
    of the diff (DEV-175) is to be another, with facts of its own, gathered,
    shown and sent the same way.
  - **When the window's own things are over the page.** The page is a
    native layer over the window, so the window's menus, popovers, cards and
    dialogs would draw under it. While one of them is over the page's place,
    the window shows a picture of the page there (`capturePage`), and the
    view steps aside once the picture is drawn. The window watches the
    body's portals for what draws: popper content, dialogs and their scrims.
    The bar's tooltips open above it.
  - **Cookies** are kept as Settings › Browser says. The default is until
    the task is done; the others are until the page closes, until Althar
    quits, or as long as each site asks.
    - The runtime tells the main process each task done or abandoned and
      each project removed (`settling`).
    - As Althar starts, the main process asks which of the partitions on
      disk belong to tasks and projects that are over (`settledAmong`).
    - A session open this launch is cleared. One not open has its folder
      removed whole.
    - Clear all clears every page's. Each page's session facts offer
      clearing its own.
  - **Agents don't drive these pages** (DEV-83's "To decide"). The lead's
    own `screenshot` tool is unchanged. Any tool for them would go through
    the main process's page module, as the window does, never to a page's
    contents another way.
- **Alternatives considered:**
  - *A browser tab (A).* Althar becomes a general browser, judged against
    the person's own: history, extensions, password managers, sign-ins.
    E keeps a tab for when the person wants one, and nothing more.
  - *A task's Preview face (B) or Compare face (C).* The page replaces the
    conversation it is about, and the comments are written away from the
    lead's words. C's side by side needs width that a panel doesn't have:
    it stays a face to build later.
  - *The lead driving the page (D).* A separate decision. It fits here when
    it is made.
  - *`<webview>`, or the deprecated `BrowserView`.* `<webview>` runs inside
    the window's own renderer and is discouraged. `WebContentsView` is
    Electron's current way to lay web contents over a window.
  - *The comment box drawn in the page's isolated world.* It would sit
    over the live page, but the page's own scripts can listen to keys on
    its window, and would read what the person types. Drawn in Althar's
    window over a picture of the page, it is the person's alone.
  - *A second transparent view over the page for the overlay.* It would
    keep Althar's drawing out of the page, at the cost of a round trip for
    every move of the pointer. The isolated world's closed shadow root
    draws nothing the page can read, and takes the pointer itself.
  - *`enableDeviceEmulation` for Viewport.* It scales the view, but has no
    touch or user agent. The DevTools protocol does all three, the way
    DevTools' own device mode does.
  - *Sending downloads straight to the person's browser.* A page could open
    one tab after another there. The line asks first.
  - *A structured comment block in the message, with its own table.* The
    agent reads text, and the thread already shows a message's words and
    pictures. The approved prototype sent text and pictures, and so does
    this. A block of its own can come once the thread draws comments
    beside their crops.
- **Trade-off:**
  - **The window's popovers over a page show a picture of it**, frozen
    while they are open, and taking the picture costs a frame or two before
    the view steps aside.
  - **Althar's keys aren't heard while the page has focus.** Comment, the
    address, reload, back and forward are caught in the main process.
  - **The overlay's layer and pins are in the page's document.** A page
    can see that a host element was added, and remove it; the overlay puts
    it back.
  - **Pages hidden from every conversation are kept for a while.** Three
    are kept alive. Past that, the oldest is closed, and loads again where
    it was when shown, without its history.
  - **A page's session persists on disk** until the person's choice clears
    it.
  - **A sign-in to a service other than the four** (a company's own SSO, a
    dev app's login) happens in the page's session, kept as its cookies
    are.
- **Revisit when:**
  - Agents are to drive pages (D).
  - Diff comments (DEV-175) are built, to put them in the same gathering.
  - The thread draws a comment beside its crop.
  - Electron gives a native view a way to sit under the window's own
    drawing, so stills aren't needed.
