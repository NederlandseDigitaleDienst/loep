# axe-core 4.13 naast 4.14 op de testsite, 14 oktober 2026

Een nieuwe versie van een regel-engine kan uitkomsten veranderen zonder dat een test faalt. Daarom staat in `.github/dependabot.yml` dat zo'n update pas komt na een meting op de testsite. Dit is die meting, zonder taalmodel: axe-core 4.13.0 en 4.14.0 draaien naast elkaar op elke pagina van beide sites, zoals de toolbox axe-core draait (de tags `wcag2a` tot en met `wcag22aa`, licht en donker, 1280 bij 800 pixels). Daarna is per regel en per element vergeleken wat elke versie zei.

De code is die van `main` op commit `b959b93`. Het script staat ernaast: [vergelijk.ts](vergelijk.ts).

## Uitkomst

48 pagina's met status 200, op Lindewaard (met gebreken) en Berkenveen (zonder gebreken), elk in licht en donker.

| | 4.13.0 | 4.14.0 |
|---|---|---|
| failed | 238 | 278 |
| cantTell | 86 | 86 |
| passed | 8634 | 8632 |

Er veranderen twee dingen, allebei op Lindewaard:

| Regel | Wat verandert | Waar | Oordeel |
|---|---|---|---|
| `label-content-name-mismatch` (2.5.3) | van niet uitgevoerd naar `failed`, 40 keer | de knop "Zoeken" met de naam "Opdracht versturen", op elke pagina, licht en donker | terecht: dit is het ingebouwde gebrek `2.5.3-zoekknop`. De regel staat sinds 4.14 standaard aan |
| `avoid-inline-spacing` (1.4.12) | van `passed` naar niet van toepassing, 2 keer | de schuifknop op `/producten.html` | terecht: dat element heeft een `style`-attribuut zonder tekst, en 4.14 toetst alleen nog tekst die de afstand van het element krijgt |

Op Berkenveen verandert niets. axe-core 4.14 vindt daar geen enkele nieuwe fout.

## Wat dit zegt

- 4.14 vindt één ingebouwd gebrek dat 4.13 niet zag, en meldt niets ten onrechte.
- De andere wijzigingen uit de release-notes (onder andere `target-size`, `color-contrast`, `scrollable-region-focusable` en `aria-required-children`) veranderen op deze testsite geen enkele uitkomst.
- De procedure voor 2.5.3 zei dat axe-core `label-content-name-mismatch` niet altijd uitvoert. Dat is bijgewerkt.

## Wat deze meting niet zegt

Alleen de begintoestand van elke pagina is gemeten, niet de toestanden uit een sitemodel en niet het deel achter de inlog. Alfa, IBM en QualWeb zijn niet meegenomen: die veranderen niet in deze update. Er is geen beoordeling door agents gedaan. Een uitkomst van axe-core is in loep bewijs en geen oordeel, dus wat een agent ermee doet is niet gemeten.
