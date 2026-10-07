# App icons

The icons a person can give Althar in Settings, as the main process puts them on the Dock and Settings shows them. Each is an SVG drawn from the mark's geometry (the Logo in `@althar/ui`) on Apple's 1024 icon grid, and a 512 PNG made from it, since the Dock takes no SVG.

The drawings come from the icon exploration in the designs repository (`althar-icons/icons.js`). Change them there, export both files again, and keep the names: `src/main/appIcon.ts` and `src/renderer/shared/appIcons.ts` list them.

The packaged app's own icon, the one Finder and the Dock show while it isn't running, is `../icon.icns`: Cobalt, at every size macOS asks for.
