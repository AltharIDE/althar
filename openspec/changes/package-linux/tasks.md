# package-linux — Tasks

## 1. Spike: Wayland frameless viselkedés

- [ ] 1.1 Mérjük fel, hogy `frame: false` ablakkal hogyan működik a mozgatás, szélhúzásos átméretezés és maximalizálás GNOME Wayland, KDE Wayland és X11 (XWayland) alatt; az eredményt (működik / korlát + fallback) írjuk a design.md Risks szakaszába; ellenőrzés: a mért viselkedés leírása a design.md-ben, és döntés a fallbackről (saját resize-él vagy dokumentált `--ozone-platform=x11`)
- [ ] 1.2 Ha a Wayland resize nem megoldható tisztán, döntsük el és dokumentáljuk a fallbacket ugyanott; ellenőrzés: a design.md frissült, és a 2.x taskok ennek megfelelően indulnak

## 2. Ablak-chrome

- [ ] 2.1 Main: `Menu.setApplicationMenu(null)` nem-darwinon, az app indulásakor; ellenőrzés: új unit teszt a döntés függvényére, és Linuxon futtatva nincs menüsáv
- [ ] 2.2 Main: a `windowOptions(platform)` tiszta függvény kiemelése (frame, titleBarStyle, trafficLightPosition, icon, backgroundColor), és a `BrowserWindow` ezt használja; ellenőrzés: unit tesztek darwinra és linuxra (frame:false, hiddenInset csak darwinon)
- [ ] 2.3 Main: `app.setName('Althar')` és a Linux `icon` beállítása a `resources/icons/cobalt.png`-re; ellenőrzés: X11 alatt futtatva az ablak ikonja Althar, nem generikus
- [ ] 2.4 Preload: `althar.platform` (a preload `process.platform`-ja) és `althar.window(action: 'close' | 'minimize' | 'toggle-maximize')` átadása; ellenőrzés: a preload teszt (ha van) vagy a 2.6 e2e igazolja a csatorna működését
- [ ] 2.5 Main: `ipcMain.on('althar:window', …)` bekötése a sender ablakára (close/minimize/toggle-maximize); ellenőrzés: e2e vagy unit teszt a műveletek célba érésére
- [ ] 2.6 UI kit: a `ProjectTabs` `drawn` módja valódi gombokat rajzol (`onCloseWindow`, `onMinimize`, `onToggleMaximize` callbackekkel), accessible name, fókuszgyűrű, hover; a macOS `space` mód változatlan; ellenőrzés: új komponens tesztek (render, callbackek, billentyűzet, a11y) zölden, Storybook story frissítve
- [ ] 2.7 Renderer: a `TabsFrame` a platform szerint adja a `lights` értéket és beköti a window-callbackeket a preload bridge-re; dupla kattintás a sávon `toggle-maximize`; ellenőrzés: teszt a platform-váltásra és a callbackekre
- [ ] 2.8 E2E: Linuxon (CI, xvfb) nincs menüsáv, a saját gombok megjelennek és működnek (minimalizálás, maximalizálás oda-vissza, bezárás), a macOS viselkedést nem érinti; ellenőrzés: `bun run test:e2e` zölden fut

## 3. App-identitás Linuxon

- [ ] 3.1 A futásidejű WM class egyeztetése a `.desktop` `StartupWMClass`-jával (productName alapján), és szükség esetén korrekció; ellenőrzés: telepített csomaggal KDE Wayland alatt a taszkbár az Althar ikont és nevet mutatja, az ablak a helyes apphoz társul
- [ ] 3.2 A fejlesztői futtatás identitásának dokumentálása (Waylanden futásidőben nincs ikon); ellenőrzés: README/DEVELOPMENT bekezdés megvan

## 4. Linux csomagolás (AppImage, deb, rpm)

- [ ] 4.1 `scripts/package.ts` platform-tudatossá tétele: a macOS-ág (icns, codesign, mac-arm64 útvonal) darwinra kerül, linuxra `AppImage`, `deb`, `rpm` targetek, ikon és kategória; ellenőrzés: Linuxon `bun run package` lefut és mindhárom artefaktum létrejön, macOS-en a script változatlan eredményt ad (száraz futtatás/ellenőrzés)
- [ ] 4.2 Füstteszt: a deb/rpm telepíthető, az AppImage futtatható, az app projektet nyit és a fake agentes e2e végigmegy; ellenőrzés: kézi/CI füstteszt leírása és eredménye
- [ ] 4.3 Csomag-ellenőrzés: ikonok az ikon-témában, `.desktop` `Name`/`Exec`/`Icon`/`StartupWMClass`, indítás GNOME és KDE alatt; ellenőrzés: checklist kitöltve, minden pont zöld

## 5. Flatpak

- [ ] 5.1 Flatpak manifest és build-script (electron-builder `dir` outputra, `org.freedesktop.Platform`, Flathub-kompatibilis metainfo + ikon + `.desktop`); ellenőrzés: `flatpak-builder` build lokálisan lefut, telepíthető és indítható
- [ ] 5.2 Sandbox-viselkedés: projekt- és worktree-mappák elérése, agent-folyamatok futtatása, hálózat, keyring (`org.freedesktop.secrets`); ellenőrzés: GNOME és KDE alatt projekt nyílik, task végigfut; a korlátok dokumentálva
- [ ] 5.3 Engedélyek szűkítése: nincs `--filesystem=host`, minden `finish-args` indokolt és kommentelt; ellenőrzés: manifest review, a fenti futtatás továbbra is zöld

## 6. Keyring

- [ ] 6.1 A main a `safeStorage.getSelectedStorageBackend()`-del elutasítja a `basic_text` backandet (hangos hiba a meglévő üzenettel); ellenőrzés: unit teszt a döntésre + kézi ellenőrzés keyring nélküli környezetben
- [ ] 6.2 Token mentés/olvasás gnome-keyringgel és kwallet-tal; ellenőrzés: kézi ellenőrzés GNOME és KDE alatt, újraindítás után is működik

## 7. CI

- [ ] 7.1 A `desktop` workflow Linux csomagépítő jobot kap (AppImage, deb, rpm) PR-on és mainen, artefaktum-feltöltéssel; ellenőrzés: PR-on zölden lefut, a csomagolás hibája pirosat ad, mainen az artefaktumok letölthetők
- [ ] 7.2 Flatpak build a CI-ban (runtime cache-dzsel, hosszabb timeouttal, külön jobban); ellenőrzés: a job zölden lefut, az artefaktum letölthető
- [ ] 7.3 A meglévő check/coverage/e2e lépések változatlanul zöldek, a coverage gate 90% marad; ellenőrzés: `bun run verify` a desktopon zölden fut

## 8. Dokumentáció és zárás

- [ ] 8.1 ADR a Linux-támogatás döntéseiről (frame:false + saját gombok, csomagformák, Flatpak, keyring), a `docs/decisions/` következő szabad számával; ellenőrzés: ADR fájl megvan, hivatkozik a design.md döntéseire
- [ ] 8.2 `DEVELOPMENT.md` és `apps/desktop/README.md` frissítése a Linux futtatással, csomagolással, Flatpakkal és a waylandes korlátokkal; ellenőrzés: a leírás alapján egy friss gépen reprodukálható a build
- [ ] 8.3 Zárás: `openspec validate package-linux --strict` és `bun run verify` zöld; ellenőrzés: mindkét parancs sikeres, a change review-ra kész
