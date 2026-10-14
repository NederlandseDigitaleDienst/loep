# VoiceOver in een virtuele Mac

Soort: beschrijving van een optioneel onderdeel, bij de code van het commando `voiceover`.

Het commando `voiceover` laat een echte schermlezer een pagina voorlezen: VoiceOver met Safari, in een virtuele Mac op de eigen machine. Het is een tweede methode naast de nagebootste schermlezer van `loep speak`, voor dezelfde vraag (spraak). Het is optioneel. Geen stap van een onderzoek heeft het nodig, een run zonder virtuele Mac werkt precies als voorheen, en `just doctor` meldt het ontbreken niet als fout.

Er zijn twee ingangen:

- **In een onderzoek** gebruikt een agent het sessiecommando `loep voiceover`. Het leest de toestand van zijn sessie voor; zie "In een onderzoek" hieronder.
- **Met de hand** leest `node toolbox/src/cli.ts voiceover read` een adres of een bestand voor, buiten een run.

In het register van methoden (`toolbox/src/instruments/methods/registry.ts`) staat VoiceOver als methode `voiceover` voor de vraag `speech`. Een run legt elke methode uit het register vast als gereedschap. Draait de virtuele Mac niet, dan staat VoiceOver daar als ontbrekend, met de reden; de andere methoden antwoorden gewoon.

## Waarom een virtuele Mac

VoiceOver geeft via AppleScript terug wat het als laatste zei. Op een machine die vergrendeld is of waarvan het scherm slaapt, weigert het dat. Een virtuele Mac heeft een eigen scherm dat niet vergrendelt, en de instellingen die VoiceOver bedienbaar maken blijven daarbinnen. Op de machine zelf verandert niets.

De virtuele Mac draait met lume (MIT, `trycua/cua` op GitHub), alleen op een Mac met Apple-chip. In de virtuele Mac stuurt een script van de toolbox VoiceOver aan zoals een gebruiker dat doet: met de eigen commando's en toetsen van VoiceOver, via AppleScript. loep start dat script over ssh. lume zit niet in de toolbox: dat installeer je zelf.

## Gebruik

```
just voiceover-setup
node toolbox/src/cli.ts voiceover start
node toolbox/src/cli.ts voiceover read --url <adres of bestand> --steps 10
node toolbox/src/cli.ts voiceover read --url <adres of bestand> --steps 10 --press "Verstuur" --out antwoord.json
node toolbox/src/cli.ts voiceover stop
```

- `start` start de virtuele Mac, wacht tot hij rustig is en warmt hem op. Voortgang met tijden komt op stderr. Laat hem daarna draaien zolang het onderzoek duurt.
- `read` opent de pagina in Safari, gaat de webinhoud in en geeft per stap de zin die VoiceOver uitsprak. Een bestand op de eigen machine wordt naar de virtuele Mac gekopieerd. Een adres op localhost van de eigen machine weigert het commando: in de virtuele Mac is dat een andere machine.
- Met `--press` drukt VoiceOver het eerste onderdeel in waarvan de naam die tekst bevat, met de toetsen VO-spatie. Het antwoord bewaart wat VoiceOver in de 6 seconden daarna uit zichzelf zei.
- `--out` bewaart het volledige antwoord, met de versies van macOS, Safari en node in de virtuele Mac en de voorkeuren waarmee VoiceOver draaide.
- `stop` sluit de virtuele Mac af.

De afdruk van `read` heeft de sleutels van `speak --steps`: `steps`, `reader` en `readerNote`. Het volledige antwoord heeft `methods`, `agreement` en `differences` zoals elke meting met meer bronnen, met VoiceOver als bron die niet is nagebootst (`simulated: false`) en de taal van de uitspraak (`language`).

## In een onderzoek

```
loep voiceover [<label of adres>] [--state <naam>] [--steps n] [--press "<naam> <rol>"] [--no-popup] [--no-mailto]
```

Het sessiecommando leest de pagina voor in de toestand waarin de sessie van de agent is: de pagina die hij opende met de stappen die hij daarna deed. Met `--state` is het een bewaarde toestand uit `recipes/`, met een label of adres de pagina zonder handelingen vooraf. De code staat in `toolbox/src/session/voiceover-command.ts`.

Zo gaat het:

1. **De pagina wordt één keer opgehaald**, met GET, binnen de scope van de run en met de pauze tussen twee verzoeken naar dezelfde host, zoals elke `open`. Een doorverwijzing buiten de scope wordt geweigerd en komt bij de geweigerde verzoeken van de waarneming. Een run met een inlog weigert het commando: de virtuele Mac heeft de sessie van het testaccount niet.
2. **Er komt een proefpagina van** (`toolbox/src/lib/voiceover-page.ts`): de pagina zoals de server haar stuurde, met bovenaan een `<base href>` naar het adres van de pagina, een beleid voor inhoud (CSP) en een script (`toolbox/voiceover/test-page.js`). Safari haalt de eigen scripts, stijlen en afbeeldingen van de site daardoor zelf op en voert ze uit.
3. **Het script houdt alles tegen wat iets verstuurt.** Alleen GET en HEAD naar de hosts van de run gaan de pagina uit. Een ander verzoek met `fetch` of `XMLHttpRequest`, een beacon, een bericht over een websocket en het versturen van een formulier gebeuren niet; het beleid voor inhoud staat ook alleen die hosts toe voor verzoeken en ingesloten vensters, en geen formulier. Wat de site doet als een verzoek mislukt, gebeurt wel: dat hoort VoiceOver.
4. **Het script speelt de stappen na**, na het laden en met een korte pauze ertussen, en zoekt een element zoals de sessie dat doet: op zijn keten van selectors, dan op rol en naam, dan op de keten zonder id's. `click`, `type`, `paste`, `select`, `key`, `hover`, `scroll`, `focus`, `spacing --keep` en `speak --click` of `--type` speelt het na met gebeurtenissen in de pagina. Een meting zonder blijvend gevolg (`reflow`, `zoom`, `taborder`, `forced`, `spacing` zonder `--keep`) slaat het over. `tab`, `press`, `back` en een stap naar een andere pagina kan het niet naspelen: dan weigert het commando, zonder kosten. Een element in een ingesloten venster bereikt het niet.
5. **Het script schrijft wat het deed in het adres van de pagina** (`#loep-played=...`). De lezer in de gast wacht daarop voordat VoiceOver begint, en leest het adres aan het eind opnieuw: dan staat erin wat na de druk is tegengehouden.
6. **VoiceOver leest** zoals bij `voiceover read`: vanaf het begin van de webinhoud, of vanaf het venster dat open staat, en met `--press` drukt het met VO-spatie op het eerste onderdeel waarvan de uitgesproken zin die tekst bevat.

Het antwoord heeft de sleutels van `voiceover read` en daarnaast:

- `state`: welke toestand, en hoeveel stappen Safari naspeelde. `notReached` als een stap mislukte of niet terugkwam: dan las VoiceOver een andere toestand, en dat is geen bewijs voor de gevraagde.
- `heldBack`: wat de pagina wilde versturen of openen en wat is tegengehouden.
- `changed`: met `--no-popup` zijn `window.open` en links met `target="_blank"` vervangen, zodat er geen nieuw venster opent; met `--no-mailto` opent een `mailto:`-adres het e-mailprogramma niet. Zonder deze opties neemt het nieuwe venster of het e-mailprogramma het van Safari over, en hoort VoiceOver dat.
- `differs`: de toestand is op een andere breedte of in het donkere kleurenschema vastgelegd; Safari leest in zijn eigen venster, licht.
- `waited`: hoe lang de agent op de virtuele Mac wachtte en hoeveel voorlezingen voorgingen.
- `note`: dat dit VoiceOver met Safari is, en dat NVDA en JAWS het anders kunnen doen.

De waarneming bewaart de proefpagina naast zich (`<nr>-proefpagina.html`, met haar hash in `images`), de hash van de opgehaalde pagina, welke stappen hoe zijn nagespeeld, wat is tegengehouden en de versies van macOS en Safari. De methode heet `screen-reader` met implementatie `voiceover`. `evaluate` neemt haar op bij de gebruikte instrumenten, en het rapport noemt VoiceOver met Safari en de versies onder de hulpsoftware en in de beperkingen.

**Eén virtuele Mac, een wachtrij.** VoiceOver leest één pagina tegelijk. Voorlezingen van de agents van één sessieproces gaan na elkaar, in de volgorde waarin ze kwamen; een slot op schijf (`~/.cache/loep/voiceover/<naam>.lock`) houdt een voorlezing van een ander proces buiten, ook `voiceover read` met de hand. Een slot van een proces dat niet meer bestaat, of dat ouder is dan 7 minuten, wordt overgenomen. Na 10 minuten wachten geeft een voorlezing het op. Het commando mag daarom langer duren dan de gewone 90 seconden: tot 17 minuten. Het wachten telt mee in de minuten van de agent.

**Niet beschikbaar.** Draait de virtuele Mac niet, dan antwoordt het commando meteen dat VoiceOver niet beschikbaar is en dat de agent verder werkt zoals zonder. Het kost dan niets, net als een toestand die Safari niet kan naspelen. De opdrachten aan de agents (`templates/gereedschap.md`, `beoordeel.md`, `verifieer.md`, `afmaak.md`) zeggen wanneer ze het gebruiken: waar de nagebootste lezer zegt "probeer het met een echte schermlezer", en waar het oordeel afhangt van wat een schermlezer werkelijk voorleest, voordat ze `mens nodig` schrijven.

**Opstarten in een onderzoek.** De skill start de virtuele Mac tegelijk met de veegronde, als `just doctor` zegt dat hij er is, en stopt hem na de laatste fase met agents. Het commando `estimate` zegt hetzelfde als de virtuele Mac is ingericht.

## Wat het kost

| Wat | Hoeveel |
|---|---|
| Schijf | 20 GB ophalen, daarna 27 GB in de map van lume |
| Geheugen | 6 GB toegewezen; het proces neemt 2 tot 6 GB op de machine. Met 4 GB werkte het één keer ook |
| Tijd tot de eerste meting | 9 minuten als de eerste start goed gaat, 20 tot 30 minuten als een herstart nodig is |
| Tijd per `read` | 40 tot 50 seconden; als sessiecommando met een proefpagina 52 tot 58 seconden |

## De stilstand bij de eerste spraak

De eerste keer dat er na het opstarten spraak naar de geluidsuitvoer gaat, staat de hele virtuele Mac ruim 4 minuten stil (232 tot 243 seconden gemeten). Dat gebeurt in de meeste starts. Het is de hele gast en niet één wachtend commando: een losse teller in de gast heeft hetzelfde gat. Valt de stilstand in de eerste zin van VoiceOver zelf, dan loopt het venstersysteem van de gast in ongeveer de helft van de gevallen voorgoed vast. Zonder maatregel was 4 van de 10 starts onbruikbaar.

`start` vangt dat zo op:

1. Wachten tot de gast rustig is: ingelogd, en de load over een minuut onder de 3. Dat duurt meestal 4 minuten.
2. Een gesproken opwarming: drie zinnen met `say`, met 8 seconden ertussen. De stilstand valt dan in `say`. Het zijn er drie omdat de stilstand soms pas begint nadat de eerste zin klaar is.
3. VoiceOver één keer aan en uit.
4. Mislukt de opwarming, dan sluit `start` de virtuele Mac af en begint opnieuw, hooguit drie starts.

Met de opwarming ging 7 van de 8 starts in één keer goed. De achtste ving de herstart op.

Eenmaal opgewarmd blijft de virtuele Mac warm zolang hij draait: na een half uur niets doen gaf `read` hetzelfde antwoord in dezelfde tijd. Pauzeren en hervatten kan lume 0.6.1 niet; warm houden is laten draaien.

Wat is uitgesloten als oorzaak:

- Het geheugen van de machine: het gebeurt ook met driekwart van het geheugen vrij en zonder ander werk.
- Het tekstpaneel van VoiceOver: uitzetten gaf dezelfde stilstand.
- Het welkomstvenster van VoiceOver: dat staat uit.
- Geluid op zich: een systeemgeluid afspelen geeft geen stilstand, spraak naar een bestand ook niet. Alleen spraak naar de geluidsuitvoer.

Wat niet is uitgezocht: of het aan het virtuele geluidsapparaat ligt of aan de spraaksynthese, en of het wegblijft met een venster aan de virtuele Mac. lume heeft geen optie om het geluidsapparaat weg te laten.

## Wat er in de virtuele Mac is ingesteld

`just voiceover-setup` (het commando `voiceover setup`) zet dit, en zegt per stap wat gedaan is en wat je zelf moet doen. De scripts staan in `toolbox/voiceover/guest/`.

| Instelling | Waarvoor |
|---|---|
| sudo zonder wachtwoord voor de gebruiker van de virtuele Mac | afsluiten en instellen over ssh |
| Automatisch inloggen, geen vergrendeling, geen slaapstand | het scherm van de gast blijft zoals het is |
| System Integrity Protection uit | de schakelaar die VoiceOver met AppleScript laat bedienen, en de systeemlijst van rechten, zijn anders niet te schrijven |
| Rechten (TCC) voor sshd, bash, zsh en osascript | toetsen sturen, de toegankelijkheidsinterface gebruiken, en Apple Events naar VoiceOver, System Events, Safari en Finder |
| Welkomstvenster van VoiceOver uit, geen herstelde vensters na een herstart | VoiceOver en Safari beginnen elke keer hetzelfde |
| node v24.21.0 in de thuismap van de gast | het script dat VoiceOver aanstuurt; een vaste versie, geen pakketten |

System Integrity Protection zet je zelf uit, in de herstelmodus van de virtuele Mac. Het commando zegt hoe. Het geautomatiseerde `lume sip off` van lume 0.6.1 werkte hier niet.

Het openbare beeld `macos-tahoe-vanilla` heeft de gebruiker `lume` met het wachtwoord `lume`. Dat wachtwoord is openbaar. De virtuele Mac is alleen vanaf de eigen machine te bereiken, maar zet er niets in wat geheim moet blijven.

lume kan gebruik melden aan de maker. `just voiceover-setup` controleert dat en zegt hoe je het uitzet (`lume config telemetry disable`); het zet zelf niets op de machine.

## Waarom niet met guidepup

Guidepup (`@guidepup/guidepup` 0.35.0, MIT) is gebouwd om VoiceOver in tests aan te sturen en is hier eerst gebruikt. Het is eruit gehaald om wat het bij een statusbericht deed:

- Na een druk op een knop bleef VoiceOver stil bij een statusgebied dat leeg begon en tekst kreeg. Aangestuurd met zijn eigen commando's en VO-spatie spreekt VoiceOver dat bericht uit.
- Dat lag niet aan de vaste voorkeuren die guidepup koppelt: zonder die voorkeuren bleef het stil. Het lag ook niet alleen aan de manier van drukken: met VO-spatie in plaats van guidepups eigen handeling bleef het stil.
- De functie van guidepup die de laatst uitgesproken zin geeft, geeft wat guidepup rond zijn eigen commando's opving. Wat VoiceOver daarna uit zichzelf zegt, komt daar niet in.

Wat er in de start of de navigatie van guidepup precies anders is, is niet uitgezocht. De gesproken opwarming en de herstart zijn van guidepup onafhankelijk.

## Wat het niet kan

- **Alleen Engelse uitspraak.** VoiceOver zegt rollen en toestanden in het Engels ("button", "invalid data"), ook op een Nederlandse pagina. Een poging met Nederlands als taal van de gast liet VoiceOver niet meer starten.
- **Alleen VoiceOver met Safari op macOS.** NVDA en JAWS zeggen het anders en draaien niet in een virtuele Mac.
- **Stilte na een handeling is zes seconden stilte.** Na `--press` luistert het commando 6 seconden. Een bericht dat later komt, is niet gehoord. De aanwijzing die VoiceOver zelf bij een onderdeel geeft ("You are currently on a button ...") telt niet als uitgesproken. Het antwoord zegt dit erbij (`silentNote`). Zie de meting in [../validatie/voiceover/README.md](../validatie/voiceover/README.md).
- **Alleen wat een agent liet voorlezen.** Wat `voiceover read` met de hand geeft, staat niet in de run. Het sessiecommando legt een waarneming vast; een agent haalt haar aan in zijn oordeel. De veegronde gebruikt VoiceOver niet.
- **Een kopie van de pagina.** De proefpagina is een bestand in de virtuele Mac met `<base href>` naar de site. Een site die haar inhoud met een verzoek naar een andere herkomst ophaalt (de bestandspagina heeft herkomst `null`), modules laadt van een server die dat niet toestaat, of haar route uit het adres leest, kan er anders uitzien dan op de site zelf. Gemeten is het op één site; zie [../validatie/voiceover/README.md](../validatie/voiceover/README.md).
- **Niets versturen.** Een melding na een geslaagde verzending hoort VoiceOver niet, ook niet in een run die naar een testomgeving mag versturen.
- **Nagespeeld met gebeurtenissen.** Klikken, invullen en toetsen gaan met gebeurtenissen in de pagina, niet met echte invoer. Wat de browser zelf op een toets doet, is alleen voor Enter, spatie en Escape nagedaan; aanwijzen zet de opmaak bij aanwijzen niet aan.
- **Een stap is een stap van VoiceOver.** VoiceOver slaat over wat het niet als onderdeel ziet, zoals een alinea zonder tekst. Stap 3 van VoiceOver is daardoor niet stap 3 van `speak`.
- **Achter een inlog niet.** De virtuele Mac heeft de sessie van `login` niet.
- **Een pagina op localhost niet.** Geef het bestand, of een adres dat de virtuele Mac kan bereiken. Het sessiecommando weigert een site op deze machine zonder kosten: de scripts van de site zouden in de virtuele Mac niet laden.

## Licenties

| Software | Waar | Licentie |
|---|---|---|
| lume 0.6.1 | op de machine, door de gebruiker geïnstalleerd | MIT |
| De stappen van het inrichten volgen `@guidepup/setup` 0.29.2 | overgenomen in `toolbox/voiceover/guest/provision.sh`, niet geïnstalleerd | MIT |
| Node.js v24.21.0 | in de virtuele Mac | MIT en andere, zie de licentie van Node.js |
| macOS, Safari en VoiceOver | in de virtuele Mac | van Apple; de licentie van macOS staat een virtuele Mac op Apple-hardware toe |
