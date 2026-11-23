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

## De metingen van deze repository

lus draait ook de metingen van loep zelf, als dezelfde taken die de pijplijn draait:

```
lus meet                 # de snelle: reuse, de types, de procedures, de tests zonder browser en die van lus
lus meet --all           # ook alle tests met browser, de veegronde op de testsite en de ijkmeting
lus meet --only veegronde
lus meet --fresh         # begin opnieuw in plaats van de meting van daarnet af te maken
```

Een meting stopt bij de eerste stap die niet in orde is, net als de pijplijn, en toont de laatste regels van dat logboek. Los je het op, dan gaat `lus meet` verder bij die stap; wat al in orde was draait niet nog eens. De logboeken staan in `~/onderzoeken/.lus/metingen/<moment>/`, en de veegronde schrijft daar ook wat hij meet. Onder 15 GB vrij begint lus geen meting, en een meting en een run gaan niet tegelijk: ze delen het slot.

## Waar alles staat

| Wat | Waar |
|---|---|
| De backlog | `~/onderzoeken/backlog.yaml` |
| De stand, per site | `~/onderzoeken/.lus/state.json` |
| De vraag, het transcript, het log van lus | `~/onderzoeken/.lus/<slug>/` |
| De metingen, met hun logboeken | `~/onderzoeken/.lus/metingen/<moment>/` |
| De run van loep | `~/onderzoeken/<slug>/<datum>/` |
| De rapporten | `~/onderzoeken/rapporten/` |

`LUS_HOME` verzet de eerste vier naar een eigen map.

## Wat lus niet doet

lus meet niets zelf: elke meting en elk oordeel komt van loep, zodat het bewijs in de run staat en `node toolbox/src/cli.ts verify --run <run>` het kan nalopen. Het start geen agent buiten de werkstroom van loep om, en het schrijft geen antwoord, besluit of handtekening voor een mens op.
