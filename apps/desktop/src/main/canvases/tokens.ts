import dark from '../../../../../packages/ui/src/styles/dark.css?raw'
import light from '../../../../../packages/ui/src/styles/tokens.css?raw'

/*
 * Althar's tokens as a canvas reads them (ADR-104), at `/.althar/tokens.css`:
 * the palette, type, spacing and motion the kit draws with, so a mockup looks
 * like the product it is for and a chart reads in both themes. Dark follows
 * the system's scheme, which the canvas view has from Althar's own setting,
 * as Electron's nativeTheme gives every view.
 */

/** The kit's tokens, light, with its dark set where the scheme is dark. */
export const canvasTokens = (tokens = light, night = dark): string =>
  `${tokens}\n@media (prefers-color-scheme: dark) {\n${night.replaceAll(":root[data-theme='dark']", ':root')}\n}\n`
