# Sonnet tegen Opus op de testsite, 21 oktober 2026

Kunnen de rondgangen, beoordelaars en verifieerders op Sonnet 5.5 in plaats van Opus 5.5, zonder dat het oordeel slechter wordt? Deze meting volgt "Hoe we meten" in [validatie/verbruik/README.md](../../verbruik/README.md), met één variant: elke rol op Sonnet, de stand op Haiku zoals aan beide kanten. Achtergrond en het voorstel per rol staan in `validatie/verbruik/modelkeuze.md` (#230).

## Opzet

- **Code:** `main` op commit `f63abea`, aan beide kanten.
- **Bewijs:** één veegronde op Lindewaard (de variant met gebreken), van `inventory` tot en met `gate`. De verkenner en de twee agents van de poort draaiden op Opus. Zonder inlog, dus zonder het deel onder `/mijn/`, en zonder VoiceOver.
- **Kopieën:** zes kopieën met `LOEP variant`, elk met `tasks --only` voor de negen criteria van stap 4. Drie kopieën op Opus (de nulmeting) en drie op Sonnet, alle zes tegelijk, met twee agents tegelijk per kopie.
- **Indeling:** per kopie twee agents op Opus met `compare --findings`. Voor hen heetten de kopieën k1 tot en met k6, zodat de naam van het model niet in hun opdracht stond.
- **Marge:** vastgelegd na de spreiding van de nulmeting en vóór `compare-variants` met `--variant`. Het is de standaard: 0,05 voor gevonden gebreken en 1 voor onterechte meldingen per run. De zorg in de README, dat een even goede variant 0,05 maar 4 van de 10 keer haalt, ging uit van een vijfde van de gebreken die tussen runs wisselt. In de nulmeting wisselde 1 van 29. Een kanttekening: de samenvattingen van de indelers, per geblindeerde kopie en over alle 79 gebreken, waren al zichtbaar, en wie de marge vastlegde wist welke kopie bij welk model hoorde.

## Uitkomst

**Niet slechter: nee**, op de eerste toets: de ondergrens van het verschil in gevonden gebreken ligt net onder de marge. De tweede toets haalt de marge. [varianten.md](varianten.md) is de uitvoer van `compare-variants` uit loep 0.17.0 op dezelfde indelingen, met de tweede toets zoals die nu in `validatie/verbruik/README.md` staat: alleen wat beide indelers onterecht noemen. Met de toets van `f63abea`, die elke melding zonder gebrek uit de sleutel telde, viel ook de tweede toets net buiten de marge: 3,7 tegen 4,3 per run, verschil +0,7 (0,0 tot +1,7).

| | Opus (3 runs) | Sonnet (3 runs) | Verschil (95%-interval) | Marge |
|---|---|---|---|---|
| Gevonden gebreken uit de sleutel (29) | 98,9% | 97,7% | -1,1 (-6,9 tot +3,4) procentpunt | ondergrens boven -5 |
| Onterecht volgens beide indelers, per run | 0,0 | 0,0 | 0,0 (0,0 tot 0,0) | bovengrens onder 1 |
| Meldingen zonder gebrek uit de sleutel, per run (ter informatie) | 3,7 | 4,3 | +0,7 (0,0 tot +1,7) | geen |
| Open punten per run | 5,0 | 6,0 | +1,0 (-2,0 tot +3,7) | ter informatie |
| Uitkomst per criterium gelijk aan de sleutel | 9 van 9, in elke run | 9 van 9, in elke run | | |
| Beurten per run | 1.744 tot 1.837 | 1.224 tot 1.295 | ongeveer 30% minder | |
| Kosten per run, met de prijzen van de API | 60 tot 64 dollar | 22 tot 23 dollar | ongeveer 37% van Opus | |

Waar het verschil vandaan komt:

- **Eén gebrek.** `4.1.2-venster` (een productvenster zonder rol en naam, waar de focus niet heen gaat, met een kruisje dat een div is) vond Opus in 3 van 3 runs, Sonnet in 1 van 3. In de andere twee runs beschreef Sonnet twee van de drie kanten: de ene run noemde de focus niet, de andere de rol en de naam niet. De indelers gaven "deels" of waren het oneens. Elk ander gebrek vond Sonnet even vaak als Opus of vaker; `4.1.2-rol-logo` vond Opus in 2 van 3 runs en Sonnet in 3 van 3.
- **Meldingen zonder gebrek uit de sleutel:** 5, 2 en 4 bij Opus, 5, 4 en 4 bij Sonnet. Geen van de twaalf indelers noemde er één onterecht; de rest noemden ze terecht of discutabel.
- **Open punten:** bij Sonnet vaker "proef werkte niet" (4, 2 en 2 tegen 1, 1 en 2) en één keer "veegronde mist".

Op 29 gebreken weegt één gebrek in één run 3,4 procentpunt. De bootstrap trekt de gebreken opnieuw, en een trekking waarin het ene gebrek dat verschilt een paar keer voorkomt, geeft een groot verschil. Daarom ligt de ondergrens bij een verschil van -1,1 al voorbij -5.

## Wat dit zegt

- Op deze negen criteria en deze site kwam Sonnet tot dezelfde uitkomsten als Opus, met bijna dezelfde gevonden gebreken, voor ruim een derde van de kosten. Sonnet nam ook minder beurten, niet meer: de zorg uit `modelkeuze.md` dat Sonnet meer beurten nodig heeft en de besparing opeet, deed zich hier niet voor.
- Het ene verschil past bij wat de drie echte onderzoeken lieten zien: een samengesteld gebrek bij 4.1.2, een criterium uit klasse C, beschreef Sonnet minder volledig.
- De meting is te klein om "niet slechter" te bewijzen. Eén run per kopie, negen criteria en 29 gebreken geven brede intervallen.

## Naast de meting op 0.11.0

De meting op 0.11.0 (#184, [2026-10-20-meting-0.11.0](../2026-10-20-meting-0.11.0/uitkomst.md)) had een variant S: rondgangen en verifieerders op Sonnet, beoordelaars op Opus, op dezelfde negen criteria en een eigen bevroren veegronde van Lindewaard. Deze meting zet ook de beoordelaars op Sonnet.

| | S op 0.11.0 (3 runs) | Alles op Sonnet, deze meting (3 runs) |
|---|---|---|
| Gevonden gebreken per run (29) | 97,7% | 97,7% |
| Verschil met de eigen nulmeting | -0,6 (-5,2 tot +4,0) procentpunt | -1,1 (-6,9 tot +3,4) procentpunt |
| Onterecht volgens beide indelers | 0 | 0 |
| Goedkoper dan de eigen nulmeting | 34% | ongeveer 63% |

- Op deze site maakt een beoordelaar op Sonnet het niet merkbaar slechter dan S: beide vinden gemiddeld 97,7%. Het verschil met de nulmeting is hier groter omdat deze nulmeting 98,9% vond.
- Waar het misging, verschilt. Bij S kwamen twee keer gebreken niet of deels in het oordeel doordat een rondgang op Sonnet een kandidaat niet doorgaf. Hier beschreef de beoordelaar op Sonnet een samengesteld gebrek bij 4.1.2 maar half.
- Bij S nam de beoordelaar op Opus meer beurten na een rondgang op Sonnet. Met alles op Sonnet nam het geheel ongeveer 30% minder beurten.
- De nulmeting kostte daar ongeveer 89 dollar per run, hier 60 tot 64, voor hetzelfde soort werk (rondgangen, stand en de negen criteria). Waar dat verschil vandaan komt, is niet uitgezocht.
- Het besluit na S, rondgangen en verifieerders niet samen naar Sonnet, verandert hierdoor niet: ook deze meting toont "niet slechter" niet aan.

## Wat deze meting niet zegt

- De testsite is klein en haar gebreken zijn duidelijk. Op een echte site met veel bevindingen per criterium kan het verschil groter zijn.
- Zonder VoiceOver, zonder het deel achter de inlog, en zonder de schone variant (Berkenveen). Hoeveel meldingen Sonnet doet waar geen gebrek is, zegt alleen die variant.
- De kosten zijn een ondergrens: de uitvoer is in de transcripts van een subagent te laag geteld, aan beide kanten.

## Vervolg

Er volgt geen vervolgmeting; deze meting is ter informatie. Wie het later wel wil weten, heeft twee dingen nodig die hier ontbraken: de schone variant (Berkenveen), voor meldingen waar geen gebrek is, en meer criteria per run, zodat de intervallen smal genoeg worden om "niet slechter" aan te tonen.
