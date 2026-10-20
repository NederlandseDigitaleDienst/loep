# Validatie

Voor de vergelijking met een bestaand onderzoek van een onafhankelijke onderzoeker hoort per site een map met dat onderzoek en per run van de toolbox de vergelijking daarmee. Die mappen staan niet in de openbare repository: ze gaan over websites van andere organisaties, en een deel is een toetsset die geheim moet blijven tot de eindmeting. Hieronder staat hoe zo'n map eruitziet. De map `testsite/` bevat de metingen op de eigen testsite uit `toolbox/fixtures/`. Ook in de repository staan `nerds.digitaledienst.overheid.nl/`, met de terugkoppeling van het team van die site op de eerste rapporten, en `voiceover/`, met de proefpagina's voor VoiceOver. Het logboek van alle rondes staat in [iteraties.md](iteraties.md). Wat een meting ons leerde en wat ermee is gedaan, staat in [lessen.md](lessen.md).

De map `ijkset/` is van een andere soort: daar staat hoe vaak de regelsets en de eigen metingen gelijk hebben op de testgevallen van de ACT-regels van W3C. Zie [ijkset/README.md](ijkset/README.md).

De map `versies/` zegt per versie van loep wanneer die het laatst als geheel is gemeten, waartegen en wat daar uitkwam, in een bestand `<versie>.json`:

```json
{
  "version": "0.11.0",
  "measuredAt": "2026-10-25",
  "againstNl": "het oordeel van een menselijke deskundige op drie sites",
  "resultNl": "Eén of twee zinnen met de uitkomst, met getallen."
}
```

`evaluate` leest het bestand van zijn eigen versie, en het rapport zet de zin onder "Betrouwbaarheid en beperkingen". Is er voor een versie geen bestand, dan staat er dat deze versie niet is vergeleken met het oordeel van een menselijke deskundige en niet als geheel is gemeten op de testsite. Schrijf het bestand alleen na een meting van de hele versie, niet na een meting van een paar criteria (`tasks --only`).

De toolbox heet nu loep. De verslagen in deze map zijn geschreven toen ze nog opendeur heette en een commando in een sessie met `tg` begon; ze blijven staan zoals ze zijn.

De verslagen noemen de commit waarmee is gemeten. Tot en met 11 oktober 2026 is dat een commit uit de ontwikkelgeschiedenis van vóór deze repository, die met één commit (`76495d6`) openbaar is gemaakt; zo'n commit is hier niet op te vragen. De code van toen is daarmee niet meer precies na te gaan, alleen wat het verslag erover zegt.

## Bestanden per site

| Bestand | Inhoud |
|---|---|
| `bron.json` | Waar het bestaande rapport vandaan komt, met de hash van het bestand |
| `steekproef.txt` | De pagina's uit de steekproef van het onderzoek, één URL per regel. Invoer voor `inventory --urls` |
| `bestaand.json` | De referentie: wat het onderzoek concludeerde, in de vorm hieronder |
| `bestaand-rapport.*` | Het rapport zelf. Staat niet in de repository, omdat rapporten namen bevatten |
| `<datum>-<ronde>/` | De uitkomst van een vergelijking: `vergelijking.md` en `.json` per criterium, `bevindingen.md` en `.json` per bevinding |

## De referentie: `bestaand.json`

```json
{
  "kind": "audit",
  "wcagVersion": "2.2",
  "sampleNote": "Eén zin over de steekproef van het onderzoek.",
  "outcomeNote": "Eén zin over hoe het rapport uitkomsten telt.",
  "failed": ["1.1.1", "1.4.3"],
  "failedOnlyInDocuments": ["1.3.1"],
  "problemCount": 37,
  "findings": [
    {
      "id": "R1",
      "criterion": "1.1.1",
      "page": "/contact",
      "descriptionNl": "Link voor tekstgrootte heeft geen naam",
      "where": "kop, rechts naast het zoekveld",
      "state": "op 320 pixels breed",
      "medium": "web",
      "alsoCriteria": ["2.4.4"]
    }
  ]
}
```

| Veld | Verplicht | Betekenis |
|---|---|---|
| `wcagVersion`, `sampleNote`, `outcomeNote`, `failed` | ja | Genoeg voor de vergelijking per criterium (`compare`) |
| `failedOnlyInDocuments` | nee | Criteria die alleen op een pdf zijn afgekeurd. Die tellen niet mee |
| `problemCount` | nee | Het aantal problemen dat het rapport zelf noemt |
| `kind` | nee | `audit` (standaard) of `answer-key`. Bij een antwoordsleutel zijn de fouten met opzet ingebouwd, zoals op de testsite in `toolbox/fixtures/`. Een bevinding kan dan niet "niet meer aanwezig" of "buiten bereik" zijn |
| `findings` | voor `compare --findings` | Eén rij per bevinding van het onderzoek |

Per bevinding:

| Veld | Verplicht | Betekenis |
|---|---|---|
| `id` | ja | Nummer dat binnen dit bestand uniek is en niet meer verandert |
| `criterion` | ja | Het succescriterium, bijvoorbeeld `1.4.3` |
| `page` | ja | URL of pad op de site, of `alle` |
| `descriptionNl` | ja | De kern in één zin, in eigen woorden |
| `where` | nee | Selector of beschrijving van de plek |
| `state` | nee | De toestand waarin het te zien is: bij laden, op een smal scherm, na openen van een venster |
| `medium` | nee | `web` (standaard) of `document`. Een bevinding over een document telt mee zoals elke andere, behalve als de toolbox dat document niet onderzoekt: het staat op een ander domein, het is van een soort die niet wordt ingelezen, of het criterium is er geen waarop documenten worden beoordeeld. Dan krijgt ze vast de klasse "buiten bereik" en telt ze in geen enkel percentage mee. Zet bij `page` het adres van het document, anders is de soort niet te bepalen |
| `alsoCriteria` | nee | Andere criteria die hetzelfde gebrek raakt |

Neem geen tekst uit het rapport over en noem geen personen. Schrijf de kern van elke bevinding in eigen woorden. Niet elk `bestaand.json` heeft `findings`. Bij de drie sites die op 10 oktober 2026 zijn vergeleken, staat de nummering van de bevindingen in de bijlage van `analyse.md`.

## Vergelijken

`LOEP` is `node toolbox/src/cli.ts`. `RUN` is een run met een `evaluation.json`.

Per criterium, zonder taalmodel:

```
LOEP compare --run RUN --reference validatie/<site>/bestaand.json --out validatie/<site>/<datum>-<ronde>
```

Per bevinding, in drie vaste stappen:

```
LOEP compare --findings tasks --run RUN --reference validatie/<site>/bestaand.json
LOEP compare --findings check --run RUN --round a
LOEP compare --findings check --run RUN --round b
LOEP compare --findings merge --run RUN --out validatie/<site>/<datum>-<ronde>
```

1. `tasks` schrijft in `RUN/compare/` het invoerbestand `invoer.json` en twee opdrachten, `opdracht-a.md` en `opdracht-b.md`. De tekst komt uit `templates/vergelijk.md` en is voor beide gelijk.
2. Twee aparte agents krijgen elk één opdracht: "Lees het bestand `<pad>` en voer de opdracht daarin precies uit." Ze weten niet van elkaar. Elk schrijft een indeling (`a.json`, `b.json`) en draait zelf `check`. Een indeling telt pas als de controle slaagt; dan krijgt ze een stempel dat haar bindt aan de invoer en de opdracht.
3. `merge` legt de twee indelingen naast elkaar en schrijft `bevindingen.md` en `bevindingen.json`. Waar A en B een andere klasse geven, telt de bevinding als "oneens". Dat is een eigen getal en wordt niet opgelost.

## Klassen

Voor een bevinding van de referentie:

| Klasse | Betekenis |
|---|---|
| `gevonden` | Een bevinding van de toolbox beschrijft hetzelfde gebrek op dezelfde plek |
| `deels` | Zelfde soort fout, maar een andere plek of maar een deel |
| `gemist-bewijs-beoordeling` | Het bewijs stond in het dossier van het criterium en het oordeel liet het liggen |
| `gemist-bewijs-dossier` | Het bewijs staat in de run, maar kwam niet in het dossier |
| `gemist-geen-bewijs` | Het bewijs is niet verzameld |
| `niet-meer-aanwezig` | De pagina is sinds het onderzoek veranderd en het gebrek is weg |
| `buiten-bereik` | De toolbox onderzoekt dit niet: iets achter een inlog, een stream of media waarvan het bestand niet op te halen is, en een document op een ander domein, van een soort die niet wordt ingelezen of op een criterium waarop documenten niet worden beoordeeld. Voor documenten bepaalt een script dit; voor het overige beslist de vergelijker |

Voor een bevinding van de toolbox zonder tegenhanger: `terecht`, `discutabel` of `onterecht`.

Het aandeel "gevonden" staat er twee keer: van alle bevindingen die meetellen, en van de bevindingen die nog bestaan en binnen bereik zijn.
