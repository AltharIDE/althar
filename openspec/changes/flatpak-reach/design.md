## Context

Lásd `proposal.md` — Why. A jelenlegi állapot, ami az approach-ot alakítja:

- Flatpakban a sandbox ennyit lát: hálózat, wayland/fallback-x11, dri, `org.freedesktop.secrets` — host fájlrendszer nincs. A személy saját agent-parancsát a `provider-adapters` a PATH-ból és a szokásos helyekről keresi, és az `Installs.ts` `execFile(command, …)`-dal futtatja: a sandboxban egyszerűen nincs meg (mért hiba: „opencode isn't installed, or isn't on this Mac's PATH", miközben a coordinator OpenCode-ra volt állítva).
- A projektmappák a dokumentum-portálon át érkeznek: a sandboxban `/run/user/1000/doc/<id>/…`, ami a sandboxon belül `/run/flatpak/doc/<id>/…`-ra oldódik fel — **a hoston viszont csak a `/run/user/1000/doc/…` forma létezik**. A runtime a feloldott (`/run/flatpak/doc/…`) formát tárolja a projekt soraiban. A worktree-k a profil mellett (`~/.var/app/dev.althar.app/…`) élnek, ami a hoston is ugyanaz az útvonal.
- A git a sandboxban fut (a `-C` javítással a FUSE-cwd problémát elkerüli); az Althar által letöltött agentek a profilba kerülnek, tehát sandbox-láthatók.
- A `flatpak-spawn --host` a Flatpak része; `--talk-name=org.freedesktop.Flatpak` engedéllyel hívható, és a host session-ben futtat parancsot.

## Goals / Non-Goals

**Goals:**

- Flatpakban a személy saját agentjei (és szerkesztői, sign-in parancsai) a hoston fussanak, a meglévő `Installs`/editor-utak viselkedését megtartva.
- A hoston futó processzek a helyes útvonalakat kapják (portál- és worktree-utak a hoston is érvényesek).
- A nem-Flatpak futtatás bitre változatlan; minden új logika `FLATPAK_ID`-ra kapuzott.

**Non-Goals:**

- A CLI és a Flatpak profiljának összevonása; Flathub-beküldés; host-terminál megnyitása; host fájlrendszer-engedélyek.

## Decisions

### 1. Host-elérés `flatpak-spawn --host`-tal, `FLATPAK_ID`-ra kapuzva

A személy saját parancsai (agent locate/version/sign-in, szerkesztő) Flatpakban `flatpak-spawn --host`-on át futnak. Elvetett alternatívák: (a) dokumentált korlát — a coordinator nem működne a legfontosabb agenten; (b) a host-binárisok bemásolása `--filesystem` engedéllyel — törékeny, a függőségeket és a host-configot nem hozza; (c) több agent becsomagolása — jogilag/méretben sem skálázódik. A kapu `process.env.FLATPAK_ID`; nélküle minden közvetlen spawn marad. Aki az agentet Althar-tól kérte le (letöltött példány), annak a példánya Flatpakban is a sandboxban marad (a spec letöltött-agent esete, „és nem a hoston"); a hoston talált saját példány akkor fut, ha Althar-nak nincs letöltött példánya — a bundled másolat pedig akkor, ha a host sem érhető el vagy ott nincs parancs.

### 2. A varrat az `Installs`-ban, a bekötés a desktop runtime-ban

A `packages/runtime` (CLI-val közös) nem tudhat a Flatpakról: kap egy `hostExec` opciót/seamet (parancs+args+env futtatása), amit az `apps/desktop/src/runtime/runtime.ts` köt be `FLATPAK_ID` esetén `flatpak-spawn --host`-ra. A CLI és a nem-Flatpak app ugyanazt a közvetlen utat futja, mint ma.

### 3. Útvonal-fordítás a host-futásnál (a legfontosabb implikáció)

A runtime `/run/flatpak/doc/…` formát tárol; a hoston az a `/run/user/1000/doc/…`. Host-spawn előtt a sandbox-specifikus prefixet át kell írni (`/run/flatpak/doc` → `/run/user/1000/doc`), különben a hoston futó agent nem találja a repót. A fordítás csak a host-spawn határán történik (arguments/env/cwd), a tárolt és sandboxban használt utak változatlanok. Worktree-utak (`~/.var/app/…`) fordítást nem igényelnek.

**Mérés (2026-10-10, Flatpak 1.18.4):** a portal-azonosítók ugyanazok a két oldalon (`/run/flatpak/doc/<id>` a sandboxban = `/run/user/1000/doc/<id>` a hoston; a host több bejegyzést lát, a sandbox a saját grantjeit); a profil és a worktree-k abszolút útja **bitre ugyanaz** a két oldalon (`$XDG_DATA_HOME` a sandboxban is `~/.var/app/dev.althar.app/data`), így fordításra csak a portal-utak szorulnak.

### 4. Env a host-futásnak

A sandbox env-je nem tartalmazza a host PATH-ját: a hoston futó parancsot a host login shell-jén át indítjuk (`flatpak-spawn --host sh -lc '…'`) vagy explicit host PATH-tal; a spike dönt a részletekről. A `HOME` a host-homen marad (az agent configja ott él) — ez a cél.

**Mérés (2026-10-10, Flatpak 1.18.4):** a `flatpak-spawn --host` a host **session** env-jét adja a parancsnak (PATH-jában ott van az opencode; `HOME=/home/mkokai`, `cwd` a host-home, `SSH_AUTH_SOCK` a host agenté), a sandbox env-jét **nem** adja át (csak az explicit `--env=`/`--env-fd=` értékek mennek át). Ezért a futás env-je **épül, nem öröklődik**: `--clear-env` + a device néhány neve (HOME, PATH, a host sessionből egyszer beolvasva; TMPDIR/LANG/XDG_RUNTIME_DIR, ha van) + amit az executor az agentnek adott (fiók-homok, `CODEX_HOME`/`CODEX_CONFIG`, `OPENCODE_CONFIG_*`, a signed-out git-beállítások — az „ambient sandbox értéktől eltér" szűrővel). Így a device ssh-agentje és bejelentkezett eszközei nem érnek el agentet (ADR-011). A `DBUS_SESSION_BUS_ADDRESS` öröklődik, mert magának a `flatpak-spawn`-nak kell. A `cwd`-t `--directory=` adja át; TERM átfut, KILL nem — ezért `--watch-bus`, különben a hoston ragad a process.

### 5. SSH: `--socket=ssh-auth`, fájlrendszer nélkül

A git push ssh-agenten át megy (a socket engedély); `~/.ssh` olvasás nincs megadva. A tokenes (https) út marad a Flatpak-barát alapérték; az ssh korlátai dokumentálva.

**Mérés (2026-10-10):** a socket megvan (`SSH_AUTH_SOCK=/run/flatpak/ssh-auth` a sandboxban), és a sandbox `ssh`-je el is éri; viszont a sandbox home-ja körönként friss, így `known_hosts` és tárolt credential helper nincs benne — a sandboxos ssh a hostkulcs-ellenőrzésnél áll meg. (Ezen a gépen a host agentben sem volt kulcs, így a publickey-lépés itt nem volt mérhető.) Ezért a Flatpakban a push a code host tokenes útján megy (a kapcsolatok), az ssh-lépések a device termináljáé.**

### 6. Hibák hangosan

Ha a `flatpak-spawn` nem elérhető/megtagadott, az agent indítása érthető üzenettel áll meg (a meglévő szó-tárban, `words.ts`), nem „nincs telepítve" látszattal. Az `Installs` `onDevice` seamje jelzi, ha a device egyáltalán nem érhető el: ilyenkor a személy saját parancsa még mindig „kint" fut, hogy a hiba a megoldandót mondja (az engedélyt), ne a hiányzó telepítést.

### 7. Engedélyek és a smoke

Manifest: `+ --talk-name=org.freedesktop.Flatpak`, `+ --socket=ssh-auth` (indoklással). A `flatpak-smoke.sh` ellenőrzi az új engedélyeket, a host-elérést (`flatpak-spawn --host true`, a Codex-híd léte), és — ha a hoston van opencode, illetve codex — a host-elérést velük; a „nincs host fájlrendszer" ellenőrzés marad.

### 8. Beágyazott agent-sandbox: Codex a device-en, Claude a fallbackjével

**Mérés (2026-10-10, Flatpak 1.18.4):** a sandboxban a `unshare` (user/network namespace) `EPERM` — a Flatpak szándékosan nem enged beágyazott sandboxot. A Codex Linux-sandboxja bubblewrapet épít és user namespace-t kér, így a sandboxban nem indul (`codex sandbox` → „No permissions to create a new namespace"); a codex-acp 2.1.1/2.2.2 négy módja közül egyik sem adja egyszerre a sandbox kikapcsolását **és** a kérések Altharhoz érkezését (`agent-full-access`: soha nem kérdez; `agent`: auto-reviewerre megy). A Claude írás-szerepe már ma azért megy, mert `allowUnsandboxedCommands: true` („Where the sandbox can't start, commands run without it and every one asks").

**Döntés:**
- **Claude Code** Flatpakban (`FLATPAK_ID`) a csak-olvasó szerep is `allowUnsandboxedCommands: true`-val indul: a beágyazott sandbox ott sem tud létrejönni, a parancsok sandbox nélkül futnak, és mindegyik Althar kérésén megy át; a confinement a Flatpaké. Sandboxon kívül minden beállítás változatlan.
- **Codex** Flatpakban a **személy saját, device-on telepített Codexét** hajtja az adapter (`CODEX_PATH=/app/bin/althar-host-codex`, `flatpak/codex-host.sh`): a híd `flatpak-spawn --host`-on át indítja a host `codex app-server`-ét (a saját sandboxja ott, ahol a user namespace-ek mennek), stdio-n beszélnek egymással, és a híd név szerint viszi át a fiók-home-ot (`CODEX_HOME`), az MCP-szűrőt (`CODEX_CONFIG`) és a signed-out git-beállításokat; ssh-agent nem megy át. Ha a device-on nincs Codex, a híd érthető mondattal áll meg (a hibaüzenet az agent-stop üzenetében jelenik meg). Az ok: a beágyazott Codex a Flatpakban nem tud sandboxolni, és az adapter nem tud sandbox nélkül **kérdezni** — így a saját telepítés futtatása az egyetlen út, amelyiken minden lépés Altharnál kérdez. Sandboxon kívül a `CODEX_PATH` nincs beállítva: minden változatlan.
- Elvetett alternatívák: a bundled bwrap cseréje/hidak (a Codex saját integritás-ellenőrzésének megkerülése), a sandbox device-ra relayelése (a Flatpak confinementjének megkerülése), `agent-full-access` a sandboxban (a kérések elvesztése).

## Risks / Trade-offs

- **[A host-exec széles jogosultság]** → a `org.freedesktop.Flatpak` talk-name a hoston való parancsfuttatást engedi; dev-eszköznél indokolt és dokumentált, de Flathub-review-t igényel (a beküldés nem része ennek a change-nek).
- **[Portál-út stabilitása a hoston]** → a `/run/user/1000/doc/<id>` a host session mountja; amíg a grant él, elérhető. Ha az agent a grant megszűnése után indul, hibát kap — ugyanaz, mint sandboxban.
- **[flatpak-spawn env/cwd viselkedés]** → spike méri; a döntés és a fallback (login shell) a designben marad.
- **[Agent config/auth szétválás]** → a hoston futó agent a host `HOME`-ját használja; a sandbox-agentek (letöltött) a profilban. Ez szándékos, de dokumentálni kell.
- **[Nem-Flatpak regresszió]** → minden kapuzott; a seam alapértéke a mai közvetlen út, amit a meglévő tesztek fednek.
