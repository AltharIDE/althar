# package-linux

## Why

A desktop app jelenleg macOS-re van kitalálva: Linuxon (GNOME, de főleg KDE) az Electron alapértelmezett menüsávja (`File Edit View Window`) látszik, az ablakot a GTK/KDE címsor és ikon keretezi, és nincs Linuxra csomagolt kiadás. A fejlesztők és a korai felhasználók Linuxon dolgoznak, ezért az appnak ott is úgy kell kinéznie (saját ablakgombok, Althar ikon, menüsáv nélkül), és normálisan telepíthetőnek kell lennie (AppImage, deb, rpm, Flatpak).

## What Changes

- **Menüsáv eltüntetése**: az Electron alapértelmezett alkalmazásmenüje nem-macOS platformon megszűnik (`Menu.setApplicationMenu(null)`), a macOS natív menüje változatlan marad.
- **Keret nélküli ablak nem-macOS-on**: a `BrowserWindow` nem-macOS-on `frame: false`-szal jön létre; a macOS megmarad `hiddenInset` + natív traffic lights mellett. A `titleBarStyle`/`trafficLightPosition` csak macOS-en érvényes.
- **Saját ablakgombok**: a felső sáv (`ProjectTabs`) a nem-macOS platformokon valódi, kattintható close/minimize/maximize gombokat rajzol (az eddigi dekoratív `lights="drawn"` helyett), accessible name-mel, fókusszal, hover állapotokkal; dupla kattintás a sávon maximalizál. A macOS lámpái érintetlenek (`lights="space"`).
- **Althar ikon és app-identitás**: X11-en a `BrowserWindow` `icon` beállítása a `resources/icons/cobalt.png`-re; Waylanden (GNOME/KDE) `app.setName('Althar')` + egyező WM class és a csomag `.desktop` fájlja biztosítja a helyes ikont és társítást.
- **Linux csomagolás**: `scripts/package.ts` platformfüggetlenítése (a macOS-specifikus `codesign` lépés leválasztása), és Linux targetek hozzáadása electron-builderrel: **AppImage, deb, rpm**, valamint **Flatpak** (manifest + flatpak-builder, Flathub-kompatibilis metaadatokkal).
- **CI**: a `desktop` workflow Linux artefaktumokat épít (ubuntu runner), és feltölti azokat; a meglévő e2e tesztek változatlanul futnak.
- **Keyring**: a `safeStorage` Linuxon libsecreten keresztül működik (gnome-keyring/kwallet), szükség esetén `password-store` switch-csel; keyring nélkül az app a meglévő hibaüzenettel jelez, nem esik csendben `basic_text`-re.
- **Dokumentáció**: ADR a Linux-támogatás döntéseiről, README/DEVELOPMENT frissítés a Linux futtatással és csomagolással.
- **Nem BREAKING**: macOS viselkedés nem változik; a CLI és a runtime érintetlen.

## Capabilities

### New Capabilities

- `desktop/window-chrome`: az ablak-chrome platformonkénti viselkedése — menüsáv, keret, saját ablakgombok, húzás/maximalizálás, app-ikon és identitás.
- `desktop/linux-packaging`: Linux csomagok (AppImage, deb, rpm, Flatpak), desktop-integráció (ikon, `.desktop`, WM class) és a csomagolt app keyring-viselkedése.

### Modified Capabilities

Nincs — a repóban még nincs `openspec/specs/` alatt capability, és a meglévő viselkedés (macOS, CLI, runtime) nem változik.

## Impact

- **Kód**: `apps/desktop/src/main/main.ts` (menü, ablak-opciók, ikon, window-control IPC), `apps/desktop/src/preload/preload.ts` (platform + window-control bridge), `apps/desktop/src/renderer/features/tabs/TabsFrame.tsx` (platform szerinti `lights` és callbackek), `packages/ui/src/chrome/ProjectTabs/*` (gombok, stílusok, tesztek, Storybook).
- **Csomagolás**: `apps/desktop/scripts/package.ts`, új Flatpak manifest és build script, `apps/desktop/resources/icons` (Linux ikonméret-készlet), electron-builder config.
- **CI**: `.github/workflows/desktop.yml` (Linux build + artefaktumok).
- **Docs**: `docs/decisions/` új ADR, `DEVELOPMENT.md`, `apps/desktop/README.md`.
- **Függőségek**: electron-builder már megvan; Flatpakhoz `flatpak-builder` a CI-ban (rendszereszköz, nem npm dependency).
- **Nem érintett**: runtime, persistence, contracts, provider-adapters, CLI.
- **Nem cél (későbbi change)**: auto-update, Flatpak Flathub publikálás, Linux terminálos bejelentkezés (`openInTerminal`), Fedora COPR repo, macOS notarizáció.
