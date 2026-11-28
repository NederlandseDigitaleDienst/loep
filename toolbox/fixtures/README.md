# Testsite met ingebouwde gebreken

Twee keer dezelfde kleine gemeentesite, lokaal en statisch. Lindewaard bevat de gebreken, Berkenveen is de tweeling waarin dezelfde plekken goed zijn gedaan. Een derde adres (Kijkpunt) speelt een externe videodienst en formulierdienst, en levert een blok met berichten en een vragenlijst. Hiermee tellen we wat een vergelijking met een bestaand rapport niet kan tellen: gemiste gebreken, valse meldingen en onterechte goedkeuringen.

## Gebruiken

```
just testsite                 # Lindewaard op 4710, Berkenveen op 4711, Kijkpunt op 4712
just testsite --log pad.log   # eigen logbestand
just testsite --disruptions   # met storingen, zie "Storingen en blokkades"
```

Daarna vanuit `toolbox/`:

```
node src/cli.ts audit inventory http://127.0.0.1:4710/ --out runs/<naam>
node src/cli.ts dev compare --run runs/<naam> --reference fixtures/reference-lindewaard.json --out <map>
node src/cli.ts dev compare --findings tasks --run runs/<naam> --reference fixtures/reference-lindewaard.json
```

Voor Berkenveen is `reference-berkenveen.json` de referentie: geen enkel criterium hoort daar te worden afgekeurd, dus alles onder "alleen wij" is een valse melding of een gebrek dat er per ongeluk in zit.

De server schrijft elk verzoek dat geen GET of HEAD is en elk bericht over de WebSocket van de chat naar het logbestand (standaard `runs/fixture-server.log`), één JSON-object per regel. Het log wordt nooit geleegd. Tel de regels met `kind` gelijk aan `request` of `ws-message` voor en na een run: het verschil hoort nul te zijn. Een inlog met het testaccount staat er als `login`, zonder de verzonden gegevens, en elk bezoek dat een sessie beëindigt als `logout`. Een `login` telt niet als verzonden. Tel die regels daarom apart: na `just testsite-login` hoort er tijdens de run geen bij te komen. Een verzoek dat alleen leest (zie [Lezen bij een andere partij](#lezen-bij-een-andere-partij)) staat er met `kind` gelijk aan `read` en telt niet mee.

## Regressietoets van de veegronde

```
just sweep-check                       # beide varianten, een tabel in een tijdelijke map
just sweep-check --out pad --at-once 3 # eigen map, drie pagina's tegelijk per variant
just sweep-check --runs pad/runs       # bestaande runs opnieuw lezen, zonder te meten
just sweep-check --out pad --fixed-ports # op de poorten van just testsite, voor een bevroren veegronde
just sweep-check --out pad --fixed-ports --allow-writes --max-writes 80 # bevroren veegronde voor een meting die mag versturen
```

De runs blijven staan in `<out>/runs/defect` en `<out>/runs/clean`; een volgende keer met dezelfde `--out` maakt die map eerst leeg. Zonder `--fixed-ports` draait de testsite op willekeurige vrije poorten, zodat de toets nergens mee botst, maar zijn de adressen in de runs daarna niet meer te openen. Met `--fixed-ports` gebruikt hij 4710, 4711 en 4712, net als `just testsite`, zodat een meting de runs als bevroren veegronde kan gebruiken (zie [validatie/verbruik/README.md](../../validatie/verbruik/README.md)). Draait `just testsite` al, dan stopt de toets met die melding. De toets start de server met een sessie van zes uur, zodat de inlog ook bij één pagina tegelijk een hele variant meegaat.

Mag de meting op die runs versturen, maak de bevroren veegronde dan met `just sweep-check --out pad --fixed-ports --allow-writes --max-writes 80`. Elke inventaris krijgt dan dezelfde toestemming als `inventory <site> --allow-writes --test-environment http://localhost:4712 --max-writes 80`: de site van de variant en Kijkpunt, elk met de lokale regels en een eigen budget van 80. Die staat in `manifest.json` van beide runs, en de proef met formulieren in de veegronde verstuurt echt, zoals in een meting. De toets telt dan alleen wat de server ontving en niet in `writes.jsonl` van een run staat. Zonder `--allow-writes` blijft alles zoals het was: de CI mag niet versturen en elke verzending laat de toets falen.

Zonder taalmodel en zonder verkenner. De toets logt elke variant eerst in met het testaccount (zie [Het deel achter een inlog](#het-deel-achter-een-inlog)) en meet de twee daarom na elkaar. Op beide varianten draaien `inventory` (de pagina's waarop een gebrek staat, als vaste lijst), het vaste sitemodel uit `sweep/` (met `check-site`), `sample`, `collect`, `contrast`, `states` en `documents`. Daarna zoekt de toets per gebrek het bewijs op de plek in het dossier die `evidence.ts` noemt. Een gebrek dat alleen een agent kan zien (kijken, luisteren of een oordeel over tekst) staat daar met de reden en telt niet mee. Op Berkenveen draait dezelfde toets op dezelfde plek: daar hoort niets te staan.

De uitkomst is een tabel per gebrek (gevonden, ontbreekt, niet door een script te zien) in `sweep-check.md` en `sweep-check.json`. De toets faalt als de veegronde iets verstuurde, uitlogde of meer dan één keer per variant inlogde, als een gebrek dat in de basislijn (`sweep/baseline.json`) werd gevonden nu ontbreekt, of als er op Berkenveen bewijs bijkomt. Wordt iets beter, dan zegt de tabel dat; werk dan de basislijn bij. Doe dat met de uitkomst van de CI, niet van een eigen machine, want lettertypen en hulpprogramma's verschillen: haal de artefacten `veegronde-Lindewaard` en `veegronde-Berkenveen` op en draai `just sweep-check --from-report <lindewaard>/sweep-check.json --from-report <berkenveen>/sweep-check.json --update-baseline`.

| Pad | Inhoud |
|---|---|
| `evidence.ts` | Per gebrek waar het bewijs in het dossier staat, of waarom alleen een agent het ziet |
| `sweep/site.json` | Het vaste sitemodel voor beide varianten. `{origin}` en `{thirdParty}` worden bij het draaien ingevuld; een onderdeel met `variants` geldt alleen voor die variant |
| `sweep/recipes/` | De recepten van het sitemodel. Een stap noemt zijn element per variant als de twee sites daar anders zijn gebouwd |
| `sweep/baseline.json` | Wat de toets vond toen de basislijn werd vastgelegd |
| `sweep/disruptions.json` | De paginatypen die het sitemodel erbij krijgt met `--disruptions` |

Op GitHub draait de toets bij elk voorstel dat `toolbox/src/`, `toolbox/package-lock.json`, de testsite of de toets zelf raakt, Lindewaard en Berkenveen in twee jobs naast elkaar, met de tabel als artefact.

## Lezen bij een andere partij

Drie stukken inhoud verschijnen pas na een verzoek, elk met een sleutelgebrek op Lindewaard en het goede geval op Berkenveen:

| Pagina | Verzoek | Gaat door | Gebrek |
|---|---|---|---|
| `/openingstijden.html` | GET van een blok bij Kijkpunt (`/blok/regio-1.html` of `-2`) | altijd, ook in de veegronde | `1.1.1-regioblok` |
| `/veelgestelde-vragen.html` | POST naar Kijkpunt `/vragenlijst/start`, na een preflight | alleen met de vaste leesregel voor de testserver | `4.1.2-vragenlijst` |
| `/afval.html` | POST in JSON (de vorm van Typesense) naar `/zoekdienst/multi_search` op de site | alleen met een leesverzoek in het sitemodel | `1.1.1-afvalwijzer`, `1.4.1-afvalbak-kleur` |

De vragenlijst meldt daarnaast elk bezoek met een POST naar Kijkpunt `/vragenlijst/bezoek`. Dat verzoek legt iets vast en moet tegengehouden blijven: de server logt het als `request`, dus een run die het doorlaat, faalt op de telling hierboven. Een browser zonder loep verstuurt het wel; de test van de selectors houdt het daarom zelf tegen.

De vaste leesregel voor de testserver staat in `fixed-reads.json`, niet in de regels van loep zelf (`toolbox/data/fixed-reads.json`). Loep leest zo'n extra bestand uit `fixed-reads-extra.json` in de run, of uit het pad in de omgevingsvariabele `LOEP_EXTRA_FIXED_READS`, en weigert daarin een regel voor een adres dat niet op deze machine is (127.0.0.1, localhost of [::1]). `just sweep-check` schrijft een kopie met de poort waarop Kijkpunt dan draait in elke run. Een meting op die runs, en op kopieën ervan, gebruikt de regel dus vanzelf, ook in de sessies van de agents. Het rapport noemt een extra regel die iets doorliet apart van de vaste regels van loep.

Maak je een run op de testsite op een andere manier, zet dan de variabele voor elk proces, of leg het bestand zelf in de run:

```
cp toolbox/fixtures/fixed-reads.json <run>/fixed-reads-extra.json
```

Het bestand noemt Kijkpunt op poort 4712, zoals bij `just testsite` en `just sweep-check --fixed-ports`. Het leesverzoek voor de afvalwijzer staat niet in het vaste model van de toets: check-site wil daarvoor een waarneming uit een sessie, waarin loep de zoekvraag tegenhield. In een meting legt de verkenner het vast; in de toets telt het gebrek als iets wat alleen een agent ziet.

## Het deel achter een inlog

Beide sites hebben vier pagina's onder `/mijn/` die alleen bestaan voor wie is ingelogd. Zonder sessie stuurt de server door naar `/inloggen.html`. Geen sitemap noemt ze. Inloggen gaat met het formulier op die pagina; de gegevens van het ene account staan in `account.ts` en horen alleen bij deze testsite. Een sessie is een cookie en verloopt een half uur na het inloggen, of na het aantal seconden van `--session-seconds`.

Uitloggen kan op twee plekken: de link "Uitloggen" naar `/uitloggen` op elke pagina, en de link "Afmelden" naar `/mijn/sessie-sluiten` op de pagina met gegevens. Aan het tweede adres is niet te zien dat het uitlogt. Een run met inlog mag geen van beide volgen. De server telt hoe vaak het toch gebeurde en zet elke keer een regel `logout` in het log; de drempel is nul.

Drie gebreken uit de sleutel staan alleen achter de inlog: een decoratief pictogram zonder alt op het overzicht (1.1.1), een aanvraag die zonder bevestiging wordt ingetrokken (3.3.4) en een veld voor het huidige wachtwoord waarin plakken niet werkt (3.3.8). Berkenveen heeft op die plekken het goede geval.

In tests, in de regressietoets en bij een meting op de testsite logt de code zelf in met dat account, via `login.ts`, en alleen op 127.0.0.1. Op elke andere site logt een mens in, nooit de code. Het wachtwoord staat alleen in `account.ts`: de browser typt het, het sessiebestand bewaart alleen het cookie en het log van de server laat de verzonden gegevens van een inlog weg.

Voor een meting met agents op een bevroren veegronde (zie [validatie/verbruik/README.md](../../validatie/verbruik/README.md)):

```
just testsite --session-seconds 21600 --log pad/server.log  # een sessie houdt een werkstroom lang
just testsite-login pad/kopie                                # per kopie, voordat de agents beginnen
just testsite-logouts pad/server.log                         # na de run: faalt als iemand is uitgelogd
```

De sessie uit de veegronde hoort bij de server van de toets en geldt daarna niet meer, dus elke kopie krijgt een nieuwe inlog.

## De moeilijke mailroute

Berkenveen heeft een aanmelding per mail die op geen enkele pagina staat: de veegronde en de sitemap zien haar niet, een test opent het formulier zelf (`/p/a3f9`). Ze heeft alles wat de eerste site waarop de route is gemeten niet had:

- een verborgen veld dat per paginalading verandert en maar één keer werkt, dus elke verzending is anders en zo'n formulier gaat altijd echt;
- links in de mail die via een mailingdienst op een ander domein lopen (Kijkpunt speelt die dienst, op `/k/<klik>`, met een doorverwijzing naar de site);
- paden die niets zeggen (`/p/x7k2`), ook voor afmelden, en geen `List-Unsubscribe`. De afmeldlink meldt af door geopend te worden, zoals een echte.

In de test staat de mail in `fixture.mailRoute.outbox`, en `fixture.mailRoute.mailbox()` is de nepmailbox: Mailpit is er in de CI niet. Met `options.viaService = false` staan de links rechtstreeks in de mail, en met `options.linkText = false` zegt de tekst van de links niets meer. De tests staan in `test/mailroute.test.ts`.

## Storingen en blokkades

Met `--disruptions` (voor `just testsite` en `just sweep-check`) doen een paar vaste pagina's wat een echte site soms doet. Zonder die vlag is alles zoals hiervoor. Elk geval staat in `disruptions.ts`, met de uitkomst die een meting moet halen; dat is de drempel.

| Geval | Pagina | Wat de server doet | Drempel |
|---|---|---|---|
| Stylesheet één keer weg | `/nieuws/zomerfeest.html` | De eerste keer na het inschakelen krijgt `stijl.css` voor deze pagina 502, daarna komt hij | De veegronde laadt de pagina opnieuw en meet haar met de stylesheet. Geen gat, geen beperking |
| Stylesheet altijd weg | `/nieuws/werkzaamheden-dorpsstraat.html` | `stijl.css` krijgt voor deze pagina altijd 503 | Na de tweede collect `notLoadedAgain` en een beperking van de poort. Geen criterium afgekeurd of goedgekeurd op wat zonder stylesheet te zien is |
| Te veel verzoeken | `/sitemap.html` | Eén keer 429 met `Retry-After: 2`, daarna gewoon | Eén vermelding 429 met een einde in `blockades.json`. De veegronde wacht en meet de pagina. Geen criterium open |
| Niet beschikbaar | `/afspraak-maken.html` | Altijd 503 met een korte foutpagina. Geen pagina linkt ernaar | De veegronde stopt niet en `blockades.json` blijft leeg. De poort geeft voor deze pagina alleen het gat `pages-loaded`, voor de verkenner. Een agent beoordeelt de foutpagina niet als de pagina om een afspraak te maken |
| Controle tegen robots | `/controle.html` op Kijkpunt | Kijkpunt antwoordt als een site achter Cloudflare (`cf-ray`). Zonder cookie eerst een controlepagina (403, `cf-mitigated: challenge`) die een POST doet naar `/cdn-cgi/challenge-platform/` en dan opnieuw laadt | De POST gaat door en telt niet als iets wat naar de site is verstuurd (het log heeft er `kind` `challenge` voor). Het venster toont daarna het vinkje |

De gevallen die één keer gebeuren, gebeuren één keer per variant nadat ze zijn ingeschakeld. Alleen `just sweep-check --disruptions` schakelt ze in, per variant vlak voor collect, zodat inventory en check-site ze niet opmaken. `just testsite --disruptions` geeft alleen de gevallen die altijd gebeuren: zou de server ze bij het starten inschakelen, dan kreeg wie de pagina als eerste vraagt de storing, de inventaris van een run of een willekeurige sessie van een agent op een bevroren veegronde. `just sweep-check --disruptions` voegt verder de vier pagina's van de site toe aan de vaste lijst en hun paginatypen (`sweep/disruptions.json`) aan het sitemodel. Hij meet dan zoals de commandoregel: met de scope en de blokkade van de run, de varianten na elkaar, en collect twee keer. Daarna toetst hij per geval de drempel uit `disruptions.ts` en faalt als een geval anders uitkomt. `just sweep-check --only-disruptions` doet hetzelfde op minder pagina's: die van de gevallen, de startpagina met het venster van Kijkpunt en de pagina met de vragenlijst. Hij toetst de gevallen en de sleutel op die pagina's; zo draait de merge queue de jobs met storingen, en 's nachts draait de volledige. De test van de server staat in `test/disruptions.test.ts`.

Voor een meting met agents: maak de bevroren veegronde met `just sweep-check --out pad --fixed-ports --disruptions` en draai de agents tegen `just testsite --disruptions`.

## Wat waar staat

| Pad | Inhoud | Geserveerd |
|---|---|---|
| `src/` | De bronnen. Elke plek met een gebrek staat er in twee versies tussen `@bad <id>`, `@good` en `@end` | nee |
| `build.ts` | Maakt uit de bronnen de twee sites, `key.json` en de referentiebestanden | nee |
| `defects.ts` | De antwoordsleutel: gebreken, verwachte uitkomst per criterium, valkuilen | nee |
| `key.json` | Dezelfde sleutel als JSON | nee |
| `account.ts` | Het account van het deel achter de inlog, en de adressen die erbij horen | nee |
| `login.ts` | Inloggen met dat account voor een run, en het aantal keer uitloggen uit het log van de server | nee |
| `reference-*.json` | De sleutel in de vorm die `compare` leest, zie `validatie/README.md` | nee |
| `sites/` | De gegenereerde sites. Staan in git; de server bouwt niets | ja |
| `serve.ts` | De server, alleen Node zelf. Houdt de sessies van het deel achter de inlog bij | nee |
| `mailroute.ts` | De moeilijke mailroute: formulier, mail, mailingdienst en afmelden | nee |
| `documents.ts` | Welk document elke site op welk adres serveert, en welk document de server groter maakt | nee |
| `src/documenten/` | De documenten, per site een bestand (`.a` voor Lindewaard, `.b` voor Berkenveen), met in `bron/` de bronnen en `make.sh` | ja, via `sites/` |
| `disruptions.ts` | Storingen en blokkades met `--disruptions`, en de drempel per geval | nee |
| `readroute.ts` | De verzoeken die alleen lezen: de start van de vragenlijst, de preflight ervoor en de zoekvraag van de afvalwijzer | nee |
| `fixed-reads.json` | De vaste leesregel voor de testserver, voor `LOEP_EXTRA_FIXED_READS` | nee |

In wat wordt geserveerd staat niets dat het antwoord verraadt: geen aanwijzing in adressen, klassenamen, commentaar of tekst. Een test bewaakt dat.

## Een gebrek toevoegen of wijzigen

1. Zet in `src/` beide versies tussen de markeringen, met een id dat begint met het criterium.
2. Voeg het gebrek toe aan `defects.ts`, met een selector die op de pagina in Lindewaard iets vindt.
3. `just testsite-build` en daarna `just test`. De bouw weigert als een id in de bronnen niet in de sleutel staat of andersom. De test controleert elke selector in beide sites.

## Media

`src/media/` bevat een korte video (dia met agenda en uitslag, met gesproken tekst) in twee versies, een gesproken fragment en een melodie. Ze zijn eenmalig gemaakt met de spraaksynthese van het besturingssysteem en ffmpeg en staan als bestand in git. In Berkenveen leest de spreker voor wat op de dia staat; in Lindewaard niet.

## Documenten

Beide sites linken naar dezelfde documenten op dezelfde adressen. In Lindewaard zit het gebrek in het bestand, in Berkenveen is hetzelfde bestand goed gemaakt. De sleutel noemt bij zo'n gebrek het adres van het document, met `medium: document` in de referentie; de selector is de link op de pagina.

| Document | Pagina | Lindewaard | Berkenveen |
|---|---|---|---|
| Agenda (pdf) | `/raadsvergadering.html` | geen tags | tags |
| Besluitenlijst (pdf) | `/raadsvergadering.html` | tags, geen titel | tags en titel |
| Begroting (pdf, 262 MB) | `/raadsvergadering.html` | geen tags | tags |
| Aanvraagformulier (docx) | `/vergunning.html` | vette alinea's als tussenkop | kopstijlen |
| Plattegrond (png achter een link met tekst) | `/contact.html` | namen van ruimtes alleen in beeld | geen tekst in beeld, de ruimtes als lijst op de pagina |
| Afvalwijzer (pdf op Kijkpunt) | `/afval.html` | geen tags | tags |

De begroting staat klein in de repository. De server zegt bij HEAD dat ze 262 MB is en levert bij GET een geldige pdf van die grootte: het origineel met een ongebruikt object van nullen erachter. Dat is boven de 250 MB die `documents` ophaalt, dus de toolbox leest haar nooit in; een rapport hoort dat te zeggen. De afvalwijzer staat bij de afvaldienst op Kijkpunt, een ander domein: de toolbox telt hem en haalt hem niet op, en `compare --findings` deelt het gebrek erin vast in als buiten bereik.

De bestanden zijn eenmalig gemaakt met typst, qpdf en pandoc (`sh fixtures/src/documenten/bron/make.sh` vanuit `toolbox/`) en staan in git; `build.ts` kopieert ze alleen. Een nieuwere typst of pandoc schrijft andere bytes, dus draai `make.sh` alleen als een bron verandert.

## Grenzen

- "Voldoet" voor Berkenveen is de bedoeling, geen bewezen feit. Een bevinding daar kan terecht zijn.
- De sleutel noemt alleen wat met opzet fout is gemaakt. Lindewaard kan meer gebreken hebben.
- De testsite heeft vijf documenten op de site en één op Kijkpunt (zie Documenten): pdf, docx en png. Geen odt, pptx, xlsx, platte tekst, gescande pdf of document achter de inlog; die zijn alleen getest in `toolbox/test/documents.test.ts`, op bestanden in `toolbox/test/fixtures/documents/` en op inhoud die de test zelf opbouwt.
- Twee gebreken in documenten kan de toolbox per definitie niet vinden: het gebrek in de begroting (boven de grens) en dat in de afvalwijzer (ander domein). Ze tellen in de sleutel mee; in de veegronde staan ze als "niet door een script te zien".
- Drie criteria zijn in beide sites niet van toepassing (1.2.4, 2.3.1, 2.5.4) en twee zijn in beide goed (2.4.5, 4.1.1). Die meten valse meldingen.
