# Meting op loep 0.25.0, 10 november 2026

Issue #498. Twee volledige runs van de kandidaat voor 0.25.0 op de testsite Lindewaard, de variant met 79 ingebouwde gebreken, en één volledige run op de schone tweeling Berkenveen. De vorige meting van een hele versie was die van 0.11.0, op 20 en 21 oktober. De versies vanaf 0.17.0 zijn zonder meting met agents uitgebracht. Opzet, stopregel en marge stonden in #498 voordat een run startte.

## Opzet

- **Kandidaat.** Branch `meting/0.25.0`, commit `b2bc8d4`: main op `093d975` (na #495, #496 en #497), met #465 en #471 erin gemerged. Typecontrole en `just test-quick` (367 tests) slaagden.
- **Regressietoets zonder taalmodel.** `sweep-check` op beide varianten: alle 56 gebreken die een script kan zien, stonden in het dossier, en de tweeling kreeg geen bewijs.
- **Bevroren veegronde, per variant één.** Gemaakt met de kandidaat, op vaste poorten. Versturen was toegestaan, ten hoogste 30 keer. VoiceOver stond uit. Op beide varianten ging één ronde van de verkenner langs de tien gaten die de poort meldde, zoals onderdelen die het vaste sitemodel niet opende. Daarna was de poort groen, met twee beperkingen: het venster van de controle "bent u een mens?" wordt niet bediend, en het beeld van de externe videospeler is niet te meten.
- **Runs.** L1 en L2 op Lindewaard, B1 op Berkenveen, alle 56 criteria, zes agents tegelijk, elk op een kopie van de veegronde (`variant`). Afwijking van #498: B1 en L1 liepen tegelijk, niet na elkaar. L2 startte na L1.
- **Vergelijking.** Per run `compare --findings` met twee vergelijkers (A en B), tegen `reference-lindewaard.json` of `reference-berkenveen.json`. Over L1 en L2 `compare-variants` voor de spreiding.
- **Stopregel.** Een derde run op Lindewaard als L1 en L2 bij meer dan twee criteria een andere uitkomst hadden.
- **Marge.** Gevonden gebreken niet meer dan 5 procentpunt onder het gemiddelde van 0.11.0 (77,5 van 79). Per run niet meer dan één melding zonder tegenhanger boven de 12 van 0.11.0. Geen criterium open door een grens van loep. Op de tweeling geen bevinding die beide vergelijkers onterecht noemen.

## Uitkomst

De kandidaat haalt de marge op drie van de vier punten. Op de tweeling bleven drie criteria open door een grens van loep (zie hieronder, #505). Een derde run was niet nodig: L1 en L2 gaven bij alle 56 criteria dezelfde uitkomst.

| | L1 | L2 | B1 |
|---|---|---|---|
| Duur van de werkstroom | 81 minuten | 81 minuten | 91 minuten |
| Agents, uitval, afmaakronde | 129, 0, geen | 129, 0, geen | 131, 0, één |
| Voldoet niet, voldoet, n.v.t., open | 51, 3, 2, 0 | 51, 3, 2, 0 | 3, 41, 6, 6 |
| Criteria zoals de sleutel | 56 van 56 | 56 van 56 | 47 van 56 |
| Gebreken uit de sleutel gevonden (van 79) | 79 | 79 | n.v.t. |
| Bevindingen, en gebreken na samenvoegen | 111, 84 | 117, 80 | 3, 3 |
| Bevindingen zonder tegenhanger | 6 | 11 | 3 |
| Onterecht volgens beide vergelijkers | 0 | 0 | 0 |
| Verstuurd, met de veegronde (van 30) | 15 | 19 | 20 |
| Tokens volgens de werkstroom | 16,0 miljoen | 16,0 miljoen | 17,5 miljoen |

"Voldoet" telt 4.1.1 mee, dat in WCAG 2.2 is vervallen. "Gevonden" telt alleen waar A en B het eens zijn; over de 79 gebreken waren ze het in beide runs over elk gebrek eens.

**Tegen 0.11.0** ([meting van 20 en 21 oktober](../2026-10-20-meting-0.11.0/uitkomst.md)): gevonden gebreken van 77 en 78 naar 79 en 79. 1.4.12 is nu in beide runs afgekeurd; 0.11.0 keurde het twee keer goed. Sinds 0.11.0 meet 1.4.12 of er tekst verdwijnt (#271), en de testsite is op dat punt niet veranderd. Meldingen zonder tegenhanger van 11 en 13 naar 6 en 11. De duur ging van 2 uur 22 en 2 uur 50 naar 81 minuten, de tokens van 18,6 naar 16,0 miljoen per run.

**Spreiding** ([spreiding-56](spreiding-56/varianten.md)): 56 van 56 criteria en 79 van 79 gebreken met dezelfde uitkomst in L1 en L2. Fleiss' kappa is 1,00. Met bijna alleen "voldoet niet" zegt dat weinig.

### Meldingen zonder tegenhanger op Lindewaard

Volgens A en B samen terecht: autocomplete op de factuurvelden in stap 2 van de vergunning (1.3.5), de prijsschuif zonder rol of waarde (4.1.2), de foutmelding bij de datum zonder live-regio (4.1.3), de uitleg over feestdagen in een `span` met `role="img"` (1.3.1, alleen L2), en Ja en Nee op P11 die niet op Enter reageren (2.1.1, alleen L2). Discutabel: de aftelklok onder 2.2.2, die bij de tijdslimiet van 2.2.1 hoort, en in L2 drie strenge lezingen onder 1.3.1 en 1.2.1. Geen enkele is volgens beide onterecht.

Een deel van de terechte meldingen zijn gebreken die de testsite niet bedoelde, maar die er wel zitten. Ze komen niet in de sleutel zolang ze niet zijn nagegaan.

### De schone tweeling

Volgens de sleutel hoort geen enkel criterium te worden afgekeurd. B1 keurde er drie af:

- **1.4.10.** In WebKit is de pagina op 320 pixels 337 pixels breed, en de knop Zoeken valt deels buiten beeld. A en B noemen het terecht. Het is een fout in de testsite zelf, die ook op Lindewaard zit (L1 en L2, buiten de sleutel): #499.
- **2.4.3.** Met de chat open gaat Tab alleen rond in de chat. A en B noemen het discutabel, want de chat sluit met een knop en met Escape.
- **4.1.2.** `<audio>` en `<video>` hebben geen eigen naam. A en B noemen het discutabel, want de knoppen van de speler in de browser hebben wel een naam.

Zes criteria bleven open:

- 1.2.1, 1.2.3 en 1.2.5: loep kon de video in de externe speler niet bekijken. Een auditor zet de video aan; loep leest alleen een bestand, en de speler levert er geen. Dit is een grens van loep, en daarmee is de marge op dit punt niet gehaald. Bij het eerste verslag telde het ten onrechte als "open voor een mens". Daarbij komt dat de speler op de testsite geen video bevat, zodat de goede uitkomst niet vastligt (#505).
- 2.2.1: of de server een chatgesprek na een tijd sluit, weet alleen de gemeente of de leverancier. Dat moet een auditor ook vragen.
- 3.3.4 en 3.3.8: die liggen achter de inlog, en de meting had geen testaccount. Dat was een keuze van de opzet.

Op Lindewaard deden deze punten niet mee, want daar keurde een ander gebrek die criteria al af.

## Wat dit niet zegt

- De testsite is makkelijker dan een echte site. 79 van 79 zegt dat loep de eigen sleutel haalt, niet hoe het een echte site beoordeelt.
- Er is niet vergeleken met het oordeel van een menselijke deskundige.
- Op de schone tweeling is één run gedaan, dus de spreiding daar is niet gemeten.
- Twee afkeuringen op de tweeling (2.4.3 en 4.1.2) zijn volgens beide vergelijkers discutabel. Dat valt binnen de marge, maar een onderzoeker zou ze waarschijnlijk niet afkeuren.
- VoiceOver stond uit. Een site met login en het doel `verantwoorden` zijn niet gemeten.
