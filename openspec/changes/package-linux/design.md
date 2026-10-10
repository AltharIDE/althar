## Context

Lásd `proposal.md` — Why. A jelenlegi állapot, ami az approach-ot alakítja:

- `apps/desktop/src/main/main.ts` `openWindow()`-je macOS-re szabott: `titleBarStyle: 'hiddenInset'` és `trafficLightPosition` (mindkettő macOS-only), a menü pedig az Electron alapértelmezett menüje, mert `Menu.setApplicationMenu` sehol nincs hívva.
- A felső sáv (`packages/ui/src/chrome/ProjectTabs`) már drag-régió (`-webkit-app-region: drag`, a gombok `no-drag`), és a `lights` prop három módot ismer: `space` (macOS lámpák helye), `drawn` (dekoratív pöttyök), `none`. A `drawn` jelenleg nem interaktív.
- A preload (`apps/desktop/src/preload/preload.ts`) szűk bridge; platform-információt és ablak-műveleteket nem ad át.
- `apps/desktop/scripts/package.ts` kizárólag `mac-arm64`-et gyárt, `codesign --deep` lépéssel; az electron-builder már dependency. A stage-logika (dist + ikonok + adapterek npm install-lal, `asar: false`) platformfüggetlen.
- A CI (`desktop.yml`) ubuntu-24.04-en fut, `xvfb-run`-nal futtatja az e2e-t; a csomagolás CI-ban még nincs.
- A tokenek pecsételése `safeStorage`-dal történik a main-ben; Linuxon ez libsecreten át megy, keyring nélkül `basic_text`-re eshet.
- `resources/icons/cobalt.png` és társai megvannak; `icon.icns` a macOS csomaghoz.

## Goals / Non-Goals

**Goals:**

- Linuxon (GNOME, KDE; X11 és Wayland) natív küllem: menüsáv nélkül, rendszer-keret nélkül, saját ablakgombokkal, Althar ikonnal.
- Telepíthető Linux csomagok: AppImage, deb, rpm, Flatpak — minden ágon CI-s build-teszt; publikálás mainre érkező, új version taggel, verify után.
- A macOS viselkedés bitre változatlan; a meglévő tesztek és a 90%-os coverage gate zölden marad.

**Non-Goals:**

- Auto-update, Flathub beküldés, Fedora COPR, Linux terminálos bejelentkezés (`openInTerminal`), macOS notarizáció, verzióléptetési folyamat (a publish a meglévő version tagekre épül).
- A runtime, CLI, contracts, provider-adapters érintése.

## Decisions

### 1. `frame: false` a nem-macOS ablakokon, saját gombokkal

Nem-macOS-on `frame: false`; a macOS marad `hiddenInset`. Elvetett alternatíva: `titleBarStyle: 'hidden'` + `titleBarOverlay` — a natív Window Controls Overlay gombjai GNOME és KDE alatt eltérően néznek ki, és nem illeszkednek az Althar felső sávjához; a felhasználói kérés saját gombokra szól.

### 2. Az ablakgombok a UI kitben, callbackekkel

A `ProjectTabs` a nem-macOS `lights='drawn'` módban három valódi `<button>`-t rajzol (bezárás, minimalizálás, maximalizálás; `aria-label`, fókuszgyűrű, hover). A kit nem hív Electron-API-t: `onCloseWindow`, `onMinimize`, `onToggleMaximize` callbackeket kap, ezeket a `TabsFrame` köti be. A gombok a meglévő lámpa-stílust viszik tovább (hover-színek), így a design nyelv egységes marad. A macOS `space` módban marad: ott a rendszer rajzol.

### 3. Platform a rendererben, preloadon át

A sandboxolt preload `process.platform`-ját adjuk át (`althar.platform`), és a `TabsFrame` ez alapján választ `lights` értéket (`darwin` → `space`, egyébként `drawn`). Alternatíva: main küldi IPC-n — felesleges kör.

### 4. Ablak-műveletek egy szűk IPC-csatornán

Új csatorna: `althar:window` (`close` | `minimize` | `toggle-maximize`), `ipcMain.on`-nal, a sender ablakára alkalmazva (`BrowserWindow.fromWebContents`). Nem `invoke`, nincs visszatérés; a maximalizálás állapotát nem szinkronizáljuk (a gomb toggle-ként viselkedik). **Mérés:** a sávon (drag-régió) a dupla kattintást a platform kezeli — KDE Wayland és XWayland alatt natívan maximalizál/visszaállít, és a renderer nem kap `dblclick` eseményt, ezért nincs app-szintű kezelő (az felesleges, és dupla-toggle-ot okozna ott, ahol mégis eljutna a rendererig).

### 5. Menü: `Menu.setApplicationMenu(null)` nem-macOS-on

Az app indulásakor, nem-darwinon megszűnik az alapértelmezett menü. Elvetett alternatíva: `autoHideMenuBar` — Alt-tal előhozható maradna, és nincs értelmes menütartalom. macOS-en a mai (alapértelmezett) menü marad, mert a change nem nyúl hozzá.

### 6. Ikon és identitás Linuxon

- X11: `new BrowserWindow({ icon })` 128×128-ra méretezett `nativeImage`-dzsel — mérés: a 256×256 és nagyobb kép némán nem kerül be (`_NET_WM_ICON` üres marad, X11 property-méret), a 128-as igen.
- `app.setName('Althar')` + a csomag `.desktop` fájlja `StartupWMClass`-jal (electron-builder állítja elő a `productName`-ből; ellenőrizni kell, hogy a futásidejű WM class egyezik). Mérés fejlesztői futtatásból XWaylanden: `WM_CLASS = "althar", "althar"`, `_NET_WM_NAME = "Althar"` — a `.desktop` `StartupWMClass`-ja ehhez igazodjon (3.1).
- Waylanden futásidőben nem lehet ikont adni — ezért a fejlesztői futtatás ikonja a legjobb eset; a telepített csomagé a `.desktop`-ból jön. Ez dokumentált korlát.

### 7. Csomagolás: platform-tudatos `scripts/package.ts`

A script `process.platform` szerint ágazik: darwinon a mai mac target + `codesign`; linuxon electron-builder targetek: `AppImage`, `deb`, `rpm` (icon: `resources/icons/cobalt.png` 512+ méretben, `category: Development`). A mac-specifikus lépések (icns, codesign, mac-arm64 útvonal) darwinra kerülnek. A stage/npm/`asar: false` logika közös. Linux targeteket Linuxon (CI: ubuntu) építünk, nem kereszten.

### 8. Flatpak: külön manifest, electron-builder outputra építve

Az electron-builder `dir` targetjéből (`linux-unpacked`) építünk `flatpak-builder`-rel, `org.freedesktop.Platform` runtime-nal, `dev.althar.app` app-id-vel, Flathub-kompatibilis metadatokkal (appstream metainfo, ikon, `.desktop`). `finish-args`: `--share=network` (agentek hálózata), `--socket=x11 --socket=wayland`, `--socket=fallback-x11`, `--talk-name=org.freedesktop.secrets` (keyring), és szűk fájlhozzáférés a portálon át (nem `host`). A manifest és a build script a repóban él; a Flathub-beküldés nem része a change-nek.

### 9. Keyring: `basic_text` tiltása

A main a `safeStorage.getSelectedStorageBackend()`-del ellenőrzi a backendet; ha `basic_text`, a pecsételés a keyring-hibával elutasítva (nem csendes plaintext). Az üzenet a main-ből a runtime `words.ts`-én át a window-ig jut, és Linuxon megmondja, mit kell telepíteni (gnome-keyring vagy KWallet); a deb `Recommends`-ként hozza a keyring-alternatívákat. Induláskor nem kényszerítünk `password-store` switch-et; ha a tesztek GNOME/KDE alatt mást kívánnak, ott vesszük fel.

### 10. Tesztelhetőség és coverage

A main process ablak-opciói kiszűrhetők egy tiszta `windowOptions(platform)` függvénybe, ami unit-tesztelhető. A UI kit gombjaihoz komponens tesztek (render, callback, a11y, billentyűzet), a `TabsFrame` platform-váltásához teszt, az e2e (már Linuxon fut) ellenőrzi, hogy nincs menüsáv, és a saját gombok működnek. Coverage gate: 90% marad.

### 11. Publish csak mainen, új version taggel

A csomagépítés minden ágon build-teszt, publikálás nélkül; a dev/feature/fix ágak csomagjait lokálisan buildeljük. A publish job csak main pushra indul, a HEAD-on lévő version tag esetén, és csak új tagra (amelyhez még nincs kiadás) csatolja a csomagokat a GitHub Release-hez; feltétele a verify zöld eredménye (`needs`). Új tag nélkül a main push is publish nélkül fut. Verzióléptetés nem része a change-nek: a tag a kiadás forrása.

## Risks / Trade-offs

- **[Wayland frameless resize/move — mérési eredmény]** → Spike (Electron 44.5.0, frameless tesztablak):
  - **KDE Plasma Wayland (Fedora 44):** zöld — szélhúzásos átméretezés, felső sávos mozgatás, dupla kattintásos maximalizálás/visszaállítás működik; fallback nem kell.
  - **X11 / XWayland (Fedora 44):** zöld — ugyanaz a három művelet működik; fallback nem kell.
  - **GNOME Wayland:** függőben — mérés GNOME session alatt (telepítés után); fallback (dokumentált `--ozone-platform=x11` vagy saját resize-él) csak akkor jön szóba, ha ott piros lesz.
- **[GNOME vs KDE eltérések]** → kézi ellenőrzési mátrix (X11/Wayland × GNOME/KDE) a tasksban; a saját gombok mindkettőn azonosak, mert nem a rendszer rajzolja.
- **[Flatpak sandbox vs agent-folyamatok és keyring]** → a bundled agent-binárisok sandboxban futnak; hálózat `--share=network`-kel; a keyring `org.freedesktop.secrets`-en át; ha a safeStorage a Flatpakban nem megy, dokumentált korlát + külön change.
- **[Keyring hiánya fejlesztői gépen]** → a `basic_text` elutasítása hangos hiba; a keyring telepítése (gnome-keyring/kwallet) dokumentálva.
- **[CI idő és Flatpak runtime letöltés]** → cache a flatpak runtime-ra, külön job, hosszabb timeout; a verify lépések maradnak a gyors jobban.
- **[Coverage gate új kódon]** → a logika tesztelhető függvényekbe szervezve; a vékony main/preload réteget e2e fedi.

## Migration Plan

Nincs adat- vagy viselkedés-migráció: macOS változatlan, Linuxon az eddigi fejlesztői futtatás kinézete javul. Visszaállás: a `package-linux` branch revertje. A csomagok első kiadása előtt a README „packaged app: not done yet" szakaszát frissíteni kell Linuxra vonatkozóan.

## Open Questions

- Az rpm build ubuntu runneren (fpm-mel) vagy konténerben fusson-e — a packaging task méri meg, nem befolyásolja a specet.
- A Flatpak app-id (`dev.althar.app`) véglegesítése a Flathub-beküldés előtt — a mostani appId marad.
