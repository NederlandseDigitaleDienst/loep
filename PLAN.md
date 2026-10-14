# Plan

Wat er nu loopt en wat hierna komt, in volgorde. Wat de toolbox al doet staat in [docs/methode.md](docs/methode.md), de cijfers in [validatie/iteraties.md](validatie/iteraties.md), de lessen met hun status in [validatie/lessen.md](validatie/lessen.md). Dit bestand wordt bijgewerkt bij elke afgeronde stap.

Stand: 14 oktober 2026.

## Loopt

1. VoiceOver in een virtuele Mac als optionele tweede bron naast de nagebootste schermlezer ([docs/voiceover.md](docs/voiceover.md)). Gebouwd en op proefpagina's gemeten. Het commando stuurt VoiceOver zelf aan, zonder guidepup; daarmee geeft het bij een statusbericht wat een gebruiker hoort: uitgesproken als het gebied leeg begon, stil als het verborgen was. Op 14 oktober 2026 op het formulier van de eigen site gemeten, eerst met de hand en daarna met het sessiecommando `voiceover`: beoordelaars, verifieerders en de afmaakronde gebruiken VoiceOver nu zelf als de virtuele Mac draait, met een proefpagina die de toestand van hun sessie in Safari naspeelt, en het rapport noemt het bij de hulpsoftware ([validatie/voiceover/README.md](validatie/voiceover/README.md)). Open: een onderzoek waarin de agents het gebruiken. Te meten: hoeveel punten `mens nodig` over voorlezen VoiceOver sluit, hoe lang agents op de virtuele Mac wachten met drie tegelijk, en hoe vaak een toestand in Safari niet na te spelen is.
2. De 13 bevindingen van de derde meting op de eigen site laten nalopen door het team.
3. Een onderzoek eindigt met een oordeel per criterium. Gebouwd en door tests gedekt: een afmaakronde als vierde fase voor wat het onderzoek zelf open liet, `answer` waarmee een persoon een open punt sluit dat geen instrument kan sluiten, en een rapport dat de open criteria in twee groepen telt en zegt wanneer het onderzoek niet af is ([docs/methode.md](docs/methode.md)). Open: de eerste meting ermee op een echte site. Te meten: komt de afmaakagent binnen zijn budget tot een oordeel, hoeveel criteria hebben de ronde nodig nu de veegronde meer meet, en houdt een oordeel zonder verifieerder erachter stand.
    - Daarbij hoort een veegronde die levert wat de beoordelaars nodig hebben. Na de vijfde meting op de eigen site gebouwd en door tests gedekt: bediening die alleen tussen de gemeten breedtes verschijnt, de afbeeldingen en hun herkende tekst in elke toestand, de volgorde van code en scherm per pagina breed en op 320 pixels, de kleuren van elke link en knop bij aanwijzen en focus in licht en donker, Shift+Tab en de pijltjestoetsen in elke toestand, en de taal van tekstalternatieven en van de tekst van elke toestand ([validatie/lessen.md](validatie/lessen.md)). Open: meten op een echte site hoeveel punten `veegronde mist` overblijven en hoeveel langer de veegronde duurt.
    - Daarbij hoort een budget dat past bij het werk, zodat de afmaakronde zelden nodig is. Gebouwd en door tests gedekt: `tasks` rekent per opdracht een budget uit uit het gemeten verbruik per criterium en de omvang van de site, een agent verlengt zijn sessie hooguit twee keer, `budget op` mag pas daarna, en `gaps` geeft de werklijst van wat de veegronde mist ([docs/methode.md](docs/methode.md#het-budget-van-een-agent)). Open: de eerste meting ermee. Te meten: hoeveel sessies verlengen per rol, of een criterium met factor 2 nu binnen zijn budget blijft, en of de lichte criteria met minder toe kunnen dan de ondergrens.

## Hierna

4. De ijkset gebruiken ([validatie/ijkset/README.md](validatie/ijkset/README.md)): een beoordelaar vertellen hoe betrouwbaar elke regelset is als ze het oneens zijn, twijfel van een regelset zwaarder laten wegen, en de valse meldingen van de eigen contrastmeting uitzoeken.
5. De open lessen in `validatie/lessen.md`.
6. Alles wat sinds de derde meting is gebouwd is nog op geen echte site gemeten: de instrumenten voor kleur en contrastmodus, de nagebootste schermlezer, de tweede mening in WebKit, de inlog.
7. Een volledige meting op de testsite, op de variant met gebreken en op de schone, vanaf één bevroren commit. En twee volledige metingen op dezelfde site naast elkaar, om te weten hoeveel een tweede meting anders vindt.
8. De drie sites van de ontwikkelset opnieuw. Dan de methode bevriezen op een tag en de toetsset één keer draaien. Daarna de betrouwbaarheid beschrijven.
9. Afronden: `statement` op de keten van nu.
10. Mobiele apps: uitgesteld. Android kan met open gereedschap (emulator zonder beeld, Appium, het Accessibility Test Framework, TalkBack); iOS vraagt een build van de eigenaar.

11. Achter een inlog: een meting met agents op het ingelogde deel van de testsite, en daarna op een testomgeving van een echte site. Het inloggen en overnemen van de sessie is gebouwd en door tests gedekt, net als de sessieproef voor 2.2.1 (een tweede inlog die met rust wordt gelaten en met oplopende tussenpozen wordt nagekeken, [docs/methode.md](docs/methode.md#een-site-achter-een-inlog)). Te meten: of de proef op een echte testomgeving een verlopen sessie ziet, en hoe vaak het nakijken de sessie zelf verlengt. Nog niet gebouwd is één instrument:
    - 3.3.8 (toegankelijke authenticatie): een rondgang op het inlogscherm zelf, uitgelogd, die kijkt of plakken en automatisch invullen werken en of er een geheugen- of puzzelvraag is zonder alternatief. Dat vraagt een sessie zonder de bewaarde inlog en een proef die in het wachtwoordveld plakt zonder iets te versturen.

De toetsset is het duurste stuk: zeven tot elf sites, grofweg honderd miljoen tokens. Die start niet zonder een uitdrukkelijk besluit.

## Besluiten die openstaan

Bij de opdrachtgever, niet bij wie bouwt:

- Een proef met NVDA op een Windows-machine van GitHub Actions, de schermlezer die de meeste mensen gebruiken.
- Een site met een testomgeving en een testaccount voor de eerste meting achter een inlog.
- 2.1.4: tellen lettertoetsen in een videospeler als uitzondering (de speler is één onderdeel) of niet. Nu: niet.
- Of na de afmaakronde toch een verifieerder moet komen. Nu: nee; een bevinding wordt twee keer door dezelfde agent vastgelegd en het rapport zegt dat erbij. Een meting moet uitwijzen of dat genoeg is.
- Of bewijsbeelden openbaar mogen.
- De schrijfwijze van de rechthebbende in `REUSE.toml`.
