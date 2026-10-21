# Meting op loep 0.11.0, 20 en 21 oktober 2026

Issue #184. Twee volledige runs van loep 0.11.0 op dezelfde bevroren veegronde van de testsite Lindewaard, de variant met 79 ingebouwde gebreken. Daarnaast twee varianten op negen criteria, om twee stappen uit [het voorstel over verbruik](../../verbruik/README.md) te toetsen: de opdracht in een kern en een naslag (K), en de rondgangen en verifieerders op Sonnet (S). Opzet, stopregel en marge stonden in #184 voordat een variant draaide.

## Opzet

- **Bevroren veegronde.** Eén veegronde met tag `v0.11.0` (commit `6ad7e5c`). De poort was groen na twee vervolgrondes van de verkenner. Versturen was toegestaan, ten hoogste 30 keer. VoiceOver stond uit, omdat er maar één voorlezing tegelijk kan lopen en de runs anders minder vergelijkbaar worden. Elke run werkte op een kopie van deze veegronde (`variant`).
- **Nulmeting.** N1 en N2, `v0.11.0`, alle 56 criteria, zes agents tegelijk, na elkaar.
- **Varianten.** Negen criteria (1.1.1, 1.3.1, 1.4.3, 1.4.11, 2.1.1, 2.4.3, 3.1.2, 3.3.1, 4.1.2) met `tasks --only`, zes agents tegelijk, twee runs tegelijk.
  - **K**: `v0.11.0` met #170, de opdracht in een kern en een naslag (branch `meting/kern-naslag-0.11.0`, commit `cb50690`).
  - **S**: `v0.11.0`, rondgangen en verifieerders op Sonnet (`models: { walks: "sonnet", verifiers: "sonnet" }`), beoordelaars op Opus.
- **Vergelijking.** Per run `compare --findings` met twee vergelijkers (A en B) tegen de sleutel `reference-lindewaard.json`. Over N1 en N2 samen `compare-variants` zonder variant (de spreiding), en elke variant tegen N1 en N2 met `compare-variants --criteria` op de negen criteria (#237). Elk criterium heeft in de grote run een eigen beoordelaar en verifieerder, dus die negen uit N1 en N2 zijn een eerlijke nulmeting.
- **Stopregel na ronde 2, per variant.** Stoppen met "niet slechter" als de variant in beide runs elk gebrek vond dat de nulmeting in beide runs vond, en over twee runs hooguit één onterechte melding meer had. Stoppen met "slechter" als de variant in beide runs een gebrek miste dat de nulmeting in beide runs vond, of in elke run minstens twee onterechte meldingen meer had. Anders een derde run en de gewone toets.
- **Marge,** vastgelegd na de nulmeting en voordat een variant was beoordeeld: de ondergrens van het verschil in gevonden gebreken boven -5 procentpunt, en de bovengrens van het verschil in onterechte meldingen onder +1 per run. De zorg in het voorstel was dat een vijfde van de gebreken per run wisselt; gemeten is één wisselend gebrek op 79, dus 5 procentpunt is niet te streng. Op 29 gebreken is dat ongeveer anderhalf gebrek.

Niet gemeten: een variant zonder #164 (het dossier per criterium, dat al in 0.11.0 zit), de schone variant van de testsite, en een derde run van de nulmeting.

## Nulmeting

| | N1 | N2 |
|---|---|---|
| Duur | 2 uur 22 minuten | 2 uur 50 minuten |
| Agents, uitval, afmaakronde | 129, 0, geen | 129, 0, geen |
| Voldoet niet, voldoet, n.v.t., open | 50, 4, 2, 0 | 50, 4, 2, 0 |
| Criteria terecht afgekeurd (van 51) | 50 | 50 |
| Criteria ten onrechte goedgekeurd | 1 (1.4.12) | 1 (1.4.12) |
| Gebreken uit de sleutel gevonden (van 79) | 77 | 78 |
| Bevindingen, en gebreken na samenvoegen | 118, 82 | 114, 84 |
| Eigen bevindingen zonder tegenhanger | 11: 4 terecht, 5 discutabel, 0 onterecht, 2 oneens | 13: 6 terecht, 4 discutabel, 0 onterecht, 3 oneens |
| Open punten in het oordeel (notities, geen open criteria) | 12 | 14 |
| Tokens volgens de werkstroom | 18,6 miljoen | 18,6 miljoen |

Bij 1.4.12 en de 77 en 78 van 79 hoort een kanttekening: het gebrek 1.4.12-tegel is in de testsite zelf te zwak gebouwd (#218, zie "Missers en hun oorzaak"). "Voldoet" telt 4.1.1 mee, dat in WCAG 2.2 is vervallen. De klassen van de eigen bevindingen zijn die waarover A en B het eens waren. Het tokenaantal is de telling van de werkstroom (`subagent_tokens`) en is niet te vergelijken met de telling uit de transcripts in het voorstel over verbruik.

**Spreiding** ([spreiding-56](spreiding-56/varianten.md), [spreiding-9](spreiding-9/varianten.md)). Per criterium gaven beide runs bij 56 van de 56 dezelfde uitkomst, ook bij 1.4.12, dat in beide runs tegen de sleutel in "voldoet" kreeg. Van de 79 gebreken hadden er 77 in beide runs dezelfde uitkomst. 1.4.12-tegel is in beide gemist; 4.1.2-rol-logo is één keer gemist en één keer gevonden. A en B waren het in beide runs over alle 79 gebreken eens. Op de negen criteria van de varianten heeft de sleutel 29 gebreken: N1 vond er 28, N2 29.

Fleiss' kappa is op de negen criteria niet te berekenen, omdat alle uitkomsten "voldoet niet" zijn. Op 56 criteria is hij 1,00, maar met bijna alleen "voldoet niet" zegt dat weinig. De tabel per gebrek zegt meer.

**Tegen versie 2** (10 oktober, commit `005c04d`, zonder versturen; zie `validatie/testsite/2026-10-10-versie-2/`): gevonden gebreken van 71 naar 77 en 78 van 79, terecht afgekeurde criteria van 46 naar 50 van 51, open criteria van 7 naar 0. Ten onrechte goedgekeurd ging van 0 naar 1.

Per run: [vergelijking-n1](vergelijking-n1/bevindingen.md), [vergelijking-n2](vergelijking-n2/bevindingen.md).

## K: de opdracht in een kern en een naslag

K1 en K2, gestopt na ronde 2 volgens de stopregel: **niet slechter** ([varianten-k](varianten-k/varianten.md)). K vond in beide runs elk gebrek dat de nulmeting in beide runs vond, en had niet meer meldingen zonder tegenhanger.

| Toets, op 9 criteria | Nulmeting | K | Verschil (95%-interval) | Binnen de marge |
|---|---|---|---|---|
| Gevonden gebreken per run (29) | 98,3% | 98,3% | 0,0 (0,0 tot 0,0) procentpunt | ja |
| Meldingen zonder tegenhanger per run | 4,0 | 3,0 | -1,0 (-2,5 tot 0,0) | ja |
| Open punten per run (ter informatie) | 1,5 | 4,0 | +2,5 (+0,5 tot +4,5) | |

K1 miste 4.1.2-rol-logo op dezelfde manier als N1; K2 vond alle 29. Geen eigen bevinding van K was volgens A en B onterecht. De open punten van K gaan over dezelfde twee onderdelen als die van de nulmeting (zie "Missers en hun oorzaak"); K noteert ze onder meer criteria. Duur 64 en 59 minuten, 35 agents per run, geen uitval.

Per run: [vergelijking-k1](vergelijking-k1/bevindingen.md), [vergelijking-k2](vergelijking-k2/bevindingen.md).

## S: rondgangen en verifieerders op Sonnet

S1 en S2 haalden de stopregel niet: de tussenkop in de uitklapper en het dialoogvenster waren elk in één van de twee runs niet of deels gevonden, terwijl geen gebrek in beide runs was gemist. Daarom S3 en de gewone toets ([varianten-s](varianten-s/varianten.md)): **"niet slechter" is niet aangetoond.**

| Toets, op 9 criteria | Nulmeting | S | Verschil (95%-interval) | Binnen de marge |
|---|---|---|---|---|
| Gevonden gebreken per run (29) | 98,3% | 97,7% | -0,6 (-5,2 tot +4,0) procentpunt | nee |
| Meldingen zonder tegenhanger per run | 4,0 | 2,3 | -1,7 (-4,2 tot +0,3) | ja |
| Open punten per run (ter informatie) | 1,5 | 3,3 | +1,8 (-0,2 tot +4,2) | |

De ondergrens ligt net onder de marge van -5,0. Dat S slechter is, is ook niet aangetoond: de puntschatting is -0,6 procentpunt. S vond een gebrek 2 keer niet of deels in 87 gevallen (29 gebreken in 3 runs), de nulmeting 1 keer in 58. Waar S afweek van de nulmeting:

| Gebrek | Nulmeting | S1 | S2 | S3 |
|---|---|---|---|---|
| 1.3.1-tussenkop-uitklapper | 2 van 2 | gemist, niet in het dossier | gevonden | gevonden |
| 4.1.2-venster | 2 van 2 | gevonden | deels: rol en naam van het venster ontbreken | gevonden |
| 4.1.2-rol-logo | 1 van 2 | gevonden | gevonden | gevonden |

Beide missers passen bij het risico van een lichter model in de rondgang: een kandidaat die niet in het dossier komt. Voor de tussenkop is dat een vermoeden; nagegaan is het niet. Geen eigen bevinding van S was volgens A en B onterecht. S2 had daarnaast een open punt "niet bereikbaar": de videospeler laadde op twee pagina's niet. Duur 46, 46 en 49 minuten, 35 agents per run, geen uitval.

Per run: [vergelijking-s1](vergelijking-s1/bevindingen.md), [vergelijking-s2](vergelijking-s2/bevindingen.md), [vergelijking-s3](vergelijking-s3/bevindingen.md).

## Verbruik

Uit de transcripts van de werkstroom, elk bericht één keer, met de prijzen van de API van 19 oktober 2026 (zie het voorstel over verbruik); Sonnet kost de helft van Opus. Alleen de rondgangen, de stand-agent, en de beoordelaars en verifieerders van de negen criteria; bij N1 en N2 dus 9 van de 56. De vergelijkers van `compare --findings` en de verkenner tellen niet mee. Bedragen in dollar per run, met tussen haakjes het aantal beurten.

| Run | Rondgangen | Beoordelaars (9) | Verifieerders (9) | Stand | Samen |
|---|---|---|---|---|---|
| N1 | 32,44 (992) | 32,81 (592) | 22,18 (475) | 1,10 | 88,52 |
| N2 | 33,87 (1056) | 33,34 (606) | 22,11 (498) | 1,00 | 90,32 |
| K1 | 30,96 (966) | 36,42 (649) | 21,80 (480) | 0,73 | 89,91 |
| K2 | 31,15 (982) | 35,61 (638) | 21,00 (465) | 0,73 | 88,49 |
| S1 | 11,43 Sonnet (597) | 38,06 (684) | 8,06 Sonnet (344) | 0,94 | 58,49 |
| S2 | 10,89 Sonnet (559) | 38,62 (684) | 8,14 Sonnet (347) | 0,84 | 58,48 |
| S3 | 12,45 Sonnet (678) | 35,37 (620) | 10,12 Sonnet (437) | 1,03 | 58,97 |

- **K bespaart niets:** 89,2 tegen 89,4 dollar per run. De rondgangen zijn 6% goedkoper, met 5% minder beurten. De beoordelaars zijn 9% duurder: ze nemen 7% meer beurten en lezen meer uit de cache (gemiddeld 104,7 tegen 94,8 miljoen tokens). De naslag wordt dus toch gelezen, en kost dan extra beurten. De schatting van 5 tot 10% minder lezen uit de cache klopt niet.
- **S is 34% goedkoper:** 58,6 tegen 89,4 dollar per run. Rondgangen op Sonnet nemen 40% minder beurten en kosten 65% minder. De verifieerders op Sonnet kosten 60% minder. De beoordelaars op Opus nemen in S 11% meer beurten en kosten 13% meer; waarschijnlijk vangen ze op wat dunnere rondgangen niet aanleverden.
- Alleen de verifieerders op Sonnet zou in deze samenstelling ongeveer 13 van de 89 dollar schelen, 15%.

De rondgangen zijn in elke run dezelfde dertien, ook in N1 en N2, waar ze voor alle 56 criteria werken. In een run met 56 beoordelaars en verifieerders is hun aandeel kleiner, dus de 34% geldt voor deze samenstelling van negen criteria en niet voor een volledig onderzoek. Een script dat dit verbruik uit de transcripts haalt voor `compare-variants --usage`, is er nog niet (#243).

## Missers en hun oorzaak

| Wat | Waar | Oorzaak | Issue |
|---|---|---|---|
| 1.4.12-tegel gemist, 1.4.12 ten onrechte "voldoet" | N1, N2 | Voor een deel een fout in de sleutel van de testsite. Het dossier meldde dat de tegels bij ruimere tekstafstand nieuw worden afgekapt (inhoud 58 pixels, zichtbaar 48). Nagemeten is dat overloop van 10 pixels vooral regelhoogte en padding; van de letters valt maar 1 pixel weg, en de laatste regel valt niet weg, zoals de sleutel zegt. Het oordeel "nog leesbaar", dat in beide runs tot "voldoet" leidde, was dus verdedigbaar. Wel ontbreekt een meting die zegt of er tekst verdwijnt of alleen padding. | #238 (een preciezere meting: verdwijnt er tekst of alleen ruimte), #218 (het gebrek in de testsite duidelijker maken) |
| 4.1.2-rol-logo gemist | N1, K1 | axe meldt `aria-roles` op 13 pagina's. De beoordelaar van 4.1.2 schoof het door naar 1.3.1, en daar is het niet gemeld. Niemand controleert of een doorgeschoven gebrek aankomt. | #239 |
| 3.2.1-voetlink, 2.5.1-galerij en 3.3.2-plaatshouder liggen bij een ander criterium | elke run met negen criteria | Zelfde patroon: 2.1.1 schuift de voetlink door naar 2.4.7, de galerij wordt een open punt bij 2.1.1, de plaatshouder staat in het dossier van 1.3.1. Telt niet mee in de toets, want die criteria draaiden niet, maar laat zien hoe vaak een beoordelaar een gebrek laat liggen voor een ander criterium. | #239 |
| 1.3.1-tussenkop-uitklapper gemist | S1 | Niet in het dossier. Vermoeden: de rondgang op Sonnet gaf de kop in de uitklapper niet als kandidaat door. | |
| 4.1.2-venster deels | S2 | Rol en naam van het dialoogvenster niet gemeld. | |
| Open punten over vegen en slepen | elke run | Een fotoserie die alleen met vegen werkt en een prijsschuif die alleen met slepen werkt. loep kan niet vegen of slepen. | #240 |
| Sneltoetsen in de ingesloten speler gemeld onder 2.1.4 | N1, N2 | De toetsen werken alleen met de focus in de speler. A vond de melding discutabel, B onterecht. Na te gaan of de procedure de uitzondering voor een ingesloten venster goed toepast. | #246 |

Wat bij de veegronde en de vergelijking opviel:

- Een proces dat eindigt op een adres met een query komt op het blad van de startpagina, en de poort mist het daar (#226).
- De verkenner schreef dat de producten geen prijsschuif hebben. De schuif is met opzet een bouwsel zonder rol; de fout is dat de verkenner hem als niet bestaand afdeed (#227).
- `compare-variants` noemt elke bevinding zonder tegenhanger een "onterechte melding", ook als A en B haar terecht of discutabel vinden. De meldingen in de tabellen hierboven zijn daarom "zonder tegenhanger"; volgens A en B was in geen enkele run op de negen criteria een bevinding onterecht (#241, na de meting hersteld in #248; de bestanden in deze map zijn van daarvoor).
- `compare --findings` loopt bij een run met `--only` alle 79 gebreken langs. Het percentage over 79 in de vergelijkingen van K en S zegt daardoor niets; tel alleen de 29 van de negen criteria (#242, na de meting hersteld in #249).
- `sweep-check` kiest willekeurige poorten en ruimt de run op, dus een run daaruit is niet te bevriezen voor een meting (#244; sinds #247 kan dat met `--fixed-ports`).
- Het verzendbudget eist ook op een lokale site 120 seconden tussen twee verzoeken (#245, na de meting hersteld in #250).

## Wat deze meting niet zegt

- **Niets over echte sites.** De testsite is door hetzelfde systeem gebouwd als loep en makkelijker dan een echte site: versie 1 vond hier 67% van de gebreken en op echte sites 37%. De uitkomst is gemeten tegen de sleutel van de testsite, niet tegen het oordeel van een menselijke deskundige.
- **Niets over de spreiding van de veegronde.** Alle runs werkten op dezelfde bevroren veegronde. Hoeveel twee volledige onderzoeken met elk een eigen veegronde verschillen, is niet gemeten.
- **Weinig over onterechte afkeuringen.** De schone variant is niet gedraaid. Op de variant met gebreken zijn alle negen criteria in elke run "voldoet niet", dus de toets op criteriumniveau maakt geen onderscheid.
- **Weinig herhalingen.** Twee runs van de nulmeting, twee van K en drie van S. Dat volstaat voor de vooraf vastgelegde regels, maar het interval van S is breed.
- **Een fout die in elke run terugkomt, maakt herhalen niet zichtbaar.** 1.4.12 viel in beide runs op dezelfde manier uit. Dat de oorzaak deels in de sleutel lag, kwam niet uit het herhalen maar uit het nameten van de testsite. Hoge overeenstemming is geen juistheid, en een sleutel is dat ook niet vanzelf.
