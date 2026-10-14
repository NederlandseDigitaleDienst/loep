# Voorbeelden

Eén rapport dat de toolbox heeft gemaakt, zoals het uit de keten van nu komt: het onderzoek van 11 oktober 2026 naar nerds.digitaledienst.overheid.nl, de eigen site van de makers van de toolbox. Het is de derde meting op die site; wat ze laat zien en wat niet, staat in [validatie/iteraties.md](../validatie/iteraties.md).

Het rapport is een concept. Niemand heeft het afgetekend en het is niet gepubliceerd. Het team van de site heeft de bevindingen niet nagelopen, en ze zijn ook niet tegen de broncode van de site gelegd. Lees ze als aanwijzingen om na te gaan, niet als vaststaande feiten.

De toolbox heet nu loep. Toen dit rapport werd gemaakt, heette ze opendeur en begon een commando in een sessie met `tg`; die namen staan nog in het rapport.

| | |
|---|---|
| Site | nerds.digitaledienst.overheid.nl, 29 pagina's |
| Datum van het onderzoek | 11 oktober 2026 |
| Stand van de code | commit `ac91dd9`, een bevroren kopie zonder lokale wijzigingen; die commit is van vóór deze openbare repository en hier niet op te vragen |
| Kenmerk van de evaluatie | `50a291e12689` |
| Norm | WCAG 2.2 niveau A en AA, 55 criteria |
| Voldoet | 29 |
| Voldoet niet | 11 |
| Niet van toepassing | 10 |
| Geen afwijking gevonden, niet volledig gemeten | 3 |
| Kan niet bepalen | 2 |
| Bevindingen | 13, samen 12 gebreken |
| Voorlopige status | C, omdat er criteria open staan |

## Wat er staat

In `voorbeelden/nerds.digitaledienst.overheid.nl/`:

- [rapport.pdf](nerds.digitaledienst.overheid.nl/rapport.pdf): het volledige rapport, 85 pagina's. Begin bij de samenvatting en de werklijst.
- [rapport-kort.pdf](nerds.digitaledienst.overheid.nl/rapport-kort.pdf): hetzelfde rapport zonder de bijlage met alle waarnemingen, 43 pagina's.
- [rapport.md](nerds.digitaledienst.overheid.nl/rapport.md): het volledige rapport als Markdown.
- [verschil-met-vorige-meting.md](nerds.digitaledienst.overheid.nl/verschil-met-vorige-meting.md): wat er anders is dan in de meting van 10 oktober 2026 op dezelfde site, gemaakt met `diff`. Een werkdocument, geen onderdeel van het rapport. De vorige evaluatie zelf staat niet in deze map.
- [evaluation.json](nerds.digitaledienst.overheid.nl/evaluation.json): alle uitkomsten, waarnemingen en bevindingen, met de hashes van het bewijs.

Het bewijs zelf (schermafbeeldingen, metingen, dossiers en oordelen per ronde) staat in de run-map en is niet meegekopieerd. Er is geen conceptverklaring bij: `statement` is op deze keten nog niet gedraaid.

## Hoe je het leest

"Voldoet" betekent dat in het onderzochte bewijs geen afwijking is gevonden. "Geen afwijking gevonden, niet volledig gemeten" en "Kan niet bepalen" zijn allebei open en tellen niet mee als "Voldoet"; in het rapport staat per criterium wat er ontbreekt. Zolang er criteria open staan, kan dit onderzoek geen status A of B onderbouwen.

De cijfers hierboven komen uit één run. De spreiding tussen twee metingen op dezelfde inhoud is nog niet gemeten: de derde meting vond drie gebreken op plekken die de tweede ook had onderzocht. Wat de toolbox niet onderzoekt, staat onder de beperkingen in [docs/methode.md](../docs/methode.md).
