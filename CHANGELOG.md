# Wijzigingen

Wat er per versie van loep is veranderd. De versie staat op het voorblad en onderaan elke pagina van een rapport. Wat een nieuwe versie betekent, staat in [CONTRIBUTING.md](CONTRIBUTING.md#versies).

## Nog niet uitgebracht

### Wat een uitkomst kan veranderen

- Een pagina die onder meer dan één adres op de site staat, kon loep meten op een adres dat doorverwijst. Voorbeeld: `/vragen` verwijst door naar `/verklaring#vragen`, een plek halverwege de toegankelijkheidsverklaring. loep koos het eerste adres in het alfabet, hier `/vragen`. Dan begon elke meting halverwege de pagina, ook de proef met de Tab-toets, en noemde het rapport de Tab-volgorde als beperking. Nu meet loep op `/verklaring`. Daarvoor slaat loep op waar de browser uitkomt (`finalUrl` in `inventory.json`).
- Ook een vaste pagina, zoals de contactpagina, en de voorbeeldpagina die de verkenner voor een paginatype koos, worden nu herkend als ze onder een ander adres staan.
- Een bestaande steekproef blijft gelijk. Draai je opnieuw `inventory` en `sample`, dan kan een pagina een ander nummer (id) of label krijgen, en kan de willekeurige keuze van pagina's anders uitvallen. Draai je alleen `sample` opnieuw, dan kan de uitleg bij een paginatype of een vaste pagina veranderen.
- De verkenner kon als voorbeeldpagina van een paginatype een adres kiezen dat doorverwijst. Voorbeeld: `/vragen`, dat doorverwijst naar `/verklaring#vragen`. loep meet die pagina op `/verklaring`, maar opende de onderdelen van dat paginatype op `/vragen`, en de meting begon dan halverwege de pagina. Nu keurt `check-site` zo'n sitemodel af en noemt het adres dat als voorbeeldpagina (`representative` in `site.json`) hoort, hier `/verklaring`. Het voorstel aan de verkenner geeft nu ook dat adres. Een bestaande run die door `check-site` kwam, blijft geldig. Keurt `check-site` het model bij een nieuwe ronde af, zet dan het genoemde adres als voorbeeldpagina en draai `check-site` en `sample` opnieuw (#113).

### Verder

- De stappen die `just voiceover-setup` toont om System Integrity Protection (SIP) uit te zetten in de virtuele Mac, waarschuwen nu voor een valkuil. In de herstelmodus kom je in een venster met vier keuzes; klik je daar op Ga door (Continue), dan begint een herinstallatie van macOS. De stappen zeggen nu dat je daar niets aanklikt, hoe je zo'n installatie stopt (⌘Q) en hoe het menu heet in een Nederlandse virtuele Mac (Hulpprogramma's > Terminal), zoals `docs/voiceover.md` al zei. Je hoeft niets opnieuw te doen.

## 0.10.0 (2026-10-17)

Ook deze versie is uitgebracht zonder nieuwe meting op de testsite. De wijziging is getest met eigen tests, niet in een volledige run.

### Wat een uitkomst kan veranderen

- Een schermafbeelding van een pagina die hoger is dan de grens van 16.384 pixels, wordt niet meer als hele pagina gerenderd en dan bijgesneden. Het venster wordt tijdelijk zo hoog als de grens gezet, de afbeelding wordt van het venster genomen, en daarna krijgt het venster zijn oude maat en scrollpositie terug. Hetzelfde geldt voor de afbeelding van één element op zo'n pagina (`crop`, `ocr`, contrast met `--at` en tekst in een afbeelding): het venster scrolt naar het element. Eerder liep `collect` op een pagina van ruim 170.000 pixels hoog nog steeds vast op een time-out, ook met de grens uit 0.9.0 (#94).

## 0.9.0 (2026-10-17)

Ook deze versie is uitgebracht zonder nieuwe meting op de testsite. De wijzigingen zijn getest met eigen tests, niet in een volledige run.

### Wat een uitkomst kan veranderen

- Een nieuwe soort open punt: `niet bereikbaar`. Een agent gebruikt hem als een deel van de site, een pagina of een ingesloten venster, bij herhaalde pogingen niet laadt terwijl de rest van de site wel laadt. Het punt noemt wat er niet laadde (een adres of het label van de pagina) en wanneer (de tijd van de eerste en de laatste poging); de controle weigert een punt zonder die twee. Het criterium telt als door dit onderzoek niet vastgesteld en krijgt een afmaakronde. Die mag het punt laten staan na een beschreven poging met twee eigen waarnemingen, net als `proef werkte niet`. Het rapport zet de punten volledig en apart onder "Nog uitzoeken" en telt de criteria bovenaan apart. `feedback` maakt er geen tekst voor een issue van, want het is geen fout in loep, maar noemt de criteria apart; `gaps` telt de soort apart. De opdrachten van beoordelaar, verifieerder en afmaakronde zeggen wanneer de soort past. Eerder werd zo'n deel `proef werkte niet`, en kon het na de afmaakronde alleen nog door een persoon worden gesloten (#87).
- `tasks --again <criteria>` zet voor die criteria een nieuwe afmaakronde klaar, ook als de run op `done` staat, maar alleen voor een criterium waarvan het eindoordeel open staat met `niet bereikbaar` of `proef werkte niet`; voor een ander criterium weigert het. Het vorige oordeel blijft in de run (`verdicts/<criterium>/afmaak-1.json`, met stempel en opdracht), elke poging krijgt een eigen sessie, `pending` toont de opdrachten onder `finishers`, en `evaluate` neemt het nieuwe oordeel en toont het vorige als wat hiervoor stond (#87).
- Een document waarvan het adres doorverwijst naar een ander domein, zoals een `/.well-known/security.txt` die centraal wordt beheerd, telt als document op een ander domein: `inventory` telt het onder de documenten op andere origins (alleen geteld) en `sample` neemt het niet op in de steekproef. Eerder kwam zo'n document in de steekproef, kon `documents` het niet ophalen omdat het buiten de scope van de run lag, en schreven beoordelaars en verifieerders er een open punt `proef werkte niet` over. Een doorverwijzing naar een origin die met `--also-origin` is opgegeven, blijft een document van de site. Een oude run blijft leesbaar: `sample` op een oude `inventory.json` laat zo'n document ook weg en telt het bij de documenten op een ander domein. Een steekproef die al gemaakt is, verandert niet; maak hem opnieuw met `sample` (#88).
- Een schermafbeelding van de hele pagina in de veegronde (`collect`, `contrast`, de toestanden uit het sitemodel, de proeven op andere breedtes) is hooguit 16.384 pixels hoog. Een hogere pagina staat er van boven tot die grens op. De feiten van de pagina noemen dan de hoogte van de pagina en de grens (`screenshotClippedAt`), de opdrachten van agents tonen dat bij de schermafbeeldingen, en de poort meldt het als beperking die in het rapport komt. Bij contrast krijgen tekst, bedieningselementen en afbeeldingen onder de grens "kan niet bepalen" met die reden, in plaats van stil als gemeten te tellen. Eerder liep de schermafbeelding van een zeer lange pagina vast op een time-out of crashte de browser (#91).
- Een pagina waarop `collect` ook bij de tweede poging faalt, laat `collect` niet meer stoppen. De fout staat in de feiten van de pagina (`collectError`), de andere pagina's worden gemeten, en de poort meldt de pagina als gat onder `pages-loaded`, zoals een pagina die niet laadt. Een nieuwe start van `collect` meet de pagina opnieuw. Een verlopen inlog of een browser die wegvalt, stopt `collect` nog wel (#91).

## 0.8.0 (2026-10-16)

Ook deze versie is uitgebracht zonder nieuwe meting op de testsite. Een onderzoek over meer origins is getest met eigen tests, niet in een volledige run.

### Wat een uitkomst kan veranderen

- Een site die over meer dan één origin verdeeld is, zoals een landingspagina op `https://example.nl` en de documentatie op `https://docs.example.nl`, kan één onderzoek met één rapport zijn: `inventory <url> --also-origin <url>` (herhaalbaar). Per origin leest `inventory` de sitemap, begint bij de startpagina, vraagt de pagina voor een adres dat niet bestaat en telt en bevraagt de documenten; links tussen de origins tellen als eigen links. `inventory.json` noemt de origins onder `origins` en de foutpagina's onder `notFoundProbes`. De grens van `--max-pages` gaat eerst over de origins, en de melding bij de grens noemt per gedeelte de origin en het eerste deel van het pad. De steekproef kiest de startpagina en de andere vaste pagina's per origin. Het rapport noemt alle origins in de scope en bij de gegevens van het onderzoek, de verklaring noemt de andere origins als domeinen van de website, documenten op elke opgegeven origin worden onderzocht, en de controle van een oordeel keurt een advies met een adres op een van de origins niet meer af. Een origin die niet is opgegeven, zoals een ander subdomein, blijft erbuiten. Een run op één origin, ook een oude zonder `origins`, verandert niet, op één ding na: op een site met een poort in het adres, zoals de testsite, keurt de controle een advies met een adres van de site zelf niet meer af; de poort hoort nu bij de host die wordt vergeleken (#84).

## 0.7.0 (2026-10-16)

Ook deze versie is uitgebracht zonder nieuwe meting op de testsite. De tweede poging na een time-out is getest met een eigen test, niet in een volledige run.

### Wat een uitkomst kan veranderen

- Stopt een stap van een recept op een time-out wanneer de veegronde een onderdeel opent (`collect` en `states`, op de eigen pagina en op elk paginatype), dan laadt loep de pagina opnieuw en speelt het recept nog één keer. Pas als ook die tweede poging mislukt, ging het onderdeel niet open en meldt de poort een gat. Een andere fout dan een time-out wordt niet opnieuw geprobeerd. Eerder werd een eenmalige time-out, zoals een klik die met zes browsers tegelijk vastliep, meteen een gat waarvoor een hele vervolgronde van de verkenner nodig was. Na een tweede poging staat onder `firstTimeoutNl` bij de toestand of bij het paginatype waarom de eerste stopte (#80).

### Verder

- Elke opdracht voor een agent (verkenner, poort, rondgang, beoordelaar, verifieerder, afmaakronde en samenvoegen) zegt waar hulpbestanden en hulpscripts horen: in de eigen werkmap, en mag de agent daar niet schrijven, in een eigen map met de naam van zijn sessie, zoals `<scratchpad>/<sessie>/`. Een bestand met een algemene naam (`loep.sh`, `final.json`) in een gedeelde map mag niet. Agents met een sessie geven in elk commando hun eigen sessienaam mee. In een sessie die aan een worktree vastzat, schreven agents hun wrapper met een algemene naam in de gedeelde scratchpad, overschreven ze elkaars wrapper, en mat een verifieerder in de loep-sessie van een ander. De regel staat één keer in `templates/werkmap.md` en komt in elke opdracht. De skill zegt erbij dat wie het onderzoek leidt, de agents van een werkstroom geen bericht stuurt: in Claude Code start zo'n bericht een tweede exemplaar van de agent, dat in dezelfde loep-sessie gaat meten (#79).

## 0.6.0 (2026-10-16)

Deze versie is uitgebracht zonder nieuwe meting op de testsite, net als 0.5.0. De wijzigingen die een uitkomst kunnen veranderen, zijn dus nog niet vergeleken met 0.5.0. Met een echte Vimeo-speler is nagegaan dat de speler in een sessie tot de bediening laadt en dat zijn videostroom wordt opgehaald; dat de video in de browser van loep ook afspeelt, is niet vastgesteld.

### Wat een uitkomst kan veranderen

- De controle van Cloudflare of de browser een robot is, gaat door, in de veegronde en in elke sessie. Cloudflare beantwoordt die verzoeken zelf en de site krijgt ze niet. Het gaat om alles op `challenges.cloudflare.com` en om een pad onder `/cdn-cgi/challenge-platform/` op een host die al via Cloudflare antwoordde (met de kop `cf-ray`); op een andere host blijft hetzelfde pad tegengehouden. Eerder hield loep de controle tegen als schrijfverzoek, vroeg Cloudflare daarna om een zwaardere controle, en bleven ingesloten Vimeo-spelers op een laadteken staan: vier criteria bleven daardoor open door loep zelf. Een sessie legt de doorgelaten verzoeken vast onder `challenges` in de waarneming (#69).
- Een ingesloten venster dat los wordt geopend (in de veegronde als het in de pagina niet te meten was, of met `open` in een sessie) krijgt de pagina waarin het staat mee als herkomst. Een speler die alleen op de eigen site mag spelen, toonde los geopend een foutscherm over privacy-instellingen (#69).
- Een ingesloten venster dat bij de run hoort, zoals een videospeler, mag in een sessie met GET gegevens ophalen bij een host buiten de run (`fetch` en XHR), tenzij de scope streng is. Een Vimeo-speler haalde zijn videostroom bij `vimeocdn.com`, en dat werd tegengehouden. De pagina zelf mag dat nog steeds niet. Wat zo is opgehaald, telt de sessie per host onder `outsideScopeLoaded` (#77).
- Wat een pagina of venster bij het laden zelf vraagt en loep tegenhoudt, is geen `versturen niet toegestaan` maar `proef werkte niet`: niemand verstuurde iets, en een testomgeving van de site lost het niet op. De opdrachten van beoordelaar, verifieerder en afmaakronde en de beperking in het dossier zeggen dat (#69).

### Verder

- Het rapport spreekt de lezer aan in woorden die de lezer kent. Op het voorblad staat bij open criteria door het onderzoek zelf "Het onderzoek is onvolledig", met wat dat betekent voor de status en wat het sluit. Eerder stond er dat "de afmaakronde het alsnog meet", een aanwijzing voor wie het onderzoek leidt. Per criterium heten de rondes "eerste beoordeling", "controle" en "aanvullende meting" in plaats van beoordelaar, verificatie en afmaakronde, en de proef van de sessieduur heet "meting van de sessieduur". De werkwijze in de bijlage over de methode zegt welke ronde bij welke naam hoort; de herleidbaarheid houdt de namen van de rondes. Een open punt van de soort `budget op` heet in het rapport "de tijd voor het meten was op" (#74).

## 0.5.0 (2026-10-16)

Deze versie is uitgebracht zonder nieuwe meting op de testsite, net als 0.4.0. De wijzigingen die een uitkomst kunnen veranderen, zijn dus nog niet vergeleken met 0.4.0; alleen de grovere soorten van aanwijzen en indrukken zijn los op beide testsites nagegaan, zonder volledige veegronde (zie `validatie/testsite/2026-10-16-soorten/`). Op de testsite van de repository slagen alle tests. In de eerste volledige ronde faalden er twee: de vergelijking van een veegronde met één en met vier tegelijk, omdat de grens van indrukken in die test na de grovere soorten niet meer opraakte (de test is aangepast), en een test van schrijfverzoeken in WebKit, die los en in de tweede ronde wel slaagde.

### Wat een uitkomst kan veranderen

- Met een sitemodel krijgt een groot paginatype extra pagina's in de steekproef: één per 40 pagina's van dat type, hooguit 5, naast de voorbeeldpagina van de verkenner. Ze worden vast gekozen op variatie in inhoud: steeds de pagina die de meeste soorten inhoud toevoegt die het type in de steekproef nog niet had (afbeeldingen, tabellen, formulieren, video, geluid, ingesloten vensters, koppen, lijsten, lengte), en bij gelijke stand op de seed. Het willekeurige deel blijft 10% van het gerichte deel en groeit dus mee. `sample.json` zegt per pagina de reden ("gekozen op variatie: tabel, video") en per paginatype hoeveel pagina's er zijn en hoeveel er zijn bekeken; het rapport toont dat in een tabel. Een site van 562 pagina's in 11 typen krijgt zo 11 pagina's meer: 10 op variatie en een willekeurige. Een kleine site, een site zonder sitemodel en een vaste lijst blijven zoals ze waren. De keuze van de getallen staat in de methode, met WCAG-EM 2.0 §6.3 en §6.3.1 (#62).
- `inventory` telt per pagina ook afbeeldingen (`images`), koppen (`headings`) en het aantal woorden in het hoofddeel (`words`). De eerste twee staan ook in de totalen van de site.
- `states` opent voor toetsen, aanwijzen, indrukken en pijltoetsen elke pagina in een eigen browsercontext, ook met één tegelijk. Eerder deelden de pagina's van een groep één context, en zag een latere pagina wat een eerdere in de opslag van de browser had achtergelaten. Bij aanwijzen en indrukken kiest een pagina eerst alle bedieningselementen die ze probeert en probeert ze daarna. Laadt een pagina halverwege niet meer, dan tellen de soorten die ze nog niet had geprobeerd toch als gebruikt; eerder kon een latere pagina met dezelfde soort ze nog proberen.
- `states` deelt de bedieningselementen voor aanwijzen, focus en indrukken grover in soorten: naar uiterlijk en gedrag, niet meer naar klassen en attributen. Twee elementen zijn één soort als ze dezelfde rol hebben, in hetzelfde paginagebied en onderdeel staan, binnen een marge even groot zijn, er in rust hetzelfde uitzien, dezelfde stijlregels hebben bij aanwijzen, focus en indrukken, en dezelfde code in hun listeners. Klassen, id's, data-attributen en namen die een bouwprogramma maakt, tellen niet mee. Voor indrukken was elke link en knop met een eigen tekst een eigen soort; nu telt de code die het indrukken hoort. Dat volgt WCAG-EM 2.0 (§4.1, noot): een onderdeel dat vaker voorkomt hoeft niet elke keer opnieuw te worden onderzocht, tenzij het er anders uitziet of zich anders gedraagt. Eerder raakte op een site met 19 pagina's in de steekproef de grens van 400 en 600 soorten vol, en was `states` het traagste deel van de veegronde. De uitzonderingen blijven: een knop met alleen een pictogram, een element met een title of beschrijving en een afkorting worden altijd zelf aangewezen. Op de testsite gaat het aantal soorten om aan te wijzen van 78 naar 75 (Lindewaard) en van 97 naar 90 (Berkenveen), en om in te drukken van 4 naar 2; elk ingebouwd gebrek dat deze proeven laten zien, wordt nog gevonden. De daling is klein omdat de testsite weinig klassen per element heeft; zie `validatie/testsite/2026-10-16-soorten/` (#63).

### Verder

- `docs/plugin.md` beschrijft de marketplace zoals die werkt: `marketplace.json` in de root van `NederlandseDigitaleDienst/ai-plugins` is de bron, en de bestanden voor Claude Code, Cursor en Codex maakt een generator daaruit. Een nieuwe tag zet je in de bron, daarna draai je de generator en gaat alles in één voorstel. Eerder stond er dat je de tag met de hand in twee blokken zette.
- `states --at-once <n>` laat binnen de groepen toetsen, aanwijzen, indrukken en pijltoetsen ook de pagina's tegelijk lopen, met samen nooit meer dan n browsers en met dezelfde tijd tussen twee navigaties (#60). De grenzen van aanwijzen (400 soorten) en indrukken (600) raken op in de volgorde van de pagina's: een pagina kiest pas als de pagina's vóór haar hebben gekozen. Wat er wordt weggeschreven, is hetzelfde als met één tegelijk; de test op de testsite toetst dat nu ook met lagere grenzen die halverwege opraken. Op tien pagina's van de testsite ging `states` met vier tegelijk van 192 naar 104 seconden (met één tegelijk 372), en met acht naar 92. `estimate` rekent daarmee: zie hieronder.
- `estimate` rekent de veegronde per pagina, uit de laadtijd en de links en bedieningselementen die `inventory` nu per pagina vastlegt, en na `collect` uit de metingen zelf: wat een pagina toevoegt aan de pagina's ervoor, of ze naar indrukken luistert en hoeveel tochten met de pijltoetsen erop staan. Aanwijzen en indrukken stoppen in de schatting bij de grenzen van `states` (400 en 600). De schatting volgt de opbouw van `--at-once`: `collect` verdeelt zijn pagina's, `contrast` doet hooguit vier rondes tegelijk, en `states` begint zijn vijf groepen tegelijk en verdeelt binnen de groepen toetsen, aanwijzen en indrukken en pijltoetsen ook de pagina's over de n browsers. `states` duurt zo lang als zijn traagste groep, en niet korter dan al zijn werk gedeeld door n; formulieren en knoppen gaan pagina na pagina. Zonder `--at-once` neemt `estimate` het aantal van de laatste stap van de veegronde. `collect`, `contrast` en `states` schrijven tijdens het werk hun voortgang in `progress/<stap>.json`; `estimate` rekent een stap die loopt door met het tempo tot nu toe, en zegt het als een stap een kwartier niets schreef. Na afloop staat in het manifest hoe lang elke ronde of groep duurde (`laneSeconds`). Een trage site staat niet meer onder "niet gedekt": de laadtijd telt mee. Op een site elders met 19 pagina's en zes tegelijk schatte `estimate` `states` op 10 minuten en duurde het 30, met de pagina's binnen een groep nog na elkaar; met die opbouw rekent het nu 30. Op 223 pagina's één tegelijk zat de veegronde 22 procent te laag, nu 2 procent te hoog. Op de testsite schat het met vier tegelijk te hoog; zie [docs/methode.md](docs/methode.md#de-veegronde-naast-gemeten-runs) (#61).

## 0.4.0 (2026-10-16)

Deze versie is uitgebracht zonder nieuwe meting op de testsite, net als 0.3.0. De wijzigingen die een uitkomst kunnen veranderen, zijn dus nog niet vergeleken met 0.3.0. Op de testsite van de repository slagen alle tests op één na; de vergelijking van een veegronde met één en met vier pagina's tegelijk slaagde los wel en faalde één keer onder zware belasting van dezelfde machine.

### Wat een uitkomst kan veranderen

- De poort telt een ingesloten venster dat niet laadt (status 401, 403 of een andere fout) niet meer als gat bij `pages-loaded`, als het sitemodel het noemt als onderdeel zonder recept. Dat is dezelfde beperking als `frame-not-operated`, nu onder `frame-not-loaded`. Eerder bleef een run met een videospeler achter een controle tegen robots, zoals Vimeo met Cloudflare, steken op "bewijs onvoldoende": de verkenner kon het gat niet sluiten, want `acceptedGaps` neemt alleen pagina's van de run aan.
- De staande veegronde opent een onderdeel in een venster dat minstens zo breed is als de `minWidth` uit het sitemodel. Eerder ging een onderdeel dat pas vanaf 997 pixels bestaat, zoals een zijbalk, in het staande venster van 800 pixels nooit open. De poort meldde dan een gat dat de verkenner alleen met een omweg kon sluiten (#46).
- De steekproef van een grote site met een sitemodel heeft per paginatype één pagina, de pagina die de verkenner voor dat type koos, plus de vaste pagina's en een willekeurig tiende. Eerder kreeg elke pagina met een eigen opbouw (template-hash) er een plek in, ook als het sitemodel haar bij een bekend paginatype zette. Op een site waar die hash per pagina verschilt, kwamen zo 223 pagina's in de steekproef bij 11 paginatypen, en duurde de veegronde bijna tien uur. Ook kwam elke pagina met "privacy", "contact" of "toegankelijkheid" in het pad erin, tot tagpagina's en blogberichten aan toe; nu komt elke soort vaste pagina één keer, de pagina die het hoogst in de site staat. "Hulppagina" telt alleen het hele woord "help" (#48).
- `inventory` verdeelt de grens van `--max-pages` over de gedeelten van de site (het eerste deel van het pad, en daarbinnen een niveau dieper), in plaats van de pagina's in alfabetische volgorde te bezoeken. Eerder vulde een gedeelte dat vooraan in het alfabet staat de grens, zoals een blog vol tagpagina's, en bleef de rest van de site buiten de steekproef. Wordt de grens bereikt, dan zegt `inventory` luid per gedeelte hoeveel pagina's zijn bezocht en hoeveel weggelaten, en de skill laat die melding in stap 2 controleren (#51).
- Een zoekvraag die als POST naar een zoekdienst gaat (zoals `POST /multi_search` of `POST /1/indexes/<naam>/queries`), telt niet meer als versturen. Of een POST een zoekvraag is, beslist loep aan de vorm van de body, per verzoek, voor Typesense, Algolia, Elasticsearch en OpenSearch, Meilisearch en GraphQL met alleen query's. De verkenner legt zo'n verzoek vast in het sitemodel onder `readRequests`, met methode, origin, pad, dienst, een reden en de waarneming waarin het werd tegengehouden. `check-site` toetst de regel: alleen POST, hooguit één jokerteken en nooit aan het eind, geen woord in het pad dat op schrijven wijst, en een waarneming waarin loep de body als zoekvraag aan die dienst herkende. Na een geslaagde controle laat de bewaking een POST naar dat adres alleen door als de body een zoekvraag aan die dienst is; een andere body wordt tegengehouden en vastgelegd met de reden. Al het andere blijft tegengehouden, en een formulier versturen blijft verboden zonder verklaarde testomgeving. Een zoekfunctie met een body die loep niet herkent, blijft tegengehouden. Zoekresultaten zijn dan te onderzoeken, met de melding met het aantal (4.1.3), de focus na zoeken (2.4.3) en zoeken als tweede manier (2.4.5). Het manifest, het dossier en het rapport noemen welke adressen voor leesverzoeken zijn toegelaten (#49).
- `states` doet zijn proeven in vijf groepen (formulieren en knoppen, toetsen op de pagina's, toetsen in de toestanden, aanwijzen en indrukken, pijltoetsen), elk in een eigen browsercontext. Eerder deelden de groepen één context, en zag een latere groep wat een eerdere in de opslag van de browser had achtergelaten, zoals een instelling die de proef had gewijzigd.

### Verder

- `collect` hergebruikt een eerdere meting van een pagina weer als een bezoeker dezelfde pagina ziet. De hash van de inhoud telde de kop van het document, elke klassenaam, id en data-attribuut, toestanden van een carrousel, tokens in adressen en datums in de tekst mee, en werd genomen voordat een blok van een ander adres binnen was. Daardoor gold na een vervolgronde bijna elke pagina als veranderd. Nu telt alleen wat een bezoeker leest en bedient, gelezen als de pagina niet meer verandert. Per pagina die opnieuw wordt gemeten, zegt `collect` waarom: geen stempel, een andere versie van loep, andere blokkades, of andere inhoud met de eerste regel die verschilt (#47). Een run van een eerdere versie wordt de eerste keer nog helemaal opnieuw gemeten.
- De veegronde kan pagina's tegelijk meten: `collect`, `contrast` en `states` met `--at-once <n>`, ook via `just sweep RUN --at-once <n>` (#48). `collect` meet dan n pagina's en n toestanden uit het sitemodel tegelijk, `contrast` zijn vier rondes en `states` zijn vijf groepen proeven. Nooit meer dan het sessieproces van de run sessies toelaat, en met dezelfde tijd tussen twee navigaties naar de site als de sessies. Wat er wordt weggeschreven, in dezelfde volgorde en met dezelfde stempels, is hetzelfde als met één tegelijk. Op vier pagina's van de testsite ging `collect` van 209 naar 59 seconden, `contrast` van 30 naar 9 en `states` van 200 naar 118. Standaard blijft het één tegelijk; de skill gebruikt het alleen als de eigenaar meer agents toestaat. `estimate --at-once <n>` rekent de veegronde dan ook met n tegelijk.

## 0.3.0 (2026-10-15)

Deze versie is uitgebracht zonder nieuwe meting op de testsite, net als 0.2.0. De wijzigingen die een uitkomst kunnen veranderen, zijn dus nog niet vergeleken met 0.2.0.

### Wat een uitkomst kan veranderen

- 1.3.2 (Betekenisvolle volgorde): een datum, label of nummer vóór de titel van een kaart, in dezelfde volgorde op het scherm, is geen bevinding meer maar aanbeveling A1. De leesvolgorde klopt daar, en de norm vraagt niet meer; de regel was strenger dan de letter van het criterium en zette het criterium op "voldoet niet".
- Inloggen bij DigiD, eHerkenning of eIDAS valt buiten het bereik, net als andere websites van derden, en het bereik in het rapport zegt dat. 3.3.8 (Toegankelijke authenticatie) blijft daardoor niet meer open bij een site waar alleen via zo'n dienst wordt ingelogd: zonder eigen inlog is het criterium niet van toepassing. Een andere inlogdienst op een ander domein, ook van een leverancier, hoort nog steeds bij de site. Eerder zette zo'n inlog de status op C, terwijl het bereik websites van derden uitsloot.
- 3.2.4 (Consistente identificatie): een knop die "Terug" heet als de bezoeker van de site kwam en "Naar de site" als die van buiten kwam, heeft twee functies en is geen inconsistentie. Een bevinding beschrijft elke naam die het onderdeel kan krijgen, niet alleen de naam die de beoordelaar zag.
- Een naam die er is maar de functie onvolledig noemt, zoals een logo-link met alleen de naam van de organisatie, krijgt niet de ernst `hoog` van "geen naam".

### Verder

- Aanbevelingen: wat de site beter maakt en wat de norm niet vraagt, staat apart in het rapport, onder "Aanbevelingen" bij "Wat nu". Een aanbeveling telt niet mee voor de uitkomst, de status of de verklaring. Alleen een procedure geeft er een, met een regel in een eigen sectie (A1, A2). `check-verdict` weigert een aanbeveling zonder zo'n regel, zonder waarneming, op een plek met een bevinding, of op de plek van een bevinding die de verifieerder liet vervallen omdat ze niet opnieuw te zien was of bij een ander criterium hoort. `just procedures` weigert een regel voor een aanbeveling die een uitkomst noemt.
- Twee bevindingen onder hetzelfde criterium op dezelfde plek die verschillende gebreken zijn, krijgen elk een eigen nummer, met de titel in de hash. Eerder kreeg de tweede het nummer van de eerste met `-2` erachter, wat las als hetzelfde gebrek op een andere plek. Alleen dezelfde titel op dezelfde plek krijgt nog een achtervoegsel.
- De zin op het voorblad noemt het aantal criteria als het geheel waaruit geteld wordt: "voldoet niet aan WCAG 2.2 niveau A en AA: van de 55 criteria zijn er 11 niet gehaald". Eerder stond er "voldoet niet aan de 55 criteria", wat las alsof alle 55 niet gehaald waren.

## 0.2.0 (2026-10-15)

Deze versie is uitgebracht zonder nieuwe meting op de testsite. De twee wijzigingen die een uitkomst kunnen veranderen, zijn dus nog niet vergeleken met 0.1.2.

### Wat een uitkomst kan veranderen

- Een verifieerder die een bevinding laat vervallen omdat de norm het geen fout noemt, zegt welke tekst van de norm dat toestaat, en mag dezelfde vraag niet als `keuze nodig` doorgeven aan wie het rapport tekent. `check-verdict --round final` weigert na een afkeuring een eindoordeel "kan niet bepalen" met zo'n vervallen bevinding en een nieuw punt `keuze nodig`. `keuze nodig` is alleen voor een besluit dat de norm of de procedure bij de eigenaar legt (#35).
- Een open punt dat alleen open blijft omdat de run niet mocht versturen, heet `versturen niet toegestaan` en niet meer `mens nodig`. Het telt als keuze van de eigenaar: het rapport zet die punten apart onder "Nog uitzoeken", met de verklaring bij `inventory` die ze had gesloten (`--test-environment <origin>`, ook de origin van alleen een ingesloten venster), `loep gaps` telt ze apart en `loep feedback` maakt er geen issue van (#37).

### Verder

- De skill zoekt voor elke melding aan loep eerst in open en gesloten issues: een open issue krijgt een reactie, een gesloten issue dat terugkomt een nieuw issue dat het oude noemt (#34).
- Een run vanuit de geïnstalleerde plugin, buiten een git-repository, noemt in het rapport alleen de versie van loep. Bij het gereedschap en de herleidbaarheid staat dat de commit onbekend is, en het rapport zegt niets meer over niet vastgelegde wijzigingen. Een oudere run met de tekst `no commit yet` wordt net zo weergegeven (#36).
- De skill vraagt vooraf apart of het onderzoek mag versturen: op de hele site, alleen naar het adres dat het bericht ontvangt, of niet. `inventory` zegt het in een run die niet mag versturen als pagina's een eigen formulier hebben of een ingesloten venster op een ander adres er een heeft (#37).

## 0.1.2 (2026-10-15)

### Verder

- `loep feedback` schrijft voor elk criterium dat open bleef door loep zelf een tekst voor een issue, zonder adres of naam van de site; de skill zegt hoe een agent dat met een ja van de gebruiker terugmeldt (#28).
- De skill stelt vóór het onderzoek één ronde vragen: over een inlog of een testomgeving, hoeveel agents tegelijk mogen, wat erbij hoort, en de naam en organisatie voor het rapport. `inventory` zegt het als pagina's een wachtwoordveld tonen terwijl er niet is ingelogd (#29).

## 0.1.1 (2026-10-15)

### Verder

- Elke sessie van een agent krijgt een eigen werkmap `<run>/werk/<sessie>/`, zodat agents geen hulpscripts delen en geen commando's in elkaars sessie terechtkomen (#22).
- Bij open criteria noemt het rapport voor welke WCAG-versie een criterium geldt dat maar in één versie bestaat, zodat de telling klopt met de samenvatting (#26).

## 0.1.0 (2026-10-14)

### Wat een uitkomst kan veranderen

- Elk paginatype uit het sitemodel krijgt een pagina in de steekproef, ook als het dezelfde opbouw heeft als een ander type (#13).
- De bewijspoort kent de sneltoetsen die de veegronde mat, en beoordeelt opnieuw als de lijsten van onderdelen, inhoud, vensters of toetsen veranderen (#14).
- Een toets van één teken die volledig scherm aanvraagt, telt als reactie van de pagina (2.1.4) (#15).
- Het beeld van de Tab-proef toont de toestand waarin de stops zijn geteld, en de kaders staan op meeschuivende en vaste elementen (#16, #18).
- Een pagina die niet laadt, krijgt bij `contrast` een tweede poging; wat al gemeten was, gaat niet meer verloren (#17).
- Tesseract draait met één thread per pas, en een beeld dat niet is gemeten, zegt waarom (#19).
- Platte tekst (Markdown, txt, csv) en bestanden die een link met het download-attribuut aanbiedt, zijn documenten en geen pagina's (#20).
- axe-core 4.14. De regel `label-content-name-mismatch` (2.5.3) staat nu standaard aan. Vergeleken met 4.13 op de testsite in `validatie/testsite/2026-10-14-axe-4.14/` (#21).

### Verder

- Installeren via de marketplace van NLDD, en loep heet experimenteel (#6).
- TypeScript 7, vnu-jar 26.10.11 en nieuwe versies van de GitHub Actions; Dependabot slaat Playwright 1.64 en nieuwe versies van `@types/node` over (#9, #12).
- `publiccode.yml`, `GOVERNANCE.md`, `SUPPORT.md` en formulieren voor een fout of een voorstel (#23).
- De documentatie is weer naast de code gelegd (#24).
- Versies: één versie voor de toolbox en de plugin, een test die dat bewaakt, en `just release-prepare` en `just release-tag`.

## 0.0.1 (2026-10-14)

De eerste openbare versie.
