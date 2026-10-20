# ADR-055: Althar is light, dark, or as the system is: one warm dark set of tokens, followed from nativeTheme

- **Status:** Accepted
- **Date:** 2026-10-21
- **Owner:** Repository maintainers
- **Context:** Althar was light only: the kit's colours were one set of
  tokens on `:root`, and the window's paper under the page was the light
  page's hex. People work at night, and on a Mac, Windows or a Linux desktop
  set to dark, Althar was a white window among dark ones (DEV-97). A prototype drew the whole app in three
  darks, a neutral graphite, a warm one from the light theme's paper, and
  near-black, switchable in place; four close reviews of every screen in
  each found where a dark built from light's shades went wrong. The person
  picked the warm one.
- **Decision:**
  - **One dark, the warm one, as a full second set of tokens.**
    `packages/ui/src/styles/dark.css` sets every colour token of `tokens.css`
    again under `:root[data-theme='dark']`, in the same order: surfaces,
    ink, lines, violet and cobalt, roles, materials, frost, the ink as a
    fill, terminal, code and diffs, sources, project inks. The only ones it
    leaves alone are the same in every theme: what is dark anyway (the
    island, the lightbox, a dark terminal's words: `--on-dark*`, `--term-t*`,
    `--*-on-ink`) and a project's mark, which is its picture, drawn in its
    own inks (`--mark-*`) on its own paper in every theme, as an app's icon
    is. Raised still means lighter; edges are drawn with light, since a
    shadow barely shows on dark; cobalt and violet lighten to read as words,
    and violet that carries words keeps a deeper fill (`--signal-fill`) so
    its words stay white; the ink that fills (a primary button, a switch
    that is on) turns a soft light, a shade under the brightest words.
  - **Components name roles, never a theme.** Where light used a page shade
    for "a step down from the sheet" (a hovered menu row, a chip, a recess,
    a segmented track), dark reads it as a hole: each such role has its own
    token (`--hover-paper`, `--pressed-paper`, `--hover-faint`, `--chosen`,
    `--chip`, `--tile`, `--well`, `--inset`, `--segment-*`, `--knob*`,
    `--ring-track`, `--scroll-thumb`, `--float`), the same page shade on
    paper and a lighter wash on dark. A part that only looks different at
    night reads `var(--part, its light look)`, and only `dark.css` sets
    `--part`; the island's dark sheet resets those it could hold, since it
    is the same black in every theme. No CSS module mentions `data-theme`,
    and `packages/ui/tests/tokens.test.ts` keeps it so: the dark set full,
    every part on its fallback, and the pairs that carry meaning (words on
    every surface, violet and cobalt on their washes, fills and their words,
    code, diffs) at WCAG AA on dark, resolved as a browser does.
  - **The system's scheme is the one switch.** Settings › Appearance offers
    Light, Dark and Match the system, in each system's words: Match the Mac,
    Match the PC, Match the computer. It is kept as the app preference
    `appearance` (`light`, `dark` or `system`, starting at `system`). The
    main process sets Electron's `nativeTheme.themeSource` from it as soon
    as the preferences are read (`themeSourceFor`): on a Mac and on Windows,
    as the system is is `system`, which nativeTheme follows by itself (the
    Mac's appearance; Windows' apps mode). On Linux Electron has no word of
    the desktop's setting, so while Appearance is as the system is, the main
    process follows the desktop's Settings portal (`color-scheme`, which
    GNOME and KDE set) and tells nativeTheme dark or light from it, through
    the one watch the tray's mark already kept (`followDesktopScheme`); with
    no portal, Chromium's own guess stands. Every page follows the
    `prefers-color-scheme` that gives: a classic script in each page's head
    (`public/scheme.js`) sets `data-theme` before the first frame, and the
    window keeps it as the scheme turns (`shared/scheme.ts`). The renderer
    never reads the preference to theme itself.
  - **Nothing of the other scheme shows first.** The first window opens once
    the preferences are read, and every window's paper (`backgroundColor`)
    and the menu bar's sheet's are the page's and a sheet's own shades in
    the scheme (`windowOptions.ts`, held to the tokens by a test), painted
    again when it turns. A canvas that reads the tokens (the light, the
    launch, the halftone mark, an issue's pixels) draws again on the theme's
    change, and the light glows on dark rather than pales.
  - **The tray follows the taskbar or the panel, not the app.** On Windows,
    before the taskbar's own setting is read, the mark falls back to the
    system's scheme (`shouldUseDarkColorsForSystemIntegratedUI`), which
    Appearance doesn't change. On Linux it reads the desktop's setting from
    the Settings portal, as before, now from the watch it shares with the
    windows. The Mac's mark is a template the menu bar colours itself.
- **Alternatives considered:**
  - _Graphite or near-black._ Graphite was the cleanest but lost the paper's
    warmth; near-black gave surfaces almost nothing to lift off, so cards
    and dialogs leaned on hairlines alone. Warm still reads as Althar.
  - _`@media (prefers-color-scheme: dark)` in the tokens, no attribute._
    Storybook, the site and a test can't force a scheme without an
    attribute; the media query alone also duplicates the set or leaves
    no way to show dark beside light. The attribute is set from the scheme.
  - _`light-dark()` per token._ One declaration per colour, but every
    shadow and mix would carry both, and a local override (the island's
    sheet) would turn with the element's `color-scheme`, not the theme's.
  - _Dark-tinted project marks._ Re-shading a mark for dark either lost
    its smallest cell against its ground or changed how it looks between
    themes; a mark is the project's picture.
  - _Theme selectors in components._ Quicker to write, but the dark look
    then lives in thirty places a token review never sees.
- **Trade-off:** Twenty-odd role tokens that are a page shade on paper;
  a dark-only part must be named in `dark.css` and read with its fallback.
  The light of a project's mark is a pale tile on a dark page, as an app's
  icon is in a dark Dock. Pictures stay as they were taken: a screenshot
  shot in light is a bright block in a dark thread.
- **Revisit when:** a second dark is wanted (high contrast, or a darker one
  for OLED), which would be a second attribute's set beside this one;
  Electron reports the Linux desktop's setting itself, when the portal watch
  can go; or a window can be dark while the system is light in a way the
  main process can't express through `themeSource`.
