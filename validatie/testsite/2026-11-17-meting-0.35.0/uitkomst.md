# Meting op loep 0.35.0, 17 en 18 november 2026

Issue #642. Twee volledige runs van de kandidaat voor 0.35.0 op de testsite Lindewaard, de variant met 79 ingebouwde gebreken, en één op de schone tweeling Berkenveen. Aanleiding: sinds 0.29.0 zijn de inventaris, de veegronde, de recepten, de documenten en de proef met aanwijzen veranderd (#612, #616, #617, #620, #623, #624, #625 en #628), en de procedures wegen die nieuwe metingen mee (#636). Opzet, stopregel en marge zijn gelijk aan die van [0.29.0](../2026-11-14-meting-0.29.0/uitkomst.md).

De lat werd eerst niet gehaald. Op de schone tweeling keurde B1 1.3.1 af op een kop boven een lege lijst, en beide vergelijkers noemden dat onterecht. Daarna is regel R9 van 1.3.1 aangepast en is alleen 1.3.1 opnieuw gemeten, op beide varianten. Wat dat wel en niet zegt, staat onder [De herhaling van 1.3.1](#de-herhaling-van-131).

## Opzet

- **Kandidaat.** Branch `meting/0.35.0`, commit `81390b3`: main op `f7fc755` met de twee commits van #643. De versie in de code heet nog 0.34.0; die gaat pas bij de release omhoog.
- **Bevroren veegronde, per variant één.** Dezelfde 13 pagina's en hetzelfde vaste sitemodel als bij 0.29.0, op vaste poorten, versturen toegestaan tot 30 keer, VoiceOver uit. De poort gaf op beide varianten "bewijs voldoende". Op Lindewaard waren daar twee rondes van de verkenner voor nodig; de tweede gaf het aftellen op de contactpagina een recept als bewegende inhoud. Op Berkenveen was één ronde genoeg.
- **Runs.** L1 en L2 op Lindewaard, B1 op Berkenveen, alle 56 criteria, zes agents tegelijk, elk op een kopie van de veegronde, één run tegelijk.
- **Vergelijking.** Per run `compare --findings` met twee vergelijkers (A en B), tegen `reference-lindewaard.json` of `reference-berkenveen.json`. Over L1 en L2 `compare-variants` voor de spreiding.
- **Stopregel.** Een derde run op Lindewaard als L1 en L2 bij meer dan twee criteria een andere uitkomst hadden.
- **Marge.** Gemiddeld niet minder dan 77 van de 79 gebreken gevonden. Per run ten hoogste 12 meldingen zonder tegenhanger. Geen criterium open door een grens van loep, behalve 1.2.3 en 1.2.5 op de tweeling (#505), en 2.2.1, 3.3.4 en 3.3.8, die kennis van de eigenaar of een testaccount vragen. Op de tweeling geen bevinding die beide vergelijkers onterecht noemen.

## Uitkomst

Op Lindewaard haalt de kandidaat de marge op elk punt. Een derde run was niet nodig: L1 en L2 gaven bij alle 56 criteria dezelfde uitkomst. Op de tweeling haalde B1 de marge niet, door één afkeuring van 1.3.1; na de aanpassing van R9 wel.

| | L1 | L2 | B1 |
|---|---|---|---|
| Duur van de werkstroom | 76 minuten | 81 minuten | 90 minuten |
| Voldoet niet, voldoet, n.v.t., open | 51, 3, 2, 0 | 51, 3, 2, 0 | 4, 44, 5, 3 |
| Na de herhaling van 1.3.1 | gelijk | gelijk | 3, 45, 5, 3 |
| Criteria zoals de sleutel | 56 van 56 | 56 van 56 | 49 van 56, na de herhaling 50 |
| Gebreken uit de sleutel gevonden (van 79) | 79 | 79 | n.v.t. |
| Bevindingen, en gebreken na samenvoegen | 116, 82 | 114, 81 | 4, 4 |
| Bevindingen zonder tegenhanger | 9 | 7 | 4 |
| Onterecht volgens beide vergelijkers | 0 | 0 | 1, na de herhaling 0 |
| Verstuurd, met de veegronde (van 30) | 17 | 14 | 24 |
| Tokens volgens de werkstroom | 15,9 miljoen | 15,8 miljoen | 17,1 miljoen |

"Voldoet" telt 4.1.1 mee, dat in WCAG 2.2 is vervallen. "Gevonden" telt alleen waar A en B het eens zijn; over de 79 gebreken waren ze het in beide runs over elk gebrek eens, en over de eigen bevindingen ook.

**Tegen 0.29.0:** op Lindewaard dezelfde uitkomst bij alle 56 criteria en in beide runs weer alle 79 gebreken. Nieuw is een bevinding onder 4.1.3, de foutmelding "Ongeldige invoer." zonder live-regio, die A en B in beide runs terecht noemen. Meldingen zonder tegenhanger 9 en 7, tegen 8 en 8. Op de tweeling bleven 3 criteria open in plaats van 5: 2.2.1 en 1.2.5 zijn nu vastgesteld. De runs duurden ongeveer even lang en kostten iets minder tokens.

**Spreiding** ([spreiding-56](spreiding-56/varianten.md)): 56 van 56 criteria en 79 van 79 gebreken met dezelfde uitkomst in L1 en L2. Met bijna alleen "voldoet niet" zegt dat weinig.

### Meldingen zonder tegenhanger op Lindewaard

Volgens A en B samen terecht, in beide runs: Straat en huisnummer en Postcode voor de rekening zonder autocomplete (1.3.5, twee keer), en de foutmelding "Ongeldige invoer." op de contactpagina die niet wordt voorgelezen (4.1.3). Alleen in L1: de uitleg bij de openingstijden die als afbeelding is gemarkeerd, zodat de tekst erin verborgen is (1.3.1), en die uitleg die op 320 pixels buiten het scherm loopt (1.4.10). Discutabel, in beide runs: de muziek op de startpagina onder 1.2.1, de titel van de cookiemelding die geen kop is en de kaarten die niet in een lijst staan (1.3.1), en de aftelklok onder 2.2.2. Geen enkele is volgens beide onterecht.

### De schone tweeling

Volgens de sleutel hoort geen enkel criterium te worden afgekeurd. B1 keurde er vier af:

- **1.3.1.** De kop Zoekresultaten staat bij een zoekopdracht zonder resultaat boven een lege lijst. A en B noemen het onterecht: scherm en code zeggen hetzelfde, en er gaat geen verband verloren.
- **2.4.3.** Met de chat open gaat Tab alleen rond in de chat. A en B noemen het discutabel, net als bij 0.25.0 en 0.29.0: de chat sluit met een knop en met Escape.
- **2.5.8.** Na Weigeren in de cookiemelding ligt de skiplink met focus over het logo. Discutabel volgens beide: het duurt zolang de skiplink de focus heeft, en de skiplink zelf is groot genoeg.
- **3.3.1.** Versturen met een leeg chatveld doet niets en meldt niets. Discutabel volgens beide: het veld is niet verplicht, en een leeg bericht negeren is gewoon gedrag.

Drie criteria bleven open:

- 1.2.3: van de video in de externe speler is geen bestand op te halen. Dat is de grens van loep uit #505, die de marge toestaat.
- 3.3.4 en 3.3.8: die liggen achter de inlog, en de meting had geen testaccount.

### De herhaling van 1.3.1

De afkeuring van 1.3.1 kwam uit regel R9: een kop zonder inhoud tot de volgende kop is een fout. R9 had al een uitzondering voor de titel van één resultaat in een reeks, maar niet voor een kop boven een lijst die in deze toestand leeg is. De regel zegt nu dat zo'n kop geen fout is als het gebied in een andere toestand aantoonbaar gevuld wordt: de beoordelaar zag het gevuld, of de pagina meldt zelf dat er nu niets is. Een gebied dat in geen enkele toestand gevuld was, valt er niet onder. Die tweede helft kwam van een reviewer, die de eerste versie te ruim vond: een beoordelaar kon een gevulde toestand veronderstellen bij een kop boven een blok dat altijd leeg is.

Daarna is 1.3.1 alleen opnieuw gemeten, met nieuwe rondgangen, één beoordelaar en één verifieerder, op een verse kopie van elke bevroren veegronde (commit `ebbaa5d`, met de tekst van R9 uit `e4ca8ff` in de opdrachten):

- **Berkenveen:** voldoet. De beoordelaar zag de lijst gevuld na een zoekopdracht met resultaat, en de melding met 0 resultaten zonder.
- **Lindewaard:** voldoet niet, met alle zes gebreken uit de sleutel onder 1.3.1 (vette tussenkop, opsomming als alinea, tussenkoppen in de uitklapper, tabelkoppen, titels in de voet, keuzegroep). Geen van die zes hangt van R9 af.

Elke herhaling duurde ongeveer 30 minuten en kostte ongeveer 2 miljoen tokens.

Dit is geen volledige meting meer. De regel is geschreven na het zien van de uitslag, en de herhaling op Berkenveen toetst hem op precies het geval waarvoor hij is geschreven; dat die nu slaagt, is te verwachten. De herhaling op Lindewaard laat zien dat de sleutel er niets door verliest, maar geen gebrek uit de sleutel is een kop zonder inhoud. Of de uitzondering op een echte site een lege kop laat doorgaan, is niet gemeten.

## Wat dit niet zegt

- Op de schone tweeling is één volledige run gedaan, dus de spreiding daar is niet gemeten.
- De testsite is makkelijker dan een echte site. 79 van 79 zegt dat loep de eigen sleutel haalt, niet hoe het een echte site beoordeelt.
- Er is niet vergeleken met het oordeel van een menselijke deskundige.
- VoiceOver stond uit. Een site met login en het doel `verantwoorden` zijn niet gemeten.
