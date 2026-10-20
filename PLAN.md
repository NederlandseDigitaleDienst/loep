# Plan

Wat er nu loopt en wat hierna komt, in volgorde. Wat de toolbox al doet staat in [docs/methode.md](docs/methode.md), de cijfers in [validatie/iteraties.md](validatie/iteraties.md), de lessen met hun status in [validatie/lessen.md](validatie/lessen.md), en per versie wat er veranderde in [CHANGELOG.md](CHANGELOG.md). Dit bestand wordt bijgewerkt bij elke afgeronde stap.

Stand: 20 oktober 2026. De laatste versie is 0.10.0; op `main` staat wat in 0.11.0 komt.

## Waar het staat

De laatste meting die in [validatie/iteraties.md](validatie/iteraties.md) is uitgewerkt, is van 11 oktober. Versie 0.2.0 tot en met 0.10.0 zijn tussen 15 en 17 oktober uitgebracht zonder volledige nieuwe meting op de testsite; de CHANGELOG zegt dat bij elke versie. Wat er in die versies kwam, in grote lijnen:

- De veegronde meet pagina's tegelijk (`--at-once`), neemt van een groot paginatype een kleinere steekproef, probeert een onderdeel na een time-out nog een keer, en stopt niet meer op één pagina die vastloopt of te lang is voor een schermafbeelding.
- Eén onderzoek kan over meer origins gaan (`inventory --also-origin`).
- Een zoekvraag die als POST gaat, telt niet als versturen.
- Een nieuwe soort open punt, `niet bereikbaar`, met `tasks --again` voor een tweede kans.
- Het rapport zet aanbevelingen apart en spreekt de lezer aan zonder procestaal.
- `estimate` rekent de veegronde per pagina.

Op 19 oktober is een onderzoek van een echte site gedaan met 0.10.0 uit de plugin, alle 56 criteria, met een afmaakronde voor één criterium. Het verbruik daarvan is de nulmeting in [validatie/verbruik/README.md](validatie/verbruik/README.md): 134 agents, ongeveer 526 miljoen tokens en 184 dollar met de prijzen van de API. De uitkomsten ervan staan niet in het logboek. Wat in dat onderzoek en in andere runs misging, werd een issue en staat nu op `main`, voor 0.11.0: pdf's met tags en hun links, 4.1.1 bij pdf's, aanvaarde gaten met wie ze besloot, `check-site` op elk paginatype, adressen die doorverwijzen, een pagina die de browser bezig houdt, en een budget voor versturen per run. Ook op `main`: het commando `dossier` (stap 1 van het verbruik), gereedschap om varianten te meten (`variant` en `compare-variants`), en een model per rol in de werkstroom.

Op 20 oktober is de codebase in acht reviews bekeken, elk vanuit een ander vak. De kern: de opzet is sterk, maar loep is nog niet gevalideerd tegen deskundigen, en hoe herhaalbaar een onderzoek is, is niet gemeten. De reviews zelf staan niet in deze repository.

Hoe wijzigingen nu binnenkomen (een merge queue, de meeste door agents, zonder verplichte review) en waarom de meting per versie nog niet wordt gehaald, staat in [GOVERNANCE.md](GOVERNANCE.md).

## Loopt

1. **Herhaalbaarheid op de testsite, op v0.11.0.** Na het uitbrengen van 0.11.0 één bevroren veegronde op de testsite, met gebreken en schoon, en daarop drie runs van dezelfde code met de negen criteria uit [validatie/verbruik/README.md](validatie/verbruik/README.md#hoe-we-meten). `compare-variants` zonder variant zegt hoe ver die runs uit elkaar liggen, per criterium en per gebrek uit de sleutel. Dat getal ontbreekt nu, en zonder kan geen meting zeggen of een wijziging iets verbetert. Daarbij horen [#173](https://github.com/NederlandseDigitaleDienst/loep/issues/173) (`compare-variants` heeft nog geen marge voor toeval) en [#174](https://github.com/NederlandseDigitaleDienst/loep/issues/174) (staat het bewijs voor elk gebrek uit de sleutel in het dossier). De uitkomst komt in [validatie/iteraties.md](validatie/iteraties.md) ([#133](https://github.com/NederlandseDigitaleDienst/loep/issues/133)).
2. **Daarna de varianten van het verbruik**, elk op hetzelfde bevroren bewijs en vergeleken met de herhaalbaarheid uit stap 1. Stap 1, `dossier`, staat al op `main` zonder meting; de meting zegt of hij blijft. Dan het opdrachtbestand in een kern en naslag ([#135](https://github.com/NederlandseDigitaleDienst/loep/issues/135)), gereedschap dat nu mislukt ([#136](https://github.com/NederlandseDigitaleDienst/loep/issues/136)) en een model per rol ([#137](https://github.com/NederlandseDigitaleDienst/loep/issues/137)).
3. VoiceOver in een virtuele Mac als optionele tweede bron naast de nagebootste schermlezer ([docs/voiceover.md](docs/voiceover.md)). Gebouwd, op proefpagina's en op het formulier van de eigen site gemeten ([validatie/voiceover/README.md](validatie/voiceover/README.md)). Open: een onderzoek waarin de agents het gebruiken. Te meten: hoeveel punten `mens nodig` over voorlezen VoiceOver sluit, hoe lang agents op de virtuele Mac wachten, en hoe vaak een toestand in Safari niet na te spelen is.
4. De afmaakronde en het budget per opdracht ([docs/methode.md](docs/methode.md#het-budget-van-een-agent)) zijn in het onderzoek van 19 oktober gebruikt, maar niet gemeten. Te meten: komt de afmaakagent binnen zijn budget tot een oordeel, hoeveel criteria hebben de ronde nodig, hoeveel sessies verlengen per rol, en hoeveel punten `veegronde mist` blijven over.

## Hierna

5. **Validatie tegen deskundigen.** Onderzoeken van loep naast onderzoeken van deskundigen van dezelfde site leggen, met de keten van nu. Dat is alleen met een eerdere keten gedaan ([validatie/iteraties.md](validatie/iteraties.md)). Daarbij de 13 bevindingen van de derde meting op de eigen site laten nalopen door het team.
6. De ijkset gebruiken ([validatie/ijkset/README.md](validatie/ijkset/README.md)): een beoordelaar vertellen hoe betrouwbaar elke regelset is als ze het oneens zijn, twijfel van een regelset zwaarder laten wegen, en de valse meldingen van de eigen contrastmeting uitzoeken.
7. De open lessen in [validatie/lessen.md](validatie/lessen.md) en de open issues. Voor wie een rapport gebruikt het meest: het rapport als HTML op een vaste plek ([#151](https://github.com/NederlandseDigitaleDienst/loep/issues/151)), meer onderzoeksrondes in één rapport ([#150](https://github.com/NederlandseDigitaleDienst/loep/issues/150)) en maatregelen per gebrek ([#149](https://github.com/NederlandseDigitaleDienst/loep/issues/149)).
8. De drie sites van de ontwikkelset opnieuw. Dan de methode bevriezen op een tag en de toetsset één keer draaien. Daarna de betrouwbaarheid beschrijven. De toetsset is het duurste stuk: zeven tot elf sites, met het verbruik van de nulmeting in de orde van 150 tot 250 dollar per site van 30 pagina's op de API. Die start niet zonder een uitdrukkelijk besluit.
9. Achter een inlog: een meting met agents op het ingelogde deel van de testsite, en daarna op een testomgeving van een echte site. Het inloggen en de sessieproef voor 2.2.1 zijn gebouwd en door tests gedekt ([docs/methode.md](docs/methode.md#een-site-achter-een-inlog)). Nog niet gebouwd: een instrument voor 3.3.8 (toegankelijke authenticatie), dat uitgelogd op het inlogscherm kijkt of plakken en automatisch invullen werken en of er een geheugen- of puzzelvraag is zonder alternatief.
10. Afronden: `statement` op de keten van nu.
11. Mobiele apps: uitgesteld. Android kan met open gereedschap (emulator zonder beeld, Appium, het Accessibility Test Framework, TalkBack); iOS vraagt een build van de eigenaar.

## Besluiten die openstaan

Bij de opdrachtgever, niet bij wie bouwt:

- Het budget voor de metingen van het verbruik, ongeveer 500 tot 700 dollar, en of de beoordelaars ook op Sonnet gemeten worden ([validatie/verbruik/README.md](validatie/verbruik/README.md#gevraagd-besluit)).
- Een proef met NVDA op een Windows-machine van GitHub Actions, de schermlezer die de meeste mensen gebruiken.
- Een site met een testomgeving en een testaccount voor de eerste meting achter een inlog.
- 2.1.4: tellen lettertoetsen in een videospeler als uitzondering (de speler is één onderdeel) of niet. Nu: niet.
- Of na de afmaakronde toch een verifieerder moet komen. Nu: nee; een bevinding wordt twee keer door dezelfde agent vastgelegd en het rapport zegt dat erbij. Een meting moet uitwijzen of dat genoeg is.
- Of bewijsbeelden openbaar mogen.
- De schrijfwijze van de rechthebbende in `REUSE.toml`.
