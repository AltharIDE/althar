# flatpak-reach

## Why

A Flatpak sandboxjából az app nem éri el a gépen telepített eszközöket: a coordinator nem tud elindulni egy hoston telepített agenten — „opencode isn't installed, or isn't on this Mac's PATH" —, holott a csomagolt (Claude Code, Codex) adapterek mennek. A sandboxnak ki kell látnia oda, ahová működnie kell, anélkül hogy bármelyik más futtatási mód (dev, macOS, AppImage, deb, rpm) viselkedése változna.

## What Changes

- **Host-elérés sandboxból**: Flatpakban (`FLATPAK_ID`) a személy saját agent-parancsai (pl. OpenCode) és a szerkesztői `flatpak-spawn --host`-on át futnak a hoston — velük együtt a jelenlét-ellenőrzés (`--version`) és a sign-in parancsok is. A sandboxban futó dolgok (bundled adapterek, Althar által letöltött agentek, git) változatlanok.
- **Beágyazott agent-sandbox adaptálása**: a sandboxban futó agentek saját sandboxja (Codex, Claude reader-szerep) nem tud a Flatpakén belül létrejönni (namespace-tiltás), ezért parancsaik ma elhalnak; Flatpakban a beállításaik ehhez igazodnak — a parancsok fussanak, a kérések továbbra is Altharhoz érjenek, és a **Flatpak saját confinementje** legyen a határ. (A claude writing-szerep `allowUnsandboxedCommands: true`-val már ma így viselkedik, ezért megy.)
- **Manifest**: `--talk-name=org.freedesktop.Flatpak` (host-exec) és `--socket=ssh-auth` (ssh-agent a git pushhoz) hozzáadása; továbbra sincs host fájlrendszer. Az engedélyek indokolva, dokumentálva.
- **Nem-Flatpak futtatás érintetlen**: a host-elérés `FLATPAK_ID`-ra kapuzott; dev/macOS/AppImage/deb/rpm továbbra is lokálisan spawnol; a CLI és a runtime működése változatlan (a CLI profilja Flatpakban külön marad — dokumentált korlát).
- **Hangos hiba**: ha a host nem érhető el (nincs engedély), érthető üzenet szól, nem csendes hibák.
- **Teszt + smoke**: `scripts/flatpak-smoke.sh` kiterjesztése a host-elérésre (ha a gépen van opencode) és az új engedélyekre; a nem-flatpakos utak tesztjei változatlanok.
- **Docs/ADR**: mit ér el a sandbox és mit nem (portál-útvonalak, worktree-k, SSH, profil-szétválás).

## Capabilities

### New Capabilities

- `desktop/sandbox-reach`: a Flatpak kilátása a gépre — a személy saját agentjei és szerkesztői, a sign-in parancsok, a szükséges (szűk) engedélyek, és a nem-Flatpak futtatás változatlansága.

### Modified Capabilities

Nincs — a `desktop/linux-packaging` és `desktop/window-chrome` követelményei nem változnak; ez új, önálló capability.

## Impact

- **Kód**: `packages/runtime/src/Installs.ts` (a személy saját agentjének futtatása — host-exec varrat), az agent-spawn és editors spawn útvonala (`apps/desktop/src/runtime/editors.ts`), esetlegesen egy kis `host-exec` modul; `FLATPAK_ID`-ra kapuzva.
- **Csomagolás**: `apps/desktop/flatpak/dev.althar.app.yml` finish-args + `scripts/flatpak-smoke.sh`.
- **Docs**: ADR + README/DEVELOPMENT a sandbox határairól.
- **Nem érintett**: a git-réteg (a `-C` javítás már megvan a package-linux change-ben), a CLI, az adatbázis, a contracts; **nem BREAKING**.
- **Nem cél**: a CLI és a Flatpak profiljának összevonása, Flathub-beküldés, terminál megnyitása a hoston, a sandboxon kívüli fájlrendszer-engedélyek bővítése.
