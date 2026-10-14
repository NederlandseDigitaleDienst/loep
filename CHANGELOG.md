# Wijzigingen

Wat er per versie van loep is veranderd. De versie staat op het voorblad en onderaan elke pagina van een rapport. Wat een nieuwe versie betekent, staat in [CONTRIBUTING.md](CONTRIBUTING.md#versies).

## Nog niet uitgebracht

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
