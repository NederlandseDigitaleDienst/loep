# Software van derden in de toolbox

De toolbox zelf valt onder EUPL-1.2. Dit overzicht noemt wat de toolbox van anderen gebruikt, in welke versie en onder welke licentie. De licentie is op 10 oktober 2026 gelezen uit het geïnstalleerde pakket (`package.json` en het licentiebestand als dat er is). Versies staan vast in `package.json` en `package-lock.json`.

## Pakketten waar de toolbox direct van afhangt

| Pakket | Versie | Licentie | Waarvoor |
|---|---|---|---|
| `playwright` | 1.63.0 | Apache-2.0 | Browsers aansturen; eigen naamberekening (`ariaSnapshot`) |
| `axe-core` | 4.14.0 | MPL-2.0 | Regel-engine; naamberekening |
| `@siteimprove/alfa-act` | 0.119.0 | MIT | Regel-engine Alfa |
| `@siteimprove/alfa-rules` | 0.119.0 | MIT | Regels van Alfa |
| `@siteimprove/alfa-playwright` | 0.84.2 | MIT | Kopie van de pagina voor Alfa |
| `@siteimprove/alfa-aria` | 0.119.0 | MIT | Naamberekening van Alfa |
| `@siteimprove/alfa-dom` | 0.119.0 | MIT | Elementen terugvinden in de kopie van Alfa |
| `accessibility-checker-engine` | 4.0.34 | Apache-2.0 | Regel-engine van IBM (Equal Access) |
| `@qualweb/act-rules` | 0.8.6 | ISC | Regel-engine QualWeb, ACT-regels |
| `@qualweb/wcag-techniques` | 0.4.9 | ISC | Regel-engine QualWeb, WCAG-technieken |
| `@qualweb/qw-page` | 0.3.8 | ISC | Nodig voor QualWeb in de pagina |
| `@qualweb/util` | 0.7.4 | ISC | Nodig voor QualWeb in de pagina |
| `@qualweb/locale` | 0.2.3 | ISC | Meldingen van QualWeb |
| `dom-accessibility-api` | 0.7.1 | MIT | Naamberekening |
| `@guidepup/virtual-screen-reader` | 0.33.0 | MIT | Nagebootste schermlezer in de pagina (`loep speak`); toegevoegd en gelezen op 13 oktober 2026 |
| `tabbable` | 6.5.0 | MIT | Voorspelde tabvolgorde |
| `eld` | 2.1.0 | Apache-2.0 | Taalherkenning |
| `cld3-asm` | 4.0.0 | MIT | Taalherkenning (CLD3 van Google, Apache-2.0, als WebAssembly) |
| `html-validate` | 11.16.2 | MIT | Validatie van de bron |
| `vnu-jar` | 26.10.11 | MIT | Nu Html Checker; vraagt Java op de machine |
| `pngjs` | 7.0.0 | MIT | Schermafbeeldingen lezen en schrijven |
| `yaml` | 2.9.1 | ISC | Procedures lezen |
| `mockttp` | 4.6.5 | Apache-2.0 | Proxy op de eigen machine voor een run met geheimen (`src/browser/boundary.ts`); alleen geladen in zo'n run. Brengt 209 pakketten mee, geen daarvan onder GPL; toegevoegd en gelezen op 30 oktober 2026 |
| `@types/pngjs` | 6.0.5 | MIT | Typen |
| `typescript` (alleen ontwikkeling) | 7.0.2 | Apache-2.0 | Typecontrole |
| `@types/node` (alleen ontwikkeling) | 22.18.0 | MIT | Typen |

De vijf pakketten van QualWeb hebben geen licentiebestand in het pakket; de licentie komt uit `package.json`. Het pakket `@qualweb/core` gebruiken we niet.

## Pakketten die daarmee meekomen

Alle 138 pakketten die bij een installatie zonder ontwikkelpakketten in `node_modules` staan, hebben een van deze licenties: MIT (119), ISC (10), Apache-2.0 (6), MPL-2.0 (1), BSD-3-Clause (1), 0BSD (1). Geen daarvan is een copyleftlicentie die de toolbox raakt.

`npm audit` meldt drie kwetsbaarheden, alle drie via `nanoid` 2.1.11 dat met `cld3-asm` meekomt (`cld3-asm` > `emscripten-wasm-loader` > `nanoid`). De toolbox geeft daar geen invoer van buiten aan door: de lader gebruikt het om een naam te maken bij het starten van de WebAssembly-module. De zeventien pakketten die met `@guidepup/virtual-screen-reader` meekomen, voegen geen melding toe.

`@guidepup/virtual-screen-reader` brengt `@testing-library/user-event` mee om met nagemaakte invoer te klikken en te typen. De toolbox gebruikt dat deel niet en haalt de aanroep die het start uit de code die in de pagina draait, omdat die het klembord en de focusfunctie van de pagina vervangt.

## Wat de toolbox aanroept en niet meelevert

| Software | Geteste versie | Licentie | Opmerking |
|---|---|---|---|
| Chromium (via Playwright) | 153 | BSD-3-Clause en andere | `npx playwright install chromium` |
| WebKit (via Playwright) | 26.6 | LGPL-2.1 en BSD-2-Clause | Alleen voor tweede metingen; `npx playwright install webkit` |
| Firefox (via Playwright) | 155 | MPL-2.0 | Alleen voor tweede metingen; `npx playwright install firefox` |
| Java-runtime | 17 | afhankelijk van de leverancier | Alleen voor de Nu Html Checker; ontbreekt hij, dan meldt `loep tools` dat |
| Tesseract met taaldata `nld` en `eng` | 5.5.1 | Apache-2.0 | Voor `loep ocr` en voor scans in pdf-bestanden van de site; ontbreekt hij, dan meldt `loep tools` dat |
| poppler (`pdfinfo`, `pdftotext`, `pdftoppm`) | 25.06.0 | GPL-2.0-or-later | Als los programma aangeroepen, voor pdf-bestanden van de site (`documents`) en de controle van het eigen rapport; ontbreekt het, dan staat in de feiten van het document wat niet is gemeten |
| qpdf | 12.2.0 | Apache-2.0 | Als los programma aangeroepen, voor de tags en objecten van pdf-bestanden van de site |
| veraPDF | 1.30 | GPL-3.0-or-later of MPL-2.0 | Als los programma aangeroepen, voor PDF/UA-1 van pdf-bestanden van de site en van het eigen rapport |

De ingang naar de toegankelijkheidsboom van WebKit is geen openbaar onderdeel van Playwright. Een test (`test/second-browsers.test.ts`) meldt het als die ingang bij een nieuwe versie verdwijnt.

## Wat de toolbox ophaalt en niet meelevert

| Wat | Vastgelegd op | Licentie | Opmerking |
|---|---|---|---|
| De testgevallen van de ACT-regels van W3C (`w3c/wcag-act-rules`) | Een commit en de sha256 van de lijst, in `toolbox/src/commands/calibrate.ts` | Volgens de lijst zelf de W3C Software and Document Notice and License; volgens de repository de W3C Document License | Alleen voor `just calibrate`, de ijkmeting van de instrumenten. Opgehaald naar een map buiten de repository. Wat er op 13 oktober 2026 over de licentie is gevonden, staat in `validatie/ijkset/README.md` |
