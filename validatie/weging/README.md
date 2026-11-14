# Meting van de weegstap

De weegstap (`weigh`, `check-weigh`, opdracht `templates/weeg.md`) legt per bevinding vast welke groepen bezoekers ze hindert, wat er voor elke groep gebeurt en of bezoekers dit deel nodig hebben voor een kerntaak. De ernst volgt daar met een vaste tabel uit. Zie [docs/methode.md](../../docs/methode.md#ernst-en-eigenaar-van-een-bevinding).

Dit verslag zegt wat er op 14 november 2026 is gemeten, in acht ronden, en wat niet. Ronde 8 draaide op de opdracht zoals ze is uitgebracht.

## Wat is gemeten en wat niet

Gemeten is **herhaalbaarheid**: komt de ernst gelijk uit als de stap vaker draait?

- **Dezelfde evaluatie, drie keer.** Drie agents wegen los van elkaar de 111 bevindingen (105 gebreken) van één bestaand onderzoek van een grote site van de rijksoverheid. Elk paar wordt vergeleken.
- **Twee onderzoeken van de testsite.** De twee runs van Lindewaard uit de meting van 0.25.0 (L1 en L2, zie [testsite/2026-11-10-meting-0.25.0](../testsite/2026-11-10-meting-0.25.0/uitkomst.md)) zijn elk één keer gewogen. Per gebrek uit de sleutel (79) is de ernst in L1 en L2 vergeleken, via de koppeling van vergelijker A. De beoordelaars schreven in die twee runs hun bevindingen in andere woorden, dus dit meet de stap op andere invoer over hetzelfde gebrek. De maat is de ernst die de beoordelaars zelf gaven: bij 63 van de 79 gelijk, bij 16 één trede verschil. De beoordelaars gaven geen van deze 79 gebreken de ernst blokkerend, dus hun "nooit twee treden" geldt op drie treden.
- **Vier andere bestaande onderzoeken** van sites van de overheid (27 tot 83 bevindingen), vanaf ronde 4 elke ronde één keer gewogen.
- **Vier achtergehouden onderzoeken**, alleen in ronde 8. Dit zijn bestaande onderzoeken van vier andere sites (48 tot 98 bevindingen) die bij het afstellen van de opdracht niet zijn bekeken. Ze zijn elk twee keer gewogen, na het vastleggen van de opdracht.

**Niet gemeten is of de ernst juist is.** Er is geen sleutel met de juiste ernst, en geen deskundige of gebruiker van hulpsoftware heeft de wegingen, de beschrijving van de groepen of de vaste gevallen in de opdracht nagelopen. Dat een tweede beoordeling door een taalmodel op dezelfde volgorde uitkomt, is geen toets: beide kunnen dezelfde blinde vlek hebben.

**De opdracht is afgesteld op de evaluaties waarop ze is gemeten.** Het eerste onderzoek, de testsite en de vier andere onderzoeken zijn na elke ronde bekeken, en daarna is de opdracht bijgesteld. De gelijke bovenkant op het eerste onderzoek komt vooral uit vaste gevallen die naar aanleiding van die bevindingen zijn geschreven: vijf van de zes blokkerende bevindingen daar zijn formulieren in pdf. Alleen de vier achtergehouden onderzoeken van ronde 8 zeggen iets over evaluaties die de opdracht niet kende.

De agents draaiden op Opus 5.5, behalve in de vergelijking van twee modellen hieronder. De oordelen per criterium en de bevindingen zijn niet opnieuw gemaakt: de stap las bestaande evaluaties. De stap leest niet de ernst van de beoordelaar, wel wat die schreef over wie er last van heeft. De vergelijking met de beoordelaars is dus niet onafhankelijk.

## De acht ronden

| Ronde | Wat er anders was | Dezelfde evaluatie: gelijk per paar | Paren met twee treden of meer | Testsite L1 tegen L2: gelijk, één trede, twee of meer (van 79) |
| --- | --- | --- | --- | --- |
| 1 | Wegen per gebrek. De kerntaak verhoogt elke trede. "Omweg" is alles wat de bezoeker zelf moet ontdekken | 85, 87 en 91 procent | 0, 0 en 1 | niet gemeten |
| 2 | "Omweg" en "nodig voor een kerntaak" scherper omschreven | 77, 79 en 85 procent | 0, 1 en 1 | 48, 26, 5 |
| 2, andere tabel | Dezelfde wegingen, met de tabel waarin de kerntaak alleen over blokkerend beslist | 90, 91 en 91 procent | 0, 0 en 0 | 51, 10, 18 |
| 3 | Wegen per bevinding, een gebrek neemt de zwaarste. Vaste gevallen in de opdracht | 90, 92 en 93 procent | 0, 4 en 4 | 68, 10, 1 |
| 4 | Vaste gevallen aangescherpt: een formulierveld zonder naam, een knop zonder naam, een document zonder tags | 92, 93 en 94 procent | 0, 0 en 0 | 70, 6, 3 |
| 5 | Wie "kan niet bij een kerntaak" kiest, zegt in een zin waarom de taak dan niet af te maken is. Contrast is pas onder 1,5 op 1 "kan niet" | 95, 96 en 98 procent | 0, 0 en 0 | 64, 14, 1 |
| 6 | De agent schrijft per groep één doorlopende tekst voor het rapport, in plaats van twee losse zinnen | 95, 96 en 98 procent | 0, 0 en 0 | 63, 15, 1 |
| 7 | Verduidelijkingen na ronde 6, en ook andere regels: een paar toetsen terug is extra moeite, beeld met een andere weg ernaast is een omweg, een vast geval gaat voor de regels | 94, 95 en 97 procent | 0, 0 en 0 | 69, 10, 0 |
| 8 | De opdracht zoals ze is uitgebracht, herzien na een review van vijf kanten. Hulp van een ander is "kan niet", na een vast geval komen de andere groepen nog aan bod, ondergrenzen bij focus en taal, een zin bij hoog | 95, 95 en 97 procent | 0, 0 en 0 | 71, 7, 1 |

Wat elke ronde leerde:

1. **Ronde 1.** Tachtig procent van de gebreken werd "kerntaak": op een site om informatie op te zoeken staat bijna alles op de weg naar een taak. En bijna zes op de tien gebreken werden "omweg". Samen gaf dat 46 tot 50 van de 105 gebreken de ernst hoog. De top was wel goed: de gebreken waardoor een groep een formulier niet kan invullen, stonden bovenaan.
2. **Ronde 2.** Met scherpere omschrijvingen daalde hoog naar 25 tot 32. Maar "nodig voor een kerntaak" bleek het minst herhaalbare van de drie feiten: twee agents waren het daarover bij 86 tot 93 procent van de gebreken eens, over het gevolg bij 91 procent. Een tabel waarin de kerntaak elke trede verhoogt, geeft die onzekerheid aan elke bevinding door. Daarom beslist de kerntaak in de tabel die is gebouwd alleen tussen blokkerend en hoog, en bepaalt ze verder de volgorde binnen een trede.
3. **Ronde 2, testsite.** Tussen L1 en L2 kwam de gewogen ernst bij 51 van de 79 gebreken gelijk uit: minder dan de 63 van de beoordelaars. De oorzaak: een gebrek voegt soms bevindingen over heel verschillende problemen samen (een formulier met dertien bevindingen), en kreeg dan één weging. Welke bevindingen de regels samenvoegen, verschilt per run.
4. **Ronde 3.** Wegen per bevinding loste dat op: 68 van de 79 gelijk. Vier verschillen van twee treden of meer bleven, alle vier door één vast geval dat twee kanten op kon: een veld zonder naam was "kan niet", maar "kost moeite" als de tekst eromheen zegt wat het is. Eén agent paste dat laatste toe op pdf-formulieren.
5. **Ronde 4.** Met dat geval rechtgezet is er bij dezelfde evaluatie geen verschil van twee treden meer. De zes blokkerende en vijf hoge gebreken zijn in alle drie de wegingen dezelfde. De verschillen die blijven, zijn tussen midden en laag: omweg of extra moeite.
6. **Ronde 4, vier andere onderzoeken.** De stap is daarna één keer gedraaid op vier andere bestaande onderzoeken van sites van de overheid (27 tot 83 bevindingen). Daar bleek de hoogste trede niet scherp genoeg. Een deel van de vijftien gebreken die blokkerend werden, was dat niet: puntjes in een paginering die te licht zijn, een melding met te weinig contrast, een foto waarvan het alternatief de tekst op een bord mist. De agent zag dat een groep dat deel niet kan waarnemen, en dat de pagina bij een kerntaak hoort, en maakte daar "kan de kerntaak niet afmaken" van.
7. **Ronde 5.** Sindsdien vraagt de controle bij elke bevinding op de hoogste trede een zin die zegt waarom de taak zonder dit deel niet af te maken is. Op dezelfde vier onderzoeken bleven er vier blokkerende gebreken over, elk met de reden erbij: formulieren in pdf waarvan de velden geen naam hebben, en een rekenvraag die een fout antwoord zonder melding tegenhoudt. Wat een groep niet kan maar waar de taak ook zonder lukt, staat nu op hoog. Op het eerste onderzoek zijn de zes blokkerende en vijf hoge gebreken in alle drie de wegingen weer dezelfde.
8. **Ronde 6.** Een andere vorm van de tekst veranderde de ernst niet: dezelfde cijfers als ronde 5. De agents meldden wel twee dingen die de controle afkeurde en de opdracht niet noemde: de naam van een kerntaak mag hooguit acht woorden zijn, en bij "alle bezoekers" hoort geen reden. Beide staan nu in de opdracht.
9. **Ronde 7.** De wijzigingen na ronde 6 waren niet alleen woorden. Op het eerste onderzoek ging het aantal gebreken met ernst midden van gemiddeld 34 naar 30, vooral doordat "een paar toetsen terug" extra moeite werd. De overeenstemming tussen ronde 6 en 7 (92,5 procent) is lager dan binnen ronde 7 (95 procent): het verschil tussen twee versies van de opdracht is groter dan de ruis van herhalen.
10. **Review, daarna ronde 8.** Vijf reviewers lazen de stap: als auditor, op de code, als lezer van het rapport, op de meting en als onderhouder. De auditor vond dat de opdracht afhankelijkheid van een ander mens een omweg noemde, dat agents na een vast geval ophielden met groepen zoeken (alle 16 bevindingen onder 4.1.2 noemden alleen wie niet ziet), dat spraakbediening ontbrak bij onderdelen zonder naam, en dat een focusring van 1,5 op 1 en een heel formulier in de verkeerde taal als extra moeite wogen. De reviewer van de meting vond dat er geen achtergehouden set was en dat op de testsite juist verschilde wie blokkerend was. De opdracht is daarop herzien, en ronde 8 woog ook vier onderzoeken die nog nooit waren gebruikt.

## Ronde 8: de opdracht zoals ze is uitgebracht

**Dezelfde evaluatie, drie keer.** De ernst is per paar gelijk bij 95, 95 en 97 procent van de 111 bevindingen, en nergens twee treden uit elkaar. De zes blokkerende gebreken zijn in alle drie de wegingen dezelfde, en dezelfde als in ronde 4 tot en met 7. Vijf gebreken zijn in alle drie hoog; één weging noemt een zesde.

**Twee onderzoeken van de testsite.** Van de 79 gebreken uit de sleutel zijn er 71 gelijk, 7 één trede uit elkaar en 1 twee treden (hoog tegen laag, een foto bij een artikel). Beide onderzoeken noemen 9 gebreken blokkerend, en het zijn dezelfde 9. In de ronden ervoor verschilde dat:

| Ronde | Blokkerend in L1 | Blokkerend in L2 | In beide | In één van beide |
| --- | ---: | ---: | ---: | ---: |
| 5 | 11 | 12 | 10 | 3 |
| 6 | 7 | 10 | 6 | 5 |
| 7 | 8 | 12 | 7 | 6 |
| 8 | 9 | 9 | 9 | 0 |

Elk onderzoek is per ronde één keer gewogen, dus één ronde met een gelijke bovenkant is nog geen vaste eigenschap. De overeenstemming na correctie voor toeval (kappa) is 0,86, tegen 0,66 bij de beoordelaars. De gegevens en het script staan in [ronde-8/](ronde-8/): `node validatie/weging/ronde-8/vergelijk.ts` rekent deze cijfers na.

**Vier achtergehouden onderzoeken, elk twee keer gewogen.**

| Onderzoek | Bevindingen | Gelijk | Eén trede | Twee of meer | Blokkerende bevindingen: eerste, tweede, in beide |
| --- | ---: | ---: | ---: | ---: | --- |
| A | 55 | 51 (93 procent) | 3 | 1 | 0, 0, 0 |
| B | 98 | 91 (93 procent) | 6 | 1 | 4, 5, 4 |
| C | 48 | 46 (96 procent) | 2 | 0 | 1, 1, 1 |
| D | 66 | 62 (94 procent) | 4 | 0 | 1, 1, 1 |

Samen: 250 van de 267 bevindingen gelijk (94 procent), 2 twee treden uit elkaar. Wat blokkerend werd, is ander werk dan op de evaluaties waarop is afgesteld: een poster met uitleg die alleen als plaatje bestaat, een zoekknop die niet met het toetsenbord werkt en de enige weg naar zoeken is, uitklapvragen die geen knop zijn, en dia's die voor de schermlezer leeg blijven. Bij elk staat een reden waarom de taak dan niet af te maken is. Of die redenen kloppen, is niet nagelopen.

**Vier andere onderzoeken, tegen ronde 7.** De ernst is gelijk bij 87 tot 93 procent van de bevindingen; vier bevindingen verschillen twee treden. Dat is overeenstemming tussen twee versies van de opdracht, geen herhaling. De blokkerende gebreken zijn op drie van de vier dezelfde (drie, nul en nul). Op het vierde werd er één bij: een zoekveld op de startpagina zonder betrouwbare naam, dat in ronde 7 extra moeite was.

**Wat samen tegenhoudt.** De opdracht vraagt sinds deze ronde per kerntaak en groep of bevindingen die elk een omweg of extra moeite geven, de groep samen tegenhouden. In 16 van de 17 wegingen noemde de agent geen combinatie. Eén weging noemde er twee, bij het contactformulier van de testsite: een tijdslimiet samen met een focus die terugspringt, en dezelfde limiet samen met foutmeldingen die niet zeggen hoe het moet. De weging van het andere onderzoek van dezelfde site overwoog de eerste combinatie en liet haar weg, omdat ze volgens de agent alleen met overdrijven te onderbouwen was. Dit deel is dus nauwelijks beproefd, en de twee keer dat het aan de orde kwam, waren de agents het niet eens.

**Geen groep gehinderd.** Drie bevindingen in twee wegingen van één achtergehouden onderzoek kregen geen groep, met per groep de zin die de controle eist. In de ruim 6.300 wegingen van alle ronden samen is dat de enige keer.

**De controle** slaagde in 14 van de 17 wegingen de eerste keer.

## Doelen

Deze doelen zijn gesteld bij de start van het werk, in het plan van aanpak. Ze zijn niet vooraf gepubliceerd.

| Doel | Uitkomst |
| --- | --- |
| Het oordeel per criterium en de bevindingen veranderen niet | Gehaald. De opdrachten van beoordelaar, verifieerder en afmaakronde en de procedures zijn niet gewijzigd, en een test legt vast dat de bevindingen na de weging gelijk zijn op de ernst na |
| De ernst is niet slechter dan die van de beoordelaars, getoetst aan een sleutel | Niet gemeten: er is geen sleutel met de juiste ernst |
| Bij herhaling niet wisselvalliger dan de beoordelaars (63 van 79 gelijk, 16 één trede), en nooit twee treden | Tussen twee onderzoeken van de testsite, waar de maat van de beoordelaars vandaan komt: vaker gelijk (63 tot 71 tegen 63). Twee treden verschil kwam in vijf van de zes ronden voor, bij één tot drie gebreken. Op dezelfde evaluatie is er geen maat van de beoordelaars; daar kwam het sinds ronde 4 niet tot twee treden |
| Geen bevinding zonder groep, geen tekst die een groep klein noemt | De controle weigert een tekst die een groep klein of onbelangrijk noemt. Een bevinding zonder groep staat ze alleen toe met een zin per groep, en niet bij een gemeten grens. Dat is drie keer gebruikt |
| Onder 5 procent van de tokens van een onderzoek | Niet gehaald: 8 tot 9 procent |
| Stoppen als een ronde slechter uitkomt dan de nulmeting, en eerst de oorzaak zoeken | Toegepast na ronde 2 (wegen per gebrek) en na ronde 4 (valse blokkades) |
| De opdracht die is gemeten, is de opdracht die is uitgebracht | Gehaald: ronde 8 draaide op de opdracht zoals ze in de repository staat |
| Een deskundige leest een werklijst voor en na | Niet gedaan |

## Wat de stap verandert aan de ernst

Op het bestaande onderzoek van de eerste meting, per gebrek, gemiddeld over de drie wegingen van ronde 8:

| | blokkerend | hoog | midden | laag |
| --- | ---: | ---: | ---: | ---: |
| Beoordelaars | 1 | 16 | 58 | 30 |
| Na weging | 6 | 5 | 38 | 56 |

Van de bevindingen werd 8 procent zwaarder en 34 procent lichter. Dat hangt af van de versie van de opdracht: in ronde 7 was het 38 procent lichter, door de regel dat een paar toetsen terug extra moeite is, en in ronde 8 schoven bevindingen terug naar midden door de ondergrenzen bij focus, taal en een verkeerd gemelde toestand. De ene blokkerende van de beoordelaars (een link die op dezelfde pagina blijft) is na weging midden: iedereen moet een andere weg zoeken. De zes blokkerende na weging zijn een controleplaatje zonder alternatief en formulieren in pdf: velden zonder naam, geen tags, vragen die los staan van de velden. Bij de beoordelaars stonden die tussen zestien gebreken met ernst hoog.

Eén tot zestien keer per opdracht noemde de agent een feit dat de bevinding niet gaf.

## Twee modellen

Met de opdracht van ronde 5 is dezelfde evaluatie ook drie keer gewogen op Fable 5.2. Gemiddeld over de paren komt de ernst binnen Opus bij 96 procent van de bevindingen gelijk uit (95 tot 98), binnen Fable bij 95 procent, en tussen de twee modellen bij 94 procent (92 tot 96). Nergens ligt de ernst twee treden uit elkaar. De zes blokkerende bevindingen zijn in alle zes de wegingen dezelfde; één weging op Fable gaf een zesde gebrek de ernst hoog. Op deze opdracht maakt het model dus weinig uit. Dat zegt iets over de opdracht en de vaste gevallen, niet over of de ernst juist is: twee modellen van dezelfde maker kunnen dezelfde blinde vlek hebben. De vergelijking is niet herhaald met de opdracht van ronde 8.

## Kosten

Een weging van 111 bevindingen kostte in ronde 8 1,3 tot 1,7 miljoen tokens en acht tot tien minuten: 0,9 tot 1,4 miljoen uit de cache gelezen, 0,15 tot 0,30 miljoen in de cache geschreven en 48.000 tot 67.000 als antwoord. De testsite (111 en 117 bevindingen, meer groepen per bevinding) kostte 1,3 tot 1,4 miljoen tokens en dertien tot veertien minuten. Dat is 8 tot 9 procent van de tokens van een onderzoek van de testsite (16 tot 17,5 miljoen). Het doel was onder de 5 procent; dat is niet gehaald, en de herziene opdracht van ronde 8 is duurder dan die van ronde 7 (1,0 tot 1,3 miljoen). Een onderzoek met 27 bevindingen kostte 0,5 miljoen tokens en drie minuten.

## Wat hieruit volgt

- Bij herhaling op dezelfde evaluatie komt de ernst in ronde 5 tot en met 8 bij 94 tot 98 procent van de bevindingen gelijk uit, en sinds ronde 4 nooit twee treden uit elkaar. Op vier onderzoeken die de opdracht niet kende, is het 93 tot 96 procent, met twee van de 267 bevindingen twee treden uit elkaar.
- Tussen twee onderzoeken van de testsite komt de ernst bij 63 tot 71 van de 79 gebreken gelijk uit (ronde 3 tot en met 8), tegen 63 bij de beoordelaars. Elk onderzoek is per ronde één keer gewogen, dus het verschil tussen 63 en 71 is voor een deel toeval. Vijf van de zes verschillen van twee treden liggen tussen blokkerend en midden: "kan niet bij een kerntaak" ligt in de tabel twee treden boven "omweg", en of er een omweg is, is het moeilijkste oordeel. Eén ligt tussen hoog en laag, en komt in ronde 6 en in ronde 8 voor bij hetzelfde gebrek.
- De lijst "Wie loopt vast" hangt aan de grens tussen blokkerend en hoog. Op de testsite verschilde die lijst in ronde 5 tot en met 7 tussen de twee onderzoeken, en in ronde 8 niet. Lees haar bij een eerste gebruik op een site na.
- Of de teksten per groep kloppen, weet niemand. Ze zijn afgeleid uit de bevinding. De controle weigert een aanhaling die niet in de invoer staat, maar een tekst zonder aanhaling kan nog steeds iets beweren over hulpsoftware wat niet is waargenomen. De review vond er drie: velden in een pdf zonder tags zouden geen rol hebben, een lege taal zou een verkeerde uitspraak geven, en wie niet hoort zou niet kunnen bellen.
- De vaste gevallen in de opdracht zijn de ijking. Ze zijn op deze meting bijgesteld, één keer nagelopen door een taalmodel in de rol van auditor, en door niemand van buiten.
- De kerntaken leidt elke weging opnieuw af. De namen verschillen per weging; welke gebreken een groep bij een kerntaak tegenhouden, was op het eerste onderzoek sinds ronde 4 in elke weging gelijk.
- De valse blokkades van ronde 4 kwamen pas aan het licht op andere onderzoeken dan dat waarop de opdracht was afgesteld. De vier achtergehouden onderzoeken van ronde 8 lieten er geen zien die bij lezen direct onjuist is, maar dat is gelezen door wie de opdracht schreef.

## Wat de opdracht nog open laat

De agents meldden aan het eind van elke weging wat ze onduidelijk vonden. Wat ronde 6 en 7 opleverden, is in de opdracht van ronde 8 verwerkt: een hindernis met een uitweg, een bevinding op meer plekken, gebreken zonder vast geval, een feit uit een andere bevinding, en alle bezoekers naast één groep. Uit ronde 8 staat nog open:

- **Een pictogram dat zegt wat een link doet.** Het vaste geval "informatie die alleen in beeld staat" geeft "kan niet", terwijl de bezoeker het bij de volgende stap merkt. Agents wijken daar af naar extra moeite.
- **Spraakbediening bij een criterium dat die groep niet noemt.** Het vaste geval noemt wie met spraak bedient bij een knop zonder naam, ook onder 1.1.1. De norm noemt die groep daar niet, dus de controle vraagt een reden.
- **Een onderzoek zonder beschrijving van de site.** Oudere onderzoeken hebben die niet. De agent haalt de kerntaken dan alleen uit de titels van de pagina's.
- **Wat samen tegenhoudt.** Twee agents beoordeelden dezelfde combinatie op de testsite verschillend. De opdracht zegt niet wanneer "de tijd loopt af" een taak tegenhoudt.

Ze zijn na ronde 8 niet meer in de opdracht verwerkt: dan was de gemeten opdracht niet meer de uitgebrachte.
