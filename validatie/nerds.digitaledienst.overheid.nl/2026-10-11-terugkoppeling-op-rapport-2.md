# Terugkoppeling op het tweede toegankelijkheidsrapport van NeRDS

Voor de bouwer van de toolbox. Rapport: evaluatie `d90fe8ea6edb`, 10 oktober 2026, toolbox 0.0.1 (`8e13805b7872`, met wijzigingen die niet in die commit staan), site `nerds.digitaledienst.overheid.nl` versie 0.3.4. Dit is het vervolg op de terugkoppeling op evaluatie `7c19c731bdc4`.

De bevindingen aan onze eigen code zijn nagegaan in de bron van de site. Twee zijn nagemaakt in Chromium op de live site. Wat het rapport aan een component van het designsysteem toeschrijft, is op twee punten in de bron van dat component nagekeken en verder overgenomen. Niets is getest met een schermlezer.

## Uitkomst in het kort

| | Aantal |
|---|---|
| Gebreken in het rapport | 17 |
| Bevindingen | 19 |
| Terecht, nagegaan in bron of browser | 13 gebreken |
| Aannemelijk, niet zelf nagegaan | 3 gebreken |
| Terecht als waarneming, criterium discutabel | 1 gebrek |
| Onterecht | 0 |

Het belangrijkste eerst. Dit rapport vond een fout die het feedbackformulier op productie onbruikbaar maakte: met een leeg linkveld verstuurde het niets en kwam er geen melding. Wij hadden die fout zelf gemaakt, met de reparatie voor een bevinding uit het eerste rapport (3.3.3). Onze eigen controles waren groen: de bouw, de linkcontrole, en de toegankelijkheidspoort met pa11y en axe. Geen daarvan verstuurt een formulier. Zonder dit rapport had het er nog gestaan. Het is nagemaakt op de live site en opgelost in [pull request 439](https://github.com/NederlandseDigitaleDienst/NeRDS/pull/439).

## 1. Wat er beter is dan in het eerste rapport

- **Gebreken naast bevindingen.** Eén plek om te herstellen, met "raakt ook" voor de andere criteria. Dat was het grootste bezwaar tegen het eerste rapport (39 bevindingen, 19 reparaties) en het werkt: 19 bevindingen, 17 gebreken.
- **De lijst "Raakt een component van designsysteem".** Per tag de bevindingen, met de zin dat dit zegt waar het zit en niet wie het herstelt. Precies goed.
- **De waarschuwing bij oplossingen** over HTML tegenover de bron en over opnieuw meten op 320 pixels en een tussenbreedte. Beide adviezen die vorige keer schade deden, zouden hiermee zijn opgevangen.
- **De proef komt verder.** Het voorbeeldvenster voor een Kubernetes-cluster is voorbij de inlogknoppen onderzocht en het zoekvenster is met een zoekwoord gemeten. Dat leverde vier van de 17 gebreken op, allemaal op plekken waar het eerste rapport niet kwam.
- **De regel "Controle".** "Opnieuw gemaakt bij de verificatie" tegenover "één keer gezien" zegt hoe hard een bevinding is.
- **De onterechte bevinding is weg.** 2.1.1 (knop Sluit in het zoekvenster) voldoet nu.

## 2. Bevindingen die niet helemaal kloppen

| Bevinding | Oordeel | Reden |
|---|---|---|
| `2.2.1-41b7` Melding na kopiëren verdwijnt na twee seconden | Waarneming klopt, criterium discutabel | 2.2.1 gaat over een tijdslimiet die de inhoud zelf oplegt. Een statusmelding die verdwijnt wordt vaker onder 4.1.3 of als bruikbaarheid gemeld. Het rapport noemt zelf dat de tekst "Kopiëren mislukt" was. Dat is vermoedelijk een gevolg van de proef (geen toegang tot het klembord in de testbrowser) en hoort erbij te staan, anders zoekt iemand naar een kapotte kopieerknop. |
| `3.3.3-55b6` Link met spaties krijgt geen melding | Terecht, maar de invoer ontbreekt | "Een tekst met spaties" is niet genoeg om het na te maken. Met `twee woorden` kwam er bij ons wel een melding; met `a.nl/twee woorden` niet. Het verschil is de punt: onze eigen controle keurde een adres met een punt en een spatie goed, de regel onder het veld niet. Zet de ingevoerde waarde letterlijk in de bevinding. |
| `1.4.11-3dc3` en `1.4.1-f439` Huidige pagina in het zijmenu | Terecht, maar één gebrek | Zie punt 3. |

## 3. Twee gebreken die er één zijn

`NERD-G-c6f9` (1.4.11) en `NERD-G-a930` (1.4.1) zijn hetzelfde grijze vlak op hetzelfde element, met dezelfde reparatie: een tweede kenmerk naast de kleur. Ze staan als twee gebreken in de werklijst, onder twee onderdeelnamen ("zijmenu (nldd-list-item, current)" en "zijmenu en menuvenster (nldd-list-item)"). De ene oplossing noemt `aria-current="page"`, de andere `nldd-list-item[selected]`. Dit is hetzelfde patroon als de drie dubbele paren in het eerste rapport. De gebreken-laag vangt het dus nog niet als de twee beoordelingen het onderdeel anders noemen. Groeperen op selector en gemeten kleurenpaar zou ze samenbrengen.

## 4. Eigenaar

Vergeleken met de code:

| Bevinding | Rapport | Werkelijk |
|---|---|---|
| `1.4.10-8bd8` titel van het venster afgekapt | techniek | component: `nldd-top-title-bar` heeft `white-space: nowrap` en `text-overflow: ellipsis` in zijn eigen stijl |
| `2.2.1-41b7` melding na kopiëren | techniek | component: `nldd-code-viewer` |
| `1.4.11-3dc3`, `1.4.1-f439` huidige pagina | design | component: `nldd-list-item[current]` |
| `1.4.4-38fd` tekst van GitHub weg bij 200% | design | gemengd: het attribuut zetten wij, maar met tekst op alle drie de knoppen past de balk niet op 320 pixels |
| `1.3.1-b637` inhoudsopgave | techniek | gemengd: ons sjabloon, maar `nldd-list type="navigation"` kent geen geneste lijst |
| `4.1.3-dc41` zoeken | techniek | klopt; het advies is alleen niet uitvoerbaar, zie punt 5 |

De lijst "Raakt een component" heeft bij vier van deze zes het goede component al staan. De kolom Eigenaar spreekt die lijst dan tegen. Een regel als "raakt de bevinding een tag van de leverancier en noemt de oplossing een eigenschap in de shadow root, dan is de eigenaar leverancier" zou de meeste gevallen goed zetten.

## 5. Was het hersteladvies bruikbaar

Bij de meeste gebreken wel. "Pas de controle met `match` alleen toe als het veld is ingevuld" was de reparatie, woord voor woord. Bij de Engelse titel staat "`{: lang="en" }` direct achter de link, zoals bij de andere Engelse titels op de site": het rapport kent de bron nu.

Eén keer wees het advies naar de oplossing die wij een dag eerder elders hadden gebouwd: bij de inhoudsopgave staat "zoals het zijmenu Richtlijnen al doet met `span.visually-hidden`". Dat scheelt zoeken.

Niet uitvoerbaar:

- **`4.1.3-dc41`:** "vul de bestaande `div.list__polite-announcer` van `nldd-list#search-results`". Dat element zit in de shadow root van een component van de leverancier en de methode die het vult is privé. Een site hoort daar niet in te schrijven. Het werkbare advies is een eigen element met `role="status"` naast de lijst. Algemener: een advies dat een selector in andermans shadow root noemt, is een advies aan de leverancier.

## 6. Wat het rapport niet zegt

- **Geen vergelijking met het vorige rapport.** Dit is het grootste gemis. Het feedbackgebrek is nieuw sinds de vorige meting en is veroorzaakt door een reparatie. Een lezer ziet dat nergens. Een hoofdstuk "sinds de vorige meting" met opgelost, gebleven en nieuw maakt van elk volgend rapport ook een controle op de reparaties. De sleutels zijn er al (criterium, pagina, selector).
- **De zwaarste fout kwam van de verificatie.** `3.3.1-ae87` heeft "Toegevoegd door de verificatie, één keer gezien". De rondgang en de beoordeling hebben het formulier dus wel geopend en ingevuld, maar niet verstuurd met alleen de verplichte velden. Dat is het gewone pad van een bezoeker. Een vaste proef per formulier (verplichte velden goed, optionele leeg, versturen, is er een uitkomst) had dit in de eerste ronde gevonden.
- **Ernst "midden" voor een formulier dat niet verstuurt.** Voor iedereen, met en zonder beperking. De ernst weegt nu vooral hoe erg het is voor wie hulpsoftware gebruikt. "Functie werkt voor niemand" verdient een eigen, hoogste trede.
- **Verschil tussen de twee metingen op dezelfde inhoud.** Vier gebreken stonden ook al op de site bij de eerste meting en zijn toen niet gemeld: de inhoudsopgave die alleen inspringt, de link "Web Content Accessibility Guidelines (WCAG 2.2)" zonder taalaanduiding, de ballon bij de kopieerknop, en het schuifgebied dat in Firefox focus krijgt. Het eerste rapport vond wel drie andere Engelse fragmenten. Wie het rapport als poort wil gebruiken, moet weten hoeveel een tweede meting op dezelfde site anders vindt.
- **De samenvatting noemt vijf van de zes gebreken met ernst midden** onder "Zwaarste gebreken". Het zesde (`NERD-G-40eb`) ontbreekt zonder uitleg. Als er een grens van vijf is, zeg dat.

## 7. "Nog uitzoeken" is te lang en gaat voor een groot deel over de toolbox

Het hoofdstuk beslaat ruim honderd regels. Zes criteria staan op "kan niet bepalen", en de voorlopige status C hangt daaraan. Bij alle zes is de reden, of een groot deel ervan, een grens van de toolbox zelf: "budget op (35 van 35 commando's)", "veegronde mist", een maximum van 40 soorten bedieningselementen bij 2.5.2, acht commando's "verloren aan een fout in mijn eigen aanroep". De site kan daar niets aan doen, en de lezer kan er niets mee.

Drie voorstellen:

- Splits het hoofdstuk in "dit moet een mens nagaan" en "dit meet de toolbox de volgende keer". Alleen het eerste is werk voor de eigenaar van de site.
- Laat een criterium niet open staan op budget. Is het budget op, geef dan het oordeel over wat wel is gemeten en noem de dekking ("gemeten op 9 van 29 pagina's, geen verschil").
- Schrijf het hoofdstuk voor iemand die de toolbox niet kent. Er staan nu woorden in die alleen binnen de toolbox iets betekenen: veegronde, dossier, siteStates, crossCandidates, `tg contrast`, R3 en R4, en verwijzingen als v-143-0006. Ook wisselt de tekst tussen "ik", "wij", "mij" en "de beoordelaar". Wie is wie, en waarom moet de lezer dat weten?

Wat een mens echt moet doen, is kort en staat nu verspreid: een schermlezer over het menu, het feedbackvenster en het zoekvenster; het formulier in een gewone browser versturen en de melding lezen; het contrast van het officiële label beoordelen of besluiten dat het een logo is.

## 8. Omvang

98 pagina's voor 17 gebreken. De werklijst vooraan is wat wij gebruiken; bijlage A is het grootste deel van de rest. Voor de pdf zou de bijlage een apart bestand kunnen zijn.

## Wat wij verwachtten en wat er kwam

De tabel uit de vorige terugkoppeling, met de uitkomst erbij.

| Criterium | Verwacht | Uitkomst | Toelichting |
|---|---|---|---|
| 2.4.1 | voldoet, of alleen nog het zijmenu in main | voldoet | het zijmenu in main is geen bevinding meer |
| 2.4.2 | voldoet | voldoet | |
| 1.3.1 | alleen nog het designsysteem | voldoet niet, drie bevindingen | twee van het designsysteem, één nieuwe aan ons sjabloon (inhoudsopgave) |
| 2.4.4, 3.2.4 | voldoet | voldoet | |
| 2.4.6 | voldoet, mits herhaalde koppen onder een andere ouder mogen | voldoet | |
| 3.1.2 | voldoet | voldoet niet | één Engelse titel die beide keren op de site stond en nu pas is gevonden |
| 3.3.2, 3.3.3, 4.1.3 | voldoet | voldoet niet | onze eigen fout in het feedbackformulier, plus het voorbeeldvenster en zoeken, waar de proef nu voor het eerst kwam |
| 1.4.10 | voldoet | voldoet niet | de pagina's zelf passen; de bevinding is de afgekapte titel in het voorbeeldvenster |
| 1.4.4 | voldoet niet | voldoet niet | zoals verwacht, de knop GitHub |
| 1.4.5 | discutabel | voldoet niet | het officiële label blijft een plaatje met tekst |
| 1.4.1 | voldoet niet | voldoet niet | designsysteem, nu ook onder 1.4.11 |
| 1.3.2 | voldoet niet | voldoet | het versienummer vóór de kop is geen bevinding meer |
| 2.1.1 | hangt af van de proef | voldoet | |

Waar de uitkomst afwijkt, komt dat meestal doordat de proef nu op plekken kwam waar de eerste niet kwam.

## Voor de meting met versie 3

De site is intussen 0.3.5: het feedbackformulier verstuurt weer met een leeg linkveld, en een adres met een spatie krijgt een melding. De andere gebreken aan onze eigen code volgen in de komende dagen. Het menu onder een richtlijn toont sinds 0.3.4 "Wanneer doe je wat?" met de naam van de richtlijn als verborgen tekst ervoor; het rapport heeft dat gezien en niet afgekeurd, maar 2.5.3 staat nog op "kan niet bepalen" voor de fasepagina's.
