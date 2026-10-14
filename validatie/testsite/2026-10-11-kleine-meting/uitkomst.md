# Kleine meting op de schone variant, 11 oktober 2026

Zeventien criteria op de variant van de testsite zonder ingebouwde gebreken, gedraaid vanaf een bevroren kopie van de code (commit `ff80524`). Doel: nagaan of wat op 10 en 11 oktober is gebouwd doet wat het moet, zonder een volledige meting. Op een schone site hoort elk criterium uit te komen op "voldoet" of "niet van toepassing".

De criteria zijn gekozen om drie redenen: vijf over video en geluid (toen open, omdat niets luisterde of keek), zes die op een echte site open bleven zonder dat er een fout was gevonden, en zes waar de eerste meting op deze variant alleen een strenge lezing vond. 1.4.12 en 2.1.4 horen bij twee groepen.

## Uitkomst

| | Meting van 10 oktober (commit `005c04d`) | Deze meting |
|---|---|---|
| Voldoet | 3 | 10 |
| Voldoet niet | 8 | 3 |
| Kan niet bepalen | 6 | 4 |

Zes rondgangen minder dan een volledige meting (8 van de 15 paginatypen), 17 beoordelaars en 17 verifieerders: 46 agents, 5,2 miljoen tokens, 33 minuten, geen uitval. De verkenner had één ronde nodig en de poort zei in één keer "bewijs voldoende". Een eerste poging op dezelfde dag, met de code van die ochtend (commit `a121d3e`), ging drie keer terug naar de verkenner en stopte bij de poort zonder één beoordeling.

| Criterium | 10 oktober | Nu | Toelichting |
|---|---|---|---|
| 1.2.1 | kan niet bepalen | voldoet | het geluidsfragment is uitgeschreven en naast de tekst eronder gelegd |
| 1.2.2 | kan niet bepalen | kan niet bepalen | de video op de eigen site heeft ondertitels die volgen wat er wordt gezegd; de twee video's in de speler van een derde zijn niet te bereiken |
| 1.2.3, 1.2.5 | kan niet bepalen | kan niet bepalen | zelfde reden: de speler van een derde |
| 1.4.2 | voldoet | voldoet | |
| 1.4.3 | voldoet | voldoet | |
| 1.4.4 | voldoet niet | voldoet | de bedekking door de chatknop is hersteld in de testsite, en de procedure vraagt nu of een gebrek zonder vergroten al bestaat |
| 1.4.10 | voldoet niet | voldoet niet | twee nieuwe bevindingen, zie hieronder |
| 1.4.12 | voldoet niet | voldoet | |
| 2.1.4 | voldoet niet | voldoet niet | dezelfde bevinding: sneltoetsen in de speler van een derde |
| 2.4.2 | voldoet niet | voldoet | |
| 2.4.4 | voldoet niet | voldoet | |
| 2.5.2 | kan niet bepalen | voldoet | |
| 2.5.3 | kan niet bepalen | voldoet | |
| 2.5.8 | voldoet | voldoet | |
| 3.3.4 | voldoet niet | kan niet bepalen | de aanvraag voldoet; wat achter de inlog staat is niet onderzocht |
| 4.1.2 | voldoet niet | voldoet niet | een andere bevinding dan toen, zie hieronder |

## De vier bevindingen

Niet door een tweede beoordelaar tegen de bron gelegd; het oordeel hieronder is van wie de meting uitvoerde, op de tekst van de bevinding.

| Bevinding | Oordeel | Reden |
|---|---|---|
| 1.4.10 Bovenkant van het chatvenster valt buiten beeld in een venster van 320 bij 256 pixels | waarschijnlijk terecht | het venster staat vast en is hoger dan het beeld, dus de kop en de sluitknop zijn niet te bereiken; een rest in de schone variant |
| 1.4.10 Bovenkant van de cookiemelding valt buiten beeld in hetzelfde venster | waarschijnlijk terecht | zelfde oorzaak; de knoppen zijn wel te zien |
| 2.1.4 Speler van een derde heeft sneltoetsen van één letter | discutabel | hangt af van de lezing van "alleen actief bij focus op dat onderdeel" voor een samengesteld onderdeel; de strenge lezing is bewust aangehouden |
| 4.1.2 Afspeelknop wisselt van naam en meldt ook ingedrukt | waarschijnlijk terecht | "Pauzeren, ingedrukt" is tegenstrijdig; afgelezen uit beeld en bewaarde code, niet uit de toegankelijkheidsboom, want de instrumenten lezen niet binnen een ingesloten venster |

## Wat dit zegt

- De criteria die op een echte site open bleven zonder fout (1.4.3, 1.4.12, 2.5.2, 2.5.3, 2.5.8) komen hier alle vijf op "voldoet". De ruimere dekking van de veegronde en het ruimere budget van de verifieerder doen wat ze moeten.
- Van de zes strenge lezingen zijn er vier weg (1.4.4, 1.4.12, 2.4.2, 2.4.4). 3.3.4 is geen afkeuring meer. 4.1.2 heeft een andere, sterkere bevinding. 2.1.4 staat nog, bewust.
- Luisteren en kijken werkt voor media op de eigen site: 1.2.1 voldoet, en bij 1.2.2 is de eigen video goedgekeurd.
- De grootste rest is één ding: **de instrumenten bedienen en lezen niets binnen een ingesloten venster.** Drie open criteria en twee van de vier bevindingen hangen daaraan. De speler van een derde is niet te beluisteren, zijn knoppen zijn niet te meten en zijn toegankelijkheidsboom is niet te lezen.
- De schone variant heeft nog resten: het chatvenster en de cookiemelding passen niet in een venster van 320 bij 256 pixels, en de afspeelknop van de speler meldt twee toestanden tegelijk.

## Wat deze meting niet zegt

Eén run, op zeventien criteria en acht van de vijftien paginatypen. De testsite is door hetzelfde systeem gebouwd. Wat na de bevroren commit is gebouwd, zit er niet in: de formulierproef voor het gewone pad, het vastleggen van het klembord, de soorten open punten, de uitkomst "geen afwijking gevonden, niet volledig gemeten", de vierde trede van ernst en de meting van documenten. Of de toolbox de ingebouwde gebreken in video en geluid vindt, is in deze meting niet gevraagd: dat is alleen los geprobeerd bij het bouwen van het instrument.
