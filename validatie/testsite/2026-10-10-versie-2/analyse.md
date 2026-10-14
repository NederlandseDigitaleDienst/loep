# Analyse van de missers van versie 2 op de testsite

Datum: 10 oktober 2026. Onderzochte run: `toolbox/runs/meting-v2` (code op commit 005c04d). Vergelijking: `toolbox/runs/fixture-v1`.

Paden naar de run zijn geschreven vanaf de map van de run. Paden naar code, prompts en procedures zijn geschreven vanaf de hoofdmap van de repository. Nummers zoals `b-142-0005` zijn waarnemingen: `observations/b-142/0005.json`. Een `b` is de beoordelaar, een `v` de tweede beoordelaar (verificatie), een `r` de rondgang.

Dit is een analyse van bestanden. Er is geen website geopend en de toolbox is niet gedraaid.

## Kort

- Geen van de acht is verloren in het sitemodel. Alle onderdelen stonden erin.
- Twee zijn verloren in de veegronde: de proeven voor toetsen en voor indrukken zien te weinig soorten reacties (2.1.4, 2.5.2).
- Vijf zijn verloren bij de beoordelaar, en steeds door een regel in de procedure die het geval letterlijk naar "kan niet bepalen" stuurt (1.2.2, 1.2.3, 1.2.5, 1.4.2, 4.1.3). De beoordelaar deed wat de procedure zei.
- Eén is verloren omdat een instrument ontbreekt: plakken (3.3.8).
- De tweede beoordelaar heeft nergens iets teruggedraaid of toegevoegd bij deze acht. Bij "kan niet bepalen" herhaalt hij de metingen van de eerste.
- Van de drie "achteruitgangen" is er één echt (1.4.2). Bij 2.1.4 en 3.3.8 vond versie 1 precies hetzelfde als versie 2. Het verschil zit in de vergelijking: die was bij versie 1 milder.

## 1 en 2. De acht gebreken, per fase, met de kleinste verandering

### 1.4.2-melodie (gemist, in versie 1 gevonden)

| Fase | Wat er was |
|---|---|
| Sitemodel | Ja. `site.json`, content `start-geluid`: "Verborgen geluidselement op de startpagina, zonder zichtbare knoppen". |
| Veegronde | Ja. `tasks/1.4.2/dossier.json`: `motion.totals.autoplayMedia` is 1 op P01. De regel van axe-core geeft `cantTell` met de tekst "outputs audio for more than allowed duration and does not have a controls mechanism". |
| Rondgang | Ja. Kandidaat P01-K12: "onzichtbaar audio-element met autoplay en loop, zonder bedieningsknoppen" (`r-start-0043`). Vijf andere beoordelaars gaven dezelfde plek door (X121-01, X122-01, X125-01, X221-01, X222-01, X411-01). |
| Beoordelaar | Hier verloren. Hij mat alles: `b-142-0005` (code: `autoplay`, `loop`, geen `controls`, geen `muted`), `b-142-0007` (vier engines, 0 afgekeurd, 1 onzeker), `b-142-0012` en `b-142-0017` (geen knop voor geluid). Uitkomst `cantTell`, regel R4. |
| Tweede beoordelaar | Herhaalde dezelfde metingen (`v-142-0005`, `v-142-0007`, `v-142-0016`) en liet het open. |

Beslissende zin, `verdicts/1.4.2/oordeel.json`, kandidaat P01-K12: "Geen controle keurt het af (axe-core: onzeker) en geen instrument kan horen of er langer dan drie seconden geluid klinkt. Volgens regel R4 blijft dit een open punt."

De procedure vraagt dit letterlijk. `procedures/1.4.2.md`, R1: alleen een `failed` van een engine geeft een afkeuring. R4 noemt dit geval bij naam als "kan niet bepalen": "media die vanzelf starten, niet gedempt zijn en geen bediening hebben terwijl geen engine er een uitspraak over doet".

Wat versie 1 had. De twee beoordelaars van versie 1 zeiden ook `cantTell` R4 (`verdicts/1.4.2/a.json` en `b.json` in de run van versie 1). De derde ronde maakte er `failed` van. Bevinding: "Geluid op de homepage start vanzelf en is niet te stoppen". De reden staat in `review.challengeNl`: "A en B zeggen beide 'kan niet bepalen'. Ik heb gezocht naar een aanwijsbare fout. Die is er: de code van P01 heeft audio met autoplay en loop zonder controls, en de pagina heeft geen stopknop. Door loop duurt het geluid altijd langer dan drie seconden. Dat staat vast in de code." Het bewijs was de bewaarde code van de pagina, de schermafbeelding en de melding van axe-core. De derde ronde van versie 1 mocht dus zelf redeneren boven de regels uit. De tweede beoordelaar van versie 2 houdt zich aan R4.

Wat niet te bepalen was: of het geluid in de testbrowser echt speelde. `tg motion` telt alleen spelende video (`playingVideo`), geen spelend geluid (`b-142-0016`).

Kleinste verandering:

1. Een instrument dat een audio- of video-element meet: duur, of het na het laden speelt, of de tijd doorloopt, `muted`, volume, `loop`, of er een geluidsspoor is en of dat spoor niet stil is. Bijvoorbeeld `tg media <ref>`, en dezelfde gegevens per element in het dossier. Plek: nieuw instrument naast `toolbox/src/session/commands.ts`, en de extractor voor `inventoryCounts`.
2. Een regel in `procedures/1.4.2.md`: vanzelf starten, niet gedempt, geen `controls`, duur langer dan drie seconden of `loop`, een geluidsspoor dat niet stil is, en geen knop voor pauze, stop of volume op de pagina: `failed`. Een engine is daar niet voor nodig.

Dit geldt algemeen. Het is de testregel van de W3C voor dit criterium, uitgevoerd met een meting in plaats van met luisteren. Let op één ding: een browser kan vanzelf afspelen tegenhouden. De regel moet daarom steunen op de code plus de eigenschappen van het bestand, niet op "het speelde in onze browser".

### 2.1.4-sneltoets (deels, in versie 1 "gevonden")

| Fase | Wat er was |
|---|---|
| Sitemodel | Ja. Onderdeel `chat` en het zoekveld staan erin. Het sitemodel kent geen sneltoetsen, en dat hoeft ook niet. |
| Veegronde | Hier verloren. `tasks/2.1.4/dossier.json`, `singleKeys.keysPressed` bevat de `c`. `singleKeys.reactions` heeft 19 rijen, allemaal de `z`. |
| Rondgang | Geen kandidaat (`tasks/2.1.4/kandidaten.json` is leeg). |
| Beoordelaar | Drukte zelf a, s, /, 1 en ? in op P11 (`b-214-0009` tot en met `b-214-0013`) en k, m, p en f bij de speler. Niet de `c`. Hij zag het gat wel en schreef het op. |
| Tweede beoordelaar | Maakte de `z` na op twee andere pagina's (`v-214-0002`, `v-214-0009`), met de `a` als vergelijking (`v-214-0008`). |

De oorzaak staat in de code van de proef. `toolbox/src/instruments/keys.ts`, functie `firstKeyReaction`, vergelijkt voor en na elke toets alleen het adres, het aantal zichtbare dialogen en het element met focus. De `c` opent het chatvenster zonder de focus te verplaatsen, en het chatvenster is een `div` zonder rol van dialoog. Geen van de drie signalen verandert dus.

Beslissende zin, `verdicts/2.1.4/oordeel.json`, `missingNl`: "veegronde mist: als reactie telt alleen een verplaatste focus, een geopende dialoog of een gewijzigd adres; een knop die van toestand wisselt of een onderdeel dat verschijnt, is niet vastgelegd."

De beoordelaar had het gat kunnen dichten. `tg key` meldt wel wat verschijnt en welke toestand wisselt (`appeared`, `stateChanges`, zie `b-214-0012`). Maar 42 toetsen kosten 42 commando's van een budget van 80, en de procedure vraagt alleen "een paar letters en tekens".

Wat versie 1 had. Hetzelfde. De bevinding van versie 1 luidt "De letter z is een sneltoets die u niet kunt uitzetten" en steunt op `singleKeys.reactions`, 19 rijen, alleen de `z`. De vergelijking van versie 1 schrijft zelf: "De letter c noemt zij niet", en gaf toch de klasse "gevonden". Versie 2 mist hier niets wat versie 1 had.

Kleinste verandering: de proef in `keys.ts` gebruikt dezelfde vergelijking als de commando's van de sessie (tekst die verschijnt of verdwijnt, toestanden die wisselen zoals `aria-expanded`, `hidden` en `disabled`), en begint na elke reactie op een verse pagina. Dat is algemeen: een sneltoets die een paneel opent, een speler pauzeert of een schakelaar omzet zonder de focus te verplaatsen, komt op echte sites veel voor.

### 3.3.8-wachtwoord (deels, in versie 1 "gevonden")

| Fase | Wat er was |
|---|---|
| Sitemodel | Ja. Proces `inlogformulier`. |
| Veegronde | Deels. `forms` heeft de velden en `autocomplete`. Of plakken werkt, is niet gemeten. De procedure noemt dat zelf onder "Wat de veegronde moet leveren": "een proef die plakt en de waarde terugleest ... Nieuw". |
| Rondgang | Ja. Kandidaat P05-K11: "Het wachtwoordveld heeft onpaste=\"return false\" en autocomplete=\"off\"" (`r-inloggen-0030`). |
| Beoordelaar | Hier verloren, door een ontbrekend instrument. Hij las de code (`b-338-0005`) en zette de kandidaat op "open". |
| Tweede beoordelaar | Las dezelfde code (`v-338-0008`) en nam de uitspraak woordelijk over. |

Beslissende zin, `verdicts/3.3.8/oordeel.json`, kandidaat P05-K11: "Of plakken en invullen door een wachtwoordmanager echt worden geweigerd, kan geen instrument meten." De procedure zegt het ook: `procedures/3.3.8.md`, N2: "Staat er `onpaste` in de code van een wachtwoord- of codeveld: noem het in `summaryNl` en `missingNl`; of plakken echt wordt geweigerd, is niet te meten."

Wat versie 1 had. Minder. De bevinding van versie 1 noemt alleen het geheime woord. Over plakken schrijft versie 1: "Niet gemeten: of plakken werkt in de 3 velden". De vergelijking van versie 1 schrijft: "Het blokkeren van plakken is niet gemeten", en gaf toch "gevonden". Versie 2 zag de `onpaste` in de code wel en versie 1 niet.

Kleinste verandering: een instrument `tg paste <ref> <tekst>` dat echt plakt (klembord vullen, plaktoets indrukken) en de waarde terugleest, en een regel in `procedures/3.3.8.md`: plakken in een wachtwoord- of codeveld verandert de waarde niet, en er is geen andere manier van inloggen: `failed`. Dat is algemeen. Een `onpaste` in de code alleen is geen goed bewijs, want een handler kan ook iets anders doen dan weigeren. De proef beslist.

### 2.5.2-feedback (gemist)

| Fase | Wat er was |
|---|---|
| Sitemodel | Ja. Onderdeel `faq-oordeel`: "Oordeel Ja of Nee onder de vragen; na Ja verschijnt een bedankje". |
| Veegronde | Hier verloren. `tasks/2.5.2/dossier.json`: `pointer.gestureListeners` noemt `pointerdown` op een knop op P14. Maar `pointer.downEventProbe` zegt: 26 onderdelen geprobeerd, `actedOnDown` leeg, `noReaction` 26. |
| Rondgang | Geen kandidaat. De rondgang heeft geen commando om in te drukken zonder los te laten. |
| Beoordelaar | Zag het gat en beschreef het precies. Geen instrument om het te dichten. Uitkomst `cantTell`, regel R6. |
| Tweede beoordelaar | Klikte opnieuw op Ja (`v-252-0011`) en liet het open. |

De oorzaak staat weer in de code van de proef. `toolbox/src/instruments/pointer.ts`, functie `probeDownEvent`, drukt echt in, schuift weg en laat elders los. Maar de vergelijking kijkt alleen naar het adres, het aantal dialogen en het aantal elementen met `aria-expanded="true"`. Het bedankje dat verschijnt en de knoppen die uitgaan, ziet zij niet. De proef heeft het gebrek dus uitgevoerd en niet opgemerkt.

Beslissende zinnen, `verdicts/2.5.2/oordeel.json`: "De proef legt alleen een ander adres, een dialoog en een uitklapper vast. Een bedankje, een schuif die verspringt of een andere foto ziet zij niet." En in de samenvatting: "Alles wijst erop dat Ja en Nee al bij indrukken reageren."

De beoordelaar had genoeg feiten voor een sluitende redenering, maar geen regel die haar toestaat: Enter op de knop doet niets (`b-252-0008`), een muisklik wel (`b-252-0011`), er zijn twee luisteraars voor indrukken en geen voor loslaten. Een gewone knop die niet op Enter reageert, hangt niet aan `click`.

Kleinste verandering: de proef in `pointer.ts` gebruikt dezelfde vergelijking als de sessie (wat verschijnt, wat verdwijnt, welke toestand wisselt) en begint na een reactie op een verse pagina. Dan staat deze knop in `actedOnDown` en geldt R1 van de procedure zoals hij nu is. Dat is algemeen. Daarnaast, kleiner van belang: `tg press <ref>` en `tg release` in de sessie, zodat een beoordelaar het zelf kan namaken en de tweede beoordelaar ook.

### 4.1.3-chat (gemist)

| Fase | Wat er was |
|---|---|
| Sitemodel | Ja. Onderdeel `chat`, op alle paginatypen, met recept `component-chat`. |
| Veegronde | Deels. Het dossier telt 0 gebieden die vanzelf worden voorgelezen, op 20 pagina's. De toestand met de chat open is bewaard. Een nieuw bericht is niet opgeroepen. |
| Rondgang | Ja, 13 kandidaten voor dezelfde plek. P01-K23: "Het vak waarin chatberichten verschijnen heeft geen live-regio of rol" (`r-start-0101`). |
| Beoordelaar | Hier verloren. Hij zag het vak zonder rol (`b-413-0050`) en 0 voorleesgebieden met de chat open (`b-413-0051`). Alle kandidaten op "open". |
| Tweede beoordelaar | Keek opnieuw op een andere pagina (`v-413-0043`, `v-413-0046`) en liet alles open. |

Beslissende zin, `verdicts/4.1.3/oordeel.json`, kandidaat P01-K23: "Een nieuw bericht is niet opgeroepen, want typen in de chat mag niet." Twee teksten sturen hierheen. `templates/beoordeel.md`, regel 13: "In een chatvenster typ je nooit iets." En `procedures/4.1.3.md`, R4: "een chat of ander venster toont meldingen pas na een verstuurd bericht terwijl de run niet mag versturen".

Het bewijs lag er al. De klik die de chat opent, meldt zelf dat er een bericht bijkwam zonder voorleesgebied: `b-413-0049` heeft `appeared` met "Welkom bij de chat van de gemeente. Waarmee kunnen wij u helpen?" en `liveRegionMessages` leeg, terwijl de focus in het invoerveld staat. In de code van de pagina is het vak leeg; het welkomstbericht komt dus na het openen binnen. De beoordelaar zette dat weg bij kandidaat P15-K26: "Het welkomstbericht verschijnt bij het openen en de focus gaat dan het venster in (gezien op P01); dat is geen statusmelding."

Kleinste verandering, in `procedures/4.1.3.md`:

1. Een bericht dat in een chat of logboek bijkomt terwijl de focus ergens anders staat, is een statusmelding. Dat geldt ook voor een welkomstbericht dat na het openen binnenkomt.
2. Een regel: het vak met berichten en zijn ouders hebben geen rol `log`, `status` of `alert` en geen `aria-live`, de pagina heeft met de chat open nergens zo'n gebied, en de focus gaat niet naar het bericht: `failed`. De melding "bericht niet gezien" hoort dan bij de beperkingen, niet bij de uitkomst.

Dat is algemeen: zonder voorleesgebied in de hele pagina kan een nieuw bericht niet worden gemeld. Typen in de chat is hiervoor niet nodig. Ik raad niet aan om het verbod op typen op te heffen. Het gereedschap houdt alles tegen behalve GET en HEAD, maar een chat van een leverancier kan "bezoeker typt" ook met een GET versturen.

### 1.2.2-ondertitels, 1.2.3-beschrijving, 1.2.5-audiodescriptie (gemist)

Deze drie horen bij dezelfde video op de pagina Raadsvergadering en zijn op dezelfde plek verloren.

| Fase | Wat er was |
|---|---|
| Sitemodel | Ja. Content `raadsvideo`: "Video met de samenvatting van de raadsvergadering, met de knoppen van de browser". |
| Veegronde | Deels. Het dossier telt 1 video en 0 sporen (`track`). Per video staat er niets: geen attributen, geen duur, niet of er geluid in zit. De beoordelaars schrijven dat zelf op in `missingNl` ("veegronde mist: per audio- en video-element de pagina en de attributen ..."). |
| Rondgang | Ja. P12-K01 (1.2.2): geen `track`, geen uitgeschreven tekst (`r-raadsvergadering-0021`). P12-K02 (1.2.5): "In het videobeeld staat tekst ... 'Begroting aangenomen: 14 voor, 5 tegen'; de video is niet afgespeeld, dus of het geluid dit noemt is niet bekeken" (`r-raadsvergadering-0122`). Voor 1.2.3 kwam er geen kandidaat uit de rondgang, wel één van de beoordelaar van 1.4.5 (X145-01). |
| Beoordelaar | Hier verloren, en met opzet van de procedure. Alle drie `cantTell`, regel R2. |
| Tweede beoordelaar | Herhaalde de metingen op dezelfde pagina's (overlap met de beoordelaar 93 tot 98 procent van de commando's) en liet alles open. |

Beslissende zin, in alle drie de procedures (`procedures/1.2.2.md`, `1.2.3.md`, `1.2.5.md`), boven de beslisregels: "Er wordt niets beluisterd of bekeken. ... Daarom is er geen regel die tot `failed` of `passed` leidt."

De beoordelaars hebben alles gemeten wat er te meten viel:

- 1.2.2: geluidsknop, niet gedempt, 0 sporen, geen knop voor ondertitels, geen tekstversie (`b-122-0008`, `b-122-0004`, `b-122-0012`, `b-122-0006`). Uitspraak bij P12-K01: "Dat is geen bewijs van een fout: ondertitels kunnen in het beeld staan of de video kan zonder spraak zijn. Een mens moet de video afspelen."
- 1.2.3 en 1.2.5: de tekst in het stilstaande beeld is gelezen, namelijk de agenda en de uitslag (`b-123-0013`, `b-125-0009`, `b-125-0013`). Uitspraak bij P12-K02: "Of de stem deze tekst noemt, is alleen door afspelen en luisteren vast te stellen."

Er ontbreekt dus steeds precies één feit: wat er te horen is. Versie 1 vond deze drie ook niet.

Kleinste verandering die ze gevonden zou hebben: een instrument dat het geluid van een video omzet in tekst (spraakherkenning op de eigen machine) en op vaste momenten een beeld van de spelende video vastlegt. Het gereedschap kan al tekst uit een beeld lezen (`tg ocr`). Daarmee worden drie regels mogelijk:

- 1.2.2: er is spraak, geen spoor met ondertitels, geen knop voor ondertitels, en in de vastgelegde beelden staat geen tekst die met de spraak meeloopt: `failed`.
- 1.2.3 en 1.2.5: in beeld staat tekst die informatie geeft (hier de agenda en de stemuitslag), die tekst komt niet voor in de uitgeschreven spraak, en er is geen spoor met beschrijvingen, geen tweede versie en (voor 1.2.3) geen tekstversie: `failed`.

Dit is algemeen, maar het is de grootste verandering van de acht en ze heeft een grens die erbij gezegd moet worden. Tekst in beeld die niet wordt uitgesproken, is te meten. Handelingen in beeld zonder tekst (iemand wijst iets aan, een kaart beweegt) blijven een vraag voor een mens. Voor zulke video's blijft "kan niet bepalen" het eerlijke antwoord.

Een tussenstap die weinig kost en niets vindt, maar het open punt scherper maakt: meet of de video een geluidsspoor heeft dat niet stil is. Dan vervalt de twijfel "de video kan zonder geluid zijn".

### Overzicht

| Gebrek | Verloren in | Waardoor | Kleinste verandering | Algemeen? |
|---|---|---|---|---|
| 1.2.2-ondertitels | beoordelaar | procedure heeft geen regel naar `failed` | spraak naar tekst, beelden van de spelende video, regel | ja |
| 1.2.3-beschrijving | beoordelaar | idem | idem, tekst in beeld naast uitgeschreven spraak | ja, voor tekst in beeld |
| 1.2.5-audiodescriptie | beoordelaar | idem | idem | ja, voor tekst in beeld |
| 1.4.2-melodie | beoordelaar | R1 eist een engine, R4 noemt dit geval | meting per media-element en regel zonder engine | ja |
| 2.1.4-sneltoets (c) | veegronde | proef ziet alleen focus, dialoog en adres | brede vergelijking in `keys.ts` | ja |
| 2.5.2-feedback | veegronde | proef ziet alleen adres, dialoog en uitklapper | brede vergelijking in `pointer.ts` | ja |
| 3.3.8-wachtwoord (plakken) | beoordelaar | geen instrument dat plakt | `tg paste` en regel | ja |
| 4.1.3-chat | beoordelaar | "typ nooit in een chat" plus R4 | regel voor berichtenvak zonder voorleesgebied | ja |

Geen van deze veranderingen past alleen op de testsite.

### Over de drie achteruitgangen

- 1.4.2 is een echte achteruitgang. Versie 1 vond het in de derde ronde, door te redeneren vanuit de code. Versie 2 heeft die ruimte niet: `templates/verifieer.md`, regel 63: "Zei de beoordelaar `failed` of `cantTell`, dan val je niets aan".
- 2.1.4 en 3.3.8 zijn geen achteruitgang van het gereedschap. De bevindingen van versie 1 hadden dezelfde inhoud (alleen de `z`; plakken niet gemeten). De opdracht voor de vergelijking is in beide runs gelijk (`compare/opdracht-a.md`, de omschrijving van `deels`), maar de vergelijking van versie 1 koos "gevonden" waar die van versie 2 "deels" kiest. Met de maat van versie 2 had versie 1 er hooguit 51 gevonden, niet 53. De andere 51 heb ik niet nagelopen.

## 3. De twee criteria die "niet van toepassing" hadden moeten zijn

### 2.5.4 Bediening door beweging

Het dossier is duidelijk: `pointer.motionListeners` is leeg op 20 pagina's. De steekproef van de beoordelaar gaf niets (`b-254-0003`, `b-254-0014`, `b-254-0024`, `b-254-0027`, `b-254-0030`). Toch `cantTell`, regel R3, om twee ingesloten vensters:

- het venster "Controle: bent u een mens?" (`controle.html`), van een derde, niet in de legenda;
- de speler op P07 (`speler.html?film=stalling`). In de legenda staat alleen de speler van P12 (`film=raad`) als P20.

Beslissende zin, `verdicts/2.5.4/oordeel.json`: "Het adres (127.0.0.1:4732/controle.html) staat niet als pagina in de legenda. De luisteraars in dit venster zijn dus niet geteld. Het is van een derde en wordt niet los geopend." De procedure vraagt dit: `procedures/2.5.4.md`, N1: "Biedt het inhoud of een functie aan de bezoeker ... en is het van een derde buiten de reikwijdte, dan wordt het niet geopend: een open punt met het adres." En R2 eist dat elk venster in de legenda staat of niet meetelt.

Het gevolg is groter dan deze site: elke site met een zichtbaar venster van een derde (een controle tegen robots, een kaart, een video) kan zo nooit "niet van toepassing" krijgen.

Wat het laat sluiten zonder risico:

1. Tel de luisteraars voor beweging in elk venster op de pagina waar het staat, ook in vensters van een derde. Dat is alleen meekijken: er wordt niets geopend en niets bediend. Het script dat de luisteraars telt, wordt al in elke pagina geladen; de telling moet per venster worden uitgelezen en bij de pagina worden opgeslagen. Plek: de extractor `pointer.motionListeners` in `toolbox/src/lib/extractors.ts` en de veegronde.
2. Laat de legenda bij een ingesloten pagina alle adressen noemen die ervoor meetellen (hier beide films van dezelfde speler). Plek: `toolbox/src/commands/sample.ts`.
3. Pas R2 aan: elk venster is geteld op zijn eigen plek, met nul luisteraars.

Wat dan overblijft, hoort in de beperkingen en niet in de uitkomst: de sensor-API van de browser, een luisteraar die pas na een handeling wordt gezet, en herkenning via de camera. De kans op een valse "niet van toepassing" wordt hierdoor niet groter dan nu voor de pagina's van de site zelf.

### 2.3.1 Flitsen

Uitkomst `cantTell`, regel R4, om de drie video's. Beslissende zin, `verdicts/2.3.1/oordeel.json`: "Het instrument geeft geen flitsfrequentie." De beoordelaar heeft de video gestart en gemeten (`b-231-0041`: 1 spelende video, 3 van 5 beeldparen veranderd), maar `tg motion` vergelijkt vijf beeldparen in zes seconden. Daarmee is een flits niet te tellen. De procedure zegt: "Een `failed` vraagt een gemeten flitsfrequentie", en R2 (goedkeuring) sluit video uit: "er is geen video (ook niet in een speler van een derde partij)".

"Niet van toepassing" is hier ook in het algemeen niet de juiste uitkomst. De site heeft video, dus er is content die kan flitsen. De sleutel staat `passed` ook toe. Dat is de uitkomst waar het gereedschap naartoe moet kunnen.

Wat het laat sluiten:

1. Een flitsmeting: beelden van de spelende video met minstens 25 beelden per seconde, per paar de wissel in helderheid en de grootte van het vlak, geteld per seconde. Voor een eigen videobestand kan het ook op het bestand zelf. Plek: `tg motion` of een nieuw instrument, en R1 en R2 van `procedures/2.3.1.md`.
2. R2 mag dan een video goedkeuren die helemaal is gemeten en nergens boven drie flitsen per seconde komt.
3. Een goedkope zijweg: een video met minder dan zes beelden per seconde kan niet vaker dan drie keer per seconde flitsen. De video van de testsite heeft er twee. Dat is te lezen uit het bestand.

Het risico zit in lange video's en in spelers van een derde. Een opname van twee uur meet je niet helemaal. Daar hoort de uitkomst `cantTell` te blijven, met erbij welk deel is gemeten. Een goedkeuring op een steekproef uit een lange video is een valse goedkeuring.

## 4. De eigen bevindingen die "discutabel" zijn

Vergelijking A noemt er 9 discutabel, vergelijking B 8. Ze zijn het eens over 8. Alleen over GEME-1.3.1-5dfd (titel van de cookiemelding) verschillen ze: A discutabel, B terecht.

| Oorzaak | Aantal | Welke |
|---|---|---|
| Strenge lezing van het criterium | 6 (B: 5) | GEME-1.3.1-5a6a, 1.3.1-9707, 1.3.1-5dfd, 2.4.2-e32d, 2.4.4-2853, 1.4.10-ba67 |
| Gevolg van een gebrek dat al onder een ander criterium is gemeld | 2 | GEME-2.4.11-3b31, 2.4.3-5294 |
| Echt, maar het hoort niet bij dit criterium en de sleutel noemt het niet | 1 | GEME-2.4.4-db75 |
| Dubbel dat de samenvoeging had moeten samennemen | 0 | geen |

Strenge lezing, twee voorbeelden:

- GEME-1.3.1-5a6a, "Rijen kaarten zijn geen lijst". De procedure vraagt hierom. `procedures/1.3.1.md`, R3: "Een rij gelijksoortige kaarten die geen lijst is, valt hieronder. Heeft elke kaart een eigen kop, dan is dat de zwakste vorm van deze bevinding". De beoordelaar volgde de regel en gaf ernst "laag".
- GEME-2.4.2-e32d, "Zoekresultaten hebben altijd dezelfde titel". Ook hier vraagt de procedure erom. `procedures/2.4.2.md`, valkuilen: "Dezelfde titel op pagina 1 en pagina 2 van een lijst, of op een overzicht met een ander filter, is een fout onder R3".

De andere vier in deze groep hebben dezelfde bron. GEME-1.3.1-9707 komt uit de lijst `headingsWithoutContent` van de veegronde, die een kop per zoekresultaat aanwijst. GEME-2.4.4-2853 komt uit R3 van `procedures/2.4.4.md`: "Een kop boven elke link telt hier niet als context; rust de bevinding alleen daarop, geef haar dan de ernst `laag`". GEME-1.4.10-ba67 (4 pixels schuiven) komt uit R1 van `procedures/1.4.10.md`, die geen ondergrens kent. De hele groep is dus door procedures aangemoedigd, niet door een losse beoordelaar bedacht.

Gevolg van een ander gebrek, de twee gevallen:

- GEME-2.4.11-3b31: een link ligt onder het chatvenster dat de bezoeker zelf opende, en het toetsenbord zit daar al vast (gemeld onder 2.1.2). `procedures/2.4.11.md` noemt een chatvenster uitdrukkelijk als content die de focus kan bedekken, en maakt geen verschil met content die de gebruiker zelf opent.
- GEME-2.4.3-5294: de focus springt na een klik op Ja. De knoppen werken niet met het toetsenbord (gemeld onder 2.1.1), dus een toetsenbordgebruiker komt hier niet. Geen procedure moedigt dit aan; `templates/beoordeel.md` punt 12 zegt wel dat je doorgeeft wat bij een ander criterium hoort, maar niet dat je een gevolg van een al gemeld gebrek laat liggen.

Echt maar verkeerd criterium: GEME-2.4.4-db75, de link belooft openingstijden van het servicepunt en de pagina noemt het servicepunt niet. `procedures/2.4.4.md`, stap 3, vraagt te zoeken naar "namen die iets anders beloven dan de bestemming". De linktekst is duidelijk; wat ontbreekt is inhoud op de bestemming.

Dubbelen: bij de discutabele bevindingen zit er geen. Wel staan GEME-1.3.5-6661 en GEME-1.3.5-6661-2 (straat en postcode in stap 2 van de vergunning) als twee bevindingen in de lijst. Beide zijn "terecht". De samenvoeging heeft niet gedraaid: `evaluation.json`, `merge.proposal.status` is "not-run".

Wat helpt: zes van de negen verdwijnen of worden een opmerking als de vier procedures hierboven een ondergrens krijgen (kaarten met een eigen kop, een kop per zoekresultaat, een zoekwoord in de titel, een paar pixels schuiven). Dat is een keuze over strengheid, geen fout in het meten: in geen van de negen klopt de meting niet.

## 5. Heeft de tweede beoordelaar echt opnieuw gemeten?

Getallen over alle 56 criteria (`verdicts/<criterium>/oordeel.json` naast `final.json`):

- 113 bevindingen van de beoordelaar, 113 nagemaakt, 0 vervallen, 1 toegevoegd, 0 uitkomsten veranderd.
- In de bevindingen van het eindoordeel staan 567 verwijzingen naar waarnemingen. Alle 567 zijn van de tweede beoordelaar zelf, geen enkele van de eerste.
- 30 van de 113 bevindingen zijn nagemaakt op andere pagina's dan de eerste noemde. De rest staat op één pagina of in een onderdeel dat overal gelijk is.

Tien oordelen bekeken:

| Criterium | Wat de tweede deed | Oordeel |
|---|---|---|
| 2.1.4 | De `z` op P05 en P13 in plaats van P01 en P11 (`v-214-0002`, `v-214-0009`), met de `a` als tegenproef (`v-214-0008`). Geen enkel commando gelijk aan de eerste. Schrapte de bewering over het productvenster omdat hij die niet zelf mat. | onafhankelijk |
| 4.1.2 | Pictogramlinks in de voet op P09 in plaats van P02 (`v-412-0009` tot en met `v-412-0011` tegenover `b-412-0027` tot en met `b-412-0029`). Knop Aanpassen op P03 in plaats van P01 (`v-412-0037`). 26 procent van de commando's gelijk. | onafhankelijk |
| 1.4.10 | Cookieknop buiten beeld op P02 en P10 in plaats van P01 en P11 (`v-1410-0005`, `v-1410-0009`). | onafhankelijk |
| 1.1.1 | Menuknop zonder naam op P03 op 320 pixels, de eerste mat op P01 op 360 pixels (`v-111-0073` tegenover `b-111-0082`). | onafhankelijk |
| 2.1.1 | Maakte alle zeven na en voegde er één toe: de knoppen Ja en Nee werken niet met het toetsenbord (V1, `v-211-0101` tot en met `v-211-0108`). De eerste zat aan zijn budget (80 van 80). | onafhankelijk, en vond meer |
| 2.4.7 | Menulinks zonder zichtbare focus ook op P07 en P17 (`v-247-0035`, `v-247-0056`). | onafhankelijk, breder |
| 1.4.3 | Verse pagina, maar vooral dezelfde elementen: `v-143-0009` is dezelfde alinea als `b-143-0008` (2,61), `v-143-0017` dezelfde als `b-143-0058`, `v-143-0021` dezelfde als `b-143-0064`. Eén andere menulink (`v-143-0011`). | opnieuw gemeten, niet elders |
| 2.5.8 | Dezelfde drie paginalinks als de eerste (`v-258-0003` tot en met `v-258-0005` tegenover `b-258-0004` tot en met `b-258-0006`). Daarna dezelfde twee vakjes van de cookiemelding op twaalf pagina's (`v-258-0023` tot en met `v-258-0092`). | opnieuw gemeten, breedte zonder nieuws |
| 3.3.8 | Eén pagina, dezelfde code gelezen (`v-338-0008` tegenover `b-338-0005`). De uitspraak over plakken is woordelijk overgenomen. | herhaling |
| 1.4.2 | Dezelfde code en dezelfde regels (`v-142-0005`, `v-142-0007` tegenover `b-142-0005`, `b-142-0007`). 90 procent van de commando's gelijk. | herhaling |

Bij de goedkeuringen deed de tweede wat de opdracht vraagt. Bij 2.4.5 zocht hij op plekken waar de eerste niet keek: een nieuwsbericht in een submap, de inlogpagina op 320 pixels met het menu open, het donkere schema met de cookiemelding (`v-245-0007`, `v-245-0016`, `v-245-0021`, `v-245-0030`).

Mijn oordeel:

- Bij afkeuringen is de tweede beoordelaar echt onafhankelijk. Hij begint op een verse pagina, zoekt de plek zelf en kiest waar het kan een andere pagina. Dat er niets verviel, komt in deze run niet door meelopen: de metingen kloppen (de vergelijking vond ook geen enkele "onterechte" bevinding).
- Zijn tweede en derde toets ("hoort ze bij dit criterium", "dekt de norm haar") hebben niets tegengehouden. Alle negen discutabele bevindingen kwamen erdoor. Hij toetst of de meting klopt, niet of de regel te streng is. Dat kan ook niet anders zolang de procedure zelf de strenge lezing voorschrijft.
- Bij "kan niet bepalen" is hij geen tweede mening. Hij herhaalt de commando's van de eerste: 1.2.2 voor 93 procent, 1.2.3 98, 1.2.5 97, 1.4.2 90, 2.3.1 100, 2.5.4 76. Dat volgt uit de opdracht: `templates/verifieer.md` regel 63 zegt dat hij bij `cantTell` niets aanvalt. Juist daar zaten vijf van de acht missers.

## 6. Kosten

Er zijn twee tellingen. Het budget telt alleen betaalde commando's; `find`, `status`, `state list`, `tools` en `wait` zijn gratis. De map met waarnemingen telt alles.

| | Sessies | Waarnemingen | Betaald | `open` | Meten en lezen | Kijken (`look`, `crop`, `ocr`) | Handelen |
|---|---|---|---|---|---|---|---|
| Beoordelaars | 56 | 3598 | 2408 | 589, waarvan 117 met een toestand | 2008, waarvan 1093 keer `find` | 544 | 1046 (met `open`) |
| Tweede beoordelaars | 56 | 2934 | 1662 | 412, waarvan 34 met een toestand | 1879, waarvan 1191 keer `find` | 297 | 758 (met `open`) |
| Rondgang | 15 | 1885 | niet uitgezocht | 158 | 1214 | 253 | 418 |

Een kwart van de betaalde commando's is `open`. Ruim een derde van alle waarnemingen is `find`.

Zeven beoordelaars eindigden op hun budget van 80: 1.4.3, 1.4.11, 2.1.1, 2.1.2, 2.4.11, 2.5.8 en 4.1.2 (79 of 80).

De drie criteria met de meeste commando's, beoordelaar en tweede samen:

| Criterium | Waarnemingen | Betaald | Waaraan |
|---|---|---|---|
| 1.2.4 Ondertiteling live | 490 | 74 | 413 keer `find`: twaalf zoektermen (video, audio, iframe, "livestream", "uitzending", "webinar", "live", "rechtstreeks" en meer) op elke pagina, door beide beoordelaars. Uitkomst: niet van toepassing, geen bevinding. |
| 2.1.1 Toetsenbord | 250 | 181 | Focus zetten, toets indrukken, klikken en teruglezen, per onderdeel. Acht bevindingen. |
| 4.1.2 Naam, rol, waarde | 244 | 184 | `ax` en `name` per bedieningselement, klikken om de toestand te zien. Vijftien bevindingen. |

Naar betaalde commando's is de volgorde 4.1.2 (184), 2.1.1 (181) en 1.4.10 (156, vooral `look` en `scroll` op 320 pixels).

Bij 2.1.1 en 4.1.2 is het geld goed besteed: veel commando's, veel bevindingen. Wat op verspilling lijkt:

1. De vijf mediacriteria (1.2.1 tot en met 1.2.5) gebruikten samen 881 waarnemingen, 13 procent van alle waarnemingen van beoordelaars en tweede beoordelaars. Elk van de tien sessies zocht dezelfde drie media-elementen en dezelfde vier vensters opnieuw op. Vier van de vijf eindigen zonder bevinding. Eén lijst in het dossier, per element en per toestand, vervangt dit. De procedures vragen er zelf om ("veegronde mist").
2. `find` is gratis en wordt gebruikt als veegronde: zoeken op een woord op elke pagina. De tekst van elke pagina staat al in de run. Een zoekopdracht over de bewaarde pagina's in één commando, of de uitkomst in het dossier, haalt hier honderden commando's weg.
3. De tweede beoordelaar bij `cantTell`: ongeveer 210 waarnemingen (1.2.2, 1.2.3, 1.2.5, 1.4.2, 2.3.1, 2.5.2, 2.5.4) die de eerste herhalen en niets veranderen.
4. Hetzelfde onderdeel op veel pagina's meten: 24 metingen van dezelfde twee vakjes bij 2.5.8.
5. Herhalingen binnen één sessie: 118 keer bij de beoordelaars en 102 keer bij de tweede is hetzelfde lees- of meetcommando op dezelfde plek uitgevoerd terwijl de pagina niet was veranderd.

In 36 van de 56 eindoordelen staat minstens één regel "veegronde mist", samen 78 regels. Dat is de lijst van wat beoordelaars nu zelf moeten ophalen.

## 7. Wat te veranderen, belangrijkste eerst

1. Laat de proeven voor toetsen en voor indrukken dezelfde brede vergelijking gebruiken als de commando's van de sessie (wat verschijnt, wat verdwijnt, welke toestand wisselt) en na elke reactie opnieuw beginnen op een verse pagina. Plek: `toolbox/src/instruments/keys.ts` en `pointer.ts`. Vindt 2.1.4 (de c) en 2.5.2.
2. Meet elk audio- en video-element (duur, speelt het, gedempt, herhaling, geluidsspoor dat niet stil is) en geef 1.4.2 een regel die zonder engine tot een afkeuring komt. Plek: nieuw instrument, de extractor voor `inventoryCounts`, `procedures/1.4.2.md`. Vindt 1.4.2.
3. Geef het gereedschap oren voor video: spraak naar tekst en beelden van de spelende video, met regels voor ontbrekende ondertitels en voor tekst in beeld die niet wordt uitgesproken. Plek: nieuw instrument, `procedures/1.2.2.md`, `1.2.3.md` en `1.2.5.md`. Vindt drie gebreken en haalt drie criteria uit het vaste "kan niet bepalen" op elke site met video.
4. Voeg instrumenten toe voor plakken en voor indrukken zonder loslaten, met een regel voor geweigerd plakken in 3.3.8. Plek: `toolbox/src/session/commands.ts`, `procedures/3.3.8.md` en `2.5.2.md`. Vindt de rest van 3.3.8.
5. Geef 4.1.3 een regel voor een chat of logboek: een bericht dat bijkomt zonder voorleesgebied op de pagina en zonder focus is een afkeuring, ook als het een welkomstbericht is. Plek: `procedures/4.1.3.md`. Vindt 4.1.3-chat zonder in de chat te typen.
6. Laat de tweede beoordelaar een "kan niet bepalen" aanvallen: welk feit ontbreekt er precies, en staat dat feit niet al vast in de code of in een meting. Plek: `templates/verifieer.md`, regel 63 en de tabel eronder. Dit is wat versie 1 bij 1.4.2 wel deed.
7. Tel luisteraars en media per ingesloten venster op de pagina waar het staat, ook bij een derde, en noem in de legenda alle adressen van één ingesloten pagina. Plek: `toolbox/src/lib/extractors.ts`, `toolbox/src/commands/sample.ts`, `procedures/2.5.4.md` R2. Laat 2.5.4 sluiten.
8. Voeg een flitsmeting toe en laat 2.3.1 een helemaal gemeten video goedkeuren. Plek: `tg motion`, `procedures/2.3.1.md` R1 en R2. Laat 2.3.1 sluiten op korte video's.
9. Zet één medialijst in het dossier voor 1.2.1 tot en met 1.2.5, 1.4.2 en 2.3.1, en een zoekopdracht over de bewaarde tekst van alle pagina's. Plek: de veegronde en de extractors. Bespaart ongeveer een achtste van de commando's.
10. Geef vier procedures een ondergrens (kaarten met een eigen kop, een kop per zoekresultaat, een zoekwoord in de titel, een paar pixels schuiven) en zeg in `templates/beoordeel.md` dat een gevolg van een al gemeld gebrek geen eigen bevinding is. Plek: `procedures/1.3.1.md`, `2.4.2.md`, `2.4.4.md`, `1.4.10.md`, `2.4.11.md`. Haalt zes tot acht van de negen discutabele bevindingen weg.

Los van het gereedschap: de vergelijking met de sleutel is tussen de twee runs niet even streng geweest. Wie versie 1 en versie 2 naast elkaar legt, moet de klasse "deels" in beide op dezelfde manier toepassen.

## Wat ik niet kon vaststellen

- Of het geluid op de startpagina in de testbrowser echt speelde. Geen waarneming meet dat.
- Of de video op de pagina Raadsvergadering spraak bevat. Uit het bestand in de testsite blijkt alleen dat er een geluidsspoor is; de run zelf heeft dat niet gemeten.
- Hoeveel betaalde commando's de rondgang gebruikte en hoe de 188 commando's van de verkenner zijn verdeeld. Dat is niet uitgezocht.
- Waarom de vergelijking van versie 1 milder was. De opdracht is gelijk; het verschil zit in de uitvoering.
- Of de voorgestelde regels op echte sites tot valse afkeuringen leiden. Dat vraagt een run op een andere site dan de testsite.
