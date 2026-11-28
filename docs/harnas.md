# Het harnas

Soort: beschrijving

Het harnas laat loep een backlog van sites afwerken zonder dat je bij elke stap achter een venster hoeft te zitten. Voor elke site start het één regie: een agent die de skill `nldd-a11y-audit` volgt en loep aanroept. Waar alleen een mens kan beslissen, stopt de regie en laat een vraag achter. Je draait dan het commando dat erbij staat, en `resume` gaat verder.

loep schrijft nooit in de map van een run. Het zegel van loep dekt elk bestand daarin, dus alles wat het harnas bijhoudt staat ernaast, in `~/onderzoeken/.loep/`.

## Installeren

Het harnas zit in de toolbox; er is niets extra's te installeren. Begin met `loep doctor`. Dat controleert wat een run nodig heeft: node, de toolbox, de werkstroom, de pluginversie, `vlam-claude`, de VLAM-routes, de vrije schijfruimte en de backlog. Onder 15 GB vrij begint loep geen run: `run` weigert dan met de vrije ruimte erbij, en `LOEP_MIN_FREE_GB` verzet die grens voor een machine waar je zelf oplet. Met `--routes` proeft `doctor` de VLAM-routes vooraf.

## Een site erin zetten

```
loep add https://www.voorbeeld.nl/ --organisation "Ministerie van Voorbeeld" --name Voorbeeld
```

Wat je weglaat vraagt loep als je aan een terminal zit, ook of de site achter een inlog staat, en in welke rol je daar test; zonder terminal vult het de standaard in. Een wachtwoord vraagt het nooit. De backlog staat in `~/onderzoeken/backlog.yaml` en is met de hand te lezen en bij te werken. Wat de skill vooraf vraagt, staat in datzelfde blok, zodat de regie het niet hoeft te vragen:

```yaml
- url: https://www.voorbeeld.nl/
  slug: voorbeeld.nl
  name: Voorbeeld
  organisation: Ministerie van Voorbeeld
  purpose: verbeteren            # of verantwoorden
  sending:
    allow: false                 # mag een agent naar de site versturen?
    max: null                    # null: het budget van loep zelf, 5 op een testomgeving en 50 op deze machine
  also-origins: []               # subdomein of documentatie die erbij hoort
  never-open: []                 # hosts die geen agent mag openen
  login:                         # null, of waar en in welke rol een testaccount inlogt
    page: https://www.voorbeeld.nl/inloggen
    role: testgebruiker
  at-once: 2                     # agents tegelijk in de fasen met agents; loep zet het op 2, de machine draait er niet meer dan dat
  navigation-delay: null         # seconden tussen twee navigaties naar de site, voor een site die traag of kwetsbaar is
  mailbox: null                  # imap://host:993 als de site links per mail stuurt
  vendor-tags: []
  note: ""
```

Een wachtwoord hoort hier niet in. Wat je met `--login-page` en `--login-role` vastlegt is waar de inlog staat en in welke rol je test, niet hoe je binnenkomt.

Het inloggen zelf gebeurt aan het begin van de run, en twee keer: een keer voor de meting en een keer voor de proef op de sessie. loep opent daarvoor een browservenster op de machine waar je zit, jij typt de gegevens van het testaccount in dat venster, en loep bewaart alleen de sessie die overblijft. Het wachtwoord ziet loep nooit. De regie kan dat niet zelf, want een `claude -p` heeft geen venster: hij stopt en zet de twee commando's in `vraag.md`. Jij draait ze:

```
loep audit login <site>            # de meting
loep audit login <site> --idle     # de proef op de sessie
```

Daarna gaat de run verder met `loep resume <site>`. Typ je de inlog liever niet bij elke run opnieuw, bewaar de sessie dan buiten de run: `loep audit login <site> --out ~/onderzoeken/secrets/<site>-sessie.json`, en daarna `loep audit login <site> --from ~/onderzoeken/secrets/<site>-sessie.json`.

Elke stap van het onderzoek neemt naast `--run <run>` ook de site zelf: `loep audit login voorbeeld.nl` zoekt de run van die site op. Zo staan de commando's in `vraag.md`.

## Lopen

```
loep run                  # één site, in de orde van het bestand
loep run --sites 3        # drie na elkaar
loep run --only voorbeeld.nl
loep run --only voorbeeld.nl --new
```

Een tempo zet je ook bij het toevoegen: `loep add <url> --navigation-delay 2`.

loep pakt een slot, start de regie en leest de stream voor de voortgang: `inventory`, `gate`, `werkstroom`. Een site die op een mens wacht houdt de rest niet tegen. Elke site krijgt één map voor zijn run: `~/onderzoeken/<slug>/<datum>/`. Een tweede start op dezelfde dag gaat verder in dezelfde map, want de run zelf zegt waar hij staat.

Een regie die een subagent start en haar beurt teruggeeft, wacht daarop; zonder ingrijpen stopt `claude -p` zo'n subagent na tien minuten en blijft er een half onderzoek achter. loep zet die grens op zes uur en start, als een beurt toch zonder vraag en zonder zegel eindigt, zelf de volgende beurt, tot twintig keer, alleen zolang de run groeit en alleen zolang er 15 GB vrij is. Hervat je zelf, dan begint die telling opnieuw. Een run telt pas als klaar wanneer `audit verify` zegt dat het zegel klopt met wat er staat: een zegel van voor een antwoord telt niet.

Stop je loep met Ctrl-C, dan stopt de regie, staat de site op gepauzeerd en begint loep niet aan een volgende beurt of een volgende site. `loep resume <site>` gaat verder in dezelfde run. `loep pause` op een site die nog loopt, zegt hoe je hem zo stopt. Werd loep zelf gestopt zonder dat het iets kon schrijven, bijvoorbeeld met `kill -9`, dan loopt de regie door terwijl loep weg is. `loep status` zegt dat dan, met het proces erbij, en `loep status <site>` zet de site op `loopt zonder loep`. `loep pause` weigert zolang die regie leeft, en `loep run` slaat de site over met een regel erover; de rest van de backlog loopt door, want elke site heeft zijn eigen run. Twee regies in dezelfde run schrijven hetzelfde bewijs. Stop hem met `kill <pid>`, en ga daarna verder waar de run staat, met `loep audit pending`.

Een run hoort bij één checkout. Hervat je hem in een andere versie, dan zegt loep welke twee dat zijn en stopt hij, in plaats van bewijs van twee versies te mengen. Wat er dan overblijft is een nieuwe run naast de oude: `--new` laat de bestaande map staan en begint in `<datum>-2`, ook voor een site die klaar is of op een mens wacht. Ook `loep dev meting` kent die vlag. Een tag die later op dezelfde commit komt, maakt geen andere versie; wijzigingen die niet zijn gecommit wel, want loep legt er een hash van vast.

```
loep status              # de backlog met de stand van elke site
loep status <site>       # de run, de laatste stap, de vraag
loep log <site> [-f]     # wat de regie deed
loep pause <site>
```

## Als loep om een mens stopt

De regie schrijft dan `vraag.md` in `~/onderzoeken/.loep/<slug>/`: de vraag, het exacte commando en wat er daarna moet bestaan. `loep run` en `loep status` tonen hetzelfde. Je draait het commando zelf:

```
loep audit login <site>          # het testaccount, als de site achter een inlog zit
loep audit answer <site> --criterion 1.4.3 ...
loep audit sign <site>
loep audit decide <site>
loep statement <site>
```

Die vijf geven de terminal aan loep zelf, met de opties die je erachter zet. loep typt niets voor je in, want loep wil dat een mens het bevestigt. loep onthoudt wel wat je deed en zegt het de regie bij de volgende `resume`: na een antwoord draait die stap 7 opnieuw (`audit evaluate`, `audit render`, `audit seal`), na een handtekening `audit render` en `audit verify`. Daarna:

```
loep resume <site> --what "de gebruiker bevestigde dat docs.voorbeeld.nl erbij hoort"
```

Hervatten begint met `audit pending`, dus de run gaat verder waar hij staat. Vindt loep geen vraag en ook geen verzegelde run, dan zegt `status` dat de regie onduidelijk stopte, met de laatste regels van het transcript erbij.

## Een meting voor een release

Voor een release wil je weten wat loep doet op zijn eigen testwebsites: Lindewaard, waar de gebreken met opzet in zitten, en Berkenveen, de schone tweeling. Dat zijn gewone runs van loep, dus loep draait ze als gewone runs: de regie volgt de skill, de verkenner en de werkstroom doen hun werk, en er komt een verzegeld rapport per site uit. Het enige verschil is de backlog: die van de meting staat apart, zodat de testwebsites nooit tussen de sites van echte eigenaren komen.

```
just testsite                 # in een ander venster: de twee testwebsites op 4710 en 4711
loep dev meting               # beide erdoor, met agents; de rapporten komen in ~/onderzoeken/meting/rapporten/
loep dev meting --only lindewaard
```

Na een verzegelde run zet loep het rapport zelf buiten de run, met de opdracht `audit handout` van de toolbox: `~/onderzoeken/meting/rapporten/rapport-lindewaard-2026-11-23-concept.pdf` en de korte versie en de html ernaast. De naam zegt de site zoals loep die kent, niet de host van de url, want `rapport-127.0.0.1-4710` leest niet.

loep zet de twee testwebsites zelf in de backlog van de meting, met de aantekening waar elke site voor dient. Antwoordt een van de twee niet, dan stopt loep voordat er een agent begint, met de opdracht om de testsite te starten. Een meting heeft een eigen slot, dus ze houdt een run van echte sites niet tegen; draai ze wel niet tegelijk, want ze delen de machine en de browsers.

Naast deze meting met agents is er de regressietoets zonder taalmodel die de pijplijn zelf draait: `just sweep-check`. Die telt of elk ingebouwd gebrek in het dossier staat, zonder taalmodel en zonder een agent.

## Waar alles staat

| Wat | Waar |
|---|---|
| De backlog | `~/onderzoeken/backlog.yaml` |
| De stand, per site | `~/onderzoeken/.loep/state.json` |
| De vraag, het transcript, het log | `~/onderzoeken/.loep/<slug>/` |
| De run van loep | `~/onderzoeken/<slug>/<datum>/` |
| De rapporten | `~/onderzoeken/rapporten/` |
| Een meting: backlog, runs en rapporten | `~/onderzoeken/meting/` |

`LOEP_HOME` verzet de backlog, de stand en de vragen naar een eigen map. Een meting heeft er altijd een van zichzelf, zodat de testwebsites buiten de backlog van echte eigenaren blijven.

## Wat het harnas niet doet

Het harnas meet niets zelf: elke meting en elk oordeel komt van een stap van het onderzoek, zodat het bewijs in de run staat en `loep audit verify --run <run>` het kan nalopen. Het start geen agent buiten de werkstroom om, en schrijft geen antwoord, besluit of handtekening voor een mens op.

De regie mag Bash gebruiken, want de skill schrijft samengestelde commando's. `curl`, `wget`, `nc`, `ssh` en WebFetch zijn geweigerd, maar dat is geen harde grens: een regie kan via `node -e` de site bereiken of buiten de run schrijven. Dat ze het niet doet, hangt aan de spelregels in haar opdracht, en wat er toch in de run komt, ziet `audit verify`. De regie erft de omgeving van wie loep start; zet daar geen geheimen in die een run niet nodig heeft. Het transcript in `~/onderzoeken/.loep/` is alleen voor jou leesbaar.
