# Iteraties

Logboek van elke beoordelingsronde: wat er draaide, wat eruit kwam, en wat we daarna hebben veranderd. Bedoeld om te kunnen nagaan hoe de methode tot stand is gekomen. De cijfers in dit bestand zijn ontwikkelcijfers en geen bewijs van betrouwbaarheid; daarvoor is de toetsset, zie de sectie "Wat de vergelijking met bestaande onderzoeken zei" hieronder.

## Ronde 1: digitaledienst.overheid.nl, 10 oktober 2026

- Toolbox op commit `796e80e`, procedures versie 1, 10 pagina's (hele site).
- 56 criteria, elk in drie rondes: 168 beoordelingen. Doorlooptijd 11 minuten, ongeveer 10,9 miljoen tokens.
- Beoordeling A en B kwamen bij alle 56 criteria op dezelfde uitkomst.
- De toetsronde veranderde 5 uitkomsten, alle vijf van "voldoet" of "niet van toepassing" naar "kan niet bepalen".
- Uitkomst (WCAG 2.2): 9 voldoet, 8 voldoet niet, 12 niet van toepassing, 26 kan niet bepalen. 11 bevindingen.

Wat de 26 open criteria gemeen hadden: het bewijs ontbrak, het oordeel was niet onzeker. De grootste gaten:

| Gat | Raakte | Wat we hebben gedaan |
|---|---|---|
| Een ingesloten chatvenster (iframe) is niet onderzocht | 14 criteria | Ingesloten vensters worden als eigen pagina onderzocht |
| Tab bereikt in een lijst alleen de eerste link; niet gemeten of pijltjestoetsen de rest bereiken | 2.1.1, 2.4.3, 3.2.1 | Vanaf elke Tab-stop worden de pijltjestoetsen ingedrukt |
| Regel-engines konden het contrast van 94 stukken tekst niet bepalen | 1.4.3 | Contrast wordt gemeten op de schermafbeelding |
| Contrast van randen, pictogrammen en focusaanduiding niet gemeten | 1.4.11 | Gemeten, in licht en donker |
| Koppen kregen de ruimere tekstafstand niet | 1.4.12 | Afstand wordt afgedwongen op content in slots; wat de afstand niet krijgt, wordt gemeld |
| Toetsproef op 4 van de 10 pagina's | 2.1.4 | Op alle pagina's |
| Alleen de eerste 700 tekens tekst per pagina | 1.3.3, 3.1.2 | Volledige tekst per pagina als bestand |
| Knop die alleen op een smal scherm bestaat | 4.1.2, 1.3.4 | Interactieproef ook op 360 pixels breed |
| Niet te zeggen wat luisteraars voor aanraken en indrukken doen | 2.5.1, 2.5.2, 2.5.7 | Aanwijzer indrukken, wegschuiven en loslaten; luisteraars van de testbrowser afgetrokken |
| Schermafbeeldingen van 6 van de 10 pagina's | meerdere | Tot 12 paginatypen; regel in de opdracht: meten op alle pagina's, kijken per paginatype |

Eén ding ging mis. De proef die formulieren verstuurt, hield verzoeken tegen maar geen berichten over een WebSocket. Daardoor is één chatbericht met de tekst "x" bij de chat van de site aangekomen. Sindsdien worden sockets tijdens de hele interactieproef stilgezet.

De rapporten waren te lang: 122 pagina's voor een site van 10 pagina's. De opdracht aan het model begrenst nu het aantal waarnemingen en hun lengte, en het rapport krijgt een compact hoofddeel met de onderbouwing in een bijlage.

## Ronde 2: digitaledienst.overheid.nl, 10 oktober 2026

- Toolbox op commit `abaaf72`, procedures bijgewerkt voor het nieuwe bewijs (commit `73b2a17`), 11 pagina's: de 10 van de site plus het ingesloten chatvenster.
- 168 beoordelingen, 14 minuten, ongeveer 12,1 miljoen tokens.
- A en B eens bij 54 van de 56 criteria. Bij de twee andere (2.5.3 en 3.3.1) zei de ene "voldoet" en de andere "kan niet bepalen"; de toetsronde maakte er beide keren "kan niet bepalen" van.
- Uitkomst (WCAG 2.2): 17 voldoet, 9 voldoet niet, 14 niet van toepassing, 15 kan niet bepalen.

Wat het extra bewijs deed met de bevindingen van ronde 1:

- De bevinding "in lijsten is alleen de eerste link met Tab te bereiken" (37 links, ernst hoog) bleek grotendeels onterecht. De pijltjestoetsen bereiken de andere links. Wat overbleef is één link, "Bekijk hele tijdlijn", die met Tab noch met pijltjes focus krijgt. Zonder de meting met pijltjestoetsen had een onterechte bevinding in het rapport gestaan.
- Nieuw: de focusrand van de knop "Verstuur" in het chatvenster haalt geen 3:1.
- De bevindingen over reflow, vergroting, koppen en linkteksten kwamen in dezelfde vorm terug, met dezelfde identificatie.

Wat open bleef en waarom:

| Open | Oorzaak | Gedaan |
|---|---|---|
| 4.1.2: bedieningselementen in een geopend paneel ontbraken | De telling keek alleen naar afstammelingen van de dialoog; content die via een slot wordt getoond viel erbuiten | Opgelost |
| 2.4.3: waar gaat de focus heen als Tab een dialoog verlaat | Niet vastgelegd | Vastgelegd |
| 2.5.1, 2.5.2, 2.5.7: luisteraars op het venster voor muis en aanraking | Die bleken van de testbrowser zelf te zijn | De luisteraars van de pagina worden vastgelegd voordat de testbrowser iets doet; wat de testbrowser registreert wordt gemeten op een lege pagina en afgetrokken |
| 3.2.2: wat gebeurt er na invoer | Niet gemeten | Tekstvelden worden ingevuld en verlaten; keuzelijsten en selectievakjes nog niet |
| 1.4.3: voorbeeldtekst in een veld, en de skiplink als die zichtbaar is | Niet gemeten | Gemeten |
| 3.3.1, 3.3.3, 3.3.7, 4.1.3, 2.2.1 in de chat | Vragen om een bericht dat echt wordt verstuurd; dat doet de toolbox bewust niet | Blijft open; staat als beperking in het rapport |

## Ronde 3: digitaledienst.overheid.nl, alleen wat veranderd was

Na de verbeteringen hadden 20 van de 56 criteria een ander dossier of een andere procedure. Alleen die zijn opnieuw beoordeeld: 60 beoordelingen, 5 minuten, ongeveer 4,1 miljoen tokens. De overige 36 oordelen bleven staan, elk met een stempel van het dossier waarmee het was geveld.

- A en B eens bij 18 van de 20.
- Uitkomst (WCAG 2.2): 18 voldoet, 10 voldoet niet, 16 niet van toepassing, 11 kan niet bepalen.
- 2.5.1, 2.5.4 en 2.5.7 gingen van "kan niet bepalen" naar "niet van toepassing": de pagina's registreren geen enkele luisteraar voor bewegen of slepen.
- 2.4.3 ging naar "voldoet niet": dezelfde link die geen focus krijgt, valt ook uit de focusvolgorde.

Over drie rondes: 26, 15 en 11 open criteria. De daling kwam elke keer uit beter bewijs, niet uit een soepeler oordeel: de procedures zijn in die tijd strenger geworden waar ze iets nieuws konden meten.

## nerds.digitaledienst.overheid.nl, ronde 1 en 2, 10 oktober 2026

- 30 pagina's, de hele site. Ronde 1: 168 beoordelingen, 19 minuten, ongeveer 14,7 miljoen tokens. Ronde 2, na meer bewijs, alleen de 36 criteria met een veranderd dossier: 108 beoordelingen, 13 minuten, ongeveer 9,4 miljoen tokens.
- A en B eens bij 51 van de 56 in ronde 1.
- Uitkomst in beide rondes (WCAG 2.2): 8 voldoet, 15 voldoet niet, 9 niet van toepassing, 23 kan niet bepalen. Per criterium was de uitkomst in ronde 2 bij alle 56 gelijk aan ronde 1.
- 28 bevindingen in ronde 1, 26 in ronde 2. 24 van de 26 beschrijven hetzelfde probleem als een bevinding uit ronde 1.

Tussen de rondes is toegevoegd: eigen selectievakjes als bedieningselement, de proef die selectievakjes en keuzelijsten wijzigt, de berekening van tussenruimte bij kleine doelen, en contrast van tekst in kleine gekleurde labels. Die laatste meting gaf eerst 113 valse meldingen ("wit op wit") omdat de achtergrond werd afgelezen van de pagina rond het label. Na herstel: 0 afkeuringen op contrast, 396 stukken tekst niet te meten (het zijmenu, dat in een eigen schuifvak staat).

Waarom er 23 open bleven terwijl er meer bewijs was: de procedures vragen per open rij een uitspraak, en bij elke nieuwe meting komt er iets bij dat nog niet gemeten is. Voorbeelden: het zijmenu in zijn schuifvak, wat de zoekfunctie teruggeeft, de melding na het kopiëren van een codeblok, het formulier "Kubernetes cluster aanmaken" voorbij de eerste stap. Dat zijn terechte open punten. Het laat ook zien dat "nul open criteria" met deze strengheid op een site met interactie niet haalbaar is zonder dat iemand die laatste punten met de hand naloopt.

## Ontwikkelsite, ronde 1, 10 oktober 2026 (ontwikkelset)

- 15 pagina's: de 14 uit het bestaande onderzoek plus een ingesloten videovenster. 168 beoordelingen, 19 minuten, ongeveer 14,1 miljoen tokens.
- A en B eens bij 51 van de 56.
- Uitkomst (WCAG 2.2): 6 voldoet, 19 voldoet niet, 3 niet van toepassing, 27 kan niet bepalen. 61 bevindingen.
- Vergelijking met het bestaande onderzoek: buiten de openbare repository bewaard.

Wat de analyse per bevinding opleverde, staat als vijftien aanbevelingen in `analyse.md`. De belangrijkste drie: klikbare elementen die geen knop of link zijn worden nu niet verzameld (vijf gemiste bevindingen), de context van een link wordt te ruim genomen (drie), en de procedure voor 1.3.2 kende het patroon "datum vóór de kop" niet (de ene onterechte goedkeuring).

## Ronde met de verbeteringen uit de vergelijking, 10 oktober 2026

Na de analyse per bevinding op de ontwikkelsite zijn tien van de vijftien aanbevelingen doorgevoerd (toolbox, procedures en de opdrachten aan het model). Daarna zijn de drie sites opnieuw volledig beoordeeld.

| Site | Voldoet | Voldoet niet | N.v.t. | Kan niet bepalen | Bevindingen | A en B eens | Tokens |
|---|---|---|---|---|---|---|---|
| Ontwikkelsite, ronde 2 | 6 | 22 | 3 | 24 | 98 | 55 van 56 | 15,2 miljoen |
| nerds.digitaledienst.overheid.nl, ronde 3 | 7 | 18 | 10 | 20 | 39 | 53 van 56 | 15,6 miljoen |
| digitaledienst.overheid.nl, laatste ronde | 20 | 9 | 15 | 11 | 13 | 55 van 56 | 12,5 miljoen |

Het aantal bevindingen steeg, vooral door de regel dat een afkeuring niet het einde van het nalopen is. Op de ontwikkelsite ging dat samen met meer gevonden bevindingen van de onderzoeker (27 naar 48 van 65), maar de helft van wat de toolbox zelf meldt bleef discutabel.

## Toetsset, 10 oktober 2026

Methode bevroren op tag `methode-toetsset-1a`. Tussen `methode-toetsset-1` en `-1a` zit één wijziging: een tijdslimiet per stap in de interactieproef, nodig omdat de proef op de eerste toetssite bleef hangen.

| Site | Onderzoek | Afgekeurd in het onderzoek | Ook door ons | Open | Door ons goedgekeurd | Alleen door ons | Tokens |
|---|---|---|---|---|---|---|---|
| Toetssite 1 | ander bureau, juni 2026 | 16 | 11 | 4 | 1 | 8 | 14,2 miljoen |
| Toetssite 2 | zelfde onderzoeker als de ontwikkelsite, januari 2026 | 17 | 11 | 6 | 0 | 9 | 15,1 miljoen |

Deze twee sites zijn nu verbruikt als toets. Wie de aanbevelingen uit hun analyses doorvoert, moet de volgende meting doen op een site die nog niet is bekeken. Er liggen twee onderzoeken klaar die nog niet zijn gebruikt.

## Wat de vergelijking met bestaande onderzoeken zei (eerdere keten, 10 oktober 2026)

Deze sectie en de volgende komen uit `docs/betrouwbaarheid.md`, dat op 11 oktober 2026 is verwijderd omdat het de eerdere keten beschreef: het model las daarin alleen een dossier en bediende de site niet. De cijfers per site staan in de analyses, die buiten de openbare repository worden bewaard; de laatste zet de drie sites naast elkaar. De huidige keten is nog niet op de toetsset gedraaid.

| | Ontwikkelsite, ronde 2 | Toetssite 1 | Toetssite 2 |
|---|---|---|---|
| Bevindingen van de onderzoeker gevonden | 74% | 47% | 32% |
| Deels gevonden | 9% | 0% | 7% |
| Eigen bevindingen terecht | 50% | 42% | 49% |
| Eigen bevindingen onterecht | 3% | 15% | 17% |
| Criteria die de toolbox ten onrechte goedkeurde | 0 | 1 | 0 |

De winst van ronde 2 op de ontwikkelsite was voor een groot deel aanpassing aan die ene site. Op de twee toetssites samen vond de eerdere keten 34 van de 91 bevindingen (37%). De zwakste schakel was het verzamelen, niet het oordeel: op de eerste toetssite stopte de Tab-proef bij een videovenster, op de tweede hield één cookiemelding de hele site buiten bereik.

De conclusie van toen: de eerdere keten vond een derde tot de helft van wat een onderzoeker vond, keurde af en toe iets goed dat een onderzoeker afkeurt, en van wat ze zelf meldde was ongeveer de helft aanvechtbaar of onjuist. Deze cijfers gelden voor de genoemde sites en niet voor andere.

Wat er nodig is voordat een meting bewijs is: een toetsset van vijf tot tien sites met een recent onderzoek (een site die als toets is gebruikt, is daarna verbruikt), een herhaalmeting van de hele keten op één commit, en een oordeel van een onderzoeker over de discutabele bevindingen.

## Herhaalbaarheid van de eerdere keten, 10 oktober 2026

**Scripts.** Twee runs op digitaledienst.overheid.nl, achttien minuten na elkaar: de inhoudshash van de pagina was bij 15 van 15 gelijk, de toegankelijkheidsboom bij 10 van 10, de metingen van reflow en vergroting bij 10 van 10. De uitkomsten van axe-core en Alfa waren gelijk in aantallen en regels, maar niet byte-gelijk, door een willekeurig merkteken dat de componentbibliotheek bij elke lading in de HTML zet. Dat commentaar wordt sindsdien weggelaten.

**Beoordeling.** In de eerdere keten beoordeelden twee rondes elk criterium los van elkaar. Over de negen volledige runs van 10 oktober (zeven staan bij hun ronde hierboven; op toetssite 1 was het 53 van 56 en op toetssite 2 55 van 56) kwamen ze bij 483 van de 504 criteria op dezelfde uitkomst, 96%. Overeenstemming is geen juistheid: bij 1.3.2 op de ontwikkelsite waren alle rondes het eens en hadden ze het mis.

Niet gemeten, toen niet en met de huidige keten niet: dezelfde run herhalen op hetzelfde bewijs en per criterium en per bevinding vergelijken.

## Kosten van deze nacht

Alle beoordelingsrondes samen: ongeveer 140 miljoen tokens, verdeeld over 14 runs van samen ruim 1900 beoordelingen. Daarbovenop het werk van de agents die procedures schreven, het rapport bouwden en de vergelijkingen maakten. Eén volledige beoordeling van één site kost 12 tot 16 miljoen tokens.

## Toetsset 2: aanraking van één site tijdens de bouw, 10 oktober 2026

De startpagina van een site uit toetsset 2 is twee keer geopend door agents die gereedschap bouwden. De lijst met sites die niet bekeken mogen worden stond niet in hun opdracht.

- Bij de verkenning van meettools: de looptijd van de regel-engines op die pagina is gemeten. De getallen stonden in de verkenning van gereedschap van 10 oktober (`docs/gereedschap.md`), die op 11 oktober is verwijderd; de geschiedenis van de repository bewaart haar.
- Bij het bouwen van de tweede meningen: één keer geladen in Chromium, drie commando's (`rules`, `lang`, `motion`), sessie na tien seconden gestopt. De uitvoer staat buiten de repository.

Volgens de bouwer is er geen code, drempel of tabel aangepast op grond van wat daar is gezien; overgenomen zijn alleen looptijden en het aandeel gekoppelde uitkomsten. Er is niets beoordeeld en procedures en prompts zijn er niet door geraakt. De site is een van de twee zonder bevindingen in het bestaande onderzoek. In de eindmeting krijgt deze site een aantekening, en de cijfers worden ook zonder deze site gegeven.

## Versie 2 op de testsite, 10 oktober 2026

Versie 2 is de keten met sitemodel en instrumenten: verkennen, vegen, bewijspoort, rondgang per paginatype, beoordelaar en verifieerder per criterium. Gedraaid vanaf een bevroren kopie van de code (commit `005c04d`) op de variant met ingebouwde gebreken, zonder dat versturen was toegestaan. De nulmeting met versie 1 staat in `validatie/testsite/2026-10-10-nulmeting-v1/`, de vergelijking van deze run in `validatie/testsite/2026-10-10-versie-2/`.

| | Versie 1 | Versie 2 |
|---|---|---|
| Ingebouwde gebreken gevonden (van 79) | 53 (67%); naar de maatstaf van versie 2 hooguit 51 | 71 (90%) |
| Deels gevonden | 1 of 2 | 2 |
| Gemist | 24 of 25 | 6 |
| Gebreken die pas na een handeling zichtbaar zijn (van 20) | 5 | 19 |
| Gebreken in een geopend onderdeel (van 9) | 0 | 8 |
| Criteria terecht afgekeurd (van 51) | 35 | 46 |
| Criteria ten onrechte goedgekeurd | 0 | 0 |
| Criteria "kan niet bepalen" (van 56) | 19 | 7 |
| Eigen bevindingen zonder tegenhanger, onterecht | 1 van 14 | 0 van 18 of 19 |
| Bevindingen, en gebreken na samenvoegen | 81 | 114, 85 gebreken |
| Tokens voor de beoordeling | 13,9 miljoen | 13,8 miljoen |

De 53 van versie 1 is te gunstig. Bij 2.1.4 en 3.3.8 koos de vergelijking van versie 1 "gevonden" waar die van versie 2 bij dezelfde inhoud "deels" kiest. Met de maat van versie 2 vond versie 1 er hooguit 51; de andere 51 zijn niet nagelopen (zie `validatie/testsite/2026-10-10-versie-2/analyse.md`).

De twee vergelijkers waren het over alle 79 gebreken eens. De poort zei na één verkenronde "bewijs voldoende". De testserver ontving geen enkel schrijfverzoek en geen enkel socketbericht.

Niet gevonden door versie 2: ondertitels, beschrijving en audiodescriptie van de video (niets luistert of kijkt), het vanzelf spelende geluid, het indrukken zonder loslaten bij de knoppen Ja en Nee, en de chat zonder statusmelding. Deels: de sneltoets en het plakken in het wachtwoordveld. Drie daarvan vond versie 1 wel geheel: het vanzelf spelende geluid, de sneltoets en het wachtwoordveld.

Wat deze meting niet zegt. De testsite is door hetzelfde systeem gebouwd en is makkelijker dan echte sites: versie 1 haalde hier 67% en op echte sites 37%. Bij de verificatie is geen enkele bevinding vervallen, dus het pad dat onterechte bevindingen weghaalt is in deze run niet gebruikt. De schone tweeling is nog niet beoordeeld. Eén run per versie.

## Schone tweeling met versie 2, 10 oktober 2026

Dezelfde keten en dezelfde bevroren code (commit `005c04d`) op de variant van de testsite zonder de 79 ingebouwde gebreken. Dit meet wat versie 2 afkeurt waar niets afgekeurd hoort te worden. De beoordeling per bevinding staat in `validatie/testsite/2026-10-10-tweeling-v2/afkeuringen.md`.

| | Aantal |
|---|---|
| Criteria voldoet | 28 |
| Criteria voldoet niet | 12 |
| Criteria niet van toepassing | 1 |
| Criteria "kan niet bepalen" | 14 |
| Bevindingen, en gebreken na samenvoegen | 17, 15 gebreken |
| Bevindingen terecht (de schone variant heeft de fout echt) | 7 |
| Bevindingen discutabel (strenge lezing van de norm) | 9 |
| Bevindingen onterecht | 1 |
| Afgekeurde criteria die alleen op een discutabele bevinding rusten | 6 van 12 |
| Tokens voor beoordelen en verifiëren | 9,4 miljoen (92 agents, 70 minuten; rondgangen niet meegeteld) |

Wat dit zegt:

- De schone variant is niet schoon: zeven echte fouten staan in de bron van de testsite. Die moeten eruit voordat de tweeling als maat voor onterechte afkeuringen kan dienen.
- Eén oorzaak, de chatknop over de link "Naar boven", is onder drie criteria afgekeurd (2.4.11, 1.4.4, 1.4.10). De procedures voor vergroten en reflow vragen niet of het gebrek op 100% al bestaat.
- Vier procedures lezen strenger dan de normtekst: 2.4.4, 2.4.2, 3.3.4 en 4.1.2. Vensters van derden worden niet overal gelijk behandeld (2.5.8, 2.5.2, 2.5.4, 2.1.4).
- Alle 14 open criteria hadden volgens de sleutel "voldoet" of "niet van toepassing" moeten zijn. Vijf vragen luisteren of kijken, vier vragen versturen (in deze run niet toegestaan), drie misten dekking van de veegronde, twee betreffen een venster van een derde.

Wat deze meting niet zegt. Eén onterechte bevinding op 17 is geen maat voor echte sites. De beoordeling is gedaan door één beoordelaar tegen de bron en de waarnemingen van de run, zonder de site in een browser te openen; video en geluid zijn niet afgespeeld. De stap die verder samenvoegt met een aparte agent is overgeslagen.

## NeRDS opnieuw met versie 2, 10 oktober 2026

De herstelde site nerds.digitaledienst.overheid.nl, live, 29 pagina's (alle pagina's). Gedraaid vanaf een bevroren kopie van de code met de zeven lessen uit de terugkoppeling van het team (commit `8e13805`). Versturen was toegestaan op grond van een verklaring van de eigenaar van de site. De elementen van het designsysteem zijn opgegeven met `--vendor-tags "nldd-"`. De evaluatie is daarna opnieuw gemaakt met één extra commit die de eigenaar per bevinding laat staan (`9e65a1a`, branch `meting-nerds-v2`).

| | Rapport van 10 oktober (versie 1) | Versie 2 op de herstelde site |
|---|---|---|
| Bevindingen | 39 | 19, in 17 gebreken |
| Criteria voldoet | | 25 |
| Criteria voldoet niet | | 14 |
| Criteria niet van toepassing | | 11 |
| Criteria "kan niet bepalen" | 20 | 6 |
| Tokens voor beoordelen en verifiëren | | 13,7 miljoen (113 agents, geen uitval) |

Tegen de verwachting die het team per criterium opgaf:

| Criterium | Verwacht | Uitkomst |
|---|---|---|
| 2.4.1, 2.4.2, 2.4.4, 3.2.4, 2.4.6 | voldoet | voldoet |
| 2.1.1 | hangt af van de proef | voldoet: de onterechte bevinding over de knop Sluit is weg |
| 1.3.1 | alleen nog punten van het designsysteem | 3 bevindingen, alle drie raken een component |
| 1.4.4, 1.4.1 | voldoet niet | voldoet niet |
| 1.4.5 | discutabel | voldoet niet |
| 3.1.2 | voldoet | voldoet niet, één bevinding |
| 3.3.2, 3.3.3, 4.1.3 | voldoet | voldoet niet |
| 1.4.10 | voldoet | voldoet niet |
| 1.3.2 | voldoet niet | voldoet |

De afkeuringen bij 3.3.2, 3.3.3, 4.1.3 en 1.4.10 zitten deels op plekken die het eerste onderzoek niet bediende: het voorbeeldvenster voor een cluster en het zoekvenster.

Wat deze meting niet zegt. De 19 bevindingen zijn niet nagekeken tegen de bron van de site; of ze terecht zijn, is dus nog open. De twee rapporten zijn niet direct vergelijkbaar: de site is hersteld én de methode is veranderd. Eén run. De eerste opzet van les 6 gaf 16 van de 19 bevindingen de eigenaar "component (designsysteem)", ook waar de oorzaak in het eigen script van de site lijkt te liggen; dat is hersteld door de eigenaar van de beoordelaar te laten staan en per element te tonen welke bevindingen het raken.

### Terugkoppeling van het team op dit rapport, 11 oktober 2026

Het team van de site heeft de 17 gebreken nagelopen in de bron en deels in de browser.

| | Gebreken |
|---|---|
| Terecht, nagegaan in bron of browser | 13 |
| Aannemelijk, niet zelf nagegaan | 3 |
| Terecht als waarneming, criterium discutabel | 1 |
| Onterecht | 0 |

Het rapport vond een fout die het feedbackformulier op de live site onbruikbaar maakte: met een leeg linkveld verstuurde het niets en kwam er geen melding. De fout was ontstaan door de reparatie van een bevinding uit het eerste rapport, en de eigen controles van het team (bouw, linkcontrole, pa11y en axe) waren groen, omdat geen daarvan een formulier verstuurt. De bevinding kwam van de verificatie, niet van de eerste ronde.

Wat het team aanmerkte, staat als lessen in `validatie/lessen.md`: geen vergelijking met het vorige rapport, twee gebreken die er één zijn, de eigenaar bij vier van zes nagekeken bevindingen anders dan in de code, één advies dat in de schaduwboom van een component van de leverancier wil schrijven, een hoofdstuk "Nog uitzoeken" dat te lang is en over de toolbox gaat, en vier gebreken die bij de eerste meting op dezelfde inhoud niet waren gevonden.

## Kleine meting op de schone variant, 11 oktober 2026

Zeventien criteria op de variant zonder ingebouwde gebreken, vanaf een bevroren kopie van de code (commit `ff80524`), om na te gaan of wat sinds de meting van 10 oktober is gebouwd werkt. De uitkomst per criterium en de vier bevindingen staan in `validatie/testsite/2026-10-11-kleine-meting/uitkomst.md`.

| Op deze zeventien criteria | 10 oktober | 11 oktober |
|---|---|---|
| Voldoet | 3 | 10 |
| Voldoet niet | 8 | 3 |
| Kan niet bepalen | 6 | 4 |

46 agents, 5,2 miljoen tokens, 33 minuten. De verkenner had één ronde nodig en de poort zei in één keer "bewijs voldoende"; een poging eerder die dag met oudere code ging drie keer terug en stopte zonder beoordeling.

De vijf criteria die op een echte site open bleven zonder fout, voldoen hier alle vijf. Vier van de zes strenge lezingen zijn weg. Wat overblijft hangt grotendeels aan één ding: de instrumenten bedienen en lezen niets binnen een ingesloten venster, dus de speler van een derde is niet te beluisteren en niet te meten.

Wat deze meting niet zegt: één run, zeventien criteria, acht van de vijftien paginatypen, op een site van eigen makelij. De vier bevindingen zijn niet door een tweede beoordelaar tegen de bron gelegd.

## Derde meting op de echte site, 11 oktober 2026

Dezelfde site, nu versie 0.3.5, live, 29 pagina's, vanaf een bevroren kopie van de code (commit `ac91dd9`). Versturen was toegestaan op grond van een verklaring van de eigenaar. Dit is de eerste meting op een echte site met wat op 11 oktober is gebouwd: de ruimere veegronde, de telling van bedieningsonderdelen, de formulierproef zoals een bezoeker het doet, de soorten open punten, de uitkomst "geen afwijking gevonden, niet volledig gemeten" en het kortere rapport.

| | Tweede meting (10 oktober) | Derde meting (11 oktober) |
|---|---|---|
| Bevindingen, en gebreken | 19, 17 gebreken | 13, 12 gebreken |
| Criteria voldoet | 25 | 30 |
| Criteria voldoet niet | 14 | 11 |
| Criteria niet van toepassing | 11 | 10 |
| Geen afwijking gevonden, niet volledig gemeten | bestond niet | 3 |
| Criteria "kan niet bepalen" | 6 | 2 |
| Rapport | 98 pagina's | 85 pagina's; zonder bijlage 43 |
| Agents en tokens | 113 agents en 13,7 miljoen voor beoordelen en verifiëren; de rondgangen liepen apart en zijn niet meegeteld | 134 agents en 16,6 miljoen voor rondgang, beoordelen en verifiëren; 130 minuten, geen uitval |

De criteria in deze tabel zijn geteld over 56, met 4.1.1 erbij; dat criterium is in WCAG 2.2 vervallen en voldoet in beide metingen. Het rapport telt 55 criteria en noemt daarom 29 keer "voldoet" voor de derde meting.

Het verschiloverzicht (`diff`) tussen de twee evaluaties: 12 bevindingen opgelost, 7 gebleven, 6 nieuw; 16 criteria met een andere uitkomst. Van de 6 nieuwe staat er 1 op een plek die toen niet is onderzocht en 3 op een plek die toen ook is onderzocht.

Wat de meting laat zien:

- De criteria over formulieren (3.3.1, 3.3.2, 3.3.3) en statusberichten (4.1.3) voldoen nu. Het team had het feedbackformulier hersteld; het onderzoek bevestigt dat.
- Van de zes criteria die op 10 oktober open bleven zonder dat er een fout was gevonden, voldoen er nu twee (2.5.3, 2.5.8), is er één niet van toepassing (2.1.4), zijn er twee "niet volledig gemeten" (1.4.12, 2.5.2) en is er één afgekeurd (1.4.3, zie hieronder).
- De twee criteria die echt open blijven (2.2.1, 3.3.7) vragen een mens: of er achter een formulier een sessie verloopt, en wat er gebeurt in de laatste stap van feedback geven, die buiten de site ligt.
- Drie nieuwe afkeuringen op plekken die ook de vorige keer zijn onderzocht: 2.4.3 (een link in het zijmenu op een smal scherm verplaatst de focus niet), 2.4.11 (links in het zijmenu verdwijnen onderaan de pagina onder de voet) en 1.4.3. Dat een tweede meting op dezelfde inhoud andere dingen vindt, merkte het team ook bij de vorige meting op; hoe groot die spreiding is, is nog niet gemeten.

Wat deze meting niet zegt. De 13 bevindingen zijn niet nagelopen tegen de broncode. De bevinding bij 1.4.3 gaat over witte letters in een plaatje dat van het register van toegankelijkheidsverklaringen komt; ze is gemeten met de versie van het instrument van vóór een herstel op dezelfde dag en is door de verificatie toegevoegd, dus één keer gezien. Of het plaatje een logo is en dan is uitgezonderd, is een keuze. De poort stuurde de run één keer terug voor de vaste zijkolom, die niets bedekt. Eén run.

## Meting op 0.11.0, 20 en 21 oktober 2026

Issue #184. De eerste meting van een uitgebrachte versie als geheel, en de eerste toets van twee stappen uit [het voorstel over verbruik](verbruik/README.md). Alle runs werkten op een kopie van één bevroren veegronde van de testsite Lindewaard (variant met 79 ingebouwde gebreken), gemaakt met tag `v0.11.0` (commit `6ad7e5c`), met versturen toegestaan. Opzet, stopregel en marge stonden in #184 voordat een variant draaide. De uitwerking, de vergelijkingen per run en de uitvoer van `compare-variants` staan in [testsite/2026-10-20-meting-0.11.0/](testsite/2026-10-20-meting-0.11.0/uitkomst.md).

- Nulmeting: N1 en N2, `v0.11.0`, alle 56 criteria, zes agents tegelijk. 129 agents per run, geen uitval, geen afmaakronde, 2 uur 22 en 2 uur 50 minuten.
- Variant K: #170, de opdracht in een kern en een naslag (commit `cb50690`). Variant S: rondgangen en verifieerders op Sonnet, beoordelaars op Opus. Beide op negen criteria (1.1.1, 1.3.1, 1.4.3, 1.4.11, 2.1.1, 2.4.3, 3.1.2, 3.3.1, 4.1.2), met 29 gebreken in de sleutel.
- Marge, vastgelegd na de nulmeting: de standaard. Ondergrens van het verschil in gevonden gebreken boven -5 procentpunt, en minder dan één onterechte melding per run meer. De zorg was een spreiding waarbij een vijfde van de gebreken per run wisselt; gemeten is één wisselend gebrek op 79.

| | N1 | N2 | K (2 runs) | S (3 runs) |
|---|---|---|---|---|
| Criteria met dezelfde uitkomst in alle runs | 56 van 56 | | 9 van 9 | 9 van 9 |
| Criteria terecht afgekeurd (van 51) | 50 | 50 | | |
| Criteria ten onrechte goedgekeurd | 1 (1.4.12, zie hieronder) | 1 (1.4.12) | 0 | 0 |
| Criteria "kan niet bepalen" | 0 | 0 | 0 | 0 |
| Gebreken gevonden, van 79 | 77 | 78 | | |
| Gebreken gevonden per run, op 9 criteria (van 29) | 28 | 29 | 98,3% | 97,7% |
| Meldingen zonder tegenhanger per run, op 9 criteria | 4,0 gemiddeld | | 3,0 | 2,3 |
| Eigen bevindingen onterecht volgens beide vergelijkers | 0 | 0 | 0 | 0 |
| Niet slechter dan de nulmeting | | | ja, gestopt na ronde 2 | niet aangetoond: verschil -0,6 procentpunt (-5,2 tot +4,0) |
| Kosten per run, rondgangen en de 9 criteria | 88,52 dollar | 90,32 dollar | 89,20 dollar gemiddeld | 58,65 dollar gemiddeld |

De kosten komen uit de transcripts, met de prijzen van de API van 19 oktober 2026: alleen rondgangen, stand-agent en de beoordelaars en verifieerders van de negen criteria, bij N1 en N2 dus 9 van de 56.

Wat eruit kwam:

- Op de testsite is loep 0.11.0 zeer herhaalbaar: dezelfde uitkomst bij alle 56 criteria, en bij 77 van de 79 gebreken dezelfde uitkomst in beide runs. Ook de afwijking van de sleutel herhaalt zich: 1.4.12 is in beide runs goedgekeurd terwijl de sleutel het afkeurt. Dat ligt voor een deel aan de sleutel. Met de tekstafstand loopt de tegel 10 pixels over, maar dat is vooral regelhoogte en padding; van de letters valt maar 1 pixel weg. Het oordeel "nog leesbaar" was dus verdedigbaar. De 77 en 78 van 79 en het ene ten onrechte goedgekeurde criterium zijn met die kanttekening te lezen. #238 gaat nu over een preciezere meting (verdwijnt er tekst of alleen ruimte), #218 over het herstel van de testsite.
- Tegen versie 2 van 10 oktober: gevonden gebreken van 71 naar 77 en 78, terecht afgekeurde criteria van 46 naar 50, open criteria van 7 naar 0. Ten onrechte goedgekeurd van 0 naar 1.
- K is niet slechter en bespaart niets: de beoordelaars nemen meer beurten en lezen meer uit de cache. #170 en #135 zijn gesloten.
- S is 34% goedkoper, maar "niet slechter" is niet aangetoond: de ondergrens van het interval ligt net onder de marge. Twee keer kwam een gebrek dat de nulmeting steeds vond, niet of deels in het oordeel, beide keren passend bij een rondgang op Sonnet die een kandidaat niet doorgeeft. Rondgangen en verifieerders gaan niet samen naar Sonnet. Een vervolgmeting met alleen de verifieerders op Sonnet zou in deze samenstelling 15% schelen.
- De open punten gaan in alle runs over dezelfde twee onderdelen, een fotoserie die alleen met vegen werkt en een schuif die alleen met slepen werkt (#240). Een gebrek dat een beoordelaar naar een ander criterium doorschuift, komt daar niet altijd aan (#239).

Wat deze meting niet zegt. De uitkomst is gemeten tegen de sleutel van de eigen testsite, niet tegen het oordeel van een menselijke deskundige, en de testsite is makkelijker dan een echte site. Alle runs deelden één veegronde, dus de spreiding van de veegronde zelf is niet gemeten. De schone variant is niet gedraaid. Op de negen criteria is elke uitkomst "voldoet niet", dus de toets op criteriumniveau maakt daar geen onderscheid. Twee runs van de nulmeting.

## Meting van "zo goed mogelijk" (#318), 23 oktober 2026

Vooraf vastgelegd, voordat een run is beoordeeld.

**Vraag.** Maakt voorstel #341 (doel van het onderzoek, beperking in plaats van open punt, een poging in elke ronde, `fail_observations`, zekerheid per plek, de poort die afschaalt, een bevinding op een eerdere waarneming) het oordeel niet slechter waar niets afschaalt, en klopt het oordeel waar de poort wel afschaalt?

**Opzet.**

- Eén bevroren veegronde van Lindewaard (de testsite met gebreken), gemaakt met de code van #341 (commit `4fa6e85`): het vaste sitemodel van de regressietoets, de 13 vaste pagina's, versturen toegestaan tot 30 keer, doel verbeteren, VoiceOver uit. Het vaste model opent vijf onderdelen bewust niet (`components-opened`), onder meer de formulieren, en opent het menu achter de menuknop alleen op de startpagina.
- De bladen van de poort één keer beoordeeld door twee poort-agents, vóór het kopiëren; elke kopie neemt die antwoorden mee. De agent van de eerste acht bladen zag nergens iets ontbreken; die van de laatste vijf meldde op elk blad de menuknop (`review-missing`), terecht volgens de lijsten. Samen tien gaten.
- Drie armen, elk een kopie met `variant`, op tien criteria (`tasks --only`): 1.1.1, 1.3.1, 1.4.3, 1.4.4, 1.4.11, 2.1.1, 2.4.3, 2.4.7, 3.3.1, 4.1.2. Werkstroom met 6 agents tegelijk, alle rollen op het model van de sessie, twee runs tegelijk.
  - **A**: main (`a1b8e19`, 0.17.0 met #345), de tien gaten aanvaard in het sitemodel met `decidedBy: verkenner`, elk met een `look` op die pagina uit een eigen sessie (`verken-meting`).
  - **B**: #341, dezelfde tien gaten aanvaard.
  - **C**: #341, de tien gaten niet aanvaard. In het manifest staan drie verkenningen, alsof de run al twee keer terug was naar de verkenner (nagebootst: er is geen verkenner gedraaid). De poort schaalt dan af en de beoordelaars moeten die onderdelen zelf bekijken.
- Per run `compare --findings` tegen `reference-lindewaard.json`, op de tien criteria.

**Stopregel na ronde 1** (één run per arm).

- B tegen A, "niet slechter": B vindt elk gebrek uit de sleutel dat A vindt, heeft hooguit één melding zonder tegenhanger meer, en niet meer criteria open door loep zelf. Dan stoppen. Mist B een gebrek dat A vond, of andersom, dan ronde 2: A2 en B2, en daarna de toets per gebrek over twee runs zoals bij 0.11.0.
- C, "afschalen klopt": de poort gaat door met beperkingen (geen stop), geen criterium blijft open door loep zelf, geen afkeuring is onterecht volgens beide vergelijkers, en C vindt op de criteria die de tien gaten niet raken dezelfde gebreken als A. Wat C mist op de criteria die ze wel raken (zoals 3.3.1), staat in het verslag. Haalt C dit niet, dan geen tweede ronde maar een fout in #341 die eerst hersteld wordt.
- Ter informatie, zonder drempel: het aandeel "vastgesteld door een agent", hoe vaak `check-verdict` een punt zonder poging weigerde, overgeslagen agents, de plekken in `instrument-gaps.json`, duur en tokens.

**Uitkomst, 27 oktober 2026.** Ronde 1 haalde de stopregel niet (B1 had twee meldingen zonder tegenhanger meer dan A1, en bij 2.1.1-chat-sluit waren de vergelijkers het voor B1 oneens), dus ronde 2. De weeklimiet stopte C1 en A2 halverwege de beoordelaars; na de pauze zijn de sessies van vijf beoordelaars die al begonnen waren opzij gezet, omdat hun klok over de pauze heen was verlopen (#359). Telt niet als poging.

| | A1 | A2 | B1 | B2 | C1 |
|---|---|---|---|---|---|
| Uitkomst zoals de sleutel, van 10 criteria | 10 | 10 | 10 | 10 | 10 |
| Gebreken gevonden waar beide vergelijkers het eens zijn, van 38 | 34 | 36 | 34 | 33 | 35 |
| Meldingen zonder tegenhanger | 3 | 4 | 5 | 4 | 5 |
| Onterecht volgens beide vergelijkers | 0 | 0 | 0 | 0 | 0 |
| Criteria open door loep | 0 | 0 | 0 | 0 | 0 |
| Open punten in afgekeurde criteria | 6 | 8 | 0 | 0 | 0 |
| Beperkingen in afgekeurde criteria | | | 11 | 8 | 5 |
| Agents, overgeslagen | 37, 0 | 37, 0 | 37, 0 | 37, 0 | 42, 0 (één afmaakronde) |

Per gebrek wijkt een run af bij zeven gebreken. Twee mist elke run (1.3.2-zoekvolgorde, 3.3.2-plaatshouder). 3.2.1-voetlink wisselt in beide armen (A: gemist en gevonden; B: gevonden en gemist). 2.4.11-melding is in elke arm een keer deels. Bij 1.3.1-tussenkop-uitklapper (B2), 2.1.1-chat-sluit (B1) en 2.4.7-menu (C1) noemde één vergelijker het deels en de ander gevonden.

- **B tegen A: "niet slechter" niet strikt aangetoond, geen aanwijzing voor slechter.** B mist geen gebrek dat A in beide runs vond; de twee keer dat B afwijkt, is het een oneens tussen "deels" en "gevonden". Gemiddeld 33,5 tegen 35 van 38 gevonden (-3,9 procentpunt, binnen de marge van -5 van de meting op 0.11.0, maar met twee runs per arm is dat geen sterke uitspraak). Meldingen zonder tegenhanger 9 tegen 7 over twee runs, alle terecht of discutabel.
- **C: afschalen klopt.** De poort ging door met tien beperkingen, geen criterium bleef open, geen afkeuring was onterecht. 3.3.1, waarvan het vaste model de formulieren niet opent, werd door de afmaakronde zelf gemeten en terecht afgekeurd. C vond 35 van 38, tussen A1 en A2.
- **Beperkingen.** De open punten die A in afgekeurde criteria laat staan (6 en 8), zijn in B en C beperkingen; geen uitkomst verandert erdoor.
- **Niet gemeten.** `instrument-gaps.json` bleef in alle runs van #341 leeg: niet aangetoond dat de afleiding van gaten werkt. Een bevinding op een eerdere waarneming (`notRepeated`) kwam niet voor. Het doel `verantwoorden` is niet gemeten.
