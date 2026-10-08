# @althar/brand — Architecture

Althar's brand assets as files, and the code that draws them. The repository's [ARCHITECTURE.md](../ARCHITECTURE.md) sets the general engineering target.

- **Owner:** Repository maintainers
- **Consumers:** People: marketing, the site, and anyone who needs a mark or an image. No package imports it.
- **Dependency direction:** depends on nothing else in the repository. It reads other packages' files only in its tests, to check them against its own.

## What it holds

| Path | What it does |
| --- | --- |
| `src/geometry.ts` | The mark's drawing, once, on its 24 grid |
| `src/palette.ts` | The colours, as the interface defines them |
| `src/mark.ts`, `lockup.ts`, `avatar.ts`, `emoji.ts` | Each kind of asset, as a function from a style to SVG |
| `src/catalog.ts` | Every file the pack writes, and the PNGs to make from them. Draws nothing to disk |
| `src/banners.ts`, `screenshots.ts` | What the browser-drawn assets are, and at what size |
| `src/files.ts` | Writing files and rasterising SVG. The only module that touches the disk |
| `banners/printed.html` | The printed look, drawn on canvases at any size it is asked for |
| `scripts/` | `export`, `banners` and `screenshots`: what runs the above |
| `export/` | What was drawn, committed |

## Principles

- **Drawn, not exported.** Every asset comes from code, so a change to the mark or a colour reaches all of them in one run, and a reviewer can read what changed.
- **One mark.** The geometry lives in `src/geometry.ts`. The copies the other packages have to keep (a component, a favicon, a card) are held to it by tests; the banner page takes it from the script that opens it instead of keeping a copy.
- **The app's own, not a redraw.** The app icons are copied from the desktop app's resources, and a test fails if the copy differs.
- **Text is outlined.** A lockup's name is turned to paths from Inter itself, so the file looks the same wherever it opens and needs no font.
- **The export is checked in and checked.** `export/` is the product, so a test reads it back against the code.
- **Not the interface's glyphs, project marks or other companies' marks.** The UI icon set is a third party's (Iconoir, MIT), project marks belong to the app, and the agents' and trackers' marks are trademarks; none is part of the pack.

## Checks

- `bun run check`: format, type-aware lint and type checks.
- `bun run test`: a few tests, each guarding something that would otherwise go wrong silently: the mark's copies elsewhere in the repository, the colours, the app icons and `export/` against the code; the mark's bounds, which the lockups and avatars are placed by; the wordmark against the browser's metrics; the avatars' circle-safe margin; the `.ico` header.
- **No coverage gate.** The repository asks for 90% of production code. This package ships none: it draws files, and its scripts drive a browser and the disk. A test for each line would mostly restate the code, so the tests above guard the invariants and the scripts are exercised by running them.

## Gaps

- **Everything provisional.** The mark, the avatars' grounds and the banners' arrangements follow the identity as it stands, and change with it.
- **No animation.** The launch animation and the site's motion are not exported as video.
- **No installer art.** A DMG background, the Developer ID and notarised build wait for the packaged app.
- **Screenshots are by hand.** `export:screenshots` takes them; nothing checks they are current.
