# Wijzigingen

Wat er per versie van loep is veranderd. De versie staat op het voorblad en onderaan elke pagina van een rapport. Wat een nieuwe versie betekent, staat in [CONTRIBUTING.md](CONTRIBUTING.md#versies).

## Nog niet uitgebracht

### Wat een uitkomst kan veranderen

- 1.3.2 (Betekenisvolle volgorde): een datum, label of nummer vóór de titel van een kaart, in dezelfde volgorde op het scherm, is geen bevinding meer maar aanbeveling A1. De leesvolgorde klopt daar, en de norm vraagt niet meer; de regel was strenger dan de letter van het criterium en zette het criterium op "voldoet niet".
- Inloggen bij DigiD, eHerkenning of eIDAS valt buiten het bereik, net als andere websites van derden, en het bereik in het rapport zegt dat. 3.3.8 (Toegankelijke authenticatie) blijft daardoor niet meer open bij een site waar alleen via zo'n dienst wordt ingelogd: zonder eigen inlog is het criterium niet van toepassing. Een andere inlogdienst op een ander domein, ook van een leverancier, hoort nog steeds bij de site. Eerder zette zo'n inlog de status op C, terwijl het bereik websites van derden uitsloot.
- 3.2.4 (Consistente identificatie): een knop die "Terug" heet als de bezoeker van de site kwam en "Naar de site" als die van buiten kwam, heeft twee functies en is geen inconsistentie. Een bevinding beschrijft elke naam die het onderdeel kan krijgen, niet alleen de naam die de beoordelaar zag.
- Een naam die er is maar de functie onvolledig noemt, zoals een logo-link met alleen de naam van de organisatie, krijgt niet de ernst `hoog` van "geen naam".

### Verder

- Aanbevelingen: wat de site beter maakt en wat de norm niet vraagt, staat apart in het rapport, onder "Aanbevelingen" bij "Wat nu". Een aanbeveling telt niet mee voor de uitkomst, de status of de verklaring. Alleen een procedure geeft er een, met een regel in een eigen sectie (A1, A2). `check-verdict` weigert een aanbeveling zonder zo'n regel, zonder waarneming, op een plek met een bevinding, of op de plek van een bevinding die de verifieerder liet vervallen omdat ze niet opnieuw te zien was of bij een ander criterium hoort. `just procedures` weigert een regel voor een aanbeveling die een uitkomst noemt.
- Twee bevindingen onder hetzelfde criterium op dezelfde plek die verschillende gebreken zijn, krijgen elk een eigen nummer, met de titel in de hash. Eerder kreeg de tweede het nummer van de eerste met `-2` erachter, wat las als hetzelfde gebrek op een andere plek. Alleen dezelfde titel op dezelfde plek krijgt nog een achtervoegsel.
- De zin op het voorblad noemt het aantal criteria als het geheel waaruit geteld wordt: "voldoet niet aan WCAG 2.2 niveau A en AA: van de 55 criteria zijn er 11 niet gehaald". Eerder stond er "voldoet niet aan de 55 criteria", wat las alsof alle 55 niet gehaald waren.

## 0.2.0 (2026-10-15)

Deze versie is uitgebracht zonder nieuwe meting op de testsite. De twee wijzigingen die een uitkomst kunnen veranderen, zijn dus nog niet vergeleken met 0.1.2.

### Wat een uitkomst kan veranderen

- Een verifieerder die een bevinding laat vervallen omdat de norm het geen fout noemt, zegt welke tekst van de norm dat toestaat, en mag dezelfde vraag niet als `keuze nodig` doorgeven aan wie het rapport tekent. `check-verdict --round final` weigert na een afkeuring een eindoordeel "kan niet bepalen" met zo'n vervallen bevinding en een nieuw punt `keuze nodig`. `keuze nodig` is alleen voor een besluit dat de norm of de procedure bij de eigenaar legt (#35).
- Een open punt dat alleen open blijft omdat de run niet mocht versturen, heet `versturen niet toegestaan` en niet meer `mens nodig`. Het telt als keuze van de eigenaar: het rapport zet die punten apart onder "Nog uitzoeken", met de verklaring bij `inventory` die ze had gesloten (`--test-environment <origin>`, ook de origin van alleen een ingesloten venster), `loep gaps` telt ze apart en `loep feedback` maakt er geen issue van (#37).

### Verder

- De skill zoekt voor elke melding aan loep eerst in open en gesloten issues: een open issue krijgt een reactie, een gesloten issue dat terugkomt een nieuw issue dat het oude noemt (#34).
- Een run vanuit de geïnstalleerde plugin, buiten een git-repository, noemt in het rapport alleen de versie van loep. Bij het gereedschap en de herleidbaarheid staat dat de commit onbekend is, en het rapport zegt niets meer over niet vastgelegde wijzigingen. Een oudere run met de tekst `no commit yet` wordt net zo weergegeven (#36).
- De skill vraagt vooraf apart of het onderzoek mag versturen: op de hele site, alleen naar het adres dat het bericht ontvangt, of niet. `inventory` zegt het in een run die niet mag versturen als pagina's een eigen formulier hebben of een ingesloten venster op een ander adres er een heeft (#37).

## 0.1.2 (2026-10-15)

### Verder

- `loep feedback` schrijft voor elk criterium dat open bleef door loep zelf een tekst voor een issue, zonder adres of naam van de site; de skill zegt hoe een agent dat met een ja van de gebruiker terugmeldt (#28).
- De skill stelt vóór het onderzoek één ronde vragen: over een inlog of een testomgeving, hoeveel agents tegelijk mogen, wat erbij hoort, en de naam en organisatie voor het rapport. `inventory` zegt het als pagina's een wachtwoordveld tonen terwijl er niet is ingelogd (#29).

## 0.1.1 (2026-10-15)

### Verder

- Elke sessie van een agent krijgt een eigen werkmap `<run>/werk/<sessie>/`, zodat agents geen hulpscripts delen en geen commando's in elkaars sessie terechtkomen (#22).
- Bij open criteria noemt het rapport voor welke WCAG-versie een criterium geldt dat maar in één versie bestaat, zodat de telling klopt met de samenvatting (#26).

## 0.1.0 (2026-10-14)

### Wat een uitkomst kan veranderen

- Elk paginatype uit het sitemodel krijgt een pagina in de steekproef, ook als het dezelfde opbouw heeft als een ander type (#13).
- De bewijspoort kent de sneltoetsen die de veegronde mat, en beoordeelt opnieuw als de lijsten van onderdelen, inhoud, vensters of toetsen veranderen (#14).
- Een toets van één teken die volledig scherm aanvraagt, telt als reactie van de pagina (2.1.4) (#15).
- Het beeld van de Tab-proef toont de toestand waarin de stops zijn geteld, en de kaders staan op meeschuivende en vaste elementen (#16, #18).
- Een pagina die niet laadt, krijgt bij `contrast` een tweede poging; wat al gemeten was, gaat niet meer verloren (#17).
- Tesseract draait met één thread per pas, en een beeld dat niet is gemeten, zegt waarom (#19).
- Platte tekst (Markdown, txt, csv) en bestanden die een link met het download-attribuut aanbiedt, zijn documenten en geen pagina's (#20).
- axe-core 4.14. De regel `label-content-name-mismatch` (2.5.3) staat nu standaard aan. Vergeleken met 4.13 op de testsite in `validatie/testsite/2026-10-14-axe-4.14/` (#21).

### Verder

- Installeren via de marketplace van NLDD, en loep heet experimenteel (#6).
- TypeScript 7, vnu-jar 26.10.11 en nieuwe versies van de GitHub Actions; Dependabot slaat Playwright 1.64 en nieuwe versies van `@types/node` over (#9, #12).
- `publiccode.yml`, `GOVERNANCE.md`, `SUPPORT.md` en formulieren voor een fout of een voorstel (#23).
- De documentatie is weer naast de code gelegd (#24).
- Versies: één versie voor de toolbox en de plugin, een test die dat bewaakt, en `just release-prepare` en `just release-tag`.

## 0.0.1 (2026-10-14)

De eerste openbare versie.
