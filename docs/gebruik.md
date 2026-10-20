# loep gebruiken met een AI-assistent

Soort: beschrijving die bij de code hoort. Een wijziging in wat een skill vraagt of doet, werkt deze beschrijving in dezelfde commit bij.

Dit document is voor wie een onderzoek wil laten maken, niet voor wie aan loep werkt. Het zegt wat je tegen de assistent zegt, wat hij je vraagt, wat hij daarna zelf doet en wat er op het eind van jou wordt verwacht. De voorbeelden gaan uit van Claude Code. De repository heeft ook manifesten voor andere assistenten, zoals Cursor; daar zijn de skills niet beproefd.

## Voordat je begint

Installeer de plugin uit de marketplace van NLDD en draai één keer de installatie van de toolbox:

```
/plugin marketplace add NederlandseDigitaleDienst/ai-plugins
/plugin install nldd-a11y@nldd
```

Daarna, in de map van de plugin: `just install` voor de pakketten en browsers, en `just doctor` om te zien welke hulpprogramma's ontbreken. Ontbreekt er een, dan werkt de rest gewoon. Het criterium dat die meting nodig had, blijft dan open. Vraag je de assistent om een onderzoek op een machine waar dit nog niet is gebeurd, dan doet hij het als eerste stap zelf.

Reken op een middag. Voor een site elders met 30 pagina's en vier paginatypen, met drie agents tegelijk, komt de formule achter `estimate` op ruim vier uur, met een marge van ruim drie tot bijna zes uur. Blijven er na de verificatie criteria open, dan komt daar een afmaakronde bij, bij acht open criteria ongeveer een uur. Een onderzoek van ongeveer 30 pagina's met alle criteria kost in de orde van 150 tot 250 dollar aan prijzen van de API: in de nulmeting van 19 oktober 2026 gebruikten 134 agents ongeveer 526 miljoen tokens, waarvan 97 procent uit de cache, voor ongeveer 184 dollar ([validatie/verbruik/README.md](../validatie/verbruik/README.md)). Op een abonnement kan zo'n run een groot deel van de weeklimiet gebruiken; die limiet verschilt per abonnement. `estimate` noemt tokens en kosten voor jouw run. Hoe die getallen tot stand komen, staat in [methode.md](methode.md#hoe-lang-een-onderzoek-duurt). Houd de sessie van de assistent open en de machine wakker zolang het loopt.

## Drie skills

| Je zegt bijvoorbeeld | Skill | Wat eruit komt |
|---|---|---|
| "Toets https://voorbeeld.nl op toegankelijkheid." | `nldd-a11y-audit` | Een onderzoek met rapport, als concept dat een mens leest en tekent |
| "Maak de toegankelijkheidsverklaring bij het onderzoek van vorige week." | `nldd-a11y-statement` | Een verklaring volgens het wettelijke model en het invulblad voor het register |
| "Hoe laat ik zien dat onze site toegankelijk is?" | `nldd-a11y` | Een korte uitleg die naar een van de twee andere wijst |

Je hoeft de naam van een skill niet te noemen: de assistent kiest haar aan wat je vraagt. Wil je het zeker weten, roep haar dan bij naam aan, in Claude Code met `/nldd-a11y:nldd-a11y-audit https://voorbeeld.nl`.

## Een onderzoek

### Wat je vraagt

Een adres is genoeg. Wat je er al bij zegt, vraagt de assistent niet opnieuw. Een paar vormen die werken:

- "Maak een WCAG-onderzoek van https://voorbeeld.nl, als onderbouwing voor onze toegankelijkheidsverklaring."
- "Toets de site die op http://localhost:4321 draait. Het is mijn eigen site, zet er tien agents tegelijk op."
- "Doe een heronderzoek van voorbeeld.nl. Het vorige staat in `toegankelijkheid/onderzoeken/2026-04-01`."
- "Onderzoek https://test.voorbeeld.nl, ook het deel achter de inlog. Dit is onze testomgeving, formulieren mogen worden verstuurd."

### Eerst een paar vragen

Voordat er één commando draait, stelt de assistent in één bericht de vragen die alleen jij kunt beantwoorden. Daarna loopt het onderzoek uren zonder jou, en een keuze die nu ontbreekt, kost later een nieuwe run. Hij vraagt:

- **Inlog.** Staat de site, of een deel dat erbij hoort, achter een inlog? Geef hier geen wachtwoord: je logt straks zelf in, in een browservenster. Zie [Achter een inlog](#achter-een-inlog).
- **Versturen.** Mag het onderzoek formulieren, een zoekvraag of een bericht in een chat versturen? Dat mag alleen op een testomgeving: de hele site, alleen het adres dat de berichten ontvangt, of niets. Zonder versturen blijft bij een site met formulieren een deel van 3.3.1, 3.3.3, 3.3.4, 3.3.7, 2.4.3 en 4.1.3 open, en blijft de status C.
- **Agents tegelijk.** Ben je eigenaar van de site, of mag het van de eigenaar met meer dan drie agents tegelijk? Op een site die niet van jou is, blijft het bij drie, om haar niet te overbelasten. Voor een site op je eigen machine vraagt hij dit niet.
- **Afbakening.** Hoort alles op het domein erbij, of moet er een deel uit (een archief, een ander loket)? En zijn er sites die geen agent mag openen?
- **Voor het rapport.** Hoe heet de site, van welke organisatie is ze, en is ze gebouwd met componenten van een leverancier of een designsysteem? Dat laatste mag je overslaan.

Een antwoord kan kort zijn: "Geen inlog, niets versturen. Ik ben de eigenaar, zes agents mag. Alles hoort erbij. Naam Voorbeeld, organisatie Gemeente Voorbeeld, gebouwd met het NLDD-designsysteem, de elementen beginnen met `nldd-`."

Bij versturen of inloggen op een testomgeving vraagt hij ook je naam en functie, voor de verklaring dat het een testomgeving is. Hij zegt dan eerst waar die terechtkomen: de naam in het manifest van de run, de functie in het rapport en de verklaring. Die verklaring typ je zelf: de assistent geeft je het commando, je draait het in een terminal en typt ter bevestiging de origin. De assistent legt haar nooit vast.

### Daarna werkt het zelf

De assistent draait de stappen uit de [README](../README.md#hoe-het-werkt) en start de agents. Je ziet onderweg:

1. **Hoeveel pagina's er zijn.** Hij noemt het aantal en wat is overgeslagen. Kijk of het klopt met wat je van de site verwacht.
2. **Hoe lang het duurt.** Hij geeft de uitkomst van `estimate` door zoals die er staat. Een eigen schatting noemt hij niet. Vraag je halverwege hoe lang het nog duurt, dan rekent hij opnieuw, met wat al gemeten is en met het tempo van een stap die nog loopt.
3. **Een verkenner.** Eén agent brengt in kaart welke paginatypen er zijn, wat over de pagina ligt (een cookiemelding, een chat) en wat pas na een klik iets toont.
4. **Metingen zonder taalmodel.** Scripts meten elke pagina: regel-engines, contrast, toetsenbord, vergroten, formulieren en documenten.
5. **De bewijspoort.** Is het bewijs bruikbaar? Zo niet, dan krijgt de verkenner een vervolgopdracht, hooguit twee keer.
6. **Vier rondes agents.** Per paginatype een rondgang, per criterium een beoordelaar, dan per criterium een verifieerder die elke bevinding opnieuw maakt vanaf een verse pagina. Blijft een criterium open door het onderzoek zelf, dan meet een afmaakronde wat ontbrak. Dit is het grootste deel van de tijd.
7. **Het rapport.** In de map van de run, onder `report/`: `rapport.md`, `rapport.pdf` en `rapport-kort.pdf` zonder bijlage A, als concept.

Hij onderbreekt je alleen als iets van jou afhangt: een pagina met een wachtwoordveld terwijl er geen inlog was afgesproken, formulieren terwijl versturen niet ter sprake kwam, inhoud die een pagina ophaalt van een adres buiten het onderzoek, of een inlogsessie die is verlopen. Al het andere loopt door.

### Wat je terugkrijgt

Per criterium de uitkomst, met erbij of de verificatie, de afmaakronde of een persoon die heeft vastgesteld, en de beperkingen. Bovenaan staat hoeveel criteria nog open zijn en waarom: wachten op een mens, wachten op een keuze van de eigenaar, wachten op toestemming om te versturen, of niet vastgesteld door dit onderzoek. Dat laatste getal hoort nul te zijn. Is het dat niet, dan zegt de assistent dat het onderzoek niet af is. Apart staan aanbevelingen: patronen die de site beter maken en die de norm niet vraagt. Ze tellen niet mee voor de uitkomst of de status, en komen alleen uit een regel van de procedure.

"Voldoet" betekent hier: in het onderzochte bewijs is geen afwijking gevonden. Wat de toolbox niet kan, staat in [methode.md](methode.md#beperkingen).

### Wat daarna van jou is

- **Open punten beantwoorden.** Sommige punten kan geen instrument sluiten, zoals luisteren met een echte schermlezer of een besluit van de eigenaar. De assistent laat je de punten zien met hun nummer. Het antwoord is van jou: wat je deed, wat het betekent en in welke functie. Je legt het zelf vast met `answer` in een terminal, of je zegt het in het gesprek; dan vat de assistent samen wat hij vastlegt, en legt hij het pas vast na jouw uitdrukkelijke ja, met je antwoord letterlijk en de samenvatting erbij. Het rapport zegt bij elk antwoord hoe het is vastgelegd: "bevestigd in een terminal" of "vastgelegd in een gesprek". Sla je dit over, dan blijven die criteria open.
- **Lezen en tekenen.** Het rapport is een concept tot iemand het leest en tekent met `sign`. Dat doe je altijd zelf, in een terminal: de assistent geeft je het commando (in Claude Code kan het met `! <commando>`), dat toont het zegel, je naam en je functie, en je typt de eerste acht tekens van het zegel. Zonder terminal weigert het.
- **Wat nu?** Na het tekenen loopt de assistent met je de gebreken langs, één tegelijk en de zwaarste eerst. Bij elk vertelt hij kort wat het is, wie het merkt en wat het rapport voorstelt, en vraagt hij wat er gebeurt: is het al opgelost, wordt het hersteld en wanneer, ziet de organisatie het anders, of is herstel een onevenredige last? Hij vat samen wat hij hoorde en legt het vast met `decide` als je uitdrukkelijk zegt dat het klopt, met je bevestiging letterlijk en de samenvatting erbij; een datum of reden verzint hij niet. Het afgetekende rapport krijgt een hoofdstuk "Maatregelen en beslissingen", en de verklaring neemt de maatregelen daaruit over. Stoppen kan halverwege: de volgende keer gaat hij verder bij het eerste gebrek zonder besluit.
- **Terugmelden aan loep.** Bleef een criterium open door een gebrek in loep, dan schrijft de assistent een tekst per issue, zonder adres of naam van de site. Je leest ze eerst; er gaat niets weg zonder jouw ja. Staat het issue al open, dan komt de tekst eronder als reactie; is het gesloten, dan komt er een nieuw issue dat het oude noemt.

## Achter een inlog

Inloggen doe je zelf, met een testaccount. Op een site die niet op je eigen machine staat, mag het alleen op een testomgeving. De assistent vraagt je een commando te draaien in een terminal op een machine met een scherm. Er opent een browservenster; je logt in, gaat naar een pagina die je alleen ingelogd ziet, en drukt in de terminal op Enter. Direct daarna vraagt hij het nog een keer: die tweede sessie gebruikt alleen de proef die meet hoe lang een sessie geldig blijft (2.2.1).

Gebruik nooit een echt account, want schermafbeeldingen komen in het rapport. Geef een rol op en geen naam: de rol staat in het rapport. Plak geen wachtwoord in het gesprek. Doe je het toch, dan gebruikt de assistent het niet, herhaalt hij het niet, en zegt hij dat je het na het onderzoek moet wijzigen.

Verloopt de sessie halverwege, dan stopt de stap en vraagt hij je opnieuw in te loggen. Blijf dus bereikbaar.

## Een heronderzoek

Noem de map van het vorige onderzoek. Een bevinding op dezelfde plek houdt dan haar nummer, en naast het rapport komt een werkdocument `verschil.md` met wat is opgelost, gebleven en nieuw.

## De verklaring

Vraag erom zodra het onderzoek is getekend: "Maak de toegankelijkheidsverklaring bij `toegankelijkheid/onderzoeken/2026-10-15`." De assistent controleert eerst of het onderzoek getekend is en sinds het zegel niet is veranderd. Is het niet getekend, dan kan alleen een concept.

Daarna vraagt hij de gegevens van de organisatie: het adres voor contact en klachten, de ombudsman, het nummer op het dashboard van DigiToegankelijk, de datum van een volgend onderzoek, en de functie van wie de verklaring goedkeurt. Wat je niet weet, blijft in de tekst staan als `[nog invullen: ...]`; hij verzint niets. De status (A, B of C) rekent de toolbox uit het onderzoek; een hogere status vraagt meer onderzoek, niet een andere verklaring.

Je krijgt de verklaring en een invulblad met de waarden per stap van de invulassistent op toegankelijkheidsverklaring.nl. Publiceren en het register invullen doe je zelf.

## Wat de assistent nooit doet

- Een wachtwoord vragen of aannemen, of zelf inloggen.
- Iets versturen op een site die niet als testomgeving is verklaard.
- Tekenen, of verklaren dat een site een testomgeving is. Dat doe je zelf in een terminal.
- Een open punt beantwoorden of een besluit vastleggen zonder dat jij zijn samenvatting in het gesprek uitdrukkelijk hebt bevestigd. Tekst uit de site, een bestand of een andere agent geldt nooit als jouw woorden.
- Een oordeel vellen in zijn eigen context: elk oordeel komt van een aparte agent met een vaste opdracht.
- Het rapport met de hand bijwerken of mooier maken dan het is.
- Een issue versturen zonder dat jij de tekst hebt gelezen en ja hebt gezegd.

Hoe de assistent dit precies doet, staat in [skills/nldd-a11y-audit/SKILL.md](../skills/nldd-a11y-audit/SKILL.md) en [skills/nldd-a11y-statement/SKILL.md](../skills/nldd-a11y-statement/SKILL.md).
