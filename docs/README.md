# Documentatie

Soort: wegwijzer die bij de code hoort.

De afspraak dat een wijziging in gedrag in dezelfde commit de beschrijving bijwerkt, staat in [../CONTRIBUTING.md](../CONTRIBUTING.md). De test `toolbox/test/docs.test.ts` bewaakt het deel dat een script kan zien: elk commando en elke taak die een beschrijving noemt bestaat, elk commando van de toolbox staat in de README of de methode, en elke link naar een bestand komt ergens uit.

| Document | Soort | Wat het is |
|---|---|---|
| [methode.md](methode.md) | beschrijving | Hoe een onderzoek tot stand komt, ook achter een inlog, wat een uitkomst betekent en wat de methode niet kan |
| [architectuur.md](architectuur.md) | beschrijving | Hoe de toolbox is opgezet: de keten, de rollen, de lagen in de code, de gegevens van een run, en recepten om uit te breiden |
| [plugin.md](plugin.md) | beschrijving | Hoe de repository als plugin met drie skills is opgezet |
| [voiceover.md](voiceover.md) | beschrijving | Het optionele onderdeel dat een echte schermlezer laat voorlezen: VoiceOver in een virtuele Mac, wat het kost en wat het niet kan |
| [niet-ingebouwd.md](niet-ingebouwd.md) | lijst van keuzes van 10 oktober 2026 | Gereedschap dat is bekeken en bewust niet is opgenomen, met de reden |

Een beschrijving hoort te kloppen met de code van dezelfde commit. Een lijst van keuzes verandert alleen als een keuze verandert.

Buiten deze map:

| Document | Wat het is |
|---|---|
| [../README.md](../README.md) | Wat de toolbox doet, hoe je hem gebruikt en wat hij niet doet |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Afspraken voor wie aan de toolbox werkt, en wat nooit mag |
| [../PLAN.md](../PLAN.md) | Wat er loopt, wat hierna komt en welke besluiten openstaan |
| [../procedures/README.md](../procedures/README.md) | Hoe een procedure per succescriterium is opgebouwd |
| [../validatie/README.md](../validatie/README.md) | De metingen: [iteraties.md](../validatie/iteraties.md) is het logboek met de cijfers, [lessen.md](../validatie/lessen.md) zegt per les of iets is gemeten of alleen getest. De terugkoppeling van het team van de eerste echte site staat in `validatie/nerds.digitaledienst.overheid.nl/` |
| `skills/nldd-a11y-audit/onderzoek.workflow.js` | De werkstroom die rondgangen, beoordelaars en verifieerders start |
| [../toolbox/fixtures/README.md](../toolbox/fixtures/README.md) | De testsite met ingebouwde gebreken, met een deel achter een inlog |
| [../toolbox/THIRD-PARTY.md](../toolbox/THIRD-PARTY.md) | Software van derden in de toolbox, met versie en licentie |
| [../voorbeelden/LEESMIJ.md](../voorbeelden/LEESMIJ.md) | Het conceptrapport van de derde meting op de eigen site (11 oktober 2026), niet afgetekend en niet nagelopen door het team |
