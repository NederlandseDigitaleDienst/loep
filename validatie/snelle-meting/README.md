# De snelle meting teruggerekend op afgeronde onderzoeken

Soort: meting, gedaan op 15 november 2026. Ze wordt herhaald als `quick` een signaal erbij krijgt.

De vraag: als `quick` een criterium aanwijst, keurt een volledig onderzoek het dan ook af, en hoeveel van de afkeuringen van een onderzoek wijst `quick` aan?

## Hoe

Een afgerond onderzoek bevat alles wat `quick` zou meten: de veegronde legt per pagina de uitkomsten van de regelsets vast, en of er bij 320 pixels breed en bij 200 procent zoom inhoud buiten beeld valt. Daaruit is per onderzoek en per criterium afgeleid of `quick` het had aangewezen. Dat is gelegd naast de einduitkomst van het onderzoek.

Gebruikt is de laatste run van elk van 12 sites van Nederlandse overheden, onderzocht tussen 10 oktober en 14 november 2026 met loep 0.0.1 tot en met 0.30.0. Samen 226 afgekeurde criteria. De runs en de namen van de sites staan niet in deze repository.

## Uitkomst

| Signalen | Aangewezen | Terecht | Van de 226 afkeuringen gevonden |
|---|---|---|---|
| Regelsets | 46 | 39 (85%) | 17% |
| Regelsets, reflow en zoom | 65 | 54 (83%) | 24% |

Per proef, over alle 28 runs van die 12 sites: reflow wees 1.4.10 26 keer aan, 21 keer terecht, en miste geen enkele afkeuring van 1.4.10. Zoom wees 1.4.4 17 keer aan, 12 keer terecht, en miste er 7.

Drie kwart van wat een onderzoek afkeurt, komt dus niet uit deze meting. Dat zijn vooral criteria waar iemand moet kijken of iets klopt: tekstalternatieven, koppen, linkteksten, zichtbare focus, statusmeldingen.

## Wat dit niet zegt

- De veegronde van deze onderzoeken draaide twee regelsets op elke pagina (axe-core en Alfa). `quick` draait er vier. Het echte cijfer kan dus iets hoger liggen; gemeten is dat niet.
- In een onderzoek zijn reflow en zoom gemeten nadat een cookiemelding was gesloten. `quick` sluit haar niet.
- Twaalf sites is weinig, en een deel deelt een huisstijl of een leverancier.
- De einduitkomst van een onderzoek van loep is zelf niet tegen deskundigen gevalideerd ([PLAN.md](../../PLAN.md)).

## De vaste lijst als meetlat

Sites vallen grotendeels op dezelfde criteria. Wie zonder te meten de criteria noemt die op 40 procent of meer van de andere sites zijn afgekeurd, heeft in 68 procent van de gevallen gelijk en vindt 81 procent van de afkeuringen. Dat is als voorspelling van een onderzoek beter dan elke meting zonder taalmodel die is geprobeerd, en het zegt niets over de site. Daarom staat zo'n lijst niet in de samenvatting van `quick`.

Het is wel de meetlat voor een nieuw signaal: het is de moeite waard als het voor een site iets zegt wat de vaste lijst niet zegt, zoals een plek of een criterium dat hier juist niet misgaat.

Geprobeerd en nog niet ingebouwd, met het aandeel terechte aanwijzingen op dezelfde 12 sites: een afwijkende koppenstructuur voor 1.3.1 en 2.4.6 (22 van 24), het contrast van bedieningselementen voor 1.4.11 (10 van 12) en een tekstalternatief in een andere taal voor 3.1.2 (8 van 11). Die cijfers zijn gekozen en getoetst op dezelfde sites en vallen op andere sites lager uit.

## Ingebouwde gebreken van de testsite

De terugrekening hierboven meet tegen een onderzoek. Voor een poort telt iets anders: maakt een release iets stuk, slaat de vergelijking dan aan? De testsite heeft een sleutel met 79 gebreken die met opzet zijn ingebouwd, en een schone tweeling met dezelfde paden. De schone tweeling is gemeten als basislijn, daarna de variant met gebreken ertegen, op 15 pagina's. `just quick-key <run>` telt per gebrek of de vergelijking zijn criterium als slechter meldt op een van zijn pagina's.

| | Regelsets, reflow en zoom | Met de proeven van loep erbij |
|---|---|---|
| Alle gebreken | 31 van 79 | 41 van 79 |
| Meetbaar met een instrument | 22 van 41 | 31 van 41 |
| Vraagt kijken | 6 van 18 | 6 van 18 |
| Vraagt een handeling | 3 van 20 | 4 van 20 |
| In de begintoestand van de pagina | 23 van 50 | 27 van 50 |
| Duur voor 15 pagina's | ongeveer 2 minuten | 3 tot 4,5 minuten |

De proeven die erbij kwamen: tekstafstand, de volgorde van de code tegenover het scherm, geluid dat vanzelf start, een wandeling met Tab, en dubbele paginatitels. Op de schone tweeling meldden ze samen één plek, op de variant met gebreken 159. Welk criterium bij welke proef hoort, is gekozen met deze sleutel ernaast. Op echte sites zijn deze proeven niet teruggerekend: de cijfers bovenaan dit bestand gaan alleen over de regelsets, reflow en zoom.

Nog 8 gebreken zijn alleen gemeld onder een ander criterium dat de sleutel bij het gebrek noemt. Vijf keer meldde de vergelijking iets slechter waar de sleutel geen gebrek heeft, voor en na de nieuwe proeven dezelfde vijf. De sleutel noemt alleen wat met opzet fout is gemaakt, dus dat hoeven geen valse meldingen te zijn; nagelopen zijn ze niet.

De telling is grover dan het gebrek: een ander gebrek onder hetzelfde criterium op dezelfde pagina telt ook. Van wat een instrument kan meten, mist de poort nog `autocomplete` (1.3.5), de rand van een veld (1.4.11), een bedieningselement dat Tab niet bereikt (2.1.1), sneltoetsen (2.1.4), een blok dat vanzelf wisselt (2.2.2) en de volgorde van het menu over pagina's (3.2.3). Wat een handeling vraagt, zoals een menu openen of een formulier invullen, ziet ze bijna niet.

Vergelijken per element in plaats van per telling ving, vóór de nieuwe proeven, één gebrek meer (31 tegen 30). De winst zit in een geval dat de tweeling niet heeft: één gebrek hersteld en een ander erbij op dezelfde pagina, onder dezelfde regel. Dat geval is door tests gedekt, niet op een site gemeten.

Op de schone tweeling keurde één regelset (QualWeb, twee regels over toetsenbord en focus) ruim 400 links af die de andere drie niet afkeuren. In de basislijn houdt dat niets tegen, maar het staat wel in de samenvatting onder "Eén meetprogramma".

## Herhaalbaarheid

Een poort in een pipeline mag niet op toeval falen.

**Op de testsite.** De variant met gebreken is twee keer gemeten op 15 pagina's, met alle proeven, en de tweede meting is tegen de eerste gehouden: geen plek erbij en geen plek minder, exitcode 0. De schone tweeling als basislijn en de variant met gebreken op dezelfde paden gaf exitcode 1.

**Op een echte site.** Tien pagina's van een documentatiesite van de overheid zijn op 15 november 2026 drie keer achter elkaar gemeten, de tweede en derde tegen de eerste. Elke meting duurde ongeveer zes minuten, een halve minuut per pagina, en alle tien pagina's werden gemeten. Beide vergelijkingen gaven exitcode 0. Over 2131 plekken en 1236 tellingen verschilde één melding: de proef voor tekstafstand zag op één pagina een menuknop wegvallen in de eerste en derde meting, en niet in de tweede. In deze volgorde was dat "beter" en hield het niets tegen. Andersom had het een release tegengehouden.

Daarom meet `quick` een pagina die slechter lijkt een tweede keer en telt het alleen wat beide metingen slechter vinden. Dat is na deze meting gebouwd en door tests gedekt; op de echte site is het niet opnieuw gemeten. Drie metingen op één site op één middag zeggen ook niets over een site waarvan de inhoud tussen twee releases verandert.

Wat de samenvatting van die site liet zien: geen enkel criterium waar twee regelsets het eens zijn. Alles onder "Eén meetprogramma" komt van QualWeb of Alfa, waaronder 262 plekken voor contrast. De proeven voor volgorde en tekstafstand melden op elke pagina hetzelfde onderdeel van de kop. Of dat gebreken zijn, is niet nagelopen.

## Wat de test bewaakt

`toolbox/test/quick-testsite.test.ts` draait `quick` in de volledige controle met een echte browser op drie pagina's van beide tweelingen. Elke proef moet het gebrek vinden dat ervoor is ingebouwd, de proeven moeten op de schone tweeling zwijgen, en er mag niets verstuurd zijn. De telling van 41 van de 79 zit daar niet in: die vraagt 15 pagina's van beide tweelingen en duurt acht minuten. Wie een proef wijzigt, draait `just quick-key` met de hand.
