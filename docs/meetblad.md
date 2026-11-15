# Het meetblad

Soort: naslag, bij de code van het commando `contribute` (`toolbox/src/lib/run-sheet.ts`). Een veld dat erbij komt of verandert, werkt dit bestand in dezelfde commit bij, en de controle in de verzameling ook.

Een meetblad is één JSON-bestand per onderzoek of snelle meting. Het zegt iets over loep en niets over de site. Waarom het bestaat en hoe het wordt gebruikt, staat in [methode.md](methode.md#het-meetblad-en-het-regelregister); hoe je er een instuurt in [gebruik.md](gebruik.md#een-meetblad-insturen).

## Wat er nooit op staat

Het adres of de naam van de site, een pagina, een selector, een zin uit een oordeel, een bevinding of een pagina, een schermafbeelding, HTML, en wie het onderzoek deed, tekende of besloot.

Dat is op drie plekken geborgd:

- **Bij het maken.** Elke waarde komt uit een vaste lijst, is een regelnummer of een criterium, of is een getal. Een tekst die geen woord van loep is, wordt niet overgenomen.
- **Bij het schrijven.** `contribute` houdt het meetblad tegen wat erop mag staan: alleen de eigen velden, alleen waarden die een woord van loep zijn, alleen technieken die loep kent, niets dat op een adres lijkt, niet de host van de site, en niet de naam van de site als model of als regel. Vindt het iets, dan schrijft het niets en eindigt het met 1. Het zoekt niet naar losse woorden van de site: een site die "open" heet, heeft een meetblad vol met het veld `open`.
- **Bij het insturen.** `check.mjs` in de verzameling weigert een bestand met een onbekend veld, een waarde die geen woord van loep is, of iets dat op een adres lijkt.

## Wat een meetblad wel prijsgeeft

Een meetblad is te koppelen aan een rapport. Is het rapport van het onderzoek openbaar, dan kan iemand met toegang tot de verzameling het meetblad eraan koppelen door de uitkomsten per criterium naast elkaar te leggen, en weet hij dan van welke site het is. Wat hij daarmee extra ziet, is wat op het meetblad staat: aantallen, versies, het taalmodel, de duur, en wat mensen besloten als aantallen.

De uitkomst per criterium is zelf die vingerafdruk, en zonder haar is een meetblad niets waard. Daarom is alleen grover gemaakt wat de koppeling makkelijker maakt en voor onderzoek weinig kost: het aantal bevindingen per criterium en het aantal pagina's van de site staan er als klasse op. Van een onderzoek zonder openbaar rapport is de koppeling niet te maken. Behandel de verzameling als herleidbaar voor wie erin kan lezen.

## De velden

| Veld | Wat het is |
|---|---|
| `schema`, `kind` | `1` en `run-sheet` |
| `id` | Zestien tekens van een hash van wat de run mat (het zaad van het manifest, of bij een oude run de inventaris) en van zijn oordelen. Hetzelfde na opnieuw evalueren, wegen, tekenen of een besluit, zodat een run die twee keer wordt ingestuurd één bestand blijft dat wordt bijgewerkt. Anders voor een tweede beoordeling van dezelfde veegronde. Een kopie van een run in een andere map geeft hetzelfde nummer |
| `siteKey` | Zestien tekens: een hash met sleutel van het adres van de site (de origin en het eerste deel van het pad). De sleutel staat in een bestand op de machine van de inzender |
| `month` | Jaar en maand van het onderzoek. Niet de dag |
| `toolbox.version`, `browser`, `engines` | De versie van loep, van Chromium en van elk van de vier regelsets |
| `models` | De taalmodellen, als het id dat de agents opgaven |
| `modelsPerRole` | Per rol (verkenner, rondgang, beoordelaar, verifieerder, afmaker, poort) welk model, en hoeveel agents. `other` telt de agents die hun model in woorden noemden zonder id, `notGiven` de agents die niets opgaven |
| `purpose` | `verbeteren` of `verantwoorden` |
| `followsUp` | Of het onderzoek volgt op een eerder onderzoek van dezelfde site |
| `technologies` | De technieken die loep op de site herkende, zoals `Web Components (shadow DOM)` |
| `size` | Aantal pagina's in de steekproef, paginatypen, documenten en ingesloten vensters, en het aantal pagina's op de site als klasse (`0-49`, `50-199`, `200-999`, `1000+`) |
| `criteria` | Per succescriterium: de uitkomst, de grond, of de twee beoordelingen het eens waren, hoe het is vastgesteld, de uitkomst per ronde, het aantal bevindingen als klasse (`0`, `1`, `2-5`, `6+`), en per soort het aantal open punten |
| `rulings` | Per regel en criterium: hoe vaak een beoordelaar die de regel noemde zei bevinding, niets aan de hand, ander criterium of open. Een beoordelaar schrijft de naam van een regel zelf; alleen een naam die een regelset in deze run gaf, wordt overgenomen |
| `sessions` | Per regelset, regel en criterium: hoeveel elementen de regel afkeurde in een sessie van een agent, en hoe de andere regelsets erover dachten: ook afgekeurd (`agreed`), niets gezegd (`alone`) of goedgekeurd (`contradicted`). Een element van een pagina telt één keer per regel, hoe vaak een agent er ook naar vroeg. Een regel die over het element alleen twijfelde, telt niet |
| `sweep` | Per regelset en regel uit de veegronde: op hoeveel pagina's afgekeurd, twijfel en geslaagd, en hoeveel elementen afgekeurd |
| `probes` | De proeven van de veegronde: op hoeveel pagina's reflow, zoom en tekstafstand iets zagen, en hoe vaak de wandeling met Tab niet rond kwam |
| `gate` | De bewijspoort: voldoende of niet, het aantal rondes van de verkenner, het aantal keren opnieuw vegen, en het aantal aanvaarde gaten |
| `defects` | Het aantal gebreken, geteld naar ernst en naar eigenaar |
| `human` | Wat mensen deden, als aantallen: getekend of niet (uit `signed/signature.json`), criteria die een persoon vaststelde, besluiten per soort, nametingen, en de status van de verklaring (A tot en met D) |
| `seconds` | De duur per commando, opgeteld |
| `sessionsPerRole` | Per rol het aantal sessies en hoe vaak het budget is verlengd |
| `quick` | Alleen bij een snelle meting: het aantal pagina's, of er iets over de pagina lag en of er is weggeklikt, per regel en proef het aantal plekken op een sterke en op een zwakke grond, en hoe de vergelijking met de basislijn afliep |

Een onderzoek van een oude versie van loep heeft minder: een beoordelaar legt pas sinds 0.18 per regel een uitspraak vast. Wat een run niet heeft, is op het meetblad leeg of `null`. Er wordt niets geschat.

## De sleutel van de site

Runs van dezelfde site moeten bij elkaar te houden zijn, anders telt een site met zeven onderzoeken zeven keer. Een gewone hash van het adres zou te raden zijn: wie een lijst van overheidssites heeft, probeert ze allemaal. Daarom maakt `contribute` een hash met een sleutel uit een bestand op de machine van de inzender (`bijdrage.sleutel` in de configuratiemap van loep), dat daar blijft. Het bestand wordt gemaakt bij het eerste meetblad dat wordt geschreven, niet bij alleen kijken. Een bestand met minder dan 32 tekens wordt geweigerd.

Het gevolg: dezelfde site, ingestuurd door twee mensen, heeft twee sleutels en telt als twee sites. Raakt het bestand weg, dan krijgen dezelfde sites een nieuwe sleutel.

## Wat er nog niet op staat

- **Waar een mens het oneens was met loep.** loep kan nergens vastleggen dat een bevinding niet klopt of dat er een is gemist. Dat is het gegeven waar een verzameling het meest aan heeft.
- **Het verbruik.** Tokens per agent staan niet in een run; `usage` leest ze uit de transcripts van de assistent.
- **Of een meting twee keer hetzelfde gaf.**
