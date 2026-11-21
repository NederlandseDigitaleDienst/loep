# Meting van de kandidaat voor 0.38.0

Meting #709. Op Lindewaard vindt de kandidaat elk gebrek uit de sleutel dat binnen bereik ligt, op één document na dat te groot is om in te lezen, en geen eigen bevinding is onterecht. Op de schone tweeling blijven alleen de criteria open die volgens de lat open mogen blijven, en noemt geen van beide vergelijkers een afkeuring onterecht. De kandidaat haalt de marge op elk punt.

De meting is twee keer gedaan. De eerste ronde, op een eerdere kandidaat, haalde de lat op de tweeling niet en vond onderweg fouten in loep die de uitkomst raakten. Die zijn hersteld, en daarna zijn alle drie de runs opnieuw gedaan op main. Wat de eerste ronde liet zien, staat onder [De eerste ronde](#de-eerste-ronde).

## Opzet

- **Kandidaat.** Branch `meting/0.38.0`, gelijk aan main op `ae82212` (#722). De versie in de code heet nog 0.37.0.
- **Sleutel.** 93 gebreken onder 51 criteria, tegen 79 bij 0.35.0. Nieuw zijn documenten, een inlog met pagina's onder `/mijn/`, inhoud en leesverzoeken van een andere partij (Kijkpunt, op `localhost`), en twee gebreken die de eerste ronde in de testsite zelf vond.
- **Bevroren veegronde, per variant één.** Gemaakt met `just sweep-check --fixed-ports --allow-writes --max-writes 80` op 16 pagina's: 65 van de 65 gebreken die een script kan zien op Lindewaard, geen bewijs op Berkenveen. De veegronde mocht vanaf het begin versturen naar de eigen origin (80 keer) en naar Kijkpunt (eerst 80, met toestemming opgehoogd naar 300, want elke keer dat de pagina met vragen laadt, telt Kijkpunt een bezoek). Daarna de poort met de verkenner, met de recepten van de eerste ronde als begin: één ronde per variant tot "bewijs voldoende", en daarna opnieuw getoetst tegen de sleutel.
- **Runs.** L1 en L2 op Lindewaard, B1 op Berkenveen, alle 56 criteria, zes agents per run, elk op een kopie van de veegronde, ingelogd met het testaccount. De drie runs liepen tegelijk. VoiceOver uit, zoals bij 0.35.0.
- **Vergelijking.** Per run `compare --findings` met twee vergelijkers (A en B), tegen `reference-lindewaard.json` of `reference-berkenveen.json`.
- **Stopregel.** Een derde run op Lindewaard als L1 en L2 bij meer dan twee criteria een andere uitkomst hadden.
- **Marge.** Als bij 0.35.0, naar verhouding van de grotere sleutel: gemiddeld niet minder dan 91 van de 93 gebreken gevonden, per run ten hoogste 12 meldingen zonder tegenhanger, geen criterium open door een grens van loep (behalve 1.2.3 en 1.2.5 op de tweeling, en 2.2.1 en 3.3.8, die kennis van de eigenaar vragen), en op de tweeling geen bevinding die beide vergelijkers onterecht noemen.

## Uitkomst

| | L1 | L2 | B1 |
|---|---|---|---|
| Duur van de werkstroom | 90 minuten | 87 minuten | 99 minuten |
| Voldoet niet, voldoet, n.v.t., open | 51, 2, 2, 0 | 51, 2, 2, 0 | 4, 42, 5, 4 |
| Gebreken uit de sleutel gevonden, van wat meetelt | 91 van 92 | 91 van 92 | n.v.t. |
| Criteria die de sleutel afkeurt en loep goedkeurde | 0 | 0 | n.v.t. |
| Meldingen zonder tegenhanger | 7 en 8 (A, B) | 6 | 4 |
| Onterecht volgens beide vergelijkers | 0 | 0 | 0 |
| Verstuurd naar de site, van 80 | 18 | 20 | 26 |

L1 en L2 gaven bij alle 56 criteria dezelfde uitkomst, dus een derde run was niet nodig. A en B waren het over elk gebrek uit de sleutel eens.

**Wat L1 en L2 misten.** Alleen `1.3.1-begroting-pdf`: het document is 262 MB en de grens is 250 MB, en loep meldt dat zelf als beperking. `1.3.1-afvalwijzer-extern` staat op een ander domein en telt niet mee.

**Berkenveen.** Vier afkeuringen, alle vier discutabel volgens beide vergelijkers: de ondertitels noemen de spreker niet (1.2.2), Tab blijft binnen de open chat, waar ook de knop om te sluiten staat (2.4.3), een verplicht vinkje heeft geen aanduiding (3.3.2), en het wachtwoord wijzigen gaat zonder bevestiging (3.3.4). Open bleven 1.2.3 en 1.2.5 (de video en het geluid van een externe speler) en 2.2.1 en 3.3.8 (de duur van de sessie en de wachtwoordbeheerder), precies de criteria die de marge toestaat.

## De eerste ronde

De eerste ronde liep op main `60d0796` met #708, vóór de fouten hieronder hersteld waren. Op Lindewaard vond ze 89 en 88 van de 90 gebreken die toen meetelden, zonder onterechte bevinding. Op Berkenveen haalde ze de lat niet: zeven criteria open, waarvan vier niet mochten (3.2.2, 3.3.1, 3.3.3 en 4.1.3), en de tweeling bleek zelf een gebrek op 1.4.1 te hebben. Wat de eerste ronde vond en wat daarna is hersteld:

- De formulierproef liet formulieren weg en hergebruikte uitkomsten van vóór het schrijfrecht (#716, #719). Daardoor ontbraken het formulier voor het wachtwoord en dat voor het intrekken in het dossier.
- Een venster op deze machine kon naast een lokale site geen eigen toestemming krijgen, dus het antwoord op de vragenlijst bij Kijkpunt bleef tegengehouden (#717, #720).
- Hetzelfde formulier werd op elke pagina waar het staat opnieuw verstuurd (#721, #722).
- De tweeling toonde de afvalbakken alleen met kleur, en de sleutel kende twee gebreken niet (#713, #714).
- Een sessie laadde de extra vaste leesregels van de run niet (#707, #708), het geheimenschild liet een GET naar een ingesloten venster ongecontroleerd door (#701, #702), een korte pauze na een 429 brak de scripts af van een pagina die al laadde (#712), op Linux zag mockttp een gedeelde poort soms aan voor een lus (#705, #706), en de werkstroom pauzeerde op een budget dat niet bijna op was (#710, #711).

De testsite is makkelijker dan een echte site, dus deze cijfers zeggen niet hoe loep op een echte site presteert.
