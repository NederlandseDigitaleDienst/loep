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
- De testsite heeft geen pdf of kantoorbestanden. Het meten van documenten is alleen getest op losse bestanden in `toolbox/test/fixtures/documents/`.
- Drie criteria zijn in beide sites niet van toepassing (1.2.4, 2.3.1, 2.5.4) en twee zijn in beide goed (2.4.5, 4.1.1). Die meten valse meldingen.
