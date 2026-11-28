# loep

[![status: experimenteel](https://img.shields.io/badge/status-experimenteel-orange.svg)](#loep)

Wat loep is en hoe het werkt, in het kort: [toon.rijks.app/nldd/loep](https://toon.rijks.app/nldd/loep/).

loep neemt een website onder de loep: het maakt een toegankelijkheidsonderzoek en de toegankelijkheidsverklaring die erop steunt. Het instrument meet en legt bewijs vast; het oordeel is van de mens die het rapport aftekent. Het onderzoek toetst op WCAG 2.2 en WCAG 2.1, niveau A en AA, volgens WCAG-EM. Scripts verzamelen het bewijs, een taalmodel beoordeelt elk succescriterium volgens een vaste procedure en met meetinstrumenten, en één mens tekent voor de uitkomst.

De status is een werkend concept. De laatste meting van een hele versie is die van 0.35.0, op 18 november 2026 ([validatie/testsite/2026-11-17-meting-0.35.0/](validatie/testsite/2026-11-17-meting-0.35.0/uitkomst.md)). Op de testsite met 79 ingebouwde gebreken vond loep in twee runs alle 79, met dezelfde uitkomst bij alle 56 criteria. Op de schone tweeling keurde loep eerst 1.3.1 onterecht af, op een kop boven een lege lijst met zoekresultaten; na een aanpassing van die regel is 1.3.1 opnieuw gemeten en voldoet het. Drie andere afkeuringen op de tweeling noemen de vergelijkers discutabel, en drie criteria bleven open. Versies tussen twee metingen zijn uitgebracht zonder meting met agents; [CHANGELOG.md](CHANGELOG.md) zegt per versie waarom. De cijfers en wat ze niet zeggen staan in [validatie/iteraties.md](validatie/iteraties.md). Gemeten is steeds tegen de sleutel van de eigen testsite, niet tegen het oordeel van een menselijke deskundige; de vergelijking met bestaande onderzoeken van andere sites is alleen met een eerdere keten gedaan. Geen toezichthouder heeft zich over de methode uitgesproken. Lees [docs/methode.md](docs/methode.md) voordat je een rapport ergens voor gebruikt. In [voorbeelden/](voorbeelden/LEESMIJ.md) staat een conceptrapport van 11 oktober 2026 over nerds.digitaledienst.overheid.nl, niet afgetekend en niet nagelopen door het team van die site. Het is gemaakt met code van vóór de eerste versie (0.0.1, 14 oktober 2026); een rapport van nu ziet er op veel plekken anders uit.

## Waarom

Een overheidssite moet een toegankelijkheidsverklaring hebben met een onderzoek eronder. Zo'n onderzoek gebeurt meestal eens in de drie jaar, op een steekproef van een pagina of vijftien, en het rapport noemt alleen wat er mis is. Daartussen verandert de site elke week.

Deze toolbox draait het onderzoek zo vaak als je wilt, op alle pagina's van een kleine site, en legt bij elk criterium vast wat er is onderzocht en waarmee. Een goedkeuring krijgt een regel bewijs. Wat niet vast te stellen was, staat in het rapport als "kan niet bepalen".

## Gebruik met een AI-assistent

loep is gemaakt om door een AI-assistent te worden bediend. Je vraagt in gewone taal om een onderzoek; de assistent stelt een paar vragen, draait de stappen, start de agents en geeft je het rapport. In Claude Code haal je de skills binnen via de [marketplace van NLDD](https://github.com/NederlandseDigitaleDienst/ai-plugins):

```
/plugin marketplace add NederlandseDigitaleDienst/ai-plugins
/plugin install nldd-a11y@nldd
```

De plugin bevat de hele repository, ook de toolbox. De agent die de skill gebruikt runt het volgende om benodigde tools/pakketten/browsers/... te installeren op je machine.

```
just install        # pakketten en browsers
just tools          # met Homebrew alles; op Debian en Ubuntu wat de pakketbron heeft
just doctor         # wat staat er in welke versie, wat ontbreekt, wat is te oud
```

Zonder een hulpprogramma werkt de rest gewoon. De meting die het nodig heeft, meldt zich dan als niet beschikbaar en het criterium blijft open.

### Een onderzoek laten maken

Een adres is genoeg. Bijvoorbeeld:

- "Toets https://voorbeeld.nl op toegankelijkheid."
- "Maak een WCAG-onderzoek van onze site, als onderbouwing voor de toegankelijkheidsverklaring."
- "Toets de site die op http://localhost:4321 draait. Het is mijn eigen site, zet er tien agents tegelijk op."
- "Doe een heronderzoek van voorbeeld.nl; het vorige staat in `toegankelijkheid/onderzoeken/2026-04-01`."

De skill `nldd-a11y-audit` neemt het dan over. Voordat er iets draait, stelt de assistent in één bericht de vragen die alleen jij kunt beantwoorden, want daarna loopt het uren zonder jou:

- Staat de site, of een deel ervan, achter een inlog? Inloggen doe je straks zelf in een browservenster, met een testaccount. Geef de assistent nooit een wachtwoord.
- Mag het onderzoek formulieren of chatberichten versturen? Alleen op een testomgeving, en die verklaring geef je zelf, met naam en functie.
- Ben je eigenaar van de site, of mag het van de eigenaar met meer dan drie agents tegelijk?
- Hoort alles op het domein erbij, en zijn er sites die geen agent mag openen?
- Hoe heet de site in het rapport, van welke organisatie is ze, en is ze gebouwd met een designsysteem?

Wat je in je vraag al zei, vraagt hij niet opnieuw. Daarna zegt hij hoeveel pagina's er zijn, hoe lang het duurt en wat het kost volgens `audit estimate`. Een onderzoek van ongeveer 30 pagina's duurt 3 tot 7 uur, afhankelijk van hoeveel agents tegelijk mogen en hoe zwaar de pagina's zijn. Dan werkt hij zelf door, in de volgorde van [Hoe het werkt](#hoe-het-werkt). Hij onderbreekt je alleen als iets van jou afhangt, zoals een inlogsessie die verloopt.

Je krijgt per criterium de uitkomst, wie of wat haar vaststelde, en wat nog open is en waarom. Apart staan aanbevelingen: wat de site beter maakt maar de norm niet vraagt; ze tellen niet mee voor de uitkomst. Het rapport staat als concept in de map van de run. Wat daarna van jou is:

- Open punten die geen instrument kan sluiten (luisteren met een echte schermlezer, een besluit van de eigenaar), beantwoord je zelf. De assistent toont de punten. Het antwoord leg je zelf vast met `audit answer` in een terminal, of de assistent doet het in het gesprek, nadat je zijn samenvatting uitdrukkelijk hebt bevestigd; je bevestiging en de samenvatting komen dan letterlijk bij het antwoord.
- Je leest het rapport en tekent met `audit sign`, als het onderzoek een verklaring moet onderbouwen (het doel verantwoorden; een onderzoek om te verbeteren wordt niet getekend, zie [docs/methode.md](docs/methode.md#het-doel-van-het-onderzoek)). Tekenen doet nooit de assistent: je draait het commando zelf in een terminal en typt de eerste acht tekens van het zegel waarvoor je tekent. Hetzelfde geldt voor de verklaring dat een site een testomgeving is (`audit inventory --declared-by`): daar typ je de origin.
- Daarna loopt de assistent met je de gebreken langs, de zwaarste eerst: herken je het, wie gaat erover, en wat gaat er gebeuren? Wat je besluit en bevestigt, legt hij vast met `audit decide`, en het afgetekende rapport krijgt een hoofdstuk "Maatregelen en beslissingen". Bij elk antwoord, besluit en de handtekening zegt het rapport hoe het is vastgelegd: in een terminal of in een gesprek. Inloggen doe je altijd zelf; een wachtwoord geef je nooit aan de assistent.
- Bleef een criterium open door een gebrek in loep, dan schrijft de assistent een tekst voor een issue op deze repository, zonder adres of naam van de site. Er gaat niets weg zonder jouw ja.

### De verklaring laten maken

Na het tekenen en de besluiten per gebrek: "Maak de toegankelijkheidsverklaring bij het onderzoek in `toegankelijkheid/onderzoeken/2026-10-15`." De skill `nldd-a11y-statement` controleert of het onderzoek getekend en ongewijzigd is, neemt de maatregelen uit de besluiten, vraagt de gegevens van de organisatie (contact, klachten, ombudsman en data), en schrijft de verklaring volgens het wettelijke model met een invulblad voor het register. Wat je niet weet, blijft staan als `[nog invullen: ...]`. De status rekent de toolbox uit; publiceren doe je zelf.

### Bewaken dat het niet slechter wordt

"Zet in onze pipeline een check die zegt of de site slechter is geworden." De skill `nldd-a11y-quick` zet een snelle meting op zonder taalmodel: een lijst met pagina's, een basislijn, en een stap die faalt als een release meer fouten heeft dan de vorige. Ze vindt ongeveer een kwart van wat een onderzoek afkeurt, en vervangt het dus niet.

### Bijdragen aan loep

"Stuur het meetblad van dit onderzoek in." De skill `nldd-a11y-contribute` maakt van een afgerond onderzoek een meetblad: wat het onderzoek zegt over loep, zonder de site. Ze laat zien wat erop staat, vraagt of het mag en stuurt het in naar een besloten verzameling. Dat kan ook voor alle onderzoeken van vroeger in één keer. Uit die verzameling wordt gemeten hoe betrouwbaar elke regel van een regelset is.

De vijfde skill, `nldd-a11y`, wijst bij een algemene vraag ("hoe laat ik zien dat onze site toegankelijk is?") de weg naar de andere. Het hele verloop, met de vragen en wat je terugkrijgt, staat in [docs/gebruik.md](docs/gebruik.md).

## Hoe het werkt

1. `audit inventory` vindt alle pagina's, ook via links in shadow DOM, en telt per pagina wat erop staat. Het legt ook de documenten vast waar de site naar linkt (pdf, kantoorbestanden, platte tekst, epub, en elk ander bestand dat geen HTML is en dat een link met het download-attribuut aanbiedt of dat de browser als download opslaat): die op de site zelf met linktekst, grootte en datum, die op een ander domein alleen als telling. Een document waarvan het adres doorverwijst naar een ander domein, telt ook als document op een ander domein. Is de site over meer origins verdeeld, zoals documentatie op `https://docs.example.nl`, geef die dan mee met `--also-origin` (herhaalbaar): dan is het één onderzoek met één rapport, en tellen pagina's en documenten op elke opgegeven origin als die van de site.
2. `audit sample` kiest de pagina's. Staat dezelfde pagina onder meer dan één adres, dan telt ze één keer, op het adres van de pagina zelf en niet op een adres dat doorverwijst. Tot en met zestig unieke pagina's is dat de hele site. Documenten krijgen een eigen label (`D01`): tot en met twintig allemaal, daarboven een keuze per soort plus een willekeurig deel.
3. `audit explore` zet de opdracht klaar voor een verkenner: een agent die in kaart brengt welke paginatypen er zijn, wat over de pagina ligt, welke onderdelen pas na een handeling iets tonen en welke ingesloten vensters er zijn. Dat wordt het sitemodel. `audit check-site` speelt elk recept eruit af, probeert elk onderdeel op elk paginatype waarop het staat in het venster van de veegronde, en telt zelf wat er op elk paginatype te bedienen is; een formulier of bedieningsonderdeel dat het model mist, keurt het model af. Daarna trekt `audit sample` de steekproef opnieuw, omdat het sitemodel zegt welke adressen een venster van een derde zijn.
4. `audit collect` draait axe-core en Alfa in licht en donker, leest uit de browser wat hulpsoftware van elk element krijgt, loopt elke pagina door met de Tab-toets en meet reflow, zoom, tekstafstand en beweging. Het doet dat ook in de toestanden uit het sitemodel.
5. `audit contrast` meet het contrast van elk stuk tekst tegen de achtergrond die werkelijk getekend is.
6. `audit states` opent dialogen met het toetsenbord en verstuurt formulieren leeg, met foute invoer en zoals een bezoeker het doet (alleen het verplichte ingevuld), en legt vast of er een uitkomst was. Het verzoek naar de server wordt tegengehouden, behalve op een testomgeving die bij `audit inventory` is verklaard: daar gaat het formulier echt weg. Bij een kopieerknop legt het vast wat de pagina naar het klembord schrijft. `audit documents` haalt de documenten van de steekproef op en leest uit het bestand wat erin staat: tags, titel, taal, koppen, tekstalternatieven, tabellen, links, en bij een pdf de uitkomst van veraPDF.
7. `audit gate` is de bewijspoort: is het bewijs bruikbaar? Eerst vaste controles, dan een agent die per paginatype de beelden bekijkt; `audit check-gate` controleert zijn antwoorden. Is het bewijs onvoldoende, dan gaat de run terug naar stap 3, hooguit twee keer. Ontbreekt daarna nog iets, dan gaat de run toch door: wat ontbreekt, wordt een beperking die de beoordelaars zelf in hun sessie bekijken. Alleen als er niets te beoordelen is, omdat de site het onderzoek weigerde of meer dan de helft van de steekproef niet laadde, komt er geen beoordeling. Mislukte alleen een meting (een pagina die crashte of niet op tijd antwoordde, een schermafbeelding die ontbreekt), dan draait eerst de veegronde opnieuw; dat telt niet als terugkeer.
8. `audit tasks` zet per fase de opdrachten klaar. Eerst loopt per paginatype een agent de pagina door en noteert wat opvalt (de rondgang). Dan beoordeelt per criterium een agent het bewijs, met eigen metingen via de instrumenten van de toolbox. Daarna controleert per criterium een tweede agent elke bevinding vanaf een verse pagina en schrijft het eindoordeel. Wat hij niet kan bevestigen, vervalt. Blijft een criterium daarna open door het onderzoek zelf (iets was niet gemeten, een proef stopte bij een grens, een budget was op), dan meet een afmaakronde met een ruimer budget wat ontbrak en komt tot een oordeel.
9. `audit evaluate` voegt de oordelen samen. Daarna weegt één agent alle bevindingen: hij legt per bevinding vast welke groepen bezoekers ze hindert en bij welke kerntaak; `audit check-weigh` controleert dat en `audit weigh` leidt er de ernst uit af. Dan schrijft een agent de samenvatting voor de leiding waarmee het rapport opent (`audit summarize`, `audit check-summary`), en legt een tweede agent elke zin ervan naast het rapport (`audit check-reading`). `audit render` en `statement` maken het rapport (Markdown, HTML, een volledige pdf en een korte pdf zonder bijlage A), de conceptverklaring en het invulblad voor het register.
10. `audit seal` legt de hash van elk bestand van het onderzoek vast. Een mens leest het rapport en tekent met `audit sign` voor precies dat zegel. `audit verify` maakt elke wijziging achteraf zichtbaar.
11. `audit decide` legt na het tekenen per gebrek vast wat de organisatie besluit: opgelost, gepland met een datum, een andere zienswijze, onevenredige last of nog niet besloten. De besluiten staan naast het zegel, als eigen laag met een eigen hash; `audit render` zet ze in het afgetekende rapport en `statement` neemt er de maatregelen uit.
12. `audit publish` zet het rapport klaar om online te zetten: per site een map met elke ronde en een index, met alleen wat het rapport toont. Met `--toon <groep>/<site>` komt die map ook op Toon, als preview of met `--live`.

De stappen 1, 2, 4, 5 en 6 gebruiken geen taalmodel. Waar een agent werkt, handelt en meet die alleen via de instrumenten van de toolbox, met vaste opdrachten onder versiebeheer uit [templates/](templates/) en [procedures/](procedures/README.md). Elke uitspraak wijst naar een vastgelegde waarneming.

Een tweede keer `audit collect`, `audit contrast` of `audit states` meet alleen wat veranderd is; `--fresh` meet alles opnieuw. Een oordeel waarvan het bewijs, de procedure, de opdracht of een aangehaalde waarneming is veranderd, komt vanzelf terug in `audit pending`; alleen dat wordt opnieuw gedaan.

Staat de site, of een deel ervan, achter een inlog, dan logt een mens eerst in met `audit login`. Er opent een browservenster, je logt in met een testaccount en de toolbox bewaart de sessie in de run. Het wachtwoord komt niet bij de toolbox en niet bij een agent. Daarna begint elke browser van het onderzoek ingelogd, vindt `audit inventory` de pagina's door links te volgen, en wordt een link of knop die uitlogt nooit gevolgd. Verloopt de sessie, dan stopt de stap met een melding en gaat hij verder na een nieuwe `audit login`. Op een echte site kan dat alleen op een verklaarde testomgeving; zie [docs/methode.md](docs/methode.md).

De overige commando's:

| Commando | Waarvoor |
|---|---|
| `audit pending` | Zegt in welke fase de run is en welke opdrachten nog open staan, met de grootste opdracht eerst, en of de site een storing heeft (`siteOutage`) |
| `audit estimate` | Rekent uit hoe lang de run naar verwachting duurt, per onderdeel en in totaal, met een marge, en de tokens per rol en de kosten met de prijzen van de API; toont wat al gemeten is ernaast. Zie [docs/methode.md](docs/methode.md#hoe-lang-een-onderzoek-duurt) |
| `audit gaps` | Verzamelt de open punten van een of meer runs, per soort en per criterium, voegt gelijke punten samen en telt ze: de werklijst voor wie de veegronde verbetert. `just gaps <run> [<run> ...]`; met `--json` voor wie verder rekent |
| `audit mail` | Alleen met `audit inventory --mailbox`. `audit mail wait` wacht op mail aan het adres van de run en geeft de persoonlijke links, met een vervanging op de plek van het token. `audit mail links` geeft de links zoals ze nu zijn, zonder de mailbox te openen. `audit mail register` geeft een sessie een eigen testaanmelding met een eigen adres, waarin een agent ook mag afmelden. `audit mail cleanup` verwijdert na de meting alle testaanmeldingen via de site, wist de mail en doorzoekt de run op tokens. Zie "Een mailbox" in [docs/methode.md](docs/methode.md). |
| `audit secrets` | Wat een run weet over haar geheimen, per bron, en wat daar rond gebeurde: vondsten en weigeringen van de grens. Nooit een waarde. Zie "Afscherming van geheimen" in [docs/methode.md](docs/methode.md). |
| `audit feedback` | Schrijft een tekst voor een issue op deze repository voor elk criterium dat open bleef door loep zelf, en ook voor een criterium met een oordeel waarbij een proef niet werkte. Zonder adres of naam van de site, met een titel die van run tot run gelijk blijft. Verstuurt niets. `just feedback <run> --out <map>` |
| `audit check-walk`, `audit check-verdict` | Controleren de kandidaten van een rondgang en een oordeel; de agent die het schreef draait ze zelf |
| `audit skip`, `audit unskip` | `audit skip` legt vast dat een rondgang of oordeel niet komt, zodat de volgende fase kan beginnen, met de soort "geen geldig resultaat" of "storing" (het model was er niet: een limiet of een storing van de dienst). `audit unskip` zet zo'n opdracht terug |
| `audit answer` | Legt het antwoord van een persoon vast op een open punt dat geen instrument kan sluiten: wat is gedaan of besloten, wat dat betekent voor het criterium, en in welke functie. De naam blijft in een bestand van de run; het rapport noemt de functie. Zie [docs/methode.md](docs/methode.md#wat-een-mens-moet-vaststellen) |
| `audit merge`, `audit check-merge` | De stap naar keuze die voorstelt welke bevindingen nog meer bij elkaar horen |
| `audit weigh`, `audit check-weigh` | De stap die per bevinding vastlegt welke groepen bezoekers ze hindert, waarna de ernst daaruit volgt |
| `audit summarize`, `audit check-summary`, `audit check-reading` | De samenvatting voor de leiding waarmee het rapport opent: één agent schrijft haar uit de tekst van het rapport, een controle houdt haar aan het rapport, en een tweede agent legt elke zin naast het rapport |
| `add` | Zet een site in de backlog: url, organisatie, naam, en wat de skill anders zou moeten vragen. Een wachtwoord vraagt het nooit |
| `run` | Werkt de backlog af, één site per keer, met één regie per site. `--sites <n>`, `--only <site>`, `--new` |
| `status`, `log`, `pause`, `resume` | `status` zegt van elke site in welke stand ze staat, of van één site met de vraag die er ligt; `log` toont wat de regie deed; `pause` zet een site stil en `resume` gaat verder waar een mens iets deed |
| `doctor` | Controleert wat een run nodig heeft: node, de toolbox, de werkstroom, de pluginversie, vlam-claude, de VLAM-routes, de vrije schijfruimte en de backlog |
| `dev diff` | Legt twee evaluaties van dezelfde site naast elkaar: opgelost, gebleven en nieuw, als werkdocument `verschil.md` |
| `dev compare` | Legt een onderzoek naast een bestaand onderzoek van dezelfde site; zie [validatie/README.md](validatie/README.md) |
| `dev meting` | Meet de twee testwebsites van loep door, met agents, en zet de rapporten in `~/onderzoeken/meting/`; zie [docs/harnas.md](docs/harnas.md) |
| `dev procedures` | Controleert de procedures |
| `session` | De browsersessie van een agent: `session start`, `session stop`, `session list`, `session extend` (de agent verlengt zijn eigen budget, hooguit twee keer), en elk commando daarin als `session <commando>` (`session open P01`, `session look`, `session contrast 3`) |

`node toolbox/src/cli.ts --help` noemt de lagen van de toolbox. `node toolbox/src/cli.ts audit --help` geeft de stappen van een onderzoek met hun opties, `node toolbox/src/cli.ts dev --help` het gereedschap voor wie aan loep werkt. `session`, `audit voiceover`, `audit mail` en `dev compare --findings` hebben een eigen `--help`. Wie meerdere sites achter elkaar wil laten onderzoeken zonder erbij te zitten, zet ze in de backlog met `add` en laat het harnas ze afwerken met `run`: één regie per site, en een vraag aan een mens waar alleen een mens kan beslissen. Zie [docs/harnas.md](docs/harnas.md). Buiten een onderzoek ijkt `just calibrate` de instrumenten, en `audit voiceover` beheert de virtuele Mac met VoiceOver (zie [docs/voiceover.md](docs/voiceover.md)).

## Zonder assistent

Dezelfde stappen draai je ook met de hand. Een onderzoek, in volgorde:

```
just explore https://voorbeeld.nl runs/voorbeeld   # pagina's vinden, opdracht voor de verkenner
just sweep runs/voorbeeld                         # na de verkenner: meten en de bewijspoort
just tasks runs/voorbeeld                         # opdrachten voor de agents, en wat nog open staat
just estimate runs/voorbeeld                      # op elk moment na de eerste stap: hoe lang het nog duurt
just report runs/voorbeeld "Voorbeeld" "Gemeente Voorbeeld" "<model>"
just render runs/voorbeeld                        # na de weegagent: de weging toepassen, het rapport maken en verzegelen
```

`just report` maakt de evaluatie en de opdracht voor de agent die de bevindingen weegt. Daarna schrijft `just render` in `<run>/report/` het rapport als `rapport.md`, `rapport.html` en `rapport.pdf`, en `rapport-kort.pdf` zonder bijlage A, en verzegelt de run. Dat rapport is een concept; na `audit sign` schrijft `audit render` het afgetekende rapport in `<run>/signed/`. Het rapport is van de organisatie die het uitbrengt en heeft geen logo of huisstijl van de toolbox. Het zegt alleen waar het vandaan komt: op het voorblad staat "Gemaakt met loep" met de versie, en de commit als de toolbox uit een git-repository draaide; onderaan elke pagina staat de versie. De verklaring en het werkdocument `verschil.md` zeggen hetzelfde.

Tussen die stappen werken agents. Na `audit explore` is dat een verkenner, na `audit tasks` zijn het rondgangen, beoordelaars, verifieerders en zo nodig een afmaakronde, en na `report` weegt één agent de bevindingen. Wil je dat het rapport opent met een samenvatting voor de leiding, draai dan na de weegagent eerst `audit weigh` en de stappen van `audit summarize` uit [Hoe het werkt](#hoe-het-werkt), en daarna `just render`; zonder samenvatting opent het rapport zoals loep het schrijft. In Claude Code doet de skill `nldd-a11y-audit` dat stap voor stap, met deze commando's; zie [skills/nldd-a11y-audit/SKILL.md](skills/nldd-a11y-audit/SKILL.md). De werkstroom voor de agents staat ernaast in `skills/nldd-a11y-audit/onderzoek.workflow.js`. `just status <run>` zegt in welke fase een run is, `just verify <run>` rekent de hashes na en `just diff <vorige>/evaluation.json <nieuwe>/evaluation.json <map>` schrijft het verschil met een eerder onderzoek. `just` zonder iets toont alle taken.

Wie bij elke release wil weten of de site slechter is geworden, gebruikt `quick`, met de hand of in een pipeline. Het meet zonder taalmodel en zonder agents, in een paar minuten, en vergelijkt met de vorige meting:

```
just quick https://voorbeeld.nl runs/snel --urls paginas.txt --baseline vorige/summary.json
```

Dat is geen onderzoek: het vindt ongeveer een kwart van wat een onderzoek afkeurt. Zie [docs/gebruik.md](docs/gebruik.md#een-snelle-meting-in-een-pipeline).

Nodig: Node 22.18 of nieuwer en `just`. Voor de pdf van het rapport `typst`; voor pdf-bestanden van de site `poppler`, `qpdf` en `verapdf`; voor tekst in beeld `tesseract`; voor video en geluid `ffmpeg` en `whisper-cpp`; voor geldige HTML en veraPDF ook Java. `just doctor` zegt wat ontbreekt, toont de versie van elk hulpprogramma en de sha256 van het spraakmodel, en waarschuwt waar de toolbox een nieuwere versie nodig heeft (Node 22.18, typst 0.14, qpdf 11, Java 11).

Duur en kosten: een onderzoek van ongeveer 30 pagina's met alle criteria duurt 3 tot 7 uur en kost in de orde van 150 tot 250 dollar aan prijzen van de API. Dat volgt uit de nulmeting van 19 oktober 2026: 134 agents op Opus 5.5, ongeveer 526 miljoen tokens, waarvan 97 procent uit de cache, voor ongeveer 184 dollar ([validatie/verbruik/README.md](validatie/verbruik/README.md)). Op een abonnement kan zo'n run een groot deel van de weeklimiet gebruiken; hoe groot die limiet is, verschilt per abonnement. `just estimate <run>` rekent het voor een run uit, per rol en met een marge. Een herhaling na een wijziging kost naar rato van wat er veranderd is.

Wie aan de toolbox werkt: `just check` controleert de types, `just test` draait de tests, `just procedures` controleert de procedures en `just reuse` gaat na dat elk bestand een rechthebbende en een licentie heeft. Bij elk voorstel en elke push naar `main` draait een snelle controle zonder browsertests; de volledige controle draait op een schone machine in de merge queue, elke nacht na een wijziging en met de hand. `just testsite` serveert de testsite met ingebouwde gebreken; zie [toolbox/fixtures/README.md](toolbox/fixtures/README.md). De documentatie staat in [docs/](docs/README.md). Hoe de toolbox is opgezet en hoe je hem uitbreidt, staat in [docs/architectuur.md](docs/architectuur.md).

## Wat het niet doet

- Het test niet met een echte schermlezer of andere hulpsoftware. Wat hulpsoftware krijgt, is afgelezen uit de toegankelijkheidsboom van Chromium. Een agent kan laten voorlezen door een nagebootste schermlezer die de standaard volgt; wat een echte anders doet, laat die niet zien. Is een virtuele Mac met VoiceOver ingericht en gestart, dan laten de agents van een onderzoek daar zelf mee voorlezen waar de nagebootste lezer het niet kan vaststellen; het rapport noemt dan VoiceOver met Safari en de versies. NVDA en JAWS niet. Dat is optioneel, vraagt eigen inrichting en staat in [docs/voiceover.md](docs/voiceover.md).
- De veegronde meet in één browser (Chromium). Alleen de naam en rol (in WebKit), de Tab-volgorde (in WebKit en Firefox) en reflow, vergroten en tekstafstand (in WebKit) worden in een andere browser herhaald, en alleen waar een agent die zelf meet.
- Een ingesloten venster (iframe), zoals een videospeler of een robotvak van een derde, onderzoekt het voor een deel. Een agent bedient en meet wat erin staat, en het sitemodel zegt per venster of het meetelt en waarom. De vaste proeven met formulieren, knoppen, toetsen en aanwijzen doen hun werk in een venster dat meetelt op de pagina waar het staat; lukt een proef daar niet, dan staat dat in de dekking. Dit is op geen echte site gemeten.
- Het logt niet zelf in. Een mens logt in met `audit login` en een testaccount, en op een echte site alleen op een verklaarde testomgeving. Onderzocht is dan wat één account in één rol te zien krijgt. Het inloggen zelf wordt niet beoordeeld (3.3.8), en hoe lang een sessie geldig blijft, meet alleen de sessieproef als de mens een tweede keer inlogt.
- Formulieren verstuurt het alleen op de eigen machine of op een testomgeving die vooraf is opgegeven, en ook daar begrensd: op een testomgeving ten hoogste 5 keer per run met minstens 120 seconden ertussen, op de eigen machine ten hoogste 50 keer zonder wachttijd, tenzij bij `audit inventory` anders is opgegeven (`--max-writes`); op een echte site wordt elk verzoek dat iets kan wijzigen tegengehouden.
- Een route met een e-mailbevestiging maakt het alleen af met een mailbox (`audit inventory --mailbox`), in een run die mag versturen. Tegen een echte IMAP-aanbieder is dit nog niet gedraaid: IMAP is getest tegen lokale servers, Mailpit tegen een lokale site. Geheimen, uit een mail of uit een inlogsessie, komen niet in de browser en niet in de run: een proxy op de eigen machine wisselt ze, in elke browser die aantoont dat hij erdoorheen gaat. WebKit doet daarom niet mee aan een lokale run met geheimen. Zie "Afscherming van geheimen" in [docs/methode.md](docs/methode.md). Na afloop ruimt `audit mail cleanup` de testaanmeldingen en de mail op, en het rapport zegt het als er iets achterbleef.
- Documenten beoordeelt het voor een deel. Het leest pdf, docx, odt, pptx, odp, xlsx, ods, platte tekst (Markdown, txt, csv, ics, vcf) en een png- of jpg-bestand waar een link met eigen tekst naartoe wijst, als ze op de site zelf staan, en beoordeelt ze op elf criteria (tekstalternatieven, structuur, leesvolgorde, afbeeldingen van tekst, titel, linktekst, koppen, taal, naam van formuliervelden, en parsen uit WCAG 2.1). Het leest wat in het bestand staat: er is geen kantoorpakket en geen schermlezer, en van een kantoorbestand is er geen beeld. Niet ingelezen worden doc, xls, ppt, rtf en epub, documenten op een ander domein, en documenten die niet voor de steekproef zijn gekozen; het rapport noemt de aantallen. De bewijspoort meldt een document uit de steekproef waarvan niets is gemeten en een document dat tegen een grens van loep liep, en waarschuwt bij een pdf met tags waarvan de tekst per tag niet is gelezen. Dit deel is door tests gedekt en op geen echte site gedraaid.
- Video en geluid worden beluisterd en bekeken als het bestand op te halen is (spraak naast ondertitels en paginatekst, beelden, flitsen). Dat geldt ook voor een speler in een ingesloten venster, als die een bestand afspeelt dat op te halen is. Of een audiodescriptie goed genoeg is blijft een oordeel, de flitsmeting is een benadering van de norm, en een stream of live-uitzending blijft open.
- Het kan niet controleren welk taalmodel draaide. Elke agent geeft bij de start van zijn sessie zelf zijn model op; het rapport toont dat per rol, naast wat de uitvoerder opgaf.
- Het vult het register niet in, en zet een rapport alleen online als iemand erom vraagt (`audit publish --toon`, als preview tenzij `--live` is gegeven).
- Of het register van toegankelijkheidsverklaringen een onderzoek met loep aanvaardt als onderbouwing van status A of B, is niet bevestigd: BZK en Logius is dat nog niet gevraagd. Een verklaring met status A of B op een loep-rapport publiceer je op eigen risico, en `statement` zegt dat er dan bij.

De volledige lijst van beperkingen, en wat alleen door tests is gedekt, staat in [docs/methode.md](docs/methode.md).

## Verwant werk

[wcag-reporter](https://gitlab.com/digilab.overheid.nl/research/wcag-reporter) van Digilab is een ander open hulpmiddel voor toegankelijkheidsonderzoek bij de overheid.

## Meewerken

De afspraken voor wie aan de toolbox werkt, en wat nooit mag, staan in [CONTRIBUTING.md](CONTRIBUTING.md); wat er loopt, wat hierna komt en welke besluiten openstaan in [PLAN.md](PLAN.md). Hoe besluiten vallen staat in [GOVERNANCE.md](GOVERNANCE.md), waar je met een vraag terechtkunt in [SUPPORT.md](SUPPORT.md), en hoe je een kwetsbaarheid meldt in [SECURITY.md](SECURITY.md). Voor iedereen die meedoet geldt de [gedragscode van de Nederlandse Digitale Dienst](https://github.com/NederlandseDigitaleDienst/.github/blob/main/CODE_OF_CONDUCT.md).

## Licentie

Code en tekst vallen onder EUPL-1.2, zie [LICENSE.md](LICENSE.md). De lettertypes Atkinson Hyperlegible en Noto Emoji in `templates/fonts/` vallen onder OFL-1.1, en de titels van de succescriteria in `toolbox/data/wcag22-nl.json` zijn tekst van het W3C. Per bestand staat het in [REUSE.toml](REUSE.toml), de licentieteksten staan in `LICENSES/`, en `just reuse` controleert het.
