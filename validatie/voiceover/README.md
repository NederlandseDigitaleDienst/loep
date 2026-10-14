# VoiceOver naast de nagebootste schermlezer

Eén meting van 13 oktober 2026 met het commando `voiceover` op twee eigen proefpagina's, naast `loep speak` op dezelfde pagina's. Het doel was niet dat ze gelijk zijn: de verschillen zijn wat een echte schermlezer toevoegt. Hoe het onderdeel werkt, staat in [../../docs/voiceover.md](../../docs/voiceover.md).

De pagina's: [proef.html](proef.html) heeft een knop, een veld met een gekoppelde foutmelding (`aria-describedby`, `aria-invalid`) en een statusgebied dat eerst `hidden` is. [status-leeg.html](status-leeg.html) heeft een statusgebied dat leeg in de pagina staat en daarna tekst krijgt.

Bronnen: `speak` is `@guidepup/virtual-screen-reader` 0.33.0 in Chromium. VoiceOver is die van macOS 26.4 met Safari 26.4 in de virtuele Mac, met de voorkeuren waarmee het wordt geleverd, aangestuurd met zijn eigen commando's en toetsen.

| Geval | `speak` (nagebootst) | `voiceover read` (VoiceOver) |
|---|---|---|
| Knop | `button, Verstuur` | `Verstuur button` |
| Veld met fout | `textbox, E-mailadres, Vul een geldig e-mailadres in, invalid` | `E-mailadres Vul een geldig e-mailadres in invalid data edit text` |
| Statusgebied dat leeg begon, na de knop | uitgesproken: `polite: Bedankt, uw bericht is verzonden` | uitgesproken: `Bedankt, uw bericht is verzonden` |
| Statusgebied dat `hidden` was, na de knop | apart gezet als "verborgen en nu zichtbaar: probeer het met een echte schermlezer" | niets uit zichzelf, 6 seconden lang |
| De wandeling over `proef.html` | 14 onderdelen: ook `document`, `paragraph` en `end of paragraph` | 7 onderdelen: kop, knop, label, veld, foutmelding, knop, en na de druk het bedankje |

Wat dit zegt:

- **Naam, rol en toestand komen overeen.** De woorden staan in een andere volgorde en VoiceOver zegt "invalid data edit text" waar de standaard "textbox, invalid" zegt. De vergelijking van `speak` telt zulke regels als gelijk wanneer de woorden gelijk zijn; hier zijn ze dat niet, en dat verschil is van de schermlezer, niet van de pagina.
- **Het lege statusgebied.** Beide bronnen zeggen het bericht. Hier bevestigt de echte schermlezer de nagebootste.
- **Het verborgen statusgebied.** `speak` zegt eerlijk dat het dit niet weet. VoiceOver sprak het niet uit. De gebruiker van VoiceOver met Safari hoort dit bedankje dus niet. Dat is de winst van de echte schermlezer.
- **De wandeling.** VoiceOver stopt alleen op wat het als onderdeel ziet; de nagebootste lezer noemt ook de alinea's en het document. Een stapnummer van de een is niet dat van de ander.

## Eerste meting op een echte site (14 oktober 2026)

Het terugkoppelformulier van nerds.digitaledienst.overheid.nl, het open punt bij 4.1.3 uit de vierde meting. De proefpagina is een pagina van de site zelf, één keer opgehaald, met haar eigen scripts en onderdelen; alleen het venster Feedback geven gaat bij het laden open, en in twee van de drie gevallen is het formulier vooraf ingevuld. Versturen stuurt niets naar een server: de knop Via e-mail opent het mailprogramma, de knop Via GitHub Issues een nieuw tabblad. Daarna zet de pagina het `hidden` van een statusgebied (`role="status"`) af.

| Geval | Wat VoiceOver uit zichzelf zei na de druk |
|---|---|
| Leeg formulier, Via e-mail | `Uw feedback is nog niet verstuurd Soort feedback: kies een soort. Uw feedback: minimaal 10 tekens.` (een gebied met `role="alert"` dat `hidden` was) |
| Ingevuld, Via e-mail | het mailprogramma neemt het over; de bedankmelding wordt niet gezegd |
| Ingevuld, Via GitHub Issues, met het nieuwe tabblad uitgezet | niets, 6 seconden lang; in Chromium is daarna te zien dat de melding er staat |

De foutmelding komt dus wel door en de bedankmelding niet, terwijl beide gebieden `hidden` waren: bij `role="alert"` spreekt VoiceOver een gebied dat zichtbaar wordt uit, bij `role="status"` niet. Wat op de proefpagina's gemeten was, geldt ook hier.

Om dit te meten leerde `voiceover read` in een onderdeel te stappen waar "volgende" niet verder kwam (VO-Shift-pijl-omlaag): een open dialoog is voor VoiceOver tot dan één onderdeel. `--press` zoekt in de hele uitgesproken zin; geef daarom de naam met de rol erbij (`--press "Via e-mail button"`), anders drukt hij op een tekst waarin die woorden staan.

## Met het sessiecommando (14 oktober 2026)

Dezelfde site, nu zoals een agent het doet: een sessie op de voorpagina, het venster Feedback geven open met `click`, een soort gekozen met `select` en de vaste testwaarde `long` in het veld met `type`. Daarna `loep voiceover --steps 30 --press "<naam> button"`. Het commando haalde de pagina één keer op en maakte er een proefpagina van; Safari speelde de drie stappen na met de eigen scripts van de site (3 van 3 gespeeld). Er is niets verstuurd. De virtuele Mac startte in 537 seconden, in één keer.

| Geval | Wat het antwoord zei | Tijd |
|---|---|---|
| Ingevuld, Via e-mail, `--no-mailto` | `silent`; onder `heldBack` het tegengehouden `mailto:`-adres | 58 s |
| Ingevuld, Via GitHub Issues, `--no-popup` | `silent`; onder `heldBack` het nieuwe venster naar GitHub dat niet opende | ongeveer 60 s |
| Leeg, Via e-mail, `--no-mailto` | `Selecteer Soort feedback required invalid data pop up button`; geen `mailto:` tegengehouden | ongeveer 60 s |

Wat dit zegt:

- **De bedankmelding wordt niet uitgesproken**, met en zonder het e-mailprogramma, net als bij de meting met de hand. Een agent stelt dat nu zelf vast, met een waarneming die de proefpagina, de nagespeelde stappen en wat is tegengehouden bewaart.
- **De wandeling begint in het open venster.** VoiceOver noemde eerst `Feedback geven web dialog with 4 items` en ging er zelf in; de ingevulde tekst las het voor bij het veld. Het venster ging dus open en het veld was gevuld, met gebeurtenissen in de pagina in plaats van echte invoer.
- **Bij het lege formulier zei VoiceOver iets anders dan bij de meting met de hand.** Daar sprak het de foutmelding uit (`role="alert"`); hier sprak het het eerste veld uit, met `invalid data`, alsof de site de focus erheen zette. Of de site sinds de meting met de hand is veranderd of de proefpagina dit verschil maakt, is niet uitgezocht. Ook zei VoiceOver bij de velden al `invalid data` voordat er gedrukt was.

Op de testpagina's van de toolbox is het sessiecommando met een nagebootste gast getest (`toolbox/test/voiceover-session.test.ts`): de proefpagina speelt een toestand na in Chromium, de eigen scripts van de pagina lopen, een verzoek met POST komt niet bij de server, en twee agents tegelijk gaan na elkaar.

## Eerst gemeten met guidepup

De eerste versie van het commando stuurde VoiceOver aan met `@guidepup/guidepup` 0.35.0. Daarmee bleef VoiceOver bij het lege statusgebied stil, ook zonder de vaste voorkeuren van guidepup en ook met VO-spatie in plaats van guidepups eigen handeling. Het commando stuurt VoiceOver daarom nu zelf aan. De tabel hierboven is van die tweede versie. Zie "Waarom niet met guidepup" in [../../docs/voiceover.md](../../docs/voiceover.md).

Gemeten tijden: `voiceover start` 27 minuten bij de eerste meting (de eerste start mislukte bij het opwarmen, de tweede lukte) en 9 minuten bij de tweede; elke `voiceover read` 42 tot 48 seconden.
