# lus

Soort: beschrijving

lus laat loep over een backlog van sites lopen zonder dat je bij elke stap achter een venster hoeft te zitten. Voor elke site start het één regie: een agent die de skill `nldd-a11y-audit` volgt en loep aanroept. Waar alleen een mens kan beslissen, stopt de regie en laat een vraag achter. Je draait dan het commando dat erbij staat, en lus gaat verder.

lus schrijft nooit in de map van een run. Het zegel van loep dekt elk bestand daarin, dus alles wat lus bijhoudt staat ernaast, in `~/onderzoeken/.lus/`.

## Installeren

```
cd lus && npm ci
```

Daarna roep je lus aan vanuit de checkout, als `node lus/src/cli.ts <commando>`, of als `lus <commando>` wanneer de map van lus op je pad staat. Begin met `lus doctor`. Dat controleert wat een run nodig heeft: node, de toolbox, de werkstroom, de pluginversie, `vlam-claude`, de VLAM-routes, de vrije schijfruimte en de backlog. Onder 15 GB vrij begint lus geen run: `lus run` weigert dan met de vrije ruimte erbij, en `LUS_MIN_FREE_GB` verzet die grens voor een machine waar je zelf oplet. Met `--routes` proeft `lus doctor` de VLAM-routes vooraf.

## Een site erin zetten

```
lus add https://www.voorbeeld.nl/ --organisation "Ministerie van Voorbeeld" --name Voorbeeld
```

Wat je weglaat vraagt lus als je aan een terminal zit, ook of de site achter een inlog staat, en in welke rol je daar test; zonder terminal vult het de standaard in. Een wachtwoord vraagt het nooit. De backlog staat in `~/onderzoeken/backlog.yaml` en is met de hand te lezen en bij te werken. Wat de skill vooraf vraagt, staat in datzelfde blok, zodat de regie het niet hoeft te vragen:

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
  at-once: 2                     # agents tegelijk in de fasen met agents; lus zet het op 2, de machine draait er niet meer dan dat
  navigation-delay: null         # seconden tussen twee navigaties naar de site, voor een site die traag of kwetsbaar is
  mailbox: null                  # imap://host:993 als de site links per mail stuurt
  vendor-tags: []
  note: ""
```

Een wachtwoord hoort hier niet in. Wat je met `--login-page` en `--login-role` vastlegt is waar de inlog staat en in welke rol je test, niet hoe je binnenkomt.

Het inloggen zelf gebeurt aan het begin van de run, en twee keer: een keer voor de meting en een keer voor de proef op de sessie. loep opent daarvoor een browservenster op de machine waar je zit, jij typt de gegevens van het testaccount in dat venster, en loep bewaart alleen de sessie die overblijft. Het wachtwoord ziet loep nooit. De regie kan dat niet zelf, want een `claude -p` heeft geen venster: hij stopt en zet de twee commando's in `vraag.md`. Jij draait ze:

```
lus login <site>            # de meting
lus login <site> --idle     # de proef op de sessie
```

Daarna gaat de run verder met `lus resume <site>`. Typ je de inlog liever niet bij elke run opnieuw, bewaar de sessie dan buiten de run: `lus login <site> --out ~/onderzoeken/secrets/<site>-sessie.json`, en daarna `lus login <site> --from ~/onderzoeken/secrets/<site>-sessie.json`.

## Lopen

```
lus run                  # één site, in de orde van het bestand
lus run --sites 3        # drie na elkaar
lus run --only voorbeeld.nl
lus run --only voorbeeld.nl --new
```

lus pakt een slot, start de regie en leest de stream voor de voortgang: `inventory`, `gate`, `werkstroom`. Een site die op een mens wacht houdt de rest niet tegen. Elke site krijgt één map voor zijn run: `~/onderzoeken/<slug>/<datum>/`. Een tweede start op dezelfde dag gaat verder in dezelfde map, want de run zelf zegt waar hij staat.

Een regie die een subagent start en haar beurt teruggeeft, wacht daarop; zonder ingrijpen stopt `claude -p` zo'n subagent na tien minuten en blijft er een half onderzoek achter. lus zet die grens op zes uur en start, als een beurt toch zonder vraag en zonder zegel eindigt, zelf de volgende beurt, tot twintig keer en alleen zolang de run groeit.

Een run hoort bij één checkout. Hervat je hem in een andere versie, dan zegt lus welke twee dat zijn en stopt hij, in plaats van bewijs van twee versies te mengen. Wat er dan overblijft is een nieuwe run naast de oude: `--new` laat de bestaande map staan en begint in `<datum>-2`. Ook `lus meting` kent die vlag.

```
lus list                 # de backlog met de stand van elke site
lus status <site>        # de run, de laatste stap, de vraag
lus log <site> [-f]      # wat de regie deed
lus pause <site>
```

## Als lus om een mens stopt

De regie schrijft dan `vraag.md` in `~/onderzoeken/.lus/<slug>/`: de vraag, het exacte commando en wat er daarna moet bestaan. `lus run` en `lus status` tonen hetzelfde. Je draait het commando zelf:

```
lus login <site>          # het testaccount, als de site achter een inlog zit
lus answer <site> -- --criterion 1.4.3 ...
lus sign <site>
lus decide <site>
lus statement <site>
```

Die vijf geven de terminal aan loep zelf. lus voert ze niet uit en typt niets voor je in, want loep wil dat een mens het bevestigt. Daarna:

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

Na een verzegelde run zet lus het rapport zelf buiten de run, met de opdracht `handout` van de toolbox: `~/onderzoeken/meting/rapporten/rapport-lindewaard-2026-11-23-concept.pdf` en de korte versie en de html ernaast. De naam zegt de site zoals lus die kent, niet de host van de url, want `rapport-127.0.0.1-4710` leest niet.

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
