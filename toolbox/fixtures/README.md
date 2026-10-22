# Testsite met ingebouwde gebreken

Twee keer dezelfde kleine gemeentesite, lokaal en statisch. Lindewaard bevat de gebreken, Berkenveen is de tweeling waarin dezelfde plekken goed zijn gedaan. Een derde adres (Kijkpunt) speelt een externe videodienst en formulierdienst. Hiermee tellen we wat een vergelijking met een bestaand rapport niet kan tellen: gemiste gebreken, valse meldingen en onterechte goedkeuringen.

## Gebruiken

```
just testsite                 # Lindewaard op 4710, Berkenveen op 4711, Kijkpunt op 4712
just testsite --log pad.log   # eigen logbestand
```

Daarna vanuit `toolbox/`:

```
node src/cli.ts inventory http://127.0.0.1:4710/ --out runs/<naam>
node src/cli.ts compare --run runs/<naam> --reference fixtures/reference-lindewaard.json --out <map>
node src/cli.ts compare --findings tasks --run runs/<naam> --reference fixtures/reference-lindewaard.json
```

Voor Berkenveen is `reference-berkenveen.json` de referentie: geen enkel criterium hoort daar te worden afgekeurd, dus alles onder "alleen wij" is een valse melding of een gebrek dat er per ongeluk in zit.

De server schrijft elk verzoek dat geen GET of HEAD is en elk bericht over de WebSocket van de chat naar het logbestand (standaard `runs/fixture-server.log`), één JSON-object per regel. Het log wordt nooit geleegd. Tel de regels met `kind` gelijk aan `request` of `ws-message` voor en na een run: het verschil hoort nul te zijn.

## Regressietoets van de veegronde

```
just sweep-check                       # beide varianten, een tabel in een tijdelijke map
just sweep-check --out pad --at-once 3 # eigen map, drie pagina's tegelijk per variant
just sweep-check --runs pad/runs       # bestaande runs opnieuw lezen, zonder te meten
just sweep-check --out pad --fixed-ports # op de poorten van just testsite, voor een bevroren veegronde
```

De runs blijven staan in `<out>/runs/defect` en `<out>/runs/clean`; een volgende keer met dezelfde `--out` maakt die map eerst leeg. Zonder `--fixed-ports` draait de testsite op willekeurige vrije poorten, zodat de toets nergens mee botst, maar zijn de adressen in de runs daarna niet meer te openen. Met `--fixed-ports` gebruikt hij 4710, 4711 en 4712, net als `just testsite`, zodat een meting de runs als bevroren veegronde kan gebruiken (zie [validatie/verbruik/README.md](../../validatie/verbruik/README.md)). Draait `just testsite` al, dan stopt de toets met die melding.

Zonder taalmodel en zonder verkenner. Op beide varianten draaien `inventory` (de pagina's waarop een gebrek staat, als vaste lijst), het vaste sitemodel uit `sweep/` (met `check-site`), `sample`, `collect`, `contrast` en `states`. Daarna zoekt de toets per gebrek het bewijs op de plek in het dossier die `evidence.ts` noemt. Een gebrek dat alleen een agent kan zien (kijken, luisteren of een oordeel over tekst) staat daar met de reden en telt niet mee. Op Berkenveen draait dezelfde toets op dezelfde plek: daar hoort niets te staan.

De uitkomst is een tabel per gebrek (gevonden, ontbreekt, niet door een script te zien) in `sweep-check.md` en `sweep-check.json`. De toets faalt als een gebrek dat in de basislijn (`sweep/baseline.json`) werd gevonden nu ontbreekt, of als er op Berkenveen bewijs bijkomt. Wordt iets beter, dan zegt de tabel dat; werk dan de basislijn bij. Doe dat met de uitkomst van de CI, niet van een eigen machine, want lettertypen en hulpprogramma's verschillen: haal de artefacten `veegronde-Lindewaard` en `veegronde-Berkenveen` op en draai `just sweep-check --from-report <lindewaard>/sweep-check.json --from-report <berkenveen>/sweep-check.json --update-baseline`.

| Pad | Inhoud |
|---|---|
| `evidence.ts` | Per gebrek waar het bewijs in het dossier staat, of waarom alleen een agent het ziet |
| `sweep/site.json` | Het vaste sitemodel voor beide varianten. `{origin}` en `{thirdParty}` worden bij het draaien ingevuld; een onderdeel met `variants` geldt alleen voor die variant |
| `sweep/recipes/` | De recepten van het sitemodel. Een stap noemt zijn element per variant als de twee sites daar anders zijn gebouwd |
| `sweep/baseline.json` | Wat de toets vond toen de basislijn werd vastgelegd |

Op GitHub draait de toets bij elk voorstel dat `toolbox/src/`, `toolbox/package-lock.json`, de testsite of de toets zelf raakt, Lindewaard en Berkenveen in twee jobs naast elkaar, met de tabel als artefact.

## Het deel achter een inlog

Beide sites hebben vier pagina's onder `/mijn/` die alleen bestaan voor wie is ingelogd. Zonder sessie stuurt de server door naar `/inloggen.html`. Geen sitemap noemt ze. Inloggen gaat met het formulier op die pagina; de gegevens van het ene account staan in `account.ts` en horen alleen bij deze testsite. Een sessie is een cookie en verloopt een half uur na het inloggen, of na het aantal seconden van `--session-seconds`.

Uitloggen kan op twee plekken: de link "Uitloggen" naar `/uitloggen` op elke pagina, en de link "Afmelden" naar `/mijn/sessie-sluiten` op de pagina met gegevens. Aan het tweede adres is niet te zien dat het uitlogt. Een run met inlog mag geen van beide volgen; de server telt hoe vaak het toch gebeurde.

In tests logt de code zelf in met dat account. Op elke andere site logt een mens in, nooit de code.

## Wat waar staat

| Pad | Inhoud | Geserveerd |
|---|---|---|
| `src/` | De bronnen. Elke plek met een gebrek staat er in twee versies tussen `@bad <id>`, `@good` en `@end` | nee |
| `build.ts` | Maakt uit de bronnen de twee sites, `key.json` en de referentiebestanden | nee |
| `defects.ts` | De antwoordsleutel: gebreken, verwachte uitkomst per criterium, valkuilen | nee |
| `key.json` | Dezelfde sleutel als JSON | nee |
| `account.ts` | Het account van het deel achter de inlog, en de adressen die erbij horen | nee |
| `reference-*.json` | De sleutel in de vorm die `compare` leest, zie `validatie/README.md` | nee |
| `sites/` | De gegenereerde sites. Staan in git; de server bouwt niets | ja |
| `serve.ts` | De server, alleen Node zelf. Houdt de sessies van het deel achter de inlog bij | nee |

In wat wordt geserveerd staat niets dat het antwoord verraadt: geen aanwijzing in adressen, klassenamen, commentaar of tekst. Een test bewaakt dat.

## Een gebrek toevoegen of wijzigen

1. Zet in `src/` beide versies tussen de markeringen, met een id dat begint met het criterium.
2. Voeg het gebrek toe aan `defects.ts`, met een selector die op de pagina in Lindewaard iets vindt.
3. `just testsite-build` en daarna `just test`. De bouw weigert als een id in de bronnen niet in de sleutel staat of andersom. De test controleert elke selector in beide sites.

## Media

`src/media/` bevat een korte video (dia met agenda en uitslag, met gesproken tekst) in twee versies, een gesproken fragment en een melodie. Ze zijn eenmalig gemaakt met de spraaksynthese van het besturingssysteem en ffmpeg en staan als bestand in git. In Berkenveen leest de spreker voor wat op de dia staat; in Lindewaard niet.

## Grenzen

- "Voldoet" voor Berkenveen is de bedoeling, geen bewezen feit. Een bevinding daar kan terecht zijn.
- De sleutel noemt alleen wat met opzet fout is gemaakt. Lindewaard kan meer gebreken hebben.
- De testsite heeft geen documenten: geen pdf, geen kantoorbestanden en geen platte tekst. Het meten van documenten is alleen getest in `toolbox/test/documents.test.ts`: pdf op bestanden in `toolbox/test/fixtures/documents/`, kantoorbestanden en platte tekst op inhoud die de test zelf opbouwt.
- Drie criteria zijn in beide sites niet van toepassing (1.2.4, 2.3.1, 2.5.4) en twee zijn in beide goed (2.4.5, 4.1.1). Die meten valse meldingen.
