## Purpose

A Flatpak sandboxjából a gépre való kilátást írja le: a személy saját agentjei és szerkesztői elérését, a sign-in parancsokat, a szükséges szűk engedélyeket — és azt, hogy minden más futtatási mód változatlan marad.

## ADDED Requirements

### Requirement: A személy saját agentjei Flatpakban

A Flatpakban futó app SHALL a gépen telepített agent-parancsot (a személy saját telepítését) a sandboxon kívül, a hoston futtatni — a jelenlét-ellenőrzéstől (`--version`) a task során indított processzekig —, mert annak konfigurációja és bejelentkezése a hoston él. Az app által letöltött agentek és a csomagolt adapterek SHALL továbbra is a sandboxban futni.

#### Scenario: Hoston telepített agenttel indul a coordinator

- **WHEN** a gépen telepítve van egy agent (pl. OpenCode), és a coordinator azt választja
- **THEN** a coordinator a hoston futó paranccsal elindul, a beszélgetés és a task végigfut

#### Scenario: Csomagolt agent változatlanul sandboxban fut

- **WHEN** a coordinator Claude Code-ot vagy Codexet használ
- **THEN** az az app-pal együtt csomagolt adapterrel, a sandboxban fut, mint eddig

#### Scenario: Althar által letöltött agent

- **WHEN** az agentet Althar töltötte le a profilba
- **THEN** az a sandboxban fut (a profil az app számára látható), és nem a hoston

### Requirement: Host-elérés hibája érthető

Ha a hoston való futtatás nem érhető el (például az engedély hiányzik), az app SHALL érthető, cselekvésre vezető hibát mutatni az agent indításakor; a hiba SHALL NOT csendes „nincs telepítve" látszatot kelteni.

#### Scenario: Nincs host-elérési engedély

- **WHEN** a sandbox nem tud a hoston parancsot futtatni, és a személy saját agentjét kéri a coordinator
- **THEN** az app megmondja, hogy a host elérése hiányzik, és mit kell tenni

### Requirement: Szűk és dokumentált engedélyek

A Flatpak SHALL csak a működéshez indokolt engedélyeket kérni: a host-elérést (a személy saját eszközeihez) és az ssh-agent socketet (a git pushoz), a meglévő hálózat/display/keyring mellett. Host fájlrendszer-hozzáférés SHALL NOT legyen; minden engedély indoklása a manifestben és a dokumentációban SHALL szerepelni.

#### Scenario: Manifest-ellenőrzés

- **WHEN** a manifest finish-args-ait vizsgáljuk
- **THEN** nincs `--filesystem=host` és nincs korlátlan fájlhozzáférés, és minden engedélyhez tartozik indoklás

### Requirement: Nem-Flatpak futtatás változatlan

Sandboxon kívül (dev, macOS, AppImage, deb, rpm) a személy saját agentjei és szerkesztői SHALL közvetlenül, lokálisan indulni, minden viselkedésváltozás nélkül; a host-elérésre vonatkozó logika SHALL csak Flatpakban (`FLATPAK_ID`) élni.

#### Scenario: Nem-Flatpak regresszió

- **WHEN** a meglévő egység- és e2e tesztek futnak, és az app sandboxon kívül indul
- **THEN** minden zöld, és a spawnok közvetlenül, host-közvetítés nélkül történnek

### Requirement: Saját sandboxot használó agentek Flatpakban

Azok az agentek, amelyek a parancsaikat a saját sandboxjukban futtatják, Flatpakban SHALL úgy indulni, hogy parancsaik fussanak és a nem engedett lépések kérései továbbra is Altharhoz érkezzenek, függetlenül attól, hogy a beágyazott sandbox létre tud-e jönni. A Claude Code a saját fallbackjével fut: a parancsok a beágyazott sandbox nélkül, de mindegyik Althar engedélykérésén át (a határ a Flatpak confinementje). A Codex a személy saját, a gépre telepített Codexét futtatja a sandboxon kívül, `flatpak-spawn`-on át, ahol a saját sandboxja működik; ahol a gépen nincs Codex, a Codex-indítás SHALL érthető üzenettel megállni. Sandboxon kívül a viselkedés SHALL változatlan maradni.

#### Scenario: Codex parancsai futnak Flatpakban

- **WHEN** a coordinator vagy egy lead Codexszel dolgozik a Flatpakban, és a gépre telepítve van a Codex
- **THEN** a parancsok elindulnak (nem halnak el namespace-hibával), és a nem engedett lépések továbbra is Althar engedélykérésén mennek át

#### Scenario: Codex nélkül a gépen

- **WHEN** a Flatpakban Codexszel indulna munka, de a gépre nincs Codex telepítve
- **THEN** az indulás érthető üzenettel áll meg, amely megmondja, hogy a Codexet a gépre kell telepíteni

#### Scenario: Claude csak-olvasó szerepben Flatpakban

- **WHEN** a coordinator vagy egy reviewer Claude Code-ot futtat a Flatpakban
- **THEN** a parancsai a beágyazott sandbox nélkül futnak, és mindegyik Althar szabályai elé kerül

#### Scenario: Nem-Flatpak viselkedés változatlan

- **WHEN** ugyanez az agent sandboxon kívül (dev, deb, rpm, AppImage, macOS) fut
- **THEN** a saját sandboxa úgy indul, mint eddig, és a beállításai változatlanok

### Requirement: Sign-in és szerkesztők a hoston

A személy saját agentjének sign-in parancsa Flatpakban SHALL a hoston futni (a bejelentkezés a host-beli konfigurációjába kerül); a személy szerkesztőjének megnyitása SHALL a hoston történni.

#### Scenario: Account hozzáadása Flatpakban

- **WHEN** a személy új accountot ad egy hoston telepített agenthez a Flatpakban
- **THEN** a sign-in lépés a hoston fut, és az új bejelentkezés a host konfigurációjában jelenik meg

#### Scenario: Szerkesztő megnyitása

- **WHEN** a személy a szerkesztőjében nyit meg valamit a Flatpakból
- **THEN** a szerkesztő a hoston indul el

### Requirement: Flatpak smoke a host-elérésre

A Flatpak saját füsttesztje SHALL ellenőrizni a host-elérést (ha a gépen van ilyen agent) és a manifest engedélyeit; a teszt SHALL külön futni a deb/rpm/AppImage füsttesztektől.

#### Scenario: Smoke zöld

- **WHEN** a `flatpak-smoke` fut egy gépen, ahol a hoston van opencode
- **THEN** a host-elérés ellenőrzése zöld, és az engedély-ellenőrzések zöldek
