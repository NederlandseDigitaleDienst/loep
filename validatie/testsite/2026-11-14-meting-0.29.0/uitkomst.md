# Meting op loep 0.29.0, 14 november 2026

Issue #546. Twee volledige runs van de kandidaat voor 0.29.0 op de testsite Lindewaard, de variant met 79 ingebouwde gebreken, en één op de schone tweeling Berkenveen. Aanleiding: Playwright gaat van 1.63.0 naar 1.65.1, en daarmee meet loep in Chromium 159, Firefox 159 en WebKit 27.2. Alfa gaat van 0.119 naar 0.120. De code van loep zelf veranderde niet. Opzet, stopregel en marge stonden in #546 voordat een run startte, en zijn gelijk aan die van [0.25.0](../2026-11-10-meting-0.25.0/uitkomst.md).

## Opzet

- **Kandidaat.** Branch `meting/0.29.0`, commit `2e6f0a1`: main na #547 en #548. `just doctor` gaf pakketten en alle drie browsers aanwezig.
- **Regressietoets zonder taalmodel.** `sweep-check` op beide varianten, geslaagd in de merge queue van #547.
- **Bevroren veegronde, per variant één.** Dezelfde 13 pagina's en hetzelfde vaste sitemodel als bij 0.25.0, op vaste poorten, versturen toegestaan tot 30 keer, VoiceOver uit. De poort vond op elke variant 10 gaten, net als bij 0.25.0. Eén ronde van de verkenner per variant dichtte ze alle tien.
- **Runs.** L1 en L2 op Lindewaard, B1 op Berkenveen, alle 56 criteria, zes agents tegelijk, elk op een kopie van de veegronde. L1 en B1 liepen tegelijk, L2 startte na L1.
- **Vergelijking.** Per run `compare --findings` met twee vergelijkers (A en B), tegen `reference-lindewaard.json` of `reference-berkenveen.json`. Over L1 en L2 `compare-variants` voor de spreiding.
- **Stopregel.** Een derde run op Lindewaard als L1 en L2 bij meer dan twee criteria een andere uitkomst hadden.
- **Marge.** Gemiddeld niet minder dan 77 van de 79 gebreken gevonden. Per run ten hoogste 12 meldingen zonder tegenhanger. Geen criterium open door een grens van loep, behalve 1.2.1, 1.2.3 en 1.2.5 op de tweeling (#505). Op de tweeling geen bevinding die beide vergelijkers onterecht noemen.

## Afwijkingen van de opzet

- **De verkenner bediende meer.** Bij 0.25.0 bleven het controlevenster ("Ik ben geen robot") en de externe videospeler bewust onbediend. Dit keer gaven beide verkenners ze een recept. Dat is een keuze van de verkenner, niet van de code. Op de tweeling is 1.2.1 daardoor vermoedelijk niet meer open.
- **Een pauze.** L1 en B1 stopten na ruim 75 minuten op de weeklimiet van het abonnement, met 9 en 10 criteria nog niet geverifieerd. De werkstroom sloeg niets over en ging na de pauze verder waar hij stopte.

## Uitkomst

De kandidaat haalt de marge op elk punt. Een derde run was niet nodig: L1 en L2 gaven bij alle 56 criteria dezelfde uitkomst.

| | L1 | L2 | B1 |
|---|---|---|---|
| Duur van de werkstroom, zonder de pauze | 84 minuten | 74 minuten | 92 minuten |
| Voldoet niet, voldoet, n.v.t., open | 51, 3, 2, 0 | 51, 3, 2, 0 | 1, 46, 4, 5 |
| Criteria zoals de sleutel | 56 van 56 | 56 van 56 | 50 van 56 |
| Gebreken uit de sleutel gevonden (van 79) | 79 | 79 | n.v.t. |
| Bevindingen, en gebreken na samenvoegen | 112, 79 | 112, 75 | 1, 1 |
| Bevindingen zonder tegenhanger | 8 | 8 | 1 |
| Onterecht volgens beide vergelijkers | 0 | 0 | 0 |
| Verstuurd, met de veegronde (van 30) | 15 | 13 | 25 |
| Tokens volgens de werkstroom | 17,0 miljoen | 15,8 miljoen | 18,6 miljoen |

"Voldoet" telt 4.1.1 mee, dat in WCAG 2.2 is vervallen. "Gevonden" telt alleen waar A en B het eens zijn; over de 79 gebreken waren ze het in beide runs over elk gebrek eens.

**Tegen 0.25.0:** op Lindewaard dezelfde uitkomst bij alle 56 criteria en in beide runs weer alle 79 gebreken. Meldingen zonder tegenhanger 8 en 8, tegen 6 en 11. Op de tweeling één afkeuring in plaats van drie, en vijf criteria open in plaats van zes. L1 en B1 duurden iets langer en kostten iets meer tokens dan bij 0.25.0, deels door het hervatten na de pauze; L2, zonder pauze, was sneller.

**Spreiding** ([spreiding-56](spreiding-56/varianten.md)): 56 van 56 criteria en 79 van 79 gebreken met dezelfde uitkomst in L1 en L2. Fleiss' kappa is 1,00. Met bijna alleen "voldoet niet" zegt dat weinig.

### Meldingen zonder tegenhanger op Lindewaard

Volgens A en B samen terecht, in beide runs: Straat en huisnummer en Postcode voor de rekening zonder autocomplete (1.3.5, twee keer). Alleen in L1: de uitleg bij de openingstijden die verborgen is voor hulpsoftware (1.3.1), en Ja en Nee op P11 die niet op het toetsenbord reageren (2.1.1). Alleen in L2: de prijsschuif zonder rol, naam of waarde (4.1.2); in L1 waren A en B het daarover oneens. Discutabel, in beide runs: de muziek op de startpagina onder 1.2.1 en de aftelklok onder 2.2.2. In L2 ook de titel van de cookiemelding die geen kop is en de kaarten die niet in een lijst staan (1.3.1), en de foutmelding bij de datum zonder live-regio (4.1.3). Geen enkele is volgens beide onterecht.

### De schone tweeling

Volgens de sleutel hoort geen enkel criterium te worden afgekeurd. B1 keurde er één af:

- **2.4.3.** Met de chat open gaat Tab alleen rond in de chat. A en B noemen het discutabel, net als bij 0.25.0: de chat sluit met een knop en met Escape.

De afkeuring van 1.4.10 uit 0.25.0, een fout in de testsite zelf (#499), en die van 4.1.2 op `<audio>` en `<video>` kwamen niet terug.

Vijf criteria bleven open:

- 1.2.3 en 1.2.5: van de video in de externe speler is geen bestand op te halen. Dat is de grens van loep uit #505, die de marge toestaat. 1.2.1 is nu wel vastgesteld.
- 2.2.1: of de server een chatgesprek na een tijd sluit, weet alleen de gemeente of de leverancier.
- 3.3.4 en 3.3.8: die liggen achter de inlog, en de meting had geen testaccount.

## Wat dit niet zegt

- Op de schone tweeling is één run gedaan, dus de spreiding daar is niet gemeten.
- De testsite is makkelijker dan een echte site. 79 van 79 zegt dat loep de eigen sleutel haalt, niet hoe het een echte site beoordeelt.
- Er is niet vergeleken met het oordeel van een menselijke deskundige.
- VoiceOver stond uit. Een site met login en het doel `verantwoorden` zijn niet gemeten.
