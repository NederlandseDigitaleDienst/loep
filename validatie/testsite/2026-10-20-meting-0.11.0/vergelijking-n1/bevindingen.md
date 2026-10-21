# Vergelijking per bevinding: Lindewaard (testsite)

De referentie is een antwoordsleutel: de fouten zijn met opzet ingebouwd en bestaan dus zeker.
Twee beoordelaars (A en B) hebben elke bevinding onafhankelijk van elkaar ingedeeld met dezelfde vaste opdracht. De kolom "Eens" telt alleen bevindingen waar A en B dezelfde klasse gaven. Waar ze verschillen, is dat een eigen getal. Het verschil is niet opgelost.

## De getallen die ertoe doen

| | A | B | Eens |
|---|---|---|---|
| Gevonden, van alle 79 bevindingen die meetellen | 98% | 98% | 98% |
| Gevonden, van wat nog bestaat en binnen bereik is (79, 79, 79) | 98% | 98% | 98% |
| Eigen bevindingen onterecht, van die zonder tegenhanger | 0% | 9% | 0% |

- A en B oneens over een bevinding van de referentie: 0 van 79 (0%).
- Daarvan ook oneens op hoofdlijn (gevonden, deels, gemist, niet meer aanwezig, buiten bereik): 0 (0%).
- A en B oneens over een eigen bevinding: 2 van 118 (2%).
- Criteria die de referentie afkeurt en die wij goedkeurden of niet van toepassing noemden: 1 (1.4.12).

## Bevindingen van de referentie

79 bevindingen, waarvan 0 over een document. Ze tellen allemaal mee. Percentages zijn van de 79 bevindingen die meetellen.

| Klasse | A | B | Eens |
|---|---|---|---|
| Gevonden | 77 (98%) | 77 (98%) | 77 (98%) |
| Deels | 0 (0%) | 0 (0%) | 0 (0%) |
| Gemist, bewijs aanwezig, beoordeling ging mis | 2 (3%) | 2 (3%) | 2 (3%) |
| Gemist, bewijs aanwezig, niet in het dossier | 0 (0%) | 0 (0%) | 0 (0%) |
| Gemist, geen bewijs | 0 (0%) | 0 (0%) | 0 (0%) |
| Niet meer aanwezig | 0 (0%) | 0 (0%) | 0 (0%) |
| Buiten bereik | 0 (0%) | 0 (0%) | 0 (0%) |
| Oneens | | | 0 (0%) |

Op hoofdlijn:

| Klasse | A | B | Eens |
|---|---|---|---|
| Gevonden | 77 (98%) | 77 (98%) | 77 (98%) |
| Deels | 0 (0%) | 0 (0%) | 0 (0%) |
| Gemist | 2 (3%) | 2 (3%) | 2 (3%) |
| Niet meer aanwezig | 0 (0%) | 0 (0%) | 0 (0%) |
| Buiten bereik | 0 (0%) | 0 (0%) | 0 (0%) |
| Oneens | | | 0 (0%) |

## Onze bevindingen

118 bevindingen. "Met tegenhanger" is een aandeel van alle bevindingen. De andere drie zijn een aandeel van de bevindingen zonder tegenhanger (11 bij A, 11 bij B, 11 waar ze het eens zijn dat er een tegenhanger is, afgetrokken van het totaal).

| Klasse | A | B | Eens |
|---|---|---|---|
| Met tegenhanger | 107 (91%) | 107 (91%) | 107 (91%) |
| Terecht | 4 (36%) | 5 (46%) | 4 (36%) |
| Discutabel | 7 (64%) | 5 (46%) | 5 (46%) |
| Onterecht | 0 (0%) | 1 (9%) | 0 (0%) |
| Oneens | | | 2 (2%) |

Herhaling: bij A staan onder 25 bevindingen van de referentie meer dan één van onze bevindingen (33 te veel), bij B onder 25 (33 te veel).

## Per criterium

| | Aantal |
|---|---|
| Door de referentie afgekeurd | 51 |
| Daarvan ook door ons afgekeurd | 50 (98%) |
| Daarvan door ons niet beslist | 0 (0%) |
| Daarvan door ons goedgekeurd of niet van toepassing verklaard | 1 (2%) |
| Alleen door ons afgekeurd | 0 |

Andere uitkomst bij ons:

- 1.4.12: Voldoet

## Waar A en B verschillen

| Nr. | A | B | Reden A | Reden B |
|---|---|---|---|---|
| LIND-2.1.4-5885 | Discutabel | Onterecht | Klopt: m zet het geluid uit met de focus op Volledig scherm in de speler. De toets werkt alleen met de focus in de speler, dus de uitzondering voor focus geldt waarschijnlijk. | De speler luistert naar k en m op het document in zijn eigen venster. De toetsen werken dus alleen als de focus in de speler staat; dat valt onder de uitzondering. |
| LIND-4.1.3-8c59 | Discutabel | Terecht | Klopt: "Ongeldige invoer." verschijnt na versturen zonder live-regio, focus blijft op de knop. Een foutmelding na versturen telt niet altijd als statusbericht; het gebrek bij de datum staat al onder 3.3.3. | Volgens site.js komt Ongeldige invoer in een gewone p.veldmelding, zonder rol of live-regio, en de focus gaat er niet heen. Hulpsoftware hoort de melding dus niet. |

## Bijlage: de bevindingen van de referentie

| Nr. | SC | Pagina | Kern | Klasse | Onze bevinding |
|---|---|---|---|---|---|
| 1.1.1-logo-melding | 1.1.1 | alle | Het logo in de cookiemelding heeft als tekstalternatief het woord "logo". | Gevonden | LIND-1.1.1-7302 |
| 1.1.1-artikelfoto | 1.1.1 | /nieuws/nieuwe-fietsenstalling.html | De foto van de fietsenstalling heeft geen alt-attribuut. | Gevonden | LIND-1.1.1-5af9 |
| 1.1.1-bestandsnaam | 1.1.1 | / | Het logo van het waterschap heeft een bestandsnaam als tekstalternatief. | Gevonden | LIND-1.1.1-ccc2 |
| 1.1.1-tarieven | 1.1.1 | /veelgestelde-vragen.html | De tarieven staan alleen in een afbeelding van een tabel, met een leeg alt. | Gevonden | LIND-1.1.1-3274, LIND-1.4.5-4705 |
| 1.2.1-gesprek | 1.2.1 | /nieuws/nieuwe-fietsenstalling.html | Het gesprek met de wethouder is alleen te beluisteren; er is geen uitgeschreven tekst. | Gevonden | LIND-1.2.1-4569 |
| 1.2.2-ondertitels | 1.2.2 | /raadsvergadering.html | De video heeft gesproken tekst en geen ondertitels. | Gevonden | LIND-1.2.2-d601 |
| 1.2.3-beschrijving | 1.2.3 | /raadsvergadering.html | De dia in beeld toont de agenda en de uitslag van de stemming (14 voor, 5 tegen). De spreker noemt die niet en er is geen uitgeschreven tekst. | Gevonden | LIND-1.2.3-8034 |
| 1.2.5-audiodescriptie | 1.2.5 | /raadsvergadering.html | Er is geen audiodescriptie voor de informatie die alleen in beeld staat. | Gevonden | LIND-1.2.5-f25e |
| 1.3.1-vette-tussenkop | 1.3.1 | /nieuws/nieuwe-fietsenstalling.html | Een tussenkop is opgemaakt als vette alinea in plaats van als kop. | Gevonden | LIND-1.3.1-65b1 |
| 1.3.1-lijst-als-alinea | 1.3.1 | /nieuws/nieuwe-fietsenstalling.html | Een opsomming is gemaakt met streepjes en regeleinden in één alinea. | Gevonden | LIND-1.3.1-579a |
| 1.3.1-tussenkop-uitklapper | 1.3.1 | /veelgestelde-vragen.html | Twee tussenkoppen in een dichte uitklapper zijn vette alinea's. | Gevonden | LIND-1.3.1-31ab |
| 1.3.1-tabelkoppen | 1.3.1 | /openingstijden.html | De kopcellen van de rijen en kolommen zijn gewone cellen met een vette opmaak. | Gevonden | LIND-1.3.1-6081 |
| 1.3.1-voetkop | 1.3.1 | alle | De titels boven de kolommen in de voet zijn spans en geen koppen. | Gevonden | LIND-1.3.1-220d |
| 1.3.1-keuzegroep | 1.3.1 | /contact.html | De groep keuzerondjes heeft geen fieldset en legend; de vraag is een losse alinea. | Gevonden | LIND-1.3.1-cd47 |
| 1.3.2-zoekvolgorde | 1.3.2 | /zoeken.html, /zoeken.html?q=afval | Het aantal resultaten en de links onder "Veel gezocht" staan in de code na de resultaten en zijn met CSS order naar boven gezet. | Gevonden | LIND-1.3.2-af96 |
| 1.3.2-kaart-omgekeerd | 1.3.2 | /nieuws/ | In de code staat eerst de samenvatting, dan de datum en als laatste de kop. Op het scherm is de volgorde omgedraaid. | Gevonden | LIND-1.3.2-09f7 |
| 1.3.3-ronde-knop | 1.3.3 | /contact.html | De instructie verwijst naar "de ronde groene knop rechtsonder" en noemt de naam van de knop niet. | Gevonden | LIND-1.3.3-6f0e |
| 1.3.4-draai | 1.3.4 | /openingstijden.html | Op een scherm in staande stand tot 900 pixels breed is de tabel verborgen en staat er dat de bezoeker het toestel moet draaien. | Gevonden | LIND-1.3.4-30e4 |
| 1.3.5-autocomplete | 1.3.5 | /contact.html | De velden voor persoonsgegevens hebben geen autocomplete-attribuut. | Gevonden | LIND-1.3.5-12d9, LIND-1.3.5-5e01, LIND-1.3.5-dd72 |
| 1.4.1-tekstlink | 1.4.1 | alle | Links in de tekst zijn niet onderstreept en verschillen alleen in kleur van de tekst eromheen (donkerblauw naast bijna zwart, contrast onder 3 op 1). | Gevonden | LIND-1.4.1-0375 |
| 1.4.1-verplicht | 1.4.1 | /contact.html | Verplichte velden zijn alleen aan de rode kleur van het label te herkennen. | Gevonden | LIND-1.4.1-1d5c, LIND-1.3.1-39d6, LIND-1.3.3-c789 |
| 1.4.2-melodie | 1.4.2 | / | Bij het openen van de startpagina begint een melodie die blijft herhalen. Er is geen knop om het geluid te stoppen. | Gevonden | LIND-1.4.2-5453 |
| 1.4.3-datum | 1.4.3 | alle | De datum is lichtgrijs op wit (ongeveer 2,6 op 1). | Gevonden | LIND-1.4.3-7322 |
| 1.4.3-tekst-op-foto | 1.4.3 | / | Witte tekst staat direct op de foto. Het linkerdeel van de foto is licht, daar is het contrast te laag. | Gevonden | LIND-1.4.3-2754, LIND-1.4.3-157b |
| 1.4.3-menu-aanwijzen | 1.4.3 | alle | Bij aanwijzen met de muis wordt een menulink grijs op lichtgrijs (ongeveer 2 op 1). | Gevonden | LIND-1.4.3-3e50 |
| 1.4.4-zoom-uit | 1.4.4 | alle | De pagina verbiedt inzoomen op een aanraakscherm (user-scalable=no, maximum-scale=1). | Gevonden | LIND-1.4.4-8591 |
| 1.4.4-inleiding | 1.4.4 | /producten.html | De alinea heeft een vaste hoogte. Bij 200% vergroten valt het einde van de tekst weg. | Gevonden | LIND-1.4.4-1b94 |
| 1.4.5-zomerfeest | 1.4.5 | / | De aankondiging is een afbeelding van tekst. Het alt geeft de tekst wel weer. | Gevonden | LIND-1.4.5-bca8 |
| 1.4.10-weigerknop | 1.4.10 | alle | Op 320 pixels breed staan de knoppen op één rij en valt "Weigeren" buiten beeld. | Gevonden | LIND-1.4.10-ebc7 |
| 1.4.10-rooster | 1.4.10 | /producten.html | Het rooster heeft een vaste breedte van 720 pixels. Op 320 pixels breed moet de bezoeker opzij schuiven. | Gevonden | LIND-1.4.10-f899 |
| 1.4.11-veldrand | 1.4.11 | alle | De rand van de invoervelden is lichtgrijs op wit (ongeveer 1,4 op 1). | Gevonden | LIND-1.4.11-bc48 |
| 1.4.12-tegel | 1.4.12 | / | De tegels hebben een vaste hoogte. Met ruimere tekstafstand past de tekst niet meer en valt de laatste regel weg. | Gemist, bewijs aanwezig, beoordeling ging mis |  |
| 1.4.13-uitleg | 1.4.13 | /openingstijden.html | De uitleg verschijnt bij aanwijzen of focus. Hij is niet met Escape te sluiten en verdwijnt als de muis naar de uitleg zelf gaat. | Gevonden | LIND-1.4.13-5759, LIND-1.4.13-6cf0 |
| 2.1.1-nieuwskaart | 2.1.1 | /nieuws/ | Een kaart opent het bericht bij een klik, maar is geen link. De klik wordt afgehandeld op de lijst eromheen. Met het toetsenbord is het bericht niet te openen. | Gevonden | LIND-2.1.1-98e5, LIND-4.1.2-e33d |
| 2.1.1-productkaart | 2.1.1 | /producten.html | Een kaart opent een venster met uitleg bij een klik, maar is geen knop en krijgt geen focus. | Gevonden | LIND-2.1.1-98e5, LIND-4.1.2-bc00 |
| 2.1.1-vinkje | 2.1.1 | /contact.html | Het echte selectievakje is verborgen met display:none en vervangen door een getekend vakje. Het is niet met Tab te bereiken. | Gevonden | LIND-2.1.1-3bcc, LIND-4.1.2-d147 |
| 2.1.1-naar-boven | 2.1.1 | alle | De link heeft geen href en werkt alleen met de muis. | Gevonden | LIND-2.1.1-08a2, LIND-4.1.2-6f22 |
| 2.1.1-chat-sluit | 2.1.1 | alle | Het kruisje om de chat te sluiten is een div die alleen op een klik reageert. | Gevonden | LIND-4.1.2-3903 |
| 2.1.2-chat | 2.1.2 | alle | Staat de focus in het invoerveld van de chat, dan doet Tab niets meer. Escape sluit de chat niet. | Gevonden | LIND-2.1.2-f5c5 |
| 2.1.4-sneltoets | 2.1.4 | alle | De letter z zet de focus in het zoekveld en de letter c opent de chat. De sneltoetsen zijn niet uit te zetten of te wijzigen. | Gevonden | LIND-2.1.4-45db |
| 2.2.1-tijdslimiet | 2.2.1 | /contact.html | Na tien minuten gaat de pagina vanzelf terug naar de startpagina. De tijd is niet te verlengen of uit te zetten. | Gevonden | LIND-2.2.1-f914 |
| 2.2.2-uitgelicht | 2.2.2 | / | Het blok wisselt elke vier seconden vanzelf van bericht. Er is geen knop om het te pauzeren. | Gevonden | LIND-2.2.2-facb |
| 2.4.1-skiplink | 2.4.1 | alle | De skiplink wijst naar #inhoud, maar dat id bestaat niet. Er gebeurt niets bij activeren. | Gevonden | LIND-2.4.1-1ce6 |
| 2.4.2-sjabloonrest | 2.4.2 | / | De titel is "Home - Gemeente Lindewaard - Gemeente Lindewaard % % %": de naam staat er dubbel en er staan resten van een sjabloon in. | Gevonden | LIND-2.4.2-acbc |
| 2.4.2-zelfde-titel | 2.4.2 | /veelgestelde-vragen.html, /afval.html | Beide pagina's hebben alleen "Gemeente Lindewaard" als titel. | Gevonden | LIND-2.4.2-bdfb |
| 2.4.3-tabindex | 2.4.3 | /contact.html | De velden hebben tabindex 1, 3 en 2. De focus begint midden op de pagina en gaat van naam naar telefoonnummer naar e-mailadres. | Gevonden | LIND-2.4.3-9147 |
| 2.4.3-mobiel-menu | 2.4.3 | alle | Het menu staat in de code na de voet. Na het openen moet de bezoeker met Tab eerst door de hele pagina voordat de focus in het menu komt. | Gevonden | LIND-2.4.3-504f |
| 2.4.4-klik-hier | 2.4.4 | /nieuws/nieuwe-fietsenstalling.html | De link naar de parkeervergunning heet "Klik hier" en staat alleen in een eigen alinea. | Gevonden | LIND-2.4.4-860a |
| 2.4.4-sociaal | 2.4.4 | alle | De links bestaan alleen uit een pictogram en hebben geen naam. | Gevonden | LIND-2.4.4-9d17, LIND-4.1.2-4b02, LIND-1.1.1-c54f |
| 2.4.6-informatie | 2.4.6 | /nieuws/nieuwe-fietsenstalling.html | Twee verschillende onderdelen hebben allebei de kop "Informatie". | Gevonden | LIND-2.4.6-8ef1 |
| 2.4.7-menu | 2.4.7 | alle | De focusrand is weggehaald (outline: none) en er is niets voor in de plaats gekomen. | Gevonden | LIND-2.4.7-0111, LIND-2.4.7-9b42 |
| 2.4.11-melding | 2.4.11 | alle | De cookiemelding ligt als vaste laag over de onderkant van de pagina en houdt de focus niet vast. Een element dat focus krijgt onderaan het scherm ligt helemaal achter de melding. De melding zelf komt pas als laatste in de Tab-volgorde. | Gevonden | LIND-2.4.11-f5a4, LIND-2.4.3-e622 |
| 2.5.1-galerij | 2.5.1 | /nieuws/nieuwe-fietsenstalling.html | De volgende foto is alleen te bereiken door te vegen. Er zijn geen knoppen. | Gevonden | LIND-2.5.1-7a69, LIND-2.1.1-9000 |
| 2.5.2-feedback | 2.5.2 | /veelgestelde-vragen.html | De knoppen werken al bij het indrukken van de muisknop. Wegschuiven en loslaten maakt het niet ongedaan. | Gevonden | LIND-2.5.2-b13b |
| 2.5.3-zoekknop | 2.5.3 | alle | Op de knop staat "Zoeken", de toegankelijke naam is "Opdracht versturen". | Gevonden | LIND-2.5.3-9f4d |
| 2.5.7-schuif | 2.5.7 | /producten.html | De schuif werkt alleen door het bolletje te slepen. Klikken op de balk doet niets en het bolletje krijgt geen focus. | Gevonden | LIND-2.5.7-526c, LIND-2.1.1-4d08, LIND-4.1.2-4cf1 |
| 2.5.8-paginering | 2.5.8 | /nieuws/ | De links zijn 18 bij 18 pixels en staan 3 pixels uit elkaar. | Gevonden | LIND-2.5.8-ff88 |
| 3.1.1-taal | 3.1.1 | alle | De pagina heeft geen taalcode. | Gevonden | LIND-3.1.1-01fd, LIND-3.1.1-6f14 |
| 3.1.2-engels | 3.1.2 | /nieuws/nieuwe-fietsenstalling.html | Een Engelse zin heeft geen taalcode. | Gevonden | LIND-3.1.2-ad88 |
| 3.2.1-voetlink | 3.2.1 | alle | Zodra de link focus krijgt, haalt een script de focus weer weg. De link is daardoor niet met het toetsenbord te gebruiken. | Gevonden | LIND-3.2.1-075c, LIND-2.4.7-f2b0 |
| 3.2.2-wijk | 3.2.2 | /afval.html | Bij het kiezen van een wijk laadt de pagina direct opnieuw, zonder waarschuwing en zonder knop. | Gevonden | LIND-3.2.2-cfa6 |
| 3.2.3-menuvolgorde | 3.2.3 | /contact.html | Op de contactpagina staat "Contact" vooraan in het menu. Op alle andere pagina's staat het achteraan. | Gevonden | LIND-3.2.3-04f9, LIND-3.2.6-2f1b |
| 3.2.4-zoekknop | 3.2.4 | /zoeken.html | De knop heet hier "Vind". Dezelfde functie heet in de kop en op de pagina voor een onbekend adres "Zoeken". | Gevonden | LIND-3.2.4-ecdc |
| 3.2.6-hulp | 3.2.6 | alle | Op de nieuwspagina's staat het hulpblok in de kop, vóór het menu. Op alle andere pagina's staat het in de voet. | Gevonden | LIND-3.2.6-abb3, LIND-3.2.3-d291 |
| 3.3.1-rode-rand | 3.3.1 | /contact.html | Een verplicht veld dat leeg is, krijgt alleen een rode rand. Er staat geen tekst die zegt wat er mis is. | Gevonden | LIND-3.3.1-3956, LIND-3.3.3-85d4 |
| 3.3.2-plaatshouder | 3.3.2 | /contact.html | De velden hebben geen label, alleen een voorbeeldtekst in het veld die verdwijnt bij typen. | Gevonden | LIND-3.3.2-b94c, LIND-3.3.2-4e42 |
| 3.3.3-datum | 3.3.3 | /contact.html | Bij een datum in de verkeerde vorm staat er alleen "Ongeldige invoer." De gewenste vorm wordt nergens genoemd. | Gevonden | LIND-3.3.3-19b5, LIND-3.3.2-18f3 |
| 3.3.4-controle | 3.3.4 | /vergunning.html | De aanvraag met betaalverplichting wordt na stap 2 direct verstuurd. Er is geen stap om de gegevens te controleren of te wijzigen. | Gevonden | LIND-3.3.4-9ddf |
| 3.3.7-adres | 3.3.7 | /vergunning.html | Het adres uit stap 1 moet in stap 2 opnieuw worden getypt voor de rekening. | Gevonden | LIND-3.3.7-914b |
| 3.3.8-wachtwoord | 3.3.8 | /inloggen.html | Plakken in het wachtwoordveld is geblokkeerd en automatisch invullen staat uit. Daarnaast moet de bezoeker twee letters van een geheim woord uit het hoofd typen. | Gevonden | LIND-3.3.8-843c, LIND-3.3.8-d249, LIND-1.3.5-3af0 |
| 4.1.2-tabs | 4.1.2 | /afval.html | De tabbladen zijn divs met een klikhandler, zonder rol, zonder toestand en zonder focus. | Gevonden | LIND-4.1.2-de61, LIND-2.1.1-0ca8 |
| 4.1.2-uitklapper | 4.1.2 | /veelgestelde-vragen.html | De knoppen melden niet of het antwoord open of dicht is. | Gevonden | LIND-4.1.2-6a9a |
| 4.1.2-menuknop | 4.1.2 | alle | De knop heeft geen naam en meldt niet of het menu open is. | Gevonden | LIND-4.1.2-c8b1, LIND-4.1.2-25b3, LIND-1.1.1-c54f |
| 4.1.2-rol-logo | 4.1.2 | alle | De afbeelding heeft role="logo". Die rol bestaat niet. | Gemist, bewijs aanwezig, beoordeling ging mis |  |
| 4.1.2-kadertitel | 4.1.2 | /nieuws/nieuwe-fietsenstalling.html, /raadsvergadering.html | Het venster van de videospeler heeft geen titel. | Gevonden | LIND-4.1.2-454c |
| 4.1.2-venster | 4.1.2 | /producten.html | Het venster heeft geen rol dialog en geen naam. De focus gaat er niet heen en het kruisje is een div. | Gevonden | LIND-4.1.2-c4be, LIND-2.4.3-2683, LIND-4.1.2-3903, LIND-2.1.1-52a3 |
| 4.1.3-bedankt | 4.1.3 | /veelgestelde-vragen.html | "Bedankt voor uw reactie." verschijnt zonder dat hulpsoftware het meldt. | Gevonden | LIND-4.1.3-f7ba |
| 4.1.3-aantal | 4.1.3 | /producten.html | Bij typen in het zoekveld verandert het aantal gevonden producten zonder dat hulpsoftware het meldt. | Gevonden | LIND-4.1.3-8c06 |
| 4.1.3-chat | 4.1.3 | alle | Nieuwe berichten in de chat worden niet gemeld aan hulpsoftware. | Gevonden | LIND-4.1.3-9498 |

## Bijlage: onze bevindingen

| Nr. | SC | Kern | Klasse |
|---|---|---|---|
| LIND-1.1.1-5af9 | 1.1.1 | Foto van de fietsenstalling zonder alt-tekst | Met tegenhanger |
| LIND-1.1.1-ccc2 | 1.1.1 | Partnerlogo heeft een bestandsnaam als alt-tekst | Met tegenhanger |
| LIND-1.1.1-7302 | 1.1.1 | Wapen in de cookiemelding heet alleen logo | Met tegenhanger |
| LIND-1.1.1-c54f | 1.1.1 | Knoppen en links met alleen een pictogram hebben geen naam | Met tegenhanger |
| LIND-1.1.1-3274 | 1.1.1 | Tarieven alleen in een afbeelding met lege alt-tekst | Met tegenhanger |
| LIND-1.2.1-4569 | 1.2.1 | Geluidsfragment van de wethouder zonder tekstversie | Met tegenhanger |
| LIND-1.2.1-ad7d | 1.2.1 | Verborgen muziek op de startpagina zonder tekst | Discutabel |
| LIND-1.2.2-d601 | 1.2.2 | Video van de raadsvergadering heeft geen ondertiteling | Met tegenhanger |
| LIND-1.2.3-8034 | 1.2.3 | Uitslag van de stemming staat alleen in beeld | Met tegenhanger |
| LIND-1.2.5-f25e | 1.2.5 | Uitslag van de stemming staat alleen in beeld | Met tegenhanger |
| LIND-1.3.1-220d | 1.3.1 | Kolomtitels in de voettekst zijn geen kop | Met tegenhanger |
| LIND-1.3.1-5dfd | 1.3.1 | Titel van de cookiemelding is geen kop | Discutabel |
| LIND-1.3.1-cd47 | 1.3.1 | Keuzerondjes niet gegroepeerd onder hun vraag | Met tegenhanger |
| LIND-1.3.1-39d6 | 1.3.1 | Verplichte velden alleen met rode letters gemarkeerd | Met tegenhanger |
| LIND-1.3.1-65b1 | 1.3.1 | Vette tussenkop in het nieuwsbericht is geen kop | Met tegenhanger |
| LIND-1.3.1-579a | 1.3.1 | Opsomming met streepjes is geen lijst | Met tegenhanger |
| LIND-1.3.1-6081 | 1.3.1 | Tabel met openingstijden heeft geen kopcellen | Met tegenhanger |
| LIND-1.3.1-31ab | 1.3.1 | Vette tussenkoppen in een antwoord zijn geen kop | Met tegenhanger |
| LIND-1.3.1-7927 | 1.3.1 | Reeksen kaarten staan niet in een lijst | Discutabel |
| LIND-1.3.2-af96 | 1.3.2 | Zoekpagina: telling en Veel gezocht staan in de code na de resultaten | Met tegenhanger |
| LIND-1.3.2-09f7 | 1.3.2 | Nieuwskaarten: kop staat in de code na samenvatting en datum | Met tegenhanger |
| LIND-1.3.3-6f0e | 1.3.3 | Verzendknop alleen aangeduid met vorm, kleur en plek | Met tegenhanger |
| LIND-1.3.3-c789 | 1.3.3 | Verplichte velden alleen aangeduid met de kleur rood | Met tegenhanger |
| LIND-1.3.4-30e4 | 1.3.4 | Tabel met openingstijden alleen liggend te zien | Met tegenhanger |
| LIND-1.3.5-12d9 | 1.3.5 | Naamveld in het contactformulier zegt niet dat het om de naam vraagt | Met tegenhanger |
| LIND-1.3.5-5e01 | 1.3.5 | E-mailveld in het contactformulier zegt niet dat het om het e-mailadres vraagt | Met tegenhanger |
| LIND-1.3.5-dd72 | 1.3.5 | Telefoonveld in het contactformulier zegt niet dat het om het telefoonnummer vraagt | Met tegenhanger |
| LIND-1.3.5-3af0 | 1.3.5 | Wachtwoordveld zet het invullen door de browser uit | Met tegenhanger |
| LIND-1.3.5-e602 | 1.3.5 | Straat voor de rekening zegt niet dat het om het adres vraagt | Terecht |
| LIND-1.3.5-949f | 1.3.5 | Postcode voor de rekening zegt niet dat het om de postcode vraagt | Terecht |
| LIND-1.4.1-0375 | 1.4.1 | Links in lopende tekst alleen herkenbaar aan kleur | Met tegenhanger |
| LIND-1.4.1-1d5c | 1.4.1 | Verplichte velden alleen aangeduid met rode labels | Met tegenhanger |
| LIND-1.4.2-5453 | 1.4.2 | Muziek op de startpagina start vanzelf en is niet te stoppen | Met tegenhanger |
| LIND-1.4.3-2754 | 1.4.3 | Witte welkomstkop op lichte foto | Met tegenhanger |
| LIND-1.4.3-7322 | 1.4.3 | Lichtgrijze datums bij het nieuws | Met tegenhanger |
| LIND-1.4.3-157b | 1.4.3 | Witte inleiding op lichte foto | Met tegenhanger |
| LIND-1.4.3-3e50 | 1.4.3 | Menulinks bijna onleesbaar bij aanwijzen | Met tegenhanger |
| LIND-1.4.4-8591 | 1.4.4 | Inzoomen op een telefoon is uitgezet | Met tegenhanger |
| LIND-1.4.4-1b94 | 1.4.4 | Inleiding op de productenpagina valt weg bij vergroten | Met tegenhanger |
| LIND-1.4.5-bca8 | 1.4.5 | Aankondiging van het zomerfeest is een afbeelding van tekst | Met tegenhanger |
| LIND-1.4.5-4705 | 1.4.5 | Tarieven voor paspoort en rijbewijs staan als afbeelding | Met tegenhanger |
| LIND-1.4.10-f899 | 1.4.10 | Rij productkaarten past niet op een smal scherm | Met tegenhanger |
| LIND-1.4.10-ebc7 | 1.4.10 | Knop Weigeren van de cookiemelding valt weg op een smal scherm | Met tegenhanger |
| LIND-1.4.10-d889 | 1.4.10 | Zoekbalk in de kop te breed in Safari | Discutabel |
| LIND-1.4.10-f003 | 1.4.10 | Uitleg bij de openingstijden valt buiten een smal scherm | Terecht |
| LIND-1.4.11-bc48 | 1.4.11 | Invoervelden hebben een te vage rand | Met tegenhanger |
| LIND-1.4.13-5759 | 1.4.13 | Uitleg bij de openingstijden is niet weg te halen met Escape | Met tegenhanger |
| LIND-1.4.13-6cf0 | 1.4.13 | Uitleg bij de openingstijden verdwijnt als de muis erop komt | Met tegenhanger |
| LIND-2.1.1-0ca8 | 2.1.1 | Tabbladen per afvalsoort werken alleen met de muis | Met tegenhanger |
| LIND-2.1.1-98e5 | 2.1.1 | Nieuws- en productkaarten openen alleen met een klik | Met tegenhanger |
| LIND-2.1.1-52a3 | 2.1.1 | Productvenster is alleen met de muis te sluiten | Met tegenhanger |
| LIND-2.1.1-4d08 | 2.1.1 | Schuifregelaar voor de hoogste prijs werkt alleen met slepen | Met tegenhanger |
| LIND-2.1.1-9000 | 2.1.1 | Fotoserie wisselt alleen door te vegen | Met tegenhanger |
| LIND-2.1.1-3bcc | 2.1.1 | Vakje voor een kopie van het bericht werkt alleen met de muis | Met tegenhanger |
| LIND-2.1.1-08a2 | 2.1.1 | Naar boven werkt alleen met de muis | Met tegenhanger |
| LIND-2.1.1-2bc7 | 2.1.1 | Knoppen Ja en Nee reageren niet op het toetsenbord | Terecht |
| LIND-2.1.2-f5c5 | 2.1.2 | Toetsenbord zit vast in het chatvenster | Met tegenhanger |
| LIND-2.1.4-45db | 2.1.4 | Letters c en z starten functies op elke pagina | Met tegenhanger |
| LIND-2.1.4-5885 | 2.1.4 | Videospeler reageert op m en k waar de focus ook in de speler staat | Oneens: Discutabel / Onterecht |
| LIND-2.2.1-f914 | 2.2.1 | Contactformulier stuurt na tien minuten weg zonder verlengen | Met tegenhanger |
| LIND-2.2.2-facb | 2.2.2 | Blok Uitgelicht wisselt vanzelf zonder pauzeknop | Met tegenhanger |
| LIND-2.2.2-46ea | 2.2.2 | Aftelklok ververst elke seconde zonder bediening | Discutabel |
| LIND-2.4.1-1ce6 | 2.4.1 | Skiplink "Direct naar de inhoud" verwijst naar een doel dat niet bestaat | Met tegenhanger |
| LIND-2.4.2-acbc | 2.4.2 | Titel van de startpagina bevat resten van een sjabloon | Met tegenhanger |
| LIND-2.4.2-bdfb | 2.4.2 | Titel noemt alleen de naam van de site | Met tegenhanger |
| LIND-2.4.3-9147 | 2.4.3 | Velden van het contactformulier in een andere volgorde dan op het scherm | Met tegenhanger |
| LIND-2.4.3-e622 | 2.4.3 | Knoppen van de cookiemelding komen als laatste aan de beurt | Met tegenhanger |
| LIND-2.4.3-2683 | 2.4.3 | Focus gaat niet naar het productvenster | Met tegenhanger |
| LIND-2.4.3-504f | 2.4.3 | Menu op een smal scherm komt pas na de hele pagina | Met tegenhanger |
| LIND-2.4.4-9d17 | 2.4.4 | Pictogramlinks naar sociale media zonder naam | Met tegenhanger |
| LIND-2.4.4-860a | 2.4.4 | Link Klik hier zonder uitleg in dezelfde alinea | Met tegenhanger |
| LIND-2.4.6-8ef1 | 2.4.6 | Twee koppen "Informatie" boven verschillende onderdelen | Met tegenhanger |
| LIND-2.4.7-0111 | 2.4.7 | Links in het hoofdmenu tonen geen focus | Met tegenhanger |
| LIND-2.4.7-9b42 | 2.4.7 | Links in het menu op een smal scherm tonen geen focus | Met tegenhanger |
| LIND-2.4.7-f2b0 | 2.4.7 | De link Openingstijden in de voettekst gooit de focus weg | Met tegenhanger |
| LIND-2.4.11-f5a4 | 2.4.11 | Cookiemelding bedekt elementen met focus helemaal | Met tegenhanger |
| LIND-2.5.1-7a69 | 2.5.1 | Fotoserie werkt alleen met vegen | Met tegenhanger |
| LIND-2.5.2-b13b | 2.5.2 | Knoppen Ja en Nee reageren al bij indrukken | Met tegenhanger |
| LIND-2.5.3-9f4d | 2.5.3 | Zoekknop heet niet zoals er op staat | Met tegenhanger |
| LIND-2.5.7-526c | 2.5.7 | Prijsschuif werkt alleen met slepen | Met tegenhanger |
| LIND-2.5.8-ff88 | 2.5.8 | Paginanummers onder het nieuwsoverzicht te klein en te dicht op elkaar | Met tegenhanger |
| LIND-3.1.1-01fd | 3.1.1 | Foutpagina geeft geen taal op in de code | Met tegenhanger |
| LIND-3.1.1-6f14 | 3.1.1 | Nieuwsbericht over de fietsenstalling geeft geen taal op in de code | Met tegenhanger |
| LIND-3.1.2-ad88 | 3.1.2 | Engels citaat zonder taalaanduiding | Met tegenhanger |
| LIND-3.2.1-075c | 3.2.1 | Link Openingstijden in de voettekst haalt de focus weg | Met tegenhanger |
| LIND-3.2.2-cfa6 | 3.2.2 | Keuzelijst Uw wijk laadt meteen een nieuwe pagina | Met tegenhanger |
| LIND-3.2.3-04f9 | 3.2.3 | Hoofdmenu heeft op de contactpagina een andere volgorde | Met tegenhanger |
| LIND-3.2.3-d291 | 3.2.3 | Hulplinks staan op de nieuwspagina's boven het hoofdmenu | Met tegenhanger |
| LIND-3.2.4-ecdc | 3.2.4 | Zoekknop heet op de foutpagina anders dan op de zoekpagina | Met tegenhanger |
| LIND-3.2.6-abb3 | 3.2.6 | Telefoonnummer en contactlink staan op nieuwspagina's in de kop | Met tegenhanger |
| LIND-3.2.6-2f1b | 3.2.6 | Link Contact staat op de contactpagina vooraan in het hoofdmenu | Met tegenhanger |
| LIND-3.3.1-3956 | 3.3.1 | Fout in het contactformulier alleen met een rode rand aangegeven | Met tegenhanger |
| LIND-3.3.2-b94c | 3.3.2 | E-mailadres heeft alleen een voorbeeldtekst en is verplicht zonder dat dat er staat | Met tegenhanger |
| LIND-3.3.2-4e42 | 3.3.2 | Telefoonnummer heeft alleen een voorbeeldtekst | Met tegenhanger |
| LIND-3.3.2-18f3 | 3.3.2 | Datumveld eist een schrijfwijze die nergens staat | Met tegenhanger |
| LIND-3.3.3-85d4 | 3.3.3 | Fout in het contactformulier alleen met een rode rand aangeduid | Met tegenhanger |
| LIND-3.3.3-19b5 | 3.3.3 | Foutmelding bij de datum zegt niet welke vorm goed is | Met tegenhanger |
| LIND-3.3.4-9ddf | 3.3.4 | Aanvraag parkeervergunning gaat zonder controle of overzicht direct door | Met tegenhanger |
| LIND-3.3.7-914b | 3.3.7 | Adres voor de rekening moet opnieuw worden ingetypt | Met tegenhanger |
| LIND-3.3.8-843c | 3.3.8 | Plakken in het wachtwoordveld is geblokkeerd | Met tegenhanger |
| LIND-3.3.8-d249 | 3.3.8 | Inloggen vraagt losse letters van een geheim woord | Met tegenhanger |
| LIND-4.1.2-4b02 | 4.1.2 | Pictogramlinks in de voettekst hebben geen naam | Met tegenhanger |
| LIND-4.1.2-c8b1 | 4.1.2 | Menuknop op een smal scherm heeft geen naam | Met tegenhanger |
| LIND-4.1.2-25b3 | 4.1.2 | Menuknop meldt niet of het menu open is | Met tegenhanger |
| LIND-4.1.2-d147 | 4.1.2 | Selectievakje voor een kopie is verborgen voor hulpsoftware | Met tegenhanger |
| LIND-4.1.2-de61 | 4.1.2 | Tabbladen hebben geen rol en geen gekozen toestand | Met tegenhanger |
| LIND-4.1.2-bc00 | 4.1.2 | Productkaarten openen een venster maar zijn geen bedieningselement | Met tegenhanger |
| LIND-4.1.2-c4be | 4.1.2 | Productvenster heeft geen rol en geen naam | Met tegenhanger |
| LIND-4.1.2-3903 | 4.1.2 | Sluitkruisen zijn geen knop | Met tegenhanger |
| LIND-4.1.2-e33d | 4.1.2 | Nieuwskaarten zijn klikbaar maar geen link | Met tegenhanger |
| LIND-4.1.2-454c | 4.1.2 | Videovenster heeft geen naam | Met tegenhanger |
| LIND-4.1.2-4cf1 | 4.1.2 | Prijsschuif heeft geen rol, naam of waarde | Met tegenhanger |
| LIND-4.1.2-6a9a | 4.1.2 | Vraagknoppen melden niet of het antwoord open is | Met tegenhanger |
| LIND-4.1.2-6f22 | 4.1.2 | Link Naar boven heeft geen betrouwbare rol | Met tegenhanger |
| LIND-4.1.3-8c06 | 4.1.3 | Aantal gevonden producten wordt niet voorgelezen | Met tegenhanger |
| LIND-4.1.3-f7ba | 4.1.3 | Bedankje na Ja of Nee wordt niet voorgelezen | Met tegenhanger |
| LIND-4.1.3-8c59 | 4.1.3 | Foutmelding bij de datum wordt niet voorgelezen | Oneens: Discutabel / Terecht |
| LIND-4.1.3-9498 | 4.1.3 | Nieuwe chatberichten worden niet voorgelezen | Met tegenhanger |
