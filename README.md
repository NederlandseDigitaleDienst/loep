# loep

[![status: experimenteel](https://img.shields.io/badge/status-experimenteel-orange.svg)](#loep)

loep neemt een website onder de loep: het maakt een toegankelijkheidsonderzoek en de toegankelijkheidsverklaring die erop steunt. Het instrument meet en legt bewijs vast; het oordeel is van de mens die het rapport aftekent. Het onderzoek toetst op WCAG 2.2 en WCAG 2.1, niveau A en AA, volgens WCAG-EM. Scripts verzamelen het bewijs, een taalmodel beoordeelt elk succescriterium volgens een vaste procedure en met meetinstrumenten, en één mens tekent voor de uitkomst.

De status is een werkend concept. De huidige keten is gemeten op een testsite met ingebouwde gebreken, op de variant daarvan zonder die gebreken en op één echte site; de cijfers en wat ze niet zeggen staan in [validatie/iteraties.md](validatie/iteraties.md). De laatste meting is een kleine, op zeventien criteria, van 11 oktober 2026: [uitkomst.md](validatie/testsite/2026-10-11-kleine-meting/uitkomst.md). Wat daarna is gebouwd en alleen door tests is gedekt, staat in [validatie/lessen.md](validatie/lessen.md). De vergelijking met bestaande onderzoeken van andere sites is alleen met een eerdere keten gedaan; die cijfers staan in hetzelfde logboek. Geen toezichthouder heeft zich over de methode uitgesproken. Lees [docs/methode.md](docs/methode.md) voordat je een rapport ergens voor gebruikt. Hoe een rapport van de keten van nu eruitziet, staat in [voorbeelden/](voorbeelden/LEESMIJ.md): het conceptrapport van de derde meting op de eigen site, niet afgetekend en niet nagelopen door het team van die site.

## Waarom

Een overheidssite moet een toegankelijkheidsverklaring hebben met een onderzoek eronder. Zo'n onderzoek gebeurt meestal eens in de drie jaar, op een steekproef van een pagina of vijftien, en het rapport noemt alleen wat er mis is. Daartussen verandert de site elke week.

Deze toolbox draait het onderzoek zo vaak als je wilt, op alle pagina's van een kleine site, en legt bij elk criterium vast wat er is onderzocht en waarmee. Een goedkeuring krijgt een regel bewijs. Wat niet vast te stellen was, staat in het rapport als "kan niet bepalen".

## Hoe het werkt

1. `inventory` vindt alle pagina's, ook via links in shadow DOM, en telt per pagina wat erop staat. Het legt ook de documenten vast waar de site naar linkt (pdf, kantoorbestanden, platte tekst, epub, en elk ander bestand dat geen HTML is en dat een link met het download-attribuut aanbiedt): die op de site zelf met linktekst, grootte en datum, die op een ander domein alleen als telling.
2. `sample` kiest de pagina's. Tot en met zestig unieke pagina's is dat de hele site. Documenten krijgen een eigen label (`D01`): tot en met twintig allemaal, daarboven een keuze per soort plus een willekeurig deel.
3. `explore` zet de opdracht klaar voor een verkenner: een agent die in kaart brengt welke paginatypen er zijn, wat over de pagina ligt, welke onderdelen pas na een handeling iets tonen en welke ingesloten vensters er zijn. Dat wordt het sitemodel. `check-site` speelt elk recept eruit af en telt zelf wat er op elk paginatype te bedienen is; een formulier of bedieningsonderdeel dat het model mist, keurt het model af. Daarna trekt `sample` de steekproef opnieuw, omdat het sitemodel zegt welke adressen een venster van een derde zijn.
4. `collect` draait axe-core en Alfa in licht en donker, leest uit de browser wat hulpsoftware van elk element krijgt, loopt elke pagina door met de Tab-toets en meet reflow, zoom, tekstafstand en beweging. Het doet dat ook in de toestanden uit het sitemodel.
5. `contrast` meet het contrast van elk stuk tekst tegen de achtergrond die werkelijk getekend is.
6. `states` opent dialogen met het toetsenbord en verstuurt formulieren leeg, met foute invoer en zoals een bezoeker het doet (alleen het verplichte ingevuld), en legt vast of er een uitkomst was. Het verzoek naar de server wordt tegengehouden. Bij een kopieerknop legt het vast wat de pagina naar het klembord schrijft. `documents` haalt de documenten van de steekproef op en leest uit het bestand wat erin staat: tags, titel, taal, koppen, tekstalternatieven, tabellen, links, en bij een pdf de uitkomst van veraPDF.
7. `gate` is de bewijspoort: is het bewijs bruikbaar? Eerst vaste controles, dan een agent die per paginatype de beelden bekijkt; `check-gate` controleert zijn antwoorden. Is het bewijs onvoldoende, dan gaat de run terug naar stap 3, hooguit twee keer. Blijft het onvoldoende, dan komt er geen beoordeling.
8. `tasks` zet per fase de opdrachten klaar. Eerst loopt per paginatype een agent de pagina door en noteert wat opvalt (de rondgang). Dan beoordeelt per criterium een agent het bewijs, met eigen metingen via de instrumenten van de toolbox. Daarna controleert per criterium een tweede agent elke bevinding vanaf een verse pagina en schrijft het eindoordeel. Wat hij niet kan bevestigen, vervalt. Blijft een criterium daarna open door het onderzoek zelf (iets was niet gemeten, een proef stopte bij een grens, een budget was op), dan meet een afmaakronde met een ruimer budget wat ontbrak en komt tot een oordeel.
9. `evaluate`, `render` en `statement` maken het rapport (Markdown, een volledige pdf en een korte pdf zonder bijlage A), de conceptverklaring en het invulblad voor het register.
10. `seal` legt de hash van elk bestand van het onderzoek vast. Een mens leest het rapport en tekent met `sign` voor precies dat zegel. `verify` maakt elke wijziging achteraf zichtbaar.

De stappen 1, 2, 4, 5 en 6 gebruiken geen taalmodel. Waar een agent werkt, handelt en meet die alleen via de instrumenten van de toolbox, met vaste opdrachten onder versiebeheer uit [templates/](templates/) en [procedures/](procedures/README.md). Elke uitspraak wijst naar een vastgelegde waarneming.

Een tweede keer `collect`, `contrast` of `states` meet alleen wat veranderd is; `--fresh` meet alles opnieuw. Een oordeel waarvan het bewijs, de procedure, de opdracht of een aangehaalde waarneming is veranderd, komt vanzelf terug in `pending`; alleen dat wordt opnieuw gedaan.

Staat de site, of een deel ervan, achter een inlog, dan logt een mens eerst in met `login`. Er opent een browservenster, je logt in met een testaccount en de toolbox bewaart de sessie in de run. Het wachtwoord komt niet bij de toolbox en niet bij een agent. Daarna begint elke browser van het onderzoek ingelogd, vindt `inventory` de pagina's door links te volgen, en wordt een link of knop die uitlogt nooit gevolgd. Verloopt de sessie, dan stopt de stap met een melding en gaat hij verder na een nieuwe `login`. Op een echte site kan dat alleen op een verklaarde testomgeving; zie [docs/methode.md](docs/methode.md).

De overige commando's:

| Commando | Waarvoor |
|---|---|
| `pending` | Zegt in welke fase de run is en welke opdrachten nog open staan |
| `estimate` | Rekent uit hoe lang de run naar verwachting duurt, per onderdeel en in totaal, met een marge en het aantal tokens; toont wat al gemeten is ernaast. Zie [docs/methode.md](docs/methode.md#hoe-lang-een-onderzoek-duurt) |
| `gaps` | Verzamelt de open punten van een of meer runs, per soort en per criterium, voegt gelijke punten samen en telt ze: de werklijst voor wie de veegronde verbetert. `just gaps <run> [<run> ...]`; met `--json` voor wie verder rekent |
| `check-walk`, `check-verdict` | Controleren de kandidaten van een rondgang en een oordeel; de agent die het schreef draait ze zelf |
| `skip` | Legt vast dat een rondgang of oordeel niet komt, zodat de volgende fase kan beginnen |
| `answer` | Legt het antwoord van een persoon vast op een open punt dat geen instrument kan sluiten: wat is gedaan of besloten, wat dat betekent voor het criterium, en in welke functie. De naam blijft in een bestand van de run; het rapport noemt de functie. Zie [docs/methode.md](docs/methode.md#wat-een-mens-moet-vaststellen) |
| `merge`, `check-merge` | De stap naar keuze die voorstelt welke bevindingen nog meer bij elkaar horen |
| `diff` | Legt twee evaluaties van dezelfde site naast elkaar: opgelost, gebleven en nieuw, als werkdocument `verschil.md` |
| `compare` | Legt een onderzoek naast een bestaand onderzoek van dezelfde site; zie [validatie/README.md](validatie/README.md) |
| `procedures` | Controleert de procedures |
| `session` | De browsersessie van een agent: `session start`, `session stop`, `session list`, `session extend` (de agent verlengt zijn eigen budget, hooguit twee keer), en elk commando daarin als `session <commando>` (`session open P01`, `session look`, `session contrast 3`) |

`node toolbox/src/cli.ts --help` toont elk commando met zijn opties.

## Gebruik

De skills haal je in Claude Code binnen via de [marketplace van NLDD](https://github.com/NederlandseDigitaleDienst/ai-plugins):

```
/plugin marketplace add NederlandseDigitaleDienst/ai-plugins
/plugin install nldd-a11y@nldd
```

De plugin bevat de hele repository, ook de toolbox. Eén keer, in de map van de plugin of van je eigen kopie van de repository:

```
just install        # pakketten en browsers
just tools          # met Homebrew alles; op Debian en Ubuntu wat de pakketbron heeft
just doctor         # wat staat er in welke versie, wat ontbreekt, wat is te oud
```

Zonder een hulpprogramma werkt de rest gewoon. De meting die het nodig heeft, meldt zich dan als niet beschikbaar en het criterium blijft open.

Een onderzoek, in volgorde:

```
just explore https://voorbeeld.nl runs/voorbeeld   # pagina's vinden, opdracht voor de verkenner
just sweep runs/voorbeeld                         # na de verkenner: meten en de bewijspoort
just tasks runs/voorbeeld                         # opdrachten voor de agents, en wat nog open staat
just estimate runs/voorbeeld                      # op elk moment na de eerste stap: hoe lang het nog duurt
just report runs/voorbeeld "Voorbeeld" "Gemeente Voorbeeld" "<model>"
```

`just report` schrijft in `<run>/report/` het rapport als `rapport.md` en `rapport.pdf`, en `rapport-kort.pdf` zonder bijlage A, en verzegelt de run. Dat rapport is een concept; na `sign` schrijft `render` het afgetekende rapport in `<run>/signed/`. Het rapport is van de organisatie die het uitbrengt en heeft geen logo of huisstijl van de toolbox. Het zegt alleen waar het vandaan komt: op het voorblad staat "Gemaakt met loep" met versie en commit, onderaan elke pagina met de versie. De verklaring en het werkdocument `verschil.md` zeggen hetzelfde.

Tussen die stappen werken agents: een verkenner na `explore`, en rondgangen, beoordelaars, verifieerders en zo nodig een afmaakronde na `tasks`. In Claude Code doet de skill `nldd-a11y-audit` dat stap voor stap, met deze commando's; zie [skills/nldd-a11y-audit/SKILL.md](skills/nldd-a11y-audit/SKILL.md). De werkstroom voor de agents staat ernaast in `skills/nldd-a11y-audit/onderzoek.workflow.js`. `just status <run>` zegt in welke fase een run is, `just verify <run>` rekent de hashes na en `just diff <vorige> <nieuwe> <map>` schrijft het verschil met een eerder onderzoek. `just` zonder iets toont alle taken.

Nodig: Node 22.18 of nieuwer en `just`. Voor de pdf van het rapport `typst`; voor pdf-bestanden van de site `poppler`, `qpdf` en `verapdf`; voor tekst in beeld `tesseract`; voor video en geluid `ffmpeg` en `whisper-cpp`; voor geldige HTML en veraPDF ook Java. `just doctor` zegt wat ontbreekt, toont de versie van elk hulpprogramma en de sha256 van het spraakmodel, en waarschuwt waar de toolbox een nieuwere versie nodig heeft (Node 22.18, typst 0.14, qpdf 11, Java 11).

Beoordelen en verifiëren kostte in de drie volledige metingen met de huidige keten 9 tot 14 miljoen tokens per site; zie [validatie/iteraties.md](validatie/iteraties.md). Een herhaling na een wijziging kost naar rato van wat er veranderd is.

Wie aan de toolbox werkt: `just check` controleert de types, `just test` draait de tests, `just procedures` controleert de procedures en `just reuse` gaat na dat elk bestand een rechthebbende en een licentie heeft. Dezelfde controles draaien bij elke push naar `main` en bij elk voorstel op een schone machine. `just testsite` serveert de testsite met ingebouwde gebreken; zie [toolbox/fixtures/README.md](toolbox/fixtures/README.md). De documentatie staat in [docs/](docs/README.md). Hoe de toolbox is opgezet en hoe je hem uitbreidt, staat in [docs/architectuur.md](docs/architectuur.md).

## Wat het niet doet

- Het test niet met een echte schermlezer of andere hulpsoftware. Wat hulpsoftware krijgt, is afgelezen uit de toegankelijkheidsboom van Chromium. Een agent kan laten voorlezen door een nagebootste schermlezer die de standaard volgt; wat een echte anders doet, laat die niet zien. Is een virtuele Mac met VoiceOver ingericht en gestart, dan laten de agents van een onderzoek daar zelf mee voorlezen waar de nagebootste lezer het niet kan vaststellen; het rapport noemt dan VoiceOver met Safari en de versies. NVDA en JAWS niet. Dat is optioneel, vraagt eigen inrichting en staat in [docs/voiceover.md](docs/voiceover.md).
- De veegronde meet in één browser (Chromium). Alleen de naam en rol (in WebKit), de Tab-volgorde (in WebKit en Firefox) en reflow, vergroten en tekstafstand (in WebKit) worden in een andere browser herhaald, en alleen waar een agent die zelf meet.
- Een ingesloten venster (iframe), zoals een videospeler of een robotvak van een derde, onderzoekt het voor een deel. Een agent bedient en meet wat erin staat, en het sitemodel zegt per venster of het meetelt en waarom. De vaste proeven met formulieren, knoppen, toetsen en aanwijzen doen hun werk in een venster dat meetelt op de pagina waar het staat; lukt een proef daar niet, dan staat dat in de dekking. Dit is op geen echte site gemeten.
- Het logt niet in. Formulieren verstuurt het alleen op de eigen machine of op een testomgeving die vooraf is opgegeven; op een echte site wordt elk verzoek dat iets kan wijzigen tegengehouden.
- Documenten beoordeelt het voor een deel. Het leest pdf, docx, odt, pptx, odp, xlsx, ods en platte tekst (Markdown, txt, csv) die op de site zelf staan, en beoordeelt ze op tien criteria (tekstalternatieven, structuur, leesvolgorde, afbeeldingen van tekst, titel, linktekst, koppen, taal, naam van formuliervelden). Het leest wat in het bestand staat: er is geen kantoorpakket en geen schermlezer, en van een kantoorbestand is er geen beeld. Niet ingelezen worden doc, xls, ppt, rtf en epub, documenten op een ander domein, en documenten die niet voor de steekproef zijn gekozen; het rapport noemt de aantallen. De bewijspoort controleert de documenten niet. Dit deel is door tests gedekt en op geen echte site gedraaid.
- Video en geluid worden beluisterd en bekeken als het bestand op te halen is (spraak naast ondertitels en paginatekst, beelden, flitsen). Of een audiodescriptie goed genoeg is blijft een oordeel, de flitsmeting is een benadering van de norm, en media in een speler van een derde blijft open.
- Het kan niet controleren welk taalmodel draaide. Elke agent geeft bij de start van zijn sessie zelf zijn model op; het rapport toont dat per rol, naast wat de uitvoerder opgaf.
- Het publiceert niets en vult het register niet in.

De volledige lijst van beperkingen, en wat alleen door tests is gedekt, staat in [docs/methode.md](docs/methode.md).

## Verwant werk

[wcag-reporter](https://gitlab.com/digilab.overheid.nl/research/wcag-reporter) van Digilab is een ander open hulpmiddel voor toegankelijkheidsonderzoek bij de overheid.

## Meewerken

De afspraken voor wie aan de toolbox werkt, en wat nooit mag, staan in [CONTRIBUTING.md](CONTRIBUTING.md); wat er loopt, wat hierna komt en welke besluiten openstaan in [PLAN.md](PLAN.md).

## Licentie

Code en tekst vallen onder EUPL-1.2, zie [LICENSE.md](LICENSE.md). De lettertypes Atkinson Hyperlegible in `templates/fonts/` vallen onder OFL-1.1, en de titels van de succescriteria in `toolbox/data/wcag22-nl.json` zijn tekst van het W3C. Per bestand staat het in [REUSE.toml](REUSE.toml), de licentieteksten staan in `LICENSES/`, en `just reuse` controleert het.
