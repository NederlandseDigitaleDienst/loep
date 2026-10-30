# Een goedkope eerste stap: kan een Jev-achtig model beoordelingen overslaan?

Een onderzoek met loep kost op de prijzen van de API ongeveer 200 dollar, en het grootste deel gaat naar agents die per criterium beoordelen en verifiëren. Sinds september 2026 bestaat er een soort model dat precies zulke beslissingen goedkoop belooft: Jev van TypeSafe AI en de tientallen open nabouwsels die erna kwamen. Zo'n model krijgt een toestand (tekst of JSON) en een paar getypeerde vragen, en geeft per vraag een kansverdeling over de antwoorden, in één doorgang en zonder tekst te schrijven. Dit document zoekt uit of zo'n model als poortwachter voor de dure agents kan werken: alleen wat boven een drempel komt, gaat naar een agent.

Drie vragen:

1. Welk deel van de tokens gaat naar beoordelen, en waaraan precies?
2. Kan een Jev-achtig model een deel daarvan goedkoper en sneller maken, en wat kost dat aan gemiste gebreken?
3. Welk model is daarvoor nodig, en kan het lokaal draaien op een Mac met een M2 Pro en 16 GB?

Dit is onderzoek, geen voorstel voor productie. Niets hieronder verandert loep.

Kort:

- Beoordelaars en verifieerders zijn 88% van de kosten, en 61% gaat naar criteria die aan het eind voldoen of niet van toepassing zijn. Het werk is wel geen "veel invoer, dan ja of nee": een derde van de kosten is live meten in de browser, en daar kan een poortwachter vooraf niets mee.
- Een poortwachter die een heel criterium overslaat, werkte in geen enkele vorm. Op het hele dossier scheidt hij niet (AUC 0,5). Per rij van het dossier ziet een Jev-kloon soms precies de foute rij, maar zet hij goede rijen bijna even hoog: bij 95% recall bespaart dat 3%.
- Op één plek werkt het wel een beetje: beslissen of een oordeel "voldoet" of "niet van toepassing" nog een verifieerder nodig heeft. De verifieerder kost daar 53 dollar per onderzoek en veranderde in 245 van de 251 gevallen niets. Een Jev-kloon zet de 6 gevallen waarin hij wel iets veranderde hoger dan bij toeval (p = 0,006). Een drempel die achteraf is gekozen, bespaart 28 dollar per onderzoek (13%) zonder er een te missen; een drempel die van de ene site naar de andere gaat, mist er 1 tot 3 van de 6.
- Lokaal kan het: een Jev-kloon van 4 miljard parameters doet op een M2 Pro met 16 GB een oordeel met vier vragen in 4 seconden, in ongeveer 4 GB. Jev zelf draait niet lokaal.
- Er zijn te weinig gevallen om een drempel te kiezen die een miskans garandeert, en bij bijna één gevaarlijk geval per run duurt het lang voor dat er genoeg zijn. Besluit: niets bouwen. Elke run bewaart de labels al, dus deze meting kan later met dezelfde scripts opnieuw.

## Vraag 1: waar de tokens heen gaan

### Zeven onderzoeken

Zeven onderzoeken van echte sites in oktober 2026, met alle 56 criteria van WCAG 2.2 A en AA, op loep 0.1 tot 0.18. Drie sites: digitaledienst.overheid.nl (vier runs), nerds.digitaledienst.overheid.nl (twee) en developer.overheid.nl (één). Geteld uit de transcripts van de agents met `loep usage`, met de prijzen van de API voor Opus 5.5 zoals in [README.md](README.md). De uitvoer is daar te laag geteld ([modelkeuze.md](modelkeuze.md)); de verhoudingen hieronder veranderen daar weinig door.

| Rol | Agents | Beurten | Kosten | Aandeel |
|---|---|---|---|---|
| Beoordelaars | 398 | 15.380 | 735 dollar | 49% |
| Verifieerders | 418 | 13.381 | 579 dollar | 39% |
| Rondgangen | 61 | 3.742 | 120 dollar | 8% |
| Afmaakronde | 32 | 1.076 | 49 dollar | 3% |
| Stand | 44 | 99 | 8 dollar | 1% |
| **Samen** | | | **1.492 dollar** | |

Per onderzoek is dat gemiddeld 213 dollar, tussen 108 en 311. Beoordelen en verifiëren is 88% van de werkstroom. Het vermoeden klopt dus wat de omvang betreft.

### Het meeste geld bevestigt dat er niets mis is

Per uitkomst van het criterium, beoordelaar, verifieerder en afmaakronde samen:

| Uitkomst | Criteria | Kosten | Aandeel | Per criterium | Beurten per criterium |
|---|---|---|---|---|---|
| Voldoet | 176 | 614 dollar | 45% | 3,49 dollar | 77 |
| Niet van toepassing | 96 | 218 dollar | 16% | 2,27 dollar | 52 |
| Voldoet niet | 81 | 376 dollar | 28% | 4,64 dollar | 97 |
| Kan niet bepalen | 39 | 156 dollar | 11% | 3,99 dollar | 88 |

61% gaat naar criteria die aan het eind voldoen of niet van toepassing zijn. Van de 2.083 waarnemingen die de oordelen vastleggen, hebben er 1.710 (82%) de uitspraak "geen probleem". Een poortwachter die die criteria herkent, raakt dus het grootste deel van de kosten. Een die ook "kan niet bepalen" doorlaat, moet die 11% juist doorsturen: daar is het onderzoek niet klaar.

### Het is geen "veel invoer, dan ja of nee"

De vorm van het vermoeden klopt niet. Een beoordelaar leest niet één keer veel tekst en zegt dan ja of nee; hij werkt gemiddeld 39 beurten, en elke beurt leest de hele context opnieuw. Per beurt de kosten toegerekend aan wat de beurt deed (beoordelaars en verifieerders, zeven onderzoeken):

| Wat de beurt deed | Aandeel van de kosten |
|---|---|
| Live meten in de browser (`open`, `find`, `focus`, `ax`, `click` en de rest) | 31% |
| Vastgelegd bewijs lezen met eigen scripts (dossier, `aria.yaml`, feiten) | 19% |
| De opdracht lezen | 14% |
| Schermafbeeldingen bekijken | 8% |
| Overige eigen scripts | 7% |
| Het oordeel schrijven | 6% |
| Een sessie starten of stoppen | 5% |
| Het dossier opvragen met `loep dossier` | 5% |
| `check-verdict` | 5% |

Ongeveer een derde gaat naar lezen wat de veegronde al vastlegde (dossier en bewijs, plus beelden). Dat deel kan een model dat alleen het dossier leest in principe overnemen. Een derde gaat naar meten op de live pagina; dat kan geen poortwachter vooraf. Bij de nieuwste runs, met `loep dossier` en minder eigen scripts, is het live meten groter: 35% bij nerds-2026-10-29.

Een bevinding wijst altijd naar een waarneming uit een sessie (de methode vraagt dat elke bevinding op een verse pagina opnieuw wordt vastgesteld). Dat de 81 criteria met "voldoet niet" hun bevindingen live onderbouwden, zegt dus niet dat het signaal niet al in het dossier stond. Dat moet de proef hieronder laten zien.

## Vraag 2: een Jev-achtig model als poortwachter

### Hoe zo'n model bedoeld is

Jev en zijn open nabouwsels zijn gemaakt voor kleine, compacte toestanden (JEV-9B is getraind op toestanden tot 856 tokens, JevBench rekent gemiddeld met 950), voor concrete vragen met vaste antwoorden, en voor code die de antwoorden combineert met eigen regels. Een beslissing is één doorgang door het model: de verborgen toestand van het laatste token gaat door een kleine kop met een vak per antwoord, en er wordt niets gegenereerd. Per toepassing past men een temperatuur aan op een honderdtal gelabelde beslissingen. Waar het model niet zeker is, gaat de vraag naar een redenerend model of een mens.

De eerste opzet hieronder deed het tegenovergestelde, en dat is een deel van de uitkomst.

### De lat: wat de agents onderling verschillen

Het label is het oordeel van de agents aan het eind. Dat label is zelf niet vast. Op dezelfde site, met loep 0.1 tot 0.18, waren de runs het eens over "dit criterium heeft aandacht nodig" bij 83% van de paren (digitaledienst, vier runs) en 86% (nerds, twee runs). Bij 17 van de 56 criteria verschilde het label tussen de runs van digitaledienst. Een deel daarvan komt van een andere versie van loep of een veranderde site, maar het is ook het plafond voor elke poortwachter die op deze labels wordt getoetst. Daarom telt hieronder ook de testsite mee, waar het label uit de sleutel komt.

### Een heel criterium overslaan

Eerst zonder taalmodel. Over de 392 criteria van de zeven runs, met 120 die aandacht nodig hadden ("voldoet niet" of "kan niet bepalen"). De vaste regel heeft geen drempel; bij de andere wordt de drempel steeds gekozen op de twee andere sites:

| Poortwachter | Recall, bij een doel van 95% | Besparing |
|---|---|---|
| Een regel uit axe, de vlaggen en de kandidaten van de rondgang samen | 72% | 38% |
| De kans per criterium op de andere sites | 71% | 28% |
| Logistische regressie op die kenmerken | 69% | 31% |
| TF-IDF over het dossier, logistische regressie | 63% | 37% |

Geen enkele haalt zijn recall op een site die hij niet zag. [modelkeuze.md](modelkeuze.md) vond hetzelfde voor `allZero` en nul kandidaten.

Daarna JevK5, een open Jev-kloon (Qwen3.5-4B met een LoRA, gedistilleerd van Jev), met de toestand van het hele criterium: de eerste 8.000 tokens van het dossier en de kandidaten, en drie getypeerde vragen op één keer ingelezen toestand. Op de eerste 65 criteria was de AUC 0,50 en kostte een criterium 20 tot 30 seconden. Die run is daar gestopt. Het dossier is honderden rijen JSON; één afwijkende rij verdwijnt in een kans voor het geheel.

### Per rij van het dossier

Voor acht criteria die over tekst gaan (1.1.1, 2.4.2, 2.4.4, 2.4.6, 2.5.3, 3.1.2, 3.3.2, 4.1.2) wordt elke rij een eigen toestand: één afbeelding met haar tekstalternatief en context, één link met zijn tekst en de kop erboven, één paginatitel naast de h1. De vraag is per criterium concreet, en het hoogste risico over de rijen is de score van het criterium. Samen 2.088 beslissingen over 56 criteria.

| Model | Per beslissing | AUC per criterium | Bij 95% recall, nieuwe site |
|---|---|---|---|
| Qwen3-Reranker-0.6B (kans op "yes" uit de logits) | 115 ms | 0,50 | 1% besparing, 2 criteria gemist |
| JevK5 4B | 418 ms | 0,68 (0,52 tot 0,81) | 3% besparing, 1 criterium gemist |

Op de testsite valt te zien wat het model per rij doet, met de foute tweeling Lindewaard naast de schone Berkenveen. JevK5 zet bij 1.1.1 de rij met `alt="IMG_2041.jpg"` bovenaan (0,78), een gebrek uit de sleutel; de reranker zette die rij laag (0,18). De reranker zet bij 2.4.4 "Klik hier" bovenaan; JevK5 zette die op plaats 18 van 21. Maar de schone tweeling haalt bij 1.1.1 een maximum van 0,75, en bij 3.3.2 en 4.1.2 zijn de maxima gelijk. Het model herkent een foute rij soms, maar geeft goede rijen bijna dezelfde kans, en met tientallen rijen per criterium is er altijd wel een die hoog uitkomt. Overslaan per criterium vraagt dat geen enkele rij een vals alarm geeft; dat haalt dit niet.

### Een verifieerder overslaan

De verifieerder zoekt tegenbewijs bij een oordeel dat er al ligt. Zijn invoer is klein (het oordeel is gemiddeld 4.300 tekens; ingekort tot wat de poort leest ongeveer 1.100 tokens) en het label ligt in elke run: `oordeel.json` tegenover `final.json`. Dat is de vorm waar een Jev-achtig model voor gemaakt is.

| Oordeel van de beoordelaar | Oordelen | Verifieerder veranderde de uitkomst | Van "voldoet" of "n.v.t." naar iets anders | Kosten verifieerder |
|---|---|---|---|---|
| Voldoet | 158 | 5 | 5 | 270 dollar |
| Niet van toepassing | 93 | 1 | 1 | 103 dollar |
| Voldoet niet | 74 | 6 | | 123 dollar |
| Kan niet bepalen | 65 | 6 | | 78 dollar |

Na "voldoet niet" en "kan niet bepalen" blijft de verifieerder, want daar verandert hij vaker iets en gaat het criterium toch al naar het rapport. Na "voldoet" en "n.v.t." kost hij 53 dollar per onderzoek, een kwart van het geheel, en veranderde hij 6 keer op 251 iets. Die zes zijn de gevallen die een poortwachter niet mag missen: 2.4.3 (twee keer), 2.4.7, 1.4.12, 2.4.5 en 3.3.1, allemaal criteria waarbij bediening en focus een rol spelen.

De toestand is het oordeel (criterium, uitkomst, samenvatting, waarnemingen met hoe ze zijn gedaan, kandidaten, wat ontbreekt). Daarop vier vragen met ja of nee: is elk onderdeel gemeten, hangt het af van interactie die maar deels is gemeten, steunt het op een aanname, en zou een tweede meting tot iets anders komen. De score is het gemiddelde risico.

| Model | Per oordeel | Plaatsen van de 6 (van 251) | Kans bij toeval | Drempel achteraf | Drempel van de andere sites |
|---|---|---|---|---|---|
| JevK5 4B, 4-bit | 3,8 s | 33, 54, 61, 90, 93, 107 | 0,006 | 144 overgeslagen, 0 gemist, 28 dollar per onderzoek | 173 overgeslagen, 3 gemist, 34 dollar |
| Plumb-4B, 8-bit | 5,0 s | 59, 62, 74, 89, 106, 139 | 0,027 | 112 overgeslagen, 0 gemist, 21 dollar | 122 overgeslagen, 1 gemist, 24 dollar |
| Zonder model: overslaan tenzij het criterium op een andere site misging | | | | | 239 overgeslagen, 4 gemist, 50 dollar |

Het gemiddelde van de vier vragen werkt beter dan elke vraag apart; bij JevK5 haalt "is elk onderdeel gemeten" alleen 102 in plaats van 144. Losse, concrete vragen met een vaste combinatie in code is ook hoe Jev bedoeld is.

Hier zit signaal, maar nog geen drempel die mee kan naar een nieuwe site. De drie gevallen van digitaledienst krijgen bij JevK5 de laagste scores van de zes (0,056 tot 0,066), lager dan elk geval op de andere sites. Met zes positieve gevallen valt een drempel met een garantie niet te kiezen: voor een miskans van 5% met 95% zekerheid zijn er volgens een Clopper-Pearson-grens ongeveer 60 nodig zonder één misser.

### Wat het oplevert als het werkt

Per onderzoek van de omvang van deze zeven, met de prijzen van de API:

| Waar | Bovengrens | Wat gemeten is |
|---|---|---|
| Een heel criterium overslaan | 119 dollar (56%) | geen bruikbare drempel |
| Criterium naar een lichte route (geen verifieerder, beoordelaar op Sonnet) | 87 dollar (41%) | idem |
| Per rij, alleen de acht tekstcriteria | 16 dollar (7%) | 3% |
| Verifieerder na "voldoet" of "n.v.t." | 53 dollar (25%) | 21 tot 28 dollar met een drempel achteraf, nog niet veilig op een nieuwe site |

De doorlooptijd daalt mee: verifieerders zijn ongeveer de helft van de agents van een fase. Op een abonnement gaat het niet om dollars maar om ruimte: 13% minder verbruik is 15% meer onderzoeken in dezelfde ruimte.

Het verlies is het gevaar zelf. Een verifieerder die wordt overgeslagen bij een van die zes gevallen, laat een "voldoet" in het rapport staan dat bij nadere meting "voldoet niet" of "kan niet bepalen" was. Bij 2.4.3 en 2.4.7 gaat het om focus en toetsenbord, voor een deel van de gebruikers de kern van een site.

## Vraag 3: welk model, en past het op de Mac

### Jev zelf

Jev ([documentatie](https://docs.typesafe.ai/concepts/system-one)) is gesloten en alleen bereikbaar via een API in de Verenigde Staten. Het neemt tekst en JSON aan, tot 32.000 tokens voor de toestand, geen beelden. Welke talen het kent en hoe groot het is, staat nergens. De prijs is 0,042 dollar per miljoen tokens invoer; uitvoer is gratis. De verifieerder-poort hierboven leest ongeveer 50.000 tokens per onderzoek, dus een fractie van een cent. Lokaal draaien kan niet, en een run met een inlog of opnames uit een chat zou die gegevens naar de dienst sturen.

### De open nabouwsels

Binnen zes weken na Jev verschenen er ongeveer honderd open modellen met dezelfde vorm (lijst: [awesome-system-one](https://github.com/andyrewlee/awesome-system-one); ranglijsten: [JevBench](https://github.com/fstandhartinger/jevbench) en de Jev Decision Index). De meeste cijfers zijn van de makers zelf. Ze vallen in een paar soorten:

- een bidirectionele encoder die per antwoord een merkteken scoort, alle vragen in één doorgang (Vela 2.0 van vLLM Semantic Router, Laya, GLiClass);
- een decoder die de toestand één keer inleest en elke vraag in een eigen blok beantwoordt (Liquid d1);
- een decoder die de logits van de antwoordletters leest, meestal Qwen3.5 met een LoRA (JevK5, Plumb, decider, Kev);
- een bevroren taalmodel met een kleine getrainde kop (JEV-9B, Imajev).

Bijna alle zijn getraind op Engels en op korte toestanden. Wat er onderzoek over is, wijst dezelfde kant op als deze meting: ze zijn goedkoper en consistenter dan een redenerend model, maar gevoeliger voor de vorm van de vraag ([arXiv 2610.18122](https://arxiv.org/abs/2610.18122)), en hun kalibratie houdt niet vanzelf stand als de verhouding tussen de antwoorden verschuift ([arXiv 2610.26325](https://arxiv.org/abs/2610.26325)), zoals tussen developer.overheid.nl (68% van de criteria met aandacht) en nerds (16%).

### Gemeten op een M2 Pro met 16 GB

| Model | Vorm | Geheugen | Snelheid |
|---|---|---|---|
| Qwen3-Reranker-0.6B, 4-bit MLX | logits van yes en no | 1,4 GB | 1.700 tot 3.400 tokens per seconde, 62 tot 124 ms per korte beslissing |
| JevK5 (Qwen3.5-4B), zelf omgezet naar 4-bit MLX | letterlogits | 3,6 tot 4,7 GB | ongeveer 430 tokens per seconde; 0,4 s per rij, 3,8 s per oordeel met vier vragen |
| Plumb-4B, 8-bit MLX | letterlogits | 6,2 GB | 5,0 s per oordeel met vier vragen |

De verifieerder-poort kost per onderzoek ongeveer 36 oordelen maal 4 seconden, zo'n 2,5 minuut, naast de uren die de agents werken. Het past naast de browsers van loep. Een keer is een run gestopt omdat het geheugen opraakte terwijl ook een virtuele machine voor Docker draaide; naast de virtuele Mac voor VoiceOver wordt het krap.

Niet gedraaid, en waarom:

- Vela-2.0-0.3B en -0.8B, de enige Jev-achtige modellen die Nederlands noemen, en Laya: die hebben eigen code uit hun repository nodig om te draaien (`trust_remote_code`). Dat is in deze sessie niet toegestaan.
- Imajev-4B, op JevBench de hoogste onder de 10 miljard parameters: de prompt en de server staan in een eigen repository.
- Liquid d1: MLX-VLM ondersteunt het nog niet, Nederlands staat er niet bij, en de licentie beperkt commercieel gebruik.

### Welk model het moet zijn

Voor de verifieerder-poort is een 4B-decoder genoeg, en die draait lokaal. Welke kloon het is, maakt in deze meting minder uit dan verwacht: Plumb scoort op JevBench hoger dan JevK5, maar hier slechter. De grotere stap is het model op deze taak afstemmen, zoals de nabouwsels het zelf doen: een temperatuur of een kleine LoRA op de paren `oordeel.json` en `final.json`. Daar zijn er nu 390 van, met 6 gevaarlijke. Een Nederlandse encoder als Vela-0.8B is de tweede kandidaat zodra eigen code van een model mag draaien.

## Besluit

Er komt nu geen poortwachter in loep.

- **De winst is klein en nog niet veilig.** Hooguit 13% van een onderzoek, met een drempel die achteraf is gekozen; op een nieuwe site mist de poort 1 tot 3 van de 6 gevallen. Een gemiste verifieerder bij 2.4.3 of 2.4.7 is een onterecht "voldoet" over focus en toetsenbord in een getekend rapport.
- **De data komt langzaam.** Voor een miskans van 5% met 95% zekerheid zijn ongeveer 60 gevaarlijke gevallen nodig zonder één misser. Bij bijna één per run zijn dat zo'n 70 runs.
- **Meelopen is niet nodig.** Elke run bewaart `oordeel.json` en `final.json` al. De meting hierboven draait op nieuwe runs opnieuw in een kwartier, zonder iets in loep te veranderen.
- **Het zou loep zwaarder maken**: een afhankelijkheid van MLX en Apple Silicon en een model van enkele gigabytes, voor een stap die ook op Linux moet draaien.

De meting gaat opnieuw, met de scripts in [gate/](gate/), als een van deze dingen gebeurt:

1. Er zijn ongeveer 30 runs bij gekomen sinds deze meting.
2. Er is een Jev-achtig model dat Nederlands en toestanden van enkele duizenden tokens aantoonbaar aankan, en dat zonder eigen code uit zijn repository draait.

Een heel criterium overslaan en de poort per rij volgen we niet verder. De meting geeft geen aanwijzing dat een beter model dat oplost: een criterium steunt op honderd rijen, en één vals alarm stuurt het hele criterium door.

Voor dezelfde kosten ligt een andere route klaar: de verifieerders op Sonnet, zoals voorgesteld in [modelkeuze.md](modelkeuze.md), met een meetopzet op de sleutel van de testsite.

## Hoe de cijfers zijn gemaakt

- Kosten per agent komen uit `loep usage` op de transcripts van de werkstroom van elk onderzoek, met de prijzen uit [README.md](README.md). De toerekening per beurt verdeelt de kosten van een beurt gelijk over de aanroepen in die beurt.
- Labels komen uit `evaluation.json` en `verdicts/<criterium>/oordeel.json` en `final.json` van elke run; op de testsite uit `toolbox/fixtures/reference-lindewaard.json` en `reference-berkenveen.json`.
- "Drempel van de andere sites": voor elke site wordt de drempel gekozen op de twee andere, en toegepast op de site zelf. Drie sites is weinig.
- De scripts staan in [gate/](gate/). Ze lezen de runs uit `toolbox/runs`, die niet in de repository staan.
