# Regelregister: wat er per regel van een regelset bekend is

Soort: meting. Per datum een map met `register.json` (alle regels) en `register.md` (wat opvalt). Niets in een onderzoek leest het register; het is de eerste stap van [#588](https://github.com/NederlandseDigitaleDienst/loep/issues/588).

loep legt vier regelsets naast elkaar en behandelt elke regel gelijk. Dat klopt niet met wat er te zien is: op een schone testsite keurt één regelset ruim 400 links af die de andere drie niet afkeuren, en `quick` moest daarom eisen dat twee regelsets het eens zijn ([../snelle-meting/README.md](../snelle-meting/README.md)). Het register legt per regel vast wat er over te weten is.

## Maken

```
just calibrate
just rule-register --sheets <map met meetbladen>
```

Alleen het meetblad van een onderzoek telt; een snelle meting heeft geen oordeel om een regel tegen te houden. Elke run telt één keer.

De ijkmeting schrijft `regels.json`: elke regel die een regelset draaide, met de criteria en ACT-regels die de regelset er zelf bij noemt. De meetbladen komen uit `contribute` of uit de besloten verzameling waar onderzoeken worden ingestuurd ([../../docs/methode.md](../../docs/methode.md#het-meetblad-en-het-regelregister)). Met `--runs <bestand>` leest het mappen van onderzoeken op de eigen machine, elk zoals het meetblad ervan zou zijn. Een register uit meetbladen en een uit de onderzoeken zelf zijn gelijk; dat is nagegaan op de onderzoeken hieronder. Het is het een of het ander: dezelfde site op beide manieren zou twee keer tellen.

## Wat er in een record staat

| Deel | Bron | Wat het zegt |
|---|---|---|
| De regel zelf | de regelset | De criteria, de ACT-regels erachter, en het soort: ACT-regel, techniekregel of overig |
| IJkmeting | de testgevallen van de ACT-regels | Gevonden, gemist, onterecht gemeld en twijfel, op de gevallen van de ACT-regels die de regel uitvoert |
| Uitspraken | meetbladen | Op hoeveel sites een beoordelaar de regel bevestigde (het werd een bevinding) of verwierp (niets aan de hand) |
| Sessies | meetbladen | Hoe het criterium eindigde in het onderzoek waarin de regel afkeurde, naast hoe vaak dat criterium over alle sites is afgekeurd |

Alles uit het veld telt per site. Een site met zeven onderzoeken telt één keer.

## De eerste meting, 15 november 2026

De ijkmeting van die dag, en de meetbladen van 29 afgeronde onderzoeken van 13 sites van Nederlandse overheden, gemaakt met loep 0.0.1 tot en met 0.30.0, uit de besloten verzameling. De sites staan niet in deze repository.

**Er zijn 376 regels**: 89 van Alfa, 65 van axe-core, 121 van IBM en 101 van QualWeb. Van QualWeb zijn 34 techniekregels (`QW-WCAG-T`), zonder ACT-regel erachter.

**De ijkmeting dekt de helft.** 186 regels hebben testgevallen. Daarvan vonden er 115 elk gebrek zonder iets onterecht te melden, en 25 meldden iets onterecht. Over techniekregels en over een regel zonder ACT-regel zegt de ijkmeting niets.

**De ijkmeting is herhaalbaar.** Alfa, IBM en QualWeb gaven op 15 november precies de getallen van 13 oktober. axe-core ging van 4.13.0 naar 4.14.0: 723 beoordeelde gevallen tegen 687, 178 gevonden tegen 162, en 6 onterechte meldingen tegen 10.

**Uitspraken van beoordelaars zijn er weinig.** Een beoordelaar legt pas sinds loep 0.18 per regel een uitspraak vast. Dat geeft 13 onderzoeken, 90 uitspraken en 33 regels, alleen van axe-core en Alfa, de twee regelsets van de veegronde. Zeven van die regels hebben een uitspraak op drie of meer sites.

- 21 regels zijn op elke site bevestigd waar een beoordelaar zich erover uitsprak.
- 8 regels zijn alleen verworpen. Zes daarvan op één site.
- `sia-r84` van Alfa is op alle drie de sites verworpen, `sia-r17` op beide.

**Uit de sessies komt iets voor alle vier.** In 20 onderzoeken draaide een agent de regelsets in een sessie: 94 regels, 102 paren van regel en criterium.

| Soort regel | Keren dat een regel afkeurde op een site | Criterium daar afgekeurd | Criterium daar goedgekeurd |
|---|---|---|---|
| ACT-regel | 158 | 135 | 19 |
| Techniekregel | 63 | 40 | 18 |
| Overig | 23 | 21 | 2 |

Een techniekregel keurt dus ruim twee keer zo vaak af waar het onderzoek het criterium goedkeurt. `QW-WCAG-T24` keurde op vier sites af onder 2.1.1; het onderzoek keurde 2.1.1 daar op geen enkele af.

**Hoe vaak een regelset alleen staat.** Een meetblad legt bij elk element dat een regel in een sessie afkeurde vast hoe de andere regelsets erover dachten. Een element van een pagina telt één keer per regel, hoe vaak een agent er ook naar vroeg, en alleen een regel die afkeurde telt, niet een die twijfelde. Over de 29 onderzoeken:

| Regelset | Afgekeurde elementen | Een andere regelset keurde het ook af | Alleen: de andere zeiden niets | Een andere keurde het goed |
|---|---|---|---|---|
| axe-core | 97 | 72 | 2 | 23 |
| IBM | 229 | 73 | 70 | 86 |
| Alfa | 863 | 85 | 589 | 189 |
| QualWeb | 6587 | 104 | 4325 | 2158 |

axe-core staat bijna nooit alleen. QualWeb staat bij twee derde van wat het afkeurt alleen, en deelt minder dan twee procent met een andere regelset. De aantallen hangen af van welke pagina's de agents bekeken; de verhoudingen zeggen meer dan de getallen. Het register leest deze telling nog niet; ze staat op de meetbladen.

**Waar de drie bronnen hetzelfde zeggen.** Voor `sia-r84` wijzen ze één kant op: op de testgevallen vond de regel de twee gebreken en meldde ze er twee onterecht, beoordelaars verwierpen haar op drie van de drie sites, en in de sessies keurde het onderzoek het criterium goed op alle drie de sites waar ze afkeurde, terwijl dat criterium op 4 van de 13 sites is afgekeurd. Dat is de regel die op een echte site 500 plekken alleen afkeurde.

**Twee regels van IBM** keurden op een site af en gaven op geen enkel testgeval een uitkomst. Ze staan in het register met alleen een record uit het veld.

## Wat dit niet zegt

- **Het veld is het oordeel van loep zelf.** "Bevestigd" betekent dat een agent van loep het met de regelset eens was, en die agent zag wat de regelset meldde. De oordelen van loep zijn niet tegen deskundigen gelegd ([../../PLAN.md](../../PLAN.md)). Het veld is goed om regels te rangschikken en bewijst niets.
- **De getallen zijn klein.** Zesentwintig van de 33 regels met een uitspraak rusten op minder dan drie sites. Een regel met een paar gevallen is onbekend, niet goed of slecht.
- **Dertien sites, waarvan een deel dezelfde huisstijl of leverancier heeft.** Een regel die het daar goed doet, kan op een andere soort site anders uitvallen. Eén getal per regel verbergt dat.
- **De sessies zijn grof.** Dat een criterium is afgekeurd waar een regel afkeurde, zegt niet dat het om die regel ging: 1.3.1 is op alle 13 sites afgekeurd. Daarom staat het aantal over alle sites ernaast. Alleen "de regel keurde af en het criterium slaagde" zegt iets over de regel.
- **De ijkmeting is aan de gunstige kant.** De makers van de regelsets stellen hun regels af op dezelfde testgevallen ([../ijkset/README.md](../ijkset/README.md)).
- **Herhaalbaarheid ontbreekt.** Of een meting twee keer hetzelfde geeft, staat nog niet in het register. Voor de eigen proeven van loep is dat het belangrijkste ([#586](https://github.com/NederlandseDigitaleDienst/loep/issues/586)).

## Wat volgt

Eerst verzamelen. Op 15 november 2026 is besloten het register nog nergens te gebruiken: met 13 sites rusten de meeste records op te weinig om een poort op te laten beslissen. Onderzoeken worden nu ingestuurd als meetblad ([../../docs/meetblad.md](../../docs/meetblad.md)), en het register wordt opnieuw gemaakt als de verzameling groeit.

Daarna: het register gebruiken waar geen beoordelaar tussen zit. In `quick` mag een regel met een goed record dan alleen tellen, en `just quick-key` zegt wat dat oplevert. Daarna, als gemeten variant op een bevroren veegronde, in een onderzoek. Een record mag kijken nooit vervangen.
