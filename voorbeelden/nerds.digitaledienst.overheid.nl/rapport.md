# Toegankelijkheidsonderzoek NeRDS

> **Concept, niet afgetekend**

> **Voorlopige status: C (eerste maatregelen genomen)**. Deze status volgt uit de uitkomsten in dit rapport. Ze telt pas als een persoon met naam het rapport heeft afgetekend.

- Website: NeRDS
- URL: <https://nerds.digitaledienst.overheid.nl/>
- Organisatie: Nederlandse Digitale Dienst
- Datum van het onderzoek: 11 oktober 2026
- Versie van de evaluatie: `50a291e12689`

## Samenvatting

NeRDS voldoet niet aan de 55 criteria van WCAG 2.2 niveau A en AA: 11 criteria zijn niet gehaald en 5 criteria zijn nog open (bij 3 daarvan is geen afwijking gevonden, maar is niet alles gemeten).

**Voorlopige status: C (eerste maatregelen genomen)**

Deze status volgt uit de uitkomsten in dit rapport. Ze telt pas als een persoon met naam het rapport heeft afgetekend.

Het onderzoek vond 12 gebreken, 13 bevindingen onder 11 criteria.

**WCAG 2.2 niveau A en AA (55 criteria)**

| Principe | ● Voldoet | ✕ Voldoet niet | − Niet van toepassing | ◐ Geen afwijking gevonden, niet volledig gemeten | ? Kan niet bepalen | ○ Niet beoordeeld | Totaal |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 Waarneembaar | 4 | 8 | 7 | 1 | 0 | 0 | 20 |
| 2 Bedienbaar | 12 | 2 | 3 | 2 | 1 | 0 | 20 |
| 3 Begrijpelijk | 12 | 0 | 0 | 0 | 1 | 0 | 13 |
| 4 Robuust | 1 | 1 | 0 | 0 | 0 | 0 | 2 |
| **Totaal** | **29** | **11** | **10** | **3** | **2** | **0** | **55** |

**WCAG 2.1 niveau A en AA (50 criteria)**

| Principe | ● Voldoet | ✕ Voldoet niet | − Niet van toepassing | ◐ Geen afwijking gevonden, niet volledig gemeten | ? Kan niet bepalen | ○ Niet beoordeeld | Totaal |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 Waarneembaar | 4 | 8 | 7 | 1 | 0 | 0 | 20 |
| 2 Bedienbaar | 10 | 1 | 3 | 2 | 1 | 0 | 17 |
| 3 Begrijpelijk | 10 | 0 | 0 | 0 | 0 | 0 | 10 |
| 4 Robuust | 2 | 1 | 0 | 0 | 0 | 0 | 3 |
| **Totaal** | **26** | **10** | **10** | **3** | **1** | **0** | **50** |

"Niet van toepassing" telt niet mee als "Voldoet". "Kan niet bepalen" en "Niet beoordeeld" zijn open: daar is nog geen oordeel. "Geen afwijking gevonden, niet volledig gemeten" is ook open en telt niet mee als "Voldoet": er is niets fout gevonden, maar niet alles is gemeten. Wat er wel is gemeten, staat bij het criterium.

### Zwaarste gebreken

| Gebrek | Criterium | Ernst | Pagina's |
| --- | --- | --- | --- |
| [Huidige pagina in het menu alleen met een grijs vlak aangegeven](#NERD-G-a930) | 1.4.1 | midden | P01, P04, P12, P13 e.a. |
| [Link naar een hoofdstuk in het zijmenu brengt de focus niet naar dat hoofdstuk (smal scherm)](#NERD-G-2983) | 2.4.3 | midden | P04, P12 e.a. |
| [Links in het zijmenu liggen aan het eind van de pagina onder de voet en zijn met focus onzichtbaar](#NERD-G-66e2) | 2.4.11 | midden | P14 e.a. |

Hier staan de 3 gebreken met ernst midden; een hogere ernst komt niet voor. De andere 9 gebreken (9 met ernst laag) staan in de werklijst hierna. De bevindingen staan bij de resultaten per criterium.

### Wat betekent dit

Dit rapport is een concept: niemand heeft ervoor getekend. Het kan daarom nog geen toegankelijkheidsverklaring onderbouwen. De bevindingen zijn wel bruikbaar om de site te verbeteren. Hieronder staat welke status past als het rapport wordt afgetekend.

Voor WCAG 2.1, de versie waar EN 301 549 naar verwijst, en voor WCAG 2.2: status C (eerste maatregelen genomen). Bij 4 (WCAG 2.1) of 5 (WCAG 2.2) criteria kon niet worden vastgesteld of eraan is voldaan. Bij 3 daarvan is geen afwijking gevonden, maar is niet alles gemeten; bij 1 (WCAG 2.1) of 2 (WCAG 2.2) is de vraag echt open. Het onderzoek dekt daardoor nog niet alle eisen. Status A en B zijn pas mogelijk als die criteria alsnog zijn onderzocht; tot die tijd past status C, met aanvullend onderzoek binnen zes maanden.

## Over deze website

Dit is de website van de Nederlandse Richtlijn Digitale Systemen (NeRDS), uitgegeven door de Nederlandse Digitale Dienst van de Rijksoverheid. Mensen die bij de overheid digitale systemen ontwerpen, bouwen of inkopen lezen er dertien richtlijnen, elk met uitleg, praktische tips en verwijzingen. Een bezoeker kan lezen, in alle pagina's zoeken en via een venster feedback geven. Voor het onderzoek valt op dat zoeken, feedback en op een smal scherm ook de menu's in een venster over de pagina openen, dat sommige pagina's afvinklijsten en uitklappers hebben, en dat de pagina over cloud een proefformulier in een venster heeft met enkele uitgeschakelde knoppen. Er is geen cookiemelding, geen video of geluid en geen ingesloten inhoud van anderen.

## Wat nu

Dit is de werklijst die uit het onderzoek volgt. Eerst wat aantoonbaar mis is, daarna wat nog niet is vast te stellen.

### Oplossen

De gebreken, per eigenaar en met de zwaarste eerst. Een gebrek is één plek die hersteld moet worden. Het onderzoek oordeelt per criterium, dus één gebrek kan onder meerdere criteria een bevinding opleveren. Het gebrek staat hier bij het criterium dat over de oorzaak gaat; "raakt ook" noemt de andere criteria.

Over de oplossingen: een stuk HTML in een oplossing toont de gewenste uitvoer in de browser, niet per se de wijziging in de bron (Markdown, een sjabloon of een component). Meet na een wijziging aan ruimte, breedte of afbreken opnieuw op 320 pixels breed en op een tussenbreedte, zoals 500 en 640 pixels: een oplossing voor één breedte kan op een andere iets breken.

**Techniek**

- <a id="NERD-G-2983"></a>midden: **Link naar een hoofdstuk in het zijmenu brengt de focus niet naar dat hoofdstuk (smal scherm)** (NERD-G-2983)
  - Hoofdcriterium 2.4.3. Pagina's: P04, P12 e.a..
  - Bevinding: [NERD-2.4.3-1ab1](#NERD-2.4.3-1ab1)
- <a id="NERD-G-66e2"></a>midden: **Links in het zijmenu liggen aan het eind van de pagina onder de voet en zijn met focus onzichtbaar** (NERD-G-66e2)
  - Hoofdcriterium 2.4.11. Pagina's: P14 e.a..
  - Bevinding: [NERD-2.4.11-f0f2](#NERD-2.4.11-f0f2)
- <a id="NERD-G-e79d"></a>laag: **Reeksen kaarten zijn geen lijst** (NERD-G-e79d)
  - Hoofdcriterium 1.3.1. Pagina's: P01, P11, P13 e.a..
  - Bevinding: [NERD-1.3.1-9438](#NERD-1.3.1-9438)
- <a id="NERD-G-5fea"></a>laag: **Van de link GitHub in de kop blijft op een smal scherm alleen een pictogram over** (NERD-G-5fea)
  - Hoofdcriterium 1.4.10, raakt ook 1.4.4. Pagina's: P01, P13, P18 e.a..
  - Bevindingen: [NERD-1.4.10-921b](#NERD-1.4.10-921b), [NERD-1.4.4-4fca](#NERD-1.4.4-4fca)
- <a id="NERD-G-736d"></a>laag: **Huidig onderdeel in het smalle menu alleen zichtbaar aangegeven** (NERD-G-736d)
  - Hoofdcriterium 1.3.1. Pagina's: P09 e.a..
  - Bevinding: [NERD-1.3.1-75d1](#NERD-1.3.1-75d1)
- <a id="NERD-G-c95d"></a>laag: **Titel afgekapt in het venster voor een Kubernetes cluster** (NERD-G-c95d)
  - Hoofdcriterium 1.4.10. Pagina's: P13.
  - Bevinding: [NERD-1.4.10-8bd8](#NERD-1.4.10-8bd8)

**Content**

- <a id="NERD-G-8ab9"></a>laag: **Toegankelijkheidslabel is een afbeelding met lopende tekst** (NERD-G-8ab9)
  - Hoofdcriterium 1.4.5. Pagina's: P09 e.a..
  - Bevinding: [NERD-1.4.5-6815](#NERD-1.4.5-6815)

**Design**

- <a id="NERD-G-c420"></a>laag: **Het huidige item in het zijmenu en het smalle hoofdmenu steekt te weinig af** (NERD-G-c420)
  - Hoofdcriterium 1.4.11. Pagina's: P01, P05, P14 e.a..
  - Bevinding: [NERD-1.4.11-2dee](#NERD-1.4.11-2dee)

**Leverancier**

- <a id="NERD-G-a930"></a>midden: **Huidige pagina in het menu alleen met een grijs vlak aangegeven** (NERD-G-a930)
  - Hoofdcriterium 1.4.1. Pagina's: P01, P04, P12, P13 e.a..
  - Bevinding: [NERD-1.4.1-f439](#NERD-1.4.1-f439)
- <a id="NERD-G-ea7b"></a>laag: **Witte letters in de schaal van het toegankelijkheidslabel hebben te weinig contrast** (NERD-G-ea7b)
  - Hoofdcriterium 1.4.3. Pagina's: P09.
  - Bevinding: [NERD-1.4.3-3211](#NERD-1.4.3-3211)
- <a id="NERD-G-051b"></a>laag: **Tekstballonnetje van de kopieerknop bedekt code en gaat bij aanwijzen niet weg met Escape** (NERD-G-051b)
  - Hoofdcriterium 1.4.13. Pagina's: P04 e.a..
  - Bevinding: [NERD-1.4.13-5009](#NERD-1.4.13-5009)
- <a id="NERD-G-a4da"></a>laag: **Schuivend vak om het zijmenu krijgt focus zonder rol en naam** (NERD-G-a4da)
  - Hoofdcriterium 4.1.2. Pagina's: P17 e.a..
  - Bevinding: [NERD-4.1.2-f0f1](#NERD-4.1.2-f0f1)

### Raakt een component van designsysteem

Deze bevindingen raken een element van de leverancier. Dat zegt waar het gebrek zit, niet wie het moet herstellen: de oorzaak kan in het component liggen of in de manier waarop de site het gebruikt. Ga per bevinding na welke van de twee het is.

- `nldd-card`: [NERD-1.3.1-9438](#NERD-1.3.1-9438)
- `nldd-code-viewer`: [NERD-1.4.13-5009](#NERD-1.4.13-5009)
- `nldd-collection`: [NERD-1.3.1-9438](#NERD-1.3.1-9438)
- `nldd-list-item`: [NERD-1.4.1-f439](#NERD-1.4.1-f439), [NERD-2.4.3-1ab1](#NERD-2.4.3-1ab1), [NERD-2.4.11-f0f2](#NERD-2.4.11-f0f2), [NERD-1.4.11-2dee](#NERD-1.4.11-2dee), [NERD-1.3.1-75d1](#NERD-1.3.1-75d1)
- `nldd-menu-bar-item`: [NERD-1.4.4-4fca](#NERD-1.4.4-4fca), [NERD-1.4.10-921b](#NERD-1.4.10-921b)
- `nldd-sheet`: [NERD-1.3.1-75d1](#NERD-1.3.1-75d1)
- `nldd-sidebar-section`: [NERD-4.1.2-f0f1](#NERD-4.1.2-f0f1)
- `nldd-top-title-bar`: [NERD-1.4.10-8bd8](#NERD-1.4.10-8bd8)

### Nog uitzoeken

Wat het onderzoek open laat, staat hier in delen. Het eerste deel is werk voor de eigenaar van de site. Het laatste deel gaat over grenzen van dit onderzoek: daar hoeft de eigenaar niets mee te doen.

**Dit moet een mens nagaan**

Wat geen instrument kan vaststellen, of wat een keuze vraagt. Achter elk criterium staat de uitkomst die het nu heeft.

- <a id="open-2.2.1"></a>[2.2.1 Timing aanpasbaar](#sc-2.2.1) (kan niet bepalen)
  - Het venster Kubernetes cluster aanmaken op de pagina's over cloud (P13 en P14) begint met drie knoppen om in te loggen. Bij de beoordeling ging het formulier na één klik open zonder dat er gegevens werden gevraagd, en het bleef daarna staan. Van buitenaf is niet te zien of er een inlog met een tijdslimiet achter zit. Iemand die de werking kent, moet bevestigen dat dit een voorbeeld is zonder sessie, of anders hoe lang de inlog geldt en of de bezoeker die kan verlengen.
  - Het feedbackformulier achter de knop Feedback, op alle 29 pagina's. Bij de beoordeling is geen tijdslimiet gezien: de foutmelding bleef staan en er veranderde niets vanzelf. Of de site een sessie bijhoudt die kan verlopen terwijl iemand het formulier invult, is van buitenaf niet vast te stellen. Iemand die de werking kent, moet dat bevestigen. Versturen via GitHub Issues is niet geprobeerd, omdat dat buiten de onderzochte site uitkomt.
- <a id="open-3.3.7"></a>[3.3.7 Overbodige invoer](#sc-3.3.7) (kan niet bepalen)
  - Op alle 29 pagina's, venster Feedback: de laatste stap van feedback geven is buiten de site, op GitHub of in het mailprogramma, en is bij de beoordeling niet te zien. Vast staat dat de site de soort, de richtlijn en de tekst doorgeeft, en via e-mail ook de link. Vast staat ook dat een ingevulde link niet meegaat naar GitHub als de soort Fout of Vraag is, terwijl het formulier op de site daarna leeg is. Vul het formulier in met een link en de soort Fout, kies Via GitHub Issues en kijk of de bezoeker de link daar opnieuw moet typen om hem mee te sturen. Is dat zo, geef de link dan ook bij Fout en Vraag door.
- <a id="open-2.4.5"></a>[2.4.5 Meerdere manieren](#sc-2.4.5) (voldoet)
  - Er is met één vaste zoekterm gezocht. Of de zoekfunctie elke pagina van de site vindt, is daarmee niet vast te stellen. Dat weegt het zwaarst voor de pagina Huidige versie (P29), die in geen menu staat en alleen via een link in de tekst van twee andere pagina's te bereiken is. Zoek op de site naar die pagina en kijk of zij in de resultaten staat.
- <a id="open-4.1.3"></a>[4.1.3 Statusberichten](#sc-4.1.3) (voldoet)
  - Op elke pagina, in het venster Feedback geven: de bedankmelding na het versturen staat in een gebied dat tot dat moment verborgen is. Niet te meten is of een schermlezer haar dan voorleest. Verstuur het formulier met een schermlezer aan (bijvoorbeeld NVDA en VoiceOver) en luister of de bedankmelding wordt voorgelezen.

**Dit meet de toolbox een volgende keer**

Dekking die ontbrak, budget dat op was of een proef die niet werkte. Per criterium staat hier hoeveel punten er zijn; de punten zelf staan volledig in bijlage A.

- <a id="open-1.4.12"></a>[1.4.12 Tekstafstand](#sc-1.4.12) (geen afwijking gevonden, niet volledig gemeten): 2 punten (2 keer dekking ontbrak), zie [bijlage A](#bijlage-1.4.12). Dekking: Dossier: gemeten op 29 van 29 pagina's op 1280 en op 320 pixels breed en in 12 van 12 toestanden. Bij de verificatie zelf nagemeten op 7 pagina's (P03, P04, P10, P11 en P29 op 320 pixels, P13 op 1030 pixels, P14 op 1280 pixels) en in 2 geopende onderdelen (praktische tips op P17, clustervenster op P13). Geen verlies van tekst gevonden. Niet gemeten: het menu achter de knop met drie puntjes met ruimere tekstafstand.
- <a id="open-2.1.1"></a>[2.1.1 Toetsenbord](#sc-2.1.1) (geen afwijking gevonden, niet volledig gemeten): 1 punt (1 keer budget was op), zie [bijlage A](#bijlage-2.1.1). Dekking: Het dossier doorliep 29 van 29 pagina's met Tab (1269 Tab-stops, 0 elementen niet bereikt) en activeerde 9 unieke knoppen. Bij de verificatie gemeten op 8 pagina's (P01, P02, P03, P04, P11, P12, P13, P14) en in 7 geopende toestanden: zijmenu smal, hoofdmenu smal, zoeken met resultaten, feedback, clustervenster, clusterformulier en het scherm na versturen. Geen fout gevonden.
- <a id="open-2.5.2"></a>[2.5.2 Aanwijzerannulering](#sc-2.5.2) (geen afwijking gevonden, niet volledig gemeten): 2 punten (2 keer dekking ontbrak), zie [bijlage A](#bijlage-2.5.2). Dekking: Vooraf geprobeerd: 300 van de 396 soorten bedieningselementen op 29 pagina's in de begintoestand, 299 zonder reactie en 1 met alleen een hulptekst. Bij de beoordeling en de controle samen ruim 50 elementen met de hand geprobeerd op 11 pagina's (P01, P04, P13, P14, P16, P17, P18, P21, P24, P26 en P29) en naast 6 geopende onderdelen gedrukt. Geen functie gevonden die bij het indrukken wordt uitgevoerd.
- [3.3.7 Overbodige invoer](#sc-3.3.7) (kan niet bepalen): 1 punt (1 keer dekking ontbrak), zie [bijlage A](#bijlage-3.3.7)
- <a id="open-1.3.2"></a>[1.3.2 Betekenisvolle volgorde](#sc-1.3.2) (voldoet): 3 punten (3 keer dekking ontbrak), zie [bijlage A](#bijlage-1.3.2)
- <a id="open-1.4.1"></a>[1.4.1 Gebruik van kleur](#sc-1.4.1) (voldoet niet): 1 punt (1 keer dekking ontbrak), zie [bijlage A](#bijlage-1.4.1)
- <a id="open-1.4.3"></a>[1.4.3 Contrast (minimum)](#sc-1.4.3) (voldoet niet): 3 punten (1 keer dekking ontbrak, 1 keer budget was op, 1 keer een proef werkte niet), zie [bijlage A](#bijlage-1.4.3)
- <a id="open-1.4.4"></a>[1.4.4 Herschalen van tekst](#sc-1.4.4) (voldoet niet): 1 punt (1 keer dekking ontbrak), zie [bijlage A](#bijlage-1.4.4)
- <a id="open-1.4.10"></a>[1.4.10 Reflow](#sc-1.4.10) (voldoet niet): 1 punt (1 keer dekking ontbrak), zie [bijlage A](#bijlage-1.4.10)
- <a id="open-1.4.11"></a>[1.4.11 Contrast van niet-tekstuele content](#sc-1.4.11) (voldoet niet): 4 punten (3 keer dekking ontbrak, 1 keer budget was op), zie [bijlage A](#bijlage-1.4.11)
- <a id="open-1.4.13"></a>[1.4.13 Content bij hover of focus](#sc-1.4.13) (voldoet niet): 4 punten (2 keer dekking ontbrak, 2 keer budget was op), zie [bijlage A](#bijlage-1.4.13)
- <a id="open-2.4.11"></a>[2.4.11 Focus niet bedekt (minimum)](#sc-2.4.11) (voldoet niet): 1 punt (1 keer budget was op), zie [bijlage A](#bijlage-2.4.11)

## Onderzoeksgegevens

- Site: NeRDS
- URL: <https://nerds.digitaledienst.overheid.nl/>
- Organisatie: Nederlandse Digitale Dienst
- Datum: 11 oktober 2026
- Norm: WCAG 2.2 niveau A en AA; WCAG 2.1 niveau A en AA; EN 301 549 v3.2.1, hoofdstuk 9
- Methode: [WCAG-EM 2.0](https://www.w3.org/TR/WCAG-EM-2/)
- Type onderzoek: Automatisch onderzoek: regel-engines, scripts die het gedrag in de browser meten, een verkenning en een rondgang per paginatype door een taalmodel, beoordeling per criterium door een taalmodel met meetinstrumenten, en een tweede ronde die elke bevinding opnieuw maakt.
- Uitgevoerd door: in eigen beheer
- Versturen van formulieren: Toegestaan: onderzocht op een testomgeving waar versturen is toegestaan: https://nerds.digitaledienst.overheid.nl, verklaard door iemand met de functie staff engineer (de naam staat in het dossier van het onderzoek, niet in dit rapport).
- Afgetekend door: nog niet afgetekend

Afwijkingen van de methode:

- Stap 4 (beoordelen) is niet door een mens uitgevoerd maar door een taalmodel, volgens een vaste procedure per criterium.
- Er is geen steekproef getrokken: alle pagina's van de site zijn onderzocht.
- Volledige processen (stap 3c) zijn alleen onderzocht voor zover de verkenner ze als reeks stappen kon vastleggen.
- Er is geen basisniveau van hulpsoftware vastgesteld: er is geen hulpsoftware gebruikt.

## Scope

Binnen de scope:

- Alle pagina's op https://nerds.digitaledienst.overheid.nl

Buiten de scope:

- Websites van derden waarnaar wordt gelinkt
- Documenten op andere domeinen waarnaar de site linkt (6 geteld)

## Basisniveau van ondersteuning

Browsers:

- Chromium (Chrome for Testing) 153.0.8010.12, engine Blink; alle metingen
- Firefox 155.0, engine Gecko; alleen voor het herhalen van de Tab-volgorde (96 metingen)
- WebKit 26.6, engine WebKit; alleen voor het herhalen van de toegankelijke naam en rol en de Tab-volgorde (246 metingen)

Hulpsoftware: geen.

Er is geen hulpsoftware gebruikt. Een schermlezer is niet getest.

Technologieën waarop de site steunt: CSS, HTML, JavaScript, SVG, WAI-ARIA, Web Components (shadow DOM).

## Steekproef

De site telt 29 unieke pagina's. Ze zijn allemaal onderzocht, dus er is geen steekproeffout.

- Werkwijze: alle pagina's onderzocht
- Unieke pagina's in de inventaris: 29
- Onderzochte pagina's: 29
- Seed voor de willekeurige keuze: `toegankelijk`

- **P01** NeRDS: Nederlandse Richtlijn Digitale Systemen, <https://nerds.digitaledienst.overheid.nl/>. Soort: gericht. Reden: volledige site onderzocht.
  - Gemeten toestanden: component-zoeken, component-feedback, component-menu-smal, component-melding-verbergen, process-zoeken, process-feedback
- **P02** Pagina niet gevonden - NeRDS: Nederlandse Richtlijn Digitale Systemen, <https://nerds.digitaledienst.overheid.nl/deze-pagina-bestaat-niet-toegankelijkheidsonderzoek>. Soort: gericht. Reden: foutpagina (404).
  - Gemeten toestanden: component-zoeken, component-feedback, component-menu-smal
- **P03** Over de Nederlandse Richtlijn Digitale Systemen - NeRDS: Nederlandse Richtlijn Digitale Systemen, <https://nerds.digitaledienst.overheid.nl/Over-NeRDS/>. Soort: gericht. Reden: volledige site onderzocht.
  - Gemeten toestanden: component-zoeken, component-feedback, component-menu-smal, component-zijmenu-smal
- **P04** Contact en bijdragen - NeRDS: Nederlandse Richtlijn Digitale Systemen, <https://nerds.digitaledienst.overheid.nl/Over-NeRDS/CONTRIBUTING/>. Soort: gericht. Reden: volledige site onderzocht.
  - Gemeten toestanden: component-zoeken, component-feedback, component-menu-smal, component-zijmenu-smal, component-kopieer
- **P05** Cookies - NeRDS: Nederlandse Richtlijn Digitale Systemen, <https://nerds.digitaledienst.overheid.nl/Over-NeRDS/cookies/>. Soort: gericht. Reden: volledige site onderzocht.
  - Gemeten toestanden: component-zoeken, component-feedback, component-menu-smal, component-zijmenu-smal
- **P06** Copyright - NeRDS: Nederlandse Richtlijn Digitale Systemen, <https://nerds.digitaledienst.overheid.nl/Over-NeRDS/copyright/>. Soort: gericht. Reden: volledige site onderzocht.
  - Gemeten toestanden: component-zoeken, component-feedback, component-menu-smal, component-zijmenu-smal
- **P07** Kwetsbaarheid melden - NeRDS: Nederlandse Richtlijn Digitale Systemen, <https://nerds.digitaledienst.overheid.nl/Over-NeRDS/kwetsbaarheid-melden/>. Soort: gericht. Reden: volledige site onderzocht.
  - Gemeten toestanden: component-zoeken, component-feedback, component-menu-smal, component-zijmenu-smal
- **P08** Privacy - NeRDS: Nederlandse Richtlijn Digitale Systemen, <https://nerds.digitaledienst.overheid.nl/Over-NeRDS/privacy/>. Soort: gericht. Reden: volledige site onderzocht.
  - Gemeten toestanden: component-zoeken, component-feedback, component-menu-smal, component-zijmenu-smal
- **P09** Toegankelijkheid - NeRDS: Nederlandse Richtlijn Digitale Systemen, <https://nerds.digitaledienst.overheid.nl/Over-NeRDS/toegankelijkheid/>. Soort: gericht. Reden: volledige site onderzocht.
  - Gemeten toestanden: component-zoeken, component-feedback, component-menu-smal, component-zijmenu-smal
- **P10** Versies - NeRDS: Nederlandse Richtlijn Digitale Systemen, <https://nerds.digitaledienst.overheid.nl/Over-NeRDS/versies/>. Soort: gericht. Reden: volledige site onderzocht.
  - Gemeten toestanden: component-zoeken, component-feedback, component-menu-smal, component-zijmenu-smal
- **P11** Overzicht richtlijnen - NeRDS: Nederlandse Richtlijn Digitale Systemen, <https://nerds.digitaledienst.overheid.nl/richtlijnen/>. Soort: gericht. Reden: volledige site onderzocht.
  - Gemeten toestanden: component-zoeken, component-feedback, component-menu-smal, component-zijmenu-smal
- **P12** 11. Algoritmen - NeRDS: Nederlandse Richtlijn Digitale Systemen, <https://nerds.digitaledienst.overheid.nl/richtlijnen/algoritmen/>. Soort: gericht. Reden: volledige site onderzocht.
  - Gemeten toestanden: component-zoeken, component-feedback, component-menu-smal, component-zijmenu-smal
- **P13** 5. Gebruik cloud verantwoord en blijf wendbaar - NeRDS: Nederlandse Richtlijn Digitale Systemen, <https://nerds.digitaledienst.overheid.nl/richtlijnen/cloud/>. Soort: gericht. Reden: volledige site onderzocht.
  - Gemeten toestanden: component-zoeken, component-feedback, component-menu-smal, component-zijmenu-smal, component-praktische-tips, component-cluster-dialoog, process-cluster-aanmaken
- **P14** Cloud: wanneer doe je wat? - NeRDS: Nederlandse Richtlijn Digitale Systemen, <https://nerds.digitaledienst.overheid.nl/richtlijnen/cloud/fases/>. Soort: gericht. Reden: volledige site onderzocht.
  - Gemeten toestanden: component-zoeken, component-feedback, component-menu-smal, component-zijmenu-smal, component-afvinklijst, component-cluster-dialoog
- **P15** 10. Data - NeRDS: Nederlandse Richtlijn Digitale Systemen, <https://nerds.digitaledienst.overheid.nl/richtlijnen/data/>. Soort: gericht. Reden: volledige site onderzocht.
  - Gemeten toestanden: component-zoeken, component-feedback, component-menu-smal, component-zijmenu-smal
- **P16** 13. Duurzaamheid - NeRDS: Nederlandse Richtlijn Digitale Systemen, <https://nerds.digitaledienst.overheid.nl/richtlijnen/duurzaamheid/>. Soort: gericht. Reden: volledige site onderzocht.
  - Gemeten toestanden: component-zoeken, component-feedback, component-menu-smal, component-zijmenu-smal
- **P17** 1. Stel gebruikersbehoeften vast - NeRDS: Nederlandse Richtlijn Digitale Systemen, <https://nerds.digitaledienst.overheid.nl/richtlijnen/gebruikersbehoeften/>. Soort: gericht. Reden: volledige site onderzocht.
  - Gemeten toestanden: component-zoeken, component-feedback, component-menu-smal, component-zijmenu-smal, component-praktische-tips
- **P18** Gebruikersbehoeften: wanneer doe je wat? - NeRDS: Nederlandse Richtlijn Digitale Systemen, <https://nerds.digitaledienst.overheid.nl/richtlijnen/gebruikersbehoeften/fases/>. Soort: gericht. Reden: volledige site onderzocht.
  - Gemeten toestanden: component-zoeken, component-feedback, component-menu-smal, component-zijmenu-smal, component-afvinklijst
- **P19** 12. Inkoopstrategie - NeRDS: Nederlandse Richtlijn Digitale Systemen, <https://nerds.digitaledienst.overheid.nl/richtlijnen/inkoop/>. Soort: gericht. Reden: volledige site onderzocht.
  - Gemeten toestanden: component-zoeken, component-feedback, component-menu-smal, component-zijmenu-smal
- **P20** 9. Integratie - NeRDS: Nederlandse Richtlijn Digitale Systemen, <https://nerds.digitaledienst.overheid.nl/richtlijnen/integratie/>. Soort: gericht. Reden: volledige site onderzocht.
  - Gemeten toestanden: component-zoeken, component-feedback, component-menu-smal, component-zijmenu-smal
- **P21** 3. Werk transparant en gebruik open source - NeRDS: Nederlandse Richtlijn Digitale Systemen, <https://nerds.digitaledienst.overheid.nl/richtlijnen/open-source/>. Soort: gericht. Reden: volledige site onderzocht.
  - Gemeten toestanden: component-zoeken, component-feedback, component-menu-smal, component-zijmenu-smal, component-praktische-tips
- **P22** Open source: wanneer doe je wat? - NeRDS: Nederlandse Richtlijn Digitale Systemen, <https://nerds.digitaledienst.overheid.nl/richtlijnen/open-source/fases/>. Soort: gericht. Reden: volledige site onderzocht.
  - Gemeten toestanden: component-zoeken, component-feedback, component-menu-smal, component-zijmenu-smal, component-afvinklijst
- **P23** 4. Open Standaarden - NeRDS: Nederlandse Richtlijn Digitale Systemen, <https://nerds.digitaledienst.overheid.nl/richtlijnen/open-standaarden/>. Soort: gericht. Reden: volledige site onderzocht.
  - Gemeten toestanden: component-zoeken, component-feedback, component-menu-smal, component-zijmenu-smal
- **P24** 7. Privacy - NeRDS: Nederlandse Richtlijn Digitale Systemen, <https://nerds.digitaledienst.overheid.nl/richtlijnen/privacy/>. Soort: gericht. Reden: volledige site onderzocht.
  - Gemeten toestanden: component-zoeken, component-feedback, component-menu-smal, component-zijmenu-smal
- **P25** 8. Samenwerking - NeRDS: Nederlandse Richtlijn Digitale Systemen, <https://nerds.digitaledienst.overheid.nl/richtlijnen/samenwerking/>. Soort: gericht. Reden: volledige site onderzocht.
  - Gemeten toestanden: component-zoeken, component-feedback, component-menu-smal, component-zijmenu-smal
- **P26** 2. Zorg voor toegankelijkheid en inclusie - NeRDS: Nederlandse Richtlijn Digitale Systemen, <https://nerds.digitaledienst.overheid.nl/richtlijnen/toegankelijkheid/>. Soort: gericht. Reden: volledige site onderzocht.
  - Gemeten toestanden: component-zoeken, component-feedback, component-menu-smal, component-zijmenu-smal, component-praktische-tips
- **P27** Toegankelijkheid: wanneer doe je wat? - NeRDS: Nederlandse Richtlijn Digitale Systemen, <https://nerds.digitaledienst.overheid.nl/richtlijnen/toegankelijkheid/fases/>. Soort: gericht. Reden: volledige site onderzocht.
  - Gemeten toestanden: component-zoeken, component-feedback, component-menu-smal, component-zijmenu-smal, component-afvinklijst
- **P28** 6. Veiligheid - NeRDS: Nederlandse Richtlijn Digitale Systemen, <https://nerds.digitaledienst.overheid.nl/richtlijnen/veiligheid/>. Soort: gericht. Reden: volledige site onderzocht.
  - Gemeten toestanden: component-zoeken, component-feedback, component-menu-smal, component-zijmenu-smal
- **P29** Huidige versie - NeRDS: Nederlandse Richtlijn Digitale Systemen, <https://nerds.digitaledienst.overheid.nl/version/>. Soort: gericht. Reden: volledige site onderzocht.
  - Gemeten toestanden: component-zoeken, component-feedback, component-menu-smal

## Gereedschap

- Toolbox: versie 0.0.1, commit `ac91dd934461`
- Lockfile: `9a9fb714`
- Runtime: Node v26.11.0 op darwin 25.6.0 (arm64)
- Pakketten: `@siteimprove/alfa-act` 0.119.0, `@siteimprove/alfa-playwright` 0.84.2, `@siteimprove/alfa-rules` 0.119.0, `axe-core` 4.13.0, `playwright` 1.63.0
- Browser: chromium 153.0.8010.12
- Weergave: venster 1280 × 800, schaalfactor 1, taal nl-NL, tijdzone Europe/Amsterdam, voorkeur voor minder beweging: aan
- Wachttijden: 45 seconden voor het laden van een pagina, 10 seconden voor het tot rust komen
- Beoordelend model, zoals opgegeven: claude-opus-5-5 (opgegeven door wie het onderzoek uitvoerde; de toolbox legt niet zelf vast welk model draaide)
- Rondes: rondgang per paginatype, beoordeling met instrumenten, verificatie en eindoordeel
- Opdrachtsjablonen: beoordeel `21538289`, rondgang `d268f9ae`, verifieer `c4f61714`

**Meetmethoden van de agents**

Elke meting van een agent is door een of meer van deze hulpmiddelen beantwoord. De lijst is geteld uit de vastgelegde waarnemingen: ze noemt wat in dit onderzoek is gebruikt, niet wat op de machine stond. De pakketten hierboven deden de metingen vooraf, op elke pagina. Alle hulpmiddelen zijn open source; de licentie van elk staat in evaluation.json en in de repository van de toolbox.

| Hulpmiddel | Versie | Gebruikt voor | Metingen |
|---|---|---|---|
| `@siteimprove/alfa-aria` | 0.119.0 | naam, rol en toestand | 670 |
| `accessibility-checker-engine` | 4.0.34 | contrast, toetsregels, aanwijsgebied | 326 |
| `alfa` | 0.119.0 | contrast, toetsregels, aanwijsgebied | 326 |
| `axe-core` | 4.13.0 | naam, rol en toestand, contrast, toetsregels, aanwijsgebied | 996 |
| `chromium` | 153.0.8010.12 | naam, rol en toestand, contrast, tekst in beeld, Tab-volgorde | 866 |
| `cld3-asm` | 4.0.0 | taal | 82 |
| `dom-accessibility-api` | 0.7.1 | naam, rol en toestand | 670 |
| `eld` | 2.1.0 | taal | 82 |
| `firefox` | 155.0 | Tab-volgorde | 96 |
| `html-validate` | 11.16.2 | geldige HTML | 35 |
| `opendeur-toolbox` | 0.0.1 chromium 153.0.8010.12 | contrast, focusaanduiding, beweging, volgorde in code en beeld, reflow op 320 pixels, tekstafstand, aanwijsgebied, vergroten tot 200% | 1016 |
| `playwright ariaSnapshot` | 1.63.0 | naam, rol en toestand | 669 |
| `qualweb` | 0.8.6 | contrast, toetsregels | 210 |
| `tabbable` | 6.5.0 | Tab-volgorde | 118 |
| `tesseract` | 5.5.1 | contrast, tekst in beeld | 15 |
| `vnu-jar` | 26.10.9 java 17.0.12 | geldige HTML | 35 |
| `webkit` | 26.6 | naam, rol en toestand, Tab-volgorde | 246 |

Hulpmiddelen in de zin van de methode zijn de regel-engines axe-core 4.13.0 en Alfa 0.119.0: zij draaien op elke pagina van de steekproef. In de metingen van de agents draaiden daarnaast accessibility-checker-engine 4.0.34 en qualweb 0.8.6 mee, als extra mening. Regel-engines voeren toetsregels voor WCAG uit; een deel daarvan zijn ACT-regels, de gepubliceerde toetsregels. De andere instrumenten van de toolbox verzamelen bewijs en zijn zelf geen toetsregel: de Tab-proef, de metingen van contrast, vergroten, tekstafstand en smal scherm, het openen van menu's, vensters en formulieren, tekstherkenning in afbeeldingen, en het beluisteren en bekijken van video en geluid. Het model handelt en meet alleen via die instrumenten; elke aanroep is vastgelegd als waarneming en kan worden nagespeeld.

## Resultaten per criterium

Elke regel verwijst naar het deel waar de uitkomst wordt onderbouwd.

| Criterium | Niveau | Uitkomst | Bevindingen |
| --- | --- | --- | ---: |
| [1.1.1 Niet-tekstuele content](#sc-1.1.1) | A | ● Voldoet | 0 |
| [1.2.1 Louter-geluid en louter-videobeeld (vooraf opgenomen)](#sc-1.2.1) | A | − Niet van toepassing | 0 |
| [1.2.2 Ondertitels voor doven en slechthorenden (vooraf opgenomen)](#sc-1.2.2) | A | − Niet van toepassing | 0 |
| [1.2.3 Audiodescriptie of media-alternatief (vooraf opgenomen)](#sc-1.2.3) | A | − Niet van toepassing | 0 |
| [1.2.4 Ondertitels voor doven en slechthorenden (live)](#sc-1.2.4) | AA | − Niet van toepassing | 0 |
| [1.2.5 Audiodescriptie (vooraf opgenomen)](#sc-1.2.5) | AA | − Niet van toepassing | 0 |
| [1.3.1 Info en relaties](#sc-1.3.1) | A | ✕ Voldoet niet | 2 |
| [1.3.2 Betekenisvolle volgorde](#sc-1.3.2) | A | ● Voldoet | 0 |
| [1.3.3 Zintuiglijke eigenschappen](#sc-1.3.3) | A | ● Voldoet | 0 |
| [1.3.4 Weergavestand](#sc-1.3.4) | AA | ● Voldoet | 0 |
| [1.3.5 Identificeer het doel van de input](#sc-1.3.5) | AA | − Niet van toepassing | 0 |
| [1.4.1 Gebruik van kleur](#sc-1.4.1) | A | ✕ Voldoet niet | 1 |
| [1.4.2 Geluidsbediening](#sc-1.4.2) | A | − Niet van toepassing | 0 |
| [1.4.3 Contrast (minimum)](#sc-1.4.3) | AA | ✕ Voldoet niet | 1 |
| [1.4.4 Herschalen van tekst](#sc-1.4.4) | AA | ✕ Voldoet niet | 1 |
| [1.4.5 Afbeeldingen van tekst](#sc-1.4.5) | AA | ✕ Voldoet niet | 1 |
| [1.4.10 Reflow](#sc-1.4.10) | AA | ✕ Voldoet niet | 2 |
| [1.4.11 Contrast van niet-tekstuele content](#sc-1.4.11) | AA | ✕ Voldoet niet | 1 |
| [1.4.12 Tekstafstand](#sc-1.4.12) | AA | ◐ Geen afwijking gevonden, niet volledig gemeten | 0 |
| [1.4.13 Content bij hover of focus](#sc-1.4.13) | AA | ✕ Voldoet niet | 1 |
| [2.1.1 Toetsenbord](#sc-2.1.1) | A | ◐ Geen afwijking gevonden, niet volledig gemeten | 0 |
| [2.1.2 Geen toetsenbordval](#sc-2.1.2) | A | ● Voldoet | 0 |
| [2.1.4 Enkel teken sneltoetsen](#sc-2.1.4) | A | − Niet van toepassing | 0 |
| [2.2.1 Timing aanpasbaar](#sc-2.2.1) | A | ? Kan niet bepalen | 0 |
| [2.2.2 Pauzeren, stoppen, verbergen](#sc-2.2.2) | A | ● Voldoet | 0 |
| [2.3.1 Drie flitsen of beneden drempelwaarde](#sc-2.3.1) | A | ● Voldoet | 0 |
| [2.4.1 Blokken omzeilen](#sc-2.4.1) | A | ● Voldoet | 0 |
| [2.4.2 Paginatitel](#sc-2.4.2) | A | ● Voldoet | 0 |
| [2.4.3 Focus volgorde](#sc-2.4.3) | A | ✕ Voldoet niet | 1 |
| [2.4.4 Linkdoel (in context)](#sc-2.4.4) | A | ● Voldoet | 0 |
| [2.4.5 Meerdere manieren](#sc-2.4.5) | AA | ● Voldoet | 0 |
| [2.4.6 Koppen en labels](#sc-2.4.6) | AA | ● Voldoet | 0 |
| [2.4.7 Focus zichtbaar](#sc-2.4.7) | AA | ● Voldoet | 0 |
| [2.4.11 Focus niet bedekt (minimum)](#sc-2.4.11) | AA | ✕ Voldoet niet | 1 |
| [2.5.1 Aanwijzergebaren](#sc-2.5.1) | A | − Niet van toepassing | 0 |
| [2.5.2 Aanwijzerannulering](#sc-2.5.2) | A | ◐ Geen afwijking gevonden, niet volledig gemeten | 0 |
| [2.5.3 Label in naam](#sc-2.5.3) | A | ● Voldoet | 0 |
| [2.5.4 Bewegingsactivering](#sc-2.5.4) | A | − Niet van toepassing | 0 |
| [2.5.7 Sleepbewegingen](#sc-2.5.7) | AA | ● Voldoet | 0 |
| [2.5.8 Grootte van het aanwijsgebied (minimum)](#sc-2.5.8) | AA | ● Voldoet | 0 |
| [3.1.1 Taal van de pagina](#sc-3.1.1) | A | ● Voldoet | 0 |
| [3.1.2 Taal van onderdelen](#sc-3.1.2) | AA | ● Voldoet | 0 |
| [3.2.1 Bij focus](#sc-3.2.1) | A | ● Voldoet | 0 |
| [3.2.2 Bij input](#sc-3.2.2) | A | ● Voldoet | 0 |
| [3.2.3 Consistente navigatie](#sc-3.2.3) | AA | ● Voldoet | 0 |
| [3.2.4 Consistente identificatie](#sc-3.2.4) | AA | ● Voldoet | 0 |
| [3.2.6 Consistente hulp](#sc-3.2.6) | A | ● Voldoet | 0 |
| [3.3.1 Foutidentificatie](#sc-3.3.1) | A | ● Voldoet | 0 |
| [3.3.2 Labels of instructies](#sc-3.3.2) | A | ● Voldoet | 0 |
| [3.3.3 Foutsuggestie](#sc-3.3.3) | AA | ● Voldoet | 0 |
| [3.3.4 Foutpreventie (wettelijk, financieel, gegevens)](#sc-3.3.4) | AA | ● Voldoet | 0 |
| [3.3.7 Overbodige invoer](#sc-3.3.7) | A | ? Kan niet bepalen | 0 |
| [3.3.8 Toegankelijke authenticatie (minimum)](#sc-3.3.8) | AA | ● Voldoet | 0 |
| [4.1.1 Parsen](#sc-4.1.1) | A | ● Voldoet | 0 |
| [4.1.2 Naam, rol, waarde](#sc-4.1.2) | A | ✕ Voldoet niet | 1 |
| [4.1.3 Statusberichten](#sc-4.1.3) | AA | ● Voldoet | 0 |

### Zonder bevinding en zonder open punt

Deze criteria zijn niet van toepassing, of er is aan voldaan zonder bevinding en zonder open punt. Ze hebben daarom geen eigen blok. De waarnemingen en de toetsing staan in bijlage A.

| Criterium | Niveau | Uitkomst | Toelichting |
| --- | --- | --- | --- |
| <a id="sc-1.1.1"></a>[1.1.1 Niet-tekstuele content](#bijlage-1.1.1) | A | ● Voldoet | Afbeeldingen en pictogrammen hebben een passende tekst of zijn als versiering verborgen. Knoppen en links met alleen een pictogram hebben een naam. Dat is nagemeten op acht pagina's en in vier geopende onderdelen; er zijn geen documenten in de steekproef. |
| <a id="sc-1.2.1"></a>[1.2.1 Louter-geluid en louter-videobeeld (vooraf opgenomen)](#bijlage-1.2.1) | A | − Niet van toepassing | Op geen van de 29 pagina's staat een geluidsfragment, een video, een ingesloten venster of bewegend beeld. Ook de tweede toetsing vond op andere pagina's en in geopende onderdelen niets. Het criterium is niet van toepassing. |
| <a id="sc-1.2.2"></a>[1.2.2 Ondertitels voor doven en slechthorenden (vooraf opgenomen)](#bijlage-1.2.2) | A | − Niet van toepassing | Op de site staat geen video. Op alle 29 pagina's is nul keer video, geluid of een ingesloten venster geteld. Een eigen controle op vijf andere plekken dan de beoordelaar bekeek, vond ook niets. |
| <a id="sc-1.2.3"></a>[1.2.3 Audiodescriptie of media-alternatief (vooraf opgenomen)](#bijlage-1.2.3) | A | − Niet van toepassing | Op de 29 pagina's van de site staat geen video, geen geluid en geen ingesloten venster, ook niet in de geopende vensters en uitklappers. Het criterium is daarom niet van toepassing. |
| <a id="sc-1.2.4"></a>[1.2.4 Ondertitels voor doven en slechthorenden (live)](#bijlage-1.2.4) | AA | − Niet van toepassing | Op de 29 onderzochte pagina's staat geen video, geluid of ingesloten venster, en nergens wordt een eigen live-uitzending aangekondigd. Een uitzending die er tijdens het onderzoek niet stond, is niet gezien. |
| <a id="sc-1.2.5"></a>[1.2.5 Audiodescriptie (vooraf opgenomen)](#bijlage-1.2.5) | AA | − Niet van toepassing | Op de site staat geen video. Op alle 29 pagina's is geteld en bij een eigen controle op drie andere pagina's en drie geopende onderdelen is geen video, geluid of ingesloten venster gevonden. Het criterium is hier niet van toepassing. |
| <a id="sc-1.3.3"></a>[1.3.3 Zintuiglijke eigenschappen](#bijlage-1.3.3) | A | ● Voldoet | De tekst van alle 29 pagina's is opnieuw gelezen. Aanwijzingen die een plek of leesrichting noemen, noemen het onderdeel ook bij naam. Geen aanwijzing leunt alleen op vorm, kleur, plek of geluid. |
| <a id="sc-1.3.4"></a>[1.3.4 Weergavestand](#bijlage-1.3.4) | AA | ● Voldoet | De site werkt staand en liggend. In beide standen staat dezelfde inhoud, zonder melding om te draaien en zonder gedraaide inhoud. Ook bij een nieuwe proef op vijf andere pagina's. De site heeft geen webmanifest. |
| <a id="sc-1.3.5"></a>[1.3.5 Identificeer het doel van de input](#bijlage-1.3.5) | AA | − Niet van toepassing | De site vraagt nergens om een gegeven van de bezoeker zelf, zoals naam, e-mailadres of adres. Alle velden zijn zoekvelden, keuzes, vinkjes of vrije tekst, ook in de vensters en na versturen. Het criterium is niet van toepassing. |
| <a id="sc-1.4.2"></a>[1.4.2 Geluidsbediening](#bijlage-1.4.2) | A | − Niet van toepassing | Op geen van de 29 pagina's staat geluid, video of een ingesloten venster met een speler. Ook in de geopende vensters en menu's is niets gevonden. Er is geen geluid dat vanzelf kan starten. Het criterium is niet van toepassing. |
| <a id="sc-2.1.2"></a>[2.1.2 Geen toetsenbordval](#bijlage-2.1.2) | A | ● Voldoet | Op geen van de 29 pagina's blijft het toetsenbord vastzitten. Elk venster over de pagina sluit met Escape, ook het feedbackvenster nadat het formulier is verstuurd. Het punt dat open stond, is nagemeten en beslecht. |
| <a id="sc-2.1.4"></a>[2.1.4 Enkel teken sneltoetsen](#bijlage-2.1.4) | A | − Niet van toepassing | De site heeft geen sneltoetsen van één teken. Op alle 29 pagina's en in de geopende onderdelen deed geen letter, cijfer of leesteken iets. Een eigen proef op vier pagina's en in vier geopende onderdelen gaf dezelfde uitkomst. |
| <a id="sc-2.2.2"></a>[2.2.2 Pauzeren, stoppen, verbergen](#bijlage-2.2.2) | A | ● Voldoet | Op de site beweegt niets vanzelf. Alleen in het proefformulier voor een cluster draait kort een laadteken nadat de bezoeker zelf op een knop klikt. Dat stopt vanzelf binnen enkele seconden. |
| <a id="sc-2.3.1"></a>[2.3.1 Drie flitsen of beneden drempelwaarde](#bijlage-2.3.1) | A | ● Voldoet | Op de site flitst niets. Er is geen video, geluid of bewegend plaatje. Alleen een klein laadteken en een korte melding na kopiëren veranderen het beeld, elk één keer en op een klein vlak. |
| <a id="sc-2.4.1"></a>[2.4.1 Blokken omzeilen](#bijlage-2.4.1) | A | ● Voldoet | Alle 29 pagina's beginnen met een link om de kop en het menu over te slaan. Die link werkt: de volgende Tab-stap staat in de inhoud. Opnieuw gemeten op 3 andere paginatypen, ook op een smal scherm. |
| <a id="sc-2.4.2"></a>[2.4.2 Paginatitel](#bijlage-2.4.2) | A | ● Voldoet | Alle 29 pagina's hebben een eigen titel die zegt waar de pagina over gaat. Geen titel is leeg, dubbel of onaf. Ook na een klik op een link, na zoeken en na versturen past de titel. |
| <a id="sc-2.4.4"></a>[2.4.4 Linkdoel (in context)](#bijlage-2.4.4) | A | ● Voldoet | Van elke link is het doel duidelijk uit de naam of uit de zin eromheen. Alle 1666 links op 29 pagina's zijn nagelopen, ook in het zoekvenster, de menu's en de uitklappers. Bij de controle is geen fout gevonden. |
| <a id="sc-2.4.6"></a>[2.4.6 Koppen en labels](#bijlage-2.4.6) | AA | ● Voldoet | De koppen, labels en knopteksten beschrijven wat eronder staat of wat ze doen. Dat geldt voor de 559 koppen op 29 pagina's en voor de vensters voor zoeken, feedback, de menu's en het proefformulier, ook na versturen. |
| <a id="sc-2.4.7"></a>[2.4.7 Focus zichtbaar](#bijlage-2.4.7) | AA | ● Voldoet | Bij elke stop met de Tab-toets is te zien waar de focus staat, in licht en donker, op een smal scherm en in elk geopend venster. Bij het logo in de kop is de rand dun en klein, maar aan te wijzen. |
| <a id="sc-2.5.1"></a>[2.5.1 Aanwijzergebaren](#bijlage-2.5.1) | A | − Niet van toepassing | Op de site is geen onderdeel gevonden dat met vegen of met meerdere vingers werkt. De enige luisteraar voor beweging hoort bij de codeblokken, die alleen tekst tonen. Er is geen gebaar uitgevoerd. |
| <a id="sc-2.5.3"></a>[2.5.3 Label in naam](#bijlage-2.5.3) | A | ● Voldoet | Bij knoppen, links en velden staat de tekst die je ziet ook in de naam voor hulpsoftware. Het dossier vergeleek dat op 29 pagina's, ook smal en in de geopende vensters. Eigen metingen op zes pagina's bevestigen het. |
| <a id="sc-2.5.4"></a>[2.5.4 Bewegingsactivering](#bijlage-2.5.4) | A | − Niet van toepassing | De site reageert nergens op het bewegen van het apparaat. Op alle 29 pagina's is geen luisteraar voor beweging geteld en er zijn geen ingesloten vensters. Een eigen steekproef op zes pagina's gaf hetzelfde. Het criterium is niet van toepassing. |
| <a id="sc-2.5.7"></a>[2.5.7 Sleepbewegingen](#bijlage-2.5.7) | AA | ● Voldoet | Alleen het codeblok luistert naar slepen. Slepen selecteert daar alleen tekst, en de knop bij het blok kopieert de code met één klik. Er is geen sleepbeweging uitgevoerd; elders is geen onderdeel gevonden dat met slepen werkt. |
| <a id="sc-2.5.8"></a>[2.5.8 Grootte van het aanwijsgebied (minimum)](#bijlage-2.5.8) | AA | ● Voldoet | Alle knoppen en links zijn groot genoeg of hebben genoeg ruimte om zich heen. De links die lager zijn dan 24 pixels (voet, kruimelpad, bewerklink, inhoudsopgave) staan ver genoeg van andere doelen, ook op een smal scherm. |
| <a id="sc-3.1.1"></a>[3.1.1 Taal van de pagina](#bijlage-3.1.1) | A | ● Voldoet | Alle 29 pagina's geven in de code aan dat ze Nederlands zijn, en de tekst op elke pagina is Nederlands. Een eigen meting op vijf andere pagina's en toestanden bevestigt dit. Er zijn geen ingesloten vensters en geen documenten. |
| <a id="sc-3.1.2"></a>[3.1.2 Taal van onderdelen](#bijlage-3.1.2) | AA | ● Voldoet | Alle 29 pagina's zijn Nederlands. Engelse titels van boeken, documenten en standaarden hebben een eigen taalaanduiding. Ander Engels is steeds een naam, een vakterm of een ingeburgerd woord. Ook de geopende vensters zijn Nederlands. |
| <a id="sc-3.2.1"></a>[3.2.1 Bij focus](#bijlage-3.2.1) | A | ● Voldoet | Op geen van de 29 pagina's gebeurt er vanzelf iets als een onderdeel focus krijgt. Er laadt geen andere pagina, er opent geen venster en de focus springt niet weg. Dat geldt ook in de geopende vensters, menu's en ingevulde formulieren. |
| <a id="sc-3.2.2"></a>[3.2.2 Bij input](#bijlage-3.2.2) | A | ● Voldoet | Na een verse nameting staat vast: een veld invullen, een optie kiezen of een vakje aanvinken brengt de bezoeker nergens naar een andere pagina, opent geen nieuw venster, verstuurt geen formulier en laat de focus niet wegspringen. |
| <a id="sc-3.2.3"></a>[3.2.3 Consistente navigatie](#bijlage-3.2.3) | AA | ● Voldoet | Het menu, de knoppen in de kop, het zijmenu, het kruimelpad en de voet staan op alle 29 pagina's in dezelfde volgorde. Dat geldt ook op een smal en een halfbreed scherm en met het menu open. |
| <a id="sc-3.2.4"></a>[3.2.4 Consistente identificatie](#bijlage-3.2.4) | AA | ● Voldoet | Kop, menu en voet tonen op alle 29 pagina's dezelfde onderdelen met dezelfde namen. Ook op een smal scherm en in de vensters Menu, Zoeken en Feedback is geen onderdeel gevonden dat van naam wisselt. |
| <a id="sc-3.2.6"></a>[3.2.6 Consistente hulp](#bijlage-3.2.6) | A | ● Voldoet | De hulp staat op een vaste plek: de knop "Feedback" in de kop en de link "Contact en bijdragen" in de voet staan op elke bekeken pagina op dezelfde plek, ook op een smal scherm en in het donkere schema. |
| <a id="sc-3.3.1"></a>[3.3.1 Foutidentificatie](#bijlage-3.3.1) | A | ● Voldoet | Het feedbackformulier en het proefformulier voor een cluster houden een fout tegen bij versturen en noemen dan in tekst welk veld het is en wat er mis is. Zelf nagemaakt op andere pagina's; de run mocht versturen. |
| <a id="sc-3.3.2"></a>[3.3.2 Labels of instructies](#bijlage-3.3.2) | A | ● Voldoet | Alle invoervelden hebben een zichtbaar label of, bij het zoekveld, een vergrootglas. Wat verplicht is en welke vorm nodig is, staat er vooraf bij. Bij het namaken is geen afwijking gevonden. |
| <a id="sc-3.3.3"></a>[3.3.3 Foutsuggestie](#bijlage-3.3.3) | AA | ● Voldoet | Het feedbackformulier en het proefformulier voor een cluster zeggen bij elke fout wat er wel verwacht wordt. Dat is opnieuw gemeten op twee andere pagina's. Het zoekveld en de afvinklijsten keuren geen invoer af. |
| <a id="sc-3.3.4"></a>[3.3.4 Foutpreventie (wettelijk, financieel, gegevens)](#bijlage-3.3.4) | AA | ● Voldoet | Eén formulier lijkt op een bestelling: het proefformulier voor een Kubernetes cluster op P13 en P14. Het controleert elk verplicht veld en laat de bezoeker herstellen voordat er iets wordt aangemaakt. Eén link naar een inlog gaat naar een andere site. |
| <a id="sc-3.3.8"></a>[3.3.8 Toegankelijke authenticatie (minimum)](#bijlage-3.3.8) | AA | ● Voldoet | De enige inlog staat in het proefvenster voor een Kubernetes cluster op de twee cloudpagina's. Inloggen is één klik op een van drie knoppen. Ook na het versturen van het formulier komt er geen wachtwoord, code of puzzel. |
| <a id="sc-4.1.1"></a>[4.1.1 Parsen](#bijlage-4.1.1) | A | ● Voldoet | Alle 29 pagina's van de site zijn HTML-documenten. Voor HTML geldt dit criterium volgens het W3C altijd als voldaan. De meldingen van de ontleders zijn informatie. |

### 1 Waarneembaar

#### Richtlijn 1.3 Aanpasbaar

<a id="sc-1.3.1"></a>

##### 1.3.1 Info en relaties

**Uitkomst:** ✕ Voldoet niet · Niveau A · EN 301 549: 9.1.3.1 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html) · [Onderbouwing in bijlage A](#bijlage-1.3.1) (5 waarnemingen)

Twee gebreken zijn nagemaakt: reeksen kaarten zijn geen lijst, en het smalle menu toont het huidige onderdeel alleen met een donkerder vlak. Koppen, lijsten, velden en paginagebieden kloppen op de nagemeten plekken.

Zekerheid: Beoordelaar en verificatie komen op dezelfde uitkomst. 2 bevindingen opnieuw gemaakt.

**Bevindingen (2)**

<a id="NERD-1.3.1-9438"></a>

###### NERD-1.3.1-9438 Reeksen kaarten zijn geen lijst

- Ernst: laag
- Eigenaar: techniek
- Onderdeel: kaartenraster (nldd-collection met nldd-card)
- Raakt een element van de leverancier: `nldd-card`, `nldd-collection`
- Pagina's: gemeten op 9 pagina's: P01, P11, P12, P13, P17, P18, P20, P21 en P26; de beoordelaar telde in de bomen van het dossier 157 kaarten op 19 pagina's (P01 en P11 tot en met P28), dat aantal is niet nageteld
- Gebrek: [NERD-G-e79d](#NERD-G-e79d)
- Controle: Opnieuw gemaakt bij de verificatie

**Wat is er mis**

De kaarten met richtlijnen en hulpmiddelen staan als gelijke blokken in een raster. In de code staan ze los in het raster, zonder lijst eromheen. Elke kaart heeft een eigen kop. Gemeten: 13 kaarten op P01, 13 op P11 en 7 op P13.

**Wie heeft er last van**

Wie een schermlezer gebruikt, hoort niet dat de kaarten een reeks vormen en ook niet hoeveel het er zijn. Via de koppen van de kaarten is de inhoud wel te vinden.

**Oplossing**

Lever de reeks kaarten als lijst aan de browser: zet \`role="list"\` op \`nldd-collection\` en \`role="listitem"\` op elke \`nldd-card\`, of gebruik een variant van het kaartenraster die zelf een lijst met lijstitems oplevert. Controleer daarna in de toegankelijkheidsboom dat er \`list\` met \`listitem\` staat.

**Waar**

- P01 NeRDS: Nederlandse Richtlijn Digitale Systemen: onder de kop “NeRDS richtlijnen”, bij “1. Stel gebruikersbehoeften vast”, `de dertien kaarten in het raster, nldd-collection > nldd-card`
- P11 Overzicht richtlijnen - NeRDS: Nederlandse Richtlijn Digitale Systemen: onder de kop “De NeRDS”, bij “1. Stel gebruikersbehoeften vast”, `de dertien kaarten in het raster, nldd-collection > nldd-card`
- P13 5. Gebruik cloud verantwoord en blijf wendbaar - NeRDS: Nederlandse Richtlijn Digitale Systemen: onder de kop “Direct aan de slag”, bij “Volwassenheidsmodel Digitale Autonomie”, `de zeven kaarten met hulpmiddelen, nldd-collection > nldd-card`

<a id="NERD-1.3.1-75d1"></a>

###### NERD-1.3.1-75d1 Huidig onderdeel in het smalle menu alleen zichtbaar aangegeven

- Ernst: laag
- Eigenaar: techniek
- Onderdeel: hoofdmenu op smal scherm
- Raakt een element van de leverancier: `nldd-list-item`, `nldd-sheet`
- Pagina's: gemeten op P09; de rondgang zag hetzelfde op P03, P10 en P17; het menu hoort volgens het sitemodel bij elk paginatype
- Gebrek: [NERD-G-736d](#NERD-G-736d)
- Controle: Opnieuw gemaakt bij de verificatie

**Wat is er mis**

In het menu dat op een smal scherm achter de knop Menu zit, heeft het huidige onderdeel een donkerder vlak. De link zelf heeft in de code geen aanduiding; het lijstitem heeft alleen \`selected\`.

**Wie heeft er last van**

Wie een schermlezer gebruikt op een telefoon of bij sterke vergroting, hoort in dit menu niet in welk onderdeel van de site hij is. De titel van de pagina zegt dat nog wel.

**Oplossing**

Geef de link van het huidige onderdeel in het menuvenster \`aria-current="page"\`. Binnen eigen bereik: gebruik op het lijstitem het attribuut waarmee het component het huidige onderdeel aan hulpsoftware doorgeeft, of zet in de tekst van het item een visueel verborgen toevoeging dat dit het huidige onderdeel is. Controleer het resultaat in de toegankelijkheidsboom.

**Waar**

- P09 Toegankelijkheid - NeRDS: Nederlandse Richtlijn Digitale Systemen: onder de kop “Menu”, bij “Over NeRDS”, `geopend hoofdmenu op 360 pixels breed, de link van het huidige onderdeel`

<a id="sc-1.3.2"></a>

##### 1.3.2 Betekenisvolle volgorde

**Uitkomst:** ● Voldoet · Niveau A · EN 301 549: 9.1.3.2 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/meaningful-sequence.html) · [Onderbouwing in bijlage A](#bijlage-1.3.2) (6 waarnemingen)

De volgorde in de code is op alle gemeten pagina's en in alle geopende vensters dezelfde als op het scherm, of verschilt zonder dat de betekenis verandert. In de kaarten staat de titel vóór het label.

Zekerheid: Beoordelaar en verificatie komen op dezelfde uitkomst.

Open: 3 punten, zie [Nog uitzoeken](#open-1.3.2).

#### Richtlijn 1.4 Onderscheidbaar

<a id="sc-1.4.1"></a>

##### 1.4.1 Gebruik van kleur

**Uitkomst:** ✕ Voldoet niet · Niveau A · EN 301 549: 9.1.4.1 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html) · [Onderbouwing in bijlage A](#bijlage-1.4.1) (6 waarnemingen)

De huidige pagina is in het zijmenu en in het smalle hoofdmenu alleen aan een lichtgrijs vlak te herkennen. Zelf nagemeten op 5 pagina's van 5 paginatypen en in 1 geopende toestand. De link om de pagina te bewerken is onderstreept.

Zekerheid: Beoordelaar en verificatie komen op dezelfde uitkomst. 1 bevinding opnieuw gemaakt.

Open: 1 punt, zie [Nog uitzoeken](#open-1.4.1).

**Bevindingen (1)**

<a id="NERD-1.4.1-f439"></a>

###### NERD-1.4.1-f439 Huidige pagina in het menu alleen met een grijs vlak aangegeven

- Ernst: midden
- Eigenaar: leverancier
- Onderdeel: zijmenu en smal hoofdmenu (nldd-list-item)
- Raakt een element van de leverancier: `nldd-list-item`
- Pagina's: bij de verificatie gemeten: zijmenu op 3 pagina's (P13, P04, P18), smal hoofdmenu op 2 pagina's (P12, P01), alles licht. De beoordelaar mat het zijmenu op 13 pagina's en op P13 ook donker. Volgens het sitemodel staat het zijmenu op 26 van de 29 pagina's en het hoofdmenu op alle 29.
- Gebrek: [NERD-G-a930](#NERD-G-a930)
- Controle: Opnieuw gemaakt bij de verificatie

**Wat is er mis**

In het zijmenu en in het smalle hoofdmenu heeft de huidige pagina alleen een lichtgrijs vlak, bijvoorbeeld "5. Cloud" op P13. Het vlak steekt 1,2 op 1 af tegen de omgeving (1,3 in het smalle hoofdmenu). Er is geen streep, pictogram of vetter letter.

**Wie heeft er last van**

Wie kleuren of lichte tinten slecht onderscheidt, ziet niet op welke pagina van het menu hij is. In het smalle menu krijgt een link onder de muis bijna hetzelfde vlak, wat het nog onduidelijker maakt.

**Oplossing**

Geef het huidige item in \`nldd-list-item\` (toestand \`current\`/\`selected\`) een tweede kenmerk naast de achtergrondkleur: een streep aan de zijkant, een vetter lettergewicht of een pictogram. Binnen eigen bereik: zet in de eigen stylesheet een zichtbare \`border-inline-start\` of \`font-weight\` op \`nldd-list-item\[current\]\` en \`nldd-list-item\[selected\]\`, zoals de streep in de brede menubalk.

**Waar**

- P13 5. Gebruik cloud verantwoord en blijf wendbaar - NeRDS: Nederlandse Richtlijn Digitale Systemen: bij “5. Cloud”, `` zijmenu links van de inhoud, de regel van de huidige pagina (link met `aria-current="page"`) ``
- P04 Contact en bijdragen - NeRDS: Nederlandse Richtlijn Digitale Systemen: bij “Contact en bijdragen”, `zijmenu links van de inhoud, de regel van de huidige pagina`
- P12 11. Algoritmen - NeRDS: Nederlandse Richtlijn Digitale Systemen: onder de kop “Menu”, bij “Richtlijnen”, `geopend hoofdmenu op 360 pixels breed (toestand component-menu-smal), de link van het huidige onderdeel`
- P01 NeRDS: Nederlandse Richtlijn Digitale Systemen: onder de kop “Menu”, bij “Home”, `geopend hoofdmenu op 360 pixels breed (toestand component-menu-smal), de link van de huidige pagina`

<a id="sc-1.4.3"></a>

##### 1.4.3 Contrast (minimum)

**Uitkomst:** ✕ Voldoet niet · Niveau AA · EN 301 549: 9.1.4.3 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) · [Onderbouwing in bijlage A](#bijlage-1.4.3) (6 waarnemingen)

De witte letters in de schaal van het toegankelijkheidslabel op P09 hebben te weinig contrast. Alle andere gemeten tekst voldoet, in licht en donker. De kleur bij aanwijzen en focus is maar voor een deel gemeten.

Zekerheid: De beoordelaar kwam op kan niet bepalen, de verificatie op voldoet niet. 1 bevinding toegevoegd door de verificatie.

Open: 3 punten, zie [Nog uitzoeken](#open-1.4.3).

**Bevindingen (1)**

<a id="NERD-1.4.3-3211"></a>

###### NERD-1.4.3-3211 Witte letters in de schaal van het toegankelijkheidslabel hebben te weinig contrast

- Ernst: laag
- Eigenaar: leverancier
- Onderdeel: geen
- Pagina's: gemeten op P09; de beoordelaar vond op de 29 bewaarde pagina's geen andere afbeelding
- Gebrek: [NERD-G-ea7b](#NERD-G-ea7b)
- Controle: Toegevoegd door de verificatie, één keer gezien

**Wat is er mis**

In de afbeelding van het toegankelijkheidslabel staat links een schaal met witte letters A tot en met E op gekleurde vlakken. Afgelezen op de pixels van de uitsnede: C op lichtoranje \#febd57 1,6, D op oranje \#fd6b39 2,8, B 3,8 en E 3,9. De eis is 4,5.

**Wie heeft er last van**

Wie weinig contrast ziet, leest de letters van de schaal moeilijk of niet, vooral de C. De status zelf staat wel goed leesbaar in zwarte letters naast de schaal.

**Oplossing**

De afbeelding komt van toegankelijkheidsverklaring.nl; meld het daar. Binnen eigen bereik: zet de status en de datum als gewone tekst op de pagina met een link naar de verklaring, of toon een eigen versie van het label met donkere letters op de lichte vlakken.

**Waar**

- P09 Toegankelijkheid - NeRDS: Nederlandse Richtlijn Digitale Systemen: onder de kop “Toegankelijkheid”, bij “Het toegankelijkheidslabel van de NeRDS: status D, voldoet niet.”, `` afbeelding van het toegankelijkheidslabel in de tekst, `#content > p:nth-of-type(4) > img`: de kleurenschaal links in het beeld ``

<a id="sc-1.4.4"></a>

##### 1.4.4 Herschalen van tekst

**Uitkomst:** ✕ Voldoet niet · Niveau AA · EN 301 549: 9.1.4.4 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html) · [Onderbouwing in bijlage A](#bijlage-1.4.4) (6 waarnemingen)

Bij 200% vergroting verdwijnt het woord "GitHub" bij de link in de kop; alleen een pictogram blijft over. De site blokkeert het vergroten niet. Of er verder inhoud verdwijnt, is niet op alle pagina's vergeleken.

Zekerheid: Beoordelaar en verificatie komen op dezelfde uitkomst. 1 bevinding opnieuw gemaakt.

Open: 1 punt, zie [Nog uitzoeken](#open-1.4.4).

**Bevindingen (1)**

<a id="NERD-1.4.4-4fca"></a>

###### NERD-1.4.4-4fca Het woord "GitHub" bij de link in de kop verdwijnt bij vergroten

- Ernst: laag. Eigenaar: techniek. Onderdeel: kop: hulplinks. Raakt een element van de leverancier: `nldd-menu-bar-item`. Pagina's: gemeten op P01, P13 en P09; volgens het dossier op alle 29 pagina's
- Gebrek: [NERD-G-5fea](#NERD-G-5fea). Hoofdcriterium: 1.4.10, zie [NERD-1.4.10-921b](#NERD-1.4.10-921b)
- Controle: Opnieuw gemaakt bij de verificatie
- Wat is er mis: Op 100% staat in de kop een pictogram met het woord "GitHub" ernaast. Op 200% is het woord 1 bij 1 pixel en verborgen; alleen het pictogram van een vertakking blijft over. Aanwijzen toont geen tekst.
- Wie heeft er last van: Wie slecht ziet en de pagina vergroot, ziet alleen een klein pictogram en kan niet lezen waar de link heen gaat. Bezoekers zonder vergroting lezen dat wel.
- Oplossing: Laat de tekst naast het pictogram staan op elke breedte, of neem de link met tekst op in het menu achter de menuknop. Meet het resultaat opnieuw op 320 pixels en op een tussenbreedte.
- Waar: P01 NeRDS: Nederlandse Richtlijn Digitale Systemen: onder de kop “Overheid”, bij “GitHub”, `link in de kop, rechts naast de knop Feedback, op 200% vergroting`
- Waar: P13 5. Gebruik cloud verantwoord en blijf wendbaar - NeRDS: Nederlandse Richtlijn Digitale Systemen: onder de kop “Overheid”, bij “GitHub”, `dezelfde link in de kop, op 200% vergroting`

<a id="sc-1.4.5"></a>

##### 1.4.5 Afbeeldingen van tekst

**Uitkomst:** ✕ Voldoet niet · Niveau AA · EN 301 549: 9.1.4.5 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/images-of-text.html) · [Onderbouwing in bijlage A](#bijlage-1.4.5) (3 waarnemingen)

Op de pagina Toegankelijkheid staat het toegankelijkheidslabel als afbeelding met 66 woorden gewone tekst erin. Dat is bij de tweede toetsing opnieuw gemeten. Verder heeft de site volgens het dossier alleen pictogrammen en het logo.

Zekerheid: Beoordelaar en verificatie komen op dezelfde uitkomst. 1 bevinding opnieuw gemaakt.

**Bevindingen (1)**

<a id="NERD-1.4.5-6815"></a>

###### NERD-1.4.5-6815 Toegankelijkheidslabel is een afbeelding met lopende tekst

- Ernst: laag
- Eigenaar: content
- Onderdeel: geen
- Pagina's: gemeten op P09; volgens het dossier komt de afbeelding alleen op P09 voor (1 keer op 29 pagina's)
- Gebrek: [NERD-G-8ab9](#NERD-G-8ab9)
- Controle: Opnieuw gemaakt bij de verificatie

**Wat is er mis**

Het label is één afbeelding van 692 bij 324 pixels. Er staan 66 woorden in, zoals "Deze status is toegekend op basis van een eigen verklaring." Die tekst staat niet als tekst in de code. Het is geen logo en alleen de balk met letters is een schema.

**Wie heeft er last van**

Wie slecht ziet en een eigen lettertype, kleur of regelafstand instelt, ziet de tekst in het label niet mee veranderen. Een deel van de uitleg staat alleen in het beeld.

**Oplossing**

Zet de inhoud van het label als gewone HTML-tekst op de pagina: de status, de datum en een link naar de verklaring. Laat de afbeelding weg, of toon alleen de schaal A-E als afbeelding zonder de alinea's. De aanbieder van het label levert het als svg met tekst; meld het daar ook.

**Waar**

- P09 Toegankelijkheid - NeRDS: Nederlandse Richtlijn Digitale Systemen: onder de kop “Toegankelijkheid”, `` afbeelding van het label onder de alinea's in de hoofdinhoud, `img[alt^="Het toegankelijkheidslabel"]` ``

<a id="sc-1.4.10"></a>

##### 1.4.10 Reflow

**Uitkomst:** ✕ Voldoet niet · Niveau AA · EN 301 549: 9.1.4.10 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) · [Onderbouwing in bijlage A](#bijlage-1.4.10) (6 waarnemingen)

Geen pagina schuift opzij op 320 pixels breed. Wel gaat er tekst verloren: de titel van het venster voor een Kubernetes cluster is afgekapt, en van de link GitHub in de kop blijft alleen een pictogram over.

Zekerheid: Beoordelaar en verificatie komen op dezelfde uitkomst. 2 bevindingen opnieuw gemaakt.

Open: 1 punt, zie [Nog uitzoeken](#open-1.4.10).

**Bevindingen (2)**

<a id="NERD-1.4.10-8bd8"></a>

###### NERD-1.4.10-8bd8 Titel afgekapt in het venster voor een Kubernetes cluster

- Ernst: laag
- Eigenaar: techniek
- Onderdeel: venster Kubernetes cluster aanmaken
- Raakt een element van de leverancier: `nldd-top-title-bar`
- Pagina's: gemeten op P13; het venster staat volgens het dossier alleen op P13
- Gebrek: [NERD-G-c95d](#NERD-G-c95d)
- Controle: Opnieuw gemaakt bij de verificatie

**Wat is er mis**

Op 320 pixels breed eindigt de titel van het venster na de letters aanm met drie puntjes. De rest is nergens in het venster te lezen. Op het brede scherm staat de titel er volledig.

**Wie heeft er last van**

Wie de pagina sterk vergroot of een smal scherm gebruikt, ziet de titel van het venster niet volledig en moet raden wat er staat.

**Oplossing**

Laat de titel van het venster doorlopen op een volgende regel in plaats van hem af te kappen: geen \`white-space: nowrap\` met \`text-overflow: ellipsis\` op de kop. Meet het resultaat opnieuw op 320 pixels en op een tussenbreedte.

**Waar**

- P13 5. Gebruik cloud verantwoord en blijf wendbaar - NeRDS: Nederlandse Richtlijn Digitale Systemen: onder de kop “Kubernetes cluster aanmaken”, `venster achter de knop Aanmaken bij Kubernetes Service, op 320 pixels breed: de kop van niveau 2 bovenin`

<a id="NERD-1.4.10-921b"></a>

###### NERD-1.4.10-921b Van de link GitHub in de kop blijft op een smal scherm alleen een pictogram over

- Ernst: laag
- Eigenaar: techniek
- Onderdeel: kop van de site, hulplinks
- Raakt een element van de leverancier: `nldd-menu-bar-item`
- Pagina's: gemeten op P01 en P18; volgens het dossier op alle 29 pagina's
- Gebrek: [NERD-G-5fea](#NERD-G-5fea). Hoofdcriterium: dit criterium. Raakt ook: 1.4.4
- Controle: Opnieuw gemaakt bij de verificatie

**Wat is er mis**

Op het brede scherm staat het woord GitHub naast een pictogram. Op 320 pixels breed is het woord teruggebracht tot 1 bij 1 pixel en staat er alleen een pictogram van een vertakking, 44 bij 44 pixels. Bij aanwijzen verschijnt geen tekst.

**Wie heeft er last van**

Wie de pagina sterk vergroot of een smal scherm gebruikt, ziet niet waar deze link heen gaat. Het pictogram is geen bekend beeldmerk en zegt dat niet uit zichzelf.

**Oplossing**

Houd de tekst van de link zichtbaar op elke breedte, of verplaats de link op een smal scherm naar het menu achter de knop Menu, met de tekst erbij. Meet het resultaat opnieuw op 320 pixels en op een tussenbreedte.

**Waar**

- P01 NeRDS: Nederlandse Richtlijn Digitale Systemen: bij “GitHub”, `` kop van de pagina op 320 pixels breed, laatste link in de balk met Menu, Zoeken en Feedback: `a.menu-bar-item[aria-label=GitHub]` ``
- P18 Gebruikersbehoeften: wanneer doe je wat? - NeRDS: Nederlandse Richtlijn Digitale Systemen: bij “GitHub”, `dezelfde link in de kop, op 320 pixels breed`

<a id="sc-1.4.11"></a>

##### 1.4.11 Contrast van niet-tekstuele content

**Uitkomst:** ✕ Voldoet niet · Niveau AA · EN 301 549: 9.1.4.11 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) · [Onderbouwing in bijlage A](#bijlage-1.4.11) (5 waarnemingen)

Het huidige item in het zijmenu en in het hoofdmenu op een smal scherm is alleen te herkennen aan een lichtgrijs vlak dat te weinig afsteekt. Velden, keuzelijsten en de nagemeten focusrand zijn bij de toetsing in orde bevonden.

Zekerheid: Beoordelaar en verificatie komen op dezelfde uitkomst. 1 bevinding opnieuw gemaakt.

Open: 4 punten, zie [Nog uitzoeken](#open-1.4.11).

**Bevindingen (1)**

<a id="NERD-1.4.11-2dee"></a>

###### NERD-1.4.11-2dee Het huidige item in het zijmenu en het smalle hoofdmenu steekt te weinig af

- Ernst: laag
- Eigenaar: design
- Onderdeel: menu-item met geselecteerde toestand (zijmenu en hoofdmenu op smal scherm)
- Raakt een element van de leverancier: `nldd-list-item`
- Pagina's: gemeten op P14 (zijmenu, licht en donker), P05 (zijmenu, licht) en P01 (smal hoofdmenu, licht); volgens het dossier staat het zijmenu op 26 pagina's en het hoofdmenu op alle 29
- Gebrek: [NERD-G-c420](#NERD-G-c420)
- Controle: Opnieuw gemaakt bij de verificatie

**Wat is er mis**

Het item van de pagina waar je bent, heeft alleen een lichtgrijs vlak. In het zijmenu is dat \#d9dee5 op \#f5f7f9 (1,2:1), in donker \#3c4450 op \#1a1e24 (1,7:1). In het hoofdmenu op een smal scherm hooguit \#c8ced8 op wit (1,5:1). De tekst ziet er hetzelfde uit als bij de andere items.

**Wie heeft er last van**

Wie slecht ziet of een scherm met weinig contrast gebruikt, ziet niet welk item bij de huidige pagina hoort. De pagina blijft wel te gebruiken: de kop en het kruimelpad zeggen ook waar je bent.

**Oplossing**

Geef het geselecteerde item naast het vlak een aanduiding met minstens 3:1 tegen de ondergrond, in licht en donker: een donkere streep aan de zijkant, of een vlak dat 3:1 haalt. Meet daarna opnieuw. Binnen eigen bereik: tot het component is aangepast kan de site de kleur van het geselecteerde vlak zelf overschrijven.

**Waar**

- P14 Cloud: wanneer doe je wat? - NeRDS: Nederlandse Richtlijn Digitale Systemen: onder de kop “Aanvullend (indien passend)”, bij “Wanneer doe je wat?”, `zijmenu links van de inhoud, het item van de huidige pagina (link met aria-current), licht en donker`
- P05 Cookies - NeRDS: Nederlandse Richtlijn Digitale Systemen: onder de kop “Heb je vragen?”, bij “Cookies”, `zijmenu links van de inhoud, het item van de huidige pagina (link met aria-current), licht`
- P01 NeRDS: Nederlandse Richtlijn Digitale Systemen: onder de kop “Menu”, bij “Home”, `hoofdmenu achter de knop Menu op 360 pixels breed (toestand component-menu-smal), eerste item`

<a id="sc-1.4.12"></a>

##### 1.4.12 Tekstafstand

**Uitkomst:** ◐ Geen afwijking gevonden, niet volledig gemeten · Niveau AA · EN 301 549: 9.1.4.12 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html) · [Onderbouwing in bijlage A](#bijlage-1.4.12) (6 waarnemingen)

Met ruimere tekstafstand blijft alle tekst leesbaar op 29 pagina's, breed en smal. Geen tekst weigerde de afstand (0). Niet gemeten is het menu achter de knop met drie puntjes, waar dan een deel van het hoofdmenu in terechtkomt.

Zekerheid: Beoordelaar en verificatie komen op dezelfde uitkomst.

Dekking: Dossier: gemeten op 29 van 29 pagina's op 1280 en op 320 pixels breed en in 12 van 12 toestanden. Bij de verificatie zelf nagemeten op 7 pagina's (P03, P04, P10, P11 en P29 op 320 pixels, P13 op 1030 pixels, P14 op 1280 pixels) en in 2 geopende onderdelen (praktische tips op P17, clustervenster op P13). Geen verlies van tekst gevonden. Niet gemeten: het menu achter de knop met drie puntjes met ruimere tekstafstand.

Open: 2 punten, zie [Nog uitzoeken](#open-1.4.12).

<a id="sc-1.4.13"></a>

##### 1.4.13 Content bij hover of focus

**Uitkomst:** ✕ Voldoet niet · Niveau AA · EN 301 549: 9.1.4.13 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html) · [Onderbouwing in bijlage A](#bijlage-1.4.13) (5 waarnemingen)

Op een smal scherm ligt het tekstballonnetje van de kopieerknop over de code en gaat het bij aanwijzen met de muis niet weg met Escape. De ballonnetjes bij de wisknop van het zoekvenster en bij de knop Verberg bedekken geen tekst.

Zekerheid: Beoordelaar en verificatie komen op dezelfde uitkomst. 1 bevinding opnieuw gemaakt.

Open: 4 punten, zie [Nog uitzoeken](#open-1.4.13).

**Bevindingen (1)**

<a id="NERD-1.4.13-5009"></a>

###### NERD-1.4.13-5009 Tekstballonnetje van de kopieerknop bedekt code en gaat bij aanwijzen niet weg met Escape

- Ernst: laag
- Eigenaar: leverancier
- Onderdeel: codeblok met kopieerknop
- Raakt een element van de leverancier: `nldd-code-viewer`
- Pagina's: gemeten op P04 op 320 pixels breed, op één codeblok; op P13 staat hetzelfde soort codeblok in een venster, daar niet gemeten; niet in het dossier
- Gebrek: [NERD-G-051b](#NERD-G-051b)
- Controle: Opnieuw gemaakt bij de verificatie

**Wat is er mis**

Op 320 pixels breed verschijnt bij het aanwijzen van de kopieerknop het ballonnetje 'Kopieer' over het eind van de zichtbare coderegel \`uv run python scripts/check\_site.py\`. Na Escape stond het er nog.

**Wie heeft er last van**

Wie sterk vergroot en met de muis werkt, kan een deel van de code niet lezen zolang de muis op de knop staat. Vooral mensen met een schermvergroter hebben daar last van, omdat de muis verplaatsen bij hen het beeld verschuift.

**Oplossing**

Laat de tooltip van de kopieerknop in het codeblok-component op Escape sluiten zolang hij open is, ook als de focus niet op de knop staat (luister op documentniveau). Of plaats de tooltip buiten de coderegel, zodat hij geen code bedekt.

**Waar**

- P04 Contact en bijdragen - NeRDS: Nederlandse Richtlijn Digitale Systemen: onder de kop “Uitgebreide ontwikkelomgeving”, bij “Controleer je wijzigingen”, `tweede codeblok onder de kop, knop Kopieer rechts in het blok, op 320 pixels breed`

### 2 Bedienbaar

#### Richtlijn 2.1 Toetsenbordtoegankelijk

<a id="sc-2.1.1"></a>

##### 2.1.1 Toetsenbord

**Uitkomst:** ◐ Geen afwijking gevonden, niet volledig gemeten · Niveau A · EN 301 549: 9.2.1.1 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html) · [Onderbouwing in bijlage A](#bijlage-2.1.1) (6 waarnemingen)

Geen fout gevonden: alle 29 pagina's, de menu's, de vensters en de formulieren zijn met het toetsenbord te bedienen, ook het zijmenu op een smal scherm. Eén klikbaar gemarkeerd tekstblok in het lege zoekvenster is niet aangeklikt.

Zekerheid: Beoordelaar en verificatie komen op dezelfde uitkomst.

Dekking: Het dossier doorliep 29 van 29 pagina's met Tab (1269 Tab-stops, 0 elementen niet bereikt) en activeerde 9 unieke knoppen. Bij de verificatie gemeten op 8 pagina's (P01, P02, P03, P04, P11, P12, P13, P14) en in 7 geopende toestanden: zijmenu smal, hoofdmenu smal, zoeken met resultaten, feedback, clustervenster, clusterformulier en het scherm na versturen. Geen fout gevonden.

Open: 1 punt, zie [Nog uitzoeken](#open-2.1.1).

#### Richtlijn 2.2 Genoeg tijd

<a id="sc-2.2.1"></a>

##### 2.2.1 Timing aanpasbaar

**Uitkomst:** ? Kan niet bepalen · Niveau A · EN 301 549: 9.2.2.1 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable.html) · [Onderbouwing in bijlage A](#bijlage-2.2.1) (5 waarnemingen)

Er is geen tijdslimiet gevonden: geen pagina ververst zichzelf, er verandert niets vanzelf en foutmeldingen blijven staan. Twee formulieren zijn geen zoekformulier; of daar een sessie achter zit die verloopt, is van buitenaf niet te zien.

Zekerheid: Beoordelaar en verificatie komen op dezelfde uitkomst.

Open: 2 punten, zie [Nog uitzoeken](#open-2.2.1).

#### Richtlijn 2.4 Navigeerbaar

<a id="sc-2.4.3"></a>

##### 2.4.3 Focus volgorde

**Uitkomst:** ✕ Voldoet niet · Niveau A · EN 301 549: 9.2.4.3 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html) · [Onderbouwing in bijlage A](#bijlage-2.4.3) (6 waarnemingen)

De bevinding is nagemaakt: op een smal scherm brengt een link naar een hoofdstuk in het zijmenu de focus niet naar dat hoofdstuk. De andere kandidaten zijn nagemeten en zijn geen fout in de volgorde.

Zekerheid: Beoordelaar en verificatie komen op dezelfde uitkomst. 1 bevinding opnieuw gemaakt.

**Bevindingen (1)**

<a id="NERD-2.4.3-1ab1"></a>

###### NERD-2.4.3-1ab1 Link naar een hoofdstuk in het zijmenu brengt de focus niet naar dat hoofdstuk (smal scherm)

- Ernst: midden
- Eigenaar: techniek
- Onderdeel: zijmenu van de sectie op een smal scherm
- Raakt een element van de leverancier: `nldd-list-item`
- Pagina's: gemeten op P04 en P12; op P12 komt de volgende Tab toevallig wel in het gekozen hoofdstuk; het zijmenu staat volgens het dossier op 26 van de 29 pagina's
- Gebrek: [NERD-G-2983](#NERD-G-2983)
- Controle: Opnieuw gemaakt bij de verificatie

**Wat is er mis**

Op P04, 360 breed: na Enter op de link naar een hoofdstuk schuift de pagina achter het venster (0 naar 1889), maar het venster blijft open. Na Escape staat de focus op de knop van het zijmenu, buiten beeld. De volgende Tab springt terug naar boven (1889 naar 73).

**Wie heeft er last van**

Wie met het toetsenbord werkt, kiest een hoofdstuk en ziet het na sluiten ook, maar de focus is er niet. De eerste Tab brengt de bezoeker terug naar het begin van de pagina, en hij moet door alle links ervoor lopen.

**Oplossing**

Sluit het venster (sheet) zodra een fragmentlink in de lijst wordt geactiveerd en zet de focus daarna op het doel in plaats van op de openende knop: geef de doelkop \`tabindex="-1"\` en roep daar \`focus()\` op na het sluiten.

**Waar**

- P04 Contact en bijdragen - NeRDS: Nederlandse Richtlijn Digitale Systemen: onder de kop “Over NeRDS”, bij “Code of Conduct”, `geopend zijmenu op 360 pixels breed, link naar een hoofdstuk in de lijst onder Op deze pagina`
- P12 11. Algoritmen - NeRDS: Nederlandse Richtlijn Digitale Systemen: onder de kop “Richtlijnen”, bij “Hoe pas je het toe?”, `geopend zijmenu op 320 pixels breed, link naar een hoofdstuk in de lijst onder Op deze pagina`

<a id="sc-2.4.5"></a>

##### 2.4.5 Meerdere manieren

**Uitkomst:** ● Voldoet · Niveau AA · EN 301 549: 9.2.4.5 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/multiple-ways.html) · [Onderbouwing in bijlage A](#bijlage-2.4.5) (4 waarnemingen)

Elke pagina is op minstens twee manieren te vinden: via de menu's, via de zoekfunctie die op elke pagina staat en resultaten geeft, en via links op andere pagina's.

Zekerheid: Beoordelaar en verificatie komen op dezelfde uitkomst.

Open: 1 punt, zie [Nog uitzoeken](#open-2.4.5).

<a id="sc-2.4.11"></a>

##### 2.4.11 Focus niet bedekt (minimum)

**Uitkomst:** ✕ Voldoet niet · Niveau AA · EN 301 549: 9.2.4.11 · Nieuw in WCAG 2.2 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html) · [Onderbouwing in bijlage A](#bijlage-2.4.11) (5 waarnemingen)

Aan het eind van de pagina schuift het zijmenu onder de voet. Een link daar die focus krijgt, is dan helemaal onzichtbaar. Gemeten in Chromium, dat een element bij focus meestal naar het midden schuift; hier gebeurde dat niet.

Zekerheid: De beoordelaar kwam op voldoet, de verificatie op voldoet niet. 1 bevinding toegevoegd door de verificatie.

Open: 1 punt, zie [Nog uitzoeken](#open-2.4.11).

**Bevindingen (1)**

<a id="NERD-2.4.11-f0f2"></a>

###### NERD-2.4.11-f0f2 Links in het zijmenu liggen aan het eind van de pagina onder de voet en zijn met focus onzichtbaar

- Ernst: midden
- Eigenaar: techniek
- Onderdeel: zijmenu met inhoudsopgave
- Raakt een element van de leverancier: `nldd-list-item`
- Pagina's: gemeten op P14; het dossier noemt een link in hetzelfde zijmenu op 17 pagina's (P12 en verder), daar niet gemeten
- Gebrek: [NERD-G-66e2](#NERD-G-66e2)
- Controle: Toegevoegd door de verificatie, één keer gezien

**Wat is er mis**

Op P14, helemaal naar beneden gescrold, schuift het zijmenu onder de voet. De link "Fases en gewenste uitkomsten: 4. Productie" kreeg focus en bleef onder de voet liggen. De pagina schoof niet. Van de link en zijn aanduiding is niets te zien.

**Wie heeft er last van**

Wie met het toetsenbord werkt en onderaan de pagina door het zijmenu loopt, ziet niet meer waar de focus staat. Die bezoeker moet zelf omhoog scrollen om te zien welke link gekozen wordt.

**Oplossing**

Laat het vastgezette zijmenu eindigen waar de kolom met de inhoud eindigt, zodat het niet onder de voet schuift. Begrens de hoogte van het blok met \`position: sticky\` tot het venster (\`max-height\` met \`overflow-y: auto\`). Meet daarna opnieuw met de pagina helemaal naar beneden gescrold.

**Waar**

- P14 Cloud: wanneer doe je wat? - NeRDS: Nederlandse Richtlijn Digitale Systemen: bij “Fases en gewenste uitkomsten: 4. Productie”, `zijmenu links, laatste link van de inhoudsopgave, met de pagina helemaal naar beneden gescrold op 1280 pixels breed`

#### Richtlijn 2.5 Input modaliteiten

<a id="sc-2.5.2"></a>

##### 2.5.2 Aanwijzerannulering

**Uitkomst:** ◐ Geen afwijking gevonden, niet volledig gemeten · Niveau A · EN 301 549: 9.2.5.2 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/pointer-cancellation.html) · [Onderbouwing in bijlage A](#bijlage-2.5.2) (6 waarnemingen)

Geen afwijking gevonden. Bij het indrukken van de muis wordt nergens een functie uitgevoerd; hooguit verschijnt een hulptekst die weer verdwijnt. 96 soorten bedieningselementen zijn vooraf niet geprobeerd, dus het oordeel blijft open.

Zekerheid: Beoordelaar en verificatie komen op dezelfde uitkomst.

Dekking: Vooraf geprobeerd: 300 van de 396 soorten bedieningselementen op 29 pagina's in de begintoestand, 299 zonder reactie en 1 met alleen een hulptekst. Bij de beoordeling en de controle samen ruim 50 elementen met de hand geprobeerd op 11 pagina's (P01, P04, P13, P14, P16, P17, P18, P21, P24, P26 en P29) en naast 6 geopende onderdelen gedrukt. Geen functie gevonden die bij het indrukken wordt uitgevoerd.

Open: 2 punten, zie [Nog uitzoeken](#open-2.5.2).

### 3 Begrijpelijk

#### Richtlijn 3.3 Assistentie bij invoer

<a id="sc-3.3.7"></a>

##### 3.3.7 Overbodige invoer

**Uitkomst:** ? Kan niet bepalen · Niveau A · EN 301 549: 9.3.3.7 · Nieuw in WCAG 2.2 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry.html) · [Onderbouwing in bijlage A](#bijlage-3.3.7) (5 waarnemingen)

Het proefformulier voor een cluster vraagt niets twee keer. Bij feedback gaat de laatste stap buiten de site verder. Vast staat dat een ingevulde link bij een fout of vraag niet meegaat naar GitHub; de pagina daar is niet te zien.

Zekerheid: Beoordelaar en verificatie komen op dezelfde uitkomst.

Open: 2 punten, zie [Nog uitzoeken](#open-3.3.7).

### 4 Robuust

#### Richtlijn 4.1 Compatibel

<a id="sc-4.1.2"></a>

##### 4.1.2 Naam, rol, waarde

**Uitkomst:** ✕ Voldoet niet · Niveau A · EN 301 549: 9.4.1.2 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html) · [Onderbouwing in bijlage A](#bijlage-4.1.2) (5 waarnemingen)

Eén gebrek blijft na controle staan: het schuivende vak om het zijmenu krijgt in Firefox focus zonder rol en zonder naam. De nagemeten knoppen, links, velden en vensters hebben een rol, een naam en melden hun toestand.

Zekerheid: Beoordelaar en verificatie komen op dezelfde uitkomst. 1 bevinding opnieuw gemaakt.

**Bevindingen (1)**

<a id="NERD-4.1.2-f0f1"></a>

###### NERD-4.1.2-f0f1 Schuivend vak om het zijmenu krijgt focus zonder rol en naam

- Ernst: laag
- Eigenaar: leverancier
- Onderdeel: zijmenu (nldd-sidebar-section)
- Raakt een element van de leverancier: `nldd-sidebar-section`
- Pagina's: gemeten op P17; het zijmenu staat volgens het dossier op 26 van de 29 pagina's, of het vak daar ook schuift is niet gemeten
- Gebrek: [NERD-G-a4da](#NERD-G-a4da)
- Controle: Opnieuw gemaakt bij de verificatie

**Wat is er mis**

Het vak om het zijmenu kan schuiven en krijgt in Firefox met Tab focus, vóór de eerste link van het zijmenu. Volgens de browser heeft het de rol generic en geen naam. Twee andere methoden leiden een naam af uit de inhoud.

**Wie heeft er last van**

Wie in Firefox met een schermlezer en het toetsenbord werkt, komt op een stop waar niets zinnigs wordt voorgelezen. Het is onduidelijk wat het is en wat je er kunt doen. Doorgaan met Tab lukt wel.

**Oplossing**

Geef de schuifcontainer \`div.sidebar-section\_\_sidebar-box\` in de shadow root van \`nldd-sidebar-section\` een \`role="region"\` met een \`aria-label\`, of zet er \`tabindex="-1"\` op zodat alleen de links erin een Tab-stop zijn. Meet daarna opnieuw in Firefox.

**Waar**

- P17 1. Stel gebruikersbehoeften vast - NeRDS: Nederlandse Richtlijn Digitale Systemen: bij “Overzicht richtlijnen”, `` het schuivende vak om het zijmenu links van de inhoud, `div.sidebar-section__sidebar-box` in `nldd-sidebar-section` ``

<a id="sc-4.1.3"></a>

##### 4.1.3 Statusberichten

**Uitkomst:** ● Voldoet · Niveau AA · EN 301 549: 9.4.1.3 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html) · [Onderbouwing in bijlage A](#bijlage-4.1.3) (6 waarnemingen)

Alle 13 zelf opgeroepen meldingen (zoeken, feedbackformulier, proefformulier voor een cluster, kopieerknoppen) komen in een voorleesgebied. De bedankmelding van het feedbackformulier staat in een gebied dat tot dat moment verborgen is; dat is een aandachtspunt.

Zekerheid: Beoordelaar en verificatie komen op dezelfde uitkomst.

Open: 1 punt, zie [Nog uitzoeken](#open-4.1.3).

## Bevindingen per onderdeel

Bevindingen in hetzelfde onderdeel zijn vaak met één aanpassing op te lossen. Daarom staan ze hier bij elkaar, elk met het nummer dat naar de bevinding verwijst.

| Onderdeel | Bevindingen |
| --- | --- |
| codeblok met kopieerknop | [NERD-1.4.13-5009](#NERD-1.4.13-5009) |
| hoofdmenu op smal scherm | [NERD-1.3.1-75d1](#NERD-1.3.1-75d1) |
| kaartenraster (nldd-collection met nldd-card) | [NERD-1.3.1-9438](#NERD-1.3.1-9438) |
| kop van de site, hulplinks | [NERD-1.4.10-921b](#NERD-1.4.10-921b) |
| kop: hulplinks | [NERD-1.4.4-4fca](#NERD-1.4.4-4fca) |
| menu-item met geselecteerde toestand (zijmenu en hoofdmenu op smal scherm) | [NERD-1.4.11-2dee](#NERD-1.4.11-2dee) |
| venster Kubernetes cluster aanmaken | [NERD-1.4.10-8bd8](#NERD-1.4.10-8bd8) |
| zijmenu (nldd-sidebar-section) | [NERD-4.1.2-f0f1](#NERD-4.1.2-f0f1) |
| zijmenu en smal hoofdmenu (nldd-list-item) | [NERD-1.4.1-f439](#NERD-1.4.1-f439) |
| zijmenu met inhoudsopgave | [NERD-2.4.11-f0f2](#NERD-2.4.11-f0f2) |
| zijmenu van de sectie op een smal scherm | [NERD-2.4.3-1ab1](#NERD-2.4.3-1ab1) |
| Zonder onderdeel | [NERD-1.4.3-3211](#NERD-1.4.3-3211), [NERD-1.4.5-6815](#NERD-1.4.5-6815) |

## Gebreken per pagina

Een gebrek staat hier bij elke pagina waar een van zijn bevindingen een plek aanwijst. Het kan op meer pagina's spelen; dat staat in de werklijst.

| Pagina | Gebreken |
| --- | --- |
| P01 NeRDS: Nederlandse Richtlijn Digitale Systemen | [Huidige pagina in het menu alleen met een grijs vlak aangegeven](#NERD-G-a930)<br>[Reeksen kaarten zijn geen lijst](#NERD-G-e79d)<br>[Van de link GitHub in de kop blijft op een smal scherm alleen een pictogram over](#NERD-G-5fea)<br>[Het huidige item in het zijmenu en het smalle hoofdmenu steekt te weinig af](#NERD-G-c420) |
| P02 Pagina niet gevonden - NeRDS: Nederlandse Richtlijn Digitale Systemen | Geen gebrek met een plek op deze pagina. |
| P03 Over de Nederlandse Richtlijn Digitale Systemen - NeRDS: Nederlandse Richtlijn Digitale Systemen | Geen gebrek met een plek op deze pagina. |
| P04 Contact en bijdragen - NeRDS: Nederlandse Richtlijn Digitale Systemen | [Huidige pagina in het menu alleen met een grijs vlak aangegeven](#NERD-G-a930)<br>[Link naar een hoofdstuk in het zijmenu brengt de focus niet naar dat hoofdstuk (smal scherm)](#NERD-G-2983)<br>[Tekstballonnetje van de kopieerknop bedekt code en gaat bij aanwijzen niet weg met Escape](#NERD-G-051b) |
| P05 Cookies - NeRDS: Nederlandse Richtlijn Digitale Systemen | [Het huidige item in het zijmenu en het smalle hoofdmenu steekt te weinig af](#NERD-G-c420) |
| P06 Copyright - NeRDS: Nederlandse Richtlijn Digitale Systemen | Geen gebrek met een plek op deze pagina. |
| P07 Kwetsbaarheid melden - NeRDS: Nederlandse Richtlijn Digitale Systemen | Geen gebrek met een plek op deze pagina. |
| P08 Privacy - NeRDS: Nederlandse Richtlijn Digitale Systemen | Geen gebrek met een plek op deze pagina. |
| P09 Toegankelijkheid - NeRDS: Nederlandse Richtlijn Digitale Systemen | [Huidig onderdeel in het smalle menu alleen zichtbaar aangegeven](#NERD-G-736d)<br>[Witte letters in de schaal van het toegankelijkheidslabel hebben te weinig contrast](#NERD-G-ea7b)<br>[Toegankelijkheidslabel is een afbeelding met lopende tekst](#NERD-G-8ab9) |
| P10 Versies - NeRDS: Nederlandse Richtlijn Digitale Systemen | Geen gebrek met een plek op deze pagina. |
| P11 Overzicht richtlijnen - NeRDS: Nederlandse Richtlijn Digitale Systemen | [Reeksen kaarten zijn geen lijst](#NERD-G-e79d) |
| P12 11. Algoritmen - NeRDS: Nederlandse Richtlijn Digitale Systemen | [Huidige pagina in het menu alleen met een grijs vlak aangegeven](#NERD-G-a930)<br>[Link naar een hoofdstuk in het zijmenu brengt de focus niet naar dat hoofdstuk (smal scherm)](#NERD-G-2983) |
| P13 5. Gebruik cloud verantwoord en blijf wendbaar - NeRDS: Nederlandse Richtlijn Digitale Systemen | [Huidige pagina in het menu alleen met een grijs vlak aangegeven](#NERD-G-a930)<br>[Reeksen kaarten zijn geen lijst](#NERD-G-e79d)<br>[Van de link GitHub in de kop blijft op een smal scherm alleen een pictogram over](#NERD-G-5fea)<br>[Titel afgekapt in het venster voor een Kubernetes cluster](#NERD-G-c95d) |
| P14 Cloud: wanneer doe je wat? - NeRDS: Nederlandse Richtlijn Digitale Systemen | [Links in het zijmenu liggen aan het eind van de pagina onder de voet en zijn met focus onzichtbaar](#NERD-G-66e2)<br>[Het huidige item in het zijmenu en het smalle hoofdmenu steekt te weinig af](#NERD-G-c420) |
| P15 10. Data - NeRDS: Nederlandse Richtlijn Digitale Systemen | Geen gebrek met een plek op deze pagina. |
| P16 13. Duurzaamheid - NeRDS: Nederlandse Richtlijn Digitale Systemen | Geen gebrek met een plek op deze pagina. |
| P17 1. Stel gebruikersbehoeften vast - NeRDS: Nederlandse Richtlijn Digitale Systemen | [Schuivend vak om het zijmenu krijgt focus zonder rol en naam](#NERD-G-a4da) |
| P18 Gebruikersbehoeften: wanneer doe je wat? - NeRDS: Nederlandse Richtlijn Digitale Systemen | [Van de link GitHub in de kop blijft op een smal scherm alleen een pictogram over](#NERD-G-5fea) |
| P19 12. Inkoopstrategie - NeRDS: Nederlandse Richtlijn Digitale Systemen | Geen gebrek met een plek op deze pagina. |
| P20 9. Integratie - NeRDS: Nederlandse Richtlijn Digitale Systemen | Geen gebrek met een plek op deze pagina. |
| P21 3. Werk transparant en gebruik open source - NeRDS: Nederlandse Richtlijn Digitale Systemen | Geen gebrek met een plek op deze pagina. |
| P22 Open source: wanneer doe je wat? - NeRDS: Nederlandse Richtlijn Digitale Systemen | Geen gebrek met een plek op deze pagina. |
| P23 4. Open Standaarden - NeRDS: Nederlandse Richtlijn Digitale Systemen | Geen gebrek met een plek op deze pagina. |
| P24 7. Privacy - NeRDS: Nederlandse Richtlijn Digitale Systemen | Geen gebrek met een plek op deze pagina. |
| P25 8. Samenwerking - NeRDS: Nederlandse Richtlijn Digitale Systemen | Geen gebrek met een plek op deze pagina. |
| P26 2. Zorg voor toegankelijkheid en inclusie - NeRDS: Nederlandse Richtlijn Digitale Systemen | Geen gebrek met een plek op deze pagina. |
| P27 Toegankelijkheid: wanneer doe je wat? - NeRDS: Nederlandse Richtlijn Digitale Systemen | Geen gebrek met een plek op deze pagina. |
| P28 6. Veiligheid - NeRDS: Nederlandse Richtlijn Digitale Systemen | Geen gebrek met een plek op deze pagina. |
| P29 Huidige versie - NeRDS: Nederlandse Richtlijn Digitale Systemen | Geen gebrek met een plek op deze pagina. |

## Betrouwbaarheid en beperkingen

Dit is een automatisch onderzoek. Scripts hebben de site gemeten. Een taalmodel heeft daarna elk paginatype bekeken, per criterium geoordeeld met meetinstrumenten, en in een tweede ronde elk oordeel gecontroleerd. "Voldoet" betekent dat in het onderzochte bewijs geen afwijking is gevonden, ook niet toen de controle ernaar zocht. Het is geen garantie dat er geen probleem bestaat. "Kan niet bepalen" betekent dat de vraag nog open is.

### Werkwijze

1. **Verkennen.** Een verkenner legt vast welke paginatypen de site heeft, welke meldingen een pagina bedekken, welke onderdelen open kunnen en welke processen er zijn, en hoe elk daarvan te bereiken is.
2. **Meten.** Scripts meten elke pagina van de steekproef, zoals ze laadt, ook op 320 pixels breed en in het donkere kleurenschema, en in de toestanden die de verkenner heeft vastgelegd (12 toestanden; bij de steekproef staat per pagina welke).
3. **Bewijspoort.** Voordat er wordt geoordeeld, toetsen vaste controles of het bewijs bruikbaar is. Daarna heeft het model 18 overzichtsbladen met beelden van de paginatypen bekeken. 10 van de 11 controles waren in orde en het bewijs is voldoende bevonden; 1 gat is aanvaard als eigenschap van de site.
4. **Rondgang.** Het model bekijkt elk paginatype en noteert wat nader onderzoek vraagt. Dat zijn aanwijzingen voor de beoordelaar, nog geen oordeel.
5. **Beoordelen.** Per criterium oordeelt een beoordelaar volgens een vaste procedure, met het verzamelde bewijs en met eigen metingen.
6. **Verifiëren.** Een tweede ronde maakt elke bevinding opnieuw vanaf een verse pagina en probeert elke goedkeuring onderuit te halen. Wat niet opnieuw te maken is, vervalt. Het oordeel van deze ronde is het eindoordeel.
7. **Samenvoegen.** Bevindingen over dezelfde plek worden één gebrek. De bevindingen en de uitkomst per criterium blijven zoals ze zijn.

Elk oordeel is in een tweede ronde gecontroleerd: de verificatie. Die ronde begint met een schone context en kent het oordeel van de beoordelaar: ze is een controle, geen tweede blinde beoordeling. Bij 2 criteria kwam de verificatie op een andere uitkomst dan de beoordelaar; de uitkomst van de verificatie telt. Van de 13 bevindingen in dit rapport zijn er 11 opnieuw gemaakt vanaf een verse pagina en 2 toegevoegd door de verificatie zelf; die laatste zijn dus één keer gezien. Geen bevinding van de beoordelaar is vervallen.

Wat de bewijspoort heeft vastgesteld:

- P03: Op 24 van de 29 pagina's bedekt een vast element meer dan 15% van het venster, bijvoorbeeld div "Over de Nederlandse Richtlijn Digitale S" (19%, \#content-section \>\>\> section \> div \> div \> aside \> div). Dat is een blokkade die niet in het sitemodel staat. Het vaste element is het zijmenu van de sectie met de inhoudsopgave van de pagina (aside in \#content-section). Op een breed scherm staat het in een eigen kolom links van de inhoud en blijft het bij scrollen in beeld; het ligt niet over de tekst, er is niets om te sluiten en de inhoud ernaast is voor en na scrollen volledig leesbaar. Het staat op alle pagina's met een zijmenu (alle paginatypen behalve start, niet-gevonden en huidige-versie). Op een smal scherm zit het achter een knop en is het vastgelegd als onderdeel zijmenu-smal.

Bevindingen over dezelfde plek zijn met vaste regels samengevoegd tot gebreken. De regels voegen alleen samen wat zeker is: er kunnen dus nog bevindingen over hetzelfde gebrek los van elkaar staan. De tweede stap, waarin een taalmodel voorstelt wat verder bij elkaar hoort, is niet uitgevoerd.

Beperkingen van dit onderzoek:

- Alle metingen zijn gedaan in Chromium, de motor van Chrome en Edge. Deze metingen zijn daarna herhaald in een andere browser: de Tab-volgorde in Firefox en in WebKit (de motor van Safari), en de toegankelijke naam en rol in WebKit (de motor van Safari). De andere metingen zijn alleen in Chromium gedaan.
- Er is niet getest met hulpsoftware zoals een schermlezer. Wat hulpsoftware aangeboden krijgt, is afgelezen uit de toegankelijkheidsboom van de browser.
- Versturen van formulieren: onderzocht op een testomgeving waar versturen is toegestaan: https://nerds.digitaledienst.overheid.nl, verklaard door iemand met de functie staff engineer (de naam staat in het dossier van het onderzoek, niet in dit rapport).
- De beoordeling per criterium is gedaan door een taalmodel, op basis van bewijs dat scripts hebben verzameld en van eigen waarnemingen met meetinstrumenten. Elke handeling en meting van het model is vastgelegd als waarneming en kan worden nagespeeld.
- Metingen zijn gedaan op de pagina's van de steekproef, met meldingen open en gesloten, en met de onderdelen geopend die een verkenner vooraf heeft vastgelegd. Een onderdeel dat de verkenner niet vond of niet open kreeg, is door de scripts niet gemeten. Het model heeft zelf in een steekproef van pagina's en toestanden gekeken en gemeten, niet op elke pagina in elke toestand.
- Er is niet ingelogd. Wat achter een inlog staat, is niet onderzocht.
- Documenten: op de site zijn geen documenten gevonden (pdf, kantoorbestanden of epub). Gezocht is naar links op de pagina's en in de sitemap. Een document dat alleen via een script of na het versturen van een formulier te bereiken is, is niet gevonden. 6 documenten staan op een ander domein en zijn niet onderzocht.
- Video en geluid zijn alleen beluisterd en bekeken als het bestand op te halen was en de hulpprogramma's daarvoor aanwezig waren, ook in een speler in een ingesloten venster. Media die als stream wordt afgespeeld, is niet beluisterd of bekeken. Spraak en tekst in beeld zijn herkend door software, die fouten maakt, en de flitsmeting is een benadering van de norm.
- Bij 1.3.3 is iets waargenomen dat volgens de beoordelaar bij 1.1.1 hoort, maar 1.1.1 heeft de uitkomst "Voldoet". Dit moet worden nagekeken: "In het beeld van het toegankelijkheidslabel staat een aanwijzing die de link bij naam noemt (de toegankelijkheidsverklaring) en niet alleen naar vorm of kleur verwijst. Dat de tekst in een afbeelding staat, hoort bij cri"
- Bij 1.4.5 is iets waargenomen dat volgens de beoordelaar bij 1.1.1 hoort, maar 1.1.1 heeft de uitkomst "Voldoet". Dit moet worden nagekeken: "Van de herkende tekst staat 23% in het tekstalternatief. Het verschil tussen de twee methoden gaat daarover, niet over de vraag of er tekst in het beeld staat. Dat hoort bij criterium 1.1.1."
- Bij 1.4.11 is iets waargenomen dat volgens de beoordelaar bij 2.4.7 hoort, maar 2.4.7 heeft de uitkomst "Voldoet". Dit moet worden nagekeken: "budget op: bij de beoordeling veranderde er niets zichtbaars bij focus op de tweede keuzelijst in het feedbackvenster op P01. Dat hoort bij criterium 2.4.7 en is bij de toetsing niet opnieuw bekeken. Zet de focus met het"
- Bij 2.4.3 is iets waargenomen dat volgens de beoordelaar bij 4.1.3 hoort, maar 4.1.3 heeft de uitkomst "Voldoet". Dit moet worden nagekeken: "Het nieuwe veld komt direct boven de knop; de focus blijft op de knop en één keer achteruit tabben komt op het nieuwe veld. Voor de volgorde is dat geen fout. Het antwoord toont geen melding dat er een veld bij is gekome"
- Bij 3.2.4 is iets waargenomen dat volgens de beoordelaar bij 2.4.4 hoort, maar 2.4.4 heeft de uitkomst "Voldoet". Dit moet worden nagekeken: "29 pagina's, 570 verschillende links en 88 verschillende bedieningsonderdelen. Eén link is opzij gezet: de link "hier" op P17 heeft een algemene linktekst en hoort bij criterium 2.4.4. Geen knop of veld zonder naam (0 ri"
- Bij 3.2.4 is iets waargenomen dat volgens de beoordelaar bij 2.4.6 hoort, maar 2.4.6 heeft de uitkomst "Voldoet". Dit moet worden nagekeken: "De knop heet "Over NeRDS" op P04 en P10 en "Richtlijnen" op P12. Hij opent een venster met dezelfde titel en het menu van die sectie: de naam volgt de inhoud. De link met dezelfde naam in het venster Menu gaat naar een p"
- Bij 3.3.2 is iets waargenomen dat volgens de beoordelaar bij 3.3.1 hoort, maar 3.3.1 heeft de uitkomst "Voldoet". Dit moet worden nagekeken: "Op P27 staat geen groep in de code om de 14 selectievakjes; de kop erboven is wel zichtbaar. Dat hoort bij criterium 1.3.1. De keuzelijst "Soort feedback" is bij het openen al als ongeldig gemarkeerd, en de melding "Een "
- Bij 3.3.3 is iets waargenomen dat volgens de beoordelaar bij 3.3.1 hoort, maar 3.3.1 heeft de uitkomst "Voldoet". Dit moet worden nagekeken: "Er kwam geen foutmelding. De pagina meldde "Bedankt voor uw feedback!" en het formulier werd leeggemaakt. Onder de velden blijven de aanwijzingen over de lengte en over het webadres als gewone uitleg staan. De keuzelijst"

Bij 56 criteria heeft de procedure een eigen beperking. De beperking van de procedure staat per criterium in bijlage A.

## Bijlage A: onderbouwing per criterium

Deze bijlage is naslag. Per criterium staat hier wat is onderzocht, hoe, en wat daarbij is waargenomen, met de volledige toetsing van het oordeel. De hoofdtekst vat dit samen.

<a id="bijlage-1.1.1"></a>

### 1.1.1 Niet-tekstuele content

**Uitkomst:** ● Voldoet · Niveau A · EN 301 549: 9.1.1.1 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html) · [Terug naar het resultaat](#sc-1.1.1)

**Hoe is dit vastgesteld**

1. Onderzocht: Of het dossier alle afbeeldingen en pictogrammen dekt
   - Hoe: Dossier gelezen: de lijst met afbeeldingen, de bedieningselementen en de regel-engines voor 29 pagina's op 1280 pixels breed; daarna de regel-engines zelf gedraaid in een geopend venster op P13
   - Waargenomen: 497 keer een afbeelding of pictogram aangetroffen op 29 pagina's, 55 verschillende: 49 soorten in een knop of link met eigen tekst, 4 soorten los en verborgen, 1 soort in een knop zonder tekst (3 keer, op P01 en P04) en 1 afbeelding met een eigen tekst. 0 achtergrondafbeeldingen en 0 klikbare onderdelen die geen knop of link zijn. De engines melden geen fout.
   - Bewijs: `images`, `controls`, `engine`, `v-111-0034`
2. Onderzocht: De enige afbeelding met tekst erin: het toegankelijkheidslabel op P09, in licht en donker schema
   - Hoe: Afbeelding uitgesneden, tekst laten herkennen, naam en code gemeten, en de pagina eromheen bekeken
   - Waargenomen: Het beeld toont het label met status D en 66 woorden tekst. Het tekstalternatief is "Het toegankelijkheidslabel van de NeRDS: status D, voldoet niet." Dat is de kern. De status, de datum, de link naar de verklaring en de weg om een probleem te melden staan als gewone tekst direct boven de afbeelding. Het adres en het ministerie in het beeld staan alleen in het beeld; dat is toelichting bij het label.
   - Bewijs: `v-111-0004`, `v-111-0005`, `v-111-0006`, `v-111-0007`, `v-111-0008`, `v-111-0041`
3. Onderzocht: Knoppen en links die alleen een pictogram tonen
   - Hoe: Naam gemeten, pictogram uitgesneden en code gelezen: de twee kopieerknoppen op P04 nadat er één is ingedrukt, en de link met het vertakkingspictogram op P10 op 320 pixels breed; P01 bekeken op 320 pixels breed
   - Waargenomen: De kopieerknoppen heten "Kopieer" en de link heet "GitHub"; dat staat ook zo in de code. Op P01 op 320 pixels breed hebben de menuknop, de zoekknop, de feedbackknop en het kruisje van de melding elk een naam.
   - Bewijs: `v-111-0046`, `v-111-0047`, `v-111-0048`, `v-111-0049`, `v-111-0051`, `v-111-0052`, `v-111-0056`, `v-111-0057`, `v-111-0058`, `v-111-0038`
4. Onderzocht: Losse, verborgen pictogrammen en het logo in de kop: dragen ze informatie die niet in tekst staat
   - Hoe: Bekeken en uitgesneden op P01, P14, P20 en in het venster op P13
   - Waargenomen: Het logo in de kop is verborgen en staat in een link waarvan de naam de organisatie en het ministerie noemt, als gewone tekst. Het waarschuwingsdriehoekje op P20 staat naast een melding met tekst. Het vinkje in een afvinklijst op P14 hoort bij een selectievakje met naam en toestand. De pijltjes in het kruimelpad zijn scheidingstekens. Alle zijn versiering.
   - Bewijs: `v-111-0018`, `v-111-0019`, `v-111-0020`, `v-111-0022`, `v-111-0026`, `v-111-0027`, `v-111-0028`
5. Onderzocht: Afbeeldingen in geopende onderdelen en na het versturen van een formulier
   - Hoe: Vier toestanden geopend en bekeken: het ingevulde feedbackvenster op P01, de afvinklijst op P14, het venster na het aanmaken van een cluster op P13 en de kopieerknop op P04; op elke pagina ook gezocht naar afbeeldingen, tekenvlakken en ingesloten vensters
   - Waargenomen: In het feedbackvenster staan alleen pijltjes bij de keuzelijsten. In het clustervenster staat eerst een draaiend rondje met tekst ernaast en daarna een pictogram boven de kop "Cluster succesvol aangemaakt!". Alles is versiering naast tekst. Buiten het label op P09 is er op geen van de bekeken pagina's een afbeelding met eigen inhoud gevonden. Dit is gelijk aan het dossier.
   - Bewijs: `v-111-0011`, `v-111-0012`, `v-111-0022`, `v-111-0023`, `v-111-0025`, `v-111-0032`, `v-111-0033`, `v-111-0035`, `v-111-0036`
6. Onderzocht: Het label op P09 is een afbeelding van tekst
   - Hoe: Uitsnede en tekstherkenning van de afbeelding op P09
   - Waargenomen: De afbeelding bestaat bijna helemaal uit tekst: 66 woorden, met een onderstreept woord dat op een link lijkt maar geen link is. Of die tekst als gewone tekst had gekund, hoort bij criterium 1.4.5.
   - Bewijs: `v-111-0004`, `v-111-0005`

**Hoe zeker is dit oordeel**

Beoordelaar: Voldoet. Verificatie, tevens eindoordeel: Voldoet.

Poging om het oordeel onderuit te halen: Gezocht naar een tegenvoorbeeld waar de beoordelaar niet keek: het ingevulde feedbackvenster op P01, de afvinklijst op P14, P20, het venster na het aanmaken van een cluster op P13, de kopieerknop na indrukken op P04, P01 en P10 op 320 pixels breed en P09 in donker schema. Het label op P09 en het logo opnieuw gemeten. Overal alleen versiering naast tekst of een knop met naam. Geen gebrek gevonden.

Grondslag: Beslisregel R4, procedure versie 8 (engine+oordeel).

Beperking van de procedure: Het oordeel steunt op de afbeeldingen die de veegronde op de pagina's en in de toestanden van de steekproef verzamelde, met steekproeven van de beoordelaar in Chromium; de naam van een afbeelding is daarbij ook in WebKit gelezen als die browser beschikbaar was. Mag de run niet versturen, dan zijn afbeeldingen die pas na het versturen van een formulier verschijnen niet bekeken; op een testomgeving waar versturen mag wel. Afbeeldingen achter een login zijn niet bekeken, en audio en video zijn voor dit criterium niet beluisterd of bekeken; dat gebeurt bij 1.2.1 tot en met 1.2.5.

<a id="bijlage-1.2.1"></a>

### 1.2.1 Louter-geluid en louter-videobeeld (vooraf opgenomen)

**Uitkomst:** − Niet van toepassing · Niveau A · EN 301 549: 9.1.2.1 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/audio-only-and-video-only-prerecorded.html) · [Terug naar het resultaat](#sc-1.2.1)

**Hoe is dit vastgesteld**

1. Onderzocht: Of er op de site geluid, video, ingesloten vensters of tekenvlakken staan
   - Hoe: Dossier: de tellingen voor de toepasselijkheid en per soort element, over alle 29 pagina's in de begintoestand
   - Waargenomen: Geteld over 29 van 29 pagina's: 0 keer audio, 0 keer video, 0 keer object of embed, 0 keer een ingesloten venster en 0 keer een canvas. Ook 0 keer een ondertitelspoor. De lijst met ingesloten vensters is leeg en klopt dus met het totaal van 0.
   - Bewijs: `inventoryCounts`
2. Onderzocht: Of een eigen element van de site een speler kan zijn, en of de bewaarde code media of links naar mediabestanden bevat
   - Hoe: Dossier: de lijst met eigen elementen, alle 52 namen nagelopen; de bewaarde code van alle 29 pagina's opnieuw doorzocht op spelers, mediadiensten en geluids-, video- en gif-bestanden
   - Waargenomen: Alle 52 namen zijn onderdelen voor opmaak, formulieren en navigatie. Geen naam wijst op een speler. In de bewaarde code van de 29 pagina's staat geen speler, geen mediadienst en geen link naar een geluids- of videobestand.
   - Bewijs: `inventoryCounts`
3. Onderzocht: Of er bewegende afbeeldingen of vanzelf spelende media zijn
   - Hoe: Dossier: de meting van beweging op alle 29 pagina's; zelf tg motion op P13 met de uitklapper Praktische tips open en op P01 met het feedbackvenster open
   - Waargenomen: Dossier, 29 van 29 pagina's: 0 bewegende afbeeldingen, 0 vanzelf spelende media, 0 lopende animaties, 0 pagina's met beweging. Eigen meting op P13 en P01: geen beweging, 0 van 5 beeldparen veranderd, twee methoden eens.
   - Bewijs: `motion`, `v-121-0005`, `v-121-0039`
4. Onderzocht: Andere paginatypen dan de beoordelaar bekeek: richtlijn met tips, richtlijn open source, foutpagina en huidige versie
   - Hoe: tg open, tg media en tg find op video, audio, ingesloten vensters, canvas, object, embed, afbeeldingen en links naar mediabestanden, op P17, P21, P02 en P29
   - Waargenomen: Op elk van de vier pagina's: 0 audio- of video-elementen en 0 treffers bij het zoeken. Op P21 staat de kaart met de uitgeschakelde knop Publiceren; ook daar is geen media gevonden.
   - Bewijs: `v-121-0011`, `v-121-0012`, `v-121-0014`, `v-121-0015`, `v-121-0023`, `v-121-0024`, `v-121-0026`, `v-121-0027`
5. Onderzocht: Geopende onderdelen die de beoordelaar niet bekeek: uitklapper Praktische tips, afvinklijst, zoekresultaten en feedbackvenster
   - Hoe: tg open met de bewaarde toestand op P13, P14 en P01 (twee keer), daarna tg media, tg find en op P13 en P01 tg look om te zien dat de toestand er stond
   - Waargenomen: P13: de uitklapper Praktische tips stond open; 0 media-elementen en 0 treffers. P14 met de afvinklijst: 0 en 0. P01 met zoekresultaten in het venster Zoeken: alleen links, 0 en 0. P01 met het venster Feedback geven: alleen formuliervelden en knoppen, 0 en 0.
   - Bewijs: `v-121-0003`, `v-121-0004`, `v-121-0006`, `v-121-0029`, `v-121-0030`, `v-121-0032`, `v-121-0033`, `v-121-0034`, `v-121-0036`, `v-121-0037`, `v-121-0038`
6. Onderzocht: Wat de regel-engines over geluid en video zeggen
   - Hoe: Dossier: de uitkomsten van de engines voor dit criterium, alle 29 pagina's in beide kleurenschema's
   - Waargenomen: Beide regels voor alleen geluid en alleen beeld zijn op alle 29 pagina's niet van toepassing. Dat is geen bewijs op zich, maar het spreekt de tellingen niet tegen.
   - Bewijs: `engine`

**Hoe zeker is dit oordeel**

Beoordelaar: Niet van toepassing. Verificatie, tevens eindoordeel: Niet van toepassing.

Poging om het oordeel onderuit te halen: Gezocht waar de beoordelaar niet keek: vier andere paginatypen (P17, P21, P02, P29) en vier geopende onderdelen (uitklapper op P13, afvinklijst op P14, zoekresultaten en feedbackvenster op P01). Overal 0 audio- en video-elementen en 0 treffers voor ingesloten vensters, canvas, object, embed, afbeeldingen en links naar mediabestanden. Beweging gemeten op P13 en P01: geen. De bewaarde code van alle 29 pagina's opnieuw doorzocht: geen media. Geen tegenvoorbeeld gevonden.

Grondslag: Beslisregel R3, procedure versie 6 (inventaris).

Beperking van de procedure: De spraak van een geluidsfragment is uitgeschreven door spraakherkenning en naast de tekst rond de speler gezet. Herkenning maakt fouten: een verschil onder de marge is niet als bevinding geteld. Of een tekstversie dezelfde informatie geeft als het fragment of als een video zonder geluid, is een oordeel van de beoordelaar op die meting en op stilstaande beelden. Van een bestand is hooguit de eerste 10 minuten of 200 MB gemeten. Media die niet als bestand op te halen is (streaming, een blob-adres, ook in een speler in een ingesloten venster) is niet beluisterd of bekeken, en media achter een login of op pagina's buiten de steekproef is niet gezocht.

<a id="bijlage-1.2.2"></a>

### 1.2.2 Ondertitels voor doven en slechthorenden (vooraf opgenomen)

**Uitkomst:** − Niet van toepassing · Niveau A · EN 301 549: 9.1.2.2 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/captions-prerecorded.html) · [Terug naar het resultaat](#sc-1.2.2)

**Hoe is dit vastgesteld**

1. Onderzocht: Of er op de site video, geluid, een ingesloten venster, een ingesloten object of een tekenvlak voorkomt.
   - Hoe: Dossier: de tellingen over alle 29 pagina's in de begintoestand. Daarnaast is in de bewaarde code van alle 29 pagina's gezocht naar deze elementen en naar adressen van videodiensten en mediabestanden.
   - Waargenomen: Geteld op 29 van 29 pagina's: 0 keer audio, 0 keer video, 0 keer object of embed, 0 keer iframe, 0 keer canvas en 0 keer een track-element aangetroffen. In de bewaarde code van 29 pagina's staat geen van deze elementen en geen adres van een videodienst of mediabestand.
   - Bewijs: `inventoryCounts`
2. Onderzocht: Of een ingesloten venster of een eigen onderdeel een mediaspeler kan zijn, en of er media vanzelf afspeelt.
   - Hoe: Dossier: de lijst met ingesloten vensters naast het totaal, de namen van eigen onderdelen, en het onderzoek naar media die vanzelf speelt.
   - Waargenomen: De lijst met vensters heeft 0 rijen en het totaal is 0: de lijst klopt. Het sitemodel noemt 0 vensters. 52 namen van eigen onderdelen nagelopen, allemaal van het designsysteem; geen naam wijst op een speler. Media die vanzelf afspeelt: 0 op 29 pagina's; 0 audio- of video-elementen gevonden.
   - Bewijs: `inventoryCounts`, `motion`
3. Onderzocht: Of er media staat op paginatypen die de beoordelaar niet zelf bekeek.
   - Hoe: tg open, tg find op video, audio, iframe, canvas, object, embed en track, tg media en tg look --full op P14 (cloud per fase); tg open, tg find en tg media op P04 (bijdragen) en op P09 (toegankelijkheidsverklaring) op 320 pixels breed.
   - Waargenomen: Op alle drie de pagina's vond het zoeken 0 elementen en meldde de mediameting 0 audio- of video-elementen. Op P14 staan in beeld alleen links, koppen en afvinklijsten. Op P09 staat 1 afbeelding en geen speler.
   - Bewijs: `v-122-0003`, `v-122-0004`, `v-122-0005`, `v-122-0024`, `v-122-0025`, `v-122-0026`, `v-122-0027`, `v-122-0028`, `v-122-0030`, `v-122-0031`, `v-122-0032`, `v-122-0033`
4. Onderzocht: Of er media verschijnt in geopende onderdelen die de beoordelaar niet zelf bekeek.
   - Hoe: tg open met --state component-cluster-dialoog en --state b-337-cluster-resultaat op P13 en --state process-zoeken op P01; daarna tg find, tg media en op P13 tg look. De afbeelding van het open venster is bekeken.
   - Waargenomen: In alle drie de toestanden vond het zoeken 0 elementen en meldde de mediameting 0 audio- of video-elementen. Het venster op P13 toont een kop, een knop om te sluiten en drie knoppen om in te loggen; na het doorlopen alleen een pictogram. Geen speler of afspeelknop.
   - Bewijs: `v-122-0007`, `v-122-0008`, `v-122-0009`, `v-122-0010`, `v-122-0011`, `v-122-0013`, `v-122-0014`, `v-122-0015`, `v-122-0016`, `v-122-0017`, `v-122-0019`, `v-122-0020`, `v-122-0021`, `v-122-0022`
5. Onderzocht: Wat de regel-engines zeggen.
   - Hoe: Dossier: de uitkomsten van de regel-engines voor ondertiteling.
   - Waargenomen: Beide engines noemen hun regel voor ondertiteling niet van toepassing op alle 29 pagina's (2 van 2 regels). Er zijn geen kandidaten voor dit criterium, ook niet van beoordelaars van andere criteria.
   - Bewijs: `engine`

**Hoe zeker is dit oordeel**

Beoordelaar: Niet van toepassing. Verificatie, tevens eindoordeel: Niet van toepassing.

Poging om het oordeel onderuit te halen: Gezocht naar video, geluid en ingesloten vensters waar de beoordelaar niet keek: P14, P04 en P09 op 320 pixels, het venster voor een cluster op P13 in twee stappen, en de zoekresultaten op P01. Ook de bewaarde code van 29 pagina's doorzocht op adressen van videodiensten en mediabestanden. Overal 0 elementen; het dossier klopt op elke nagemeten plek. Geen tegenvoorbeeld gevonden.

Grondslag: Beslisregel R3, procedure versie 6 (inventaris).

Beperking van de procedure: De spraak van een video is uitgeschreven door spraakherkenning en naast de ondertitels gezet. Herkenning maakt fouten, vooral in namen en vaktermen: een verschil onder de marge is niet als bevinding geteld. Of de ondertiteling ook zegt wie er spreekt en welke geluiden ertoe doen, is een oordeel van de beoordelaar op die meting. Van een bestand is hooguit de eerste 10 minuten of 200 MB gemeten. Media die niet als bestand op te halen is (streaming, een blob-adres, ook in een speler in een ingesloten venster) is niet beluisterd of bekeken, en media achter een login of op pagina's buiten de steekproef is niet gezocht.

<a id="bijlage-1.2.3"></a>

### 1.2.3 Audiodescriptie of media-alternatief (vooraf opgenomen)

**Uitkomst:** − Niet van toepassing · Niveau A · EN 301 549: 9.1.2.3 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/audio-description-or-media-alternative-prerecorded.html) · [Terug naar het resultaat](#sc-1.2.3)

**Hoe is dit vastgesteld**

1. Onderzocht: Of er op de site video, geluid, ingesloten vensters of andere onderdelen met media staan
   - Hoe: Dossier: de tellingen over alle 29 pagina's (inventoryForApplicability.counts en inventoryCounts.totals), in de begintoestand op 1280 pixels
   - Waargenomen: Geteld over 29 van 29 pagina's: audio 0 keer, video 0 keer, object of embed 0 keer, ingesloten venster (iframe) 0 keer, canvas 0 keer, track 0 keer. De lijst met ingesloten vensters is leeg en klopt dus met het totaal van 0.
   - Bewijs: `inventoryCounts`
2. Onderzocht: Of een eigen element van de site een speler kan zijn, en of er media vanzelf afspeelt
   - Hoe: Dossier: inventoryCounts.customElements, motion.totals en motion.media; daarnaast de 29 bewaarde pagina's doorzocht op media-elementen, videodiensten en mediabestanden
   - Waargenomen: 52 namen van eigen elementen nagelopen, alle met het voorvoegsel nldd-; geen naam wijst op een speler. Media die vanzelf afspeelt: 0 op 29 pagina's. Media-elementen gevonden: 0. In de bewaarde pagina's staat geen media-element en geen verwijzing naar een videodienst of mediabestand; het woord video komt op 3 pagina's alleen in lopende tekst voor.
   - Bewijs: `inventoryCounts`, `motion`
3. Onderzocht: Wat de regel-engines over dit criterium zeggen
   - Hoe: Dossier: engine.results
   - Waargenomen: Eén regel voor dit criterium (alfa, sia-r38) kwam op alle 29 pagina's uit op niet van toepassing, in het lichte en het donkere schema. Geen engine wijst een video aan.
   - Bewijs: `engine`
4. Onderzocht: Klopt het dossier op paginatypen die de beoordelaar niet zelf bekeek
   - Hoe: Zelf gemeten met media en find (video, audio, iframe, object, embed, canvas, track, source) op P04 (contact en bijdragen), P14 (fases van cloud) en de richtlijn over toegankelijkheid, elk op een verse pagina
   - Waargenomen: Op alle drie pagina's: 0 audio- of video-elementen en 0 elementen van de gezochte soorten. De richtlijn over toegankelijkheid noemt video alleen in de tekst; er staat geen speler.
   - Bewijs: `v-123-0002`, `v-123-0003`, `v-123-0005`, `v-123-0006`, `v-123-0020`, `v-123-0021`
5. Onderzocht: Of er media verschijnt in een geopend onderdeel dat de beoordelaar niet zelf bekeek
   - Hoe: Zelf gemeten met media, find en look in vijf toestanden: uitklapper Praktische tips op P13, feedbackvenster op P01, hoofdmenu op P01 op 320 pixels, en op P13 het clusterformulier na inloggen en het resultaat na versturen
   - Waargenomen: In alle vijf toestanden: 0 audio- of video-elementen en 0 elementen van de gezochte soorten. Het feedbackvenster toont alleen formuliervelden en knoppen; het clustervenster toont een formulier en daarna een lijst met gegevens van het cluster.
   - Bewijs: `v-123-0009`, `v-123-0010`, `v-123-0012`, `v-123-0013`, `v-123-0014`, `v-123-0016`, `v-123-0017`, `v-123-0018`, `v-123-0023`, `v-123-0024`, `v-123-0026`, `v-123-0027`, `v-123-0028`

**Hoe zeker is dit oordeel**

Beoordelaar: Niet van toepassing. Verificatie, tevens eindoordeel: Niet van toepassing.

Poging om het oordeel onderuit te halen: Gezocht naar media waar de beoordelaar niet keek: drie andere paginatypen (P04, P14, richtlijn toegankelijkheid) en vijf geopende toestanden (Praktische tips, feedbackvenster, hoofdmenu op 320 pixels, clusterformulier na inloggen, resultaat na versturen). Overal 0 audio, video, iframe, object, embed, canvas, track en source. De 29 bewaarde pagina's bevatten geen media-element of adres van een videodienst. Geen tegenvoorbeeld gevonden; niet van toepassing blijft staan.

Grondslag: Beslisregel R3, procedure versie 6 (inventaris).

Beperking van de procedure: Van een video zijn hooguit acht stilstaande beelden bekeken, met de tekst die tekstherkenning erin las, naast wat er op dat moment wordt gezegd. Wat tussen die beelden gebeurt en een handeling die niet uit een stilstaand beeld blijkt, is niet gezien. Of een audiodescriptie of tekstversie goed genoeg beschrijft wat er te zien is, is een oordeel van de beoordelaar. Spraakherkenning en tekstherkenning maken fouten. Van een bestand is hooguit de eerste 10 minuten of 200 MB gemeten. Media die niet als bestand op te halen is (streaming, een blob-adres, ook in een speler in een ingesloten venster) is niet beluisterd of bekeken, en media achter een login of op pagina's buiten de steekproef is niet gezocht.

<a id="bijlage-1.2.4"></a>

### 1.2.4 Ondertitels voor doven en slechthorenden (live)

**Uitkomst:** − Niet van toepassing · Niveau AA · EN 301 549: 9.1.2.4 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/captions-live.html) · [Terug naar het resultaat](#sc-1.2.4)

**Hoe is dit vastgesteld**

1. Onderzocht: Of er op de site video, geluid, een ingesloten venster of een tekenvlak staat
   - Hoe: Dossier: de tellingen over alle 29 pagina's in de begintoestand, en de lijst met ingesloten vensters.
   - Waargenomen: Geteld over 29 pagina's: 0 keer een audio-element, 0 keer een video-element, 0 keer een object of embed, 0 keer een ingesloten venster (iframe), 0 keer een canvas en 0 keer een track. De lijst met ingesloten vensters is leeg en klopt dus met het totaal van 0.
   - Bewijs: `inventoryCounts`
2. Onderzocht: Of een eigen element een mediaspeler kan zijn, en of er media vanzelf afspeelt
   - Hoe: Dossier: de lijst met eigen elementen, de telling van bewegende inhoud en de lijst met audio- en video-elementen.
   - Waargenomen: 52 namen van eigen elementen nagelopen, alle van het designsysteem (knoppen, kaarten, menu's, velden, vensters). Geen naam wijst op een speler, video, stream of media. Media die vanzelf afspeelt: 0 keer op 29 pagina's. Gevonden audio- en video-elementen: 0. De regel-engines hebben voor dit criterium geen regels.
   - Bewijs: `inventoryCounts`, `motion`, `engine`
3. Onderzocht: Nameting op pagina's die de beoordelaar niet bekeek
   - Hoe: Zelf gemeten met het media-instrument en een zoekopdracht naar video, audio, iframe, canvas, object, embed, track en source, op P04, P09, P11, P21, P26 en P29, en op een adres dat niet bestaat (het paginatype van P02).
   - Waargenomen: Op alle 7 plekken 0 elementen gevonden en 0 audio- of video-elementen gemeten. Dat is gelijk aan het dossier. Samen met de beoordelaar is nu gemeten op 9 van de 29 pagina's, van 9 verschillende paginatypen.
   - Bewijs: `v-124-0003`, `v-124-0004`, `v-124-0006`, `v-124-0007`, `v-124-0009`, `v-124-0010`, `v-124-0011`, `v-124-0029`, `v-124-0030`, `v-124-0033`, `v-124-0034`, `v-124-0037`, `v-124-0038`, `v-124-0041`, `v-124-0042`
4. Onderzocht: Of er media verschijnt als een onderdeel is geopend
   - Hoe: Zelf gemeten in vier geopende toestanden: het ingevulde feedbackvenster en het zoekvenster met resultaten op P01, de uitklapper met praktische tips op P21 en de afvinklijst op P14. Met het media-instrument en dezelfde zoekopdracht.
   - Waargenomen: In alle vier de toestanden 0 elementen gevonden en 0 audio- of video-elementen gemeten. Het feedbackvenster, het zoekvenster en de uitklapper stonden aantoonbaar open tijdens de meting. De beoordelaar mat al het venster van het cluster op P13.
   - Bewijs: `v-124-0045`, `v-124-0046`, `v-124-0047`, `v-124-0049`, `v-124-0050`, `v-124-0051`, `v-124-0054`, `v-124-0055`, `v-124-0057`, `v-124-0058`, `v-124-0059`
5. Onderzocht: Of de site een eigen live-uitzending aankondigt
   - Hoe: In de bewaarde code van alle 29 pagina's in één keer gezocht op livestream, uitzending, webinar, persconferentie, vergadering, video, stream, youtube, vimeo, podcast, opname, audio, geluid, sessie en het losse woord live.
   - Waargenomen: Op 29 pagina's geen aankondiging van een livestream, uitzending of webinar. Het woord video staat op 4 pagina's, niet op 1 zoals de beoordelaar schreef: in tekst over auteursrecht (P06), in tips over toegankelijkheid (P26, P27) en in een link naar een andere website (P17). Het woord live staat alleen in code voor statusmeldingen. Dat is geen media op deze site.
   - Bewijs: `pages/richtlijnen-gebruikersbehoeften-41c157ca/page.html`, `pages/over-nerds-copyright-29526d70/page.html`, `pages/richtlijnen-toegankelijkheid-f4e5dfa1/page.html`, `pages/richtlijnen-toegankelijkheid-fases-c9b0688b/page.html`, `v-124-0031`

**Hoe zeker is dit oordeel**

Beoordelaar: Niet van toepassing. Verificatie, tevens eindoordeel: Niet van toepassing.

Poging om het oordeel onderuit te halen: Gezocht naar media waar de beoordelaar niet keek: zes andere pagina's (P04, P09, P11, P21, P26, P29), een adres dat niet bestaat, en vier geopende toestanden (feedbackvenster, zoekvenster met resultaten, praktische tips, afvinklijst). Overal 0 audio, video, ingesloten vensters, canvas, object of embed. De bewaarde code van 29 pagina's opnieuw doorzocht met meer zoektermen: geen aankondiging van een live-uitzending. Het oordeel blijft staan.

Grondslag: Beslisregel R1, procedure versie 6 (inventaris).

Beperking van de procedure: Een live-uitzending wordt niet beluisterd of bekeken: het media-instrument meet alleen een bestand dat op te halen is. Of een live-uitzending met geluid live wordt ondertiteld, is daardoor niet vastgesteld. Een uitzending die alleen op bepaalde momenten op de site staat, is alleen gezien als ze er tijdens het onderzoek stond, en van een speler in een ingesloten venster is gezien wat zijn beeld en zijn knoppen tijdens het onderzoek toonden, niet de uitzending zelf.

<a id="bijlage-1.2.5"></a>

### 1.2.5 Audiodescriptie (vooraf opgenomen)

**Uitkomst:** − Niet van toepassing · Niveau AA · EN 301 549: 9.1.2.5 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/audio-description-prerecorded.html) · [Terug naar het resultaat](#sc-1.2.5)

**Hoe is dit vastgesteld**

1. Onderzocht: Of er ergens op de site video, geluid of een ander onderdeel staat dat video kan zijn
   - Hoe: De tellingen in het dossier over alle 29 pagina's, begintoestand op 1280 pixels breed
   - Waargenomen: Geteld op 29 van 29 pagina's: 0 keer audio, 0 keer video, 0 keer object of embed, 0 keer iframe, 0 keer canvas en 0 keer track. De lijst met ingesloten vensters is leeg en dat klopt met het totaal van 0 keer iframe. Er is dus geen venster dat een speler kan zijn.
   - Bewijs: `inventoryCounts`
2. Onderzocht: Of een eigen onderdeel van de site een videospeler kan zijn, en of er iets vanzelf afspeelt
   - Hoe: De lijst met eigen elementen en de meting van beweging en media in het dossier, alle 29 pagina's
   - Waargenomen: De lijst telt 52 namen van eigen elementen, allemaal bouwstenen van het ontwerpsysteem. Geen naam wijst op een speler. Media die vanzelf afspeelt: 0 keer op 29 pagina's. Audio- en video-elementen bij de meting van media: 0.
   - Bewijs: `inventoryCounts`, `motion`
3. Onderzocht: Eigen controle op drie pagina's die de eerste beoordelaar niet opende
   - Hoe: P14, P21 en P09 vers geopend; gezocht naar video, audio, iframe, object, embed, canvas, track en source, de media gemeten en de pagina bekeken
   - Waargenomen: Op P14, P21 en P09 elk 0 elementen gevonden en 0 media gemeten. De hele pagina P14 toont tekst, kaarten, selectievakjes en links; P09 toont tekst en één afbeelding van het toegankelijkheidslabel. Geen speler en geen afspeelknop.
   - Bewijs: `v-125-0002`, `v-125-0003`, `v-125-0012`, `v-125-0014`, `v-125-0015`, `v-125-0028`, `v-125-0029`, `v-125-0030`, `v-125-0031`
4. Onderzocht: Of de knoppen op de kaarten met hulpmiddelen een video of venster openen
   - Hoe: Op P14 de knoppen Verkennen en Starten en op P21 de knop Publiceren aangeklikt, de code van de knop gelezen en daarna opnieuw gezocht
   - Waargenomen: De drie knoppen zijn uitgeschakeld: klikken lukt niet en de code van de knop Verkennen heeft \`disabled\`. Na de poging zijn er 0 elementen voor video, geluid of een ingesloten venster. Deze knoppen laden dus geen media.
   - Bewijs: `v-125-0006`, `v-125-0007`, `v-125-0008`, `v-125-0010`, `v-125-0011`, `v-125-0017`, `v-125-0018`
5. Onderzocht: Of er video verschijnt als een onderdeel wordt geopend
   - Hoe: Twee bewaarde toestanden geopend die de eerste beoordelaar niet bekeek: de uitgeklapte praktische tips op P21 en het zoekvenster met resultaten op P01; in elk gezocht, gemeten en gekeken
   - Waargenomen: In beide toestanden 0 elementen gevonden en 0 media gemeten. De uitgeklapte tips tonen tekst en links; het zoekvenster toont een zoekveld en een lijst met links. Geen speler. De eerste beoordelaar zag hetzelfde op P13 in het venster voor een cluster.
   - Bewijs: `v-125-0020`, `v-125-0021`, `v-125-0022`, `v-125-0024`, `v-125-0025`, `v-125-0026`, `b-125-0018`, `b-125-0022`
6. Onderzocht: Wat de regelcontroles voor dit criterium zeggen
   - Hoe: Twee regels voor audiodescriptie in het dossier, op alle 29 pagina's in het lichte en donkere schema
   - Waargenomen: Beide regels geven op alle 29 pagina's aan dat er niets is om te toetsen. Geen regel wijst een video aan. Dit is op zichzelf geen bewijs, maar het past bij de tellingen.
   - Bewijs: `engine`

**Hoe zeker is dit oordeel**

Beoordelaar: Niet van toepassing. Verificatie, tevens eindoordeel: Niet van toepassing.

Poging om het oordeel onderuit te halen: Gezocht waar de beoordelaar niet keek: P14, P21 en P09, de uitgeklapte tips op P21 en het zoekvenster met resultaten op P01. Overal 0 elementen voor video, geluid of ingesloten venster en 0 media. De knoppen Verkennen, Starten en Publiceren aangeklikt: uitgeschakeld, er laadt niets. De bewaarde code van alle 29 pagina's bevat geen media-element en geen verwijzing naar een videodienst. Geen tegenvoorbeeld gevonden.

Grondslag: Beslisregel R3, procedure versie 6 (inventaris).

Beperking van de procedure: Van een video zijn hooguit acht stilstaande beelden bekeken, met de tekst die tekstherkenning erin las, naast wat er op dat moment wordt gezegd. Wat tussen die beelden gebeurt en een handeling die niet uit een stilstaand beeld blijkt, is niet gezien. Of een audiodescriptie goed genoeg beschrijft wat er te zien is, is een oordeel van de beoordelaar. Spraakherkenning en tekstherkenning maken fouten. Van een bestand is hooguit de eerste 10 minuten of 200 MB gemeten. Media die niet als bestand op te halen is (streaming, een blob-adres, ook in een speler in een ingesloten venster) is niet beluisterd of bekeken, en media achter een login of op pagina's buiten de steekproef is niet gezocht.

<a id="bijlage-1.3.1"></a>

### 1.3.1 Info en relaties

**Uitkomst:** ✕ Voldoet niet · [Terug naar het resultaat](#sc-1.3.1)

**Hoe is dit vastgesteld**

1. Onderzocht: Reeksen gelijke kaarten
   - Hoe: Code van het raster en rol van een kaart op negen pagina's (P01, P11, P12, P13, P17, P18, P20, P21 en P26)
   - Waargenomen: De kaarten staan los in het raster; er staat geen lijst omheen en een kaart heeft geen rol van lijstitem. Geteld: 13 kaarten op P01, 13 op P11, 6 op P12, 7 op P13, 10 op P17, 15 op P18, 3 op P20, 8 op P21 en 13 op P26. Elke kaart heeft een eigen kop.
   - Bewijs: `v-131-0007`, `v-131-0008`, `v-131-0014`, `v-131-0126`, `v-131-0128`, `v-131-0137`, `v-131-0139`, `v-131-0031`, `v-131-0102`, `v-131-0088`, `v-131-0148`, `v-131-0159`, `v-131-0170`
2. Onderzocht: Aanduiding van het huidige onderdeel in het smalle menu
   - Hoe: P09 op 360 pixels breed met het hoofdmenu geopend: beeld, code en rol van de link
   - Waargenomen: Het huidige onderdeel heeft een donkerder vlak. De link heeft in de code geen aanduiding dat dit het huidige onderdeel is; het lijstitem heeft alleen \`selected\`, en dat komt niet in de rol of toestand van de link terug.
   - Bewijs: `v-131-0033`, `v-131-0038`, `v-131-0039`, `v-131-0040`, `v-131-0041`, `v-131-0042`
3. Onderzocht: Koppen en regels die op een kop lijken
   - Hoe: Beeld met lijst van koppen op P01, P13, P04 en P11; opmaak en code van de losse regels op P13, P21 en P26, van de melding op P01, P12 en P20 en van de regel boven de inhoudsopgave op zeven pagina's
   - Waargenomen: Elke tekst die eruitziet als kop is een kop. De losse regels boven de uitklappers zijn gewone tekst van 18 pixels en gewicht 400. De vette regel in de melding is de naam van de melding. De vette regel in het zijmenu staat boven een navigatiegebied met dezelfde naam.
   - Bewijs: `v-131-0014`, `v-131-0016`, `v-131-0024`, `v-131-0025`, `v-131-0055`, `v-131-0203`, `v-131-0178`, `v-131-0182`, `v-131-0010`, `v-131-0011`, `v-131-0187`, `v-131-0193`, `v-131-0029`, `v-131-0105`, `v-131-0110`, `v-131-0115`, `v-131-0120`, `v-131-0051`, `v-131-0089`
4. Onderzocht: Lijsten, afvinklijsten en paginagebieden
   - Hoe: Code en rol op P04, P14, P17, P18 en P29, en het geopende zoekvenster
   - Waargenomen: De genummerde stappen op P04 zijn twee lijsten die ook in beeld elk bij 1 beginnen. De afvinklijsten zijn lijsten met een naam; de naam van een vakje is de tekst ernaast. Het zijmenu heeft een lijst om de lijstitems. De voet staat twee keer in elkaar als voetgebied. De zoekresultaten zijn een lijst.
   - Bewijs: `v-131-0052`, `v-131-0053`, `v-131-0055`, `v-131-0073`, `v-131-0074`, `v-131-0075`, `v-131-0085`, `v-131-0086`, `v-131-0087`, `v-131-0096`, `v-131-0099`, `v-131-0100`, `v-131-0101`, `v-131-0199`, `v-131-0201`, `v-131-0064`, `v-131-0066`
5. Onderzocht: Formulieren: velden, een extra veld en wat na versturen verschijnt
   - Hoe: Feedbackvenster op P01 en clustervenster op P13: namen gemeten, een extra link toegevoegd, beide formulieren leeg verstuurd, het feedbackformulier ingevuld verstuurd en het resultaat van het clusterformulier bekeken
   - Waargenomen: Elk veld heeft een naam gelijk aan het zichtbare label, ook het toegevoegde veld. Na leeg versturen komt een melding in beeld en als statusmelding, en de velden zijn als ongeldig gemarkeerd. Na geldig versturen volgt een bedankmelding. Het resultaat van het cluster is een kop met een lijst van gegevens.
   - Bewijs: `v-131-0206`, `v-131-0209`, `v-131-0210`, `v-131-0211`, `v-131-0212`, `v-131-0214`, `v-131-0215`, `v-131-0216`, `v-131-0217`, `v-131-0218`, `v-131-0219`, `v-131-0221`, `v-131-0224`, `v-131-0228`, `v-131-0229`, `v-131-0230`, `v-131-0231`, `v-131-0235`, `v-131-0241`, `v-131-0242`, `v-131-0243`

**Hoe zeker is dit oordeel**

Beoordelaar: Voldoet niet. Verificatie, tevens eindoordeel: Voldoet niet.

Grondslag: Beslisregel R3, procedure versie 9 (engine+oordeel).

Beperking van de procedure: Het oordeel steunt op wat de veegronde op de pagina's en in de toestanden van de steekproef verzamelde, met steekproeven van de beoordelaar in één browser (Chromium). Er is geen echte schermlezer gebruikt. Mag de run niet versturen, dan is de structuur van meldingen en stappen na het versturen niet onderzocht; op een testomgeving waar versturen mag wel. Pagina's achter een login zijn niet onderzocht.

<a id="bijlage-1.3.2"></a>

### 1.3.2 Betekenisvolle volgorde

**Uitkomst:** ● Voldoet · [Terug naar het resultaat](#sc-1.3.2)

**Hoe is dit vastgesteld**

1. Onderzocht: Volgorde van de blokken op het scherm tegenover de volgorde die hulpsoftware leest
   - Hoe: Dossier: schermafbeelding en boom van 12 pagina's op 1280 pixels, koppenlijst van 29 pagina's (559 koppen) en Tab-volgorde van 29 pagina's (1269 stops). Zelf P03, P18 en P20 volledig bekeken naast de volgordemeting.
   - Waargenomen: Op P03, P18 en P20 dezelfde volgorde op het scherm en in de code: kop, menu, zijmenu, inhoud, vorige en volgende, kruimelpad, voet. Het zijmenu staat links en komt in de code vóór de inhoud; dat verandert de betekenis niet. Het dossier telt op P04 en P10 elk 1 sprong terug in de Tab-volgorde: van het zijmenu naar de inhoud.
   - Bewijs: `screenshots`, `headings`, `keyboard`, `v-132-0004`, `v-132-0005`, `v-132-0007`, `v-132-0008`, `v-132-0015`, `v-132-0017`
2. Onderzocht: Verplaatst de opmaak inhoud ten opzichte van de code, op het brede scherm
   - Hoe: Zelf gemeten met de volgordemeting op 1280 pixels op 4 pagina's van 4 paginatypen: P03, P18, P20 en P26. Drie daarvan (P18, P20, P26) had de eerste beoordelaar niet gemeten.
   - Waargenomen: Op elke pagina 1 blok dat de opmaak verplaatst: de drie juridische links onderaan de voet. Sprongen: 3 op P03, 9 op P18, 4 op P20 en 9 op P26, alle tussen kolommen (zijmenu naar inhoud, twee kolommen met kaarten, drie kolommen in de voet). Absoluut geplaatst is alleen verborgen hulptekst. De betekenis blijft gelijk.
   - Bewijs: `v-132-0004`, `v-132-0007`, `v-132-0015`, `v-132-0031`
3. Onderzocht: Tekst die in de code vóór een kop staat, en de opbouw van de kaarten
   - Hoe: Dossier: de lijst met tekst vóór een kop (3 rijen). Zelf op P18 de kaarten gezocht (13 kaarten met een label) en de code van één kaart gelezen.
   - Waargenomen: 3 rijen, geen daarvan een kaart in een reeks: op P01 een versienummer boven de hoofdkop (een aandachtspunt), op P07 en P09 het zijmenu (navigatie, hoort niet bij de kop). In de kaart op P18 staat de titel eerst in de code, daarna het label beschikbaar, de tekst en de knop.
   - Bewijs: `headings`, `v-132-0010`, `v-132-0011`, `v-132-0012`, `v-132-0013`
4. Onderzocht: De volgorde op een smal scherm van 320 pixels
   - Hoe: Zelf gemeten met de volgordemeting en bekeken op 320 pixels op P18, een paginatype dat de eerste beoordelaar smal niet mat.
   - Waargenomen: 0 sprongen: alles staat onder elkaar in de volgorde van de code, met de kaarten onder hun kop. Dezelfde ene verplaatsing in de voet als op het brede scherm, zonder gevolg voor de betekenis.
   - Bewijs: `v-132-0028`, `v-132-0029`
5. Onderzocht: De volgorde in geopende vensters en na een handeling
   - Hoe: Zelf gemeten met de volgordemeting en bekeken in de 3 bewaarde toestanden die de eerste beoordelaar oversloeg: het ingevulde feedbackformulier (P01), de knop Kopieer (P04) en de verborgen melding (P01).
   - Waargenomen: Het feedbackvenster staat in de code achteraan; daarbinnen is de volgorde gelijk aan het scherm: kop, sluitknop, twee keuzelijsten, tekstveld, linkveld, knoppen, elk label direct bij zijn veld. Na Kopieer en na het verbergen van de melding 3 sprongen per pagina, alle tussen kolommen. Samen met de eerste beoordeling zijn nu 12 van de 12 toestanden gemeten.
   - Bewijs: `v-132-0019`, `v-132-0020`, `v-132-0022`, `v-132-0023`, `v-132-0025`, `v-132-0026`
6. Onderzocht: Tabellen en een genummerde lijst die opnieuw begint
   - Hoe: Zelf gezocht naar tabellen op P18, P20, P26 en P10, en de stappen onder de kop Uitgebreide ontwikkelomgeving op P04 bekeken.
   - Waargenomen: 0 tabellen op de vier pagina's. Op P04 begint de genummerde lijst na het eerste codeblok opnieuw bij 1. Scherm en code tonen dat hetzelfde, dus het is geen verschil in volgorde; het gaat om de opbouw van de lijst.
   - Bewijs: `v-132-0009`, `v-132-0016`, `v-132-0032`, `v-132-0034`, `v-132-0023`

**Hoe zeker is dit oordeel**

Beoordelaar: Voldoet. Verificatie, tevens eindoordeel: Voldoet.

Poging om het oordeel onderuit te halen: Gezocht waar de beoordelaar niet mat: de volgorde op drie nieuwe paginatypen (P18, P20, P26), P18 op 320 pixels, en de drie overgeslagen toestanden (ingevuld feedbackformulier, Kopieer, verborgen melding). De code van een kaart op P18 gelezen: titel vóór label. Tabellen gezocht op vier pagina's: geen. De weggezette kandidaat op P03 nagemeten. Geen verplaatsing verandert de betekenis; het oordeel blijft staan.

Grondslag: Beslisregel R4, procedure versie 8 (oordeel).

Beperking van de procedure: Het oordeel steunt op wat de veegronde op de pagina's en in de toestanden van de steekproef verzamelde, met steekproeven van de beoordelaar in één browser (Chromium). Er is geen echte schermlezer gebruikt; het oordeel steunt op de volgorde in de code en in de toegankelijkheidsboom. Mag de run niet versturen, dan is de volgorde van content na het versturen niet onderzocht; op een testomgeving waar versturen mag wel. Pagina's achter een login zijn niet onderzocht.

Open, voor een volgende meting:

- Dekking ontbrak: De meting van de volgorde in de code tegenover het scherm staat voor geen van de 29 pagina's in het dossier. Bij de beoordeling en de controle samen is zij gedaan op 13 pagina's van 13 paginatypen, zonder afwijking; 16 pagina's zijn zo niet gemeten.
- Dekking ontbrak: Dezelfde meting op 320 pixels breed staat niet in het dossier. Bij de beoordeling en de controle samen is zij gedaan op de startpagina, de richtlijn cloud, de pagina Contact en bijdragen en de fasepagina van gebruikersbehoeften, zonder afwijking; de andere 14 paginatypen zijn smal niet gemeten.
- Dekking ontbrak: Dezelfde meting in geopende vensters, menu's en uitklappers staat niet in het dossier. Bij de beoordeling en de controle samen is zij gedaan in alle 12 bewaarde toestanden, elk op één pagina, zonder afwijking.

Open: 3 punten, zie [Nog uitzoeken](#open-1.3.2).

<a id="bijlage-1.3.3"></a>

### 1.3.3 Zintuiglijke eigenschappen

**Uitkomst:** ● Voldoet · Niveau A · EN 301 549: 9.1.3.3 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/sensory-characteristics.html) · [Terug naar het resultaat](#sc-1.3.3)

**Hoe is dit vastgesteld**

1. Onderzocht: Of de tekst van alle pagina's, alle links en alle geopende onderdelen is gelezen
   - Hoe: Dossier: van elke pagina het bestand met de volledige zichtbare tekst opnieuw gelezen, de linkteksten doorzocht en van 12 bewaarde toestanden de boom gelezen.
   - Waargenomen: 29 van 29 pagina's hebben een tekstbestand en alle 29 zijn gelezen. 1666 links gelezen, 570 verschillende. In de 12 toestanden staat geen aanwijzing die alleen naar vorm, kleur, plek of geluid verwijst. Het sitemodel noemt geen cookiemelding en geen ingesloten vensters; op P09 verscheen ook geen melding toen de pagina met meldingen werd geopend.
   - Bewijs: `language`, `links`, `screenshots`, `site-states/component-feedback/aria.yaml`, `site-states/process-cluster-aanmaken/aria.yaml`, `site-states/process-zoeken/aria.yaml`, `v-133-0077`
2. Onderzocht: Steekproef: staat op de pagina dezelfde tekst als in het dossier
   - Hoe: Zelf bekeken met look: P01 op 1280 en 320 pixels breed, P17 met een uitklapper open, P14 met de afvinklijst (hele pagina), P04 met de kopieerknop, P09 (hele pagina), het feedbackvenster op P01 en het clustervenster op P13.
   - Waargenomen: Op 6 pagina's van 6 paginatypen en in 5 geopende toestanden staan dezelfde koppen, knoppen en teksten als in het dossier. Op 320 pixels breed staat de knop Feedback met zijn naam in beeld.
   - Bewijs: `v-133-0004`, `v-133-0010`, `v-133-0033`, `v-133-0042`, `v-133-0053`, `v-133-0077`, `v-133-0063`, `v-133-0071`
3. Onderzocht: Aanwijzingen die een plek of leesrichting noemen: is het onderdeel ook bij naam te vinden?
   - Hoe: De zinnen opgezocht met find en html op P01, P17, P26 en P04; de naam van de knop en de link gemeten met name; de volgorde in de code op P17 gemeten met order.
   - Waargenomen: P01: "Gebruik de knop Feedback bovenaan de pagina."; de knop heet Feedback. P17: "Zie de hierboven het Toestemmingsformulier" en het handboek bij 'direct aan de slag'; de kaart en de kop staan er in de code voor. P26: "Zie hierboven" met de link Inclusief ontwerpen. Op 13 pagina's: "De onderstaande functionaliteit is nog in ontwikkeling." P04: "een hoger middelste cijfer" gaat over de volgorde in een versienummer, niet over het scherm.
   - Bewijs: `v-133-0005`, `v-133-0006`, `v-133-0013`, `v-133-0020`, `v-133-0021`, `v-133-0022`, `v-133-0023`, `v-133-0039`, `v-133-0048`, `v-133-0059`, `v-133-0060`, `language`
4. Onderzocht: Meldingen van formulieren bij lege invoer en na het versturen
   - Hoe: Zelf gemeten: het feedbackformulier op P01 en het clusterformulier op P13 leeg verstuurd en daarna gekeken. De meldingen na geldig versturen en bij zoeken zonder resultaat komen uit de waarnemingen van de eerste beoordelaar.
   - Waargenomen: De meldingen noemen elk veld bij zijn label. Feedback: "Soort feedback: kies een soort. Uw feedback: minimaal 10 tekens." Cluster: "Organisatie: kies een waarde. Naam van het cluster: vul een naam in. Regio(s): kies een waarde." Geen melding verwijst naar kleur of plek.
   - Bewijs: `v-133-0065`, `v-133-0066`, `v-133-0072`, `b-133-0036`, `b-133-0037`, `b-133-0046`, `b-133-0093`, `b-133-0094`
5. Onderzocht: Aanwijzingen in afbeeldingen
   - Hoe: De enige afbeelding in de hoofdinhoud, op P09, gelezen met ocr en bekeken met crop.
   - Waargenomen: In het beeld van het toegankelijkheidslabel staat een aanwijzing die de link bij naam noemt (de toegankelijkheidsverklaring) en niet alleen naar vorm of kleur verwijst. Dat de tekst in een afbeelding staat, hoort bij criterium 1.4.5. Dat het tekstalternatief maar een deel van die tekst bevat, hoort bij criterium 1.1.1.
   - Bewijs: `v-133-0078`, `v-133-0080`, `v-133-0081`

**Hoe zeker is dit oordeel**

Beoordelaar: Voldoet. Verificatie, tevens eindoordeel: Voldoet.

Poging om het oordeel onderuit te halen: Alle 29 tekstbestanden opnieuw gelezen en gezocht naar aanwijzingen met plek, vorm, kleur of geluid. Bekeken waar de beoordelaar niet keek: P14 met de afvinklijst, P04 met de kopieerknop, P26 en de tweede uitklapper op P17. Beide formulieren zelf leeg verstuurd. Beide weggezette kandidaten opnieuw gemeten, ook op 320 pixels. Geen aanwijzing gevonden die alleen op een zintuiglijk kenmerk leunt.

Grondslag: Beslisregel R4, procedure versie 7 (oordeel).

Beperking van de procedure: Gelezen is de zichtbare tekst die de veegronde op de pagina's en in de toestanden van de steekproef verzamelde, met steekproeven van de beoordelaar. Mag de run niet versturen, dan zijn instructies in meldingen en stappen na het versturen niet gelezen; op een testomgeving waar versturen mag wel. Gesproken tekst in audio en video is voor dit criterium niet beluisterd, en pagina's achter een login zijn niet onderzocht.

<a id="bijlage-1.3.4"></a>

### 1.3.4 Weergavestand

**Uitkomst:** ● Voldoet · Niveau AA · EN 301 549: 9.1.3.4 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/orientation.html) · [Terug naar het resultaat](#sc-1.3.4)

**Hoe is dit vastgesteld**

1. Onderzocht: Toont elke pagina staand en liggend dezelfde inhoud, zonder melding om te draaien, leeg scherm of gedraaide inhoud
   - Hoe: Dossier: staande meting in een venster van 800 bij 1280 pixels op 29 pagina's, met 12 paren schermafbeeldingen (staand probes/portrait.png, liggend screenshot-light.png) op P01, P04, P10, P11, P12, P13, P14, P17, P18, P20, P21 en P26. De beoordelaar legde alle paren naast elkaar; bij de toetsing zijn de staande opnamen van P04, P11 en P21 opnieuw bekeken.
   - Waargenomen: De paren tonen in beide standen de pagina zelf, met dezelfde koppen, teksten en knoppen. Nergens een melding om te draaien, een leeg of afgedekt scherm of inhoud op zijn kant. Staand staan hoofdmenu en zijmenu achter een knop.
   - Bewijs: `orientation`, `screenshots`
2. Onderzocht: Bedieningselementen die staand niet in beeld zijn, horizontaal schuiven en afgekapte tekst
   - Hoe: Dossier: lijsten van de staande meting op 29 pagina's en de instelling van de weergavebreedte.
   - Waargenomen: 129 rijen met links die liggend zichtbaar zijn en staand niet: links van hoofdmenu, zijmenu en inhoudsopgave. 0 pagina's met horizontaal schuiven, 0 elementen breder dan het venster, 4 rijen met afgekapte tekst (verborgen hulptekst, op alle 29 pagina's). Alle 29 pagina's volgen de breedte van het apparaat. Wat op een smal scherm verdwijnt, hoort bij criterium 1.4.10; hier is niets gevonden.
   - Bewijs: `orientation`, `viewport`
3. Onderzocht: Eigen steekproef: staand en liggend venster op paginatypen die de beoordelaar niet zelf opende
   - Hoe: P10 (versies) en P18 (fases) geopend in een staand venster van 320 bij 800 pixels en in het liggende venster, telkens gekeken en de regel-engines voor dit criterium gedraaid. P02 (niet gevonden) en P29 (huidige versie) alleen staand bekeken.
   - Waargenomen: Op P10 en P18 toont het venster in beide standen de pagina zelf, met dezelfde koppen en links. Op P02 en P29 staat staand de hele pagina. Geen melding om te draaien, geen leeg scherm, niets op zijn kant. De vier regel-engines melden in drie metingen niets. Gelijk aan het dossier.
   - Bewijs: `v-134-0002`, `v-134-0005`, `v-134-0011`, `v-134-0013`, `v-134-0015`, `v-134-0017`, `v-134-0022`, `v-134-0025`, `v-134-0029`
4. Onderzocht: Staand in geopende onderdelen: zijmenu, afvinklijst en venster voor een cluster
   - Hoe: Staand venster van 320 bij 800 pixels: op P10 de knop van het zijmenu aangeklikt en gekeken; op P18 een vakje van de afvinklijst aangevinkt en gekeken; op P14 de bewaarde toestand met het venster voor een cluster geopend en gekeken.
   - Waargenomen: Het zijmenu opent staand als venster met de 8 links van de sectie en de inhoudsopgave; de links die staand uit beeld zijn, blijven zo bereikbaar. Het vakje wordt aangevinkt. Het venster voor een cluster toont de drie knoppen om in te loggen. Nergens een verzoek om te draaien of gedraaide inhoud. De beoordelaar zag hetzelfde in 12 toestanden.
   - Bewijs: `v-134-0008`, `v-134-0009`, `v-134-0019`, `v-134-0020`, `v-134-0026`, `v-134-0027`
5. Onderzocht: Draaiing met opmaak en een webmanifest
   - Hoe: De draaiing van de hoofdinhoud uitgelezen in het staande venster op P10 en P18. Op P10 en P29 gezocht naar een verwijzing naar een webmanifest; daarnaast de bewaarde code van alle 29 pagina's doorzocht.
   - Waargenomen: Geen draaiing: transform en rotate staan op none. Geen van de 29 pagina's verwijst naar een webmanifest. De site is dus niet als app te installeren en kan de stand langs die weg niet vastzetten.
   - Bewijs: `v-134-0006`, `v-134-0018`, `v-134-0004`, `v-134-0030`

**Hoe zeker is dit oordeel**

Beoordelaar: Voldoet. Verificatie, tevens eindoordeel: Voldoet.

Poging om het oordeel onderuit te halen: Gezocht naar een tegenvoorbeeld op paginatypen die de beoordelaar niet zelf opende: P10 en P18 staand en liggend, P02 en P29 staand. Staand het zijmenu op P10 geopend, een vakje op P18 aangevinkt en het clustervenster op P14 geopend. Draaiing van de hoofdinhoud gemeten, regel-engines gedraaid en naar een webmanifest gezocht. Nergens een melding om te draaien, een leeg scherm of gedraaide inhoud. Het oordeel blijft staan.

Grondslag: Beslisregel R3, procedure versie 6 (probe).

Beperking van de procedure: De staande weergave is nagebootst met een staand venster in een desktopbrowser (Chromium), niet op een apparaat dat draait. Een vergrendeling van de stand in een webmanifest of via een script (alleen werkzaam in een geïnstalleerde app of in volledig scherm) is niet vastgesteld. Het oordeel steunt op de staande meting van de veegronde op de pagina's van de steekproef, met steekproeven van de beoordelaar.

<a id="bijlage-1.3.5"></a>

### 1.3.5 Identificeer het doel van de input

**Uitkomst:** − Niet van toepassing · Niveau AA · EN 301 549: 9.1.3.5 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/identify-input-purpose.html) · [Terug naar het resultaat](#sc-1.3.5)

**Hoe is dit vastgesteld**

1. Onderzocht: Welke velden het dossier telt en waar ze om vragen
   - Hoe: Dossier gelezen voor alle 29 pagina's in de begintoestand. Zelf op P18 het zoekveld en een selectievakje in de code gelezen.
   - Waargenomen: 62 keer een formulier aangetroffen op 29 pagina's. Het dossier telt 79 rijen: 2 knoppen (overgeslagen), 73 zichtbare selectievakjes op P14, P18, P22 en P27, en 4 verborgen velden op alle 29 pagina's: zoekveld, keuzelijst voor de richtlijn, tekstvak voor feedback en veld voor een link. Indeling: 77 van 77 geen gegeven van de gebruiker. Het zoekveld en het vakje hebben geen autocomplete, gelijk aan het dossier.
   - Bewijs: `forms`, `controls`, `v-135-0053`, `v-135-0054`
2. Onderzocht: De velden in het feedbackvenster, voor en na het versturen
   - Hoe: Het venster zelf geopend op P14 en de code van het hele formulier gelezen. Op P03 het formulier ingevuld en verstuurd via e-mail, daarna opnieuw de velden gezocht.
   - Waargenomen: Het venster heeft 4 velden: twee keuzelijsten (richtlijn en soort feedback), een tekstvak voor de feedback en een veld voor een link naar een relevant document. De tweede keuzelijst staat niet in het dossier. Na versturen verscheen alleen een bedankje; er kwam geen veld bij. Naam of e-mailadres wordt niet gevraagd. 5 van 5 velden: geen gegeven van de gebruiker.
   - Bewijs: `v-135-0015`, `v-135-0018`, `v-135-0019`, `v-135-0020`, `v-135-0062`, `v-135-0063`, `v-135-0064`
3. Onderzocht: De velden in het venster voor een Kubernetes cluster, in elke stap
   - Hoe: Het venster geopend op P13 en op P14, met twee andere inlogknoppen dan de beoordelaar. De code van het formulier gelezen, het op P14 ingevuld en verstuurd.
   - Waargenomen: De eerste stap heeft 3 knoppen en geen veld; inloggen vraagt geen gebruikersnaam of wachtwoord. De tweede stap heeft 8 velden die niet in het dossier staan: 7 keuzelijsten en een tekstveld voor de naam van het cluster. Na versturen staat er een overzicht zonder velden. 8 van 8: geen gegeven van de gebruiker.
   - Bewijs: `v-135-0003`, `v-135-0004`, `v-135-0007`, `v-135-0010`, `v-135-0028`, `v-135-0032`, `v-135-0045`, `v-135-0049`, `v-135-0050`
4. Onderzocht: Of de keuzelijst Organisatie om een eigen gegeven van de bezoeker vraagt
   - Hoe: De code van de keuzelijst gelezen op P13 en P14, de naam gemeten en de tekst eronder bekeken.
   - Waargenomen: De lijst biedt 3 vaste organisaties aan, elk met een nummer. Eronder staat: "Deze organisaties zijn gebaseerd op uw login gegevens". De bezoeker typt niets in en kiest voor welke organisatie het cluster is. Dat is een keuze uit wat de site aanbiedt, geen invulveld voor de naam van de eigen organisatie. De methoden zijn het eens over de naam; alleen de rol verschilt (combobox of listbox), en dat doet hier niet ter zake.
   - Bewijs: `v-135-0007`, `v-135-0010`, `v-135-0033`, `v-135-0034`
5. Onderzocht: Ingesloten vensters en de regelcontroles
   - Hoe: Dossier gelezen. Zelf naar ingesloten vensters gezocht op P14 en P18, en de regelcontroles voor dit criterium gedraaid op P14 met het feedbackvenster open.
   - Waargenomen: 0 keer een ingesloten venster aangetroffen op 29 pagina's; ook zelf geen gevonden op P14 en P18. De 2 regels van de engines zijn op alle 29 pagina's niet van toepassing. Met het feedbackvenster open gaven 4 engines 0 meldingen. Er is geen cookiemelding en geen wachtwoordveld (0 op 29 pagina's).
   - Bewijs: `inventoryCounts`, `engine`, `v-135-0012`, `v-135-0056`, `v-135-0022`

**Hoe zeker is dit oordeel**

Beoordelaar: Niet van toepassing. Verificatie, tevens eindoordeel: Niet van toepassing.

Poging om het oordeel onderuit te halen: Gezocht naar een veld voor een eigen gegeven waar de beoordelaar niet keek: het clustervenster op P13 en P14 via twee andere inlogknoppen, het formulier op P14 verstuurd, het feedbackvenster op P14 en verstuurd op P03, het zoekveld en een vinkje op P18, ingesloten vensters op P14 en P18. De keuzelijst Organisatie apart getoetst: een keuze uit drie aangeboden organisaties, geen invulveld. Geen tegenvoorbeeld gevonden.

Grondslag: Beslisregel R4, procedure versie 7 (engine+oordeel).

Beperking van de procedure: Er wordt niet ingelogd, dus velden achter een login zijn niet onderzocht. Mag de run niet versturen, dan zijn velden in een stap die pas na het versturen komt en velden die een chat pas na een bericht toont niet onderzocht; op een testomgeving waar versturen mag wel. Een formulier in een ingesloten venster dat bij het onderzoek niet laadde of niet te bedienen was, is niet beoordeeld, en het oordeel steunt op de velden die de veegronde op de pagina's en in de toestanden van de steekproef verzamelde.

<a id="bijlage-1.4.1"></a>

### 1.4.1 Gebruik van kleur

**Uitkomst:** ✕ Voldoet niet · [Terug naar het resultaat](#sc-1.4.1)

**Hoe is dit vastgesteld**

1. Onderzocht: Waaraan de huidige pagina in het zijmenu te herkennen is
   - Hoe: Verse pagina's P13, P04 en P18, breed en licht: contrast en style van de huidige regel, op P13 ook style van de regel erboven en look zonder kleur.
   - Waargenomen: Op 3 van 3 gemeten pagina's heeft de huidige regel een grijs vlak dat 1,2 op 1 afsteekt tegen de omgeving. Lettergewicht (400), onderstreping (geen) en rand (0) zijn op P13 gelijk aan de regel erboven. Zonder kleur blijft alleen een iets donkerder vlak over.
   - Bewijs: `v-141-0007`, `v-141-0008`, `v-141-0012`, `v-141-0013`, `v-141-0016`, `v-141-0017`, `v-141-0041`
2. Onderzocht: Waaraan de huidige pagina in het smalle hoofdmenu te herkennen is
   - Hoe: Geopend hoofdmenu op 360 pixels op P12 en P01: look, contrast en style van de huidige link en van een gewone link; op P01 met de muis op de kop en look zonder kleur.
   - Waargenomen: De huidige link heeft op beide pagina's alleen een grijs vlak van 1,3 op 1. Gewicht, onderstreping en rand zijn gelijk aan de link eronder. Zonder kleur is op P01 alleen het vlak te zien.
   - Bewijs: `v-141-0020`, `v-141-0021`, `v-141-0022`, `v-141-0023`, `v-141-0049`, `v-141-0050`, `v-141-0051`
3. Onderzocht: Of het tweede grijze vlak in het smalle menu een toestand aangeeft
   - Hoe: Geopend hoofdmenu op 360 pixels op P29 en P12: contrast van de eerste link, de muis naar de kop van het venster, opnieuw contrast.
   - Waargenomen: Het vlak op de eerste link (1,1 op 1) hoort bij aanwijzen met de muis: de meting noemt die toestand en na wegschuiven is de achtergrond wit. Op P29 is geen element als huidige pagina gemarkeerd.
   - Bewijs: `v-141-0024`, `v-141-0026`, `v-141-0032`, `v-141-0033`, `v-141-0034`
4. Onderzocht: Of links in de tekst een kenmerk naast kleur hebben
   - Hoe: Style en crop van de link om de pagina te bewerken op P18; look zonder kleur op P13.
   - Waargenomen: De link op P18 heeft een onderstreping en een potlood. Op P13 zijn de twee links in de eerste alinea ook zonder kleur aan hun onderstreping te herkennen. Het dossier telt 1666 links op 29 pagina's, 570 verschillende; bij de verificatie zijn er 3 bekeken.
   - Bewijs: `links`, `v-141-0012`, `v-141-0039`, `v-141-0040`
5. Onderzocht: Of de huidige link in het smalle hoofdmenu in de code een toestand heeft
   - Hoe: Zoeken naar aria-current in het geopende hoofdmenu op 360 pixels op P01.
   - Waargenomen: Alleen de verborgen link van de brede menubalk draagt de toestand voor de huidige pagina; de zichtbare link in het geopende menu niet.
   - Bewijs: `v-141-0052`, `v-141-0053`
6. Onderzocht: Of het dossier per link de onderstreping en het gedrag bij muis en focus bevat
   - Hoe: Dossier (links, screenshots) naast wat de procedure vraagt.
   - Waargenomen: Het dossier bevat per link geen meting van de onderstreping en geen beeld zonder kleur. Bij de verificatie zijn 3 links bekeken, op P13 en P18; die zijn onderstreept.
   - Bewijs: `links`, `screenshots`

**Hoe zeker is dit oordeel**

Beoordelaar: Voldoet niet. Verificatie, tevens eindoordeel: Voldoet niet.

Grondslag: Beslisregel R3, procedure versie 6 (oordeel).

Beperking van de procedure: Mag de run niet versturen, dan zijn foutmeldingen die de server pas na het versturen geeft niet bekeken. De veegronde dekt de pagina's en toestanden van de steekproef in één browser (Chromium); de beoordelaar heeft die dekking met een steekproef bevestigd en niet alles zelf nagemeten. Wat achter een inlog staat, is niet bekeken.

Open, voor een volgende meting:

- Dekking ontbrak: Per link in lopende tekst is niet gemeten of er een onderstreping is en wat er bij muis en focus bijkomt, en er is geen beeld zonder kleur per paginatype. Bij de verificatie zijn 3 links nagekeken, op de pagina over cloud en de pagina met fases van gebruikersbehoeften; die zijn onderstreept.

Open: 1 punt, zie [Nog uitzoeken](#open-1.4.1).

<a id="bijlage-1.4.2"></a>

### 1.4.2 Geluidsbediening

**Uitkomst:** − Niet van toepassing · Niveau A · EN 301 549: 9.1.4.2 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/audio-control.html) · [Terug naar het resultaat](#sc-1.4.2)

**Hoe is dit vastgesteld**

1. Onderzocht: Of er op de site geluid of video staat, en of iets daarvan vanzelf start
   - Hoe: Dossier: de tellingen voor de toepasselijkheid en de inventaris over alle 29 pagina's, en de tweede telling 1,5 seconde na het laden van elke pagina.
   - Waargenomen: Op 29 van 29 pagina's: 0 keer een audio-element, 0 keer een video-element en 0 keer media die vanzelf starten. De tweede telling na het laden geeft ook 0 keer media die vanzelf starten en 0 pagina's met beweging. De twee tellingen zijn gelijk; een script voegde geen media toe.
   - Bewijs: `inventoryCounts`, `motion`
2. Onderzocht: Of er ingesloten vensters zijn die een speler kunnen zijn
   - Hoe: Dossier: de lijst van ingesloten vensters in de inventaris en in het sitemodel. Zelf gezocht naar iframe, embed en object, ook verborgen, op zes pagina's en in vier geopende toestanden.
   - Waargenomen: 0 keer een ingesloten venster aangetroffen op 29 pagina's; de lijst is leeg. Ook 0 keer een object- of embed-element. Bij het eigen zoeken op P01, P02, P04, P13, P14, P17 en P21: 0 elementen gevonden. Er is geen speler van een andere partij.
   - Bewijs: `inventoryCounts`, `v-142-0002`, `v-142-0005`, `v-142-0008`, `v-142-0011`, `v-142-0014`, `v-142-0017`, `v-142-0020`, `v-142-0024`
3. Onderzocht: Steekproef op paginatypen die de eerste beoordelaar niet bekeek
   - Hoe: Zelf de media gemeten op P04 (bijdragen), P21 (open source), P14 (cloud per fase), P02 (foutpagina) en P17 (richtlijn met tips, donker schema).
   - Waargenomen: Op 5 van 5 pagina's: 0 audio- of video-elementen gemeten. Dat is gelijk aan het dossier.
   - Bewijs: `v-142-0003`, `v-142-0006`, `v-142-0009`, `v-142-0012`, `v-142-0025`
4. Onderzocht: Of er media staan in onderdelen die pas na een handeling open gaan
   - Hoe: Zelf geopend en gemeten: het venster voor het aanmaken van een cluster op P13, het zoekvenster met resultaten op P01 en het hoofdmenu op P01 bij 320 pixels breed. Het open menu is ook bekeken.
   - Waargenomen: In 3 van 3 geopende toestanden: 0 audio- of video-elementen en 0 ingesloten vensters. Het menu stond zichtbaar open bij het meten.
   - Bewijs: `v-142-0015`, `v-142-0018`, `v-142-0021`, `v-142-0022`
5. Onderzocht: Wat de regel-engines over dit criterium zeggen
   - Hoe: Dossier: de uitkomsten van de engines op alle 29 pagina's, in licht en donker. Zelf herhaald op P17 in het donkere schema.
   - Waargenomen: De regel van axe-core voor media die vanzelf starten is op alle 29 pagina's niet van toepassing, met 0 knooppunten. De regel van alfa is op alle 29 pagina's niet van toepassing. Bij de eigen meting op P17 gaven vier engines elk 0 afgekeurd, 0 onbeslist en 0 goedgekeurd.
   - Bewijs: `engine`, `v-142-0026`

**Hoe zeker is dit oordeel**

Beoordelaar: Niet van toepassing. Verificatie, tevens eindoordeel: Niet van toepassing.

Poging om het oordeel onderuit te halen: Gezocht naar audio, video, iframe, embed en object, ook verborgen, en de media gemeten op vijf paginatypen die de beoordelaar oversloeg (P04, P21, P14, P02, P17 in donker) en in drie toestanden die hij niet opende: het clustervenster op P13, zoekresultaten op P01 en het menu bij 320 pixels. Overal 0 elementen. De engines op P17 gaven niets. Geen tegenvoorbeeld gevonden; het oordeel blijft staan.

Grondslag: Beslisregel R3, procedure versie 8 (inventaris).

Beperking van de procedure: Of media die vanzelf starten geluid hebben en hoe lang dat duurt, is gemeten aan het bestand en afgelezen uit de code (duur, herhaling, gedempt, geluidsspoor); waar het bestand is beluisterd, is ook gemeten hoeveel seconden ervan geluid is en hoe luid. In de speler zelf is niets gehoord: de testbrowser houdt geluid dat vanzelf start tegen. Geluid dat een script start zonder speler in de pagina, media die niet als bestand op te halen is, en geluid in een speler in een ingesloten venster die na een echte poging niet te bedienen was, is niet vastgesteld.

<a id="bijlage-1.4.3"></a>

### 1.4.3 Contrast (minimum)

**Uitkomst:** ✕ Voldoet niet · [Terug naar het resultaat](#sc-1.4.3)

**Hoe is dit vastgesteld**

1. Onderzocht: Tekst in de afbeelding van het toegankelijkheidslabel op P09
   - Hoe: contrast, ocr, html en crop op de afbeelding; de kleuren van de letters in de schaal zijn afgelezen op de pixels van de uitsnede.
   - Waargenomen: De tekstherkenning mat de zwarte tekst rechts: 12,8 tot 21. De witte letters A tot en met E in de schaal links vond zij niet. Op de uitsnede staan ze op gekleurde vlakken: C op lichtoranje 1,6, D op oranje 2,8, B op groen 3,8, E op rood 3,9, A op donkergroen 7,6. Onder de letters ligt alleen rechtsonder een donkere schaduw. De schaal geeft uitleg en is geen logo.
   - Bewijs: `v-143-0003`, `v-143-0004`, `v-143-0005`, `v-143-0006`
2. Onderzocht: Contrast van alle tekst in de begintoestand van elke pagina
   - Hoe: Dossier: contrast (totals, pagesMeasured, lowestPassing) en engine, naast de metingen van de beoordelaar.
   - Waargenomen: 13.422 stukken tekst gemeten op 29 van 29 pagina's, licht en donker, breed en op 320 pixels: 12.837 voldoen, 0 falen, 537 zonder uitkomst, 48 in uitgeschakelde knoppen. Laagste waarde: wit op groen \#38860b met 4,5 bij een eis van 4,5. De vier groepen zonder uitkomst heeft de beoordelaar nagemeten: 5,7 of hoger.
   - Bewijs: `contrast`, `engine`, `b-143-0051`, `b-143-0052`, `b-143-0048`, `b-143-0087`
3. Onderzocht: Het clusterformulier op P13, voor en na het versturen
   - Hoe: P13 geopend met het ingevulde formulier en met de bewaarde toestand na versturen; look, contrast en crop op de verzendknop, het venster, de lijst, het codeblok en de knoppen.
   - Waargenomen: Het dossier noemt voor de verzendknop 1,2. Zelf gemeten is de knop wit op donkerblauw \#184576: 9,7, vier methoden eens. Na versturen: kop 11,3, labels in de lijst 5,7, waarden 10,5, codeblok 5,7 tot 10,5, tweede knop 12,3. Eén regel kreeg eerst 3,4 omdat ze half buiten beeld stond; in beeld gemeten 5,7.
   - Bewijs: `v-143-0013`, `v-143-0014`, `v-143-0017`, `v-143-0019`, `v-143-0021`, `v-143-0024`, `v-143-0025`, `v-143-0026`
4. Onderzocht: Tekst in het smalle zijmenu, het smalle hoofdmenu, de uitklapper met tips en de afvinklijst, in het donkere schema
   - Hoe: P16, P01, P17 en P18 geopend in donker met het onderdeel open; look, contrast, style en crop.
   - Waargenomen: Zijmenu: links 11,3 en 13,2, actief item 9,8, knop om te sluiten 5,3. De sublinks kregen van de pixelmeting geen uitkomst; de regel-engine geeft 11,39 en op de uitsnede is de tekst \#d9dee5 op \#20252c. Hoofdmenu: 5,3 tot 11,3. Uitklapper: links 5,7, tekst 12,3. Afvinklijst: 11,3. Eén regel-engine keurt het hoofdmenu af zonder getal; de pixels en een tweede engine geven 11,3.
   - Bewijs: `v-143-0029`, `v-143-0031`, `v-143-0035`, `v-143-0038`, `v-143-0039`, `v-143-0040`, `v-143-0043`, `v-143-0044`, `v-143-0046`, `v-143-0051`, `v-143-0060`
5. Onderzocht: Tekstkleur bij aanwijzen en bij focus, en de melding na kopiëren op P04
   - Hoe: Dossier: contrast.hoverAndFocus. Zelf in donker: focus en contrast op een link van het smalle hoofdmenu en op de knop Feedback, hover en contrast op de knop van de uitklapper; contrast op de melding na kopiëren.
   - Waargenomen: Het dossier mat 102 van de 344 verschillende links en knoppen, alleen in licht: 0 falen; 242 zijn niet gemeten. Zelf in donker: menulink met focus 11,3, knop Feedback met focus 7,2, knop van de uitklapper bij aanwijzen 12,3. De melding na kopiëren op P04 gaf geen meting: het instrument vond er geen tekst meer.
   - Bewijs: `contrast`, `v-143-0045`, `v-143-0046`, `v-143-0053`, `v-143-0062`, `v-143-0063`, `v-143-0066`, `v-143-0067`
6. Onderzocht: Rand en vlak van de tweede knop in het venster na versturen op P13
   - Hoe: contrast op de knop onderaan het venster na het versturen van het clusterformulier, licht schema.
   - Waargenomen: De rand van de knop heeft 1,5 tegen de witte achtergrond van het venster en het vlak 1,2. De tekst zelf haalt 12,3. Dit gaat niet over tekst en hoort bij criterium 1.4.11. De beoordelaar mat dezelfde waarden op de keuzelijst Organisatie in hetzelfde venster.
   - Bewijs: `v-143-0025`, `b-143-0026`, `b-143-0039`

**Hoe zeker is dit oordeel**

Beoordelaar: Kan niet bepalen. Verificatie, tevens eindoordeel: Voldoet niet.

Poging om het oordeel onderuit te halen: Elk open punt nagelopen. Het label op P09: de witte letters van de schaal op de uitsnede afgelezen, C haalt 1,6; dat is een bevinding. Het clusterformulier na versturen gemeten: voldoet. Smal zijmenu, smal hoofdmenu, uitklapper en afvinklijst in donker gemeten: voldoen. Focus en aanwijzen in donker op drie plekken gemeten: voldoen. De melding na kopiëren gaf geen meting. De dekking van aanwijzen en focus blijft open.

Grondslag: Beslisregel R1, procedure versie 10 (probe+oordeel).

Beperking van de procedure: De veegronde meet het contrast op de pagina's en toestanden van de steekproef in één browser (Chromium); de beoordelaar heeft die dekking met een steekproef bevestigd en niet alles zelf nagemeten. Van tekst op een foto of verloop geeft de meting een beste en een slechtste geval, en van tekst in een afbeelding is het contrast gemeten op de pixels van de regels die tekstherkenning vond, met een lettergrootte die uit het beeld is geschat; tekst die de herkenning niet vond of niet zeker las, is alleen op een uitsnede beoordeeld. Het contrast van tekst bij aanwijzen en bij focus mat de veegronde alleen in het lichte schema, en op hooguit 150 links en knoppen. Mag de run niet versturen, dan zijn foutmeldingen die de server pas na het versturen geeft niet gemeten; tekst achter een inlog is nooit gemeten.

Open, voor een volgende meting:

- Dekking ontbrak: Bij aanwijzen met de muis en bij focus is de tekstkleur van 102 van de 344 verschillende links en knoppen gemeten, alleen in het lichte schema; van 242 niet. Bij de beoordeling zijn er enkele nagemeten, ook in donker, en die voldoen. Meet de overige links en knoppen terwijl ze worden aangewezen en terwijl ze focus hebben, in licht en in donker.
- Een proef werkte niet: De melding die op P04 kort verschijnt na een klik op de knop Kopieer bij een codeblok is niet gemeten; bij de meting stond de tekst er niet meer. Meet de tekst van die melding terwijl ze zichtbaar is, in licht en in donker.
- Budget was op: Het venster na het versturen van het clusterformulier op P13 is alleen in het lichte schema gemeten, niet in donker. In het zoekvenster en het feedbackvenster is de tekst zonder uitkomst alleen door de eerste beoordelaar nagemeten.

Open: 3 punten, zie [Nog uitzoeken](#open-1.4.3).

<a id="bijlage-1.4.4"></a>

### 1.4.4 Herschalen van tekst

**Uitkomst:** ✕ Voldoet niet · [Terug naar het resultaat](#sc-1.4.4)

**Hoe is dit vastgesteld**

1. Onderzocht: De link "GitHub" in de kop op 200% vergroting
   - Hoe: P01 vers geopend op 640 pixels breed (gelijk aan 200%): de link gezocht, uitsnede, opmaak en code bekeken, aangewezen en opnieuw bekeken. Op P13 de meting op 200% gedaan.
   - Waargenomen: De link is 44 bij 44 pixels en toont alleen een pictogram van een vertakking. Het woord "GitHub" staat in de code, maar is 1 bij 1 pixel met verborgen overloop. Aanwijzen verandert niets. Op P13 meldt de meting op 200% dezelfde afgekapte tekst.
   - Bewijs: `v-144-0002`, `v-144-0003`, `v-144-0004`, `v-144-0005`, `v-144-0006`, `v-144-0009`, `v-144-0010`, `v-144-0018`
2. Onderzocht: Dezelfde link op 100%, en of het woord elders op de pagina staat
   - Hoe: P13 vers geopend op gewone breedte: uitsnede en opmaak van de link. Op P01 en P13 alle links naar GitHub gezocht en de code bekeken.
   - Waargenomen: Op 100% is de link 93 pixels breed en staat het woord "GitHub" van 53 pixels breed naast het pictogram. Het komt dus door het vergroten. Op P13 is de enige andere link "Bewerk deze pagina op GitHub"; die gaat naar een ander adres en vervangt de link in de kop niet.
   - Bewijs: `v-144-0013`, `v-144-0014`, `v-144-0015`, `v-144-0016`, `v-144-0017`
3. Onderzocht: Of de site het vergroten blokkeert
   - Hoe: Dossier: de instelling voor het beeldvenster op alle 29 pagina's.
   - Waargenomen: Alle 29 pagina's hebben \`width=device-width, initial-scale=1\`. Die instelling beperkt het vergroten niet.
   - Bewijs: `viewport`
4. Onderzocht: De andere tekst die volgens de meting op 200% is afgekapt
   - Hoe: Dossier (4 rijen afgekapte tekst op alle 29 pagina's) en eigen meting op 200% op P13 en op P09.
   - Waargenomen: Naast het woord in de kop gaat het om drie keer "Opent in nieuw tabblad" in de voet. Dat is hulptekst voor schermlezers bij externe links, die volgens de beoordelaar op elke grootte verborgen is. De eigen metingen gaven dezelfde 4 rijen, geen horizontaal schuiven en geen uitstekende onderdelen.
   - Bewijs: `zoom`, `v-144-0018`, `v-144-0021`, `b-144-0002`
5. Onderzocht: De afbeelding van het toegankelijkheidslabel op P09 bij 200%
   - Hoe: P09 geopend op 640 pixels breed, de afbeelding gezocht, code en uitsnede bekeken.
   - Waargenomen: De afbeelding is 608 bij 285 pixels, staat volledig in beeld en de tekst erin is leesbaar. Het is tekst in een afbeelding; die is bij dit criterium uitgezonderd. Dat de status alleen als afbeelding van tekst staat, hoort bij criterium 1.4.5.
   - Bewijs: `v-144-0019`, `v-144-0020`, `v-144-0022`, `v-144-0023`
6. Onderzocht: Of er op 200% inhoud verdwijnt die op gewone breedte wel staat
   - Hoe: Dossier: de vergelijking gaat alleen over bedieningselementen. Eigen volledige schermafbeelding op 200% van P13 bekeken.
   - Waargenomen: Het dossier vergelijkt koppen, tekstblokken en afbeeldingen niet tussen gewone breedte en 200%. Op de eigen afbeelding van P13 is geen overlap of uitstekende tekst te zien. Een vergelijking per pagina is bij deze toetsing niet gemaakt.
   - Bewijs: `zoom`, `v-144-0018`

**Hoe zeker is dit oordeel**

Beoordelaar: Voldoet niet. Verificatie, tevens eindoordeel: Voldoet niet.

Grondslag: Beslisregel R2, procedure versie 6 (probe).

Beperking van de procedure: De vergroting is nagebootst als 200% zoom van de hele pagina, in één browser (Chromium). Alleen de tekst vergroten zonder de rest van de pagina is niet getest. De veegronde dekt de pagina's en toestanden van de steekproef; de beoordelaar heeft die dekking met een steekproef bevestigd en niet alles zelf nagemeten.

Open, voor een volgende meting:

- Dekking ontbrak: Een vergelijking van de inhoud (koppen, tekstblokken, afbeeldingen) tussen gewone breedte en 200% vergroting ontbreekt voor alle 29 pagina's. Bij de beoordeling is dit alleen op de startpagina nagegaan; voor de andere pagina's moet de vergelijking nog worden gemaakt.

Open: 1 punt, zie [Nog uitzoeken](#open-1.4.4).

<a id="bijlage-1.4.5"></a>

### 1.4.5 Afbeeldingen van tekst

**Uitkomst:** ✕ Voldoet niet · [Terug naar het resultaat](#sc-1.4.5)

**Hoe is dit vastgesteld**

1. Onderzocht: Welke afbeeldingen de site heeft en in welke groep ze vallen
   - Hoe: Dossier, onderdeel images, alle 29 pagina's in de begintoestand op 1280 pixels breed
   - Waargenomen: 497 keer een afbeelding aangetroffen op 29 pagina's, 55 verschillende. 53 daarvan zijn een pictogram van hooguit 48 bij 48 pixels, 1 is het beeldmerk in de kop (48 bij 96 pixels) en 1 is het toegankelijkheidslabel op P09 (692 bij 324 pixels). Er zijn 0 achtergrondafbeeldingen.
   - Bewijs: `images`
2. Onderzocht: Of in het toegankelijkheidslabel op P09 tekst staat die gewone tekst had kunnen zijn
   - Hoe: P09 vers geopend in de begintoestand; de afbeelding gezocht, tekstherkenning, uitsnede en code van de afbeelding; daarna de woorden uit het beeld in de code gezocht
   - Waargenomen: Op de pagina staat 1 afbeelding, een img-element van 692 bij 324 pixels. De tekstherkenning leest 66 woorden met 93% vertrouwen. De uitsnede toont een kop, drie alinea's en een lijstje naast een balk met de letters A tot en met E. De woorden staan niet als tekst in de code (2 keer gezocht, 0 gevonden). Het is geen logo; alleen de balk is een schema.
   - Bewijs: `v-145-0003`, `v-145-0004`, `v-145-0006`, `v-145-0007`, `v-145-0008`, `v-145-0009`
3. Onderzocht: Of het tekstalternatief van het label de tekst in het beeld dekt
   - Hoe: P09, tekstherkenning naast het tekstalternatief van de afbeelding
   - Waargenomen: Van de herkende tekst staat 23% in het tekstalternatief. Het verschil tussen de twee methoden gaat daarover, niet over de vraag of er tekst in het beeld staat. Dat hoort bij criterium 1.1.1.
   - Bewijs: `v-145-0007`

**Hoe zeker is dit oordeel**

Beoordelaar: Voldoet niet. Verificatie, tevens eindoordeel: Voldoet niet.

Grondslag: Beslisregel R1, procedure versie 7 (oordeel).

Beperking van de procedure: Tekst in afbeeldingen is gezocht met tekstherkenning en door te kijken, in één browser (Chromium). Tekstherkenning mist soms kleine, schuine of sierlijke letters. De veegronde dekt de pagina's en toestanden van de steekproef; de beoordelaar heeft die dekking met een steekproef bevestigd. Afbeeldingen achter een inlog en in een ingesloten venster dat bij het onderzoek niet laadde, zijn niet bekeken.

<a id="bijlage-1.4.10"></a>

### 1.4.10 Reflow

**Uitkomst:** ✕ Voldoet niet · [Terug naar het resultaat](#sc-1.4.10)

**Hoe is dit vastgesteld**

1. Onderzocht: Schuift een pagina opzij op 320 pixels breed, en valt er tekst buiten zijn kader
   - Hoe: Dossier: de meting op alle 29 pagina's in de begintoestand. Zelf op 320 pixels gemeten op P18 en op P13 met het venster voor een Kubernetes cluster open, en de kop van niveau 1 op P18 uitgesneden.
   - Waargenomen: Volgens het dossier schuift 0 van 29 pagina's opzij. Zelf gemeten op 2 pagina's: de inhoud is 320 pixels breed, niets steekt uit. Op P18 breekt de kop midden in een woord af naar de volgende regel; elke letter blijft in beeld.
   - Bewijs: `reflow`, `v-1410-0007`, `v-1410-0041`, `v-1410-0040`
2. Onderzocht: Is de te brede regel code op P04 op 320 pixels te bereiken
   - Hoe: Op 320 pixels het tweede codeblok opgezocht, de stijl van het vak gelezen, het vak focus gegeven, twee keer pijl-rechts gedrukt en een uitsnede van voor en na vergeleken.
   - Waargenomen: Het vak om de code is 212 pixels breed en schuift zelf opzij (\`overflow-x: auto\`). Het kan focus krijgen. Voor het schuiven eindigt de regel in beeld bij scripts/che, na twee keer pijl-rechts bij check\_site.p. Het vak schuift dus met het toetsenbord. Een codeblok valt onder de uitzondering.
   - Bewijs: `v-1410-0051`, `v-1410-0053`, `v-1410-0054`, `v-1410-0057`
3. Onderzocht: De titel van het venster voor een Kubernetes cluster op 320 pixels en op de gewone breedte
   - Hoe: Het venster geopend op P13 op 320 pixels, de kop van niveau 2 uitgesneden en de stijl gelezen. Daarna hetzelfde venster op de gewone breedte geopend en dezelfde kop uitgesneden.
   - Waargenomen: Op 320 pixels eindigt de titel na de letters aanm met drie puntjes. De kop staat op één regel en kapt af (\`white-space: nowrap\`, \`text-overflow: ellipsis\`). Op de gewone breedte staat de titel er volledig. De volledige titel staat nergens anders in het venster.
   - Bewijs: `v-1410-0003`, `v-1410-0005`, `v-1410-0006`, `v-1410-0021`
4. Onderzocht: De gekozen waarde in de keuzelijst Prijsmodel in hetzelfde venster
   - Hoe: Na de knop SSO Rijksoverheid in het formulier de tweede optie van Prijsmodel gekozen en de keuzelijst uitgesneden, op 320 pixels en op de gewone breedte. De code van de keuzelijst gelezen.
   - Waargenomen: Op 320 pixels is de gekozen waarde in het gesloten veld afgekapt na resou; op de gewone breedte staat ze er volledig. Het is een gewone keuzelijst van de browser: wie haar opent, leest elke optie volledig. De tekst blijft dus te bereiken; dit deel van de bevinding van de beoordelaar is niet overgenomen.
   - Bewijs: `v-1410-0009`, `v-1410-0013`, `v-1410-0015`, `v-1410-0016`, `v-1410-0026`
5. Onderzocht: De link GitHub in de kop op 320 pixels en op de gewone breedte
   - Hoe: Op P01 en P18 op 320 pixels de link uitgesneden, de code en de stijl van de tekst gelezen en de link aangewezen. Op P18 op de gewone breedte dezelfde link uitgesneden. Gezocht naar een andere link naar hetzelfde adres.
   - Waargenomen: Op 320 pixels staat er alleen een pictogram van een vertakking, 44 bij 44 pixels; het woord is teruggebracht tot 1 bij 1 pixel. Bij aanwijzen verschijnt niets. Op de gewone breedte staat het woord GitHub naast het pictogram. Op P18 staat geen andere link naar hetzelfde adres; op P01 wel, in de inhoud.
   - Bewijs: `reflow`, `v-1410-0029`, `v-1410-0030`, `v-1410-0031`, `v-1410-0033`, `v-1410-0034`, `v-1410-0036`, `v-1410-0039`, `v-1410-0045`
6. Onderzocht: Vergelijking van de inhoud tussen het brede en het smalle scherm op alle pagina's
   - Hoe: Het dossier bevat deze vergelijking niet. De beoordelaar deed haar op P01 en P13. Bij de verificatie is ze niet herhaald; het budget ging naar de bevindingen en de weggezette kandidaten.
   - Waargenomen: Op 2 van 29 pagina's is de inhoud breed en smal naast elkaar gelegd, zonder verschil buiten de menu's. Voor de andere 27 pagina's is alleen bekend welke links en knoppen uit beeld gaan, niet of er koppen, tekstblokken of afbeeldingen verdwijnen.
   - Bewijs: `reflow`, `b-1410-0076`, `b-1410-0078`, `v-1410-0041`

**Hoe zeker is dit oordeel**

Beoordelaar: Voldoet niet. Verificatie, tevens eindoordeel: Voldoet niet.

Grondslag: Beslisregel R2, procedure versie 8 (probe).

Beperking van de procedure: Er is gemeten op 320 pixels breed in één browser (Chromium). De veegronde dekt de pagina's en toestanden van de steekproef; de beoordelaar heeft die dekking met een steekproef bevestigd en niet alles zelf nagemeten. Mag de run niet versturen, dan zijn stappen die pas na het versturen van een formulier komen niet bekeken; onderdelen achter een inlog zijn nooit bekeken.

Open, voor een volgende meting:

- Dekking ontbrak: Een vergelijking van de inhoud (koppen, tekstblokken, afbeeldingen) tussen 1280 en 320 pixels breed op alle 29 pagina's. Bij de beoordeling is dit alleen op de startpagina en de pagina over cloud nagegaan; daar verdween niets. Voor de overige 27 pagina's moet deze vergelijking nog worden gemaakt.

Open: 1 punt, zie [Nog uitzoeken](#open-1.4.10).

<a id="bijlage-1.4.11"></a>

### 1.4.11 Contrast van niet-tekstuele content

**Uitkomst:** ✕ Voldoet niet · [Terug naar het resultaat](#sc-1.4.11)

**Hoe is dit vastgesteld**

1. Onderzocht: De aanduiding van het huidige item in het zijmenu en in het smalle hoofdmenu
   - Hoe: Opnieuw gemeten op verse pagina's: zijmenu op P14 in licht en donker en op P05 in licht, hoofdmenu op 360 pixels breed op P01. Opmaak van het huidige item vergeleken met een ander item.
   - Waargenomen: Zijmenu: het huidige item heeft alleen een vlak \#d9dee5 op \#f5f7f9, 1,2:1, op P14 en op P05; in donker \#3c4450 op \#1a1e24, 1,7:1. Gewicht, kleur en onderstreping van de tekst zijn gelijk aan die van een ander item. Smal hoofdmenu: vlak \#c8ced8 op wit met de aanwijzer erop, hooguit 1,5:1; de andere items zijn wit.
   - Bewijs: `v-1411-0040`, `v-1411-0041`, `v-1411-0043`, `v-1411-0044`, `v-1411-0047`, `v-1411-0050`, `v-1411-0053`, `v-1411-0054`, `v-1411-0055`
2. Onderzocht: Keuzelijsten in het feedbackvenster en in het clusterformulier
   - Hoe: Gemeten met contrast, uitsnede en berekende opmaak: keuzelijst in het feedbackvenster op P01 (licht) en de keuzelijst Organisatie in het clusterformulier op P13 (licht en donker).
   - Waargenomen: Vlak \#e2e6ec op wit 1,2:1 en rand \#c8ced8 1,5:1; in donker vlak 1,3:1 en rand 1,5:1. In elke keuzelijst staat de tekst van de gekozen optie en rechts een dubbel pijltje in de tekstkleur (\#20252c op het vlak, ruim 12:1; in donker een lichte kleur op een donker vlak). Daaraan is de keuzelijst te herkennen. Geen fout.
   - Bewijs: `v-1411-0005`, `v-1411-0006`, `v-1411-0018`, `v-1411-0024`, `v-1411-0025`, `v-1411-0026`, `v-1411-0061`, `v-1411-0062`, `v-1411-0063`
3. Onderzocht: De rand van tekstvelden en van het zoekveld
   - Hoe: Uitsnede en berekende opmaak van het vak om het veld: tekstveld in het feedbackvenster op P01, tekstveld voor de naam van het cluster op P13, zoekveld in het zoekvenster op P01.
   - Waargenomen: Het invoerelement zelf heeft geen rand; de rand zit op het vak eromheen. Die is 2 pixels breed en heeft de kleur \#5f6d81 op wit: 5,2:1. Op de uitsneden is de rand rondom scherp te zien. De eerdere meting pakte het binnenste element.
   - Bewijs: `v-1411-0017`, `v-1411-0028`, `v-1411-0030`, `v-1411-0031`, `v-1411-0036`, `v-1411-0037`
4. Onderzocht: De focusrand om de link in het blauwe vlak op de startpagina, donker
   - Hoe: Focus gemeten op P01 in het donkere kleurenschema; de uitsnede bekeken en de kleuren in de uitsnede geteld.
   - Waargenomen: De meting geeft 2,8:1 voor de ring \#608fc5 tegen het blauw \#184576. Op de uitsnede ligt de ring van 2 pixels midden in een donkere band \#20252c van 6 pixels. De ring grenst dus aan beide kanten aan die band en steekt daar 4,5:1 tegen af. Geen fout.
   - Bewijs: `v-1411-0058`
5. Onderzocht: Wat niet is gemeten
   - Hoe: Het dossier bevat de begintoestand op 1280 pixels breed; de vensters zijn bij de beoordeling en de toetsing met de hand gemeten, niet elk in beide kleurenschema's.
   - Waargenomen: Niet gemeten: de kleuren bij aanwijzen met de muis en bij een foutmelding in een veld; het zoekvenster en het smalle hoofdmenu in donker; de pagina's op 320 pixels breed. De focus op de keuzelijst in het feedbackvenster, die bij criterium 2.4.7 hoort, is bij de toetsing niet opnieuw bekeken.
   - Bewijs: `uiContrast`, `v-1411-0036`, `v-1411-0053`

**Hoe zeker is dit oordeel**

Beoordelaar: Voldoet niet. Verificatie, tevens eindoordeel: Voldoet niet.

Grondslag: Beslisregel R4, procedure versie 6 (probe+oordeel).

Beperking van de procedure: De veegronde meet het contrast op de pagina's en toestanden van de steekproef in één browser (Chromium); de beoordelaar heeft die dekking met een steekproef bevestigd en niet alles zelf nagemeten. Een grafiek, kaart of diagram in een afbeelding is alleen op een uitsnede beoordeeld; wat daar niet evident was, staat als open punt. De aanduiding van een toestand (aangevinkt, gekozen, aangewezen, fout) mat de veegronde niet; ze is alleen gemeten waar de beoordelaar haar zelf opriep. De focusaanduiding die de browser zelf tekent, is vrijgesteld en verschilt per browser.

Open, voor een volgende meting:

- Dekking ontbrak: De kleuren van knoppen, links en velden bij aanwijzen met de muis en bij een foutmelding in een veld zijn op geen van de 29 pagina's gemeten. Roep die toestanden op en meet het contrast van rand, vlak en pictogram.
- Dekking ontbrak: De randen en vlakken van bedieningselementen in de geopende vensters (zoeken, feedback, clusterformulier, menu's) staan niet in de meting. Ze zijn met de hand gemeten in licht, en het feedbackvenster en het clusterformulier ook in donker; het zoekvenster en het smalle hoofdmenu zijn in donker niet gemeten.
- Dekking ontbrak: De randen en vlakken van bedieningselementen op 320 pixels breed, waar de knop Menu staat, zijn niet gemeten.
- Budget was op: Bij de beoordeling veranderde er niets zichtbaars bij focus op de tweede keuzelijst in het feedbackvenster op P01. Dat hoort bij criterium 2.4.7 en is bij de toetsing niet opnieuw bekeken. Zet de focus met het toetsenbord op die keuzelijst en kijk of er een rand verschijnt.

Open: 4 punten, zie [Nog uitzoeken](#open-1.4.11).

<a id="bijlage-1.4.12"></a>

### 1.4.12 Tekstafstand

**Uitkomst:** ◐ Geen afwijking gevonden, niet volledig gemeten · [Terug naar het resultaat](#sc-1.4.12)

**Hoe is dit vastgesteld**

1. Onderzocht: Of tekst wordt afgekapt of de afstand niet aanneemt, op alle pagina's en in elke toestand
   - Hoe: Dossier: meting op 29 pagina's, 1280 en 320 pixels breed, en in 12 toestanden. Zelf nagemeten op zeven pagina's; de stijl van het afgekapte label gelezen op P13.
   - Waargenomen: Dossier: 6359 schaduwbomen aangepast, 0 teksten zonder afstand. Eigen metingen: steeds 0 teksten zonder afstand en hooguit 1 afgekapte tekst, het verborgen label van de knop met drie puntjes. Dat label is 1 bij 1 pixel met overflow hidden en dus geen zichtbare tekst.
   - Bewijs: `textSpacing`, `v-1412-0003`, `v-1412-0016`, `v-1412-0023`, `v-1412-0026`, `v-1412-0029`
2. Onderzocht: Steekproef op andere paginatypen en in geopende onderdelen dan de beoordelaar bekeek
   - Hoe: Eigen meting met ruimere tekstafstand en kijken op P14 (cloud-fases), op P17 met de praktische tips open en op P13 met het clustervenster open; de stijl van het zijmenu op P14.
   - Waargenomen: Op alle drie de beelden staat de tekst zichtbaar ruimer. Geen overlap, geen halve regels, niets steekt uit een knop of kaart. Het clustervenster toont titel, uitleg en drie knoppen volledig. Het zijmenu is 752 pixels hoog en kan zelf schuiven (overflow-y auto), dus wat onder de rand valt is te bereiken.
   - Bewijs: `v-1412-0022`, `v-1412-0023`, `v-1412-0025`, `v-1412-0026`, `v-1412-0028`, `v-1412-0029`, `v-1412-0037`
3. Onderzocht: De kop op 320 pixels breed met ruimere tekstafstand (de vier kandidaten)
   - Hoe: Eigen meting met ruimere tekstafstand op P03, P10, P11 en P29 op 320 pixels breed; de kop op elk beeld bekeken en op P03 naast de kop zonder ruimere afstand gelegd.
   - Waargenomen: De pagina wordt 410 pixels breed en schuift opzij. De sitetitel staat op één regel en is na schuiven heel te lezen. Menu en Zoeken blijven staan; Feedback en GitHub verdwijnen uit de balk en er komt een knop met drie puntjes. Geen zichtbare tekst is afgekapt.
   - Bewijs: `v-1412-0003`, `v-1412-0005`, `v-1412-0007`, `v-1412-0009`, `v-1412-0011`
4. Onderzocht: Het menu achter de knop met drie puntjes met ruimere tekstafstand
   - Hoe: Op P13 op 1030 pixels breed de knop zonder ruimere afstand aangeklikt en gekeken; daarna de ruimere afstand aangezet en opnieuw gekeken.
   - Waargenomen: Zonder ruimere afstand opent het menu en toont het Over NeRDS. Zodra de afstand wordt aangezet, sluit het menu (expanded gaat van true naar false). Op het beeld met ruimere afstand staan Home, Richtlijnen en Over NeRDS geen van drieën meer in de balk; alleen de knop met drie puntjes. Of het menu dan opent en alle tekst toont, is niet gemeten.
   - Bewijs: `v-1412-0017`, `v-1412-0018`, `v-1412-0019`, `v-1412-0020`
5. Onderzocht: Het codeblok op P04 dat op 320 pixels niet helemaal in beeld staat
   - Hoe: P04 geopend op 320 pixels breed zonder ruimere tekstafstand; uitsnede, stijl en code van het codeblok onder de kop Uitgebreide ontwikkelomgeving.
   - Waargenomen: Ook zonder ruimere tekstafstand is de regel \`uv run python scripts/check\_site.py\` maar tot \`scripts/che\` in beeld; het blok is een eigen gebied met \`tabindex="0"\` dat kan schuiven. Het komt dus niet door de tekstafstand: hoort bij criterium 1.4.10.
   - Bewijs: `v-1412-0041`, `v-1412-0042`, `v-1412-0043`
6. Onderzocht: Instellingen in de code die een eigen tekstafstand van de bezoeker tegenhouden
   - Hoe: Dossier: de regel-engines op alle 29 pagina's.
   - Waargenomen: Geen enkele regel meldt een fout: avoid-inline-spacing (axe-core) voldoet, sia-r91, sia-r92 en sia-r93 (Alfa) zijn niet van toepassing. Bij de eigen metingen nam alle tekst de afstand aan.
   - Bewijs: `engine`, `v-1412-0003`

**Hoe zeker is dit oordeel**

Beoordelaar: Kan niet bepalen. Verificatie, tevens eindoordeel: Kan niet bepalen.

Poging om het oordeel onderuit te halen: Geprobeerd het open punt te beslechten: het menu achter de drie puntjes geopend op P13 en daarna de afstand aangezet; het menu sluit dan, en de meting zet de afstand daarna weer terug, dus het blijft open. De vier kandidaten zelf nagemeten op 320 pixels: geen verlies. Naar een tegenvoorbeeld gezocht op P14, in de praktische tips op P17 en in het clustervenster op P13: niets gevonden. P04 op 320 pixels: onderste deel van het beeld blijft leeg.

Grondslag: Beslisregel R5, procedure versie 7 (probe).

Beperking van de procedure: De ruimere tekstafstand is afgedwongen in één browser (Chromium). De veegronde dekt de pagina's en toestanden van de steekproef; de beoordelaar heeft die dekking met een steekproef bevestigd en niet alles zelf nagemeten. Voor tekst die de afstand ondanks het afdwingen niet kreeg, is niet aangetoond wat er gebeurt als een gebruiker haar wel aanpast.

Open, voor een volgende meting:

- Dekking ontbrak: Het menu achter de knop met drie puntjes in de kop is niet gemeten met ruimere tekstafstand. Met ruimere tekstafstand verdwijnen op een scherm van 1030 pixels breed de links Home, Richtlijnen en Over NeRDS uit de menubalk, op 1280 pixels alleen Over NeRDS en op 320 pixels de knop Feedback en de link GitHub; ze staan dan achter die knop. Zonder ruimere tekstafstand opent het menu, maar bij de beoordeling en bij de verificatie sloot het zodra de afstand werd aangezet. Nodig: een meting op één brede pagina en één pagina op 320 pixels waarbij de ruimere afstand al aanstaat voordat het menu wordt geopend.
- Dekking ontbrak: Op de pagina Bijdragen (P04) is het beeld op 320 pixels met ruimere tekstafstand in het laatste deel van de pagina leeg, omdat de pagina dan te lang is voor één beeld; ook bij de verificatie. De meting van afgekapte tekst dekt dat deel wel en vond daar niets, maar het is niet op beeld bekeken. Nodig: het onderste deel van die pagina apart vastleggen.

Open: 2 punten, zie [Nog uitzoeken](#open-1.4.12).

<a id="bijlage-1.4.13"></a>

### 1.4.13 Content bij hover of focus

**Uitkomst:** ✕ Voldoet niet · [Terug naar het resultaat](#sc-1.4.13)

**Hoe is dit vastgesteld**

1. Onderzocht: Het tekstballonnetje bij de kopieerknop van een codeblok op een smal scherm
   - Hoe: P04 vers geopend op 320 breed: uitsnede van het codeblok, de knop aangewezen, uitsnede, Escape, uitsnede en gekeken
   - Waargenomen: Voor het aanwijzen is van de coderegel te lezen tot en met scripts/che. Na het aanwijzen ligt het ballonnetje 'Kopieer' over het eind van die regel: te lezen blijft tot en met scri. Na Escape meldt het antwoord geen verandering en staat het ballonnetje er op de uitsnede en bij het kijken nog.
   - Bewijs: `v-1413-0005`, `v-1413-0007`, `v-1413-0008`, `v-1413-0009`, `v-1413-0010`, `v-1413-0011`, `v-1413-0012`
2. Onderzocht: Het tekstballonnetje bij de knop om de zoekopdracht te wissen, in het zoekvenster met een zoekwaarde
   - Hoe: P01 in de toestand process-zoeken op 1280 en op 320 breed: de knop aangewezen, gekeken, het eerste zoekresultaat uitgesneden, het ballonnetje aangewezen, Escape en opnieuw gekeken
   - Waargenomen: Bij aanwijzen verschijnt 'Wis zoekopdracht' tussen het zoekveld en het eerste resultaat. Op beide breedtes raakt het drie pixels van de lege bovenrand van het eerste resultaat en geen tekst. Het blijft staan als de muis erop komt. Escape haalt het weg en wist daarbij ook de zoekwaarde.
   - Bewijs: `v-1413-0015`, `v-1413-0016`, `v-1413-0017`, `v-1413-0018`, `v-1413-0019`, `v-1413-0020`, `v-1413-0021`, `v-1413-0025`, `v-1413-0026`
3. Onderzocht: Het tekstballonnetje bij de knop Verberg in de melding op de startpagina
   - Hoe: P01 vers geopend op 320 breed: de knop aangewezen en gekeken; daarnaast de waarnemingen van de beoordelaar gelezen
   - Waargenomen: Bij aanwijzen verschijnt 'Verberg' onder de knop, rechts naast de tekst van de melding. Het bedekt geen tekst en geen knop. Weghalen met Escape is daar dus niet verplicht. Blijven staan en Escape bij focus zijn niet opnieuw gemeten; de beoordelaar mat dat het ruim negen seconden bleef staan.
   - Bewijs: `v-1413-0042`, `v-1413-0043`, `b-1413-0034`, `b-1413-0037`, `b-1413-0042`
4. Onderzocht: De kopieerknop in het venster Kubernetes cluster aanmaken op de pagina over cloud
   - Hoe: P13 op 320 breed: de knop Aanmaken aangeklikt, in het venster de inlogstap SSO Rijksoverheid gekozen, gekeken en naar het codeblok gezocht
   - Waargenomen: Het venster opent en toont na de inlogstap een formulier met onder meer 'Naam van het cluster'. Het codeblok met de kopieerknop is dan nog verborgen: het komt pas na het invullen van het formulier. Het ballonnetje is daar niet gemeten.
   - Bewijs: `v-1413-0030`, `v-1413-0034`, `v-1413-0038`, `v-1413-0039`
5. Onderzocht: Of het dossier elk bedieningselement heeft aangewezen en gefocust
   - Hoe: Dossier gelezen: hover en controls, naast de eigen proeven op P01 en P04
   - Waargenomen: Het dossier heeft 150 van de 392 gevonden elementen aangewezen en gefocust; 242 niet. Het telt 88 unieke bedieningselementen. Het noemt één verschijning, zonder tekst. De ballonnetjes bij de kopieerknop op P04 en bij de knop Verberg op P01 staan er niet in, maar verschenen bij de eigen proef wel. De meting in het dossier is dus niet volledig.
   - Bewijs: `hover`, `controls`, `v-1413-0012`, `v-1413-0043`

**Hoe zeker is dit oordeel**

Beoordelaar: Voldoet niet. Verificatie, tevens eindoordeel: Voldoet niet.

Grondslag: Beslisregel R1, procedure versie 5 (probe+oordeel).

Beperking van de procedure: Of content die bij aanwijzen of focus verschijnt blijft staan, is nagegaan over de duur van de meting (enkele seconden). Of ze na langere tijd vanzelf verdwijnt, is niet vastgesteld. De veegronde wijst de bedieningselementen aan op de pagina's en toestanden van de steekproef, in één browser (Chromium); de beoordelaar heeft die dekking met een steekproef bevestigd.

Open, voor een volgende meting:

- Dekking ontbrak: Van de 392 gevonden bedieningselementen zijn er 242 niet aangewezen en gefocust, en de tekstballonnetjes bij de knoppen Verberg (startpagina) en Kopieer (pagina Contact en bijdragen) zijn door de meting niet opgemerkt. De meting moet opnieuw, zonder grens van 150 elementen.
- Dekking ontbrak: Per verschenen inhoud is niet gemeten of ze blijft staan en of ze andere inhoud bedekt; onderdelen zonder bediening, de geopende vensters en menu's en het smalle scherm zijn niet aangewezen en gefocust.
- Budget was op: De kopieerknop in het venster Kubernetes cluster aanmaken op de pagina over cloud is niet aangewezen. Het codeblok verschijnt daar pas na het invullen van het formulier in dat venster; tot en met de inlogstap is het venster doorlopen. Ook zijn de tekstballonnetjes niet op tussenbreedtes en bij langere coderegels op een breed scherm bekeken.
- Budget was op: Het geopende feedbackvenster, het hoofdmenu en het zijmenu op een smal scherm zijn niet aangewezen en gefocust.

Open: 4 punten, zie [Nog uitzoeken](#open-1.4.13).

<a id="bijlage-2.1.1"></a>

### 2.1.1 Toetsenbord

**Uitkomst:** ◐ Geen afwijking gevonden, niet volledig gemeten · [Terug naar het resultaat](#sc-2.1.1)

**Hoe is dit vastgesteld**

1. Onderzocht: Of elke link en elk bedieningselement met Tab of de pijltjestoetsen focus krijgt, en of het scrollende zijmenu in beeld te brengen is
   - Hoe: Dossier: de Tab-loop op alle 29 pagina's, breed, het gemelde scrollgebied en de regel-engines. Zelf: de Tab-loop op P13 en P14, de pijltjestoetsen in beide lijsten van het zijmenu op P13 en focus op het scrollgebied op P04.
   - Waargenomen: Dossier: 29 van 29 pagina's helemaal doorlopen, 1269 Tab-stops, 0 elementen niet bereikt, 12 rijen met samen 129 links via de pijltjestoetsen. Zelf: 74 stops op P13 en 67 op P14, gelijk aan het dossier. Het dossier meldt één scrollgebied zonder toegang op 21 pagina's en één engine geeft 1799 meldingen; dat klopt niet: het zijmenu krijgt focus en schoof na End van 0 naar 501 pixels.
   - Bewijs: `keyboard`, `engine`, `v-211-0045`, `v-211-0065`, `v-211-0048`, `v-211-0049`, `v-211-0050`, `v-211-0051`, `v-211-0052`, `v-211-0053`, `v-211-0054`, `v-211-0076`
2. Onderzocht: Of de links in het geopende zijmenu en hoofdmenu op een smal scherm te bereiken en te bedienen zijn
   - Hoe: Zelf gemeten op 360 pixels breed: het zijmenu op P12 (bewaarde toestand) en op P03 (zelf geopend met Enter), en het hoofdmenu op P02. Telkens Tab, de pijltjestoetsen, End en Enter.
   - Waargenomen: Het zijmenu opent met Enter en sluit met Escape. Tab stopt op de sluitknop en op de eerste link van elke lijst. Pijl omlaag, End en pijl omhoog gaven de andere links focus, in beide lijsten; Enter opende de gekozen pagina. In het hoofdmenu gaf pijl omlaag de twee andere links focus en opende Enter de pagina.
   - Bewijs: `dialogs`, `v-211-0003`, `v-211-0004`, `v-211-0006`, `v-211-0007`, `v-211-0008`, `v-211-0009`, `v-211-0010`, `v-211-0011`, `v-211-0012`, `v-211-0013`, `v-211-0018`, `v-211-0019`, `v-211-0020`, `v-211-0021`, `v-211-0022`, `v-211-0023`, `v-211-0024`, `v-211-0026`, `v-211-0027`, `v-211-0028`, `v-211-0029`
3. Onderzocht: Of knoppen, selectievakjes en uitklappers op Enter of spatie reageren
   - Hoe: Dossier: de bedieningselementen op 29 pagina's, de klikbare elementen zonder bediening, en de proef met elke unieke knop op 1280 en 360 pixels breed. Zelf: een uitklapper en de knop Aanmaken op P13, een selectievakje op P14, de kopieerknop op P04.
   - Waargenomen: Dossier: 88 verschillende bedieningselementen (14 knoppen, 73 selectievakjes, 1 uitklapper), alle standaardelementen; 0 klikbare elementen zonder bediening. Van 9 geactiveerde knoppen reageerden er 8 op Enter (5 breed, 3 smal) en 1 standaardknop gaf in de proef geen zichtbare reactie. Zelf: de uitklapper opende met Enter en sloot met spatie, het selectievakje werd aangevinkt met spatie, Aanmaken opende het venster met spatie en de kopieerknop kopieerde met Enter.
   - Bewijs: `controls`, `dialogs`, `v-211-0056`, `v-211-0057`, `v-211-0059`, `v-211-0067`, `v-211-0069`, `v-211-0070`, `v-211-0074`
4. Onderzocht: Of het zoekvenster en het feedbackvenster met het toetsenbord te bedienen zijn
   - Hoe: Zelf gemeten in de bewaarde toestanden op P01 en P11: de Tab-loop, Shift+Tab, de pijltjestoetsen, Enter en Escape; in het feedbackvenster ook Enter op de knoppen.
   - Waargenomen: Zoeken: Tab gaat van het zoekveld naar de wisknop en het eerste resultaat; de knop Sluit kreeg focus met Shift+Tab en Enter sloot het venster; pijl omlaag en End gaven de andere resultaten focus en Enter opende er een. Feedback: de twee keuzelijsten en Sluit kregen focus met Shift+Tab, Enter voegde een linkveld toe en Enter op de e-mailknop gaf de foutmeldingen.
   - Bewijs: `v-211-0031`, `v-211-0032`, `v-211-0034`, `v-211-0035`, `v-211-0036`, `v-211-0037`, `v-211-0039`, `v-211-0040`, `v-211-0042`, `v-211-0043`, `v-211-0080`, `v-211-0083`, `v-211-0086`, `v-211-0088`, `v-211-0091`, `v-211-0095`
5. Onderzocht: Of het proefformulier voor een cluster en het scherm na het versturen te bedienen zijn
   - Hoe: Zelf gemeten op P13: de Tab-loop in het eerste scherm van het venster, in het formulier en in het scherm na het versturen; daar ook een klik op een regel met gegevens, met een uitsnede ervoor en erna.
   - Waargenomen: Eerste scherm: Sluit en de drie inlogknoppen zijn Tab-stops. Formulier: 8 Tab-stops, van Terug tot de verzendknop. Na het versturen: het codeblok, de kopieerknop en de knop voor een nieuw cluster zijn Tab-stops. De regels met gegevens zijn als klikbaar gemarkeerd, maar een klik veranderde niets: de uitsnede ervoor en erna is gelijk.
   - Bewijs: `v-211-0060`, `v-211-0099`, `v-211-0104`, `v-211-0105`, `v-211-0106`, `v-211-0107`, `v-211-0108`
6. Onderzocht: Of het tekstblok in het lege zoekvenster, dat als klikbaar is gemarkeerd, een functie heeft
   - Hoe: Zelf bekeken op P11: het zoekvenster nadat Escape de zoekopdracht had gewist. Een vergelijkbaar blok in het clustervenster is wel aangeklikt.
   - Waargenomen: In het lege zoekvenster staat een blok met een aanwijzing om te typen. Het is geen link of knop, maar is als klikbaar gemarkeerd. Het is niet aangeklikt, omdat het budget op was. De regels met gegevens in het clustervenster zijn op dezelfde manier gemarkeerd; daar veranderde een klik niets.
   - Bewijs: `v-211-0115`, `v-211-0107`

**Hoe zeker is dit oordeel**

Beoordelaar: Kan niet bepalen. Verificatie, tevens eindoordeel: Kan niet bepalen.

Poging om het oordeel onderuit te halen: Het open punt gemeten: in het geopende zijmenu op 360 pixels (P12 en P03) geven pijl omlaag, End en pijl omhoog elke link focus en opent Enter de pagina. Daarna gezocht naar een tegenvoorbeeld: Tab-loop op P13 en P14, zoeken, feedback, clusterformulier en het scherm na versturen, selectievakje, uitklapper, kopieerknop. Geen functie gevonden die alleen met de muis werkt. Eén klikbaar gemarkeerd tekstblok in het lege zoekvenster bleef onbeklikt.

Grondslag: Beslisregel R7, procedure versie 8 (probe+oordeel).

Beperking van de procedure: Mag de run niet versturen, dan is niet bediend wat een formulier of een ingesloten venster pas na het versturen toont; op een testomgeving waar versturen mag, is dat wel gedaan. Functies die alleen met slepen werken, zijn niet uitgeprobeerd; wel is gekeken of een knop of veld hetzelfde doet. Bediend is met het toetsenbord in één browser (Chromium), op de pagina's en toestanden van de steekproef, niet op elke pagina in elke toestand. Alleen de Tab-volgorde is, waar de beoordelaar die zelf mat, herhaald in WebKit en Firefox als die beschikbaar waren.

Open, voor een volgende meting:

- Budget was op: Op elke pagina, in het zoekvenster zonder zoekopdracht (knop Zoeken in de kop), staat een tekstblok met een aanwijzing om te typen dat als klikbaar is gemarkeerd. Niet gemeten is of een klik erop iets doet. Klik erop met de muis: gebeurt er niets, dan is er geen fout; gebeurt er wel iets, dan moet dat ook met het toetsenbord kunnen.

Open: 1 punt, zie [Nog uitzoeken](#open-2.1.1).

<a id="bijlage-2.1.2"></a>

### 2.1.2 Geen toetsenbordval

**Uitkomst:** ● Voldoet · Niveau A · EN 301 549: 9.2.1.2 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap.html) · [Terug naar het resultaat](#sc-2.1.2)

**Hoe is dit vastgesteld**

1. Onderzocht: Komt de Tab-toets op elke pagina tot het eind, zonder ergens te blijven hangen?
   - Hoe: Dossier: de Tab-loop per pagina, breed scherm, begintoestand. Zelf nagelopen op twee andere paginatypen dan de beoordelaar: P04 (bijdragen) en P18 (fases), elk tot hooguit 80 stops.
   - Waargenomen: Volgens het dossier is de loop op 29 van 29 pagina's voltooid, met samen 1269 Tab-stops, en bleef de focus nergens hangen (0 rijen). Zelf gemeten: P04 66 stops en P18 60 stops, allebei tot het eind. Dat zijn dezelfde aantallen als in het dossier.
   - Bewijs: `keyboard`, `v-212-0034`, `v-212-0036`
2. Onderzocht: Kom je met het toetsenbord weer uit elk venster dat over de pagina opent?
   - Hoe: Dossier: 9 knoppen geactiveerd op breed scherm en op 360 pixels. Zelf: Tab en Escape in het venster met inlogknoppen op P14, het zoekvenster met resultaten op P01 en het zijmenu op P11 op 320 pixels breed.
   - Waargenomen: Volgens het dossier gingen 8 van de 9 knoppen open; 6 openen een venster over de pagina en alle 6 laten de focus naar buiten en sluiten met Escape. Zelf gemeten in 3 vensters: Tab loopt rond langs de browserbalk en Escape sloot elk venster, met de focus terug op de knop. In het zoekvenster wist de eerste Escape het zoekveld en sloot de tweede het venster.
   - Bewijs: `dialogs`, `v-212-0043`, `v-212-0044`, `v-212-0048`, `v-212-0049`, `v-212-0050`, `v-212-0053`, `v-212-0054`, `v-212-0055`
3. Onderzocht: Klopt de Tab-loop in de geopende toestanden van de site?
   - Hoe: Dossier: de Tab-proef per vastgelegde toestand. Zelf: de loop in het venster met inlogknoppen op P14 en in het feedbackvenster op P01, en rondtabben in het zijmenu op 320 pixels breed op P11.
   - Waargenomen: Van de 12 vastgelegde toestanden is de loop in 11 voltooid; in het zijmenu op smal scherm raakte de meting de focus kwijt. Zelf nagelopen op P11: Tab loopt daar rond langs 2 stops en de browserbalk, en Escape sluit het menu. Venster met inlogknoppen: 4 stops, voltooid. Feedbackvenster: voltooid.
   - Bewijs: `site-states/component-zijmenu-smal/tabwalk.json`, `v-212-0007`, `v-212-0043`, `v-212-0054`, `v-212-0055`
4. Onderzocht: Blijft het toetsenbord vrij in het feedbackvenster nadat een knop is ingedrukt?
   - Hoe: Zelf op P01: een link ingevuld en de knop om een link toe te voegen ingedrukt met Enter; daarna beide verzendknoppen ingedrukt met Enter, eerst met lege verplichte velden en daarna volledig ingevuld. Na elke stap Tab, Shift+Tab en aan het eind Escape.
   - Waargenomen: De knop voegde een tweede linkveld toe. Met lege velden verscheen een foutmelding en ging de focus naar de keuzelijst; Tab liep verder. Na versturen verscheen "Bedankt voor uw feedback!" en bleef het venster open met een leeg formulier. Tab liep in alle gevallen rond langs de browserbalk, Shift+Tab liep terug, en Escape sloot het venster met de focus op de knop Feedback.
   - Bewijs: `v-212-0005`, `v-212-0006`, `v-212-0008`, `v-212-0010`, `v-212-0012`, `v-212-0013`, `v-212-0020`, `v-212-0022`, `v-212-0023`, `v-212-0027`, `v-212-0029`, `v-212-0030`, `v-212-0031`, `v-212-0032`
5. Onderzocht: Werkt achteruit tabben (Shift+Tab)?
   - Hoe: Niet in het dossier. De beoordelaar mat het op één pagina van elk van de 18 paginatypen. Zelf nagemeten in de inhoud van P18 (4 keer) en in het feedbackvenster op P01 (in vier toestanden).
   - Waargenomen: Bij elke druk op Shift+Tab ging de focus naar een ander element: op P18 langs drie selectievakjes en een link, in het feedbackvenster langs de knoppen en velden en via de browserbalk terug. De focus bleef nergens staan. Dat klopt met wat de beoordelaar op de 18 paginatypen zag.
   - Bewijs: `v-212-0041`, `v-212-0008`, `v-212-0013`, `v-212-0023`, `v-212-0030`, `b-212-0004`, `b-212-0028`
6. Onderzocht: Houdt een onderdeel de focus vast nadat je het hebt bediend?
   - Hoe: Zelf bediend en daarna getabd: tekstveld en keuzelijst in het feedbackvenster (P01) en het zoekveld met resultaten na Enter (P01). De beoordelaar bediende daarnaast het selectievakje (P14), de kopieerknop (P04) en het proefformulier op P13 tot na versturen.
   - Waargenomen: In het feedbackvenster ging de focus na typen en kiezen met Tab verder naar het volgende veld. In het zoekvenster veranderde Enter niets; Tab ging daarna langs een knop, een zoekresultaat, de browserbalk en de knop Sluit terug naar het zoekveld. Geen onderdeel hield de focus vast.
   - Bewijs: `v-212-0015`, `v-212-0016`, `v-212-0017`, `v-212-0047`, `v-212-0048`, `b-212-0047`, `b-212-0049`, `b-212-0053`, `b-212-0055`

**Hoe zeker is dit oordeel**

Beoordelaar: Voldoet. Verificatie, tevens eindoordeel: Voldoet.

Poging om het oordeel onderuit te halen: Het open punt van de beoordelaar nagemeten: in het feedbackvenster op P01 de knop Link toevoegen en beide verzendknoppen met Enter ingedrukt, met foutmelding en na versturen; Tab, Shift+Tab en Escape bleven werken. Verder andere paginatypen (P04, P18), het venster met inlogknoppen op P14, Enter in het zoekvenster en het zijmenu op 320 pixels op P11. Nergens een val gevonden.

Grondslag: Beslisregel R3, procedure versie 6 (probe).

Beperking van de procedure: Mag de run niet versturen, dan is een onderdeel dat de focus pas vasthoudt na het versturen niet onderzocht; achter een login is nooit gekeken. De Tab-loop is gedaan in één browser (Chromium), op de pagina's en toestanden van de steekproef, niet op elke pagina in elke toestand.

<a id="bijlage-2.1.4"></a>

### 2.1.4 Enkel teken sneltoetsen

**Uitkomst:** − Niet van toepassing · Niveau A · EN 301 549: 9.2.1.4 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html) · [Terug naar het resultaat](#sc-2.1.4)

**Hoe is dit vastgesteld**

1. Onderzocht: Of een losse letter, een los cijfer of een los leesteken op een pagina iets in gang zet
   - Hoe: Dossier: op elke pagina zijn in de begintoestand alle toetsen één voor één ingedrukt, met de focus op de pagina zelf
   - Waargenomen: Toetsen ingedrukt op 29 van 29 pagina's. Per pagina 42 toetsen: 26 letters, 10 cijfers en 6 leestekens (/ ? . , - =). Nul reacties vastgelegd.
   - Bewijs: `singleKeys`
2. Onderzocht: Of er code naar toetsen luistert en of er ingesloten vensters met een speler zijn
   - Hoe: Dossier, 29 pagina's; zelf naar ingesloten vensters en video gezocht op P09 en in het feedbackvenster op P02
   - Waargenomen: Luisteraars voor toetsen op het document, op invoervelden, op keuzelijsten en op nldd-list (elk alle 29 pagina's), op een div (P04, P13, P14) en op nldd-tooltip (P01, P04, P13, P14). Geen daarvan reageerde op een los teken. Nul accesskeys. Nul ingesloten vensters, nul bekende spelers, nul onbekende vensters; zelf ook nul vensters en nul video's gevonden.
   - Bewijs: `keyShortcuts`, `v-214-0002`, `v-214-0003`, `v-214-0016`
3. Onderzocht: Of een los teken iets doet nadat een onderdeel is geopend
   - Hoe: Dossier, per toestand uit het sitemodel, elk 42 toetsen
   - Waargenomen: 12 van 14 toestanden gemeten: zoekvenster, feedbackvenster, menu en zijmenu op smal scherm, melding verbergen, praktische tips, afvinklijst, venster Kubernetes cluster aanmaken, kopieerknop en drie processen. In 11 nul reacties; bij de kopieerknop 3 (m, y, ?). De twee niet gemeten toestanden zijn uitgeschakelde knoppen die niets openen; hun pagina's (P13, P14, P21) zijn in de begintoestand gemeten zonder reactie.
   - Bewijs: `singleKeys`
4. Onderzocht: Of de melding bij de kopieerknop op P04 door een toets verdwijnt
   - Hoe: P04 vers geopend met de kopieerknop ingedrukt; de melding gezocht, toets y ingedrukt, opnieuw gezocht, toets q ingedrukt, later nog eens gezocht
   - Waargenomen: De melding "Gekopieerd" stond er voor de toets y en stond er direct na y nog. Geen van beide toetsen veranderde iets. Bij een latere zoekactie, zonder nieuwe toets, was de melding weg. Ze verdwijnt dus vanzelf; de drie reacties in het dossier vielen samen met dat moment. Geen sneltoets.
   - Bewijs: `v-214-0025`, `v-214-0026`, `v-214-0027`, `v-214-0028`, `v-214-0029`, `v-214-0030`, `v-214-0039`
5. Onderzocht: Eigen steekproef op pagina's en in onderdelen die de beoordelaar niet zelf bekeek
   - Hoe: Toetsen ingedrukt op P09 (toegankelijkheidsverklaring: s / ? k m j 1 . g ,), in het feedbackvenster op P02 (niet-gevonden: s / ? k m j 1 .), in het zijmenu op smal scherm op P18 (fases: s / ? k m 2) en in het zoekvenster op P12 (richtlijn) met de focus buiten het zoekveld (s / ? k)
   - Waargenomen: 28 keer een toets ingedrukt, 28 keer veranderde er niets: geen tekst, geen venster, geen focus, geen adres. De vensters stonden daarna nog open. Gelijk aan het dossier.
   - Bewijs: `v-214-0004`, `v-214-0005`, `v-214-0006`, `v-214-0007`, `v-214-0008`, `v-214-0009`, `v-214-0010`, `v-214-0011`, `v-214-0012`, `v-214-0013`, `v-214-0015`, `v-214-0017`, `v-214-0018`, `v-214-0019`, `v-214-0020`, `v-214-0021`, `v-214-0022`, `v-214-0023`, `v-214-0024`, `v-214-0032`, `v-214-0033`, `v-214-0034`, `v-214-0035`, `v-214-0036`, `v-214-0037`, `v-214-0038`, `v-214-0042`, `v-214-0043`, `v-214-0044`, `v-214-0045`, `v-214-0046`

**Hoe zeker is dit oordeel**

Beoordelaar: Niet van toepassing. Verificatie, tevens eindoordeel: Niet van toepassing.

Poging om het oordeel onderuit te halen: Toetsen ingedrukt waar de beoordelaar niet zelf keek: P09, het feedbackvenster op de foutpagina P02, het zijmenu op smal scherm op P18 en het zoekvenster op P12 met de focus buiten het veld. 28 toetsen, geen reactie. De toets y bij de kopieerknop op P04 (door hem niet geprobeerd) liet de melding staan. Geen ingesloten vensters of video gevonden. Het oordeel blijft staan.

Grondslag: Beslisregel R4, procedure versie 8 (probe+oordeel).

Beperking van de procedure: Een sneltoets valt alleen op als er na de toets iets verandert dat de browser kan vastleggen: de focus, een onderdeel dat opent of verdwijnt, het adres of een melding. In spelers van een derde partij zijn de toetsen niet ingedrukt; daar is aan het adres van het venster afgelezen of de site de sneltoetsen heeft uitgezet, en alleen voor bekende spelers. Toetsen zijn ingedrukt in één browser (Chromium), op de pagina's en toestanden van de steekproef.

<a id="bijlage-2.2.1"></a>

### 2.2.1 Timing aanpasbaar

**Uitkomst:** ? Kan niet bepalen · [Terug naar het resultaat](#sc-2.2.1)

**Hoe is dit vastgesteld**

1. Onderzocht: Wat het dossier telt aan aanwijzingen voor een tijdslimiet
   - Hoe: Dossier: de tellingen, de timers en de beweging over alle 29 pagina's. De run mocht versturen.
   - Waargenomen: Op 29 van 29 pagina's: 0 keer een pagina die zichzelf ververst, 0 wachtwoordvelden, 62 keer een formulier aangetroffen (op alle 29 pagina's), 0 ingesloten objecten en 0 ingesloten vensters. Nul timers en nul lange wachttijden geteld. Geen bewegende inhoud. 279 keer een meldingsgebied en 86 keer een dialoogvenster aangetroffen, opgeteld over de pagina's.
   - Bewijs: `inventoryCounts`, `timing`, `motion`
2. Onderzocht: Verandert er vanzelf iets op de pagina
   - Hoe: Zelf beweging gemeten op P18 (fases), op P18 na het aanvinken van een vakje, op P01 (start) na het verbergen van de melding bovenaan, en op P21 (richtlijn). Op P13 gezocht naar een regel om te verversen, ingesloten vensters en wachtwoordvelden.
   - Waargenomen: Op P18 en P01 veranderde in ruim 7 seconden niets (0 van 5 beeldparen, beide methoden eens). Het vakje bleef aangevinkt. Op P21 zag één meting vlak na het schuiven een verschil in het zijmenu; de herhaling op dezelfde pagina zag niets (0 van 5). Op P13: 0 regels om te verversen, 0 ingesloten vensters, 0 wachtwoordvelden.
   - Bewijs: `v-221-0023`, `v-221-0027`, `v-221-0028`, `v-221-0032`, `v-221-0019`, `v-221-0021`, `v-221-0010`
3. Onderzocht: De knop Publiceren op P21
   - Hoe: Op P21 de knop Publiceren op de kaart Code.gov.nl gezocht en aangeklikt.
   - Waargenomen: De knop is uitgeschakeld: klikken lukt niet en er verschijnt geen melding. Er begint hier dus niets wat een tijdslimiet kan hebben.
   - Bewijs: `v-221-0014`, `v-221-0017`, `v-221-0018`
4. Onderzocht: Het feedbackformulier: wat voor formulier is het en blijft de foutmelding staan
   - Hoe: Op P29 (een ander paginatype dan de beoordelaar nam) het feedbackvenster geopend, leeg verstuurd via de knop Via e-mail, gekeken, bijna 7 seconden gemeten en opnieuw gekeken. Op P13 de code van het formulier gelezen.
   - Waargenomen: Het is geen zoekformulier: een \`form\` zonder \`action\` en \`method\`, met een keuzelijst en tekstvelden. De melding "Uw feedback is nog niet verstuurd" verscheen, is aan hulpsoftware gemeld en stond er na de meting nog; in die tijd veranderde niets. Of de site een sessie bijhoudt, is niet te zien.
   - Bewijs: `v-221-0012`, `v-221-0034`, `v-221-0035`, `v-221-0036`, `v-221-0037`, `v-221-0038`, `v-221-0039`
5. Onderzocht: Het venster Kubernetes cluster aanmaken: de inlogstap en het formulier
   - Hoe: Op P13 het venster geopend, de code gelezen, op de knop SSO Rijksoverheid geklikt, gekeken, 8,5 seconden gemeten en opnieuw gekeken. De code van het formulier gelezen.
   - Waargenomen: Na de klik kwam kort "Authenticeren met SSO Rijksoverheid..." en daarna het formulier, zonder dat er gegevens zijn gevraagd. Het formulier stond er na de meting nog precies zo (0 van 5 beeldparen veranderd). Het is een \`form\` zonder \`action\` en \`method\`, geen zoekformulier. Hoe lang deze inlog geldt, is niet te zien.
   - Bewijs: `v-221-0002`, `v-221-0003`, `v-221-0004`, `v-221-0006`, `v-221-0007`, `v-221-0008`, `v-221-0011`

**Hoe zeker is dit oordeel**

Beoordelaar: Kan niet bepalen. Verificatie, tevens eindoordeel: Kan niet bepalen.

Poging om het oordeel onderuit te halen: Gezocht naar een tijdslimiet waar de beoordelaar niet keek: de inlogstap van het clustervenster op P13 (klik op SSO, daarna gemeten), de uitgeschakelde knop Publiceren op P21, de afvinklijst op P18, de melding bovenaan P01 en het feedbackformulier op P29. Nergens verdween iets vanzelf. Beide formulieren zijn in de code geen zoekformulier, dus een goedkeuring kan niet; de twee open punten blijven.

Grondslag: Beslisregel R5, procedure versie 6 (inventaris).

Beperking van de procedure: Hoe lang een sessie op de server duurt en of de gebruiker voor het verlopen wordt gewaarschuwd, is niet vast te stellen: er wordt niet ingelogd en een meting duurt enkele seconden. Mag de run niet versturen, dan is ook een tijdslimiet die pas ingaat na het versturen (een melding na verzending, een chat na het eerste bericht) niet bekeken. Timers en meldingen zijn bekeken in één browser (Chromium), op de pagina's van de steekproef.

Open: 2 punten, zie [Nog uitzoeken](#open-2.2.1).

<a id="bijlage-2.2.2"></a>

### 2.2.2 Pauzeren, stoppen, verbergen

**Uitkomst:** ● Voldoet · Niveau A · EN 301 549: 9.2.2.2 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html) · [Terug naar het resultaat](#sc-2.2.2)

**Hoe is dit vastgesteld**

1. Onderzocht: Wat het dossier zegt over beweging, timers en ingesloten vensters
   - Hoe: Dossier: tellingen van beweging, timers en ingesloten vensters voor alle 29 pagina's in de begintoestand, één moment 1,5 seconde na het laden. Geopende onderdelen zijn in het dossier niet op beweging gemeten; die zijn bij de beoordeling en bij de controle zelf gemeten.
   - Waargenomen: Op 29 van 29 pagina's: 0 lopende animaties, 0 vanzelf spelende video's of geluiden, 0 keer marquee of blink, 0 keer canvas, 0 ingesloten objecten, 0 gif-afbeeldingen, 0 ingesloten vensters, 0 timers die zich herhalen en 0 pagina's die zichzelf verversen. De lijst met pagina's met beweging is leeg.
   - Bewijs: `motion`, `timing`, `inventoryCounts`
2. Onderzocht: Steekproef op pagina's en weergaven die de beoordelaar niet mat
   - Hoe: tg motion op P29 (huidige versie, ook na scrollen naar het eind), P11 (overzicht richtlijnen, donker schema) en P18 (fases, 320 pixels breed, 6 seconden); daarnaast gezocht naar laadtekens, video, geluid, ingesloten vensters, canvas en marquee
   - Waargenomen: Bij alle 4 metingen op 3 paginatypen melden beide methoden hetzelfde: 0 lopende animaties en 0 van 5 beeldparen veranderd. Op P29 en P11 is geen laadteken, video, geluid, ingesloten venster, canvas of marquee gevonden. Dat is gelijk aan het dossier en aan de 7 metingen van de beoordelaar op P01, P13, P09 en P02.
   - Bewijs: `v-222-0002`, `v-222-0005`, `v-222-0007`, `v-222-0016`, `v-222-0003`, `v-222-0008`, `b-222-0003`, `b-222-0020`, `b-222-0061`, `b-222-0053`
3. Onderzocht: Beweegt er iets als een onderdeel open staat
   - Hoe: tg motion over 6 seconden op P01 met het ingevulde feedbackformulier open en met een zoekopdracht in het zoekvenster; de beoordelaar mat elf bewaarde toestanden op P01, P13 en P14
   - Waargenomen: In beide toestanden melden beide methoden: 0 lopende animaties en 0 van 5 beeldparen veranderd. De elf metingen van de beoordelaar gaven hetzelfde.
   - Bewijs: `v-222-0012`, `v-222-0014`, `b-222-0009`, `b-222-0011`, `b-222-0013`, `b-222-0015`, `b-222-0024`, `b-222-0026`, `b-222-0067`
4. Onderzocht: Het laadteken in het venster voor een cluster op P13
   - Hoe: Op P13 het formulier in het clustervenster ingevuld, op de knop Cluster aanmaken geklikt, drie keer direct na elkaar gemeten (de laatste over 6 seconden) en daarna gekeken (tg click, tg motion, tg look)
   - Waargenomen: Na de klik verschijnt "Kubernetes cluster wordt aangemaakt...". Bij de eerste meting veranderen 3 van 5 beeldparen in 3,4 seconden; bij de tweede 0 van 5 en bij de derde 0 van 5 over 6 seconden. Daarna staat er "Cluster succesvol aangemaakt!". De beweging begint na een klik van de bezoeker, is een laadteken en stopt vanzelf binnen vijf seconden.
   - Bewijs: `v-222-0025`, `v-222-0026`, `v-222-0027`, `v-222-0028`, `v-222-0029`
5. Onderzocht: De melding na de knop Kopieer bij een codeblok op P04
   - Hoe: Niet opnieuw gemeten; overgenomen uit twee metingen van de beoordelaar direct na elkaar in de bewaarde toestand van de knop Kopieer
   - Waargenomen: Bij de eerste meting verandert 1 van 5 beeldparen bij het codeblok, bij de tweede 0 van 5. De melding begint na een klik van de bezoeker en verdwijnt vanzelf binnen enkele seconden.
   - Bewijs: `b-222-0069`, `b-222-0070`
6. Onderzocht: Is er een knop nodig om beweging stil te zetten
   - Hoe: Dossier: 88 rijen met bedieningselementen over 29 pagina's, afgezet tegen de eigen metingen
   - Waargenomen: Er is nergens beweging gevonden die vanzelf begint en langer dan vijf seconden doorgaat. Een knop om te pauzeren is daarom niet nodig.
   - Bewijs: `controls`, `v-222-0028`, `v-222-0016`

**Hoe zeker is dit oordeel**

Beoordelaar: Voldoet. Verificatie, tevens eindoordeel: Voldoet.

Poging om het oordeel onderuit te halen: Gemeten waar de beoordelaar niet keek: P29 (ook na scrollen), P11 in donker schema, P18 op 320 pixels, en P01 met feedbackformulier en zoekopdracht over 6 seconden. Nergens beweging; geen laadteken, video of ingesloten venster gevonden. Het clusterformulier op P13 zelf ingevuld en verstuurd: het laadteken stopt binnen 3,4 seconden en de volgende twee metingen zijn stil.

Grondslag: Beslisregel R2, procedure versie 6 (inventaris).

Beperking van de procedure: Beweging is gemeten over enkele seconden per meting, in één browser (Chromium). De veegronde dekt de pagina's van de steekproef; de beoordelaar heeft elk onderdeel dat kan bewegen één keer gemeten en de rest met een steekproef bevestigd. Beweging die pas later begint, is niet opgemerkt. Van een ingesloten venster dat bij het onderzoek niet te bedienen was, is de beweging alleen van buitenaf bekeken, en van een video zijn alleen de duur en stilstaande beelden uit het bestand bekeken, niet het afspelen in de speler.

<a id="bijlage-2.3.1"></a>

### 2.3.1 Drie flitsen of beneden drempelwaarde

**Uitkomst:** ● Voldoet · Niveau A · EN 301 549: 9.2.3.1 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html) · [Terug naar het resultaat](#sc-2.3.1)

**Hoe is dit vastgesteld**

1. Onderzocht: Dekking in het dossier: staat er inhoud op de site die kan flitsen
   - Hoe: Dossier: de tellingen over alle pagina's en de meting van beweging 1,5 seconde na het laden, met beweging toegestaan
   - Waargenomen: 29 van 29 pagina's onderzocht, niets ontbreekt. Aangetroffen: 0 keer video, 0 keer canvas, 0 keer media die vanzelf speelt, 0 keer marquee of blink, 0 keer lopende animatie, 0 keer object of embed. Beweging: 0 lopende animaties, 0 bewegende plaatjes, 0 media die vanzelf speelt, 0 keer marquee of blink. Er zijn 0 ingesloten vensters.
   - Bewijs: `inventoryForApplicability`, `motion`, `inventoryCounts`
2. Onderzocht: Steekproef op de vier paginatypen die de eerste beoordelaar niet zelf mat
   - Hoe: Verse pagina geopend en beweging gemeten op P06 (copyright), P10 (versies), P20 (integratie) en P26 (toegankelijkheid); daarna gezocht naar video, geluid, canvas, marquee, blink, ingesloten venster, object en embed
   - Waargenomen: Op alle vier de pagina's meldden beide methoden hetzelfde: 0 lopende animaties en 0 van 5 beeldparen veranderd. Dat is gelijk aan het dossier. Het zoeken gaf op elke pagina 0 elementen.
   - Bewijs: `v-231-0003`, `v-231-0004`, `v-231-0006`, `v-231-0007`, `v-231-0009`, `v-231-0010`, `v-231-0012`, `v-231-0013`
3. Onderzocht: Beweegt er iets in het donkere schema, op een smal scherm of in een geopend onderdeel
   - Hoe: Beweging gemeten op P01 in het donkere schema over 6 seconden, op P14 op 320 pixels breed, op P13 na het doorlopen van het proefformulier en op P01 met het menu open op een smal scherm
   - Waargenomen: In alle vier de toestanden meldden beide methoden 0 lopende animaties en 0 van 5 beeldparen veranderd.
   - Bewijs: `v-231-0033`, `v-231-0035`, `v-231-0037`, `v-231-0039`
4. Onderzocht: Het laadteken in het venster voor het cluster op P13
   - Hoe: Het venster geopend, de inlogknop aangeklikt, beweging gemeten en gekeken; daarna opnieuw geopend, geklikt en direct gekeken
   - Waargenomen: Direct na de klik staat er een ring van 32 bij 32 pixels met een regel tekst eronder. Kort daarna staat op die plek het formulier. Het beeld veranderde één keer: 1 van 5 beeldparen in 3,5 seconden, in een vlak van 528 bij 686 pixels. De browser gaf geen animatie op. Eén wissel van laadteken naar formulier is geen flits, en de ring zelf is veel kleiner dan 341 bij 256 pixels.
   - Bewijs: `v-231-0016`, `v-231-0017`, `v-231-0019`, `v-231-0022`, `v-231-0023`
5. Onderzocht: De melding na het kopiëren van een codeblok op P04
   - Hoe: De toestand met de kopieerknop geopend, gekeken, twee keer beweging gemeten en opnieuw gekeken
   - Waargenomen: Na de klik staat er een kleine melding van 83 bij 26 pixels bij de knop. Zij verdwijnt één keer: 1 van 5 beeldparen veranderde, in een vlak van 119 bij 26 pixels. Bij de tweede meting stond het beeld stil (0 van 5 beeldparen) en bij het tweede kijken was de melding weg. Eén keer verdwijnen is geen flits, en het vlak is veel kleiner dan 341 bij 256 pixels.
   - Bewijs: `v-231-0028`, `v-231-0029`, `v-231-0030`, `v-231-0031`

**Hoe zeker is dit oordeel**

Beoordelaar: Voldoet. Verificatie, tevens eindoordeel: Voldoet.

Poging om het oordeel onderuit te halen: Gemeten waar de beoordelaar niet zelf mat: de paginatypen copyright, versies, integratie en toegankelijkheid, het donkere schema over 6 seconden, 320 pixels breed, het doorlopen proefformulier en het smalle menu. Overal 0 animaties en 0 van 5 beeldparen veranderd; zoeken naar video, canvas, marquee, blink en ingesloten vensters gaf 0. Het laadteken en de kopieermelding nagemaakt: elk één wissel, op een klein vlak. Geen tegenvoorbeeld gevonden.

Grondslag: Beslisregel R2, procedure versie 7 (inventaris).

Beperking van de procedure: De flitsmeting van een video is een benadering van de drempel van de norm en geen gecertificeerde analyse: geteld zijn de wisselingen in helderheid per deel van het beeld in het drukste venster van een seconde, het oppervlak is genomen als aandeel van het beeld en niet van het gezichtsveld, en rode flitsen zijn niet apart gemeten. Van een bestand is hooguit de eerste 10 minuten of 200 MB gemeten. Van andere content is over enkele seconden gemeten of ze beweegt. Video die niet als bestand op te halen is (streaming, een blob-adres), is niet gemeten, ook niet in een speler in een ingesloten venster.

<a id="bijlage-2.4.1"></a>

### 2.4.1 Blokken omzeilen

**Uitkomst:** ● Voldoet · Niveau A · EN 301 549: 9.2.4.1 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/bypass-blocks.html) · [Terug naar het resultaat](#sc-2.4.1)

**Hoe is dit vastgesteld**

1. Onderzocht: Of elke pagina een link heeft om de kop en het menu over te slaan, en of die link werkt
   - Hoe: Dossier, onderdeel bypass.pages: 29 rijen voor 29 pagina's, 1280 pixels breed. De legenda heeft geen ingesloten vensters, dus er is geen venster overgeslagen. Het sitemodel noemt geen blokkades.
   - Waargenomen: Op 29 van de 29 pagina's is de eerste Tab-stap de link "Ga direct naar de inhoud". Na Enter is de volgende Tab-stap op alle 29 pagina's een element in het hoofdgebied. Het doel van de link bestaat op alle 29 pagina's en wordt weergegeven. De focus zelf blijft na Enter leeg; de volgende Tab-stap beslist.
   - Bewijs: `bypass`
2. Onderzocht: Eigen steekproef: de eerste vijf Tab-stappen op drie pagina's van drie paginatypen die de eerste beoordelaar niet bekeek
   - Hoe: Verse pagina geopend en de eerste vijf Tab-stappen gelopen op P29 (huidige-versie) en P10 (versies), 1280 pixels breed, en op P04 (bijdragen), 320 pixels breed.
   - Waargenomen: Op 3 van de 3 pagina's is de eerste stap de link "Ga direct naar de inhoud". Daarna volgen het logo en de naam van de site, en dan de menulinks (1280 breed) of de knoppen Menu en Zoeken (320 breed). De vier methoden zijn het eens. Dit klopt met het dossier.
   - Bewijs: `v-241-0002`, `v-241-0009`, `v-241-0017`
3. Onderzocht: Eigen steekproef: de link activeren met Enter en kijken waar de volgende Tab-stap staat
   - Hoe: Op een verse pagina één keer Tab, dan Enter, dan één keer Tab; daarna de pagina bekeken en de code van het element met focus gelezen. Gedaan op P29 en P10 (1280 breed) en P04 (320 breed).
   - Waargenomen: Op 3 van de 3 pagina's staat de volgende stap in de inhoud, na de hoofdkop. P29: de link "Versies" onder de kop "Huidige versie". P04 op 320 breed: de link "Inhoudsopgave" in de eerste alinea. P10: de link "0.3.7" onder de eerste tussenkop; het zijmenu met 8 links en de lijst met links naar onderdelen van de pagina zijn overgeslagen. Zelfde uitkomst als het dossier.
   - Bewijs: `v-241-0004`, `v-241-0005`, `v-241-0006`, `v-241-0007`, `v-241-0011`, `v-241-0012`, `v-241-0013`, `v-241-0014`, `v-241-0015`, `v-241-0019`, `v-241-0020`, `v-241-0021`, `v-241-0022`, `v-241-0025`
4. Onderzocht: Of de link naar een bestaand doel wijst, en wat de automatische regels zeggen
   - Hoe: Op P10 de code van de link gelezen, het doel gezocht en de vier regel-engines gedraaid voor dit criterium.
   - Waargenomen: De link heeft \`href="\#content"\` en er is precies één element met dat id: het blok met de tekst van de pagina. Twee engines keuren goed; één keurt af omdat ze de link "0.3.7" voor het eerste bedieningselement houdt. Dat klopt niet: de link om over te slaan staat in een webcomponent en is in de Tab-volgorde de eerste stap.
   - Bewijs: `v-241-0023`, `v-241-0024`, `v-241-0026`, `v-241-0029`, `v-241-0031`, `v-241-0017`
5. Onderzocht: Of gebruikers van hulpsoftware ook langs gebieden en koppen bij de inhoud komen
   - Hoe: Dossier, onderdelen bypass.pages, landmarks en headings, voor alle 29 pagina's.
   - Waargenomen: 29 van de 29 pagina's hebben een hoofdgebied; de lijst met pagina's zonder hoofdgebied is leeg. Elke pagina heeft precies één hoofdkop en er staat geen kop vóór. Op 27 van de 29 pagina's staat het zijmenu of de kop van de startpagina binnen het hoofdgebied; de link om over te slaan gaat daar voorbij, dus dit is hier geen fout.
   - Bewijs: `bypass`, `landmarks`, `headings`

**Hoe zeker is dit oordeel**

Beoordelaar: Voldoet. Verificatie, tevens eindoordeel: Voldoet.

Poging om het oordeel onderuit te halen: Drie paginatypen genomen die de beoordelaar niet bekeek (P29, P10, P04), waarvan P04 op 320 pixels breed, waar het menu achter een knop zit. Overal is de link de eerste Tab-stap en staat de stap na Enter in de inhoud. Het doel van de link bestaat. Eén regel-engine keurde af; dat bleek een vergissing van de engine. Geen tegenvoorbeeld gevonden.

Grondslag: Beslisregel R3, procedure versie 6 (probe+oordeel).

Beperking van de procedure: De skiplink is met het toetsenbord geactiveerd in één browser (Chromium), op de pagina's van de steekproef en niet op elke pagina van de site. Hoe een schermlezer de oriëntatiepunten en koppen aanbiedt, is afgeleid uit de code en niet getest met een echte schermlezer. Of de skiplink zichtbaar wordt als hij focus krijgt, valt onder 2.4.7.

<a id="bijlage-2.4.2"></a>

### 2.4.2 Paginatitel

**Uitkomst:** ● Voldoet · Niveau A · EN 301 549: 9.2.4.2 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/page-titled.html) · [Terug naar het resultaat](#sc-2.4.2)

**Hoe is dit vastgesteld**

1. Onderzocht: Of elke pagina een titel heeft en of een titel op meer dan één pagina staat
   - Hoe: Dossier: de lijst met titels van alle 29 pagina's, de lege en de dubbele titels en de regel-engines. Zelf de engines gedraaid op P10.
   - Waargenomen: 29 van 29 pagina's hebben een titel; 0 lege en 0 dubbele titels. Twee engines keuren op alle 29 pagina's goed dat er een titel is. Op P10 zelf gemeten: vier engines zijn het eens, geen fout. Er zijn geen ingesloten vensters en geen documenten in de steekproef.
   - Bewijs: `titles`, `engine`, `v-242-0014`
2. Onderzocht: Of elke titel het onderwerp van de pagina noemt, meer is dan de naam van de site en geen resten van een sjabloon bevat
   - Hoe: Dossier: elke rij van de lijst met titels naast de hoofdkop en het adres van de pagina.
   - Waargenomen: 28 van de 29 titels hebben de vorm onderwerp, streepje, naam van de site, zoals "Cookies - NeRDS: Nederlandse Richtlijn Digitale Systemen" bij hoofdkop "Cookies". Alleen de startpagina (1 pagina) heeft alleen de naam van de site. Op 13 pagina's wijkt het onderwerp in de titel af van de hoofdkop, maar gaat het over hetzelfde, zoals "7. Privacy - NeRDS: Nederlandse Richtlijn Digitale Systemen" bij "7. Maak privacy integraal". Geen losse tekens of lege plekken.
   - Bewijs: `titles`, `v-242-0004`
3. Onderzocht: Steekproef: past de titel bij wat de pagina toont, op paginatypen die de beoordelaar niet bekeek
   - Hoe: Zelf gekeken op P14 (fases bij cloud, breed scherm), P29 (huidige versie, 320 pixels breed), P10 (versies, donker schema) en een tweede adres dat niet bestaat, dieper in de site.
   - Waargenomen: Op alle vier past de titel. P14 toont de kop "Cloud: wanneer doe je wat?" en heeft die tekst in de titel. P29 toont "Huidige versie", P10 toont "Versies"; de titels zijn verschillend. Het adres dat niet bestaat geeft de titel "Pagina niet gevonden - NeRDS: Nederlandse Richtlijn Digitale Systemen" bij de kop "Deze pagina bestaat niet". De titels zijn gelijk aan die in het dossier.
   - Bewijs: `v-242-0002`, `v-242-0008`, `v-242-0012`, `v-242-0010`
4. Onderzocht: Of de titel meegaat als de bezoeker binnen de site van pagina wisselt
   - Hoe: Zelf op P14 op een link in het zijmenu geklikt, gekeken, teruggegaan en weer gekeken. Daarna op P01 in het zoekvenster met de zoekwaarde op een resultaat geklikt en gekeken.
   - Waargenomen: De titel volgt steeds de pagina. Na de klik op de link naar privacy is de titel "7. Privacy - NeRDS: Nederlandse Richtlijn Digitale Systemen"; na teruggaan weer die van P14. Na de klik op een zoekresultaat is de titel "Toegankelijkheid: wanneer doe je wat? - NeRDS: Nederlandse Richtlijn Digitale Systemen", passend bij de pagina die opent.
   - Bewijs: `v-242-0003`, `v-242-0004`, `v-242-0005`, `v-242-0006`, `v-242-0017`, `v-242-0018`, `v-242-0019`
5. Onderzocht: De titel van de pagina na het versturen van een formulier
   - Hoe: Waarnemingen van de beoordelaar gelezen: hij verstuurde het proefformulier op P13 en het feedbackformulier op P01 en drukte Enter in het zoekvenster. Niet zelf herhaald.
   - Waargenomen: In alle drie de gevallen blijft de bezoeker op dezelfde pagina met dezelfde titel; de melding staat in het venster zelf. Er komt geen nieuwe pagina met een eigen titel. De knop naar GitHub in het feedbackformulier leidt naar een andere site en valt buiten dit onderzoek.
   - Bewijs: `b-242-0028`, `b-242-0029`, `b-242-0040`, `b-242-0041`, `b-242-0044`, `b-242-0045`

**Hoe zeker is dit oordeel**

Beoordelaar: Voldoet. Verificatie, tevens eindoordeel: Voldoet.

Poging om het oordeel onderuit te halen: Gezocht naar een tegenvoorbeeld waar de beoordelaar niet keek: drie andere paginatypen (P14, P29 op 320 pixels, P10 in donker schema), een tweede niet-bestaand adres dieper in de site, wisselen van pagina via een menulink en terug, en een klik op een zoekresultaat. Overal past de titel bij de pagina en volgt ze de wissel. De engines op P10 melden geen fout. Geen kandidaten, vensters of documenten. Niets gevonden.

Grondslag: Beslisregel R5, procedure versie 8 (engine+oordeel).

Beperking van de procedure: Van documenten (pdf en kantoorbestanden) is de titel in de eigenschappen van het bestand gelezen, voor de documenten van de steekproef die zijn ingelezen. De titel van een pagina die pas na het versturen van een formulier verschijnt (een bevestiging, een foutpagina), is alleen gezien als de run mag versturen (een testomgeving). Beoordeeld zijn de pagina's van de steekproef, niet elke pagina van de site.

<a id="bijlage-2.4.3"></a>

### 2.4.3 Focus volgorde

**Uitkomst:** ✕ Voldoet niet · [Terug naar het resultaat](#sc-2.4.3)

**Hoe is dit vastgesteld**

1. Onderzocht: Een link naar een hoofdstuk in het geopende zijmenu op P04, 360 pixels breed
   - Hoe: Verse pagina met het zijmenu open, focus op de link Code of Conduct, Enter, gekeken, Escape, gekeken, één keer Tab
   - Waargenomen: Na Enter schuift de pagina achter het venster van 0 naar 1889; het venster blijft open. Na Escape staat de focus op de knop Over NeRDS, die dan niet in beeld is; in beeld staat het gekozen hoofdstuk. De volgende Tab komt op de link Inhoudsopgave bovenaan en de pagina schuift terug van 1889 naar 73.
   - Bewijs: `v-243-0027`, `v-243-0028`, `v-243-0030`, `v-243-0031`, `v-243-0032`, `v-243-0033`, `v-243-0034`, `v-243-0035`
2. Onderzocht: Dezelfde link op een ander paginatype: P12, 320 pixels breed
   - Hoe: Verse pagina, zijmenu geopend met Enter, focus op de link Hoe pas je het toe?, Enter, gekeken, Escape, één keer Tab, gekeken
   - Waargenomen: Na Enter schuift de pagina van 0 naar 1571 en blijft het venster open. Na Escape staat de focus op de knop Richtlijnen, niet op het hoofdstuk. Hier komt de volgende Tab toevallig wel in het gekozen hoofdstuk, omdat de eerste link van de inhoud daar staat. De oorzaak is dezelfde als op P04.
   - Bewijs: `v-243-0036`, `v-243-0040`, `v-243-0043`, `v-243-0044`, `v-243-0045`, `v-243-0046`, `v-243-0047`, `v-243-0048`, `v-243-0050`
3. Onderzocht: De focus na het kiezen van een manier van inloggen in het venster voor het cluster op P13
   - Hoe: Venster open, focus op de knop SSO Rijksoverheid, Enter, gekeken tijdens het laden en daarna, Tab
   - Waargenomen: De knop met de focus verdwijnt en na het laden verschijnt het formulier; geen element heeft dan de focus. Tab loopt daarna in leesvolgorde: Sluit, Terug, Organisatie. De focus blijft in het venster, komt niet op iets verborgens en slaat niets over.
   - Bewijs: `v-243-0002`, `v-243-0003`, `v-243-0005`, `v-243-0006`, `v-243-0007`, `v-243-0008`, `v-243-0009`, `v-243-0010`
4. Onderzocht: De focus na het verbergen van de melding bovenaan P01
   - Hoe: Verse pagina, focus op de knop in de melding, Enter, twee keer Tab, gekeken
   - Waargenomen: De melding verdwijnt met de knop die de focus had. De eerste Tab komt op de eerstvolgende link in de inhoud en de tweede op de link daarna. Er wordt niets overgeslagen en de focus springt niet terug naar het begin.
   - Bewijs: `v-243-0011`, `v-243-0014`, `v-243-0015`, `v-243-0016`, `v-243-0017`
5. Onderzocht: De knop Link toevoegen in het feedbackvenster op P26
   - Hoe: Feedbackvenster geopend met Enter, focus op de knop, Enter, gekeken, één keer achteruit getabd
   - Waargenomen: Het nieuwe veld komt direct boven de knop; de focus blijft op de knop en één keer achteruit tabben komt op het nieuwe veld. Voor de volgorde is dat geen fout. Het antwoord toont geen melding dat er een veld bij is gekomen: hoort bij criterium 4.1.3.
   - Bewijs: `v-243-0018`, `v-243-0022`, `v-243-0023`, `v-243-0024`, `v-243-0025`, `v-243-0026`
6. Onderzocht: De volgorde van de Tab-stops op alle pagina's volgens het dossier en de steekproef van de beoordelaar
   - Hoe: Dossier gelezen; na een afkeuring zijn de goedgekeurde onderdelen niet opnieuw gemeten
   - Waargenomen: Dossier: 29 van 29 pagina's volledig doorlopen, 1269 Tab-stops, één sprong omhoog op P04 en één op P10, geen stop buiten beeld of op iets onzichtbaars, niets overgeslagen, geen positieve tabindex, 9 knoppen geactiveerd. De beoordelaar vond in zijn steekproef dezelfde volgorde.
   - Bewijs: `keyboard`, `dialogs`, `engine`, `b-243-0002`, `b-243-0009`, `b-243-0042`

**Hoe zeker is dit oordeel**

Beoordelaar: Voldoet niet. Verificatie, tevens eindoordeel: Voldoet niet.

Grondslag: Beslisregel R3, procedure versie 9 (probe+oordeel).

Beperking van de procedure: De veegronde mat de focusvolgorde in één browser (Chromium), op de pagina's en toestanden van de steekproef, niet op elke pagina in elke toestand. Waar de beoordelaar de Tab-volgorde zelf mat, is die herhaald in WebKit en Firefox als die beschikbaar waren. Waar de focus heen gaat nadat een formulier is verstuurd, is alleen gemeten als de run mag versturen (een testomgeving). De volgorde binnen een ingesloten venster dat bij het onderzoek niet laadde of niet te bedienen was, is niet beoordeeld.

<a id="bijlage-2.4.4"></a>

### 2.4.4 Linkdoel (in context)

**Uitkomst:** ● Voldoet · Niveau A · EN 301 549: 9.2.4.4 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html) · [Terug naar het resultaat](#sc-2.4.4)

**Hoe is dit vastgesteld**

1. Onderzocht: Of het dossier alle links dekt en wat de vlaggen zeggen
   - Hoe: Dossier: links en engine gelezen, alle 259 rijen met een vlag beoordeeld en alle 311 regels zonder vlag doorgelezen; regel-engines zelf gedraaid op P02
   - Waargenomen: 1666 links onderzocht op 29 pagina's, 570 unieke links: 259 met een vlag en 311 zonder. 176 rijen met dezelfde naam en een andere bestemming, 86 rijen die een nieuw venster openen en 1 rij met een algemene linktekst. Geen link zonder naam. Geen naam belooft iets anders dan de bestemming.
   - Bewijs: `links`, `engine`, `v-244-0163`, `v-244-0164`
2. Onderzocht: Twee links met dezelfde naam en een andere bestemming op dezelfde pagina
   - Hoe: P03, begintoestand: tg find, tg name en tg ax op beide links en tg ax van het navigatiegebied
   - Waargenomen: Alleen op P03 staat zo'n paar in de begintoestand: twee links "Huidige versie". De ene staat in het navigatiegebied "Op deze pagina" en springt naar het hoofdstuk. De andere staat in de zin "Welke build er nu draait staat op de pagina Huidige versie." en gaat naar een andere pagina. Het gebied en de zin geven het verschil.
   - Bewijs: `links`, `v-244-0037`, `v-244-0038`, `v-244-0043`, `v-244-0044`, `v-244-0046`, `v-244-0049`
3. Onderzocht: Links met een korte of technische naam: is het doel duidelijk uit de zin of lijstregel
   - Hoe: tg name en tg ax op P17, P04, P06 en P10; het antwoord drukt de zin om de link af
   - Waargenomen: De link "hier" op P17 staat in een lijstregel die zegt dat rijksambtenaren daar ISO-normen raadplegen. De links "Issue" en "Issues" op P04, "LICENSE.md" op P06 en "\#444", "a63e9e0" en "463ca44" op P10 staan elk in een zin of lijstregel die het doel noemt. De link "0.3.7" staat in de kop van die versie.
   - Bewijs: `links`, `v-244-0015`, `v-244-0016`, `v-244-0054`, `v-244-0055`, `v-244-0064`, `v-244-0088`, `v-244-0089`, `v-244-0090`, `v-244-0091`, `v-244-0096`
4. Onderzocht: Zoekresultaten met dezelfde titel in het geopende zoekvenster
   - Hoe: P01 in de toestand process-zoeken en P17 na zelf zoeken: tg look, tg name, tg ax, tg html en tg rules
   - Waargenomen: De naam van elk resultaat is de titel plus het tekstfragment eronder. De drie resultaten met de titel "3. Testen, meten en verbeteren" hebben daardoor elk een andere naam en gaan naar drie richtlijnen. Hulpsoftware krijgt hetzelfde als wat op het scherm staat. Eén methode en één engine zagen geen naam; twee browsers en de code laten de naam wel zien.
   - Bewijs: `site-states/process-zoeken/facts.json`, `v-244-0003`, `v-244-0004`, `v-244-0005`, `v-244-0006`, `v-244-0007`, `v-244-0008`, `v-244-0009`, `v-244-0028`, `v-244-0029`, `v-244-0030`, `v-244-0031`, `v-244-0032`, `v-244-0166`
5. Onderzocht: Links in de uitklappers Praktische tips, in de menu's op een smal scherm en in de vensters voor feedback en het cluster
   - Hoe: P21, P26 en P13: alle uitklappers geopend met tg click, daarna tg find en tg ax. P09 op 320 pixels breed: menu en zijmenu geopend, tg look. P17 en P13: vensters geopend, tg look
   - Waargenomen: Zelf geopend en geteld: 18 links in de uitklappers op P21, 18 op P26 en 14 op P13. Van 18 nagemeten links noemt de naam of de lijstregel het doel. Het menu toont 3 links en het zijmenu 8, elk met een eigen naam. In het feedbackvenster en het clustervenster staan geen links.
   - Bewijs: `site-states/component-praktische-tips/facts.json`, `v-244-0022`, `v-244-0072`, `v-244-0077`, `v-244-0104`, `v-244-0105`, `v-244-0106`, `v-244-0107`, `v-244-0108`, `v-244-0109`, `v-244-0110`, `v-244-0111`, `v-244-0112`, `v-244-0113`, `v-244-0120`, `v-244-0121`, `v-244-0122`, `v-244-0123`, `v-244-0124`, `v-244-0125`, `v-244-0146`, `v-244-0148`, `v-244-0157`, `v-244-0158`, `v-244-0159`, `v-244-0160`, `v-244-0161`
6. Onderzocht: Steekproef: kloppen de namen in het dossier, ook van links zonder eigen zichtbare tekst en van de link om het logo
   - Hoe: P01, P29 en P02: tg look, tg name, tg ax en tg html; P09 op 320 pixels breed: tg name en tg crop
   - Waargenomen: Op P01 staan 41 links, op P29 21 en op P02 20; de namen zijn gelijk aan het dossier. De link over de eerste kaart heet "1. Stel gebruikersbehoeften vast". De link om het logo heet "Nederlandse Digitale Dienst Ministerie van Economische Zaken en Klimaat" en gaat naar de startpagina. Op 320 pixels breed houdt de link met alleen een pictogram de naam "GitHub".
   - Bewijs: `links`, `v-244-0131`, `v-244-0133`, `v-244-0134`, `v-244-0138`, `v-244-0139`, `v-244-0140`, `v-244-0142`, `v-244-0143`, `v-244-0163`, `v-244-0067`, `v-244-0068`, `v-244-0069`

**Hoe zeker is dit oordeel**

Beoordelaar: Voldoet. Verificatie, tevens eindoordeel: Voldoet.

Poging om het oordeel onderuit te halen: Elke weggezette kandidaat is opnieuw gemeten. Daarna gezocht waar de beoordelaar niet keek: het zoekvenster op een tweede pagina (P17), het feedbackvenster, beide stappen van het clustervenster, de uitklappers op P13, menu en zijmenu op 320 pixels op P09, de foutpagina P02 en P29. Ook alle links in dichte uitklappers op naam en bestemming vergeleken. Geen link zonder naam, geen misleidende naam en geen paar zonder verschil in de context gevonden.

Grondslag: Beslisregel R5, procedure versie 8 (engine+oordeel).

Beperking van de procedure: Waar een link heen leidt, is beoordeeld aan het adres; niet elke link is gevolgd. Beoordeeld zijn de links op de pagina's en in de toestanden van de steekproef, niet op elke pagina van de site. Wat hulpsoftware bij een link voorleest, is afgeleid uit de toegankelijke naam en niet getest met een echte schermlezer.

<a id="bijlage-2.4.5"></a>

### 2.4.5 Meerdere manieren

**Uitkomst:** ● Voldoet · [Terug naar het resultaat](#sc-2.4.5)

**Hoe is dit vastgesteld**

1. Onderzocht: Welke pagina's tellen mee en welke manieren biedt de site
   - Hoe: Dossier: de legenda, de links in kop, menu's en voet per pagina en alle links, op alle 29 pagina's (de hele site).
   - Waargenomen: 28 van de 29 pagina's tellen mee; P02 is een foutpagina. Geen pagina is een stap in een proces. Het hoofdmenu, de hulplinks met de knop Zoeken en de voet zijn op alle 29 pagina's gelijk. Een zijmenu staat op 26 pagina's, een kruimelpad op 26 pagina's. Doorzocht: 570 verschillende links, 1666 keer aangetroffen.
   - Bewijs: `consistency`, `landmarks`, `links`
2. Onderzocht: Werkt de zoekfunctie, ook op een andere pagina en op een smal scherm
   - Hoe: Op P29 (breed scherm) en op P07 (320 pixels breed, donker schema) de knop Zoeken aangeklikt, de vaste testwaarde getypt en gekeken. Op P29 een resultaat aangeklikt.
   - Waargenomen: Het zoekvenster opent met de tekst "Je zoekt in alle richtlijnen en pagina's." Na het typen van \`test\` verschijnt op beide pagina's de melding "De eerste 20 van 30 resultaten" met een lijst links. Een klik op een resultaat opent de pagina Over NeRDS (P03).
   - Bewijs: `v-245-0004`, `v-245-0007`, `v-245-0008`, `v-245-0010`, `v-245-0013`, `v-245-0031`, `v-245-0033`, `v-245-0034`, `v-245-0035`
3. Onderzocht: Is P29, die in geen menu staat, op twee manieren te bereiken
   - Hoe: Op P29 gekeken welke menu's er staan. Op P03 de link naar P29 gezocht, de code gelezen en gekeken waar hij staat.
   - Waargenomen: P29 heeft het hoofdmenu en de knop Zoeken, maar geen zijmenu en geen kruimelpad. Op P03 staat onder de kop "Huidige versie" in de tekst een link "Huidige versie" naar \`../version/\`. Het dossier noemt dezelfde link ook in de tekst van P04. Zoeken werkt op P29 zelf.
   - Bewijs: `v-245-0003`, `v-245-0014`, `v-245-0015`, `v-245-0017`, `links`
4. Onderzocht: Steekproef: staan de menu's er op andere paginatypen en op een smal scherm
   - Hoe: Gekeken op P29 (huidige versie, breed), P18 (fases, 320 pixels breed) en P07 (tekstpagina, 320 pixels breed, donker). Op P18 het menu en het zijmenu geopend.
   - Waargenomen: Op P29 staan Home, Richtlijnen en Over NeRDS in het hoofdmenu. Op P18 toont het geopende menu dezelfde drie links en het geopende zijmenu de links naar de richtlijnen en hun fasepagina's; er is ook een kruimelpad. Op P07 staan de knoppen Menu, Zoeken en Over NeRDS, een kruimelpad en de voet met een link naar de pagina zelf.
   - Bewijs: `v-245-0003`, `v-245-0019`, `v-245-0022`, `v-245-0025`, `v-245-0026`, `v-245-0029`

**Hoe zeker is dit oordeel**

Beoordelaar: Voldoet. Verificatie, tevens eindoordeel: Voldoet.

Poging om het oordeel onderuit te halen: Gezocht naar een pagina met maar één manier. P29 staat in geen menu: de link in de tekst van P03 zelf opgezocht en het zoeken op P29 zelf uitgeprobeerd; het geeft 30 resultaten en een resultaat opent een pagina. Daarna andere paginatypen op 320 pixels en in het donkere schema bekeken (P18, P07): menu, zijmenu, kruimelpad en zoeken staan en werken er ook. Geen tegenvoorbeeld gevonden.

Grondslag: Beslisregel R2, procedure versie 5 (oordeel).

Beperking van de procedure: Is de steekproef kleiner dan de hele site, dan kunnen er links naar een pagina staan op pagina's die niet zijn bekeken. De zoekfunctie is uitgeprobeerd met één vaste testwaarde; of zoeken elke pagina van de site vindt, is niet aangetoond. Een zoekfunctie die haar vraag met een POST verstuurt, is alleen uitgeprobeerd als de run mag versturen (een testomgeving).

Open: 1 punt, zie [Nog uitzoeken](#open-2.4.5).

<a id="bijlage-2.4.6"></a>

### 2.4.6 Koppen en labels

**Uitkomst:** ● Voldoet · Niveau AA · EN 301 549: 9.2.4.6 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels.html) · [Terug naar het resultaat](#sc-2.4.6)

**Hoe is dit vastgesteld**

1. Onderzocht: Of elke kop een tekst heeft en zegt waar het stuk eronder over gaat
   - Hoe: Dossieronderdelen headings en screenshots (alle 29 pagina's, 12 schermafbeeldingen); zelf tg look op P29, P05, P10, P02, P11, P01 en P22 (320 pixels breed) en de koppen naast het dossier gelegd
   - Waargenomen: Het dossier telt 559 koppen op 29 pagina's en nergens een lege kop. Op de zeven zelf bekeken pagina's zijn de koppen gelijk aan het dossier en passen ze bij de tekst eronder, zoals 'Huidige versie' boven het versienummer en 'Ontwikkeling' boven de stand van de richtlijnen. Herhaalde koppen als 'Verbeterd' en 'Doel' staan steeds onder een andere bovenliggende kop.
   - Bewijs: `headings`, `screenshots`, `v-246-0057`, `v-246-0060`, `v-246-0078`, `v-246-0083`, `v-246-0045`, `v-246-0091`, `v-246-0075`
2. Onderzocht: Of de zichtbare labels van velden en de teksten van knoppen het doel beschrijven
   - Hoe: Dossieronderdelen forms (79 rijen, zonder vastgelegd zichtbaar label) en controls (15 rijen met knoppen, 13 met zichtbare tekst); zelf tg look in het feedbackvenster op P06, het proefformulier op P13 en de afvinklijst op P22
   - Waargenomen: Feedbackvenster: vier velden met een passend label, zoals 'Soort feedback' en 'Uw feedback'. Proefformulier: zes velden, zoals 'Organisatie' en 'Naam van het cluster'. De 20 selectievakjes op P22 hebben elk een eigen zin als label. Knoppen als 'Zoeken', 'Feedback', 'Link toevoegen' en 'Cluster aanmaken' zeggen wat ze doen.
   - Bewijs: `forms`, `controls`, `v-246-0003`, `v-246-0064`, `v-246-0066`, `v-246-0075`
3. Onderzocht: De twee linkvelden en de verzendknoppen in het feedbackvenster
   - Hoe: tg open P06 met het feedbackvenster open, tg click op 'Link toevoegen', tg look, het formulier ingevuld en tg click op 'Via e-mail'
   - Waargenomen: Na 'Link toevoegen' staan er twee velden 'Link naar een relevant document'; ze vragen hetzelfde. De knoppen 'Via e-mail' en 'Via GitHub Issues' staan onder de kop 'Feedback geven' en een inleiding die beide manieren noemt. Na 'Via e-mail' verscheen 'Bedankt voor uw feedback!'.
   - Bewijs: `v-246-0003`, `v-246-0004`, `v-246-0005`, `v-246-0013`, `v-246-0016`, `v-246-0017`
4. Onderzocht: Koppen en knoppen in geopende onderdelen, op smal scherm en na het versturen; ingesloten vensters
   - Hoe: tg look in het zijmenu op P04 en P18 en het hoofdmenu op P18 (320 pixels breed), in het zoekvenster met resultaten op P01 (donker), in het proefvenster op P14 en P13 voor en na versturen; tg find tag:iframe op P01, P04, P11 en P29
   - Waargenomen: Elk venster heeft een kop die zegt wat het is: 'Over NeRDS', 'Richtlijnen', 'Menu', 'Zoeken' en 'Kubernetes cluster aanmaken', met daaronder 'Authenticatie vereist'. Na versturen verschijnen 'Cluster succesvol aangemaakt!' en 'Aan de slag met je cluster'; ze passen bij wat volgt. Op de vier doorzochte pagina's staat geen ingesloten venster; het sitemodel noemt er ook geen.
   - Bewijs: `v-246-0023`, `v-246-0028`, `v-246-0031`, `v-246-0062`, `v-246-0072`, `v-246-0069`, `v-246-0070`, `v-246-0046`, `v-246-0049`, `v-246-0058`, `v-246-0086`
5. Onderzocht: De uitklappers met dezelfde tekst op de pagina's van een richtlijn
   - Hoe: tg find, tg look, tg html, tg style en tg click op P26; tg find op P17
   - Waargenomen: De tekst 'Praktische tips' zegt wat er openklapt; dat is hier geen fout. Op P26 staan twee uitklappers onder dezelfde kop. Het verschil staat in een losse regel erboven, 'Ontwikkelen & ontwerpen' en 'Inkopen van toegankelijke technologie'. Die regel is in de code een gewone alinea en geen kop: hoort bij criterium 1.3.1. Op P17 staat elke uitklapper onder een eigen kop.
   - Bewijs: `v-246-0033`, `v-246-0034`, `v-246-0036`, `v-246-0037`, `v-246-0038`, `v-246-0039`, `v-246-0040`, `v-246-0041`, `v-246-0043`
6. Onderzocht: De knoppen bij de codeblokken op P04
   - Hoe: tg find, tg name op beide knoppen en tg crop op de eerste knop op P04
   - Waargenomen: Beide knoppen zijn een pictogram zonder zichtbare tekst en heten voor hulpsoftware 'Kopieer'. Er is dus geen zichtbare tekst om hier te beoordelen. Of die naam genoeg zegt bij twee codeblokken: hoort bij criterium 4.1.2.
   - Bewijs: `v-246-0050`, `v-246-0052`, `v-246-0054`, `v-246-0055`

**Hoe zeker is dit oordeel**

Beoordelaar: Voldoet. Verificatie, tevens eindoordeel: Voldoet.

Poging om het oordeel onderuit te halen: Gezocht op pagina's en in toestanden die de beoordelaar niet zelf bekeek: P29, P05, P10, P02 en P22 op 320 pixels, het feedbackvenster op P06 met versturen via e-mail, het zijmenu op P04 en P18, het hoofdmenu, het zoekvenster met resultaten in het donkere schema en het proefvenster op P14 en na versturen. Elke kop, elk label en elke knoptekst past bij de inhoud of de werking. Ingesloten vensters zijn er niet. Geen tegenvoorbeeld gevonden.

Grondslag: Beslisregel R5, procedure versie 9 (oordeel).

Beperking van de procedure: Koppen en labels zijn beoordeeld op de pagina's en in de toestanden van de steekproef, niet op elke pagina van de site. Koppen en labels die pas na het versturen van een formulier verschijnen, zijn alleen gezien als de run mag versturen (een testomgeving). Van een ingesloten venster dat bij het onderzoek niet laadde, is alleen de titel op de omringende pagina beoordeeld.

<a id="bijlage-2.4.7"></a>

### 2.4.7 Focus zichtbaar

**Uitkomst:** ● Voldoet · Niveau AA · EN 301 549: 9.2.4.7 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html) · [Terug naar het resultaat](#sc-2.4.7)

**Hoe is dit vastgesteld**

1. Onderzocht: Is bij elke Tab-stop een zichtbare verandering gemeten, en klopt dat bij een eigen steekproef?
   - Hoe: Dossier, onderdeel keyboard. Zelf: taborder op P16 (licht), P04 (donker), P29 op 320 pixels, en P13 met de uitklappers open in donker.
   - Waargenomen: Dossier: 29 pagina's, 1269 Tab-stops, elke wandeling afgemaakt, geen stop onder de drempel van 0,005, buiten beeld of op een verborgen element. Eigen meting: P16 38 stops en P04 66 stops, gelijk aan het dossier; P29 smal 21 stops; P13 met uitklappers 78 stops. Laagste aandeel steeds het logo (0,0078 breed, 0,0226 smal). Elke stop was in beeld.
   - Bewijs: `keyboard`, `v-247-0048`, `v-247-0042`, `v-247-0038`, `v-247-0052`
2. Onderzocht: De link met het logo in de kop, waar maar weinig pixels veranderen (drie kandidaten uit de rondgang).
   - Hoe: focus op de logolink op P01, P13 en P29 (320 pixels); crop van de link en van het vlak met het wapen zonder focus en na twee keer Tab; style van het vlak met het wapen; de uitsnede in donker op P04.
   - Waargenomen: Met focus staat er een dunne blauwe rand links, rechts en onder het donkerblauwe vlak met het wapen, met een witte strook ertussen. Zonder focus is die rand er niet. De rand staat niet om de naam ernaast en valt weinig op, maar is aan te wijzen, ook in donker en op het smalle scherm.
   - Bewijs: `v-247-0018`, `v-247-0019`, `v-247-0028`, `v-247-0029`, `v-247-0030`, `v-247-0034`, `v-247-0037`, `v-247-0042`
3. Onderzocht: De tweede keuzelijst in het feedbackvenster, waar een andere beoordelaar geen verandering zag (kandidaat X1411-01).
   - Hoe: open P01 met het feedbackvenster; focus op de keuzelijst; taborder door het venster; daarna drie keer Tab, look en crop van de keuzelijst.
   - Waargenomen: Krijgt de keuzelijst de focus zonder toetsenbord, dan verandert er niets (aandeel 0). Met de Tab-toets staat er een blauwe ring om de keuzelijst (aandeel 0,0857). Voor wie het toetsenbord gebruikt is de focus dus te zien. Alle 8 stops in het venster hebben een zichtbare ring; het tekstvak een dubbele blauwe rand.
   - Bewijs: `v-247-0010`, `v-247-0004`, `v-247-0013`, `v-247-0014`, `v-247-0009`
4. Onderzocht: Geopende vensters en toestanden die de eerste beoordelaar niet zelf bekeek: het hoofdmenu op een smal scherm, het zoekvenster en de afvinklijst op 320 pixels in donker.
   - Hoe: taborder in het hoofdmenu op 360 pixels, daarna pijl omlaag en look; look in het zoekvenster en focus op de sluitknop; taborder op P14 met de afvinklijst op 320 pixels in donker.
   - Waargenomen: Hoofdmenu: sluitknop en eerste link hebben een blauwe ring, ook de link die met pijl omlaag focus krijgt. Zoekvenster: het zoekveld heeft bij openen een dubbele blauwe rand; de sluitknop een blauwe rand (aandeel 0,1103). P14 smal en donker: 64 stops, alle in beeld; de 24 selectievakjes krijgen een lichtblauwe ring, ook het ene vakje zonder pixelmeting.
   - Bewijs: `v-247-0040`, `v-247-0045`, `v-247-0046`, `v-247-0054`, `v-247-0057`, `v-247-0059`
5. Onderzocht: Is de focus ook in het donkere kleurenschema te zien?
   - Hoe: Dossier, onderdeel uiContrast (focusIndicators). Zelf: taborder in donker op P04 en P13, en focus op de link in het blauwe vlak op P01 in donker.
   - Waargenomen: Het dossier heeft het donkere schema op alle pagina's gemeten. Eigen meting in donker: P04 66 stops en P13 78 stops, elk met een lichtblauwe rand; laagste aandeel 0,0078 (logo). De rand om de link in het blauwe vlak op P01 is te zien, maar steekt maar 2,8 op 1 af; dat hoort bij criterium 1.4.11.
   - Bewijs: `uiContrast`, `v-247-0042`, `v-247-0052`, `v-247-0065`
6. Onderzocht: Bereikt de Tab-toets in het zoekvenster de sluitknop?
   - Hoe: taborder in het geopende zoekvenster op P01.
   - Waargenomen: De focus staat bij openen op het zoekveld. Met Tab kwam de focus in Chromium en Firefox niet op de sluitknop, hoewel de code hem als stop voorspelt. Dat gaat niet over de zichtbaarheid van de focus en hoort bij criterium 2.1.1.
   - Bewijs: `v-247-0050`

**Hoe zeker is dit oordeel**

Beoordelaar: Voldoet. Verificatie, tevens eindoordeel: Voldoet.

Poging om het oordeel onderuit te halen: Gezocht waar de beoordelaar niet keek: het feedbackvenster (8 stops, met de keuzelijst uit een ander criterium), het hoofdmenu op een smal scherm met pijltjestoetsen, het zoekvenster, P04 en de uitklappers op P13 in donker, en de afvinklijst op 320 pixels in donker. Het logo op drie pagina's opnieuw gemeten. Elke stop toonde een aanwijsbare rand of ring. Geen tegenvoorbeeld gevonden.

Grondslag: Beslisregel R4, procedure versie 6 (probe+oordeel).

Beperking van de procedure: Of de focus zichtbaar is, is gemeten in één browser (Chromium); de standaard focusring ziet er in andere browsers anders uit. Gemeten zijn de pagina's en toestanden van de steekproef, niet elke pagina in elke toestand. Of het contrast van de focusaanduiding genoeg is, hoort bij 1.4.11.

<a id="bijlage-2.4.11"></a>

### 2.4.11 Focus niet bedekt (minimum)

**Uitkomst:** ✕ Voldoet niet · [Terug naar het resultaat](#sc-2.4.11)

**Hoe is dit vastgesteld**

1. Onderzocht: Of een link in het zijmenu te zien is als hij focus krijgt terwijl de pagina helemaal naar beneden is gescrold
   - Hoe: P14 op 1280 pixels geopend, naar het eind gescrold, gekeken welke links onder de voet liggen, daarna de focus op de laatste link van de inhoudsopgave gezet en opnieuw gekeken, met de uitsnede van het element
   - Waargenomen: Zes links van het zijmenu en de inhoudsopgave staan in de lijst als bedekt. De link met focus ligt onder de voet (\`\#page-footer\`). De pagina schoof niet. Op de uitsnede is van de link en van zijn aanduiding niets te zien: alleen de voet.
   - Bewijs: `v-2411-0052`, `v-2411-0053`, `v-2411-0054`
2. Onderzocht: Of dezelfde links ook onzichtbaar zijn als iemand er met de Tab-toets op komt, in elke browser
   - Hoe: Vanaf de eerste link van de inhoudsopgave op P14 verder getabd in drie browsers; de voorspelling uit de code ernaast gelegd
   - Waargenomen: Bij deze loop schoof de pagina eerst en was de link te zien. De voorspelling uit de code telde 1 stop niet mee omdat hij onder de voet lag. De loop met de Tab-toets vanaf de stand helemaal onderaan is niet meer gemeten.
   - Bewijs: `v-2411-0055`
3. Onderzocht: Of bij vooruit tabben iets over het element met focus ligt, op een tussenbreedte en op het smalle scherm
   - Hoe: P14 op 1000 pixels en P11 op 320 pixels (geopend met de meldingen aan) helemaal met Tab doorlopen in Chromium, WebKit en Firefox; op P11 de skiplink bekeken
   - Waargenomen: P14 op 1000 pixels: 64 stops, 0 bedekt. P11 op 320 pixels: 37 stops, 0 bedekt; er verscheen geen melding. De skiplink is bij focus linksboven te zien. Het dossier telt op 1280 pixels 1269 stops op 29 pagina's, 0 bedekt.
   - Bewijs: `v-2411-0034`, `v-2411-0037`, `v-2411-0038`, `keyboard`
4. Onderzocht: Of in een geopend venster iets over het element met focus ligt
   - Hoe: Het venster voor een cluster (eerste stap en het formulier) en het zoekvenster met resultaten met Tab doorlopen; in de zoekresultaten met de pijltoetsen naar het laatste resultaat gegaan en gekeken
   - Waargenomen: Venster cluster: 4 stops en in het formulier 8 stops, 0 bedekt. Zoekvenster: 0 bedekt; het laatste van de resultaten stond na de toets End vrij in beeld. De focus blijft in het venster.
   - Bewijs: `v-2411-0003`, `v-2411-0005`, `v-2411-0007`, `v-2411-0027`, `v-2411-0028`
5. Onderzocht: Of de melding na kopiëren over de knop met focus ligt, en of kop en voet zijn vastgezet
   - Hoe: P04 geopend in de toestand na kopiëren, de knop focus gegeven en gekeken; op P14 de plaatsing van kop, voet en zijmenu gemeten; achteruit getabd vanaf de voet
   - Waargenomen: De knop Kopieer is met focus te zien, de melding ligt er niet overheen. Kop en voet zijn niet vastgezet (\`relative\`). Na 30 keer achteruit tabben vanaf de voet stond het selectievakje met focus vrij in beeld.
   - Bewijs: `v-2411-0031`, `v-2411-0032`, `v-2411-0044`, `v-2411-0045`, `v-2411-0050`

**Hoe zeker is dit oordeel**

Beoordelaar: Voldoet. Verificatie, tevens eindoordeel: Voldoet niet.

Poging om het oordeel onderuit te halen: Gekeken waar de beoordelaar niet keek: vensters voor cluster en zoeken, de melding na kopiëren, 1000 en 320 pixels, de skiplink smal, en P14 helemaal onderaan. Alleen het laatste leverde iets op: het zijmenu schuift daar onder de voet en een link met focus is dan helemaal bedekt. De beoordelaar tabde achteruit tot de pagina weer omhoog was geschoven en zag dit daardoor niet.

Grondslag: Beslisregel R1, procedure versie 5 (probe+oordeel).

Beperking van de procedure: Gemeten is in één browser (Chromium), die een element bij focus naar het midden van het venster schuift; een browser die het maar net in beeld schuift, laat deze fout vaker zien. Bij inzoomen is niet apart met Tab gelopen. Gemeten zijn de pagina's en toestanden van de steekproef, niet elke pagina in elke toestand.

Open, voor een volgende meting:

- Budget was op: Op P14 (richtlijnen/cloud/fases) is de focus onderaan de pagina door het instrument op de link in het zijmenu gezet. Niet gemeten is dezelfde stand met de Tab-toets zelf, in Firefox en Safari, en op de andere pagina's met dit zijmenu. Scrol naar het eind van de pagina, zet de focus op een zichtbare link in het zijmenu en druk een paar keer op Tab.

Open: 1 punt, zie [Nog uitzoeken](#open-2.4.11).

<a id="bijlage-2.5.1"></a>

### 2.5.1 Aanwijzergebaren

**Uitkomst:** − Niet van toepassing · Niveau A · EN 301 549: 9.2.5.1 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/pointer-gestures.html) · [Terug naar het resultaat](#sc-2.5.1)

**Hoe is dit vastgesteld**

1. Onderzocht: Of de site luistert naar bewegingen van een vinger of aanwijzer
   - Hoe: Dossier: pointer.pagesExamined, pointer.browserListenersSubtracted, pointer.moveListeners en pointer.gestureListeners, op alle pagina's in de begintoestand op 1280 pixels breed
   - Waargenomen: 29 pagina's onderzocht; de luisteraars van de browser zelf zijn afgetrokken. 2 rijen voor beweging: touchmove op een div en dragstart op een div, beide op 3 pagina's (P04, P13, P14). Dragstart hoort bij slepen. Ter controle: 15 rijen in de lijst met gebaren, waarvan alleen touchmove een padgebaar kan zijn; geen luisteraars voor kantelen of schudden.
   - Bewijs: `pointer`
2. Onderzocht: Bij welk onderdeel de luisteraar voor beweging hoort
   - Hoe: Op P04 en P14 het codeblok opgezocht; op P04 de code gelezen, de opmaak gemeten en een uitsnede bekeken
   - Waargenomen: Het codeblok op P04 is een niet te bewerken tekstvak met één regel code en een knop Kopieer ernaast. Het schuift niet en heeft geen eigen aanraakgedrag. Op de uitsnede staat alleen een regel tekst en de knop. Op P14 is het codeblok in de begintoestand verborgen. Er valt niets te vegen, te verschuiven of te tekenen.
   - Bewijs: `v-251-0009`, `v-251-0016`, `v-251-0017`, `v-251-0018`, `v-251-0019`
3. Onderzocht: Of er ergens een onderdeel staat dat met een gebaar kan werken: carrousel, kaart, tekenvlak, schuifregelaar, sorteerbare lijst, handtekeningveld of galerij
   - Hoe: Dossier: inventoryCounts en controls. Zelf gekeken en gezocht op P14, P13 en op P18 op 320 pixels breed, en in 6 geopende toestanden: kopiëren op P04, het feedbackvenster en het zoekvenster op P01, het zijmenu op 360 pixels en de praktische tips op P13, en de afvinklijst op P14
   - Waargenomen: Dossier: 0 keer een tekenvlak, 0 keer een sleepbaar element en 0 keer een video aangetroffen op 29 pagina's. Zelf op 3 pagina's en in 6 toestanden gezocht naar elk van de zeven soorten: 0 treffers. Te zien waren tekst, links, knoppen, selectievakjes, keuzelijsten, tekstvelden en vensters met een knop Sluit. Het zijmenu op smal scherm heeft geen greep om te vegen.
   - Bewijs: `inventoryCounts`, `controls`, `v-251-0003`, `v-251-0004`, `v-251-0005`, `v-251-0008`, `v-251-0011`, `v-251-0012`, `v-251-0013`, `v-251-0021`, `v-251-0022`, `v-251-0023`, `v-251-0026`, `v-251-0028`, `v-251-0029`, `v-251-0030`, `v-251-0033`, `v-251-0035`, `v-251-0036`, `v-251-0037`, `v-251-0040`, `v-251-0042`, `v-251-0043`, `v-251-0044`, `v-251-0047`, `v-251-0049`, `v-251-0050`, `v-251-0051`, `v-251-0054`, `v-251-0056`, `v-251-0057`, `v-251-0058`, `v-251-0061`, `v-251-0063`, `v-251-0064`, `v-251-0065`, `v-251-0068`
4. Onderzocht: Of er bewegingshandlers als attribuut in de code staan
   - Hoe: Zelf gezocht op P14, P13 en P18 (320 pixels breed) en in de 6 geopende toestanden
   - Waargenomen: 0 elementen met een attribuut voor beweging of een gebaar op 3 pagina's en in 6 geopende toestanden.
   - Bewijs: `v-251-0006`, `v-251-0014`, `v-251-0024`, `v-251-0031`, `v-251-0038`, `v-251-0045`, `v-251-0052`, `v-251-0059`, `v-251-0066`
5. Onderzocht: Of er ingesloten vensters zijn die niet zijn meegeteld
   - Hoe: Dossier: inventoryCounts.iframes en pointer.frames; zelf gezocht naar ingesloten vensters op P14, P13 en P18 en in de 6 geopende toestanden
   - Waargenomen: Het dossier telt 0 ingesloten vensters op 29 pagina's en noemt geen venster dat niet uit te lezen was. Zelf gezocht op 3 pagina's en in 6 toestanden: 0 ingesloten vensters.
   - Bewijs: `inventoryCounts`, `pointer`, `v-251-0007`, `v-251-0015`, `v-251-0025`, `v-251-0032`, `v-251-0039`, `v-251-0046`, `v-251-0053`, `v-251-0060`, `v-251-0067`

**Hoe zeker is dit oordeel**

Beoordelaar: Niet van toepassing. Verificatie, tevens eindoordeel: Niet van toepassing.

Poging om het oordeel onderuit te halen: Gezocht waar de beoordelaar niet keek: P14 en P18 (op 320 pixels breed), en de toestanden kopiëren, feedback, zoeken, zijmenu op smal scherm, praktische tips en afvinklijst. Overal gezocht naar tekenvlak, schuifregelaar, carrousel, kaart, galerij, sorteerbare lijst, handtekeningveld, bewegingsattributen en ingesloten vensters: niets gevonden. Het codeblok op P04 zelf nagemeten: niet te bewerken tekst zonder eigen aanraakgedrag. Het oordeel blijft staan.

Grondslag: Beslisregel R4, procedure versie 5 (inventaris).

Beperking van de procedure: Geen instrument voert een veeg, een beweging langs een pad of een gebaar met meerdere vingers uit. Vastgesteld is welke pagina's naar beweging van een aanwijzer luisteren, welke onderdelen op de pagina's en toestanden van de steekproef met een gebaar kunnen werken, en of daar een knop bij staat die met een enkele klik werkt. Wat het gebaar zelf doet is niet gemeten, en handlers die in een script als eigenschap zijn gezet of pas na het indrukken worden toegevoegd, zijn niet geteld.

<a id="bijlage-2.5.2"></a>

### 2.5.2 Aanwijzerannulering

**Uitkomst:** ◐ Geen afwijking gevonden, niet volledig gemeten · [Terug naar het resultaat](#sc-2.5.2)

**Hoe is dit vastgesteld**

1. Onderzocht: Welke onderdelen luisteren naar het indrukken van de muis of vinger
   - Hoe: Dossier: telling van luisteraars op 29 pagina's in de begintoestand, 1280 pixels breed; de luisteraars van de testbrowser zelf zijn afgetrokken.
   - Waargenomen: 29 pagina's onderzocht. 15 rijen met luisteraars, waarvan 9 voor het indrukken: op links, knoppen, vensters, lijsten, lijstonderdelen, menu-onderdelen en het document, en op het codeblok (P04, P13, P14). 0 keer een ingesloten venster aangetroffen op 29 pagina's. 163 bedieningselementen onderzocht, 88 verschillende.
   - Bewijs: `pointer`, `inventoryCounts`, `controls`
2. Onderzocht: De twee knoppen waar bij indrukken iets verschijnt: Verberg in de melding op P01 en Kopieer bij het codeblok op P04
   - Hoe: Op een verse pagina de muis ingedrukt zonder loslaten, en op een nieuwe verse pagina ingedrukt, weggeschoven en ernaast losgelaten. Daarna gekeken of de melding er nog stond en of er iets was gekopieerd.
   - Waargenomen: Bij indrukken opent alleen de hulptekst van de knop; na loslaten naast de knop is die weer weg. De melding op P01 staat er daarna nog, met de knop Verberg. Op P04 is niets naar het klembord geschreven en staat er geen melding dat er is gekopieerd.
   - Bewijs: `v-252-0004`, `v-252-0007`, `v-252-0008`, `v-252-0009`, `v-252-0082`, `v-252-0083`
3. Onderzocht: Indrukken naast het geopende hoofdmenu en het geopende zijmenu op een smal scherm, en naast de uitgeklapte tips
   - Hoe: Op 360 pixels breed het hoofdmenu (P01) en het zijmenu (P13) geopend en de muis ingedrukt op de strook boven het menu. Op P13 de tips uitgeklapt en ingedrukt op een kop ernaast. Daarna het menu opnieuw geopend met zijn knop.
   - Waargenomen: Bij indrukken verandert er niets. Beide menu's sluiten pas na het loslaten en gaan met hun knop weer open; er is geen invoer die verloren kan gaan. De uitklapper met tips blijft open.
   - Bewijs: `v-252-0013`, `v-252-0016`, `v-252-0017`, `v-252-0018`, `v-252-0022`, `v-252-0024`, `v-252-0026`, `v-252-0039`, `v-252-0040`
4. Onderzocht: Knoppen, een uitklapper en een aankruisvakje waar de eerdere beoordeling niet of op een andere pagina drukte
   - Hoe: Indrukken zonder loslaten op de kaartknoppen Verkennen en Starten en de knop van de uitklapper op P13, de knop Publiceren op P21 en een niet aangevinkt vakje in de afvinklijst op P18.
   - Waargenomen: 5 elementen geprobeerd: bij geen ervan verandert er iets bij het indrukken of na loslaten ernaast. Op P18 is na de proef nog steeds 1 vakje aangevinkt, hetzelfde als ervoor.
   - Bewijs: `v-252-0030`, `v-252-0031`, `v-252-0041`, `v-252-0056`, `v-252-0047`, `v-252-0048`, `v-252-0049`
5. Onderzocht: De 96 soorten bedieningselementen die de vooraf uitgevoerde proef heeft overgeslagen
   - Hoe: Dossier: 396 soorten gevonden, 300 geprobeerd (de grens), 96 niet. Bij de controle 14 links ingedrukt zonder loslaten op P13, P21, P24 en P26: in de inhoudsopgave, op kaarten, in de tekst en in de voet.
   - Waargenomen: Alle 14 links deden niets bij indrukken en niets na loslaten ernaast. Samen met de 8 links van de eerdere beoordeling zijn dat er 22. Welke daarvan bij de 96 overgeslagen soorten horen, zegt het dossier niet; het merendeel van de 96 blijft niet geprobeerd.
   - Bewijs: `pointer`, `v-252-0042`, `v-252-0058`, `v-252-0059`, `v-252-0060`, `v-252-0061`, `v-252-0062`, `v-252-0068`, `v-252-0069`, `v-252-0070`, `v-252-0071`, `v-252-0075`, `v-252-0076`, `v-252-0077`, `v-252-0078`
6. Onderzocht: Of er handelingen voor het indrukken direct in de code van een element staan
   - Hoe: Op de geladen pagina gezocht op P01, P04, P21, P24 en P26, en in vier geopende toestanden: het hoofdmenu en het zijmenu op 360 pixels, de uitgeklapte tips op P13 en de afvinklijst op P18.
   - Waargenomen: 0 treffers in elk van de 9 zoekacties, op 5 pagina's van 5 paginatypen en in 4 geopende toestanden.
   - Bewijs: `v-252-0002`, `v-252-0012`, `v-252-0021`, `v-252-0035`, `v-252-0044`, `v-252-0053`, `v-252-0066`, `v-252-0073`, `v-252-0081`

**Hoe zeker is dit oordeel**

Beoordelaar: Kan niet bepalen. Verificatie, tevens eindoordeel: Kan niet bepalen.

Poging om het oordeel onderuit te halen: Het open punt over de menu's op een smal scherm is beslecht: naast het hoofdmenu en het zijmenu gedrukt, ze sluiten pas bij loslaten en gaan weer open. De hulptekst bij Verberg en Kopieer nagemaakt: de functie zelf wordt niet uitgevoerd. Daarnaast 14 links, 4 knoppen en een aankruisvakje geprobeerd op pagina's waar de beoordelaar niet drukte, en 9 keer naar handelingen in de code gezocht: niets gevonden. De 96 overgeslagen soorten zijn niet allemaal na te meten.

Grondslag: Beslisregel R6, procedure versie 8 (probe).

Beperking van de procedure: Of een functie al bij het indrukken wordt uitgevoerd, is gemeten door in te drukken zonder los te laten, op de onderdelen met een listener voor het indrukken. Effecten die de meting niet vastlegt (geluid, een verzoek op de achtergrond) en onderdelen in een venster van een derde partij zijn niet vastgesteld. Er is gemeten met een muisaanwijzer in één browser (Chromium), niet met aanraking.

Open, voor een volgende meting:

- Dekking ontbrak: 96 van de 396 soorten bedieningselementen zijn vooraf niet geprobeerd, omdat de grens van 300 was bereikt. Het gaat om links in de tekst, op de kaarten en in de inhoudsopgave op de pagina's vanaf P16. Bij de beoordeling en de controle zijn 22 links op P13, P16, P17, P21, P24 en P26 nagemeten, alle zonder reactie; de rest is niet geprobeerd. Probeer daar met de hand: de muis indrukken op de link, wegbewegen en naast de link loslaten; er mag dan niets gebeuren.
- Dekking ontbrak: De proef met indrukken, wegbewegen en loslaten is vooraf niet gedaan op de bedieningselementen in de geopende onderdelen (zoekvenster, feedbackvenster, hoofdmenu en zijmenu op een smal scherm, venster voor een cluster, uitklapper met tips, afvinklijst). Met de hand zijn er ruim 10 geprobeerd, zonder reactie bij indrukken, maar niet alle.

Open: 2 punten, zie [Nog uitzoeken](#open-2.5.2).

<a id="bijlage-2.5.3"></a>

### 2.5.3 Label in naam

**Uitkomst:** ● Voldoet · Niveau A · EN 301 549: 9.2.5.3 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html) · [Terug naar het resultaat](#sc-2.5.3)

**Hoe is dit vastgesteld**

1. Onderzocht: De dekking en de rijen met een vlag
   - Hoe: Dossier: controls, links, labelInName en engine, op 29 pagina's in het standaardvenster, op 320 pixels breed en in 12 toestanden.
   - Waargenomen: 163 bedieningselementen (88 unieke) en 1666 links (570 unieke) onderzocht. Van 608 unieke elementen: 389 keer tekst gelijk aan de naam, 117 keer erin, 14 keer niet letterlijk, 88 keer geen tekst gevonden, 0 keer geen naam. Geen rij heeft de vlag voor dit criterium. Alfa keurt 170 elementen goed op 26 pagina's en vindt op 3 pagina's niets om te toetsen.
   - Bewijs: `controls`, `links`, `labelInName`, `engine`
2. Onderzocht: De kandidaat: ingesprongen links in het zijmenu, en de links Vorige en Volgende
   - Hoe: Op P20 en P09 met find, html, name en crop; op P13 het smalle zijmenu met look.
   - Waargenomen: Voor de zichtbare tekst staat in de code een verborgen voorvoegsel. De naam is dat voorvoegsel plus de zichtbare tekst; de zichtbare tekst staat er als geheel in. Bij de links onderaan de pagina begint de naam met Vorige of Volgende en volgt daarna de zichtbare tekst. Zes methoden zijn het eens.
   - Bewijs: `v-253-0005`, `v-253-0006`, `v-253-0007`, `v-253-0008`, `v-253-0011`, `v-253-0012`, `v-253-0013`, `v-253-0014`, `v-253-0015`, `v-253-0050`, `v-253-0051`, `v-253-0066`
3. Onderzocht: De 14 rijen waar de tekst niet letterlijk in de naam staat, en het logo
   - Hoe: Op P01 de eerste kaart met name, crop en html; het logo met name, crop, html en tekstherkenning. Het codeblok op P04: dossier en de waarnemingen van de beoordelaar.
   - Waargenomen: De link van een kaart is een lege laag over de kaart; de naam is gelijk aan de titel die op de kaart als kop zichtbaar is. De zin eronder is uitleg. Bij het logo leest tekstherkenning dezelfde 9 woorden als de naam. Het codeblok is een schuifbaar vak met code als inhoud, geen label.
   - Bewijs: `labelInName`, `v-253-0026`, `v-253-0027`, `v-253-0028`, `v-253-0022`, `v-253-0023`, `v-253-0025`, `b-253-0063`, `b-253-0064`, `b-253-0065`
4. Onderzocht: Velden en knoppen in de geopende vensters: feedback, cluster aanmaken en zoeken
   - Hoe: Elk venster geopend met de bewaarde toestand; look, daarna name op 6 onderdelen en html op 3.
   - Waargenomen: In het feedbackvenster (4 velden, 4 knoppen) en het clustervenster (7 velden en 2 knoppen in beeld) is het label boven elk veld gelijk aan de naam. Het kleine woord Optioneel naast een label is een aanduiding. Het zoekveld heeft zijn naam ook als voorbeeldtekst. Een zoekresultaat is een link zonder eigen naam: de naam komt uit de zichtbare tekst.
   - Bewijs: `v-253-0034`, `v-253-0035`, `v-253-0036`, `v-253-0039`, `v-253-0041`, `v-253-0042`, `v-253-0043`, `v-253-0053`, `v-253-0054`, `v-253-0055`, `v-253-0056`, `v-253-0057`
5. Onderzocht: Vinkvakjes in de afvinklijsten en afbeeldingen die een link zijn
   - Hoe: Op P18 een vinkvakje met name, crop en html; op P09 gezocht naar afbeeldingen binnen een link of knop. De overige 72 vinkvakjes: dossier en waarnemingen van de beoordelaar.
   - Waargenomen: De tekst naast het vinkvakje is letterlijk gelijk aan de naam. Op P09 staat 1 afbeelding en die zit niet in een link of knop; op P01 staat geen img-element. De knoppen Verberg, Kopieer en Wis zoekopdracht tonen alleen een pictogram.
   - Bewijs: `v-253-0062`, `v-253-0063`, `v-253-0064`, `v-253-0047`, `v-253-0048`, `v-253-0020`, `v-253-0019`, `v-253-0053`, `controls`, `b-253-0041`
6. Onderzocht: Steekproef op vijf paginatypen, op smal scherm en in vier geopende toestanden
   - Hoe: look en name op P01 (start), P09 (toegankelijkheidsverklaring), P18 (fases), P20 (richtlijn integratie) en P17 op 320 pixels; toestanden feedback, cluster aanmaken, zoeken met resultaten en het smalle zijmenu op P13.
   - Waargenomen: 16 keer een naam gemeten: telkens staat de zichtbare tekst als geheel in de naam, zoals in het dossier. Op 320 pixels tonen Menu, Zoeken, Feedback en Richtlijnen hun naam als tekst; de link GitHub toont dan alleen een pictogram. In het smalle zijmenu staan 16 links en de knop Sluit met hun zichtbare tekst in de naam.
   - Bewijs: `v-253-0019`, `v-253-0030`, `v-253-0031`, `v-253-0016`, `v-253-0017`, `v-253-0066`, `v-253-0068`

**Hoe zeker is dit oordeel**

Beoordelaar: Voldoet. Verificatie, tevens eindoordeel: Voldoet.

Poging om het oordeel onderuit te halen: De kandidaat op P20 opnieuw gemeten. Daarna gezocht waar de beoordelaar niet keek: links Vorige en Volgende met een eigen naam (P20, P09), de kaartlink en het logo met tekstherkenning (P01), afbeeldingen in links op de toegankelijkheidsverklaring (P09), een vinkvakje op P18, de vensters feedback, cluster aanmaken en zoekresultaten, het smalle zijmenu en P17 op 320 pixels. Overal staat de zichtbare tekst in de naam. Geen tegenvoorbeeld gevonden.

Grondslag: Beslisregel R4, procedure versie 6 (engine+oordeel).

Beperking van de procedure: Er is geen spraakherkenningssoftware gebruikt: vastgesteld is of de zichtbare tekst in de toegankelijke naam staat, niet of spraakbesturing het onderdeel ook echt vindt. Tekst in een afbeelding is met tekstherkenning gelezen; die kan sierletters en kleine tekst missen. Vergeleken zijn de bedieningselementen en links op de pagina's en toestanden van de steekproef, niet op elke pagina in elke toestand.

<a id="bijlage-2.5.4"></a>

### 2.5.4 Bewegingsactivering

**Uitkomst:** − Niet van toepassing · Niveau A · EN 301 549: 9.2.5.4 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/motion-actuation.html) · [Terug naar het resultaat](#sc-2.5.4)

**Hoe is dit vastgesteld**

1. Onderzocht: Of de site luistert naar het schudden of kantelen van het apparaat
   - Hoe: Dossier: de telling van luisteraars vanaf het laden van de pagina, per soort gebeurtenis, op alle pagina's in de begintoestand.
   - Waargenomen: 29 van 29 pagina's onderzocht. 0 luisteraars voor devicemotion en 0 voor deviceorientation op alle 29 pagina's.
   - Bewijs: `pointer`
2. Onderzocht: Of er ingesloten vensters zijn waarin naar beweging wordt geluisterd
   - Hoe: Dossier: de telling van ingesloten vensters. Zelf gezocht naar ingesloten vensters op zes pagina's van zes paginatypen: P04, P18 met de afvinklijst bediend, P02 op 320 pixels breed, P01 met het feedbackvenster open, P13 met het venster voor een cluster open en P09 in het donkere schema.
   - Waargenomen: Het dossier telt 0 ingesloten vensters op 29 pagina's; elk venster is geteld en geen venster is overgeslagen. De eigen zoektocht gaf op alle zes pagina's 0 ingesloten vensters. In de twee open vensters staan alleen gewone velden en knoppen.
   - Bewijs: `inventoryCounts`, `pointer`, `v-254-0003`, `v-254-0010`, `v-254-0017`, `v-254-0024`, `v-254-0029`, `v-254-0032`, `v-254-0036`, `v-254-0039`
3. Onderzocht: Of in de code van een element een reactie op beweging is vastgelegd, die de telling van het dossier niet ziet
   - Hoe: Steekproef op dezelfde zes pagina's en toestanden, andere dan de drie van de eerste beoordelaar. Gezocht naar elementen met ondevicemotion, ondeviceorientation of ondeviceorientationabsolute, en naar tekst over schudden, kantelen of bewegen.
   - Waargenomen: 0 treffers voor een reactie op beweging in de code op P04, P18, P02, P01, P13 en P09. Ook geen tekst over schudden, kantelen of bewegen op deze zes pagina's. Samen met de eerste beoordeling (P01, P14, P13) zijn acht paginatypen bekeken.
   - Bewijs: `v-254-0002`, `v-254-0009`, `v-254-0016`, `v-254-0023`, `v-254-0031`, `v-254-0038`, `v-254-0005`, `v-254-0006`, `v-254-0007`, `v-254-0043`, `b-254-0003`, `b-254-0006`, `b-254-0009`

**Hoe zeker is dit oordeel**

Beoordelaar: Niet van toepassing. Verificatie, tevens eindoordeel: Niet van toepassing.

Poging om het oordeel onderuit te halen: Gezocht naar een tegenvoorbeeld op zes pagina's en toestanden die de beoordelaar niet bekeek: P04, P18 met afvinklijst, P02 op 320 pixels, P01 met het verstuurklare feedbackvenster, P13 in het proces voor een cluster en P09 in het donkere schema. Nergens een reactie op beweging in de code, een ingesloten venster of tekst over schudden of kantelen. De open vensters tonen alleen gewone velden en knoppen. Het oordeel blijft staan.

Grondslag: Beslisregel R2, procedure versie 6 (inventaris).

Beperking van de procedure: Er wordt geen apparaat bewogen: geen instrument schudt of kantelt. Vastgesteld is of er op de pagina's en in de ingesloten vensters naar beweging van het apparaat wordt geluisterd. Niet vastgesteld zijn: de sensor-API van de browser, een listener die pas na een handeling wordt gezet, herkenning via de camera, en wat een listener met de beweging doet.

<a id="bijlage-2.5.7"></a>

### 2.5.7 Sleepbewegingen

**Uitkomst:** ● Voldoet · Niveau AA · EN 301 549: 9.2.5.7 · Nieuw in WCAG 2.2 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html) · [Terug naar het resultaat](#sc-2.5.7)

**Hoe is dit vastgesteld**

1. Onderzocht: Of er op de site elementen zijn die je kunt slepen of die naar slepen luisteren
   - Hoe: Dossier: de tellingen van listeners, sleepbare elementen, bedieningselementen en ingesloten vensters op alle 29 pagina's, begintoestand, 1280 breed.
   - Waargenomen: 29 pagina's onderzocht; de listeners van de testbrowser zijn afgetrokken. 0 keer een sleepbaar element aangetroffen. 2 rijen voor beweging: dragstart en touchmove, beide op een div op P04, P13 en P14; daar staat ook drop. 163 keer een bedieningselement aangetroffen, geen schuifregelaar, schuifbalk of scheidingslijn. 0 keer een ingesloten venster en 0 keer een canvas.
   - Bewijs: `pointer`, `inventoryCounts`, `controls`
2. Onderzocht: Bij welk onderdeel de listeners voor slepen horen
   - Hoe: Op P04 en op P14 (na het versturen van het proefformulier voor een cluster) het codeblok gezocht en de code gelezen.
   - Waargenomen: Het codeblok staat op P04 (2 keer zichtbaar) en op P14 (1 keer, verborgen tot het proefformulier is verstuurd). Het is een tekstvak dat niet te bewerken is (\`contenteditable="false"\`), zonder \`draggable\`. Slepen kan er alleen tekst selecteren: dat is gedrag van de browser. Op pagina's zonder codeblok is het onderdeel niet gevonden.
   - Bewijs: `pointer`, `v-257-0003`, `v-257-0004`, `v-257-0006`, `v-257-0046`, `v-257-0051`
3. Onderzocht: Of de functie van het codeblok ook zonder slepen werkt
   - Hoe: Op P04 en op P14 (resultaatscherm van het proefformulier) op de knop bij het codeblok geklikt en een uitsnede van voor en na vergeleken.
   - Waargenomen: 2 van 2 aangeklikte codeblokken: één klik op de knop met de naam "Kopieer" zet de hele code op het klembord (19 tekens op P04, 357 tekens op P14) en toont de melding "Gekopieerd". Op de uitsnede na de klik staat een vinkje in de knop.
   - Bewijs: `v-257-0006`, `v-257-0009`, `v-257-0010`, `v-257-0011`, `v-257-0047`, `v-257-0048`, `v-257-0049`
4. Onderzocht: Of er elders een onderdeel is dat met slepen kan werken: een carrousel, kaart, schuifregelaar, sorteerbare lijst, handtekeningveld, galerij of paneel met trekrand
   - Hoe: Steekproef op pagina's die de beoordelaar niet bekeek: P10, P11, P20, P21 en P29 in de begintoestand, P01 op 320 pixels breed, P17 met de uitklapper open en P14 met het clustervenster en het resultaatscherm. Gericht gezocht, ook naar handlers als attribuut, en gekeken.
   - Waargenomen: Op 8 pagina's van 8 paginatypen en in 3 geopende toestanden is geen sleepbaar element, schuifregelaar, scheidingslijn, canvas, ingesloten venster, carrousel of sorteerbare lijst gevonden, en geen handler voor slepen als attribuut. De pagina's tonen tekst, links, kaarten met links, selectievakjes, keuzelijsten en formulieren.
   - Bewijs: `v-257-0014`, `v-257-0016`, `v-257-0018`, `v-257-0020`, `v-257-0022`, `v-257-0034`, `v-257-0043`, `v-257-0045`, `v-257-0053`, `v-257-0054`, `v-257-0056`, `v-257-0057`

**Hoe zeker is dit oordeel**

Beoordelaar: Voldoet. Verificatie, tevens eindoordeel: Voldoet.

Poging om het oordeel onderuit te halen: Gezocht waar de beoordelaar niet keek: het codeblok op P14 na het versturen van het proefformulier (knop geklikt, 357 tekens gekopieerd), vijf andere paginatypen, P01 op 320 pixels breed en P17 met de uitklapper open. Nergens een sleepbaar element, schuifregelaar, canvas, venster of handler voor slepen. De proef op P04 zelf herhaald: klik kopieert 19 tekens. Geen tegenvoorbeeld gevonden.

Grondslag: Beslisregel R2, procedure versie 5 (inventaris).

Beperking van de procedure: Geen instrument voert een sleepbeweging uit. Vastgesteld is welke elementen sleepbaar zijn, welke pagina's naar beweging van een aanwijzer luisteren, welke onderdelen op de pagina's en toestanden van de steekproef met slepen kunnen werken, en of daar een bediening bij staat die met een enkele klik werkt. Wat het slepen zelf doet is niet gemeten, en handlers die in een script als eigenschap zijn gezet of pas tijdens het indrukken worden toegevoegd, zijn niet geteld.

<a id="bijlage-2.5.8"></a>

### 2.5.8 Grootte van het aanwijsgebied (minimum)

**Uitkomst:** ● Voldoet · Niveau AA · EN 301 549: 9.2.5.8 · Nieuw in WCAG 2.2 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) · [Terug naar het resultaat](#sc-2.5.8)

**Hoe is dit vastgesteld**

1. Onderzocht: Afmeting van elk bedieningselement op het brede scherm, op 320 pixels breed en in elke bewaarde toestand
   - Hoe: Dossier: de meting van aanwijsgebieden op alle 29 pagina's op 1280 en op 320 pixels breed en in 12 bewaarde toestanden, en de regel-engines op alle 29 pagina's.
   - Waargenomen: 1817 keer een bedieningselement gemeten op 29 pagina's op 1280 breed en 1189 keer op 320 breed (hetzelfde onderdeel telt op elke pagina opnieuw). Op beide breedtes 20 rijen lager dan 24 pixels: 20 met genoeg ruimte, 0 te dicht bij een ander doel. In de 12 toestanden 12 tot 16 te kleine rijen, alle met genoeg ruimte. De engines melden geen fouten. Het sitemodel kent geen cookiemelding.
   - Bewijs: `targetSize`, `engine`
2. Onderzocht: De balk met juridische links onder aan de voet op 320 pixels breed (kandidaat uit de rondgang)
   - Hoe: P29 vers geopend op 320 pixels breed, de voet bekeken met look en alle 4 links in de balk gemeten met target.
   - Waargenomen: De 4 links zijn 20 pixels hoog (46,6 tot 182 pixels breed) en staan 4 pixels van de dichtstbijzijnde link. Bij geen van de 4 raakt de cirkel van 24 pixels een ander doel; vier methoden zijn het eens. Gelijk aan het dossier.
   - Bewijs: `v-258-0004`, `v-258-0008`, `v-258-0009`, `v-258-0010`, `v-258-0012`
3. Onderzocht: Lijsten met links die dicht op elkaar staan en niet in het dossier staan
   - Hoe: P04 geopend en met look en target de lijst met links onder de kop Inhoudsopgave gemeten (eerste, tweede, een middelste en de laatste). Op P13 de links in de uitgeklapte tips gemeten. De beoordelaar bekeek de schermafbeeldingen van P01, P10 en P12.
   - Waargenomen: P04: 4 links in de inhoudsopgave gemeten, elk 22 pixels hoog met 12 pixels tot de buur; geen ligt te dicht bij een ander doel. P13: 2 korte links in een zin, 22 pixels hoog met 11 pixels tot de buur. De links in het zijmenu zijn 304 bij 44 pixels.
   - Bewijs: `screenshots`, `v-258-0014`, `v-258-0015`, `v-258-0016`, `v-258-0017`, `v-258-0018`, `v-258-0043`, `v-258-0044`, `v-258-0046`, `b-258-0002`, `b-258-0058`
4. Onderzocht: Geopende onderdelen die de beoordelaar niet zelf mat: kopieerknoppen, het clustervenster met zijn formulier en de uitgeklapte tips
   - Hoe: P04 geopend in de toestand met de kopieerknop en P13 in de toestand met het clustervenster en met de uitgeklapte tips; look, target en de regel-engines. In het clustervenster één stap verder geklikt.
   - Waargenomen: Kopieerknoppen 44 bij 44. In het clustervenster: sluitknop 57,4 bij 44, de drie inlogknoppen 528 bij 44, daarna de knop Terug 73 bij 32, keuzelijst 528 bij 44 en tekstveld 514 bij 40. De uitklapper van de tips is 718 bij 51, de knop Aanmaken 84,7 bij 32. De engines melden in elke toestand 0 fouten.
   - Bewijs: `v-258-0022`, `v-258-0023`, `v-258-0025`, `v-258-0027`, `v-258-0028`, `v-258-0029`, `v-258-0030`, `v-258-0031`, `v-258-0034`, `v-258-0035`, `v-258-0036`, `v-258-0037`, `v-258-0038`, `v-258-0040`, `v-258-0041`, `v-258-0045`
5. Onderzocht: Steekproef op andere paginatypen: komen eigen metingen overeen met het dossier
   - Hoe: Look en target op P29 (huidige versie, 320 breed), P04 (bijdragen), P13 (richtlijn cloud), P01 (start, na het verbergen van de melding) en P02 (niet gevonden, 320 breed).
   - Waargenomen: 27 doelen gemeten op 5 pagina's en in 4 bewaarde toestanden. Voetlink op P02 135,2 bij 18 met 17 pixels tussenruimte en de links in de balk 20 pixels hoog: gelijk aan het dossier. De link naar de startpagina op P02 is 288 bij 44, de link naar GitHub in de kop 93 bij 44. Geen enkel doel lag te dicht bij een ander.
   - Bewijs: `v-258-0020`, `v-258-0048`, `v-258-0050`, `v-258-0052`, `v-258-0053`, `v-258-0054`

**Hoe zeker is dit oordeel**

Beoordelaar: Voldoet. Verificatie, tevens eindoordeel: Voldoet.

Poging om het oordeel onderuit te halen: De weggezette kandidaat nagemeten op P29 op 320 breed: alle 4 links hebben genoeg ruimte. Daarna gezocht waar de beoordelaar niet mat: de inhoudsopgave en kopieerknoppen op P04, het clustervenster met formulier en de uitgeklapte tips op P13, P01 na het verbergen van de melding en P02 op 320 breed. 27 doelen gemeten en de engines gedraaid in drie toestanden: geen doel te dicht bij een ander.

Grondslag: Beslisregel R2, procedure versie 9 (probe+oordeel).

Beperking van de procedure: De veegronde mat de afmeting van elk bedieningselement op 1280 en op 320 pixels breed, en in de toestanden uit het sitemodel (de cookiebanner, geopende menu's en dialogen); de beoordelaar bevestigt het dossier met een steekproef op enkele pagina's en toestanden en meet niet alles opnieuw. Gemeten is met de muis in één browser (Chromium), niet met een vinger op een telefoon.

<a id="bijlage-3.1.1"></a>

### 3.1.1 Taal van de pagina

**Uitkomst:** ● Voldoet · Niveau A · EN 301 549: 9.3.1.1 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/language-of-page.html) · [Terug naar het resultaat](#sc-3.1.1)

**Hoe is dit vastgesteld**

1. Onderzocht: Welke taal elke pagina in de code opgeeft en of die code geldig is
   - Hoe: Dossier, onderdeel language, voor alle 29 pagina's; daarnaast het html-element in de bewaarde code van elke pagina gelezen.
   - Waargenomen: 29 van 29 pagina's hebben de taalcode nl. Dat is een geldige code. Geen pagina mist de taal of heeft een lege waarde. Er zijn 0 ingesloten vensters die niet laadden en 0 vensters die geen pagina zijn. Er zijn geen documenten in de steekproef.
   - Bewijs: `language`
2. Onderzocht: Of de tekst van elke pagina in de opgegeven taal is geschreven
   - Hoe: Dossier, onderdeel language: het fragment van alle 29 pagina's gelezen, en in de volledige bewaarde tekst van elke pagina Nederlandse en Engelse functiewoorden geteld.
   - Waargenomen: 29 van 29 fragmenten zijn Nederlands, en de taal in de code is nl. Per pagina staan er 17 tot 630 Nederlandse functiewoorden tegenover 0 tot 5 Engelse. De kortste pagina's zijn P02 (81 woorden) en P29 (93 woorden). Geen pagina heeft minder dan vier woorden tekst.
   - Bewijs: `language`
3. Onderzocht: Steekproef: de taal in de code naast de taal die in de tekst wordt herkend
   - Hoe: Zelf gemeten met het taalinstrument op vier pagina's van vier paginatypen die de beoordelaar niet mat: P21 (richtlijn over open source), P29 (huidige versie), P10 (versies) en P18 (fases, 320 pixels breed en donker).
   - Waargenomen: Op alle vier: code nl, herkend nl, twee methoden eens. P21: 800 woorden, 33 stukken tekst kloppen en 0 wijken af. P29: 94 woorden, 5 kloppen en 0 wijken af. P10: 611 woorden, 37 kloppen en 0 wijken af. P18: 548 woorden, 39 kloppen en 0 wijken af. Dit is gelijk aan het dossier en aan de meting van de beoordelaar op P01, P02, P04 en P13.
   - Bewijs: `v-311-0002`, `v-311-0006`, `v-311-0010`, `v-311-0017`, `b-311-0002`, `b-311-0004`, `b-311-0006`, `b-311-0008`
4. Onderzocht: Of de taal ook klopt met een venster open, en of er ingesloten vensters zijn
   - Hoe: P01 geopend met het feedbackvenster open en de taal opnieuw gemeten; op P21, P29, P10 en P01 gezocht naar ingesloten vensters.
   - Waargenomen: Met het feedbackvenster open op P01: code nl, herkend nl, 599 woorden, 36 stukken tekst kloppen en 0 wijken af. Op de vier doorzochte pagina's zijn 0 ingesloten vensters gevonden.
   - Bewijs: `v-311-0020`, `v-311-0004`, `v-311-0008`, `v-311-0012`, `v-311-0021`
5. Onderzocht: Wat de automatische regels zeggen over het bestaan en de geldigheid van de taalcode
   - Hoe: Dossier, onderdeel engine, alle 29 pagina's in licht en donker; zelf de regels opnieuw gedraaid op P10.
   - Waargenomen: Vier regels zijn geslaagd op 29 van 29 pagina's: taal aanwezig en taal geldig, elk volgens twee programma's. Een vijfde regel is niet van toepassing. Bij de eigen meting op P10 keurden vier programma's elk twee regels goed, met 0 fouten. Dit klopt met de tabel van taalcodes.
   - Bewijs: `engine`, `v-311-0015`

**Hoe zeker is dit oordeel**

Beoordelaar: Voldoet. Verificatie, tevens eindoordeel: Voldoet.

Poging om het oordeel onderuit te halen: Gezocht naar een tegenvoorbeeld waar de beoordelaar niet keek: taal gemeten op vier andere paginatypen (P21 met de meeste Engelse titels, P29, P10, en P18 op 320 pixels in donker) en op P01 met het feedbackvenster open; gezocht naar ingesloten vensters; regels opnieuw gedraaid op P10; de volledige tekst van alle 29 pagina's nageteld op Engelse zinnen. Overal code nl en Nederlandse tekst, geen vensters. Niets gevonden.

Grondslag: Beslisregel R4, procedure versie 7 (engine+oordeel).

Beperking van de procedure: De taal is vastgesteld op de tekst van de pagina's van de steekproef: door het lezen van de tekst en met taalherkenning, die onbetrouwbaar is bij minder dan vier woorden. Van documenten (pdf en kantoorbestanden) is de taal gelezen die het bestand opgeeft, voor de documenten van de steekproef die zijn ingelezen; een xlsx-bestand legt geen taal vast. Van een ingesloten venster dat bij het onderzoek niet laadde, is de taal niet vastgesteld.

<a id="bijlage-3.1.2"></a>

### 3.1.2 Taal van onderdelen

**Uitkomst:** ● Voldoet · Niveau AA · EN 301 549: 9.3.1.2 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/language-of-parts.html) · [Terug naar het resultaat](#sc-3.1.2)

**Hoe is dit vastgesteld**

1. Onderzocht: De volledige tekst, linkteksten, koppen en namen van alle pagina's en toestanden
   - Hoe: Dossier: de 29 tekstbestanden, de 570 verschillende linkteksten, de 559 koppen en de vastgelegde namen van pagina's en toestanden doorzocht op Engelse reeksen van vier woorden of meer, en elke vondst in zijn zin gelezen.
   - Waargenomen: De hoofdtaal is op alle 29 pagina's Nederlands. Elke Engelse titel van vier woorden of meer heeft een taalaanduiding. Wat zonder aanduiding overblijft is een naam of vakterm in een Nederlandse zin, op P03, P16, P19, P21, P22 en P24.
   - Bewijs: `language`, `links`, `headings`, `v-312-0019`, `v-312-0070`
2. Onderzocht: De elementen met een eigen taalaanduiding
   - Hoe: Dossier: 10 rijen gelezen. Zelf opgezocht en gemeten op P13, P17, P21 en P26.
   - Waargenomen: Zelf 11 elementen met de code en gevonden: 2 op P13, 3 op P17, 5 op P21 en 1 op P26. Alle bevatten Engelse titels. Bij de 4 titels van zes woorden of meer vinden beide herkenners Engels. De 7 kortere titels zijn zelf gelezen en Engels.
   - Bewijs: `language`, `v-312-0003`, `v-312-0004`, `v-312-0038`, `v-312-0045`, `v-312-0046`, `v-312-0047`, `v-312-0048`, `v-312-0049`, `v-312-0062`, `v-312-0063`, `v-312-0064`, `v-312-0085`
3. Onderzocht: Stukken waar de herkenners Engels zagen of het oneens waren
   - Hoe: Taal gemeten en code gelezen op P21 (twee lijstpunten en een vette term), P24 (link naar de privacytoets), P06 (naam van de licentie) en P16 (link naar een position paper).
   - Waargenomen: Het zijn Nederlandse zinnen met een Engelse vakterm of naam erin: de vakterm total cost of ownership, de uitgeschreven afkortingen CVE en DPIA, en de naam van de licentie EUPL. Het lijstpunt eromheen meet op P21 en P24 als Nederlands. De uitzondering voor namen en vaktermen geldt.
   - Bewijs: `v-312-0051`, `v-312-0052`, `v-312-0053`, `v-312-0055`, `v-312-0056`, `v-312-0059`, `v-312-0067`, `v-312-0092`, `v-312-0093`, `v-312-0034`, `v-312-0070`
4. Onderzocht: Steekproef op hele pagina's van acht paginatypen
   - Hoe: Taal van de hele pagina gemeten op P13, P03, P04, P21, P14, P02 en P10, en de startpagina met zoekresultaten; P02 helemaal bekeken.
   - Waargenomen: Op alle gemeten pagina's vinden beide herkenners Nederlands, gelijk aan de taal in de code. Nergens wijkt een stuk tekst af; de overige stukken zijn te kort om te bepalen. Dat komt overeen met het dossier.
   - Bewijs: `v-312-0005`, `v-312-0015`, `v-312-0027`, `v-312-0054`, `v-312-0079`, `v-312-0081`, `v-312-0082`, `v-312-0087`, `v-312-0073`
5. Onderzocht: Tekst in geopende onderdelen
   - Hoe: Zelf geopend en bekeken: het venster voor een cluster op P13, de uitklapper met tips op P21, de zoekresultaten en het smalle menu op P01 en de afvinklijst op P14. Dossier: de vastgelegde tekst van de toestanden doorzocht.
   - Waargenomen: Alle tekst in de vijf geopende onderdelen is Nederlands. Met een open onderdeel meet de pagina steeds als Nederlands, zonder afwijkend stuk. De meldingen na versturen heeft de eerste beoordelaar vastgelegd; die zijn Nederlands.
   - Bewijs: `v-312-0007`, `v-312-0008`, `v-312-0044`, `v-312-0054`, `v-312-0072`, `v-312-0073`, `v-312-0076`, `v-312-0078`, `v-312-0079`, `b-312-0082`, `b-312-0085`
6. Onderzocht: De vier kandidaten uit de rondgang
   - Hoe: De genoemde plekken zelf opgezocht en gemeten op P03, P04, P06 en P21.
   - Waargenomen: Het klankschrift op P03 is de uitspraak van een Nederlandse naam. De Engelse woorden op P03, P04, P06 en P21 zijn termen en titels van hooguit drie woorden, een vakterm van vier woorden, de naam van een licentie en een boektitel van één woord. De kop en de zinnen eromheen meten als Nederlands.
   - Bewijs: `v-312-0016`, `v-312-0017`, `v-312-0018`, `v-312-0028`, `v-312-0029`, `v-312-0030`, `v-312-0034`, `v-312-0035`, `v-312-0050`, `v-312-0059`

**Hoe zeker is dit oordeel**

Beoordelaar: Voldoet. Verificatie, tevens eindoordeel: Voldoet.

Poging om het oordeel onderuit te halen: Alle tekstbestanden, linkteksten, koppen en namen opnieuw doorzocht op Engelse reeksen. Gemeten waar de beoordelaar niet keek: P13 met het clustervenster, P24, P02, P10, P14 met de afvinklijst, de zoekresultaten en het smalle menu. Elke Engelse titel had een taalaanduiding; de linktekst op P24 en de vette term op P21 zijn vaktermen. Geen tegenvoorbeeld gevonden.

Grondslag: Beslisregel R3, procedure versie 7 (oordeel).

Beperking van de procedure: Gelezen is de volledige zichtbare tekst van elke pagina in de begintoestand, plus linkteksten, koppen, tekstalternatieven en de tekst in de vastgelegde toestanden (de cookiebanner, geopende menu's, dialogen en uitklappers). Mag de run niet versturen, dan zijn meldingen die de server na het versturen geeft niet gelezen; op een testomgeving waar versturen mag, zijn ze dat wel. Taalherkenning is onbetrouwbaar bij minder dan vier woorden; korte passages zijn op het oog beoordeeld.

<a id="bijlage-3.2.1"></a>

### 3.2.1 Bij focus

**Uitkomst:** ● Voldoet · Niveau A · EN 301 549: 9.3.2.1 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/on-focus.html) · [Terug naar het resultaat](#sc-3.2.1)

**Hoe is dit vastgesteld**

1. Onderzocht: Verandert het adres van de pagina als een onderdeel met Tab focus krijgt
   - Hoe: Dossier: de wandeling met Tab op alle 29 pagina's in de begintoestand op een breed scherm, met na elke stop een controle van het adres.
   - Waargenomen: 29 van 29 pagina's zijn helemaal doorlopen, samen 1269 stops. Het adres bleef op elke pagina gelijk. Geen wandeling liep vast of werd afgebroken. Er zijn geen onderdelen die met Tab en ook met de pijltjestoetsen niet te bereiken waren.
   - Bewijs: `keyboard`, `focusChanges`
2. Onderzocht: Steekproef op pagina's die de eerste beoordelaar niet zelf doorliep
   - Hoe: Zelf met Tab doorlopen op een breed scherm: P17 (richtlijn met tips), P29 (huidige versie), P21 (richtlijn open source) en P11 (overzicht van richtlijnen).
   - Waargenomen: P17 gaf 57 stops, P29 gaf 23 stops, P21 gaf 55 stops en P11 gaf 39 stops. Dat zijn dezelfde aantallen als in het dossier. Alle vier de wandelingen liepen af zonder ander adres, zonder nieuw venster en zonder nieuwe dialoog.
   - Bewijs: `keyboard`, `v-321-0003`, `v-321-0005`, `v-321-0019`, `v-321-0034`
3. Onderzocht: Ingevulde formulieren in een venster: gebeurt er iets als een keuzelijst, tekstveld of knop focus krijgt
   - Hoe: Zelf doorlopen: het ingevulde feedbackvenster op P14, vooruit met Tab en terug met Shift+Tab over de twee keuzelijsten en de sluitknop, en het ingevulde proefformulier voor een cluster op P13.
   - Waargenomen: In het feedbackvenster 4 stops vooruit en 4 stappen terug; in het clusterformulier 8 stops, waarvan 5 keuzelijsten. Bij geen enkele stop veranderde het adres, de gekozen waarde of iets anders op het scherm. Het venster bleef open en er kwam geen venster bij.
   - Bewijs: `v-321-0008`, `v-321-0010`, `v-321-0011`, `v-321-0012`, `v-321-0014`, `v-321-0016`, `v-321-0017`
4. Onderzocht: Menu's op een smal scherm, zoekresultaten en de afvinklijst: blijft alles rustig bij focus
   - Hoe: Dossier: 9 knoppen geactiveerd, waarvan 3 op een smal scherm. Zelf met Tab doorlopen: het zijmenu op P11 en het hoofdmenu op P02 op 320 pixels breed, het zoekvenster met resultaten op P29 en P14 met de afvinklijst gebruikt.
   - Waargenomen: Het dossier telt 6 vensters met 2, 9, 5, 3, 4 en 3 stops binnen. De eigen wandelingen gaven 2 stops in elk van de drie vensters en 67 stops op P14. Elke wandeling liep af zonder ander adres, zonder nieuw venster en zonder nieuwe dialoog.
   - Bewijs: `dialogs`, `v-321-0021`, `v-321-0022`, `v-321-0030`, `v-321-0032`, `v-321-0028`
5. Onderzocht: Links in het zijmenu die met een pijltjestoets focus krijgen
   - Hoe: Dossier: elke reeks die met pijltjestoetsen focus krijgt, is opnieuw doorlopen. Zelf op P26 met Tab naar de eerste link van het zijmenu gegaan en 2 keer pijl omlaag gedrukt.
   - Waargenomen: Volgens het dossier kregen 548 elementen in 49 lijsten zo focus, zonder ander adres en zonder nieuw venster. Bij de eigen proef schoof de focus per toets één link op. Er verscheen of verdween niets en de pagina bleef dezelfde.
   - Bewijs: `focusChanges`, `v-321-0036`, `v-321-0037`, `v-321-0038`
6. Onderzocht: De sprong omhoog op P04 en P10, en de twee plekken waar een extra venster is geteld (kopieerknop op P04, wisknop in het zoekvenster)
   - Hoe: Dossier en de waarnemingen van de eerste beoordelaar nagelezen, met zijn schermafbeelding van P04. Zelf het zoekvenster met resultaten doorlopen, langs de wisknop.
   - Waargenomen: De sprong is de overgang van het lange zijmenu naar de eerste link in de tekst. Geen element met focus werd bedekt (0 gevallen). Het getelde venster bij de kopieerknop is een tekstwolkje dat na het activeren verschijnt, niet bij focus. Langs de wisknop liep de eigen wandeling door zonder ander adres of nieuw venster.
   - Bewijs: `keyboard`, `dialogs`, `b-321-0005`, `b-321-0007`, `b-321-0045`, `b-321-0046`, `v-321-0030`

**Hoe zeker is dit oordeel**

Beoordelaar: Voldoet. Verificatie, tevens eindoordeel: Voldoet.

Poging om het oordeel onderuit te halen: Gezocht waar de beoordelaar niet keek: vier andere paginatypen (P17, P29, P21, P11), de ingevulde formulieren voor feedback en cluster met hun keuzelijsten, vooruit en terug, de menu's op 320 pixels op P11 en P02, zoekresultaten op P29, de afvinklijst op P14 en pijltjestoetsen in het zijmenu van P26. Samen ruim 250 stops. Nergens een ander adres, een nieuw venster, een nieuwe dialoog of een verspringende focus. Aantallen stops gelijk aan het dossier. Het oordeel blijft staan.

Grondslag: Beslisregel R3, procedure versie 6 (probe).

Beperking van de procedure: Vastgesteld is of het adres verandert, een venster of dialoog opent of de focus verspringt wanneer een element focus krijgt, op de pagina's van de steekproef en in de vastgelegde toestanden. Er is gemeten met het toetsenbord in één browser (Chromium), zonder schermlezer. Wat achter een login ligt, is niet doorlopen. Mag de run niet versturen, dan is ook niet doorlopen wat pas na het versturen van een formulier verschijnt; op een testomgeving waar versturen mag, is dat wel gedaan.

<a id="bijlage-3.2.2"></a>

### 3.2.2 Bij input

**Uitkomst:** ● Voldoet · Niveau A · EN 301 549: 9.3.2.2 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/on-input.html) · [Terug naar het resultaat](#sc-3.2.2)

**Hoe is dit vastgesteld**

1. Onderzocht: Welke onderdelen met een instelling de site heeft
   - Hoe: Dossier: de telling van formulieren en de lijst van velden op 29 pagina's. Zelf gekeken en gezocht op P13 (proefformulier open), P18, P29 (feedbackvenster open, 320 pixels breed), P01 (zoekvenster open) en P14 (proefformulier open).
   - Waargenomen: 62 keer een formulier aangetroffen op 29 pagina's. Selectievakjes: 73 keer, op P14 (24), P18 (15), P22 (20) en P27 (14). Op elke pagina een zoekveld en een feedbackformulier met 2 keuzelijsten en 2 tekstvelden. Op P13 en P14 een proefformulier met 1 tekstveld en 7 keuzelijsten. De lijst is op de bekeken pagina's compleet: geen schuifregelaars, tabbladen, keuzerondjes, schakelaars of zelfgebouwde keuzelijsten. Er is geen cookiemelding.
   - Bewijs: `forms`, `controls`, `dialogs`, `v-322-0002`, `v-322-0003`, `v-322-0027`, `v-322-0028`, `v-322-0029`, `v-322-0035`, `v-322-0036`, `v-322-0048`, `v-322-0060`
2. Onderzocht: Tekstvelden: invullen en verlaten met Tab
   - Hoe: Dossier: de formulierproef op het feedbackformulier (1 formulier onderzocht, op P01). Zelf ingevuld en met Tab verlaten: het tekstveld van het proefformulier op P13, de 2 tekstvelden van het feedbackformulier op P29 bij 320 pixels en het zoekveld op P01.
   - Waargenomen: Dossier voor het feedbackformulier: geen verandering, adres en vensters bleven gelijk na invullen en verlaten van elk veld. Zelf 4 van 4 tekstvelden gemeten: het adres bleef gelijk, er ging geen formulier weg en de focus ging steeds naar het volgende onderdeel. In het zoekvenster verschijnen de resultaten tijdens het typen in hetzelfde venster; dat is nieuwe inhoud.
   - Bewijs: `formErrors`, `v-322-0014`, `v-322-0015`, `v-322-0039`, `v-322-0040`, `v-322-0041`, `v-322-0042`, `v-322-0043`, `v-322-0046`
3. Onderzocht: Zoekveld: het tweede venster dat het instrument telde na Tab
   - Hoe: Zoekvenster op P01 geopend, de vaste zoekwaarde getypt, Tab gedrukt en daarna gekeken wat er open stond.
   - Waargenomen: Na Tab telde het instrument 2 vensters in plaats van 1. Dat is het hulplabel "Wis zoekopdracht" bij de knop die de focus kreeg, het volgende onderdeel na het zoekveld. Het zoekvenster bleef open, het adres bleef gelijk en er opende geen nieuw venster van de browser.
   - Bewijs: `v-322-0046`, `v-322-0047`, `v-322-0048`
4. Onderzocht: Selectievakjes en de keuzelijsten van het feedbackformulier: wijzigen
   - Hoe: Dossier: de proef waarin elk soort selectievakje en keuzelijst is gewijzigd, op de pagina en in de geopende vensters. Zelf nagemeten op andere pagina's dan het dossier: 1 selectievakje op P18 met de spatiebalk en de 2 keuzelijsten van het feedbackformulier op P29 bij 320 pixels.
   - Waargenomen: Dossier: 60 onderdelen gewijzigd (keuzelijsten van het feedbackformulier op P01 en selectievakjes); bij 0 van 60 veranderde het adres of het aantal vensters. Zelf: het vakje werd aangevinkt en de focus bleef erop; beide keuzelijsten kregen de nieuwe waarde en het venster bleef open op hetzelfde adres. Geen ander adres, geen nieuw venster, geen verstuurd formulier, zoals in het dossier.
   - Bewijs: `settings`, `v-322-0031`, `v-322-0032`, `v-322-0033`, `v-322-0037`, `v-322-0038`, `v-322-0043`
5. Onderzocht: Proefformulier Kubernetes cluster aanmaken: elke keuzelijst wijzigen
   - Hoe: Deze velden staan niet in de proeven van het dossier. Op P13 het formulier geopend en alle 7 keuzelijsten één keer gewijzigd, verdeeld over twee verse pagina's. Op P14 het formulier zelf geopend via de inlogknop en het prijsmodel gewijzigd.
   - Waargenomen: 7 van 7 keuzelijsten op P13 gewijzigd (Organisatie, Prijsmodel, Hoge beschikbaarheid, Regio(s), Secundaire regio, Grootte, Kubernetes versie) en 1 op P14. Bij Prijsmodel, Hoge beschikbaarheid en Grootte wisselen velden en de regel met kosten, bijvoorbeeld "Geschatte kosten: €59,99 per maand, €719,88 per jaar." Dat is nieuwe inhoud in hetzelfde venster. Nergens een ander adres, een nieuw venster, een verstuurd formulier of een focus die wegspringt.
   - Bewijs: `v-322-0009`, `v-322-0010`, `v-322-0011`, `v-322-0013`, `v-322-0018`, `v-322-0019`, `v-322-0022`, `v-322-0051`, `v-322-0052`, `v-322-0054`, `v-322-0061`, `v-322-0062`

**Hoe zeker is dit oordeel**

Beoordelaar: Voldoet. Verificatie, tevens eindoordeel: Voldoet.

Poging om het oordeel onderuit te halen: Gezocht naar een tegenvoorbeeld waar de beoordelaar niet keek: een selectievakje op P18, het feedbackformulier op P29 bij 320 pixels breed, het proefformulier op P14 en alle 7 keuzelijsten plus het tekstveld op P13, en het zoekveld op P01. Ook gezocht naar onderdelen die niet op de lijst staan. Elke wijziging gaf alleen een nieuwe waarde of nieuwe inhoud in hetzelfde venster; nergens een ander adres, nieuw venster, verstuurd formulier of wegspringende focus.

Grondslag: Beslisregel R2, procedure versie 7 (probe+oordeel).

Beperking van de procedure: Mag de run niet versturen, dan is een onderdeel dat bij wijzigen een formulier verstuurt wel te herkennen aan het tegengehouden verzoek, maar is de pagina die erop zou volgen niet te zien; op een testomgeving waar versturen mag, is die wel vastgelegd. Van gelijke onderdelen is elk soort gewijzigd op de pagina's en toestanden van de steekproef, niet elk exemplaar op elke pagina. Wat achter een login ligt, is niet onderzocht.

<a id="bijlage-3.2.3"></a>

### 3.2.3 Consistente navigatie

**Uitkomst:** ● Voldoet · Niveau AA · EN 301 549: 9.3.2.3 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/consistent-navigation.html) · [Terug naar het resultaat](#sc-3.2.3)

**Hoe is dit vastgesteld**

1. Onderzocht: De volgorde van links en knoppen in de vaste delen van de site op een breed scherm
   - Hoe: Tabel met gebieden in het dossier, 29 pagina's, 1280 pixels breed; zelf bekeken op P29, P14, P07 en P01 (4 paginatypen)
   - Waargenomen: 10 gebieden op 29 pagina's. 5 zijn op alle 29 pagina's gelijk: kop (3 links), hoofdmenu (3 links), hulplinks (3 items), voet (8 links) en juridische links (4 links). De zijmenu's Over NeRDS (8 links, 8 pagina's) en Richtlijnen (18 links, 18 pagina's) hebben elk 1 variant. De inhoudsopgave van de pagina (16 varianten) is inhoud van de pagina zelf. Op de 4 bekeken pagina's is de volgorde gelijk aan het dossier.
   - Bewijs: `consistency`, `v-323-0002`, `v-323-0004`, `v-323-0006`, `v-323-0008`
2. Onderzocht: Het kruimelpad en de links naar de vorige en volgende pagina
   - Hoe: Varianten in het dossier twee aan twee vergeleken; zelf bekeken op P07 (breed en smal) en P11 (768 pixels)
   - Waargenomen: Kruimelpad: 7 varianten op 26 pagina's. Elke variant begint met Home, daarna Richtlijnen of Over NeRDS, daarna de bovenliggende pagina; alleen de lengte verschilt. Vorige en volgende: 26 varianten, één per pagina; Vorige staat steeds voor Volgende, op P07 staat alleen Vorige. Op P07 en P11 staan ze onder de tekst in dezelfde volgorde: vorige en volgende, kruimelpad, voet.
   - Bewijs: `consistency`, `v-323-0006`, `v-323-0019`, `v-323-0023`
3. Onderzocht: De volgorde van de paginagebieden per paginatype
   - Hoe: Varianten van de paginagebieden in het dossier, 29 pagina's
   - Waargenomen: 16 varianten op 29 pagina's. In elke variant staan de vaste gebieden in dezelfde volgorde: kop, hoofdinhoud, hoofdmenu, hulplinks, voet, juridische links. Zijmenu, inhoudsopgave, vorige en volgende en kruimelpad ontbreken op P01, P02 en P29, en staan elders steeds op dezelfde plek tussen de vaste gebieden. De varianten verschillen verder alleen in het aantal voetjes van kaarten in de inhoud.
   - Bewijs: `landmarks`
4. Onderzocht: De plaats van de knoppen tussen de links in de kop, op het scherm, op drie breedtes
   - Hoe: Zelf gekeken op 1280 pixels (P29, P14, P07, P01), op 320 pixels (P29, P14, P07) en op 768 pixels (P01, P11, P14); op P14 ook met Tab doorlopen
   - Waargenomen: Breed, 4 pagina's: logo, sitenaam, Home, Richtlijnen, Over NeRDS, Zoeken, Feedback, GitHub. Smal, 3 pagina's: logo, sitenaam, Menu, Zoeken, Feedback, GitHub, daarna de knop van het zijmenu. Op 768 pixels, 3 pagina's: Menu, Zoeken, Feedback en een knop Meer opties met daarin GitHub, op dezelfde plek als de link GitHub. Per breedte is de volgorde op elke pagina gelijk.
   - Bewijs: `v-323-0002`, `v-323-0004`, `v-323-0006`, `v-323-0008`, `v-323-0010`, `v-323-0015`, `v-323-0019`, `v-323-0021`, `v-323-0023`, `v-323-0025`, `v-323-0027`
5. Onderzocht: Het geopende hoofdmenu op een smal en een halfbreed scherm
   - Hoe: Het dossier heeft geen rijen voor het geopende menu en het smalle scherm. De beoordelaar opende het menu op 320 pixels op 1 pagina van elk van de 18 paginatypen; zelf nagemeten op P29 (320 pixels) en P14 (768 pixels)
   - Waargenomen: Op beide pagina's toont het geopende menu dezelfde 4 items in dezelfde volgorde: de knop Sluit, dan Home, Richtlijnen en Over NeRDS. Dat is de volgorde van het hoofdmenu op een breed scherm in het dossier, en dezelfde die de beoordelaar op 18 van 18 paginatypen zag.
   - Bewijs: `v-323-0012`, `v-323-0013`, `v-323-0029`, `v-323-0030`, `b-323-0010`, `b-323-0016`, `b-323-0026`
6. Onderzocht: Het geopende zijmenu en de voet op een smal scherm
   - Hoe: Zijmenu Richtlijnen geopend op 320 pixels op P14; voet bekeken op 320 pixels op P07 en op 768 pixels op P01 en P11
   - Waargenomen: Zijmenu Richtlijnen op P14: de knop Sluit en alle 18 links in dezelfde volgorde als in het dossier, daarna de inhoudsopgave van de pagina. De voet heeft op P07, P01 en P11 dezelfde 8 links en 4 juridische links in dezelfde volgorde als op een breed scherm.
   - Bewijs: `v-323-0016`, `v-323-0017`, `v-323-0019`, `v-323-0021`, `v-323-0023`, `consistency`

**Hoe zeker is dit oordeel**

Beoordelaar: Voldoet. Verificatie, tevens eindoordeel: Voldoet.

Poging om het oordeel onderuit te halen: Gezocht naar een pagina of breedte met een andere volgorde. Breed bekeken: P29, P14, P07 en P01. Smal: P29 met menu open, P14 met zijmenu open (alle 18 links), voet van P07. Nieuw: 768 pixels op P01, P11 en P14, waar GitHub achter een knop Meer opties zit; menu open op P14 en de kop met Tab doorlopen. Overal dezelfde volgorde per breedte. Geen tegenvoorbeeld gevonden.

Grondslag: Beslisregel R3, procedure versie 4 (probe+oordeel).

Beperking van de procedure: De volgorde is op alle pagina's van de steekproef vergeleken binnen navigatie-, kop- en voetgebieden, op 1280 pixels breed in de begintoestand. Het geopende menu en de smalle weergave vergelijkt de veegronde niet; die zijn alleen vergeleken waar de beoordelaar dat zelf deed, op enkele pagina's. Een volgorde die een gebruiker na inloggen zelf kan instellen, is niet onderzocht.

<a id="bijlage-3.2.4"></a>

### 3.2.4 Consistente identificatie

**Uitkomst:** ● Voldoet · Niveau AA · EN 301 549: 9.3.2.4 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html) · [Terug naar het resultaat](#sc-3.2.4)

**Hoe is dit vastgesteld**

1. Onderzocht: Hoeveel pagina's, links en bedieningsonderdelen zijn vergeleken en welke rijen opzij zijn gezet
   - Hoe: Dossier: links en controls, alle 29 pagina's, begintoestand, 1280 breed. De opzij gezette link zelf opgezocht en gemeten op P17.
   - Waargenomen: 29 pagina's, 570 verschillende links en 88 verschillende bedieningsonderdelen. Eén link is opzij gezet: de link "hier" op P17 heeft een algemene linktekst en hoort bij criterium 2.4.4. Geen knop of veld zonder naam (0 rijen), dus niets voor criterium 4.1.2.
   - Bewijs: `links`, `controls`, `v-324-0043`
2. Onderzocht: Of een item in kop, menu of voet op de ene pagina anders heet dan op de andere
   - Hoe: Dossier: consistency.regions op 29 pagina's. De twee namen voor de pagina Over NeRDS zelf gemeten op P05 met tg look --full, tg name, tg ax en tg html.
   - Waargenomen: 5 gebieden zijn op alle 29 pagina's gelijk: samen 21 items, geen wisselt van naam. De andere gebieden verschillen alleen per plek in de site. Het zijmenu noemt de pagina "Over de Nederlandse Richtlijn Digitale Systemen", het hoofdmenu en de voet "Over NeRDS". Dat is een ander gebied, en de afkorting duidt dezelfde pagina aan.
   - Bewijs: `consistency`, `v-324-0004`, `v-324-0008`, `v-324-0009`, `v-324-0012`, `v-324-0013`, `v-324-0007`
3. Onderzocht: Of knoppen of velden met dezelfde functie op verschillende pagina's anders heten
   - Hoe: Dossier: controls.rows, 88 rijen nagelopen op dubbele functies, alle 29 pagina's. Eén kaart op P14 zelf gemeten.
   - Waargenomen: Alleen de knoppen "Zoeken" en "Feedback" staan op alle 29 pagina's, in hetzelfde gebied en met dezelfde naam. 4 knoppen op kaarten staan elk op 2 pagina's en de uitklapper "Praktische tips" op 4, telkens met dezelfde naam. De 73 selectievakjes staan elk op één pagina. Geen paar met dezelfde functie en een andere naam.
   - Bewijs: `controls`, `v-324-0031`
4. Onderzocht: Steekproef op breed scherm: kop, menu, voet, pictogrammen en het venster Feedback
   - Hoe: tg look --full op P05 (tekstpagina), P12 (richtlijn) en P29 (huidige versie); tg name op de pictogrammen op P05 en P12; knop Feedback geopend op P29.
   - Waargenomen: Op alle drie pagina's 9 onderdelen in de kop en 12 links in de voet, met dezelfde namen als in het dossier. De knop "Zoeken" en de link "GitHub" hebben op P05 en P12 dezelfde naam. De links naar andere sites in de voet eindigen overal op "Opent in nieuw tabblad". Het venster "Feedback geven" toont op P29 dezelfde velden en knoppen als de beoordelaar op P01 en P05 zag.
   - Bewijs: `v-324-0004`, `v-324-0016`, `v-324-0077`, `v-324-0010`, `v-324-0011`, `v-324-0019`, `v-324-0020`, `v-324-0021`, `v-324-0022`, `v-324-0079`, `b-324-0054`, `b-324-0061`
5. Onderzocht: Steekproef op smal scherm: de knop Menu, het geopende menu en het venster Zoeken
   - Hoe: tg open --width 320, tg look, tg name en tg click op P04 (bijdragen), P10 (versies), P12 (richtlijn) en P02 (pagina niet gevonden).
   - Waargenomen: Op alle vier pagina's staan in de kop de knoppen "Menu", "Zoeken" en "Feedback" en de link "GitHub". Op P04 en P02 opent de knop een venster "Menu" met dezelfde 3 links: Home, Richtlijnen, Over NeRDS, en de knop "Sluit". Het venster "Zoeken" op P02 heeft hetzelfde zoekveld "Zoek in de NeRDS" als op de andere pagina's.
   - Bewijs: `v-324-0049`, `v-324-0051`, `v-324-0053`, `v-324-0054`, `v-324-0060`, `v-324-0065`, `v-324-0069`, `v-324-0072`, `v-324-0075`, `b-324-0058`
6. Onderzocht: De knop van het zijmenu op smal scherm: zijn naam per sectie en tegenover de link met dezelfde naam in het hoofdmenu
   - Hoe: tg name, tg click en tg look op P04, P10 en P12, 320 breed.
   - Waargenomen: De knop heet "Over NeRDS" op P04 en P10 en "Richtlijnen" op P12. Hij opent een venster met dezelfde titel en het menu van die sectie: de naam volgt de inhoud. De link met dezelfde naam in het venster Menu gaat naar een pagina. Dezelfde naam voor twee functies is het omgekeerde van wat dit criterium vraagt. Of de naam het doel van de knop beschrijft, hoort bij criterium 2.4.6.
   - Bewijs: `v-324-0052`, `v-324-0056`, `v-324-0057`, `v-324-0062`, `v-324-0063`, `v-324-0066`, `v-324-0067`, `v-324-0054`

**Hoe zeker is dit oordeel**

Beoordelaar: Voldoet. Verificatie, tevens eindoordeel: Voldoet.

Poging om het oordeel onderuit te halen: Alle negen kandidaten zelf nagemeten. Daarna gekeken waar de beoordelaar niet keek: P29 (huidige versie) op breed scherm met het venster Feedback, en P02 (pagina niet gevonden) op 320 breed met de vensters Menu en Zoeken. Kop, voet, menu en vensters tonen daar dezelfde onderdelen met dezelfde namen als op P05, P12, P04 en P10. De knop van het zijmenu wisselt van naam met de sectie die hij opent; dat volgt de inhoud. Geen tegenvoorbeeld gevonden.

Grondslag: Beslisregel R3, procedure versie 4 (oordeel).

Beperking van de procedure: Vergeleken zijn de onderdelen die op de pagina's en toestanden van de steekproef terugkomen. Of twee onderdelen hetzelfde doen, is afgeleid uit hun plek, rol, bestemming en wat er na een klik gebeurt. Een functie achter een inlog is niet vergeleken; een functie die pas na het versturen van een formulier werkt, alleen als de run op een testomgeving mocht versturen.

<a id="bijlage-3.2.6"></a>

### 3.2.6 Consistente hulp

**Uitkomst:** ● Voldoet · Niveau A · EN 301 549: 9.3.2.6 · Nieuw in WCAG 2.2 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/consistent-help.html) · [Terug naar het resultaat](#sc-3.2.6)

**Hoe is dit vastgesteld**

1. Onderzocht: Welke hulp de site aanbiedt
   - Hoe: Dossier nagelezen: de lijst met hulpmiddelen, de links, de knoppen, de ingesloten vensters. Zelf op 8 pagina's gezocht naar e-mailadressen, telefoonnummers en links om te mailen of te bellen.
   - Waargenomen: 29 pagina's, 570 verschillende links, 88 verschillende bedieningselementen, 0 ingesloten vensters. Van de 48 rijen in de lijst zijn er 3 hulp: de voetlink naar de contactpagina (29 pagina's), dezelfde link in het zijmenu (8 pagina's) en een e-mailadres in de tekst (4 pagina's). Daarbij komt de knop "Feedback" in de kop (29 pagina's). Zelf gezocht: geen telefoonnummer, geen ander e-mailadres, geen chat.
   - Bewijs: `consistency`, `links`, `controls`, `inventoryCounts`, `v-326-0008`, `v-326-0012`, `v-326-0016`, `v-326-0020`, `v-326-0024`, `v-326-0028`, `v-326-0032`, `v-326-0036`
2. Onderzocht: De plek van de link "Contact en bijdragen" in de voet op een breed scherm
   - Hoe: Dossier: de volgorde van de links in de voet en van de paginagebieden op 29 pagina's. Zelf de hele pagina bekeken op P14, een paginatype dat de beoordelaar niet op een breed scherm bekeek, naast zijn 5 pagina's.
   - Waargenomen: Volgens het dossier is de voet op alle 29 pagina's gelijk; de link is de tweede van acht. Op P14 staat de voet als laatste blok, en de link staat als tweede onder de kop "Over deze site", na "Over NeRDS" en voor "Versies". Dat is gelijk aan het dossier en aan wat de beoordelaar op 5 andere pagina's zag.
   - Bewijs: `consistency`, `landmarks`, `v-326-0003`, `v-326-0006`, `b-326-0004`, `b-326-0008`, `b-326-0010`, `b-326-0012`, `b-326-0017`
3. Onderzocht: De plek van de knop "Feedback" in de kop, ook in het donkere schema
   - Hoe: Dossier: de groep Hulplinks op 29 pagina's. Zelf gekeken op P14 (licht) en P22 (donker), en op P22 het venster achter de knop geopend.
   - Waargenomen: Volgens het dossier is de groep op alle 29 pagina's gelijk, met drie onderdelen. Op P14 en P22 staat de knop rechts in de kop, na de knop Zoeken en voor de link GitHub. Op P22 opent de knop hetzelfde venster "Feedback geven", met de knoppen "Via e-mail" en "Via GitHub Issues".
   - Bewijs: `consistency`, `v-326-0006`, `v-326-0054`, `v-326-0058`, `v-326-0059`
4. Onderzocht: De link "Contact en bijdragen" in het zijmenu van het deel Over NeRDS
   - Hoe: Dossier: de volgorde van het zijmenu op P03 tot en met P10. De beoordelaar keek op 4 van die pagina's.
   - Waargenomen: Volgens het dossier heeft het zijmenu op alle 8 pagina's dezelfde acht links in dezelfde volgorde; deze link is de tweede. Buiten dit deel van de site staat het zijmenu er niet; de voetlink en de knop in de kop staan daar wel.
   - Bewijs: `consistency`, `b-326-0006`, `b-326-0020`, `b-326-0023`, `b-326-0026`
5. Onderzocht: Het e-mailadres in de tekst van vier pagina's
   - Hoe: Zelf op P04, P05, P06 en P08 elke link met het adres opgezocht en gelezen onder welke kop en in welke zin hij staat.
   - Waargenomen: Het adres "bureau.architectuur@minbzk.nl" staat 6 keer op 4 pagina's, steeds in een zin van de lopende tekst over het onderwerp van die pagina, onder koppen als "Heb je vragen?" en "Vragen?". Het is geen vast blok dat op elke pagina terugkomt. Een vermelding in de lopende tekst verstoort de vaste plek niet; de vaste hulp staat in de kop en de voet.
   - Bewijs: `v-326-0041`, `v-326-0042`, `v-326-0045`, `v-326-0048`, `v-326-0051`, `v-326-0052`
6. Onderzocht: De plek van de hulp op een smal scherm
   - Hoe: Zelf gekeken op 320 pixels breed op P22 en P07, twee pagina's die de beoordelaar niet smal bekeek: de kop en de voet. De beoordelaar keek op 8 andere pagina's.
   - Waargenomen: Op P22 en P07 staat de knop "Feedback" in de kop als derde knop, na Menu en Zoeken en voor GitHub. In de voet is de link "Contact en bijdragen" op beide pagina's de tweede onder "Over deze site". Dat is gelijk aan wat de beoordelaar op 8 pagina's zag.
   - Bewijs: `v-326-0061`, `v-326-0064`, `v-326-0066`, `v-326-0069`, `b-326-0028`, `b-326-0031`, `b-326-0034`, `b-326-0038`

**Hoe zeker is dit oordeel**

Beoordelaar: Voldoet. Verificatie, tevens eindoordeel: Voldoet.

Poging om het oordeel onderuit te halen: Gezocht naar een pagina waar de hulp anders staat: P14 breed en volledig, P22 in het donkere schema met het venster open, P22 en P07 op 320 pixels. Op 8 pagina's gezocht naar een ander e-mailadres of telefoonnummer. Van het e-mailadres in de tekst op 4 pagina's de plek gelezen: steeds een zin in de lopende tekst, geen terugkerend blok. Geen tegenvoorbeeld gevonden.

Grondslag: Beslisregel R2, procedure versie 4 (oordeel).

Beperking van de procedure: De plek van een hulpmiddel is vergeleken op de pagina's en toestanden van de steekproef. Hulp achter een inlog is niet gezien; hulp die pas na het versturen van een formulier verschijnt, alleen als de run op een testomgeving mocht versturen. Er is gekeken in één browser (Chromium).

<a id="bijlage-3.3.1"></a>

### 3.3.1 Foutidentificatie

**Uitkomst:** ● Voldoet · Niveau A · EN 301 549: 9.3.3.1 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html) · [Terug naar het resultaat](#sc-3.3.1)

**Hoe is dit vastgesteld**

1. Onderzocht: Welke formulieren en velden er zijn, en wat het dossier over fouten zegt
   - Hoe: Dossier: forms, inventoryForApplicability en formErrors
   - Waargenomen: 62 keer een formulier aangetroffen op 29 pagina's. Het dossier onderzocht 1 formulier (feedback, 4 velden, 4 pogingen op P01): bij elke poging ging geen verzoek weg en werd een veld als ongeldig gemarkeerd. Het proefformulier voor een cluster staat niet in dit onderdeel en is zelf gemeten.
   - Bewijs: `forms`, `formErrors`
2. Onderzocht: Fouttoestand van het feedbackformulier op een ander paginatype, knop Via e-mail
   - Hoe: Zelf gemeten op P18 in de toestand component-feedback: \`Test\` in Uw feedback, \`Test\` in het linkveld, Soort feedback leeg; velden verlaten, verstuurd, gekeken met en zonder kleur, de 3 velden uitgelezen
   - Waargenomen: Vóór versturen toont de site niets. Na versturen staat boven het formulier 'Uw feedback is nog niet verstuurd' met per veld de fout, en onder de keuzelijst 'Een soort feedback is nodig.' De 3 velden zijn als ongeldig gemarkeerd. Zonder kleur blijft de tekst leesbaar. Gelijk aan het dossier.
   - Bewijs: `v-331-0006`, `v-331-0007`, `v-331-0011`, `v-331-0012`, `v-331-0013`, `v-331-0014`, `v-331-0015`, `v-331-0016`, `v-331-0017`
3. Onderzocht: Feedbackformulier op een smal scherm, knop Via GitHub Issues
   - Hoe: Zelf gemeten op P26 op 320 pixels breed in de toestand component-feedback: leeg verstuurd en gekeken
   - Waargenomen: De site houdt het versturen tegen. Boven het formulier staat 'Uw feedback is nog niet verstuurd' met 'Soort feedback: kies een soort. Uw feedback: minimaal 10 tekens.' Onder beide velden staat rode tekst met een pictogram in het veld.
   - Bewijs: `v-331-0056`, `v-331-0057`
4. Onderzocht: Fouttoestand van het proefformulier Kubernetes cluster aanmaken op een andere pagina
   - Hoe: Zelf gemeten op P14: venster geopend, YubiKey gekozen, alle velden leeg verstuurd, gekeken met en zonder kleur, 2 velden uitgelezen. Daarna alles gekozen en een lange testtekst in de naam, en verstuurd
   - Waargenomen: Leeg verstuurd: 'Het cluster is nog niet aangemaakt' met 'Organisatie: kies een waarde. Naam van het cluster: vul een naam in. Prijsmodel: kies een waarde. Regio(s): kies een waarde. Grootte: kies een waarde.' Elke fout noemt het veld. De keuzelijsten krijgen geen tekst onder het veld. De lange naam werd niet afgekeurd.
   - Bewijs: `v-331-0036`, `v-331-0037`, `v-331-0038`, `v-331-0039`, `v-331-0040`, `v-331-0042`, `v-331-0051`
5. Onderzocht: Zoekveld: keurt het invoer af?
   - Hoe: Zelf gemeten op P05 in de toestand component-zoeken: leeg veld, Enter, veld uitgelezen en gekeken
   - Waargenomen: Er verandert niets en het veld is niet ongeldig. Het zoekveld merkt geen fout op en valt daarmee buiten dit criterium.
   - Bewijs: `v-331-0064`, `v-331-0065`, `v-331-0066`, `v-331-0067`
6. Onderzocht: Toestand van de keuzelijst Soort feedback vóór invoer en na herstel
   - Hoe: Zelf gemeten op P18: direct na openen toestand en code gelezen; na de fout Vraag gekozen, opnieuw uitgelezen en gekeken, en daarna verstuurd
   - Waargenomen: Vóór invoer geeft de browser de lege keuzelijst als ongeldig door; in de code staat geen \`aria-invalid\`. Na het kiezen van Vraag blijft de markering ongeldig en blijft de rode tekst eronder staan, terwijl de fout bij de 2 tekstvelden wel verdwijnt. Versturen lukt daarna gewoon. Dit hoort bij criterium 4.1.2.
   - Bewijs: `v-331-0004`, `v-331-0005`, `v-331-0018`, `v-331-0019`, `v-331-0020`, `v-331-0021`, `v-331-0023`, `v-331-0025`

**Hoe zeker is dit oordeel**

Beoordelaar: Voldoet. Verificatie, tevens eindoordeel: Voldoet.

Poging om het oordeel onderuit te halen: Beide formulieren opnieuw gemeten waar de beoordelaar niet keek: feedback op P18 en op P26 op 320 pixels breed, het proefformulier op P14 met alle velden leeg en met een lange naam, en het zoekveld op P05. Overal noemt de melding veld en fout in tekst. Wel gezien: de keuzelijst Soort feedback blijft na herstel als fout gemarkeerd; dat gaat over de toestand en is doorgegeven aan 4.1.2. Geen tegenvoorbeeld gevonden.

Grondslag: Beslisregel R3, procedure versie 6 (probe+oordeel).

Beperking van de procedure: Formulieren achter een inlog zijn niet onderzocht. Foutmeldingen die de server pas na het versturen geeft, zijn alleen gezien als de run op een testomgeving mocht versturen; anders is het verzoek tegengehouden. Per veld zijn vaste testwaarden geprobeerd, in één browser (Chromium).

<a id="bijlage-3.3.2"></a>

### 3.3.2 Labels of instructies

**Uitkomst:** ● Voldoet · Niveau A · EN 301 549: 9.3.3.2 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html) · [Terug naar het resultaat](#sc-3.3.2)

**Hoe is dit vastgesteld**

1. Onderzocht: Welke velden er zijn en of het dossier ze dekt
   - Hoe: Dossier: de lijst met velden en de formulierproef; de run mocht versturen. Zelf geteld op P27 en P22.
   - Waargenomen: 79 rijen in de lijst met velden: 73 selectievakjes op P14, P18, P22 en P27, en op alle 29 pagina's een zoekveld en een feedbackformulier met vier velden en twee knoppen. 1 formulier is in het dossier leeg en met ongeldige invoer verstuurd. Het proefformulier voor een cluster op P13 en P14 staat niet in de lijst en is zelf bekeken.
   - Bewijs: `forms`, `controls`, `formErrors`, `v-332-0053`, `v-332-0068`
2. Onderzocht: Zoekveld in het zoekvenster
   - Hoe: tg open P02 --state component-zoeken, look, type met de waarde search, look, html.
   - Waargenomen: Het veld heeft als tekst alleen de voorbeeldtekst "Zoek in de NeRDS". Na het typen van \`test\` is die weg. De kop "Zoeken" en het vergrootglas links in het veld blijven staan. Dat geldt als gelabeld; het is een zoekformulier met één veld.
   - Bewijs: `v-332-0003`, `v-332-0004`, `v-332-0005`, `v-332-0006`
3. Onderzocht: Feedbackformulier: labels, verplichting en vormeisen
   - Hoe: tg open P12 --state component-feedback, look, leeg versturen, invullen, link toevoegen, versturen; daarna op P21 op 320 pixels breed en leeg versturen via de tweede knop.
   - Waargenomen: 4 van 4 velden hebben een zichtbaar label, ook als ze gevuld zijn. 2 velden dragen het woord "Optioneel"; leeg versturen keurt precies de 2 andere af, via beide knoppen. "Minimaal 10 tekens." en het voorbeeld van een webadres staan vooraf onder de velden. Een toegevoegd linkveld krijgt hetzelfde label. Na geldig versturen kwamen er geen nieuwe velden.
   - Bewijs: `v-332-0008`, `v-332-0013`, `v-332-0018`, `v-332-0024`, `v-332-0026`, `v-332-0063`, `v-332-0066`
4. Onderzocht: Proefformulier voor een cluster in het venster op P14
   - Hoe: tg open P14, klik op Aanmaken, inlogwijze kiezen, look, html en ax van het naamveld, type met de waarde long, versturen, keuzes maken, opnieuw versturen, look.
   - Waargenomen: 7 van 7 velden hebben een zichtbaar label. Boven het formulier staat "Alle velden zijn verplicht." Met lege keuzelijsten kwam de melding "Het cluster is nog niet aangemaakt". Een naam met spaties is aangenomen; de code van het naamveld heeft geen vormeis. Na versturen kwamen er geen nieuwe velden.
   - Bewijs: `v-332-0037`, `v-332-0038`, `v-332-0040`, `v-332-0042`, `v-332-0047`, `v-332-0050`
5. Onderzocht: Selectievakjes in de afvinklijsten
   - Hoe: Dossier voor P14, P18, P22 en P27; tg open P27, find, scroll, look, name; tg open P22, find.
   - Waargenomen: 73 selectievakjes in het dossier, elk met een naam en geen enkel verplicht. Zelf gezien op P27: 14 vakjes, met zichtbare tekst naast elk vakje en de kop "Gewenste uitkomsten" erboven (3 vakjes in beeld). Op P22: 20 vakjes en 4 keer die kop.
   - Bewijs: `forms`, `v-332-0053`, `v-332-0058`, `v-332-0059`, `v-332-0068`, `v-332-0069`
6. Onderzocht: Groep om de selectievakjes en de foutmelding bij de keuzelijst
   - Hoe: tg find role:group, role:radiogroup en tag:fieldset op P27; tg ax op de keuzelijst Soort feedback op P12; look na het kiezen van een soort.
   - Waargenomen: Op P27 staat geen groep in de code om de 14 selectievakjes; de kop erboven is wel zichtbaar. Dat hoort bij criterium 1.3.1. De keuzelijst "Soort feedback" is bij het openen al als ongeldig gemarkeerd, en de melding "Een soort feedback is nodig." blijft staan nadat \`Vraag\` is gekozen. Dat hoort bij criterium 3.3.1.
   - Bewijs: `v-332-0054`, `v-332-0058`, `v-332-0010`, `v-332-0018`

**Hoe zeker is dit oordeel**

Beoordelaar: Voldoet. Verificatie, tevens eindoordeel: Voldoet.

Poging om het oordeel onderuit te halen: Elk onderdeel opnieuw bekeken op andere pagina's dan de beoordelaar: zoekvenster op P02, feedbackformulier op P12 en op P21 op 320 pixels, clusterformulier op P14, afvinklijsten op P27 en P22. Leeg, ongeldig en geldig verstuurd, ook via de tweede knop, en een naam met spaties geprobeerd. Geen veld zonder zichtbaar label, geen verborgen verplichting of vormeis, geen nieuwe velden na versturen.

Grondslag: Beslisregel R5, procedure versie 7 (probe+oordeel).

Beperking van de procedure: Velden achter een inlog zijn niet gezien. Velden in een stap die pas na het versturen komt, en een verplichting of vormeis die alleen de server controleert, zijn alleen gezien als de run op een testomgeving mocht versturen. Er is gekeken in één browser (Chromium).

<a id="bijlage-3.3.3"></a>

### 3.3.3 Foutsuggestie

**Uitkomst:** ● Voldoet · Niveau AA · EN 301 549: 9.3.3.3 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/error-suggestion.html) · [Terug naar het resultaat](#sc-3.3.3)

**Hoe is dit vastgesteld**

1. Onderzocht: Welke velden er zijn en welke het dossier heeft onderzocht
   - Hoe: Dossier: de lijst met velden en de formulierproef, over alle 29 pagina's
   - Waargenomen: 62 keer een formulier aangetroffen op 29 pagina's. 79 soorten velden: 73 selectievakjes in afvinklijsten, het zoekveld en de velden en knoppen van het feedbackformulier. De formulierproef onderzocht 1 formulier (feedback, op P01) met 4 velden. Versturen mocht; het formulier stuurde in geen poging een verzoek naar de server. Het proefformulier voor een cluster staat niet in de formulierproef en is zelf getest, op P14.
   - Bewijs: `forms`, `formErrors`
2. Onderzocht: Steekproef: het feedbackformulier leeg verstuurd, op een ander paginatype en op een smal scherm
   - Hoe: P04 op 320 pixels breed, feedbackvenster geopend met de knop Feedback, verstuurd met de knop Via e-mail en gekeken
   - Waargenomen: Dezelfde meldingen als in het dossier. Boven het formulier: "Soort feedback: kies een soort. Uw feedback: minimaal 10 tekens." Bij de keuzelijst: "Een soort feedback is nodig." Bij het tekstvak staat Minimaal 10 tekens. Beide meldingen zeggen wat er moet gebeuren: een keuze maken en een lengte halen.
   - Bewijs: `v-333-0004`, `v-333-0005`, `v-333-0006`, `formErrors`
3. Onderzocht: Steekproef: het feedbackformulier met verkeerde invoer
   - Hoe: Hetzelfde venster op P04: \`Test Persoon\` in het veld voor een link, \`12\` in Uw feedback, soort Fout gekozen, verstuurd, gekeken en het linkveld gelezen
   - Waargenomen: Boven het formulier: "Uw feedback: minimaal 10 tekens. Link naar een relevant document: vul een webadres in, bijvoorbeeld https://www.rijksoverheid.nl/onderwerpen." Bij het linkveld, ook als beschrijving voor hulpsoftware: "Een webadres zonder spaties, bijvoorbeeld https://www.rijksoverheid.nl/onderwerpen." De melding geeft de vorm en een voorbeeld. Geen wachtwoord of toetsvraag, dus geen uitzondering.
   - Bewijs: `v-333-0007`, `v-333-0008`, `v-333-0010`, `v-333-0012`, `v-333-0013`
4. Onderzocht: Wat het feedbackformulier doet na een goede invulling
   - Hoe: Hetzelfde venster op P04: een lange tekst in Uw feedback, \`https://example.com/\` in het linkveld, verstuurd met Via e-mail en gekeken
   - Waargenomen: Er kwam geen foutmelding. De pagina meldde "Bedankt voor uw feedback!" en het formulier werd leeggemaakt. Onder de velden blijven de aanwijzingen over de lengte en over het webadres als gewone uitleg staan. De keuzelijst Soort feedback is daarna voor hulpsoftware weer ongeldig zonder zichtbare melding; dat hoort bij criterium 3.3.1.
   - Bewijs: `v-333-0014`, `v-333-0015`, `v-333-0016`, `v-333-0017`
5. Onderzocht: Het proefformulier Kubernetes cluster aanmaken, op een andere pagina en langs een andere inlogkeuze
   - Hoe: P14, venster geopend met de knop Aanmaken, YubiKey gekozen, zonder iets in te vullen verstuurd en gekeken; daarna alles gekozen, \`https://example.com/\` in de naam en verstuurd
   - Waargenomen: Leeg: 5 velden afgekeurd met "Organisatie: kies een waarde. Naam van het cluster: vul een naam in. Prijsmodel: kies een waarde. Regio(s): kies een waarde. Grootte: kies een waarde." en bij het naamveld "Vul een naam in." Dat is genoeg voor lege verplichte velden. Het naamveld keurde het webadres niet af: er is geen vormfout te maken. Daarna kwam "Cluster succesvol aangemaakt!" Vier keuzelijsten zijn al ongeldig voor het versturen; dat hoort bij criterium 4.1.2.
   - Bewijs: `v-333-0020`, `v-333-0022`, `v-333-0026`, `v-333-0027`, `v-333-0028`, `v-333-0032`, `v-333-0036`, `v-333-0037`
6. Onderzocht: Het zoekveld en de afvinklijsten: velden die in geen onderzocht formulier voorkomen
   - Hoe: Dossier: de lijst met velden. Waarnemingen van de beoordelaar: op P12 leeg en met een lange tekst gezocht, op P14 een selectievakje aangevinkt en de regel-engines gedraaid. Bij de verificatie is het proefformulier op P14 in de code gelezen
   - Waargenomen: De 73 selectievakjes zijn volgens het dossier geen van alle verplicht en het zoekveld ook niet. De beoordelaar zag bij een lege en een lange zoekopdracht geen fout, en geen fout na het aanvinken. Hier merkt de site geen invoerfout op, dus is er geen melding te beoordelen. Bij de verificatie is dit niet opnieuw gemeten; het volgt uit de code.
   - Bewijs: `forms`, `b-333-0043`, `b-333-0045`, `b-333-0051`, `b-333-0053`, `v-333-0024`

**Hoe zeker is dit oordeel**

Beoordelaar: Voldoet. Verificatie, tevens eindoordeel: Voldoet.

Poging om het oordeel onderuit te halen: Beide formulieren opnieuw getest waar de beoordelaar niet keek: feedback op P04 op 320 pixels breed (leeg, \`Test Persoon\` als link, \`12\` als feedback, daarna geldig verstuurd) en het clusterformulier op P14 via YubiKey zonder vooraf gekozen prijsmodel (leeg, daarna met een webadres als naam). Elke melding noemt de keuze, de lengte of een voorbeeld. Geen melding zonder aanwijzing gevonden; het oordeel blijft staan.

Grondslag: Beslisregel R3, procedure versie 5 (probe+oordeel).

Beperking van de procedure: Formulieren achter een inlog zijn niet onderzocht. Foutmeldingen die pas verschijnen nadat de server de invoer heeft gecontroleerd, zijn alleen gezien als de run op een testomgeving mocht versturen. Per veld zijn alleen vaste testwaarden geprobeerd, in één browser (Chromium); bestandsvelden en datumkiezers van de browser zijn niet met ongeldige invoer getest.

<a id="bijlage-3.3.4"></a>

### 3.3.4 Foutpreventie (wettelijk, financieel, gegevens)

**Uitkomst:** ● Voldoet · Niveau AA · EN 301 549: 9.3.3.4 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/error-prevention-legal-financial-data.html) · [Terug naar het resultaat](#sc-3.3.4)

**Hoe is dit vastgesteld**

1. Onderzocht: Welke formulieren er zijn en welke onder dit criterium vallen
   - Hoe: Dossier: de velden per pagina en de formulierproef van alle 29 pagina's; zelf het feedbackvenster bekeken op P01
   - Waargenomen: 62 keer een formulier aangetroffen op 29 pagina's. Zoeken en feedback vallen buiten dit criterium: het feedbackvenster vraagt alleen een soort feedback, een tekst en een link. Het proefformulier voor een cluster op P13 en P14 toont een prijsmodel en geschatte kosten en is als bestelling beoordeeld.
   - Bewijs: `forms`, `formErrors`, `v-334-0037`
2. Onderzocht: Of het clusterformulier op P13 de invoer controleert en de bezoeker laat herstellen
   - Hoe: Zelf gemeten op P13: venster geopend, inlogknop aangeklikt, formulier leeg verstuurd en gekeken; daarna alle keuzelijsten gevuld met de naam leeg en opnieuw verstuurd
   - Waargenomen: Leeg versturen gaf de melding "Het cluster is nog niet aangemaakt". Organisatie, Naam van het cluster, Prijsmodel, Regio(s) en Grootte zijn als ongeldig gemarkeerd en het formulier blijft open. Met alleen de naam leeg volgde "Naam van het cluster: vul een naam in." en bleef het formulier staan.
   - Bewijs: `v-334-0009`, `v-334-0010`, `v-334-0021`, `v-334-0022`
3. Onderzocht: Wat er gebeurt na versturen met alle velden gevuld
   - Hoe: Zelf gemeten op P13: naam \`Test Persoon\` ingevuld, verstuurd en gekeken
   - Waargenomen: Direct volgde "Cluster succesvol aangemaakt!" met een overzicht van de gegevens, zonder aparte stap om te bevestigen en zonder knop om te verwijderen. Dat is geen gebrek: één van de drie middelen is genoeg en de controle op invoer is er. Het formulier heeft geen veld voor een bedrag, datum of rekeningnummer.
   - Bewijs: `v-334-0023`, `v-334-0024`, `v-334-0025`
4. Onderzocht: Of hetzelfde geldt op het tweede paginatype met dit formulier
   - Hoe: Zelf gemeten op P14: venster geopend met de knop Aanmaken, een andere inlogknop (YubiKey) aangeklikt, formulier leeg verstuurd en gekeken
   - Waargenomen: Zelfde uitkomst als op P13: de melding "Het cluster is nog niet aangemaakt" verschijnt, de vijf verplichte velden zijn als ongeldig gemarkeerd en het formulier blijft open.
   - Bewijs: `v-334-0029`, `v-334-0031`, `v-334-0033`, `v-334-0034`
5. Onderzocht: Of er een inlog is, of knoppen en links die een transactie uitvoeren zonder formulier
   - Hoe: Dossier: 88 verschillende bedieningselementen, 570 verschillende links en 79 velden doorzocht; zelf op P14 naar een wachtwoordveld gezocht en de inlogknoppen in het clustervenster aangeklikt
   - Waargenomen: Geen wachtwoordveld. De inlogknoppen in het clustervenster vragen geen gegevens: na een klik staat er kort "Authenticeren met SSO Rijksoverheid..." en verschijnt het formulier. Geen knop voor betalen, verwijderen of opzeggen. Eén link naar een inlogpagina gaat naar een andere site (lees-rijk.nl, op P17).
   - Bewijs: `controls`, `links`, `dialogs`, `v-334-0004`, `v-334-0005`, `v-334-0028`, `v-334-0031`

**Hoe zeker is dit oordeel**

Beoordelaar: Voldoet. Verificatie, tevens eindoordeel: Voldoet.

Poging om het oordeel onderuit te halen: Het clusterformulier opnieuw getest op P13 en P14 vanaf een verse pagina: leeg verstuurd, daarna met alleen de naam leeg, daarna volledig gevuld. Elke keer hield het formulier ontbrekende invoer tegen met een melding per veld. Gezocht naar een wachtwoordveld, een knop om te verwijderen na het aanmaken en transactiewoorden in knoppen en links van het dossier. Het feedbackvenster op P01 bekeken. Geen tegenvoorbeeld gevonden.

Grondslag: Beslisregel R3, procedure versie 6 (probe+oordeel).

Beperking van de procedure: Er wordt niet ingelogd: pagina's achter een inlog zijn niet onderzocht, terwijl transacties daar het vaakst voorkomen. Een controlestap, een bevestiging of een mogelijkheid tot herroepen die pas na het versturen komt, is alleen gezien als de run op een testomgeving mocht versturen.

<a id="bijlage-3.3.7"></a>

### 3.3.7 Overbodige invoer

**Uitkomst:** ? Kan niet bepalen · [Terug naar het resultaat](#sc-3.3.7)

**Hoe is dit vastgesteld**

1. Onderzocht: Welke formulieren en processen de site heeft
   - Hoe: Dossier: velden, knoppen, geopende onderdelen en de volledige tekst van 29 pagina's. Zelf het feedbackvenster geopend op P09 en P05 en het proefformulier op P14.
   - Waargenomen: Op alle 29 pagina's één zoekveld en één feedbackformulier met vier velden en twee verzendknoppen. Op P13 en P14 een proefformulier voor een cluster in drie stappen. 88 verschillende knoppen en 9 geopende onderdelen zijn in het dossier nagelopen. Geen ander proces met stappen en geen echte inlog gevonden.
   - Bewijs: `forms`, `controls`, `dialogs`, `language`, `formErrors`, `v-337-0010`, `v-337-0024`, `v-337-0042`
2. Onderzocht: Het proefformulier voor een cluster op P14, alle drie de stappen
   - Hoe: Op P14 het venster geopend, de derde inlogknop gekozen, stap 2 ingevuld en verstuurd, en na elke stap gekeken.
   - Waargenomen: Stap 1 heeft drie inlogknoppen en geen velden. Stap 2 heeft zeven velden; geen daarvan vraagt iets uit stap 1. Ingevuld: \`Test\` als naam, en een organisatie, prijsmodel en regio uit lijsten. Stap 3 toont "Cluster succesvol aangemaakt!" met de ingevulde gegevens en heeft geen velden.
   - Bewijs: `v-337-0023`, `v-337-0024`, `v-337-0025`, `v-337-0027`, `v-337-0028`, `v-337-0029`, `v-337-0030`, `v-337-0031`, `v-337-0033`, `v-337-0036`
3. Onderzocht: Een tweede cluster aanmaken na afloop op P14
   - Hoe: In stap 3 op de knop voor nog een cluster geklikt en gekeken.
   - Waargenomen: Het venster begint opnieuw bij de inlogknoppen en de velden zijn leeg. Dit is een nieuwe aanvraag, geen latere stap van dezelfde. Opnieuw inloggen is een stap voor de beveiliging.
   - Bewijs: `v-337-0037`, `v-337-0038`
4. Onderzocht: Feedback versturen via GitHub op P09, als fout met een link
   - Hoe: Op P09 het venster geopend, de soort Fout gekozen, tekst en link ingevuld en via GitHub verstuurd. Daarna de code van de site gelezen die het bericht opbouwt.
   - Waargenomen: Ingevuld: \`Dit is een lange testwaarde om te zien w...\` als feedback en \`https://example.com/\` als link; de richtlijn bleef op de standaardkeuze. De site opent GitHub met soort, richtlijn en tekst al ingevuld. In de code gaat de link alleen mee bij een voorstel of algemene feedback. Daarna zijn alle velden op de site leeg. De pagina op GitHub zelf is niet te zien.
   - Bewijs: `v-337-0015`, `v-337-0016`, `v-337-0017`, `v-337-0019`, `v-337-0020`, `v-337-0005`
5. Onderzocht: Feedback versturen via e-mail op P05, als vraag met een link
   - Hoe: Op P05 het venster geopend, de soort Vraag gekozen, tekst en link ingevuld en via e-mail verstuurd. De code gelezen die het bericht opbouwt.
   - Waargenomen: Ingevuld: \`Dit is een lange testwaarde om te zien w...\` als feedback en \`https://example.com/\` als link. De site meldt dat het mailprogramma is geopend en maakt de velden leeg. In de code gaan soort, richtlijn, pagina, tekst en links allemaal mee in het bericht. Het bericht in het mailprogramma is niet te zien.
   - Bewijs: `v-337-0046`, `v-337-0047`, `v-337-0048`, `v-337-0049`, `v-337-0050`, `v-337-0005`, `v-337-0007`

**Hoe zeker is dit oordeel**

Beoordelaar: Kan niet bepalen. Verificatie, tevens eindoordeel: Kan niet bepalen.

Poging om het oordeel onderuit te halen: Het clusterformulier op P14 helemaal doorlopen met een andere inlogknop: niets komt terug. Feedback met link verstuurd via GitHub op P09 en via e-mail op P05, en de code gelezen. Het ontbrekende feit staat nu vast: de link gaat bij Fout en Vraag niet mee naar GitHub. Geen bevinding, omdat GitHub de link niet opnieuw vraagt en de pagina daar niet te zien is. Daarom blijft het open.

Grondslag: Beslisregel R4, procedure versie 4 (probe+oordeel).

Beperking van de procedure: Er wordt niet ingelogd, dus processen achter een inlog zijn niet onderzocht. Een proces is doorlopen zolang de volgende stap op de pagina zelf verschijnt; een stap die pas na het versturen komt, of wat een ingesloten venster (zoals een chat) na een verstuurd bericht vraagt, is alleen gezien als de run op een testomgeving mocht versturen.

Open, voor een volgende meting:

- Dekking ontbrak: De stap na het versturen van het proefformulier voor een cluster op P13 en P14 en de stap na het versturen van het feedbackformulier met geldige invoer zijn niet vooraf vastgelegd. Ze zijn bij de beoordeling alsnog doorlopen op P13, P14, P01, P03, P05 en P09.

Open: 2 punten, zie [Nog uitzoeken](#open-3.3.7).

<a id="bijlage-3.3.8"></a>

### 3.3.8 Toegankelijke authenticatie (minimum)

**Uitkomst:** ● Voldoet · Niveau AA · EN 301 549: 9.3.3.8 · Nieuw in WCAG 2.2 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html) · [Terug naar het resultaat](#sc-3.3.8)

**Hoe is dit vastgesteld**

1. Onderzocht: Of er op de site wachtwoordvelden, inlogvelden of ingesloten vensters van een inlog- of controledienst staan
   - Hoe: Tellingen in het dossier over alle 29 pagina's; daarna zelf gezocht in het geopende venster op P14, voor het inloggen, na het inloggen en na het versturen
   - Waargenomen: 0 keer een wachtwoordveld aangetroffen op 29 pagina's en 0 ingesloten vensters. Van de 79 keer dat een veld is aangetroffen zijn er 73 selectievakjes. In het venster voor het cluster staan voor het inloggen alleen selectievakjes van de pagina erachter; na het inloggen zes keuzelijsten en één tekstveld voor de naam; na het versturen geen wachtwoordveld, codeveld of ingesloten venster.
   - Bewijs: `inventoryCounts`, `forms`, `v-338-0004`, `v-338-0009`, `v-338-0022`
2. Onderzocht: De eerste stap van het inloggen in het venster voor het cluster
   - Hoe: Het bewaarde venster geopend op P14 en bekeken; op P13 op een scherm van 320 pixels breed zelf geopend met de knop Aanmaken en bekeken
   - Waargenomen: Onder de kop "Authenticatie vereist" staan drie knoppen: "SSO Rijksoverheid", "YubiKey" en "PKIoverheid Certificaat". Er is geen invoerveld. Dit is gelijk aan het dossier, gelijk op beide pagina's en gelijk op het smalle scherm.
   - Bewijs: `site-states/component-cluster-dialoog/aria.yaml`, `v-338-0003`, `v-338-0025`, `v-338-0026`
3. Onderzocht: Wat er na het inloggen gebeurt, tot en met het versturen van het formulier
   - Hoe: Op P14 op de knop YubiKey geklikt, gekeken, het formulier ingevuld met testwaarden, verstuurd en opnieuw gekeken. De andere twee knoppen zijn door de eerste beoordelaar aangeklikt
   - Waargenomen: Na de klik komt de melding "Authenticeren met YubiKey..." en daarna het formulier met de knop "Terug" en het veld "Organisatie". Na het versturen staat er "Cluster succesvol aangemaakt!". In geen stap wordt om een wachtwoord, een code, een som of een puzzel gevraagd.
   - Bewijs: `v-338-0006`, `v-338-0007`, `v-338-0008`, `v-338-0020`, `v-338-0021`, `b-338-0005`, `b-338-0013`, `b-338-0024`
4. Onderzocht: Of er verder links of knoppen naar een inlog zijn
   - Hoe: 570 verschillende links en 88 verschillende bedieningselementen in het dossier doorzocht op woorden voor inloggen; twee links zelf opgezocht en nagelezen op P17 en P12, zonder ze te volgen
   - Waargenomen: De link "hier" op P17 wijst naar een inlogpagina van lees-rijk.nl en de link "Registreren" op P12 naar amt.rijksapp.nl. Het zijn verwijzingen naar een bron en een hulpmiddel van een andere partij. Ze geven geen toegang tot iets op deze site en zijn geen inlog van deze site.
   - Bewijs: `links`, `controls`, `v-338-0029`, `v-338-0030`, `v-338-0032`, `v-338-0033`

**Hoe zeker is dit oordeel**

Beoordelaar: Voldoet. Verificatie, tevens eindoordeel: Voldoet.

Poging om het oordeel onderuit te halen: Gezocht naar een denktaak waar de beoordelaar niet keek: het venster op P14 via de knop YubiKey, het formulier daarna ingevuld en echt verstuurd om een latere stap met een code te vinden, het venster op P13 op 320 pixels breed, en de twee links naar een andere partij zelf nagelezen. Nergens een wachtwoordveld, codeveld, puzzel of ingesloten venster. Het oordeel blijft staan.

Grondslag: Beslisregel R2, procedure versie 4 (inventaris).

Beperking van de procedure: Er wordt niet ingelogd, ook niet op een testomgeving, en een inlog bij een andere partij (zoals DigiD, eHerkenning of eIDAS) wordt niet gevolgd. Niet te meten is of plakken in een wachtwoord- of codeveld werkt, of een wachtwoordmanager de velden kan invullen, en welke stappen na de eerste komen (bijvoorbeeld een code per sms of een puzzel). Bij een site met een inlog kan dit criterium daarom nog niet worden goedgekeurd.

<a id="bijlage-4.1.1"></a>

### 4.1.1 Parsen

**Uitkomst:** ● Voldoet · Niveau A · EN 301 549: 9.4.1.1 · Alleen in WCAG 2.1 · [Uitleg van dit criterium bij W3C](https://www.w3.org/WAI/WCAG21/Understanding/parsing.html) · [Terug naar het resultaat](#sc-4.1.1)

**Hoe is dit vastgesteld**

1. Onderzocht: Of elke onderzochte pagina een HTML-document is
   - Hoe: Dossier: de legenda en inventoryCounts, alle 29 pagina's in de begintoestand
   - Waargenomen: 29 van 29 pagina's zijn geladen: 28 met status 200 en de foutpagina P02 met status 404, die ook een gewone pagina van de site is. Samen 38604 elementen aangetroffen op 29 pagina's. Er zijn 0 ingesloten vensters. Het aantal dubbele id's is 0 op 29 pagina's.
   - Bewijs: `inventoryCounts`
2. Onderzocht: Of de ontleders de broncode kunnen lezen, opnieuw gemeten op drie paginatypen
   - Hoe: Zelf: tg open en tg source op P13 (richtlijn met formulieren), P02 (foutpagina) en P09 (toegankelijkheidsverklaring). De beoordelaar mat alle 29 pagina's
   - Waargenomen: Op alle drie de pagina's gaven beide ontleders antwoord: de pagina's zijn HTML. P13: 4 meldingen van één ontleder, 0 van de andere. P02: 0 meldingen van beide. P09: 1 melding van één ontleder, 0 van de andere. Geen melding over een dubbel id of over een tag die niet klopt.
   - Bewijs: `v-411-0002`, `v-411-0004`, `v-411-0006`
3. Onderzocht: Wat de meldingen van de ene ontleder betekenen
   - Hoe: Zelf op P09 en P13: tg find van \`nldd-list\[aria-label\]\`, tg name van een lijst op P13, tg find en tg html van een verplichte keuzelijst op P13
   - Waargenomen: De meldingen gaan over \`aria-label\` op \`nldd-list\` en over de eerste optie van een verplichte keuzelijst. De lijst heeft in de browser de rol navigatie en vijf methoden lezen dezelfde naam. De keuzelijst in de broncode is verborgen. Ongeldige ARIA hoort bij criterium 4.1.2; hier is geen gevolg voor bezoekers gezien. Beide soorten meldingen zijn informatie.
   - Bewijs: `v-411-0007`, `v-411-0011`, `v-411-0012`, `v-411-0020`, `v-411-0021`
4. Onderzocht: Wat de regel-engines over dit criterium melden, ook met het feedbackvenster open
   - Hoe: Dossier: engine, alle pagina's. Zelf: tg rules --criterion 4.1.1 op P09 en op P01 met het feedbackvenster open (tg open --state component-feedback, tg look)
   - Waargenomen: Het dossier heeft 0 regels en 0 meldingen van engines voor dit criterium. Op P09 en op P01 met het venster open gaven vier engines elk 0 meldingen. Dat is hier normaal en is niet de grond voor de goedkeuring. De grond is dat het W3C dit criterium voor HTML en XML als altijd voldaan beschouwt.
   - Bewijs: `engine`, `v-411-0008`, `v-411-0015`, `v-411-0016`

**Hoe zeker is dit oordeel**

Beoordelaar: Voldoet. Verificatie, tevens eindoordeel: Voldoet.

Poging om het oordeel onderuit te halen: De broncode opnieuw ontleed op drie paginatypen, waaronder de foutpagina en de pagina met de meeste meldingen. De lijst en de keuzelijst uit de meldingen opgezocht en de naam gemeten. De regel-engines gedraaid op een andere pagina dan de beoordelaar en met het feedbackvenster open, een toestand die hij niet bekeek. Elke pagina is HTML en er is geen dubbel id gevonden. Het oordeel blijft staan.

Grondslag: Beslisregel R1, procedure versie 4 (engine).

Beperking van de procedure: Het oordeel rust op de vaststelling van het W3C dat dit criterium voor HTML en XML altijd als voldaan geldt; de validators op de broncode geven alleen informatie. De broncode is gelezen op de pagina's van de steekproef, zoals de server ze stuurde. Documenten die geen HTML of XML zijn, zoals pdf-bestanden, zijn niet ontleed.

<a id="bijlage-4.1.2"></a>

### 4.1.2 Naam, rol, waarde

**Uitkomst:** ✕ Voldoet niet · [Terug naar het resultaat](#sc-4.1.2)

**Hoe is dit vastgesteld**

1. Onderzocht: Het schuivende vak om het zijmenu
   - Hoe: Op P17 vanaf een verse pagina: code, opmaak, rol en naam volgens de browser, een focusproef en een wandeling met Tab in vier methoden
   - Waargenomen: Het vak is een \`div\` die kan schuiven, zonder tabindex. Het kan focus krijgen en heeft de rol generic zonder naam volgens de browser. Firefox stopt er met Tab op, tussen de link GitHub en de eerste link van het zijmenu; de andere drie methoden slaan het over.
   - Bewijs: `v-412-0035`, `v-412-0036`, `v-412-0037`, `v-412-0038`, `v-412-0039`, `v-412-0041`
2. Onderzocht: Keuzelijsten die ongeldig melden vóór invoer
   - Hoe: Feedbackvenster op P01 en clustervenster op P13: toestand en code gelezen, op P13 ook na een keuze
   - Waargenomen: De keuzelijsten zijn gewone \`select\`-elementen met \`required\` en zonder \`aria-invalid\`. De browser meldt ze ongeldig zolang niets is gekozen; na een keuze op P13 meldt de lijst niet meer ongeldig. De toestand volgt de echte geldigheid: geen gebrek hier. De hint bij Soort feedback staat niet in beeld; dat hoort bij 3.3.2.
   - Bewijs: `v-412-0004`, `v-412-0005`, `v-412-0008`, `v-412-0016`, `v-412-0017`, `v-412-0022`, `v-412-0023`
3. Onderzocht: De huidige sectie in het smalle hoofdmenu
   - Hoe: Op P03 op 360 pixels breed: menu geopend, schermbeeld bekeken, toestand en code van de link gelezen
   - Waargenomen: De link van de huidige sectie heeft een donkerder vlak, maar geen \`aria-current\`. Dat is geen toestand die de bezoeker zelf wisselt; het is informatie die alleen in beeld staat. Dat hoort bij criterium 1.3.1.
   - Bewijs: `v-412-0048`, `v-412-0049`, `v-412-0050`
4. Onderzocht: Meldt een onderdeel dat van toestand wisselt die toestand
   - Hoe: Voor en na bediening gelezen: knop Zoeken op P01, knop Menu op P03 (360 pixels breed), knop Kopieer op P04; uitgeschakelde knoppen op P13 en P21
   - Waargenomen: Zoeken en Menu melden uitgeklapt nee, bij openen ja en na sluiten weer nee. Kopieer doet één handeling en heeft geen toestand. De drie uitgeschakelde knoppen melden dat ze uit staan. Het naamveld in het clustervenster meldt verplicht.
   - Bewijs: `v-412-0067`, `v-412-0069`, `v-412-0072`, `v-412-0073`, `v-412-0045`, `v-412-0047`, `v-412-0055`, `v-412-0056`, `v-412-0061`, `v-412-0027`, `v-412-0028`, `v-412-0031`, `v-412-0020`
5. Onderzocht: Naam volgens meer methoden
   - Hoe: Naam gemeten op P01, P03 (360 pixels breed), P04, P13 en P17, ook in het geopende zoekvenster, feedbackvenster, clustervenster en menu
   - Waargenomen: Alle methoden eens over de naam bij Sluit, Verberg, Kopieer, het zoekveld en het clustervenster. Bij de knop Menu en bij een menulink mist telkens één methode de naam; de browser en de andere methoden geven dezelfde naam. Bij de keuzelijsten verschilt alleen de rol bij één methode. Dat zijn bekende beperkingen van die methoden bij webcomponenten.
   - Bewijs: `v-412-0009`, `v-412-0012`, `v-412-0068`, `v-412-0059`, `v-412-0071`, `v-412-0046`, `v-412-0051`, `v-412-0004`, `v-412-0017`, `v-412-0040`

**Hoe zeker is dit oordeel**

Beoordelaar: Voldoet niet. Verificatie, tevens eindoordeel: Voldoet niet.

Grondslag: Beslisregel R2, procedure versie 10 (engine+oordeel).

Beperking van de procedure: De veegronde las rol, naam en toestand uit de toegankelijkheidsboom van één browser (Chromium). Waar de beoordelaar naam en rol zelf mat, zijn die ook met rekenmethoden bepaald en in WebKit gelezen als die browser beschikbaar was. Er is geen echte schermlezer of spraakbesturing gebruikt. Wat achter een inlog staat, is niet beoordeeld; wat pas na het versturen van een formulier verschijnt, alleen als de run op een testomgeving mocht versturen. Een ingesloten venster dat bij het onderzoek niet laadde of niet te bedienen was, is niet beoordeeld.

<a id="bijlage-4.1.3"></a>

### 4.1.3 Statusberichten

**Uitkomst:** ● Voldoet · [Terug naar het resultaat](#sc-4.1.3)

**Hoe is dit vastgesteld**

1. Onderzocht: Welke plekken een melding kunnen geven en of het dossier ze dekt
   - Hoe: Dossier gelezen: inventoryCounts, controls, dialogs en formErrors over 29 pagina's; daarna elke bron zelf bediend op een andere pagina dan de beoordelaar
   - Waargenomen: Bronnen: het zoekveld en het feedbackformulier (alle 29 pagina's), het proefformulier voor een cluster (P13, P14), kopieerknoppen (P04 en in het clustervenster), de knop Verberg (P01) en afvinklijsten. Het dossier telt 1 onderzocht formulier; versturen mocht. Elke bron is nu op minstens één pagina gezien, door de beoordelaar en bij de toetsing.
   - Bewijs: `inventoryCounts`, `controls`, `dialogs`, `formErrors`, `v-413-0001`
2. Onderzocht: Meldingen van het feedbackformulier: fouten en de melding na versturen
   - Hoe: Op P26 in toestand component-feedback: leeg verstuurd, daarna Uw feedback gevuld met \`Dit is een lange testwaarde om te zien w...\` en verstuurd, daarna soort Fout gekozen en verstuurd met Via e-mail
   - Waargenomen: 3 van 3 meldingen staan in een voorleesgebied. "Uw feedback is nog niet verstuurd" staat twee keer in het gebied met rol alert, en de focus gaat naar het eerste foute veld. "Bedankt voor uw feedback!" staat in het gebied met rol status. Dat klopt met het dossier en met de beoordelaar.
   - Bewijs: `formErrors`, `v-413-0017`, `v-413-0019`, `v-413-0020`, `v-413-0023`, `v-413-0027`, `v-413-0028`, `v-413-0029`
3. Onderzocht: Of het gebied van de bedankmelding er al stond voordat de melding kwam
   - Hoe: Op P26: de voorleesgebieden gezocht en hun code gelezen voor het versturen, en opnieuw gezocht erna
   - Waargenomen: Het gebied van de bedankmelding heeft rol status en staat al in de pagina, maar is verborgen tot de melding komt. Een deel van de hulpsoftware leest zo'n melding dan niet voor. Het foutgebied is ook eerst verborgen, maar heeft rol alert en de focus gaat naar het veld. Wat een schermlezer werkelijk zegt, is niet te meten.
   - Bewijs: `v-413-0004`, `v-413-0014`, `v-413-0015`, `v-413-0028`
4. Onderzocht: Het aantal zoekresultaten bij typen in het zoekvenster
   - Hoe: Op P09 in toestand component-zoeken: gebieden en hun code gelezen voor het typen, daarna \`test\` en \`1234 AB\` getypt en de gebieden opnieuw gelezen. Het antwoord op het typen kwam eerder dan de melding; het gebied daarna lezen beslist
   - Waargenomen: Het gebied met rol status stond er al en was leeg. Na \`test\` staat er "De eerste 20 van 30 resultaten", na \`1234 AB\` staat er "Geen resultaten". De focus blijft in het zoekveld. Na Wis zoekopdracht is het gebied weer leeg en staat de begintekst er weer. 2 van 2 keer gemeld.
   - Bewijs: `v-413-0031`, `v-413-0034`, `v-413-0035`, `v-413-0036`, `v-413-0037`, `v-413-0038`, `v-413-0039`, `v-413-0040`, `v-413-0041`, `v-413-0042`
5. Onderzocht: Meldingen van het proefformulier voor een cluster en van de kopieerknoppen
   - Hoe: Op P14: Aanmaken, YubiKey gekozen, leeg verstuurd, velden gevuld (naam \`Test\`), twee prijsmodellen gekozen, verstuurd, daarna de kopieerknop in het resultaat. Op P04 de tweede kopieerknop
   - Waargenomen: 6 van 6 meldingen in het proefformulier staan in een voorleesgebied: "Authenticeren met YubiKey...", "Het cluster is nog niet aangemaakt", twee keer de geschatte kosten, "Kubernetes cluster wordt aangemaakt..." en "Cluster succesvol aangemaakt." Beide kopieerknoppen zetten "Gekopieerd" in een gebied met rol status dat er al stond; het kopiëren lukte.
   - Bewijs: `v-413-0062`, `v-413-0064`, `v-413-0067`, `v-413-0071`, `v-413-0076`, `v-413-0078`, `v-413-0079`, `v-413-0080`, `v-413-0081`, `v-413-0085`, `v-413-0086`, `v-413-0090`, `v-413-0091`, `v-413-0052`, `v-413-0056`, `v-413-0057`, `v-413-0058`
6. Onderzocht: Knoppen en vakjes die geen melding geven: Link toevoegen, Verberg, een selectievakje, uitgeschakelde knoppen en de vaste melding In ontwikkeling
   - Hoe: Op P26 Link toevoegen aangeklikt; op P22 een selectievakje aangevinkt; op P01 Verberg aangeklikt; op P19 en P22 de knoppen Berekenen en Publiceren gelezen; op P17 de code van de vaste melding gelezen
   - Waargenomen: Link toevoegen voegt een leeg veld toe en geen tekst over een uitkomst. Het selectievakje wordt alleen aangevinkt. Verberg haalt de melding weg zonder nieuwe tekst. Berekenen en Publiceren zijn in de code uitgeschakeld. De melding In ontwikkeling staat er bij het laden al en verandert niet. Dat zijn geen statusmeldingen.
   - Bewijs: `v-413-0005`, `v-413-0006`, `v-413-0007`, `v-413-0106`, `v-413-0107`, `v-413-0108`, `v-413-0112`, `v-413-0114`, `v-413-0095`, `v-413-0096`, `v-413-0100`, `v-413-0046`, `v-413-0048`

**Hoe zeker is dit oordeel**

Beoordelaar: Voldoet. Verificatie, tevens eindoordeel: Voldoet.

Poging om het oordeel onderuit te halen: Elke bron opnieuw bediend op een andere pagina en langs een andere weg: feedbackformulier op P26, zoeken op P09 met een zoekwoord zonder resultaten, clusterformulier op P14 met YubiKey en een betaald prijsmodel, de tweede kopieerknop op P04 en die in het clusterresultaat, een selectievakje op P22, Verberg op P01, uitgeschakelde knoppen op P19 en P22. Alle 13 meldingen stonden in een voorleesgebied; geen tegenvoorbeeld gevonden.

Grondslag: Beslisregel R2, procedure versie 9 (probe+oordeel).

Beperking van de procedure: De melding na een geslaagde verzending (zoals 'Je bericht is verstuurd') en meldingen in een ingesloten venster na een verstuurd bericht zijn alleen gezien als de run op een testomgeving mocht versturen. Meldingen achter een inlog zijn niet gezien. Of een melding wordt voorgelezen, is afgeleid uit de live-regio's en rollen in één browser (Chromium), niet beluisterd met een echte schermlezer.

Open: 1 punt, zie [Nog uitzoeken](#open-4.1.3).

## Bijlage B: herleidbaarheid

Met deze gegevens is na te gaan welke code, welke procedure en welk bewijs tot elk oordeel hebben geleid. De hashes zijn ingekort tot de eerste acht tekens.

- Hash van de evaluatie: `50a291e12689fe76835f20fd4ecd8ab5eb30d639d8ced9c507fc69270a1bc0a8`
- Commit van de toolbox: `ac91dd934461e203c749bc7d32c41f8e4ca29d4e`
- Hash van de lockfile: `9a9fb714fa1d1ed2533d3a789c605c1aa0b18c716fbc8e5602f660d583d32098`

| Criterium | Procedure | Dossier | Oordeel beoordelaar | Eindoordeel (verificatie) |
| --- | --- | --- | --- | --- |
| 1.1.1 | v8 `c74d2f2d` | `5dfda618` | `d4cec8f3` | `fdbe1bb6` |
| 1.2.1 | v6 `472e37b8` | `d8bac449` | `95eb5fa9` | `522e712f` |
| 1.2.2 | v6 `afc5cb9f` | `605014de` | `1acfcb9e` | `f207e97b` |
| 1.2.3 | v6 `a11a0552` | `530c20dc` | `844347ac` | `3e251569` |
| 1.2.4 | v6 `6e183d75` | `6c82e177` | `c323e540` | `cb952ba9` |
| 1.2.5 | v6 `ca6f733e` | `7d25c621` | `598f9bc2` | `014edaa9` |
| 1.3.1 | v9 `36402494` | `55563762` | `eacf2b4d` | `2aa58747` |
| 1.3.2 | v8 `a585d0e6` | `f6d52899` | `426f52f7` | `204fa4a1` |
| 1.3.3 | v7 `1a26fe65` | `21eb7970` | `0e00b176` | `a8d7223a` |
| 1.3.4 | v6 `2a2a086f` | `f63eced1` | `0e122d14` | `2d748cfa` |
| 1.3.5 | v7 `b3319343` | `0a520b5b` | `9aaad30a` | `618137c4` |
| 1.4.1 | v6 `3b5409ce` | `94d9dc1b` | `c0a14254` | `83136f9c` |
| 1.4.2 | v8 `ef6f030f` | `98130ea3` | `e1facc7a` | `2e76f852` |
| 1.4.3 | v10 `f0d308e8` | `6e569436` | `9d3398d6` | `e8751bb7` |
| 1.4.4 | v6 `6042f93d` | `e3b1f54d` | `ac3dda2e` | `289f0a00` |
| 1.4.5 | v7 `3b9c2846` | `915bd490` | `ca8a8d2e` | `1bf364dc` |
| 1.4.10 | v8 `b637cd06` | `0f60a491` | `a51932dc` | `55c0612b` |
| 1.4.11 | v6 `310f4f82` | `615c7bed` | `cd5191b6` | `beb089cf` |
| 1.4.12 | v7 `5e8ada4e` | `3295947e` | `48c163ee` | `a2a03d3f` |
| 1.4.13 | v5 `65075600` | `d0c764c2` | `a7d79bd2` | `7a4e2058` |
| 2.1.1 | v8 `5e01cd5f` | `7f23ca80` | `26bc25a0` | `a5a97bbb` |
| 2.1.2 | v6 `cf8e05c8` | `196eb5ac` | `013f88c9` | `61888418` |
| 2.1.4 | v8 `b7ff5701` | `c683e120` | `a876ff23` | `9030f938` |
| 2.2.1 | v6 `777c38b1` | `126b05f9` | `9a376ceb` | `34a9a6ef` |
| 2.2.2 | v6 `b22da2af` | `06ea2726` | `9d9ff61d` | `cc394c85` |
| 2.3.1 | v7 `803154e0` | `2d77c264` | `9c3671df` | `b117defc` |
| 2.4.1 | v6 `9f247f11` | `5b39c327` | `ca2b649f` | `9d9d8dbb` |
| 2.4.2 | v8 `9e3758db` | `c3500067` | `188435e8` | `d3bae926` |
| 2.4.3 | v9 `b55f1ba4` | `4133cad0` | `9db23a2f` | `a6a68199` |
| 2.4.4 | v8 `bfedca03` | `81a6ed0c` | `dc81e105` | `866bf312` |
| 2.4.5 | v5 `dcd802c5` | `1cbd9fc7` | `b0b81103` | `21cfe9dc` |
| 2.4.6 | v9 `3364d121` | `8be062fb` | `63886178` | `b5b198d9` |
| 2.4.7 | v6 `e2f7e216` | `39656bc5` | `f61127af` | `208dae5f` |
| 2.4.11 | v5 `28fb920a` | `c0050fec` | `91c53836` | `2c82b6b0` |
| 2.5.1 | v5 `177c1606` | `106da569` | `0c5170eb` | `2f198953` |
| 2.5.2 | v8 `d78ed17b` | `da840fc0` | `d6174278` | `dc096f47` |
| 2.5.3 | v6 `24f4a8f4` | `b98a2b2c` | `3e443dce` | `9836cd2b` |
| 2.5.4 | v6 `142cd34a` | `c5776e54` | `8f95e074` | `9c852407` |
| 2.5.7 | v5 `2b7fc8cc` | `a754cb4a` | `f84f7fe1` | `b737f367` |
| 2.5.8 | v9 `aad1de47` | `5deb45b2` | `e14c9214` | `c9b58f69` |
| 3.1.1 | v7 `74996a70` | `f5ca8dca` | `7c97eaef` | `b44c2f32` |
| 3.1.2 | v7 `7dd643eb` | `dd8153d6` | `2f09adef` | `2d76af18` |
| 3.2.1 | v6 `d8b3abfd` | `15629d2e` | `23807d83` | `de0f7bd0` |
| 3.2.2 | v7 `eefe3d6f` | `8f8ce13f` | `fb711bb3` | `613239ba` |
| 3.2.3 | v4 `2234ef87` | `8f0c9d48` | `e440e487` | `0142213a` |
| 3.2.4 | v4 `dcf35518` | `6e19298a` | `b24b21ef` | `bd35745b` |
| 3.2.6 | v4 `d1c34fcc` | `c777e35f` | `24ae5ae8` | `29f15372` |
| 3.3.1 | v6 `1061249a` | `2f8aa871` | `9c3d0ad3` | `3d607b1e` |
| 3.3.2 | v7 `9d97a364` | `7f25960c` | `8e736764` | `f7e2e270` |
| 3.3.3 | v5 `6ec03a43` | `55f7311d` | `4b399abb` | `c9b4b988` |
| 3.3.4 | v6 `8208f593` | `c1ffd8c9` | `3448edac` | `32b09a9e` |
| 3.3.7 | v4 `317effc6` | `bb23856d` | `c9b5da6d` | `bfa8fd9c` |
| 3.3.8 | v4 `db99bae7` | `81428d33` | `c3fefe6b` | `8c0832dd` |
| 4.1.1 | v4 `14c025e3` | `c2c5a17f` | `8a238ede` | `32ab61f8` |
| 4.1.2 | v10 `b552fcf5` | `822c71a9` | `491626ba` | `86f19cf2` |
| 4.1.3 | v9 `4913ecfe` | `a4d4adc7` | `0f259ece` | `949cddab` |
