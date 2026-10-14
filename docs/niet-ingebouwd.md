# Niet ingebouwd, en waarom

Soort: lijst van keuzes, vastgelegd op 10 oktober 2026 na een proef met open gereedschap op eigen testpagina's. Ze wordt bijgewerkt als een keuze verandert, niet bij elke wijziging van de code.

Wat wel is ingebouwd, staat met versie, licentie en werkwijze in het register van methoden (`toolbox/src/instruments/methods/registry.ts`; in een sessie toont `loep tools` de lijst) en in [toolbox/THIRD-PARTY.md](../toolbox/THIRD-PARTY.md). Dit bestand bewaart alleen wat is bekeken en bewust niet is opgenomen, zodat niemand het opnieuw hoeft uit te zoeken.

De eis aan elk stuk gereedschap: open broncode met een licentie die naast EUPL-1.2 verspreid mag worden, lokaal en zonder scherm te draaien, geen account of sleutel, en er gaat geen data de machine af.

## Afgewezen om de licentie

| Gereedschap | Reden |
|---|---|
| pa11y 10.0.0 en pa11y-ci | LGPL-3.0. Het is bovendien een schil om HTML_CodeSniffer en axe-core en meet niets nieuws |
| Sa11y 5.1.0 | GPL-2.0-or-later. Ook de woordenlijst voor nietszeggende linktekst mag daarom niet worden overgenomen; dat geldt ook voor die van Editoria11y |
| Asqatasun, Tanaguru, Equalify | AGPL-3.0. Niet gedraaid |
| `apca-w3` 0.1.9 | Geen open licentie. APCA is ook geen WCAG |
| fastText-taalmodel `lid.176` | Het model heeft een CC-BY-SA-licentie |
| `@axe-core/watcher`, WAVE, PAC, PEAT, ARC Toolkit, axe DevTools, Evinced | Niet open, of vraagt een account |

## Gedraaid en niet opgenomen

| Gereedschap | Wat de proef liet zien |
|---|---|
| HTML_CodeSniffer 2.5.1 | Loopt vast op `autocomplete` met twee waarden, ziet geen shadow DOM en geeft geen geslaagde regels. Op een echte pagina ruim honderd seintjes en geen afkeuring |
| AccessLint, `@accesslint/core` 0.21.0 | Geeft alleen overtredingen, geen geslaagde of niet-toepasselijke regels, en vond de gebreken in shadow DOM niet |
| `@qualweb/core` 0.9.5 | Haalt Puppeteer met een verbergplugin en een advertentieblokker binnen; `npm audit` meldde daar negen ernstige kwetsbaarheden. De regels van QualWeb werken zonder dit pakket en zijn zo opgenomen |
| `franc` 6.2.0 en `tinyld` 1.3.4 (taalherkenning) | 10 en 13 van de 20 fragmenten goed, tegen 17 en 16 voor de twee die zijn opgenomen |
| `lingua` in Python (taalherkenning) | Beste score (18 van 20), maar ruim vier seconden opstarten en een tweede taalomgeving voor één vraag |
| `aria-api` 0.9.1, Google `accname` 1.1.0 | Voegen naast de opgenomen naamberekeningen weinig toe; de laatste uitgave van `accname` is van 2022 |
| Het filter `photosensitivity` van ffmpeg | Onderscheidde een opname van een stilstaande pagina niet van een flitsende. De flitsmeting rekent daarom zelf met de helderheid per beeld |
| Een regel-engine in een tweede browser | axe-core, Alfa en de engine van IBM gaven in Chromium, Firefox en WebKit precies dezelfde uitkomsten: ze lezen de DOM en de berekende stijl. Alleen de naam en de Tab-volgorde worden daarom in een andere browser herhaald |
| De toegankelijkheidsboom van Firefox via `geckodriver` | Werkte in de proef, maar vraagt een aparte sessie naast Playwright. De boom van WebKit is wel opgenomen, via een niet-openbare ingang van Playwright die bij een nieuwe versie kan breken |

Niet gedraaid omdat ze een engine bundelen die al meedoet: Lighthouse, `accessibility-insights-scan`, kayle, a11ywatch, oobee, Unlighthouse en de coach van sitespeed.io.

## Eerst afgewezen, later opgenomen

Guidepup, `@guidepup/virtual-screen-reader` 0.33.0 (MIT), is op 13 oktober 2026 opgenomen als `loep speak`: een nagebootste schermlezer die zegt wat volgens de standaard wordt voorgelezen. De eerste proef wees het af omdat het geen schaduwboom en geen ingesloten venster leest en voor de naam `dom-accessibility-api` gebruikt, dat al meedoet. Dat klopt nog: als tweede mening over de naam telt het niet. Het is opgenomen om wat het wel geeft en de boom niet: de regel die wordt voorgelezen, de volgorde, en wat er na een handeling uit zichzelf wordt uitgesproken. Wat de proef miste, vult de toolbox aan: de open schaduwbomen, wat de standaard voor hulpsoftware verbergt, en welke verandering in een live-regio telt. In een ingesloten venster draait de lezer in het venster zelf. Het pakket wil de pagina ook voorbereiden op klikken en typen met nagemaakte invoer en vervangt daarvoor het klembord en de focusfunctie van de pagina; de toolbox handelt met echte invoer en haalt die ene aanroep eruit. Wat de lezer niet kan, staat in de [methode](methode.md).

## Niet geprobeerd

- NVDA en JAWS draaien op Windows en zijn niet geprobeerd. VoiceOver stond hier tot 13 oktober 2026 ook: een echte schermlezer vraagt een scherm en systeemrechten. Sindsdien is VoiceOver er als optioneel onderdeel buiten een run, in een virtuele Mac met een eigen scherm (het commando `voiceover`, zie [voiceover.md](voiceover.md)). Safari via `safaridriver` vraagt een handmatige instelling.
- IRIS van Electronic Arts voor flitsen (BSD-3-Clause) moet uit C++ worden gebouwd. Het meet ook rode flitsen en patronen; de eigen flitsmeting doet dat niet.
- EPUBCheck en Ace van DAISY voor epub: epub wordt geteld en niet ingelezen.
