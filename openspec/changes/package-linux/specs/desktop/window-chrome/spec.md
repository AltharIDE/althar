## Purpose

Az ablak-chrome platformonkénti viselkedését írja le: menüsáv, ablakszegély, saját ablakgombok, húzás és app-identitás, hogy az app Linuxon (GNOME, KDE) ugyanolyan natívan nézzen ki, mint macOS-en.

## ADDED Requirements

### Requirement: Alkalmazásmenü

Az alkalmazás nem-macOS platformon SHALL NOT mutasson alkalmazásmenü-sávot az ablakban; macOS-en a natív menü SHALL megmaradjon.

#### Scenario: Indítás Linuxon

- **WHEN** az app elindul Linuxon (GNOME vagy KDE)
- **THEN** az ablakban nincs `File Edit View Window` menüsáv, és a menü nem érhető el `Alt`-tal sem

#### Scenario: Indítás macOS-en

- **WHEN** az app elindul macOS-en
- **THEN** a rendszer menüsávja a megszokott módon elérhető, változatlanul

### Requirement: Keret nélküli ablak nem-macOS-on

Nem-macOS platformon a főablak SHALL rendszer által rajzolt címsor és ablakszegély nélkül jelenjen meg; macOS-en a `hiddenInset` címsor és a natív traffic lights SHALL változatlan maradjon.

#### Scenario: Ablak megjelenése Linuxon

- **WHEN** a főablak megnyílik Linuxon
- **THEN** az ablak tartalma a legfelső élig ér, nincs fölötte GTK/KDE címsor és ablakikon

#### Scenario: Ablak megjelenése macOS-en

- **WHEN** a főablak megnyílik macOS-en
- **THEN** a natív traffic lights a megszokott helyen, a felső sávba ágyazva látszanak

#### Scenario: Átméretezés és mozgatás

- **WHEN** a felhasználó az ablak szélét húzza, vagy a felső sávot húzza
- **THEN** az ablak átméreteződik, illetve mozog; a viselkedés X11 alatt és Wayland alatt is működik

### Requirement: Saját ablakgombok

Nem-macOS platformon a felső sáv SHALL bezárás, minimalizálás és maximalizálás gombokat rajzolni, amelyek egérrel és billentyűzettel is elérhetők, accessible name-mel rendelkeznek, és látható hover/fókusz állapotuk van. macOS-en a gombokat a rendszer rajzolja, az app nem rajzol sajátot.

#### Scenario: Bezárás gombbal

- **WHEN** a felhasználó a saját bezárás gombra kattint
- **THEN** az ablak bezárul, és nem-macOS-on, ha ez volt az utolsó ablak, az app kilép

#### Scenario: Minimalizálás és maximalizálás

- **WHEN** a felhasználó a minimalizálás, illetve a maximalizálás gombra kattint
- **THEN** az ablak minimalizálódik, illetve maximalizált és visszaállított állapot között vált

#### Scenario: Billentyűzetes elérés

- **WHEN** a felhasználó Tab-bal a felső sáv gombjaira fókuszál
- **THEN** minden gomb fókuszjelet mutat, accessible name-mel olvasható fel, és Enterrel/Space-szel aktiválható

#### Scenario: Dupla kattintás a sávon

- **WHEN** a felhasználó duplán kattint a felső sáv egy nem interaktív részére
- **THEN** az ablak maximalizált és visszaállított állapot között vált

### Requirement: App-identitás és ikon Linuxon

Linuxon az app SHALL Althar néven és Althar ikonnal jelenjen meg: X11-en az ablakikon, Waylanden (GNOME, KDE) a telepített `.desktop` fájl és az egyező WM class biztosítja a taszkbár- és felső sávbeli ikont és a helyes ablak-társítást. Fejlesztői futtatásból indítva is a lehető legjobb identitás érvényesüljön.

#### Scenario: Taszkbár ikon KDE Wayland alatt

- **WHEN** a telepített app elindul KDE Wayland alatt
- **THEN** a taszkbárban és a felső sávban az Althar ikon és név látszik, nem generikus Electron ikon

#### Scenario: Ablakikon X11 alatt

- **WHEN** az app elindul X11 alatt (fejlesztésből vagy csomagból)
- **THEN** az ablak ikonja a `resources/icons` Althar ikonja

### Requirement: macOS viselkedés változatlansága

A fenti viselkedések SHALL NOT érintsek a macOS-t: a menü, a traffic lights, a felső sáv kihagyott helye és az app-ikon viselkedése macOS-en a change előtti állapot marad.

#### Scenario: macOS regresszió

- **WHEN** a meglévő macOS e2e és komponens tesztek lefutnak
- **THEN** mind zölden futnak, és a felső sávon a rendszer lámpái számára fenntartott hely változatlan
