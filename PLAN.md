# Plan

Wat er nu loopt en wat hierna komt, in volgorde. Wat de toolbox al doet staat in [docs/methode.md](docs/methode.md), de cijfers in [validatie/iteraties.md](validatie/iteraties.md), de lessen met hun status in [validatie/lessen.md](validatie/lessen.md), en per versie wat er veranderde in [CHANGELOG.md](CHANGELOG.md). Dit bestand wordt bijgewerkt bij elke afgeronde stap.

Stand: 20 november 2026. De laatste versie is 0.37.0.

## Waar het staat

Als geheel gemeten zijn 0.11.0, 0.25.0, 0.29.0 en 0.35.0, elk met twee runs op de testsite met gebreken; vanaf 0.25.0 ook met een run op de schone tweeling. De uitwerking staat in [validatie/iteraties.md](validatie/iteraties.md), die van 0.35.0 in [validatie/testsite/2026-11-17-meting-0.35.0/](validatie/testsite/2026-11-17-meting-0.35.0/uitkomst.md). Bij de laatste meting, van 0.35.0 op 18 november, vond loep in beide runs alle 79 ingebouwde gebreken, met dezelfde uitkomst bij alle 56 criteria. De andere versies zijn uitgebracht met een meting van een paar criteria of zonder meting met agents; de CHANGELOG zegt bij elke versie waarom. Gemeten is steeds tegen de sleutel van de testsite, niet tegen het oordeel van een deskundige.

Op 19 oktober is een onderzoek van een echte site gedaan met 0.10.0 uit de plugin, alle 56 criteria, met een afmaakronde voor één criterium. Het verbruik daarvan is de nulmeting in [validatie/verbruik/README.md](validatie/verbruik/README.md): 134 agents, ongeveer 526 miljoen tokens en 184 dollar met de prijzen van de API. De uitkomsten ervan staan niet in het logboek.

Op 20 oktober is de codebase in acht reviews bekeken, elk vanuit een ander vak. De kern: de opzet is sterk, maar loep is nog niet gevalideerd tegen deskundigen, en hoe herhaalbaar een onderzoek is, was toen niet gemeten. Dat laatste is sindsdien op de testsite gemeten; de validatie tegen deskundigen staat nog open. De reviews zelf staan niet in deze repository.

Hoe wijzigingen nu binnenkomen (een merge queue, de meeste door agents, zonder verplichte review) en waarom de meting per versie nog niet wordt gehaald, staat in [GOVERNANCE.md](GOVERNANCE.md).

## Loopt

1. **Het verbruik omlaag.** Op 0.11.0 zijn twee varianten uit [validatie/verbruik/README.md](validatie/verbruik/README.md) gemeten ([validatie/iteraties.md](validatie/iteraties.md)): het opdrachtbestand in een kern en naslag ([#135](https://github.com/NederlandseDigitaleDienst/loep/issues/135)) was niet slechter en bespaarde niets, en rondgangen en verifieerders op Sonnet waren goedkoper zonder dat is aangetoond dat ze niet slechter zijn. De werkstroom kan per rol een model zetten ([#137](https://github.com/NederlandseDigitaleDienst/loep/issues/137)). Open: gereedschap dat nu mislukt ([#136](https://github.com/NederlandseDigitaleDienst/loep/issues/136)), en een meting met alleen de verifieerders op Sonnet.
2. VoiceOver in een virtuele Mac als optionele tweede bron naast de nagebootste schermlezer ([docs/voiceover.md](docs/voiceover.md)). Gebouwd, op proefpagina's en op het formulier van de eigen site gemeten ([validatie/voiceover/README.md](validatie/voiceover/README.md)). Draait de virtuele Mac, dan laten de agents van een onderzoek er zelf mee voorlezen; in de metingen op de testsite stond het uit. Te meten: hoeveel punten `mens nodig` over voorlezen VoiceOver sluit, hoe lang agents op de virtuele Mac wachten, en hoe vaak een toestand in Safari niet na te spelen is.
3. De afmaakronde en het budget per opdracht ([docs/methode.md](docs/methode.md#het-budget-van-een-agent)) zijn in het onderzoek van 19 oktober gebruikt, maar niet gemeten. Te meten: komt de afmaakagent binnen zijn budget tot een oordeel, hoeveel criteria hebben de ronde nodig, hoeveel sessies verlengen per rol, en hoeveel punten `veegronde mist` blijven over.

## Hierna

4. **Validatie tegen deskundigen.** Onderzoeken van loep naast onderzoeken van deskundigen van dezelfde site leggen, met de keten van nu. Dat is alleen met een eerdere keten gedaan ([validatie/iteraties.md](validatie/iteraties.md)). Daarbij de 13 bevindingen van de derde meting op de eigen site laten nalopen door het team.
5. De ijkset gebruiken ([validatie/ijkset/README.md](validatie/ijkset/README.md)). De eerste stap is gezet: een register per regel uit de ijkset en uit meetbladen van afgeronde onderzoeken ([validatie/regelregister/README.md](validatie/regelregister/README.md), [#588](https://github.com/NederlandseDigitaleDienst/loep/issues/588)). Niets leest het nog, en dat blijft zo tot er meer meetbladen zijn: op 15 november is besloten eerst te verzamelen ([docs/meetblad.md](docs/meetblad.md)). Wat daarna volgt: een beoordelaar vertellen hoe betrouwbaar elke regelset is als ze het oneens zijn, twijfel van een regelset zwaarder laten wegen, en de valse meldingen van de eigen contrastmeting uitzoeken.
6. De open lessen in [validatie/lessen.md](validatie/lessen.md) en de open issues. Voor wie een rapport gebruikt het meest: meer onderzoeksrondes in één rapport ([#150](https://github.com/NederlandseDigitaleDienst/loep/issues/150)). Het rapport als HTML op een vaste plek (`publish`, [#151](https://github.com/NederlandseDigitaleDienst/loep/issues/151)) en maatregelen per gebrek (`decide`, [#149](https://github.com/NederlandseDigitaleDienst/loep/issues/149)) zijn er.
7. De drie sites van de ontwikkelset opnieuw. Dan de methode bevriezen op een tag en de toetsset één keer draaien. Daarna de betrouwbaarheid beschrijven. De toetsset is het duurste stuk: zeven tot elf sites, met het verbruik van de nulmeting in de orde van 150 tot 250 dollar per site van 30 pagina's op de API. Die start niet zonder een uitdrukkelijk besluit.
8. Achter een inlog: een meting met agents op het ingelogde deel van de testsite, en daarna op een testomgeving van een echte site. Het inloggen en de sessieproef voor 2.2.1 zijn gebouwd en door tests gedekt ([docs/methode.md](docs/methode.md#een-site-achter-een-inlog)). Nog niet gebouwd: een instrument voor 3.3.8 (toegankelijke authenticatie), dat uitgelogd op het inlogscherm kijkt of plakken en automatisch invullen werken en of er een geheugen- of puzzelvraag is zonder alternatief.
9. Afronden: `statement` op de keten van nu.
10. Mobiele apps: uitgesteld. Android kan met open gereedschap (emulator zonder beeld, Appium, het Accessibility Test Framework, TalkBack); iOS vraagt een build van de eigenaar.

## Besluiten die openstaan

Bij de opdrachtgever, niet bij wie bouwt:

- De verzameling van meetbladen ([docs/meetblad.md](docs/meetblad.md)): wie toetst haar aan de Woo en de AVG voordat mensen buiten het eigen team insturen, wie haar beheert en toegang geeft, en of ze ooit openbaar kan. Op een meetblad staat geen site, maar het blijft een verzameling bij een overheidsdienst.
- Het budget voor de metingen van het verbruik, ongeveer 500 tot 700 dollar, en of de beoordelaars ook op Sonnet gemeten worden ([validatie/verbruik/README.md](validatie/verbruik/README.md#gevraagd-besluit)).
- Een proef met NVDA op een Windows-machine van GitHub Actions, de schermlezer die de meeste mensen gebruiken.
- Een site met een testomgeving en een testaccount voor de eerste meting achter een inlog.
- 2.1.4: tellen lettertoetsen in een videospeler als uitzondering (de speler is één onderdeel) of niet. Nu: niet.
- Of na de afmaakronde toch een verifieerder moet komen. Nu: nee; een bevinding wordt twee keer door dezelfde agent vastgelegd en het rapport zegt dat erbij. Een meting moet uitwijzen of dat genoeg is.
- Of bewijsbeelden openbaar mogen.
- De schrijfwijze van de rechthebbende in `REUSE.toml`.
