# Het meetblad

Soort: naslag, bij de code van het commando `contribute` (`toolbox/src/lib/run-sheet.ts`). Een veld dat erbij komt of verandert, werkt dit bestand in dezelfde commit bij, en de controle in de verzameling ook.

Een meetblad is één JSON-bestand per onderzoek of snelle meting. Het zegt iets over loep en niets over de site. Waarom het bestaat en hoe het wordt gebruikt, staat in [methode.md](methode.md#het-meetblad-en-het-regelregister); hoe je er een instuurt in [gebruik.md](gebruik.md#een-meetblad-insturen).

## Wat er nooit op staat

Het adres of de naam van de site, een pagina, een selector, een zin uit een oordeel, een bevinding of een pagina, een schermafbeelding, HTML, en wie het onderzoek deed, tekende of besloot.

Dat is op drie plekken geborgd:

- **Bij het maken.** Elke waarde komt uit een vaste lijst, is een regelnummer of een criterium, of is een getal. Een tekst die geen woord van loep is, wordt niet overgenomen.
- **Bij het schrijven.** `contribute` zoekt op het meetblad naar het adres van de site, de delen van de hostnaam en het pad, en de naam van de site en de organisatie. Vindt het iets, dan schrijft het niets en eindigt het met 1.
- **Bij het insturen.** `check.mjs` in de verzameling weigert een bestand met een onbekend veld, een waarde die geen woord van loep is, of iets dat op een adres lijkt.

Wat blijft: wie een onderzoek al heeft, kan het meetblad erbij terugvinden aan de maand, de versie en het aantal pagina's.

## De velden

| Veld | Wat het is |
|---|---|
| `schema`, `kind` | `1` en `run-sheet` |
| `id` | Zestien tekens van de hash van `evaluation.json`, of van `quick/summary.json` bij een snelle meting. Onderscheidt runs; hetzelfde onderzoek in twee mappen geeft hetzelfde nummer |
| `siteKey` | Zestien tekens: een hash met sleutel van het adres van de site (de origin en het eerste deel van het pad). De sleutel staat in een bestand op de machine van de inzender |
| `month` | Jaar en maand van het onderzoek. Niet de dag |
| `toolbox.version`, `browser`, `engines` | De versie van loep, van Chromium en van elk van de vier regelsets |
| `models` | De taalmodellen, als het id dat de agents opgaven |
| `modelsPerRole` | Per rol (verkenner, rondgang, beoordelaar, verifieerder, afmaker, poort) welk model, en hoeveel agents. `notGiven` telt de agents die niets opgaven |
| `purpose` | `verbeteren` of `verantwoorden` |
| `followsUp` | Of het onderzoek volgt op een eerder onderzoek van dezelfde site |
| `technologies` | De technieken die loep op de site herkende, zoals `Web Components (shadow DOM)` |
| `size` | Aantal pagina's in de steekproef, paginatypen, pagina's op de site, documenten en ingesloten vensters |
| `criteria` | Per succescriterium: de uitkomst, de grond, of de twee beoordelingen het eens waren, hoe het is vastgesteld, de uitkomst per ronde, het aantal bevindingen, en per soort het aantal open punten |
| `rulings` | Per regel en criterium: hoe vaak een beoordelaar die de regel noemde zei bevinding, niets aan de hand, ander criterium of open |
| `sessions` | Per regelset, regel en criterium: hoeveel elementen de regel afkeurde in een sessie van een agent, en hoe de andere regelsets erover dachten: ook afgekeurd (`agreed`), niets gezegd (`alone`) of goedgekeurd (`contradicted`) |
| `sweep` | Per regelset en regel uit de veegronde: op hoeveel pagina's afgekeurd, twijfel en geslaagd, en hoeveel elementen afgekeurd |
| `probes` | De proeven van de veegronde: op hoeveel pagina's reflow, zoom en tekstafstand iets zagen, en hoe vaak de wandeling met Tab niet rond kwam |
| `gate` | De bewijspoort: voldoende of niet, het aantal rondes van de verkenner, het aantal keren opnieuw vegen, en het aantal aanvaarde gaten |
| `defects` | Het aantal gebreken, geteld naar ernst en naar eigenaar |
| `human` | Wat mensen deden, als aantallen: getekend of niet, criteria die een persoon vaststelde, besluiten per soort, nametingen, en de status van de verklaring (A tot en met D) |
| `seconds` | De duur per commando, opgeteld |
| `sessionsPerRole` | Per rol het aantal sessies en hoe vaak het budget is verlengd |
| `quick` | Alleen bij een snelle meting: het aantal pagina's, of er iets over de pagina lag en of er is weggeklikt, per regel en proef het aantal plekken op een sterke en op een zwakke grond, en hoe de vergelijking met de basislijn afliep |

Een onderzoek van een oude versie van loep heeft minder: een beoordelaar legt pas sinds 0.18 per regel een uitspraak vast. Wat een run niet heeft, is op het meetblad leeg of `null`. Er wordt niets geschat.

## De sleutel van de site

Runs van dezelfde site moeten bij elkaar te houden zijn, anders telt een site met zeven onderzoeken zeven keer. Een gewone hash van het adres zou te raden zijn: wie een lijst van overheidssites heeft, probeert ze allemaal. Daarom maakt `contribute` een hash met een sleutel uit een bestand dat het bij de eerste keer op de machine van de inzender zet (`bijdrage.sleutel` in de configuratiemap van loep) en dat daar blijft.

Het gevolg: dezelfde site, ingestuurd door twee mensen, heeft twee sleutels en telt als twee sites. Raakt het bestand weg, dan krijgen dezelfde sites een nieuwe sleutel.

## Wat er nog niet op staat

- **Waar een mens het oneens was met loep.** loep kan nergens vastleggen dat een bevinding niet klopt of dat er een is gemist. Dat is het gegeven waar een verzameling het meest aan heeft.
- **Het verbruik.** Tokens per agent staan niet in een run; `usage` leest ze uit de transcripts van de assistent.
- **Of een meting twee keer hetzelfde gaf.**
