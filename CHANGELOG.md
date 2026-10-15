# Wijzigingen

Wat er per versie van loep is veranderd. De versie staat op het voorblad en onderaan elke pagina van een rapport. Wat een nieuwe versie betekent, staat in [CONTRIBUTING.md](CONTRIBUTING.md#versies).

## Nog niet uitgebracht

### Wat een uitkomst kan veranderen

- Een verifieerder die een bevinding laat vervallen omdat de norm het geen fout noemt, zegt welke tekst van de norm dat toestaat, en mag dezelfde vraag niet als `keuze nodig` doorgeven aan wie het rapport tekent. `check-verdict --round final` weigert na een afkeuring een eindoordeel "kan niet bepalen" met zo'n vervallen bevinding en een nieuw punt `keuze nodig`. `keuze nodig` is alleen voor een besluit dat de norm of de procedure bij de eigenaar legt.

### Verder

- De skill zoekt voor elke melding aan loep eerst in open en gesloten issues: een open issue krijgt een reactie, een gesloten issue dat terugkomt een nieuw issue dat het oude noemt (#34).
- Een run vanuit de geïnstalleerde plugin, buiten een git-repository, noemt in het rapport alleen de versie van loep. Bij het gereedschap en de herleidbaarheid staat dat de commit onbekend is, en het rapport zegt niets meer over niet vastgelegde wijzigingen. Een oudere run met de tekst `no commit yet` wordt net zo weergegeven (#36).

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
