---
name: nldd-a11y-statement
description: "Maak met loep de toegankelijkheidsverklaring van een overheidswebsite na een WCAG-onderzoek, volgens het wettelijke model (Stcrt. 2026, 515) en het invulblad voor de invulassistent op toegankelijkheidsverklaring.nl. Gebruik dit bij 'toegankelijkheidsverklaring maken', 'verklaring bijwerken', 'status A, B of C', 'register van toegankelijkheidsverklaringen', 'invulassistent'."
metadata:
  status: concept
---

# Toegankelijkheidsverklaring

Je maakt de verklaring uit een onderzoek dat al bestaat. Heeft de gebruiker nog geen onderzoek, gebruik dan eerst `nldd-a11y-audit`.

## Wat je nooit doet

- **Gegevens van de organisatie verzinnen.** Contactadres, klachtenprocedure, ombudsman, maatregelen, data en de naam of functie van de tekenbevoegde vraag je aan de gebruiker. Wat je niet weet, blijft in de tekst staan als `[nog invullen: ...]`.
- **De status aanpassen.** De toolbox berekent de status uit het onderzoek en kent er drie: A (voldoet volledig), B (voldoet gedeeltelijk) en C (eerste maatregelen genomen). Blijft er één criterium open, dan is de status C. Is het onderzoek niet afgetekend of is een criterium niet beoordeeld, dan geeft de toolbox geen status en staat er "nog niet vast te stellen". Status D (voldoet niet) uit het register geeft de toolbox nooit: vul die niet zelf in. Wil de gebruiker een hogere status, dan moet het onderzoek verder, niet de verklaring.
- **Publiceren of het register invullen.** Dat doet de gebruiker. Het register heeft geen koppeling.
- **Een definitieve verklaring maken van een onderzoek dat niet is afgetekend.** Zonder handtekening kan alleen een concept.

## Stappen

`LOEP` is `node <map van deze plugin>/toolbox/src/cli.ts`, `RUN` de map van het onderzoek.

1. Controleer of het onderzoek is afgetekend en ongewijzigd: `LOEP verify --run RUN`. De uitvoer moet nul afwijkingen melden en zeggen op welke datum en voor welk zegel is afgetekend. Staat er "niet afgetekend" of een afwijking, dan kan alleen een concept.
2. Vraag de gebruiker om de gegevens van de organisatie en schrijf ze naar `RUN/verklaring-invoer.json`:
   ```json
   {
     "organisation": "naam van de overheidsinstantie",
     "dashboardOrganisationNumber": "nummer op dashboard.digitoegankelijk.nl",
     "subdomains": ["subdomeinen en andere domeinen die bij de website horen"],
     "reportUrl": "rechtstreeks openbaar adres van het rapport",
     "contactUrl": "...",
     "complaintsUrl": "...",
     "ombudsmanUrl": "...",
     "additionalInformationNl": "...",
     "targetDate": "2027-03-01",
     "plannedEvaluationDate": "2027-01-15",
     "alternativesNl": "...",
     "measuresNl": { "1.4.10": "...", "*": "..." },
     "approval": { "date": "2026-11-01", "functionTitle": "...", "lastReviewed": "2026-11-01" }
   }
   ```
   Alle velden behalve `organisation` mogen ontbreken. De maatregelen in het rapport zijn voorstellen; de organisatie beslist wat ze toezegt en wanneer.
3. Maak de verklaring: `LOEP statement --run RUN` (of met `--concept` zolang het onderzoek niet is afgetekend). De verklaring en `verklaring-invoer.json` staan buiten het zegel van het onderzoek: ze maken of aanpassen verandert niets aan wat is afgetekend, en `LOEP verify --run RUN` blijft kloppen.
4. Laat de gebruiker zien wat er nog open staat. De opdracht meldt het aantal punten; ze staan in `RUN/verklaring/verklaring.json` onder `openItems`.
5. Wijs de gebruiker op `RUN/verklaring/invulassistent.md`: de waarden per stap van de invulassistent, om over te nemen.

## Wat de gebruiker moet weten

- De verklaring noemt het onderzoek "automatisch onderzoek" en "in eigen beheer". Of het register dat als onderbouwing voor status A of B aanvaardt, is niet bevestigd. Zie `docs/methode.md`.
- Wettelijk geldt nu WCAG 2.1 via EN 301 549 v3.2.1. De status volgt die versie. Wat alleen onder WCAG 2.2 niet wordt gehaald, staat apart onder de aanvullende informatie.
- Een verklaring moet minstens één keer per jaar worden bijgewerkt en het onderzoek mag niet ouder zijn dan drie jaar.
