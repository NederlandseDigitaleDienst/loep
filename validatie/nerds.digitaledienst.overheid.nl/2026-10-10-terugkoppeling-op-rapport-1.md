# Terugkoppeling op het toegankelijkheidsrapport van NeRDS

Voor de bouwer van de toolbox. Rapport: evaluatie `7c19c731bdc4`, 10 oktober 2026, toolbox 0.0.1 (`ff40974843d0`), site `nerds.digitaledienst.overheid.nl` versie 0.3.2.

Elke bevinding is nagegaan in de broncode van de site (MkDocs, eigen thema, hooks) en waar nodig in Chromium op een lokale build. Daarna zijn ze opgelost in twee pull requests ([thema en sjablonen](https://github.com/NederlandseDigitaleDienst/NeRDS/pull/434), [inhoud](https://github.com/NederlandseDigitaleDienst/NeRDS/pull/435)), die nog niet zijn gemerged. Niets is getest met een schermlezer.

## Uitkomst in het kort

| | Aantal |
|---|---|
| Bevindingen in het rapport | 39 |
| Terecht | 34 |
| Deels terecht of discutabel | 4 |
| Onterecht | 1 |
| Niet terug te vinden in code of pagina | 0 |
| Unieke oorzaken (na samenvoegen van dubbelen) | 36 |
| Reparaties die nodig waren | 19 bij ons, 5 in het design systeem |

Dat is beter dan de verhouding die je zelf noemde (de helft terecht). Het enige onterechte punt en de vier twijfelgevallen staan hieronder met de reden.

## 1. Bevindingen die niet of niet helemaal kloppen

| Bevinding | Oordeel | Reden |
|---|---|---|
| `2.1.1-f6a3` Knop Sluit in zoekvenster niet met Tab te bereiken | **Onterecht** | De knop is met Tab te bereiken. Gemeten met een `focusin`-log: na openen zet het script de focus in het zoekveld. Tab gaat dan naar de browser zelf, de volgende Tab naar Sluit, de volgende naar het zoekveld. Sluit staat in de DOM vóór het veld, dus Shift+Tab bereikt hem direct. De proef telde "0 Tab-stops binnen" omdat hij stopt zodra de focus het document verlaat, en begon te tellen vanaf het veld waar de focus al stond. |
| `1.3.1-3e74` Tussenkopjes zijn alleen vet | Deels | Klopt voor "Gewenste uitkomsten" en "Aanvullend" (28 keer, telling klopt). Klopt niet voor "Doel" en "Ontwikkeling": dat zijn geen vette alinea's maar een component (`nldd-title`) zonder kopniveau. Het gevolg is hetzelfde, de reparatie niet. |
| `1.3.2-04ae` Versienummer vóór de hoofdtitel | Discutabel | De waarneming klopt. Een bovenkopje vóór de kop is een gangbaar patroon en de volgorde in beeld en in de code is gelijk. Of dit 1.3.2 schendt, hangt af van hoe streng je "betekenisvolle volgorde" leest. |
| `2.4.1-c6e4` Zijmenu binnen het hoofdgebied | Discutabel | De waarneming klopt. Een `aside` binnen `main` is geldige HTML, en met een werkende skiplink wordt het menu overgeslagen. Als tweede bevinding onder 2.4.1 is het zwak. |
| `2.4.6-66e1` "Sla over" zegt niet wat je overslaat | Discutabel | Beoordelaar B vond de tekst duidelijk; dat staat er eerlijk bij. Wij hebben hem toch aangepast, in dezelfde regel als de skiplink zelf. |

## 2. Hoe goed was de plek aangewezen

Alle 39 waren terug te vinden. Wat hielp en wat niet:

- **Hielp:** een selector plus een omschrijving in woorden ("onder de kop 'Boeken'", "na h4 'Communities'"). De omschrijving was vaak bruikbaarder dan de selector.
- **Hielp niet:** selectors als `#content > p:nth-of-type(8) > a`. In de bron is dat niet terug te tellen, want de bron is Markdown. De linktekst of de kop erboven is een betere wijzer.
- **Verrassend goed:** bij de streepjeskop noemt het advies het bronbestand `docs/version.md`, en dat klopt.
- **Niet te plaatsen:** "een div met mousedown en touchstart op P05, P14 en P15" (2.5.1, 2.5.2, 2.5.7) heeft geen selector. Wij hebben niet uitgezocht welk element het is.
- **Eén keer had de selector gelijk en ik niet.** Bij `2.4.4-e510` vond ik de link "soevereine overheidscloud" naar de Kamerbrief eerst niet, omdat ik op de kop zocht en twee andere links naar dezelfde brief zag. De selector `#content > p:nth-of-type(1) > a:nth-of-type(2)` wees de goede aan. Een citaat van de zin om de link had het sneller gemaakt.
- **Citaten wijken af van de pagina.** De alt-tekst van het label is "…van Nederlandse Richtlijn Digitale Systemen (NeRDS). Volg de link…", het rapport citeert "…van NeRDS. Volg de link…". De titel `Service Manual 'Making source code open and reusable'` heeft enkele aanhalingstekens, het rapport dubbele. Wie op het citaat zoekt, vindt niets.

## 3. Bevindingen die één reparatie zijn

39 bevindingen werden 19 reparaties bij ons. De groepen:

| Eén reparatie | Bevindingen |
|---|---|
| Naam van de fasepagina's in de navigatie (één bestand, vier regels) | `2.4.2-e194`, `2.4.4-1cc3`, `3.2.4-85fb` |
| Feedbackformulier | `3.3.2-b74c`, `3.3.3-a383`, `4.1.3-82d1` |
| Pagina Toegankelijkheid herschrijven | `1.1.1-5ca3`, `1.4.5-45a7`, `2.4.7-4c17`, en het open punt bij 2.5.3 |
| Skiplink, één regel | `2.4.1-8868`, `2.4.6-66e1` |
| Kopniveau "Direct aan de slag" | `1.3.1-8752`, `2.4.6-5312` (dubbel) |
| Streepjeskop | `1.3.1-b708`, `2.4.6-c432` (dubbel) |
| Twee kaarten "Opensourcewerken" | `2.4.4-c27e`, `2.4.6-b68d` (dubbel) |
| Koppen en afvinklijst op de fasepagina's | `1.3.1-3e74`, `1.3.1-d223` |
| Handreiking van de VNG | `2.4.4-c10a`, `3.2.4-b46c` |
| Engelse tekst | `3.1.2-9d07`, `3.1.2-4b0b`, `3.1.2-1bae` |
| Contactlink en botsende linknamen | `3.2.4-cdf6`, `2.4.4-e510` |

De drie paren met "(dubbel)" zijn letterlijk hetzelfde gebrek onder twee criteria. Het hoofdstuk "Bevindingen per onderdeel" groepeert al, maar zet deze paren soms onder twee verschillende onderdeelnamen ("Blok 'Direct aan de slag'" en "Blok 'Direct aan de slag' op fasepagina's"), en tien bevindingen onder "Zonder onderdeel". Groeperen op plek en tekst zou ze samenbrengen.

### Eigenaar

De toolbox leidt de eigenaar af uit de pagina. Vergeleken met de code:

| Bevinding | Rapport | Werkelijk |
|---|---|---|
| `2.4.1-c6e4` zijmenu in main | techniek | component: `nldd-page` zet alles uit de standaardslot in `main` |
| `1.3.2-04ae` versienummer vóór h1 | techniek | component: `nldd-title` zet de overline vóór de kop |
| `1.4.1-0692` huidige pagina alleen kleur | design | component: `nldd-list-item[current]` |
| `1.4.4-bb7c` knoptekst weg bij 200% | design | techniek: een attribuut dat wij zelf zetten |
| `1.3.1-3e74` "Doel" | content | techniek: een hook zet de admonition om |
| `1.3.1-bad0` kaarten, menu en voet geen lijst | leverancier | gemengd: kaarten en menu zijn van het component, de voet was van ons |
| `2.4.1-8868` skiplink | techniek, advies wijst naar het component | gemengd, zie hieronder |

Vijf bevindingen horen geheel of deels bij het design systeem. Die apart markeren, zoals je voorstelt, klopt met wat wij vonden. Het rapport kan dat zelf niet weten zonder hulp. Een bestandje dat de site meegeeft (welke tags zijn van een leverancier) zou genoeg zijn; hier is dat alles wat met `nldd-` begint.

## 4. Was het hersteladvies bruikbaar

Meestal wel. Het advies noemt bijna altijd een concrete ingreep en vaak het goede bestand of onderdeel.

**Letterlijk uitgevoerd,** onder meer: `display: inline-block` op de link om de afbeelding; een eigen `<title>` voor de 404; h4 en h5 voor "Direct aan de slag"; de lege regels boven de titel van de versiepagina weg.

**Anders uitgevoerd, met de reden:**

- **Skiplink.** Advies: laat het component de focus verplaatsen met `focus()`. De oorzaak lag anders: het component focust het volgende element, en dat was een `<noscript>`-blok van ons. Een `href` op de skiplink was genoeg. De proef kan dit zien door vast te leggen wat het doel van de skiplink is en of dat element wordt weergegeven.
- **`<span lang="en">`.** Juist als HTML, maar de bron is Markdown en een script dat de teksten hergebruikt stopt op losse HTML-tags. Het werd `{: lang="en" }`. Het rapport kan erbij zeggen dat het voorbeeld de gewenste HTML toont, niet de bronwijziging.
- **Namen.** De voorgestelde namen ("Opensourcewerken.nl (kennisbank)", "Versiegeschiedenis") waren voorbeelden; wij kozen andere. Dat is prima, zo zijn ze ook gebracht.

**Fout of schadelijk:**

- **`1.3.1-d223`:** "geef de lijst `role="group"`". Een `ul` met een andere rol is geen lijst meer; de `li`'s raken hun ouder kwijt en axe keurt dat af. Wij hebben de lijst een naam gegeven met `aria-labelledby` naar de kop en de fasekop.
- **`1.4.4-bb7c`:** "laat het label zichtbaar bij 640 pixels". Letterlijk uitgevoerd (alle drie de knoppen met tekst) werd de pagina op 320 pixels 329 breed. Het advies voor 1.4.4 veroorzaakte een fout op 1.4.10. Een advies over ruimte zou de smalste meetbreedte moeten noemen.

- **`1.4.10-ebc5`:** "`overflow-wrap: anywhere` en `hyphens: auto` op de h1". Dat haalde de pagina naar 320 pixels, maar brak op 500 pixels breed woorden af die op een eigen regel pasten ("verantw-oord"), omdat koppen al `text-wrap: balance` hebben. Het werd `overflow-wrap: break-word` zonder automatisch afbreken. Wij ontdekten dit pas bij een tweede controle; een meting op één breedte laat het niet zien.

**Detail:** het voorbeeld `https://nerds.nl/pagina` in het advies bij 3.3.3 is niet het adres van de site. Gebruik de onderzochte URL.

## 5. Wat mis is en niet in het rapport staat

- **21 koppen slaan een niveau over** (h2 direct naar h4) op 10 richtlijnpagina's, onder "Gerelateerde hulpmiddelen". Bijlage A noemt "op 11 pagina's is een niveau overgeslagen" als waarneming bij 1.3.1, maar er is geen bevinding van gemaakt en ze staan niet in de werklijst. De elfde pagina is waarschijnlijk Contact en bijdragen, waar een h4 in een citaatblok direct onder een h2 stond.
- **Het linkveld is `type="url"` terwijl het eigen script een adres zonder `https://` goedkeurt.** Het rapport zag dat het voorbeeld in het veld zelf ongeldig is; de oorzaak is dat browser en script elkaar tegenspreken.
- **"Work in Progress"** staat als open punt bij 3.1.2. Een open punt belandt niet in de werklijst "Oplossen" en ook niet in "Nog uitzoeken". Wij hebben het vertaald.
- **Afgekapte regels.** In "Nog uitzoeken" en in elk blok "Wat ontbreekt om te kunnen oordelen" eindigen regels op "…", midden in de instructie. Bijlage A heeft de volledige tekst, maar de werklijst is het deel dat iemand leest.
- **Tellingen zonder uitleg.** "64 formulieren op 30 pagina's" terwijl er één formulier is onderzocht; het rapport zegt zelf niet te weten welke formulieren het zijn. Hetzelfde voor "220 live-regio's" en "88 dialogen".
- **De 20 open criteria.** Een groot deel van wat ontbreekt is geen handwerk maar een stap die de proef kan herhalen: een zoekwoord typen en de resultaten meten; het venster "Kubernetes cluster aanmaken" voorbij de inlogknoppen (het hulpmiddel staat als "demo" in het register); de negen kaartknoppen die niet zijn bediend; de grens van 40 soorten bij 2.5.2. Dat sluit aan op wat je zelf zegt over wat pas na een handeling zichtbaar wordt.

## Voor de meting met versie 2

Lokaal bouwen: `uv run mkdocs build --site-dir <map>` op de branch `a11y-inhoud` (die bevat beide pull requests). Een kale statische server geeft de eigen 404-pagina niet terug; die staat in de build als `404.html`. De site telt na deze wijzigingen 29 pagina's: `/action-registry/` wordt niet meer gepubliceerd.

Wat wij verwachten te zien:

| Criterium | Was | Verwacht | Waarom |
|---|---|---|---|
| 2.4.1 | voldoet niet | voldoet, of alleen nog het zijmenu in main | skiplink werkt: volgende Tab landt op het eerste element in de inhoud |
| 2.4.2 | voldoet niet | voldoet | 29 pagina's, 29 titels |
| 1.3.1 | voldoet niet | alleen nog de punten van het design systeem | koppen, groepsnamen en voetlijsten zijn gedaan |
| 2.4.4, 3.2.4 | voldoet niet | voldoet | namen gelijkgetrokken |
| 2.4.6 | voldoet niet | voldoet, mits herhaalde koppen onder een andere ouder mogen | "Direct aan de slag" en "Gewenste uitkomsten" staan nog per fase op de pagina, nu als h4 onder de fasekop |
| 3.1.2 | voldoet niet | voldoet | acht fragmenten met `lang="en"` |
| 3.3.2, 3.3.3, 4.1.3 | voldoet niet | voldoet | eisen vooraf, aanwijzing bij het linkveld, melding met `role="alert"` |
| 1.4.10 | voldoet niet | voldoet | 320 op de zes gemeten pagina's |
| 1.4.4 | voldoet niet | voldoet niet | GitHub-knop heeft bij 200% nog geen zichtbare tekst; bewuste keuze, zie punt 4 |
| 1.4.5 | voldoet niet | discutabel | de status staat nu als tekst; het officiële label staat er nog als illustratie |
| 1.4.1, 1.3.2 | voldoet niet | voldoet niet | design systeem |
| 2.1.1 | voldoet niet | hangt af van de proef | er is niets gewijzigd; zie punt 1 |

Een nieuw gedrag om op te letten: het linkveld in het feedbackformulier keurt nu alleen tekst met een spatie of zonder punt af, en vult `https://` zelf aan.
