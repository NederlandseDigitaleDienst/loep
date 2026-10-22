# Welk model per rol: analyse van drie onderzoeken

Een onderzoek kost op Opus 5.5 gemiddeld ongeveer 181 dollar aan prijzen van de API, en de helft daarvan gaat naar de beoordelaars. Sonnet 5.5 kost in elke soort token de helft. De vraag is welke rollen op een goedkoper model kunnen zonder dat het oordeel slechter wordt. Dit document zet op een rij wat drie onderzoeken daarover zeggen, en doet een voorstel. Het voorstel is nog niet gemeten; wat er gemeten moet worden en wat dat kost, staat onder "Meting". Het besluit dat gevraagd wordt, staat onderaan.

Kort:

- De stand-agent doet alleen werk zonder oordeel. Die gaat naar Haiku; dat is al besloten.
- De verifieerder veranderde iets wezenlijks bij 7% van de oordelen, en altijd bij een zwaar criterium. Bij de rustige criteria en na "kan niet bepalen" veranderde hij nooit iets.
- De kosten volgen het aantal beurten. Sonnet is alleen goedkoper zolang het minder dan ongeveer 1,9 keer zoveel beurten nodig heeft.
- De uitvoer is in de transcripts te laag geteld. Een onderzoek kost daardoor waarschijnlijk ongeveer 212 dollar, niet 181. Dat geldt ook voor de nulmeting in [README.md](README.md).

## De drie onderzoeken

Drie onderzoeken van echte sites in oktober 2026, met alle 56 criteria van WCAG 2.2 A en AA. Alle 416 agents van de werkstroom draaiden op Claude Opus 5.5. Onderzoek 1 is de nulmeting uit [README.md](README.md).

| Onderzoek | Agents | Beurten | Kosten | Kosten met geschatte uitvoer |
|---|---|---|---|---|
| 1 | 134 | 4.881 | 184,06 dollar | 216,50 dollar |
| 2 | 152 | 5.555 | 210,69 dollar | 245,41 dollar |
| 3 | 130 | 3.934 | 148,81 dollar | 174,28 dollar |
| **Gemiddeld** | | | **181,18 dollar** | **212,06 dollar** |

De kosten zijn gerekend met de prijzen van de API voor Opus 5.5 op 19 oktober 2026, zoals in [README.md](README.md). De kolom met geschatte uitvoer staat uitgelegd onder "De uitvoer is te laag geteld".

## Kosten per rol

Gemiddeld per onderzoek, over de drie onderzoeken:

| Rol | Beurten per agent | Kosten | Aandeel | Op Sonnet |
|---|---|---|---|---|
| Stand | 2,0 | 1,24 dollar | 0,7% | 0,62 dollar |
| Rondgangen | 41,3 | 15,88 dollar | 8,8% | 7,94 dollar |
| Beoordelaars | 41,3 | 96,38 dollar | 53,2% | 48,19 dollar |
| Verifieerders | 29,1 | 59,69 dollar | 32,9% | 29,84 dollar |
| Afmaakronde | 31,8 | 8,00 dollar | 4,4% | 4,00 dollar |

De afmaakronde verschilt sterk per onderzoek: 1 agent in onderzoek 1, 20 in onderzoek 2, geen in onderzoek 3. Het gemiddelde komt dus bijna helemaal uit onderzoek 2.

De kolom "Op Sonnet" gaat uit van hetzelfde aantal beurten. Dat is de bovengrens van de besparing (zie "Kosten volgen de beurten").

## De uitvoer is te laag geteld

De meeste berichten in de transcripts van Claude Code dragen alleen de telling van het begin van het antwoord: 1 tot 16 tokens uitvoer. Van de 14.370 berichten in de drie onderzoeken hebben er 3.125 de telling van het einde. De uitvoer in de tabellen van [README.md](README.md) en in de kolom "Kosten" hierboven is daardoor te laag.

Een schatting uit de 3.125 berichten met de eindtelling:

- Uit de berichten zonder denkwerk: 0,587 tokens per teken dat in het antwoord te zien is.
- Uit de berichten met denkwerk: daar bovenop gemiddeld ongeveer 201 tokens voor het denkwerk.
- Voor elk ander bericht: het aantal zichtbare tekens maal 0,587, plus 201 als het bericht denkwerk had.

| Rol | Uitvoer geteld | Uitvoer geschat | Factor | Kosten geteld | Kosten met geschatte uitvoer |
|---|---|---|---|---|---|
| Stand | 35.967 | 38.871 | 1,1 | 3,71 dollar | 3,77 dollar |
| Rondgangen | 190.881 | 695.597 | 3,6 | 47,65 dollar | 57,74 dollar |
| Beoordelaars | 724.619 | 2.993.386 | 4,1 | 289,15 dollar | 334,52 dollar |
| Verifieerders | 576.147 | 2.208.586 | 3,8 | 179,06 dollar | 211,70 dollar |
| Afmaakronde | 77.338 | 299.852 | 3,9 | 23,99 dollar | 28,44 dollar |

Samen over de drie onderzoeken. Per onderzoek is dat ongeveer 212 dollar in plaats van 181, 17% meer. Voor de nulmeting (onderzoek 1) is het ongeveer 216 dollar in plaats van 184, met ongeveer 43 dollar uitvoer in plaats van 11.

Dit is een schatting. Ze neemt aan dat de berichten met eindtelling dezelfde verhouding tussen tekst en tokens hebben als de andere. Ze neemt ook aan dat de tellingen van de cache wel kloppen, omdat die al bij het begin van een antwoord bekend zijn. De rest van dit document rekent met de getelde kosten, tenzij er "met geschatte uitvoer" staat. Een besparing in dollars is met de geschatte uitvoer ongeveer 16 tot 21% hoger, afhankelijk van de rol.

## Kosten volgen de beurten

Per agent volgen de kosten het aantal beurten bijna recht evenredig. Een rechte lijn door de logaritmen van kosten en beurten geeft:

| Rol | Agents | Exponent | Correlatie |
|---|---|---|---|
| Beoordelaars | 168 | 1,12 | 0,97 |
| Rondgangen | 45 | 0,99 | 0,97 |
| Verifieerders | 168 | 0,91 | 0,97 |

Kosten zijn dus ongeveer beurten tot de macht 0,9 tot 1,1. Sonnet kost per token de helft. Neemt Sonnet meer beurten, dan is het alleen goedkoper zolang het minder dan 2 tot de macht 1/exponent keer zoveel beurten nodig heeft: 1,9 keer bij de beoordelaars, 2,0 keer bij de rondgangen en 2,1 keer bij de verifieerders. Bij 1,5 keer zoveel beurten blijft van de besparing van 50% bij de beoordelaars nog ongeveer 21% over.

## Wat elke rol doet

### Stand

Elke stand-agent deed precies 2 beurten: één aanroep van een commando in de shell, en één antwoord in JSON. Geen aanroep mislukte. Er is niets te beoordelen; het werk is mechanisch. De context bleef per beurt rond 39.000 tokens, ver onder de grens van 100.000 tokens waarboven Haiku duurder wordt. Haiku is hier dus veilig en scheelt ongeveer 1 dollar per onderzoek.

### Rondgangen

De 45 rondgangen gaven samen 417 kandidaten aan de beoordelaars: 176, 152 en 89 in de drie onderzoeken, gemiddeld 6,4 tot 11,0 per rondgang. Wat er met die kandidaten gebeurde:

| Uitkomst bij de beoordeling | Kandidaten |
|---|---|
| Bevinding | 184 |
| Geen probleem | 189 |
| Hoort bij een ander criterium | 35 |
| Open | 9 |

Van de 130 bevindingen aan het eind staan er 85 (65%) op een pagina waar een rondgang een kandidaat had voor hetzelfde criterium. De rondgangen leveren dus een groot deel van wat later een bevinding wordt. Een rondgang die iets mist, kan een bevinding kosten. Daarom is het risico middel, ook al oordeelt een rondgang zelf niet.

`check-walk` weigerde 8 van de 45 rondgangen één keer. Alle 8 slaagden bij de tweede controle. 2,9% van de aanroepen mislukte, ongeveer zoveel als bij de andere rollen.

### Verifieerders

Per onderzoek zijn er 56 oordelen, samen 168. De verifieerder veranderde iets wezenlijks (de uitkomst, een bevinding of de ernst) bij 12 van de 168 (7%):

| Wat veranderde | Keer |
|---|---|
| Uitkomst | 5 |
| Bevinding geschrapt | 8 |
| Bevinding toegevoegd | 2 |
| Ernst | 1 |

Eén oordeel kan meer dan één wijziging hebben. Van de 8 geschrapte bevindingen waren er 6 niet genoeg onderbouwd (`notSupported`) en 2 bij het verkeerde criterium (`wrongCriterion`). Geen enkele werd geschrapt omdat ze niet na te doen was. Twee keer vond de verifieerder iets wat de beoordelaar had laten liggen, en één keer werd "voldoet" daardoor "voldoet niet".

Alle 12 wijzigingen vielen bij criteria van klasse C (zie hieronder). Bij de 96 oordelen van klasse A en B veranderde de verifieerder niets. Na een oordeel "kan niet bepalen" van de beoordelaar veranderde hij 0 van de 37 keer iets.

| Oordeel van de beoordelaar | Oordelen | Wezenlijk veranderd |
|---|---|---|
| Voldoet niet | 56 | 9 |
| Voldoet | 62 | 2 |
| Niet van toepassing | 13 | 1 |
| Kan niet bepalen | 37 | 0 |

### Beoordelaars

De beoordelaars zijn de duurste rol en hebben de grootste context: 4.871 van hun 6.935 beurten hadden meer dan 100.000 tokens context. Haiku valt daarmee af, want daarboven wordt Haiku vijf keer duurder. Of Sonnet even goed oordeelt, verschilt per criterium. Daarvoor zijn de klassen hieronder.

### Afmaakronde

21 agents, waarvan 20 in onderzoek 2. Dat is te weinig om iets over een lichter model te zeggen. De afmaakronde blijft op Opus.

## Klassen van criteria

Een vaste regel deelt elk criterium in, op de uitkomsten van de drie onderzoeken samen:

- **A rustig:** in geen van de drie onderzoeken "voldoet niet" (bij de beoordelaar of aan het eind), geen bevinding, geen wezenlijke wijziging van de verifieerder, en samen hooguit 3 kandidaten.
- **C zwaar:** in minstens twee onderzoeken "voldoet niet", of een wezenlijke wijziging van de verifieerder, of samen minstens 15 kandidaten.
- **B tussen:** de rest.

| Klasse | Criteria | Beurten beoordelaar | Bevindingen | Beoordelaars per onderzoek | Verifieerders per onderzoek | Afmaakronde per onderzoek |
|---|---|---|---|---|---|---|
| A rustig | 25 | 30 gemiddeld (12 tot 66) | 0 | 29,35 dollar | 22,18 dollar | 5,15 dollar |
| B tussen | 7 | 39 gemiddeld (17 tot 69) | 10 | 11,55 dollar | 7,01 dollar | 1,56 dollar |
| C zwaar | 24 | 53 gemiddeld (14 tot 92) | 120 | 55,48 dollar | 30,50 dollar | 1,29 dollar |

- **A:** 1.2.1, 1.2.2, 1.2.3, 1.2.4, 1.2.5, 1.3.4, 1.4.2, 1.4.4, 2.2.1, 2.2.2, 2.3.1, 2.4.1, 2.5.1, 2.5.4, 2.5.7, 3.2.1, 3.2.2, 3.2.3, 3.2.4, 3.2.6, 3.3.3, 3.3.4, 3.3.7, 3.3.8, 4.1.1
- **B:** 1.3.2, 1.4.12, 2.1.2, 2.1.4, 2.5.2, 3.1.1, 3.3.1
- **C:** 1.1.1, 1.3.1, 1.3.3, 1.3.5, 1.4.1, 1.4.3, 1.4.5, 1.4.10, 1.4.11, 1.4.13, 2.1.1, 2.4.2, 2.4.3, 2.4.4, 2.4.5, 2.4.6, 2.4.7, 2.4.11, 2.5.3, 2.5.8, 3.1.2, 3.3.2, 4.1.2, 4.1.3

De klassen gelden voor deze drie sites. Ze hangen af van de site: op een site met eigen video zijn de criteria 1.2.x niet rustig. Een andere site kan een criterium uit A dus zwaar maken.

## Geen veilig signaal vooraf

Om per criterium vooraf te kiezen, zou een signaal uit de veegronde moeten zeggen dat een criterium rustig wordt. De twee voor de hand liggende signalen zijn dat niet:

- **`allZero` in het dossier** (alle tellingen uit de inventaris die het criterium nodig heeft zijn 0). Dat staat in 42 van de 168 dossiers en is 7 keer waar. Geen van die 7 eindigde als "niet van toepassing": 3 keer "voldoet" en 4 keer "kan niet bepalen". Van de 12 criteria die aan het eind "niet van toepassing" waren, had geen enkele `allZero`: bij 5 was het onwaar, bij 7 stond het er niet.
- **0 kandidaten.** Dat gold voor 97 van de 168 oordelen. Daarvan eindigden er 8 als "voldoet niet", met samen 12 van de 130 bevindingen.

## Voorstel

Dit is een voorstel. Behalve de stand-agent gaat geen rol over voordat de meting hieronder dat toelaat.

Besparing per onderzoek, met de getelde kosten:

| Rol | Nu (Opus) | Voorstel | Besparing | Risico voor het oordeel | Wanneer |
|---|---|---|---|---|---|
| Stand | 1,24 dollar | Haiku | ongeveer 1 dollar | geen | besloten, in een eigen voorstel |
| Verifieerders A en B | 29,19 dollar | Sonnet | 14,6 dollar | klein | na M2 |
| Rondgangen | 15,88 dollar | Sonnet | 7,9 dollar | middel | na M2 |
| Beoordelaars A | 29,35 dollar | Sonnet | 14,7 dollar | middel | na M3, ook op de testsite |
| Beoordelaars B | 11,55 dollar | Sonnet | 5,8 dollar | groter | na M3, ook op de testsite |
| Beoordelaars C | 55,48 dollar | Opus | | | |
| Verifieerders C | 30,50 dollar | Opus | | | |
| Afmaakronde | 8,00 dollar | Opus | | | |

Gaat alles over wat het voorstel noemt, dan is dat ongeveer 44 dollar per onderzoek, een kwart, bij hetzelfde aantal beurten. Met de geschatte uitvoer ligt dat bedrag hoger, en meer beurten maken het lager.

Waarom deze volgorde:

- **Verifieerders A en B:** 96 oordelen, 0 wezenlijke wijzigingen. Het risico is dat een zwakkere verifieerder een fout laat staan die een sterkere had gevonden. In deze drie onderzoeken was er in A en B geen zo'n fout.
- **Rondgangen:** ze oordelen niet, maar 65% van de bevindingen ligt op een pagina met een kandidaat uit een rondgang. Een gemiste kandidaat kan een gemiste bevinding zijn.
- **Beoordelaars A en B:** in A geen enkele bevinding in drie onderzoeken, in B wel 10. Een zwakkere beoordelaar kan "voldoet" zeggen waar "kan niet bepalen" of "voldoet niet" hoort. Op een echte site is dat niet te zien zonder sleutel; daarom ook de testsite.
- **Klasse C en de afmaakronde blijven op Opus.** Daar zitten alle wijzigingen van de verifieerder en 120 van de 130 bevindingen.

### Een keuze per criterium vraagt een wijziging

De instelling `models` van de werkstroom kiest één model per rol. Verifieerders A en B op Sonnet en verifieerders C op Opus kan daarmee niet. Daarvoor zijn twee wegen:

1. **Een keuze per criterium of per klasse** in de werkstroom. Dat vraagt een lijst van klassen, en die hangt af van de site.
2. **Het model van de verifieerder volgt het oordeel van de beoordelaar.** Dat werkt tijdens het onderzoek, op elke site: bijvoorbeeld Sonnet na "kan niet bepalen" (37 oordelen, 0 wijzigingen, ongeveer 6,5 dollar per onderzoek). Na "voldoet" is dat niet veilig: daar veranderde de verifieerder 2 keer de uitkomst, één keer naar "voldoet niet" met een bevinding die de beoordelaar had gemist.

Beide vragen een wijziging in de werkstroom, met een eigen voorstel.

## Meting

Elke meting draait op kopieën van de drie runs, gemaakt met `LOEP variant`, zoals onder "Hoe we meten" in [README.md](README.md). De veegronde blijft dus gelijk. Een meting gebruikt 15 criteria per site: 6 uit klasse C waar de verifieerder iets veranderde (1.3.1, 2.4.4, 2.4.6, 4.1.2, 4.1.3, 1.4.11), 3 uit B (2.1.2, 3.1.1, 3.3.1) en 6 uit A (1.2.4, 2.5.4, 2.4.1, 3.2.2, 3.2.6, 1.4.4). Daarin zitten 7 van de 12 wezenlijke wijzigingen van de verifieerder.

| Meting | Wat | Kosten | Nodig |
|---|---|---|---|
| M1 | Stand op Haiku | ongeveer 0 dollar | Loopt mee in elke kopie |
| M2 | Rondgangen en verifieerders op Sonnet, naast een kopie op Opus | ongeveer 390 dollar (224 voor Opus, 166 voor de variant) | |
| M3 | Beoordelaars van de 9 criteria uit A en B op Sonnet, de rest op Opus | ongeveer 110 dollar | De testsite komt er nog bij |
| M4 | Verifieerders van klasse C op Sonnet, bij de oordelen van de beoordelaars van Opus | ongeveer 55 dollar | Een optie van `LOEP variant` die de oordelen van de beoordelaars bewaart, zoals `--keep-judges`. Die bestaat nog niet |

Samen ongeveer 555 dollar, plus de testsite bij M3. Haalt alles de meting, dan is dat na ongeveer 13 onderzoeken terugverdiend. Halen alleen de rondgangen en de verifieerders A en B de meting, dan na ongeveer 25.

M4 meet of Sonnet ook bij de zware criteria de fouten vindt die Opus vond. Valt dat goed uit, dan kunnen ook de verifieerders C naar Sonnet (ongeveer 15 dollar per onderzoek). Dat staat niet in het voorstel.

### Wat telt als even goed of beter, zonder sleutel

Op een echte site is er geen sleutel. De maat is de kopie op Opus. Twee runs op Opus verschillen al, en de oorspronkelijke run is de tweede run op Opus. Een verschil telt daarom alleen als de oorspronkelijke run en de kopie op Opus het daar eens zijn.

Een rol gaat over als op alle drie de sites geldt:

1. **Dezelfde uitkomst per criterium:** voldoet (ook niet van toepassing), voldoet niet, of open. Een andere uitkomst mag alleen waar ook de twee runs op Opus verschillen.
2. **Geen bevinding kwijt** die beide runs op Opus hebben: hetzelfde gebrek op dezelfde plek. Dat zeggen twee agents zoals bij `compare --findings`, met de bevindingen van Opus als referentie in de vorm van `bestaand.json` (zie [validatie/README.md](../README.md)). Een bevinding die alleen de variant heeft, bekijkt een persoon: terecht, discutabel of onterecht.
3. **Niet meer "kan niet bepalen"** dan op Opus, tenzij een persoon de open punten terecht vindt.
4. **Dezelfde ernst**, of één stap verschil waar ook de runs op Opus verschillen.
5. **Bij de verifieerders:** dezelfde wezenlijke wijzigingen als Opus deed, en geen bevinding geschrapt die Opus liet staan, tenzij een persoon het schrappen terecht vindt.
6. **Beurten onder het omslagpunt:** minder dan 1,9 keer zoveel beurten bij de beoordelaars, minder dan 2 keer bij de andere rollen.

"Beter" is: meer bevindingen die een persoon terecht vindt, of minder onterechte. Dit is geen statistische toets zoals `compare-variants` op de testsite: het zijn één run per kant en 15 criteria per site. Daarom is de lat geen enkele verloren bevinding, en daarom komt bij M3 de testsite erbij.

## Hoe de cijfers zijn gemaakt

- **Geteld** uit de transcripts van Claude Code van de 416 agents van de werkstroom, elk bericht één keer: beurten, invoer, schrijven naar en lezen uit de cache, uitvoer, aanroepen per soort en mislukte aanroepen. De verkenner en de agents van de bewijspoort tellen niet mee, zoals in [README.md](README.md).
- **Berekend:** de kosten, met de prijzen van Opus 5.5 van 19 oktober 2026. Sonnet is de helft daarvan. Haiku is niet uitgerekend; de besparing van ongeveer 1 dollar komt uit [README.md](README.md).
- **Geteld uit de runs:** het oordeel van de beoordelaar (`oordeel.json`) naast het oordeel na de verifieerder, de kandidaten van de rondgangen en wat de beoordeling ervan maakte, en `allZero` uit het dossier.
- **Een regel, geen meting:** de klassen A, B en C. De regel staat hierboven en is op de drie onderzoeken samen toegepast.
- **Geschat:** de echte uitvoer (zie "De uitvoer is te laag geteld"), de besparing met Sonnet bij hetzelfde aantal beurten, het omslagpunt in beurten, en de kosten van de meting. Die laatste zijn de getelde kosten van dezelfde agents, maal 1,16 voor de te laag getelde uitvoer.

## Kanttekeningen

- Drie sites, één run per site. De klassen en de wijzigingen van de verifieerder zeggen iets over deze drie sites.
- Elk onderzoek had een andere steekproef en een eigen veegronde. De verschillen tussen de onderzoeken komen dus ook van de site.
- De besparing met Sonnet neemt aan dat Sonnet per beurt evenveel context gebruikt. Het aantal beurten van Sonnet is niet gemeten.
- De afmaakronde zit bijna alleen in onderzoek 2.
- Hoe goed een oordeel is, weten we hier alleen door oordelen naast elkaar te leggen. In deze analyse is geen van de drie onderzoeken vergeleken met het oordeel van een menselijke deskundige.

## Gevraagd besluit

De stand-agent op Haiku is al besloten, in een eigen voorstel.

1. Budget voor de meting M2 tot en met M4: ongeveer 555 dollar, plus de testsite bij M3, en de optie van `LOEP variant` voor M4.
2. Welke regels na de meting gelden:
    1. De rondgangen en de verifieerders A en B gaan naar Sonnet als M2 aan de zes eisen hierboven voldoet.
    2. De beoordelaars A en B gaan alleen naar Sonnet als M3 dat doet, op de drie sites en op de testsite.
    3. Of de keuze van de verifieerder per klasse gaat, of volgens het oordeel van de beoordelaar. Allebei vragen een wijziging in de werkstroom.
    4. De beoordelaars C, de verifieerders C en de afmaakronde blijven op Opus, tenzij M4 iets anders laat zien.
