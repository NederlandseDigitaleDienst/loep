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

## Herhaalbaarheid

Een poort in een pipeline mag niet op toeval falen. Op de testsite gaf `quick` twee keer achter elkaar dezelfde uitkomst, op zes pagina's: dezelfde 108 plekken en dezelfde uitkomst van reflow en zoom. De schone tweeling als basislijn en dezelfde tweeling opnieuw gaf exitcode 0, de variant met gebreken op dezelfde paden exitcode 1. Op een echte site, met inhoud die tussen twee metingen verandert, is dit nog niet gemeten.
