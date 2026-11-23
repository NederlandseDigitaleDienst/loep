# lus

Soort: beschrijving

lus laat loep over een backlog van sites lopen zonder dat je bij elke stap achter een venster hoeft te zitten. Voor elke site start het één regie: een agent die de skill `nldd-a11y-audit` volgt en loep aanroept. Waar alleen een mens kan beslissen, stopt de regie en laat een vraag achter. Je draait dan het commando dat erbij staat, en lus gaat verder.

lus schrijft nooit in de map van een run. Het zegel van loep dekt elk bestand daarin, dus alles wat lus bijhoudt staat ernaast, in `~/onderzoeken/.lus/`.

## Installeren

```
cd lus && npm ci
```

Daarna roep je lus aan vanuit de checkout, als `node lus/src/cli.ts <commando>`, of als `lus <commando>` wanneer de map van lus op je pad staat. Begin met `lus doctor`. Dat controleert wat een run nodig heeft: node, de toolbox, de werkstroom, de pluginversie, `vlam-claude`, de VLAM-routes, de vrije schijfruimte en de backlog. Onder 15 GB vrij begint lus niets nieuws, en met `--routes` proeft het de VLAM-routes vooraf.

## Een site erin zetten

```
lus add https://www.voorbeeld.nl/ --organisation "Ministerie van Voorbeeld" --name Voorbeeld
```

Wat je weglaat vraagt lus als je aan een terminal zit; zonder terminal vult het de standaard in. De backlog staat in `~/onderzoeken/backlog.yaml` en is met de hand te lezen en bij te werken. Wat de skill vooraf vraagt, staat in datzelfde blok, zodat de regie het niet hoeft te vragen:

```yaml
- url: https://www.voorbeeld.nl/
  slug: voorbeeld.nl
  name: Voorbeeld
  organisation: Ministerie van Voorbeeld
  purpose: verbeteren            # of verantwoorden
  sending:
    allow: false                 # mag een agent naar de site versturen?
    max: 20
  also-origins: []               # subdomein of documentatie die erbij hoort
  never-open: []                 # hosts die geen agent mag openen
  login:                         # null, of waar en in welke rol een testaccount inlogt
    page: https://www.voorbeeld.nl/inloggen
    role: testgebruiker
  at-once: 3                     # agents tegelijk in de fasen met agents
  mailbox: null                  # imap://host:993 als de site links per mail stuurt
  vendor-tags: []
  note: ""
```

Een wachtwoord hoort hier niet in. De gebruiker logt zelf in, in een browservenster, en loep bewaart de sessie.

## Lopen

```
lus run                  # één site, in de orde van het bestand
lus run --sites 3        # drie na elkaar
lus run --only voorbeeld.nl
```

lus pakt een slot, start de regie en leest de stream voor de voortgang: `inventory`, `gate`, `werkstroom`. Een site die op een mens wacht houdt de rest niet tegen. Elke site krijgt één map voor zijn run: `~/onderzoeken/<slug>/<datum>/`. Een tweede start op dezelfde dag gaat verder in dezelfde map, want de run zelf zegt waar hij staat.

```
lus list                 # de backlog met de stand van elke site
lus status <site>        # de run, de laatste stap, de vraag
lus log <site> [-f]      # wat de regie deed
lus pause <site>
```

## Als lus om een mens stopt

De regie schrijft dan `vraag.md` in `~/onderzoeken/.lus/<slug>/`: de vraag, het exacte commando en wat er daarna moet bestaan. `lus run` en `lus status` tonen hetzelfde. Je draait het commando zelf:

```
lus answer <site> -- --criterion 1.4.3 ...
lus sign <site>
lus decide <site>
lus statement <site>
```

Die vier geven de terminal aan loep zelf. lus voert ze niet uit en typt niets voor je in, want loep wil dat een mens het bevestigt. Daarna:

```
lus resume <site> --what "de gebruiker bevestigde dat docs.voorbeeld.nl erbij hoort"
```

Hervatten begint met `pending`, dus de run gaat verder waar hij staat. Vindt lus geen vraag en ook geen verzegelde run, dan zegt `status` dat de regie onduidelijk stopte, met de laatste regels van het transcript erbij.

## Een meting voor een release

Voor een release wil je weten wat loep doet op zijn eigen testwebsites: Lindewaard, waar de gebreken met opzet in zitten, en Berkenveen, de schone tweeling. Dat zijn gewone runs van loep, dus lus draait ze als gewone runs: de regie volgt de skill, de verkenner en de werkstroom doen hun werk, en er komt een verzegeld rapport per site uit. Het enige verschil is de backlog: die van de meting staat apart, zodat de testwebsites nooit tussen de sites van echte eigenaren komen.

```
just testsite                 # in een ander venster: de twee testwebsites op 4710 en 4711
lus meting                    # beide erdoor, met agents; de rapporten komen in ~/onderzoeken/meting/rapporten/
lus meting --only lindewaard
```

lus zet de twee testwebsites zelf in de backlog van de meting, met de aantekening waar elke site voor dient. Antwoordt een van de twee niet, dan stopt lus voordat er een agent begint, met de opdracht om de testsite te starten. Een meting heeft een eigen slot, dus ze houdt een run van echte sites niet tegen; draai ze wel niet tegelijk, want ze delen de machine en de browsers.

Naast deze meting met agents is er de regressietoets zonder taalmodel die de pijplijn zelf draait: `just sweep-check`. Die telt of elk ingebouwd gebrek in het dossier staat, zonder taalmodel en zonder een agent.

## Waar alles staat

| Wat | Waar |
|---|---|
| De backlog | `~/onderzoeken/backlog.yaml` |
| De stand, per site | `~/onderzoeken/.lus/state.json` |
| De vraag, het transcript, het log van lus | `~/onderzoeken/.lus/<slug>/` |
| De run van loep | `~/onderzoeken/<slug>/<datum>/` |
| De rapporten | `~/onderzoeken/rapporten/` |
| Een meting: backlog, runs en rapporten | `~/onderzoeken/meting/` |

`LUS_HOME` verzet de backlog, de stand en de vragen naar een eigen map. Een meting heeft er altijd een van zichzelf, zodat de testwebsites buiten de backlog van echte eigenaren blijven.

## Wat lus niet doet

lus meet niets zelf: elke meting en elk oordeel komt van loep, zodat het bewijs in de run staat en `node toolbox/src/cli.ts verify --run <run>` het kan nalopen. Het start geen agent buiten de werkstroom van loep om, en het schrijft geen antwoord, besluit of handtekening voor een mens op.
