# shared/footer

The site's footer on every page: the statement, the links, and the LinkedIn banner's scene under them.

- `Footer.tsx`: places the scene (`placeOf`) so the land keeps under the words and the lighthouse stays in view; on a narrow screen it shows the narrow crop. The picture loads as the footer comes near (or once the page is idle) and fades in.
- `engraving.ts`: where things are in the picture (1916 by 821): `LIGHTHOUSE_X`, `LAND_Y`, and the files by name.
- `engraving/`: the picture in AVIF and WebP, whole and the narrow crop. Made by `scripts/engraving.ts --as-is <scene.png>` from the brand guide's LinkedInPersonal banner, drawn without its words (the engraving with lighthouse and canoes, the colour under the water, the beam, the labs' flags, Althar's boats). Drawn on white so the sky is the page's paper.
- `parts.tsx`: the signature and the links, shared with other pages' footers.
- `random.ts`: a seeded random, also used by the hero's plate and the page grain.

Gotchas: nothing in the scene moves now (the old altar's canvas light is gone). If the picture changes, check `LIGHTHOUSE_X`, `LAND_Y` and the crop (`CROP` in Footer.tsx and the script).
