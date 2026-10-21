# Verbruik van een onderzoek

Hoeveel tokens een onderzoek kost, waar ze heen gaan, en een voorstel om dat omlaag te brengen zonder dat het oordeel slechter wordt. De cijfers komen uit één onderzoek; elke stap van het voorstel wordt eerst gemeten zoals onder "Hoe we meten" staat.

## De nulmeting

Een onderzoek van een echte site in oktober 2026, met loep 0.10.0 uit de plugin, ongewijzigd. Alle agents draaiden op Claude Opus 5.5, tien tegelijk. De steekproef had 31 pagina's in 16 paginatypen en 19 pdf's; alle 56 criteria van WCAG 2.2 A en AA.

De werkstroom had 134 agents en duurde 94 minuten. Geteld uit de transcripts van Claude Code, elk bericht één keer:

| Rol | Agents | Invoer | Naar de cache geschreven | Uit de cache gelezen | Uitvoer | Aandeel in de tokens |
|---|---|---|---|---|---|---|
| Beoordelaars | 56 | 4.808 | 7,29 M | 294,1 M | 261.342 | 57% |
| Verifieerders | 56 | 3.308 | 5,21 M | 153,6 M | 179.471 | 30% |
| Rondgangen | 16 | 1.552 | 1,38 M | 59,7 M | 75.575 | 12% |
| Afmaakronde | 1 | 74 | 0,12 M | 3,7 M | 5.669 | 1% |
| Stand | 5 | 20 | 0,21 M | 0,2 M | 11.774 | 0% |

Samen 526 miljoen tokens, waarvan 97% uit de cache gelezen. De verkenner en de agents van de bewijspoort, buiten de werkstroom, kwamen daar nog 27 miljoen bij.

Tokens zeggen weinig over de kosten, want een token uit de cache kost een fractie van een gewoon token. Met de prijzen van de API voor Opus 5.5 op 19 oktober 2026 (invoer 4 dollar per miljoen, schrijven naar de cache voor 5 minuten 5 dollar, lezen uit de cache 0,20 dollar, uitvoer 20 dollar; [prijzen](https://platform.claude.com/docs/en/about-claude/pricing)) kostte de werkstroom ongeveer 184 dollar:

| Soort | Kosten | Aandeel |
|---|---|---|
| Uit de cache gelezen | 102 dollar | 56% |
| Naar de cache geschreven | 71 dollar | 39% |
| Uitvoer | 11 dollar | 6% |

## Waar het verbruik zit

1. **Elke beurt leest de hele context opnieuw.** Het verbruik van een agent volgt het aantal beurten (correlatie 0,98 tot 0,99 in elke rol), niet de omvang van zijn opdracht (0,34 bij de beoordelaars). Een beoordelaar deed gemiddeld 43 beurten en las per beurt gemiddeld 122.000 tokens uit de cache. Alles wat vroeg in de context komt, wordt dus tientallen keren opnieuw gelezen, en alles wat er in een beurt bij komt, wordt één keer naar de cache geschreven.
2. **Het opdrachtbestand is groot.** `beoordeel.md` en `verifieer.md` zijn 58 tot 65 KB, ongeveer 30.000 tokens. Daarvan is ongeveer 50 KB voor elk criterium bijna gelijk: de gereedschapstabel (18 KB), de vorm van het oordeel (19 KB) en de regels voor het oordeel (6 KB). Het eigen deel van het criterium, de procedure, is ongeveer 11 KB. Het bestand past niet in één keer lezen: 55 van de 56 beoordelaars en 55 van de 56 verifieerders lazen het in twee delen.
3. **Het dossier wordt met eigen scripts verkend.** Een `dossier.json` is 0,2 tot 0,6 MB. De agents zochten de opbouw zelf uit met losse Python-scripts: 975 aanroepen met samen 4,4 miljoen tekens uitvoer, de grootste soort uitvoer van het hele onderzoek. Een uitvoer boven de grens van de shell komt in een apart bestand, dat de agent daarna nog eens leest. De zwaarste beoordelaar (1.1.1) besteedde zo zijn eerste 29 beurten grotendeels aan het dossier.
4. **Elke beurt begint met ongeveer 38.000 vaste tokens:** de instructies en het gereedschap van de agent zelf. De helft daarvan komt uit een cache die de agents delen. Bij de rondgangen is die voorloop 48% van wat uit de cache wordt gelezen, bij de beoordelaars 30%. Daar gaat loep niet over.
5. **Beelden tellen weinig.** Een schermafbeelding kost ongeveer 1.500 tokens; een beoordelaar bekeek er gemiddeld tien.
6. **Een paar procent van de aanroepen mislukt** (2,5 tot 3%), bijvoorbeeld een Python-script dat een beeld wil bijsnijden zonder de bibliotheek daarvoor, of een rondgang die `check-walk` afkeurt. Bijna alle worden in de volgende beurt opnieuw geprobeerd.

## Voorstel

Uitgangspunt: de agent krijgt dezelfde informatie, maar in minder ruimte of pas op het moment dat hij haar nodig heeft. Het oordeel, de procedures en de controles blijven gelijk. De schattingen hieronder komen uit de transcripts van de nulmeting en zijn nog niet gemeten.

1. **Het dossier opvragen met een commando.** Een commando `dossier` in de sessie geeft een overzicht van de onderdelen van het dossier met hun omvang, en per onderdeel, pagina of toestand de inhoud in een compacte vorm. Er valt niets weg: lange uitvoer komt in delen, met "deel n van N", en de toelichtingen (`*Nl`, `note`, `examined`) blijven altijd staan. `check-verdict` weigert een oordeel "voldoet" als een onderdeel dat het criterium nodig heeft niet helemaal is gelezen, want de opdracht zegt dat de agent het dossier helemaal leest. Het opdrachtbestand noemt welke onderdelen voor het criterium tellen, zodat de agent de opbouw niet zelf hoeft uit te zoeken. Verwacht: veel minder Python-, `jq`- en `cat`-aanroepen en minder beurten aan het begin. Gemeten in de transcripts: de uitvoer rond het dossier (scripts, `jq`, `cat` en de bestanden met te lange uitvoer), maal het aantal beurten waarin ze daarna opnieuw is gelezen, is 27% van wat de beoordelaars uit de cache lazen en 19% bij de verifieerders. Schatting als het commando die uitvoer half tot twee derde kleiner maakt: 10 tot 20% minder lezen uit de cache.
2. **Het opdrachtbestand in een kern en naslag.** De kern bevat de hoofdregel, de regels voor het oordeel, de werkwijze, de procedure van het criterium, een korte lijst van de commando's met één regel per commando, en de regels voor het meten die nu onder "Vorm van het oordeel" staan: twee keer opnieuw proberen voor `niet bereikbaar`, ingevulde waarden vastleggen bij 3.3.x, letterlijk citeren, en wat elke soort open punt betekent. Alleen het skelet van het oordeel in JSON en de uitleg per commando gaan naar de naslag, die de agent leest als hij ze nodig heeft. `check-verdict` controleert de vorm al en zegt wat er mis is. Gemeten op dezelfde manier: het opdrachtbestand is 28% van wat de beoordelaars uit de cache lazen en 39% bij de verifieerders. Omdat de regels voor het meten in de kern blijven, gaat minder naar de naslag dan de helft van het bestand. Schatting: 5 tot 10% minder lezen uit de cache.
3. **Gereedschap dat nu mislukt.** Een commando dat een stuk uit een bestaande schermafbeelding snijdt (`crop` werkt nu alleen op een element van de open pagina), zodat de agent geen eigen script nodig heeft. Dat uitsnijden wordt een waarneming zoals elke andere, met de schermafbeelding van de veegronde waar het uit komt. En de meldingen van `check-walk` zo dat de rondgang het in één keer goed doet; omdat een duidelijke melding ook kan leiden tot een rondgang die alleen het vakje afvinkt, meet de meting of de rondgangen evenveel kandidaten vinden. Schatting: 1 tot 3%, vooral minder beurten.
4. **De volgorde van de opdrachten** (#106) kost niets en levert in een naspeling van de nulmeting ongeveer elf minuten doorlooptijd op, geen tokens.
5. **Een goedkoper model per rol, waar de meting dat toelaat.** De werkstroom kan per agent een model meegeven (`agent(..., { model })` in `onderzoek.workflow.js`); dat wordt een keuze per rol, met Opus als standaard. Sonnet 5.5 kost in elke soort precies de helft van Opus 5.5. Haiku 5.5 is veel goedkoper, maar wordt boven 100.000 tokens per beurt vijf keer duurder, en in de nulmeting lag de gemiddelde context per beurt daarboven bij 37 van de 56 beoordelaars en bij 11 van de 56 verifieerders. De volgorde van meten loopt van weinig naar veel risico voor het oordeel:
    1. de stand-agent, die alleen commando's draait, op Haiku;
    2. de rondgangen op Sonnet: die verzamelen waarnemingen en oordelen niet;
    3. de verifieerders op Sonnet: die zoeken tegenbewijs bij een oordeel dat er al ligt;
    4. de beoordelaars blijven op Opus, tenzij een meting laat zien dat Sonnet tot dezelfde oordelen komt.

   Een rol gaat pas over als de meting hieronder dat toelaat. Een lichter model kan meer beurten nodig hebben; ook dat laat de meting zien.

   De werkstroom heeft hiervoor de instelling `models`, bijvoorbeeld `models: { walks: "sonnet" }` (rollen `stand`, `walks`, `judges`, `verifiers`, `finishers`; modellen `opus`, `sonnet`, `haiku`). Zonder instelling draait de stand-agent op Haiku en elke andere agent op het model van de sessie. Het resultaat van de werkstroom noemt per rol het model, zodat een meting de varianten uit elkaar houdt.

Niet in dit voorstel, omdat het het werk zelf verandert en een eigen besluit vraagt:

- kleinere budgetten per agent;
- minder verifieerders, bijvoorbeeld geen verifieerder bij een criterium zonder kandidaten.

## Wat het oplevert

Per onderzoek van de omvang van de nulmeting, met de prijzen van de API van 19 oktober 2026, alleen de werkstroom. De verkenner en de agents van de bewijspoort komen er bij elk scenario nog bij, samen enkele dollars op Opus.

| Rol | Nu (Opus) | Op Sonnet |
|---|---|---|
| Beoordelaars | 100 dollar | 50 dollar |
| Verifieerders | 60 dollar | 30 dollar |
| Rondgangen | 20 dollar | 10 dollar |
| Stand en afmaakronde | 3 dollar | 1,5 dollar |
| **Samen** | **184 dollar** | **92 dollar** |

| Scenario | Per onderzoek | Besparing |
|---|---|---|
| Nu | 184 dollar | |
| A. Stap 1 tot en met 3, zelfde model | 157 tot 170 dollar | 8 tot 15% |
| B. A, en de rondgangen op Sonnet | 147 tot 160 dollar | 13 tot 20% |
| C. B, en de verifieerders op Sonnet | 121 tot 132 dollar | 28 tot 34% |
| D. A, en alles op Sonnet | 79 tot 85 dollar | 54 tot 57% |

Bij tien onderzoeken per jaar is dat 1.840 dollar nu, 1.210 tot 1.320 dollar bij scenario C en 790 tot 850 dollar bij scenario D. Met een abonnement in plaats van de API gaat het niet om dollars maar om de grens van het gebruik: dan passen er bij scenario C bijna anderhalf keer zoveel onderzoeken in dezelfde ruimte.

Hoe de cijfers zijn gemaakt:

- De rekenbasis is de nulmeting, per rol: wat uit de cache is gelezen, naar de cache is geschreven, en de uitvoer, maal de prijs.
- Stap 1 tot en met 3 verlagen in deze schatting alleen het lezen uit de cache bij beoordelaars en verifieerders, met 15 tot 30%: de drie schattingen hierboven, na elkaar toegepast. Minder beurten verlaagt ook het schrijven naar de cache; dat is niet meegeteld.
- Een rol op Sonnet halveert de kosten van die rol, bij hetzelfde aantal beurten. Neemt Sonnet meer beurten, dan is de besparing kleiner.
- Haiku voor de stand-agent scheelt ongeveer 1 dollar en staat daarom niet apart in de tabel.

Scenario D is de bovengrens. Of de beoordelaars op Sonnet even goed oordelen, is de vraag met het grootste risico voor de kwaliteit. Scenario C is wat redelijkerwijs haalbaar lijkt zonder dat risico.

## Hoe we meten

Het doel was dat een stap pas naar `main` gaat als een meting laat zien dat het oordeel niet slechter is geworden. Dat is niet gehaald: stap 1, het commando `dossier`, staat al op `main` zonder die meting. De meting hieronder zegt nu of een stap blijft. De grenzen daarvoor staan vast voordat de variant wordt gemeten.

1. **Bevroren code.** Per variant een eigen werkboom op een vaste commit: de nulmeting op de commit van vóór de stap, de variant op de commit met de stap. Een ander model voor een rol is ook een variant, op dezelfde commit.
2. **Bevroren bewijs.** De veegronde draait één keer. Elke variant werkt op een kopie van die run en draait alleen de rondgangen, beoordelaars, verifieerders en de afmaakronde opnieuw. Zo komt een verschil van de variant, en niet van een andere veegronde.
3. **De testsite, met gebreken en schoon.** Met de sleutel weten we welke gebreken er zijn (79 gebreken en 19 valkuilen). De variant met gebreken laat zien of een gebrek wordt gemist; de schone variant laat zien of er gebreken worden gemeld die er niet zijn.
4. **Negen criteria** met `tasks --only`: de vijf zwaarste uit de nulmeting (1.1.1, 4.1.2, 1.4.11, 3.1.2, 1.3.1) en vier uit andere hoeken die gebreken in de sleutel hebben: contrast (1.4.3), toetsenbord (2.1.1), focusvolgorde (2.4.3) en foutmeldingen (3.3.1). Een criterium zonder gebreken in de sleutel zegt weinig over gemiste gebreken.
5. **Drie keer per variant,** ook de nulmeting, omdat twee runs van dezelfde code al verschillen. Per gebrek uit de sleutel tellen we in hoeveel van de drie runs het is gevonden.
6. **Niet slechter, binnen een marge:** twee runs van dezelfde code verschillen al, dus een variant hoeft niet precies dezelfde uitkomsten te geven. Hij is niet slechter als hij, met 95% zekerheid, hooguit 5 procentpunt minder gebreken uit de sleutel vindt dan de nulmeting, en minder dan één melding per run meer doet die beide agents van `compare --findings` onterecht noemen. De marges staan vast voordat de variant wordt gemeten; hoe ze worden berekend, staat onder "Met welke commando's". Daarnaast tellen we wat zegt hoe het werk ging: open punten per soort, eigen metingen van de agent, weigeringen van `check-verdict`, oordelen die de verifieerder omdraait, en of ernst en plek kloppen met de sleutel. Pas dan tellen tokens per soort, kosten, beurten en duur per agent.
7. **Ook op een groot dossier.** De testsite is klein. De variant die de meting doorstaat, draait daarom ook op de bevroren run van de nulmeting, en een persoon bekijkt elk verschil met de oordelen van toen.
8. **Wat de testsite nog mist:** pdf's met tags, één met gebreken en één zonder, voor de criteria die op documenten worden beoordeeld; en voor een verifieerder op een lichter model fouten die we er zelf in leggen, om te zien of hij ze vindt.
9. **Daarna één volledig onderzoek** op een echte site met de stappen die de meting doorstonden, en de vergelijking met deze nulmeting.

De uitkomst komt in `validatie/iteraties.md` en `validatie/lessen.md`, zoals bij elke meting.

### Met welke commando's

`LOEP` is `node toolbox/src/cli.ts` in de werkboom van de variant. Elk commando hieronder heeft uitleg bij `LOEP variant --help`.

| Stap | Hoe |
|---|---|
| 1. Bevroren code | Een eigen werkboom per variant op een vaste commit. Draai alles hieronder met de toolbox uit die werkboom. |
| 2. Bevroren bewijs | De veegronde één keer, van `inventory` tot en met `gate`. Daarna per run een kopie: `LOEP variant --run RUN --out KOPIE --name <variant>`. De kopie houdt de veegronde en laat weg wat de agents schreven: opdrachten, rondgangen, oordelen met hun stempels, hun sessies, werkmappen en recepten, en de evaluatie, het rapport en de vergelijkingen. In `variant.json` staat van welke run de kopie is, met welke code ze is gemaakt en wat is weggelaten. Op een Mac kost een kopie bijna geen schijfruimte. |
| 3. Met gebreken en schoon | Een veegronde op elke variant van de testsite. De sleutel is `toolbox/fixtures/reference-lindewaard.json` of `reference-berkenveen.json`. |
| 4. Negen criteria | `LOEP tasks --run KOPIE --only 1.1.1,4.1.2,1.4.11,3.1.2,1.3.1,1.4.3,2.1.1,2.4.3,3.3.1`, dan de fasen zoals `pending` ze noemt, en `evaluate`. |
| 5. Drie keer | Drie kopieën per variant. Of een gebrek is gevonden, zeggen twee agents met `compare --findings` per run (zie [validatie/README.md](../README.md)). Ook dat kost tokens. |
| 6. Niet slechter | `LOEP compare-variants --baseline N1 --baseline N2 --baseline N3 --variant V1 --variant V2 --variant V3 --reference <sleutel> --out <map>`. Bovenaan "Niet slechter: ja" of "nee", met per toets de waarde van beide kanten, het verschil met zijn interval en de marge. Daaronder hoe goed de runs van elke kant overeenkomen, per criterium de uitkomst per run en de spreiding, per gebrek in hoeveel runs het is gevonden, de open punten per soort, en per rol de sessies, commando's en tijd. `varianten.md` is Markdown en kan zo in `validatie/`. Zonder `--variant` laat het zien hoe ver de runs van de nulmeting uit elkaar liggen. Alle runs moeten dezelfde criteria hebben; anders stopt het commando en noemt het de criteria die ze gemeen hebben. Met `--criteria 1.1.1,4.1.2,...` (zoals bij `tasks --only`) tellen alleen die criteria, in elke toets en tabel. Zo is een nulmeting op 56 criteria te vergelijken met varianten op de negen van stap 4: elk criterium heeft een eigen beoordelaar en verifieerder, dus die negen uit de grote run zijn een eerlijke nulmeting. Elke run moet dan opdrachten voor al die criteria hebben. |

**Bevroren bewijs op de testsite.** De veegronde voor een meting komt uit de regressietoets: `just sweep-check --out <map> --fixed-ports`. Die draait `inventory`, het vaste sitemodel uit `toolbox/fixtures/sweep/`, `check-site`, `sample`, `collect`, `contrast` en `states` op beide varianten, op de poorten van `just testsite` (4710, 4711 en 4712). De runs blijven staan in `<map>/runs/defect` en `<map>/runs/clean`, en met `just testsite` zijn hun adressen daarna weer te openen. Zonder `--fixed-ports` kiest de toets willekeurige poorten en is een run daarna niet meer bruikbaar. Het vaste model laat met opzet onderdelen dicht (formulieren, tabbladen, uitleg; zie `notOpenedNl` in `site.json`), omdat de toets kort moet blijven en geen gebrek uit de sleutel die toestanden vraagt. De bewijspoort ziet die als gaten en valt dus. Voor een meting draait daarom na de toets, met `just testsite` aan, een vervolgronde van de verkenner op elke run en daarna `just sweep <run>` tot en met de bewijspoort; pas dan gaat de run de kopieën van stap 2 in.

**De toets.** Beide kanten werken op dezelfde bevroren veegronde en worden aan dezelfde gebreken gemeten. De vergelijking is daarom gepaard:

- **Gevonden gebreken.** Per gebrek uit de sleutel het aandeel runs dat het vond, per kant. Het gemiddelde over de gebreken is het aandeel gevonden gebreken per run. Het interval komt uit een bootstrap: 10.000 keer trekken we met teruglegging evenveel gebreken als er zijn, met dezelfde gebreken voor beide kanten, en nemen het 2,5e en 97,5e percentiel van het verschil (variant min nulmeting). **Marge: de ondergrens van dat interval ligt boven -0,05.** Op de 79 gebreken van de testsite zijn 5 procentpunt ongeveer vier gebreken.
- **Onterecht volgens beide.** Een bevinding van een run zonder tegenhanger in de sleutel die beide agents van `compare --findings` `onterecht` noemen. Per criterium het gemiddelde per run, per kant; de som over de criteria is het aantal per run. Het interval komt uit dezelfde bootstrap, over de criteria. **Marge: de bovengrens van het verschil ligt onder 1**, dus minder dan één zulke melding per run meer dan de nulmeting. Op de schone variant van de testsite heeft de sleutel geen gebreken; daar beslist alleen deze toets.
- **Meldingen zonder tegenhanger** zijn alle bevindingen die niet beide agents bij een gebrek uit de sleutel zetten. De tabel van die naam telt ze per run: `terecht`, `discutabel` en `onterecht` volgens beide, en waar de agents verschillen beide klassen, bijvoorbeeld "oneens: discutabel / onterecht". Alleen "onterecht volgens beide" telt mee in de toets. Een melding die beide `terecht` noemen, is vaak een echt gebrek dat niet in de sleutel staat, zoals knoppen die alleen op `pointerdown` reageren en dus niet met het toetsenbord werken; een variant die er meer van vindt, wordt daar niet voor gestraft. Waar de agents het oneens zijn, telt de melding ook niet mee, zoals bij "gevonden".
- **Open punten** per run staan er met hetzelfde interval bij, ter informatie. Ze tellen niet mee in "ja" of "nee".

De marges staan in de code (`MARGIN` en `REPORT_MARGIN` in `toolbox/src/commands/variants.ts`) en zijn in te stellen met `--margin` en `--margin-reports`. De bootstrap gebruikt een vaste seed (`--seed`), zodat dezelfde runs altijd hetzelfde interval geven.

De marge van 0,05 is streng. Onder de negen criteria van stap 4 heeft de sleutel 29 gebreken. In een simulatie met drie runs per kant, waarin een vijfde van de gebreken in de ene run wel en in de andere niet wordt gevonden, haalt een variant die even goed is de marge maar ongeveer vier van de tien keer; bij 0,10 ongeveer acht van de tien keer. Meet daarom eerst de nulmeting, kijk hoe ver haar runs uit elkaar liggen, en leg dan de marge vast, voordat de variant wordt gemeten. Kies je een andere marge dan 0,05, zet die dan met de reden in `validatie/iteraties.md`.

**Spreiding per criterium.** Een uitkomst valt voor deze tabel in één van drie klassen: voldoet (ook niet van toepassing), voldoet niet, of open (kan niet bepalen, niet beoordeeld). Per criterium staat het aandeel paren runs met een andere klasse: binnen de nulmeting, binnen de variant, en tussen een run van elk. Ligt dat laatste niet boven de spreiding binnen de kanten, dan verschilt de variant op dat criterium niet meer dan de runs onderling. Voor de overeenstemming over alle criteria staan per kant het aandeel criteria met dezelfde klasse in alle runs en Fleiss' kappa (1 als alle runs gelijk zijn, rond 0 als ze niet meer overeenkomen dan toeval).

Een gebrek telt als gevonden als beide agents van `compare --findings` "gevonden" zeggen. Zijn ze het oneens, dan telt het niet als gevonden. Een run zonder geldige indeling telt niet mee; de tabel zegt dan hoeveel gebreken of runs zijn weggelaten.

Tokens en beurten staan niet in een run, alleen in de transcripts van de agents. `LOEP usage --transcripts <map> --run RUN --out <bestand>` telt ze uit de map van één werkstroom (in Claude Code `subagents/workflows/<werkstroom>` van de sessie, met per agent `agent-<id>.jsonl` en `agent-<id>.meta.json`). Elk assistent-bericht telt één keer. De rol en het criterium of paginatype komen uit de beschrijving van de agent (`judges 1.1.1`, `walks start`), het model uit zijn berichten; het commando weigert transcripts met een criterium waar de run geen opdracht voor heeft. Geef het bestand per run mee met `--usage <bestand>` (één rij per agent en model; zie het voorbeeld in `toolbox/test/fixtures/verbruik.json`). De kosten rekent `compare-variants` met de prijzen van Opus 5.5 hierboven en van Sonnet 5.5 (de helft); `usage` zet die prijzen ook in het bestand. Haiku heeft geen prijs, omdat het boven 100.000 tokens per beurt duurder wordt; zet die zelf onder `prices` als je hem wilt meetellen. Met `--criteria` telt "Verbruik per rol" alleen de beoordelaars, verifieerders en afmaakrondes van die criteria; rondgangen en de stand-agent werken voor de hele run en tellen helemaal mee. Wat stap 6 daarnaast noemt (eigen metingen van de agent, weigeringen van `check-verdict`, oordelen die de verifieerder omdraait, ernst en plek) telt het commando nog niet.

De meting zelf kost ook. Een run van negen criteria op de bevroren testsite kost ongeveer 25 tot 35 dollar op Opus en minder op Sonnet. Drie runs per variant voor de nulmeting en vier varianten op de variant met gebreken, en drie runs van de nulmeting en de gekozen variant op de schone variant, zijn 21 runs: samen ongeveer 500 tot 700 dollar, plus één run op het grote dossier. Bij scenario C is dat terugverdiend na negen tot twaalf onderzoeken. De meting levert ook op wat [PLAN.md](../../PLAN.md) toch al vraagt: hoeveel twee runs van dezelfde code verschillen.

## Gevraagd besluit

1. Akkoord met stap 1 tot en met 3 en de meting ervan op de testsite.
2. Akkoord om daarna Sonnet te meten voor de rondgangen en de verifieerders, en een rol alleen om te zetten als de meting dat toelaat.
3. Of de beoordelaars ook op Sonnet gemeten moeten worden (scenario D), of op Opus blijven.

## Begrippen

- **Beurt:** één antwoord van een agent, meestal met één aanroep van een commando. Bij elke beurt leest het model de hele context opnieuw.
- **Cache:** het deel van de context dat al eerder is verwerkt. Lezen daaruit is goedkoop, schrijven ernaar iets duurder dan gewone invoer.
- **Rondgang, beoordelaar, verifieerder, afmaakronde:** de vier rollen van de werkstroom (zie [docs/methode.md](../../docs/methode.md)). De stand-agent vraagt tussen de fasen alleen op wat er nog te doen is.
- **Dossier:** het bestand met alle metingen van de veegronde die een criterium nodig heeft.
- **Sleutel:** de lijst van gebreken die in de testsite zijn ingebouwd.
