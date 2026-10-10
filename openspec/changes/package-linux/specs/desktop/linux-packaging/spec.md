## Purpose

A Linuxra csomagolt Althar kiadását írja le: a csomagformákat (AppImage, deb, rpm, Flatpak), a desktop-integrációt (ikon, `.desktop`, WM class) és a csomagolt app keyring-viselkedését.

## ADDED Requirements

### Requirement: Linux csomagformák

A build SHALL AppImage, deb és rpm csomagot állítson elő a desktop appból, a meglévő macOS csomagolás érintetlenül hagyása mellett. Mindegyik csomag SHALL tartalmazza az app futtatásához szükséges összes erőforrást (agent adapterek és azok binárisai, ikonok, tray-képek).

#### Scenario: Csomagok előállítása

- **WHEN** a csomagoló script lefut Linuxon
- **THEN** létrejön az AppImage, a deb és az rpm artefaktum

#### Scenario: Telepített app indítása

- **WHEN** a felhasználó telepíti a deb/rpm csomagot, vagy futtatja az AppImage-et
- **THEN** az app elindul, projektet nyit, és egy task a fake agenttel végigfut

### Requirement: Flatpak csomag

A repó SHALL Flatpak manifestet és build-leírást tartalmazni, amely az appot Flathub-kompatibilis metaadatokkal csomagolja. A Flatpak SHALL működőképes maradjon sandboxban: a felhasználó által választott projekt- és worktree-mappák elérése portalon vagy szűk `filesystem` engedélyen keresztül történik, az app működéséhez szükséges egyéb engedélyek pedig a lehető legszűkebbek.

#### Scenario: Flatpak build és futtatás

- **WHEN** a Flatpak elkészül és elindul GNOME vagy KDE alatt
- **THEN** az app elindul, mappa-választóval projektet nyit, és a fájlelérés a sandbox szabályai szerint működik

#### Scenario: Sandbox-engedélyek

- **WHEN** a Flatpak manifestet vizsgáljuk
- **THEN** nincs `--filesystem=host` vagy hasonló korlátlan hozzáférés; az engedélyek indokoltak és dokumentáltak

### Requirement: Desktop-integráció

A Linux csomagok SHALL telepíteni az Althar ikont az ikon-témába és egy `.desktop` fájlt helyes `Name`, `Exec`, `Icon` és `StartupWMClass` mezőkkel, hogy a taszkbár, az appváltó és a felső sáv az Althar ikont és nevet mutassa, és az ablak a futtatható fájlhoz társuljon. Waylanden az ikon SHALL a `.desktop` fájlból származni, mert futásidőben nem állítható.

#### Scenario: Társítás ellenőrzése

- **WHEN** a telepített app fut KDE Wayland és GNOME Wayland alatt
- **THEN** a taszkbárban az Althar ikon látszik, és a jobb klikkes menü a helyes alkalmazáshoz társítja az ablakot

### Requirement: Keyring-viselkedés

A csomagolt app SHALL a titkokat (pl. code host tokenek) az operációs rendszer keyringjén keresztül pecsételje meg és nyissa ki (`safeStorage` libsecret-tel: gnome-keyring vagy kwallet). Ha a keyring nem elérhető, az app SHALL érthető hibát jelezni a felhasználónak, és SHALL NOT essen csendben `basic_text` tárolásra.

#### Scenario: Token mentése keyringgel

- **WHEN** a felhasználó egy code hosthoz tokent ad meg, és a keyring elérhető
- **THEN** a token a keyringben tárolódik, és az app újraindítás után is használni tudja

#### Scenario: Keyring hiánya

- **WHEN** a keyring nem elérhető
- **THEN** az app a meglévő hibaüzenettel jelzi a problémát a token műveleteknél, és nem tárol titkot védelem nélkül

### Requirement: CI Linux artefaktumok

A `desktop` CI workflow SHALL Linuxon is lefuttatni a csomagolást, hogy a csomagolás törése pull requesten kiderüljön; a csomagok artefaktumként SHALL feltöltődjenek, és a meglévő check, coverage és e2e lépések SHALL változatlanul zölden futni.

#### Scenario: Pull request csomagolással

- **WHEN** pull request nyílik a desktop érintő változtatással
- **THEN** a CI lefut, a Linux csomagok elkészülnek, és hiba esetén a PR piros lesz

#### Scenario: Artefaktumok feltöltése

- **WHEN** a CI sikeresen lefut a main ágon
- **THEN** az AppImage, deb, rpm (és Flatpak build) artefaktumként letölthető
