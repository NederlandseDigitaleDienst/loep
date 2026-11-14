# Meting van de weegstap

De weegstap (`weigh`, `check-weigh`, opdracht `templates/weeg.md`) legt per bevinding vast welke groepen bezoekers ze hindert, wat er voor elke groep gebeurt en of bezoekers dit deel nodig hebben voor een kerntaak. De ernst volgt daar met een vaste tabel uit. Zie [docs/methode.md](../../docs/methode.md#ernst-en-eigenaar-van-een-bevinding).

Dit verslag zegt wat er op 14 november 2026 is gemeten, in vijf ronden, en wat niet.

## Wat is gemeten en wat niet

Gemeten is **herhaalbaarheid**: komt de ernst gelijk uit als de stap vaker draait?

- **Dezelfde evaluatie, drie keer.** Drie agents wegen los van elkaar de 111 bevindingen (105 gebreken) van één bestaand onderzoek van een grote site van de rijksoverheid. Elk paar wordt vergeleken.
- **Twee onderzoeken van de testsite.** De twee runs van Lindewaard uit de meting van 0.25.0 (L1 en L2, zie [testsite/2026-11-10-meting-0.25.0](../testsite/2026-11-10-meting-0.25.0/uitkomst.md)) zijn elk één keer gewogen. Per gebrek uit de sleutel (79) is de ernst in L1 en L2 vergeleken, via de koppeling van vergelijker A. De beoordelaars schreven in die twee runs hun bevindingen in andere woorden, dus dit meet de stap op andere invoer over hetzelfde gebrek. De maat om te halen is de ernst die de beoordelaars zelf gaven: bij 63 van de 79 gelijk, bij 16 één trede verschil.

**Niet gemeten is of de ernst juist is.** Er is geen sleutel met de juiste ernst, en geen deskundige of gebruiker van hulpsoftware heeft de wegingen, de beschrijving van de groepen of de vaste gevallen in de opdracht nagelopen. Dat een tweede beoordeling door een taalmodel op dezelfde volgorde uitkomt, is geen toets: beide kunnen dezelfde blinde vlek hebben.

Alle agents draaiden op hetzelfde model (Opus 5.5). De oordelen per criterium en de bevindingen zijn niet opnieuw gemaakt: de stap las bestaande evaluaties.

## De vijf ronden

| Ronde | Wat er anders was | Dezelfde evaluatie: gelijk per paar | Paren met twee treden of meer | Testsite L1 tegen L2: gelijk, één trede, twee of meer (van 79) |
| --- | --- | --- | --- | --- |
| 1 | Wegen per gebrek. De kerntaak verhoogt elke trede. "Omweg" is alles wat de bezoeker zelf moet ontdekken | 85, 87 en 91 procent | 0, 0 en 1 | niet gemeten |
| 2 | "Omweg" en "nodig voor een kerntaak" scherper omschreven | 77, 79 en 85 procent | 0, 1 en 1 | 48, 26, 5 |
| 2, andere tabel | Dezelfde wegingen, met de tabel waarin de kerntaak alleen over blokkerend beslist | 90, 91 en 91 procent | 0, 0 en 0 | 51, 10, 18 |
| 3 | Wegen per bevinding, een gebrek neemt de zwaarste. Vaste gevallen in de opdracht | 90, 92 en 93 procent | 0, 4 en 4 | 68, 10, 1 |
| 4 | Vaste gevallen aangescherpt: een formulierveld zonder naam, een knop zonder naam, een document zonder tags | 92, 93 en 94 procent | 0, 0 en 0 | 70, 6, 3 |
| 5 | Wie "kan niet bij een kerntaak" kiest, zegt in een zin waarom de taak dan niet af te maken is. Contrast is pas onder 1,5 op 1 "kan niet" | 95, 96 en 98 procent | 0, 0 en 0 | 64, 14, 1 |

Wat elke ronde leerde:

1. **Ronde 1.** Tachtig procent van de gebreken werd "kerntaak": op een site om informatie op te zoeken staat bijna alles op de weg naar een taak. En bijna zes op de tien gebreken werden "omweg". Samen gaf dat 46 tot 50 van de 105 gebreken de ernst hoog. De top was wel goed: de gebreken waardoor een groep een formulier niet kan invullen, stonden bovenaan.
2. **Ronde 2.** Met scherpere omschrijvingen daalde hoog naar 25 tot 32. Maar "nodig voor een kerntaak" bleek het minst herhaalbare van de drie feiten: twee agents waren het daarover bij 86 tot 93 procent van de gebreken eens, over het gevolg bij 91 procent. Een tabel waarin de kerntaak elke trede verhoogt, geeft die onzekerheid aan elke bevinding door. Daarom beslist de kerntaak in de tabel die is gebouwd alleen tussen blokkerend en hoog, en bepaalt ze verder de volgorde binnen een trede.
3. **Ronde 2, testsite.** Tussen L1 en L2 kwam de gewogen ernst bij 51 van de 79 gebreken gelijk uit: minder dan de 63 van de beoordelaars. De oorzaak: een gebrek voegt soms bevindingen over heel verschillende problemen samen (een formulier met dertien bevindingen), en kreeg dan één weging. Welke bevindingen de regels samenvoegen, verschilt per run.
4. **Ronde 3.** Wegen per bevinding loste dat op: 68 van de 79 gelijk. Vier verschillen van twee treden of meer bleven, alle vier door één vast geval dat twee kanten op kon: een veld zonder naam was "kan niet", maar "kost moeite" als de tekst eromheen zegt wat het is. Eén agent paste dat laatste toe op pdf-formulieren.
5. **Ronde 4.** Met dat geval rechtgezet is er bij dezelfde evaluatie geen verschil van twee treden meer. De zes blokkerende en vijf hoge gebreken zijn in alle drie de wegingen dezelfde. De verschillen die blijven, zijn tussen midden en laag: omweg of extra moeite.
6. **Ronde 4, vier andere onderzoeken.** De stap is daarna één keer gedraaid op vier andere bestaande onderzoeken van sites van de overheid (27 tot 83 bevindingen). Daar bleek de hoogste trede niet scherp genoeg. Een deel van de vijftien gebreken die blokkerend werden, was dat niet: puntjes in een paginering die te licht zijn, een melding met te weinig contrast, een foto waarvan het alternatief de tekst op een bord mist. De agent zag dat een groep dat deel niet kan waarnemen, en dat de pagina bij een kerntaak hoort, en maakte daar "kan de kerntaak niet afmaken" van.
7. **Ronde 5.** Sindsdien vraagt de controle bij elke bevinding op de hoogste trede een zin die zegt waarom de taak zonder dit deel niet af te maken is. Op dezelfde vier onderzoeken bleven er vier blokkerende gebreken over, elk met de reden erbij: formulieren in pdf waarvan de velden geen naam hebben, en een rekenvraag die een fout antwoord zonder melding tegenhoudt. Wat een groep niet kan maar waar de taak ook zonder lukt, staat nu op hoog. Op het eerste onderzoek zijn de zes blokkerende en vijf hoge gebreken in alle drie de wegingen weer dezelfde.

## Wat vooraf was vastgelegd

| Vooraf | Uitkomst |
| --- | --- |
| Het oordeel per criterium en de bevindingen veranderen niet | Gehaald. De opdrachten van beoordelaar, verifieerder en afmaakronde en de procedures zijn niet gewijzigd, en een test legt vast dat de bevindingen na de weging gelijk zijn op de ernst na |
| De ernst is niet slechter dan die van de beoordelaars, getoetst aan een sleutel | Niet gemeten: er is geen sleutel met de juiste ernst |
| Bij herhaling niet wisselvalliger dan de beoordelaars (63 van 79 gelijk, 16 één trede), en nooit twee treden | Gehaald op dezelfde evaluatie. Tussen twee onderzoeken: gelijk of iets beter in het aantal dat gelijk is, niet in "nooit twee treden" |
| Geen bevinding zonder groep, geen zin die een groep wegstreept | Gehaald: de controle weigert het |
| Onder 5 procent van de tokens van een onderzoek | Niet gehaald: ongeveer 7 procent |
| Stoppen als een ronde slechter uitkomt dan de nulmeting, en eerst de oorzaak zoeken | Toegepast na ronde 2 (wegen per gebrek) en na ronde 4 (valse blokkades) |
| Een deskundige leest een werklijst voor en na | Niet gedaan |

## Wat de stap verandert aan de ernst

Op het bestaande onderzoek van de eerste meting, per gebrek, gemiddeld over de drie wegingen van ronde 5:

| | blokkerend | hoog | midden | laag |
| --- | ---: | ---: | ---: | ---: |
| Beoordelaars | 1 | 16 | 58 | 30 |
| Na weging | 6 | 5 | 34 | 60 |

Van de bevindingen werd 8 procent zwaarder en 34 procent lichter. De ene blokkerende van de beoordelaars (een link die op dezelfde pagina blijft) is na weging midden: iedereen moet een andere weg zoeken. De zes blokkerende na weging zijn een controleplaatje zonder alternatief en formulieren in pdf: velden zonder naam, geen tags, vragen die los staan van de velden. Bij de beoordelaars stonden die tussen zestien gebreken met ernst hoog.

Geen enkele agent gebruikte in welke ronde ook de mogelijkheid om te zeggen dat een bevinding geen groep hindert (0 van ruim 3.000 wegingen in 31 opdrachten). Twee tot veertien keer per opdracht noemde de agent een feit dat de bevinding niet gaf.

## Kosten

Een weging van 111 bevindingen kostte in ronde 5 1,1 tot 1,2 miljoen tokens (waarvan ongeveer een miljoen uit de cache gelezen en 40.000 tot 46.000 geschreven) en zes tot zeven minuten. Dat is ongeveer 7 procent van de tokens van een onderzoek van de testsite (16 tot 17,5 miljoen). Het doel vooraf was onder de 5 procent; dat is niet gehaald.

## Wat hieruit volgt

- Bij herhaling op dezelfde evaluatie komt de ernst in ronde 5 bij 95 tot 98 procent van de bevindingen gelijk uit, en sinds ronde 4 nooit twee treden uit elkaar.
- Tussen twee onderzoeken van de testsite komt de ernst bij 64 tot 70 van de 79 gebreken gelijk uit (ronde 3 tot en met 5), tegen 63 bij de beoordelaars. Dat is niet slechter, en niet aantoonbaar beter: elk onderzoek is per ronde één keer gewogen, dus het verschil tussen 64 en 70 is ook toeval. Eén tot drie gebreken verschillen daar twee treden, bij de beoordelaars geen. Dat komt door de tabel: "kan niet bij een kerntaak" (blokkerend) ligt twee treden boven "omweg" (midden), en of er een omweg is, is het moeilijkste oordeel. Het doel vooraf, geen verschil van twee treden, is gehaald op dezelfde evaluatie en niet tussen twee onderzoeken.
- Of de zinnen per groep kloppen, weet niemand. Ze zijn afgeleid uit de bevinding. De controle weigert een aanhaling die niet in de bevinding staat, maar een zin zonder aanhaling kan nog steeds iets beweren over hulpsoftware wat niet is waargenomen.
- De vaste gevallen in de opdracht zijn de ijking. Ze zijn op deze meting bijgesteld en door niemand van buiten nagelopen.
- De kerntaken leidt elke weging opnieuw af. De namen verschillen per weging; welke gebreken een groep bij een kerntaak tegenhouden, was in ronde 4 en 5 drie keer gelijk.
- De valse blokkades van ronde 4 kwamen pas aan het licht op andere onderzoeken dan dat waarop de opdracht was afgesteld. Elk nieuw onderzoek kan er meer laten zien: lees bij een eerste gebruik de lijst "Wie loopt vast" na.
