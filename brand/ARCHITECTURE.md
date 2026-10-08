# @althar/brand — Architecture

Althar's brand assets as files, and the code that draws them. The repository's [ARCHITECTURE.md](../ARCHITECTURE.md) sets the general engineering target.

- **Owner:** Repository maintainers
- **Consumers:** People: marketing, the site, and anyone who needs a mark or an image. No package imports it.
- **Dependency direction:** depends on `@althar/ui` for one thing, the project-mark generator (`@althar/ui/project-mark`), so a mark here is the one the app draws. It imports nothing else from the repository.

## What it holds

| Path | What it does |
| --- | --- |
| `src/geometry.ts` | The mark's drawing, once, on its 24 grid |
| `src/palette.ts` | The colours, as the interface defines them |
| `src/mark.ts`, `lockup.ts`, `avatar.ts`, `emoji.ts`, `project-marks.ts` | Each kind of asset, as a function from a style to SVG |
| `src/catalog.ts` | Every file the pack writes, and the PNGs to make from them. Draws nothing to disk |
| `src/banners.ts`, `screenshots.ts` | What the browser-drawn assets are, and at what size |
| `src/files.ts` | Writing files and rasterising SVG. The only module that touches the disk |
| `banners/printed.html` | The printed look, drawn on canvases at any size it is asked for |
| `scripts/` | `export`, `banners`, `screenshots` and `project-mark`: what runs the above |
| `export/` | What was drawn, committed |

## Principles

- **Drawn, not exported.** Every asset comes from code, so a change to the mark or a colour reaches all of them in one run, and a reviewer can read what changed.
- **One mark.** The geometry lives in `src/geometry.ts`. The copies the other packages have to keep (a component, a favicon, a card) are held to it by tests; the banner page takes it from the script that opens it instead of keeping a copy.
- **The app's own, not a redraw.** Project marks use the UI package's generator and the app icons are copied from the desktop app's resources. A test fails if the copy differs.
- **Text is outlined.** A lockup's name is turned to paths from Inter itself, so the file looks the same wherever it opens and needs no font.
- **The export is checked in and checked.** `export/` is the product, so a test reads it back against the code.
- **Not the interface's glyphs, and not other companies' marks.** The UI icon set is a third party's (Iconoir, MIT) and the agents' and trackers' marks are trademarks; neither is part of the pack.

## Checks

- `bun run check`: format, type-aware lint and type checks.
- `bun run test:coverage`: the drawing modules, and the drift tests that hold the mark's copies, the colours, the app icons and `export/` to the code. The scripts that drive a browser are exercised by running them.

## Gaps

- **Everything provisional.** The mark, the avatars' grounds and the banners' arrangements follow the identity as it stands, and change with it.
- **No animation.** The launch animation and the site's motion are not exported as video.
- **No installer art.** A DMG background, the Developer ID and notarised build wait for the packaged app.
- **Screenshots are by hand.** `export:screenshots` takes them; nothing checks they are current.
