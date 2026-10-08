# Althar brand pack

Althar's own marks, avatars, banners, wallpapers and screenshots, ready to use, and what draws them. Everything under [`export/`](export) is committed: take the file you need.

The mark is the section through an architect's triangular scale ruler, bored through the middle, with a point in the bore. It is provisional, and so is what is built on it here. The colours and the type are the interface's.

## What's here

| Folder | What | Formats |
| --- | --- | --- |
| [`export/mark`](export/mark) | The mark alone, in colour for light grounds (`ink`) and for dark (`paper`), for Althar's cobalt (`on-cobalt`), and in one colour (`mono-black`, `mono-white`, `mono-cobalt`) | SVG; PNG at 256 and 1024 wide |
| [`export/lockup`](export/lockup) | The mark and the name, `horizontal` or `stacked`, in the same six colourings. The name is outlined, so it needs no font | SVG; PNG at 800 and 2400 (horizontal), 600 and 1800 (stacked) |
| [`export/avatar`](export/avatar) | The mark on a full square, in cobalt, ink or paper, and in the README's printed look (the halftone ruler on paper stock). Places cut it to a circle or round its corners, so it is drawn to survive both | SVG; PNG at 1024, 400 and 128 |
| [`export/banner`](export/banner) | The printed look at each size a place asks for: [see below](#banners) | PNG |
| [`export/wallpaper`](export/wallpaper) | Aurora, the launch's light with the mark set above it, in light and dark: [see below](#wallpapers) | JPEG; the card PNG |
| [`export/app-icon`](export/app-icon) | The six icons Settings offers, and the `.icns` the packaged app wears | SVG; PNG at 1024; `.icns` |
| [`export/emoji`](export/emoji) | The mark on its cobalt tile, and the two signals as dots: cobalt for work running now, violet for something that needs a person | SVG; PNG at 128, for Slack and Discord |
| [`export/web`](export/web) | The favicon kit: SVG, `.ico`, Apple touch icon, and the 192 and 512 icons | |
| [`export/screenshots`](export/screenshots) | Four screens of the app on the demo projects, at 2880 × 1800 | PNG |
| [`export/palette`](export/palette) | The colours, with what each is for | JSON |

### Which avatar goes where

Use the 1024 square wherever a place takes one, and the smaller sizes where it asks for a size.

| Place | Use |
| --- | --- |
| GitHub organisation | `avatar-cobalt-1024.png` |
| X, LinkedIn, Discord, Bluesky, YouTube | `avatar-cobalt-1024.png`, or `-ink`, `-paper` or `-printed` to match the banner beside it. They show it in a circle |
| Slack workspace | `avatar-cobalt-1024.png` |
| Slack and Discord emoji | [`export/emoji`](export/emoji) |

### Banners

All six, and the printed avatar, are the README's printed look: two inks on paper stock, the mark as a halftone, the name off the bottom edge. They differ in how they arrange it for their shape.

| File | Size | Where |
| --- | --- | --- |
| `readme-header.png` | 2560 × 800 | The repository README |
| `github-social-preview.png` | 1280 × 640 | GitHub's social preview, in the repository's settings |
| `og-default.png` | 1200 × 630 | Open Graph and Twitter card, for any page without a card of its own |
| `x-header.png` | 1500 × 500 | X profile header |
| `linkedin-cover.png` | 2256 × 382 | LinkedIn company cover, drawn at twice its 1128 × 191. The logo covers the lower left |
| `youtube-banner.png` | 2560 × 1440 | YouTube channel art. Only the middle 1546 × 423 shows on every screen, so the mark and the name stand in it |

### Wallpapers

Aurora is the launch held at the moment the mark has set: the light the app opens in, standing off the bottom of the screen, and the mark above it as the same halftone. It is drawn from the launch's own light and dots (`packages/ui/src/screens/Launch`), so it changes when they do. On ink the light glows instead of tinting. The site offers them for download at `/wallpaper`.

| File | Size | For |
| --- | --- | --- |
| `aurora-light-mac.jpg`, `aurora-dark-mac.jpg` | 3456 × 2234 | A Mac's own screen, MacBook Air or Pro |
| `aurora-light-display.jpg`, `aurora-dark-display.jpg` | 5120 × 2880 | A 16:9 display, up to 5K |
| `aurora-light-phone.jpg`, `aurora-dark-phone.jpg` | 1290 × 2796 | A phone; the mark sits below the lock screen's clock |
| `aurora-<theme>-mac-preview.jpg`, `aurora-<theme>-phone-preview.jpg` | 1600 and 600 wide | Showing the wallpaper on a page |
| `aurora-card.png` | 1200 × 630 | The link preview of the site's wallpaper page |

A screen of another shape fills itself from the nearest one. The mark and the light keep to the middle, so the crop only takes the light's edges.

## Using the mark

These are the rules the interface and the site already keep, written down.

- **Colour.** The full-colour mark is ink with a cobalt point on light grounds, and paper with a lifted cobalt point on ink. On cobalt, use `on-cobalt`: the open bore shows the ground. Where only one colour is allowed, use `mono-*`.
- **Violet is not Althar's.** It means that something needs a person. Never put it in the mark or the name.
- **Clear space.** Leave half the mark's height clear on every side.
- **Size.** The mark reads down to 16 px. The lockup, down to 80 px wide.
- **The name** is Inter at weight 650, set tight. Outside these files, set it the way the site does.
- **Don't** recolour, outline, rotate, stretch, shadow or crop the mark, or put it on a busy picture.

Other companies' marks, such as Claude, Codex, GitHub and Linear, are not here: they are those companies' trademarks, with rules of their own.

## Making them

The pack is drawn by the code in this package; nothing is exported by hand.

```bash
bun install --frozen-lockfile            # from the repository root
bun --filter @althar/brand export             # marks, lockups, avatars, emoji, web, app icons, banners
bun --filter @althar/brand export:banners     # just the banners and the printed avatar; name some to draw only those
bun --filter @althar/brand export:wallpapers  # just the wallpapers
bun --filter @althar/brand export:screenshots # the screenshots (builds the UI package's Storybook first if it isn't built)
```

Change the drawing, run the export, and commit what it writes: `bun run test` fails while `export/` doesn't match the code. It also fails if a copy of the mark elsewhere in the repository (the UI package's Logo, the pitch, a favicon) stops matching [`src/geometry.ts`](src/geometry.ts), if the colours stop matching the interface's, or if the app icons differ from the desktop app's.

The banners, the printed avatar, the wallpapers and the screenshots are drawn in a browser, so they are not byte-for-byte reproducible between machines; the rest is. Draw the wallpapers again when the launch's light or dots change.

Screenshots show the app as it is when they are taken. Take them again when a screen changes, and before a launch.
