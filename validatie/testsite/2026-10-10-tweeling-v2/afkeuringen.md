# Afkeuringen op de schone tweeling, run tweeling-v2

Gemeten op 10 oktober 2026 met de toolbox op commit `005c04d`. De site is Berkenveen, de variant van de testsite zonder de 79 ingebouwde gebreken (lokaal op `http://127.0.0.1:4731/`, met de vensters van de derde partij op poort 4732). Run: `toolbox/runs/tweeling-v2`.

Uitkomst van de run: 28 voldoet, 12 voldoet niet (17 bevindingen), 1 niet van toepassing, 14 kan niet bepalen. Volgens de sleutel (`toolbox/fixtures/key.json`) hoort geen enkel criterium hier te worden afgekeurd. Elke bevinding is dus een echte fout in de schone variant of een onterechte of strenge afkeuring.

Elke bevinding is nagelopen in de bron van de site (`toolbox/fixtures/sites/berkenveen`, `toolbox/fixtures/sites/kijkpunt`, `toolbox/fixtures/src`) en waar nodig in de waarneming van de run.

## Telling

| Oordeel over de 17 bevindingen | Aantal | Bevindingen |
|---|---|---|
| Terecht | 7 | 1, 2, 5, 10, 13, 14, 15 |
| Discutabel | 9 | 3, 4, 6, 7, 8, 9, 12, 16, 17 |
| Onterecht | 1 | 11 |

Per criterium: 6 van de 12 afgekeurde criteria houden minstens één terechte bevinding (1.1.1, 1.3.1, 1.4.10, 2.4.4, 2.4.11, 2.5.8). De andere 6 zijn alleen op een discutabele bevinding afgekeurd (1.4.4, 1.4.12, 2.1.4, 2.4.2, 3.3.4, 4.1.2).

| Hoofdreden bij de 14 open criteria | Aantal | Criteria |
|---|---|---|
| (a) Geen instrument kan het vaststellen | 5 | 1.2.1, 1.2.2, 1.2.3, 1.2.5, 2.3.1 |
| (b) De veegronde miste dekking | 3 | 1.4.13, 2.5.3, 3.3.8 |
| (c) Versturen of typen was niet toegestaan | 4 | 2.2.1, 3.2.2, 3.3.3, 4.1.3 |
| (d) Budget of poging mislukt | 0 | |
| (e) Methoden oneens | 0 | |
| (f) Anders: venster van een derde niet onderzocht | 2 | 2.5.2, 2.5.4 |

## De 17 bevindingen

| Nr | Id | Criterium | Titel | Oordeel | Reden |
|---|---|---|---|---|---|
| 1 | GEME-1.1.1-c4e6 | 1.1.1 | Beschrijvingen van de foto's in de galerij passen niet bij het beeld | Terecht | `beeld/galerij-1.svg` tot en met `galerij-3.svg` zijn drie keer dezelfde tekening (blok met twee wielen, alleen de kleur en de plek verschillen). De alt-teksten in `nieuws/nieuwe-fietsenstalling.html` beschrijven drie verschillende beelden. Een fout van de testsite zelf: het beeld is een plaatshouder. |
| 2 | GEME-1.3.1-82db | 1.3.1 | Regel 'Zomerfeest op het Marktplein' ziet eruit als kop maar is geen kop | Terecht | In `index.html` is het `<p class="groot">`, in `stijl.css` 1,6 rem en vet, boven een eigen regel tekst. De goede versie van gebrek `1.4.5-zomerfeest` in `src/pages/index.html` heeft dit nieuwe gebrek zelf meegebracht. |
| 3 | GEME-1.3.1-9707 | 1.3.1 | Zoekresultaten hangen onder de kop 'Veel gezocht' | Discutabel | Klopt in `zoeken.html` en `site.js`: de resultaten zijn h3 en volgen op de h2 'Veel gezocht' in het navigatieblok, zonder eigen kop. De norm keurt een rommelige koppenstructuur niet zonder meer af; het is wel een verkeerde relatie die een schermlezer hoort. |
| 4 | GEME-1.4.4-42ff | 1.4.4 | Link 'Naar boven' verdwijnt op 200% achter de chatknop | Discutabel | De bedekking is echt (`v-144-0007`), maar komt niet door het vergroten: op 100% ligt de vaste chatknop al over het grootste deel van de link. Dezelfde oorzaak als bevinding 13. Of dit ook 1.4.4 schendt, vraagt een strenge lezing. |
| 5 | GEME-1.4.10-779b | 1.4.10 | Pagina schuift opzij door de geluidsspeler | Terecht | `<audio controls>` heeft in `stijl.css` geen maximale breedte en is 300 pixels breed naast 24 pixels marge (`v-1410-0003`: scrollbreedte 324). Klein, maar een echte fout in beide varianten. |
| 6 | GEME-1.4.10-d8b2 | 1.4.10 | Chatknop bedekt de link 'Naar boven' op een smal scherm | Discutabel | Waarneming klopt. Het is dezelfde oorzaak als bevinding 4 en 13 en bestaat op elke breedte. Het is dus geen gevolg van het smalle scherm. Als derde afkeuring van één gebrek telt dit dubbel. |
| 7 | GEME-1.4.12-73ec | 1.4.12 | Sluitknop van het chatvenster ligt over de kop bij ruimere tekstafstand | Discutabel | Op `v-1412-0004` raakt de sluitknop de laatste letter van de kop; de kop blijft leesbaar. Alleen op 320 pixels breed en alleen met ruimere tekstafstand. De eigen meting van het instrument geeft `newlyClipped: []`. Verlies van inhoud is hier een strenge lezing. |
| 8 | GEME-2.1.4-8c18 | 2.1.4 | Videospeler reageert op de losse toetsen k en m en dat is niet uit te zetten | Discutabel | Klopt in `sites/kijkpunt/speler.html`: de toetsen werken in het hele venster van de speler, ook op een andere knop. Ze werken niet als de focus buiten de speler staat. De sleutel noemt dit uitdrukkelijk geen gebrek (valkuil `videospeler`). Het hangt ervan af of de hele speler als één onderdeel met focus telt. |
| 9 | GEME-2.4.2-e16e | 2.4.2 | Zoekresultaten hebben dezelfde titel als de lege zoekpagina | Discutabel | Klopt: `site.js` past de titel niet aan. De titel 'Zoeken - Gemeente Berkenveen' beschrijft wel het doel van de pagina. Het zoekwoord in de titel is een goede gewoonte, geen eis. |
| 10 | GEME-2.4.4-9d17 | 2.4.4 | Links naar Mastodon en LinkedIn openen de contactpagina | Terecht | In de voet van elke pagina hebben beide links `href="/contact.html"` en een naam die een ander doel belooft. Een fout van de testsite: de links zijn plaatshouders. |
| 11 | GEME-2.4.4-a63d | 2.4.4 | Twee links 'afval' op de zoekpagina met een verschillend doel | Onterecht | De tweede link staat in `nav aria-label="Veel gezocht"` onder de kop 'Veel gezocht' (`zoeken.html`). Die context is door software te bepalen en dat is wat 2.4.4 vraagt. De bevinding zegt zelf dat de kop het verschil geeft. |
| 12 | GEME-2.4.4-1a5b | 2.4.4 | Link belooft openingstijden van het servicepunt, maar die staan er niet | Discutabel | Klopt: `openingstijden.html` noemt geen servicepunt of trein. Het doel van de link is uit de tekst wel te bepalen en de link opent de pagina Openingstijden. Dit is een fout in de inhoud, geen onduidelijk linkdoel. |
| 13 | GEME-2.4.11-70c1 | 2.4.11 | Link Naar boven verdwijnt onder de chatknop op een smal scherm | Terecht | `.chat` staat vast rechtsonder (`stijl.css`), `a.naar-boven` staat rechtsonder in de voet, zonder ruimte eronder. Met focus is de link helemaal bedekt (`v-2411-0076`). Een fout in beide varianten. |
| 14 | GEME-2.4.11-3b31 | 2.4.11 | Links krijgen focus achter het open chatvenster | Terecht | Het chatvenster houdt de focus niet vast en Escape werkt alleen als de focus in het venster staat (`site.js`, luisteraar op het venster zelf). De bezoeker kan de bedekte link dus niet vrijmaken zonder de focus te verplaatsen. Daarmee geldt de uitzondering voor zelf geopende inhoud niet. |
| 15 | GEME-2.5.8-3d41 | 2.5.8 | Twee kleine links in het controlekader staan direct op elkaar | Terecht | In `sites/kijkpunt/controle.html` hebben de links tekst van 11 pixels (gemeten 13 pixels hoog), als blok onder elkaar, zonder ruimte. Geen uitzondering past. Het kader is van een derde, maar staat in de pagina en telt dus mee. De run sluit hetzelfde kader wel uit van de steekproef; dat is niet consequent. |
| 16 | GEME-3.3.4-9ddf | 3.3.4 | Aanvraag parkeervergunning: geen controle en een onvolledig overzicht | Discutabel | Stap 3 in `vergunning.html` toont de gegevens met een knop 'Gegevens wijzigen'; één van de drie wegen van 3.3.4 is genoeg, dus het ontbreken van controle op invoer is geen schending. Wel echt: het overzicht mist de postcode voor de rekening (`factuurpostcode`), terwijl de sleutel zegt dat alle gegevens worden getoond. |
| 17 | GEME-4.1.2-dc4a | 4.1.2 | Knop Aanpassen in de cookiemelding meldt niet dat de keuzes open zijn | Discutabel | Klopt in `site.js`: de knop toont de keuzes en heeft geen `aria-expanded`. De knop klapt niet terug dicht; het is een eenmalige actie en geen schakelaar met een toestand. Of hier een toestand gemeld moet worden, is een strenge lezing. |

## De 14 open criteria

Volgens de sleutel hoort elk van deze criteria op de schone variant "voldoet" te zijn, behalve 2.3.1 en 2.5.4: die zijn niet van toepassing.

| Criterium | Hoofdreden | Toelichting uit `missingNl` | Had "voldoet" moeten zijn? |
|---|---|---|---|
| 1.2.1 Louter geluid en louter beeld | (a) | Het fragment is niet beluisterd; of de tekst eronder hetzelfde zegt, kan geen instrument vaststellen. | Ja |
| 1.2.2 Ondertitels | (a) | Het ondertitelspoor is gevonden, de inhoud is niet vergeleken met wat er gezegd wordt. | Ja |
| 1.2.3 Audiodescriptie of media-alternatief | (a) | Niemand heeft de video's bekeken en beluisterd. | Ja |
| 1.2.5 Audiodescriptie | (a) | Zelfde reden als 1.2.3. | Ja |
| 1.4.13 Content bij hover of focus | (b) | Drie geopende onderdelen en de ingevulde formulieren zijn niet gemeten; het budget was op na 35 commando's. | Ja |
| 2.2.1 Timing aanpasbaar | (c) | Of de server een sessie laat verlopen is niet te zien zonder in te loggen of te versturen. | Ja; de site is statisch en heeft geen sessie |
| 2.3.1 Drie flitsen | (a) | De video's zijn niet bekeken en er is geen flitsanalyse gedaan. | Niet van toepassing of voldoet |
| 2.5.2 Aanwijzerannulering | (f) | Het controlevenster van de derde is niet onderzocht. | Ja |
| 2.5.3 Label in naam | (b) | Zes paginatypen zijn niet op smal bekeken; de processen zijn niet apart geopend. | Ja |
| 2.5.4 Bewegingsactivering | (f) | De twee vensters van de derde zijn niet geteld. | Niet van toepassing |
| 3.2.2 Bij input | (c) | Alleen het tekstveld van de chat ontbreekt, want daar mocht niet worden getypt. | Ja |
| 3.3.3 Foutsuggestie | (c) | Wat de server na versturen meldt, mocht niet worden getest. | Ja |
| 3.3.8 Toegankelijke authenticatie | (b) | Er is geen proef die plakt in het wachtwoordveld; daarnaast is het inloggen niet verstuurd. | Ja |
| 4.1.3 Statusberichten | (c) | De meldingen na versturen van een formulier of chatbericht zijn niet te zien. | Ja |

Niet zelf gecontroleerd: de inhoud van de video's en het geluidsfragment. Het oordeel "had voldoet moeten zijn" bij 1.2.1 tot en met 1.2.5 en 2.3.1 steunt op de sleutel en op `toolbox/fixtures/README.md`, niet op eigen kijken of luisteren.

## Wat dit zegt over de methode

1. **De schone variant is niet schoon.** Zeven bevindingen wijzen een echte fout aan. Te herstellen in `toolbox/fixtures/src`: drie verschillende galerijbeelden die bij hun alt-tekst passen; een echte kop in het feestblok; een breedtegrens voor de geluidsspeler; ruimte onder de voet zodat de chatknop 'Naar boven' niet bedekt; een chatvenster dat de focus vasthoudt of overal op Escape sluit; een eerlijk doel voor de links onder 'Volg ons'; ruimte tussen de links in het controlekader. Kleiner, maar ook de moeite waard: een kop boven de zoekresultaten, de postcode voor de rekening in het overzicht van stap 3 en de zin over het servicepunt.
2. **Eén oorzaak wordt drie keer afgekeurd.** De chatknop over 'Naar boven' staat onder 2.4.11 (terecht), en nog eens onder 1.4.4 en 1.4.10. De procedures voor vergroten en smal scherm vragen niet of het gebrek op 100% en op breed ook al bestaat. Die vraag hoort erbij, anders kost één gebrek drie criteria.
3. **Vier procedures lezen de norm strenger dan de tekst.** 2.4.4 beoordeelt of de doelpagina levert wat de link belooft en weegt de context van kop en navigatieblok niet mee (bevinding 11 en 12). 2.4.2 eist het zoekwoord in de titel. 3.3.4 telt ontbrekende controle op invoer mee terwijl één van de drie wegen volstaat. 4.1.2 vraagt een toestand bij een knop die geen schakelaar is.
4. **Vensters van derden worden niet consequent behandeld.** Het controlekader is uitgesloten van de steekproef, levert onder 2.5.8 toch een afkeuring en is onder 2.5.2 en 2.5.4 juist de reden voor "kan niet bepalen". Bij 2.1.4 keurt de run de speler af waar de sleutel dat een valkuil noemt. Eén regel is nodig: wat in de pagina staat telt mee en wordt dan ook onderzocht.
5. **Negen van de 14 open criteria zijn op deze site niet te sluiten binnen de regels van de run.** Vijf vragen kijken of luisteren, vier vragen versturen of typen. Alleen de drie onder (b) en de twee onder (f) zijn met meer dekking op te lossen. Voor een testsite met een logboek van verzoeken zou versturen naar de eigen lokale server toegestaan kunnen worden.
