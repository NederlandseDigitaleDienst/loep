# Vergelijking van varianten

Sleutel: reference-lindewaard.json. 56 criteria: 1.1.1, 1.2.1, 1.2.2, 1.2.3, 1.2.4, 1.2.5, 1.3.1, 1.3.2, 1.3.3, 1.3.4, 1.3.5, 1.4.1, 1.4.2, 1.4.3, 1.4.4, 1.4.5, 1.4.10, 1.4.11, 1.4.12, 1.4.13, 2.1.1, 2.1.2, 2.1.4, 2.2.1, 2.2.2, 2.3.1, 2.4.1, 2.4.2, 2.4.3, 2.4.4, 2.4.5, 2.4.6, 2.4.7, 2.4.11, 2.5.1, 2.5.2, 2.5.3, 2.5.4, 2.5.7, 2.5.8, 3.1.1, 3.1.2, 3.2.1, 3.2.2, 3.2.3, 3.2.4, 3.2.6, 3.3.1, 3.3.2, 3.3.3, 3.3.4, 3.3.7, 3.3.8, 4.1.1, 4.1.2, 4.1.3.

| Run | Kant | Variant | Code | Veegronde |
|---|---|---|---|---|
| N1 l1 | nulmeting | l1 | loep 0.34.0, `81390b3` | bevroren-defect, loep 0.34.0 |
| V1 l2 | variant | l2 | loep 0.34.0, `81390b3` | bevroren-defect, loep 0.34.0 |

## Niet slechter

**Niet slechter: ja.**

| Toets | Nulmeting | Variant | Verschil (95%-interval) | Marge | Binnen de marge |
|---|---|---|---|---|---|
| Gevonden gebreken uit de sleutel, per run (79 gebreken) | 100,0% (100,0% tot 100,0%) | 100,0% (100,0% tot 100,0%) | 0,0 (0,0 tot 0,0) procentpunt | ondergrens boven -5,0 | ja |
| Onterecht volgens beide, per run (56 criteria) | 0,0 (0,0 tot 0,0) | 0,0 (0,0 tot 0,0) | 0,0 (0,0 tot 0,0) | bovengrens onder +1,0 | ja |
| Open punten per run (ter informatie) | 3,0 (0,0 tot 7,0) | 6,0 (1,0 tot 13,0) | +3,0 (-1,0 tot +9,0) | geen | - |

Het verschil is variant min nulmeting. Het interval komt uit 10.000 trekkingen met teruglegging over de gebreken (bij meldingen en open punten over de criteria), elke trekking met dezelfde gebreken of criteria voor beide kanten, met seed 20261020. "Onterecht volgens beide" is een bevinding die beide indelingen van `compare --findings` onterecht noemen. Meldingen zonder tegenhanger die ze terecht of discutabel noemen, of waarover ze het oneens zijn, tellen niet mee; ze staan onder "Meldingen zonder tegenhanger". De marges staan vast voordat de variant wordt gemeten; zie validatie/verbruik/README.md.

## Overeenstemming tussen runs

Per criterium is een uitkomst "voldoet" (ook niet van toepassing), "voldoet niet" of "open" (kan niet bepalen, niet beoordeeld). Fleiss' kappa is 1 als alle runs gelijk zijn en rond 0 als ze niet meer overeenstemmen dan toeval.

| Kant | Runs | Zelfde uitkomst in alle runs | Fleiss' kappa |
|---|---|---|---|
| nulmeting | 1 | 56 van 56 | - |
| variant | 1 | 56 van 56 | - |

## Per criterium

Spreiding: het aandeel paren runs waarin het criterium een andere uitkomst kreeg, binnen de nulmeting (N), binnen de variant (V) en tussen een run van elk (N tegen V). Ligt N tegen V niet boven N en V, dan verschilt de variant niet meer dan de runs onderling.

| Criterium | Sleutel | N1 | V1 | N | V | N tegen V |
|---|---|---|---|---|---|---|
| 1.1.1 Niet-tekstuele content | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 1.2.1 Louter-geluid en louter-videobeeld (vooraf opgenomen) | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 1.2.2 Ondertitels voor doven en slechthorenden (vooraf opgenomen) | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 1.2.3 Audiodescriptie of media-alternatief (vooraf opgenomen) | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 1.2.4 Ondertitels voor doven en slechthorenden (live) | geen gebrek | n.v.t. | n.v.t. | - | - | 0% |
| 1.2.5 Audiodescriptie (vooraf opgenomen) | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 1.3.1 Info en relaties | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 1.3.2 Betekenisvolle volgorde | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 1.3.3 Zintuiglijke eigenschappen | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 1.3.4 Weergavestand | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 1.3.5 Identificeer het doel van de input | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 1.4.1 Gebruik van kleur | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 1.4.2 Geluidsbediening | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 1.4.3 Contrast (minimum) | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 1.4.4 Herschalen van tekst | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 1.4.5 Afbeeldingen van tekst | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 1.4.10 Reflow | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 1.4.11 Contrast van niet-tekstuele content | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 1.4.12 Tekstafstand | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 1.4.13 Content bij hover of focus | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 2.1.1 Toetsenbord | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 2.1.2 Geen toetsenbordval | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 2.1.4 Enkel teken sneltoetsen | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 2.2.1 Timing aanpasbaar | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 2.2.2 Pauzeren, stoppen, verbergen | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 2.3.1 Drie flitsen of beneden drempelwaarde | geen gebrek | voldoet | voldoet | - | - | 0% |
| 2.4.1 Blokken omzeilen | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 2.4.2 Paginatitel | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 2.4.3 Focus volgorde | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 2.4.4 Linkdoel (in context) | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 2.4.5 Meerdere manieren | geen gebrek | voldoet | voldoet | - | - | 0% |
| 2.4.6 Koppen en labels | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 2.4.7 Focus zichtbaar | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 2.4.11 Focus niet bedekt (minimum) | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 2.5.1 Aanwijzergebaren | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 2.5.2 Aanwijzerannulering | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 2.5.3 Label in naam | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 2.5.4 Bewegingsactivering | geen gebrek | n.v.t. | n.v.t. | - | - | 0% |
| 2.5.7 Sleepbewegingen | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 2.5.8 Grootte van het aanwijsgebied (minimum) | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 3.1.1 Taal van de pagina | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 3.1.2 Taal van onderdelen | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 3.2.1 Bij focus | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 3.2.2 Bij input | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 3.2.3 Consistente navigatie | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 3.2.4 Consistente identificatie | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 3.2.6 Consistente hulp | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 3.3.1 Foutidentificatie | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 3.3.2 Labels of instructies | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 3.3.3 Foutsuggestie | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 3.3.4 Foutpreventie (wettelijk, financieel, gegevens) | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 3.3.7 Overbodige invoer | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 3.3.8 Toegankelijke authenticatie (minimum) | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 4.1.1 Parsen | geen gebrek | voldoet | voldoet | - | - | 0% |
| 4.1.2 Naam, rol, waarde | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |
| 4.1.3 Statusberichten | voldoet niet | voldoet niet | voldoet niet | - | - | 0% |

Bevindingen per criterium in de evaluatie:

| Criterium | N1 | V1 |
|---|---|---|
| 1.1.1 | 5 | 5 |
| 1.2.1 | 2 | 2 |
| 1.2.2 | 1 | 1 |
| 1.2.3 | 1 | 1 |
| 1.2.4 | 0 | 0 |
| 1.2.5 | 1 | 1 |
| 1.3.1 | 9 | 8 |
| 1.3.2 | 2 | 2 |
| 1.3.3 | 2 | 2 |
| 1.3.4 | 1 | 1 |
| 1.3.5 | 6 | 6 |
| 1.4.1 | 2 | 2 |
| 1.4.2 | 1 | 1 |
| 1.4.3 | 4 | 4 |
| 1.4.4 | 2 | 2 |
| 1.4.5 | 2 | 2 |
| 1.4.10 | 3 | 2 |
| 1.4.11 | 1 | 1 |
| 1.4.12 | 1 | 1 |
| 1.4.13 | 2 | 2 |
| 2.1.1 | 8 | 8 |
| 2.1.2 | 1 | 1 |
| 2.1.4 | 1 | 2 |
| 2.2.1 | 1 | 1 |
| 2.2.2 | 2 | 2 |
| 2.3.1 | 0 | 0 |
| 2.4.1 | 1 | 1 |
| 2.4.2 | 2 | 2 |
| 2.4.3 | 4 | 4 |
| 2.4.4 | 2 | 2 |
| 2.4.5 | 0 | 0 |
| 2.4.6 | 1 | 1 |
| 2.4.7 | 2 | 2 |
| 2.4.11 | 1 | 1 |
| 2.5.1 | 1 | 1 |
| 2.5.2 | 1 | 1 |
| 2.5.3 | 1 | 1 |
| 2.5.4 | 0 | 0 |
| 2.5.7 | 2 | 1 |
| 2.5.8 | 1 | 1 |
| 3.1.1 | 1 | 1 |
| 3.1.2 | 1 | 1 |
| 3.2.1 | 1 | 1 |
| 3.2.2 | 1 | 1 |
| 3.2.3 | 1 | 2 |
| 3.2.4 | 1 | 1 |
| 3.2.6 | 2 | 2 |
| 3.3.1 | 1 | 1 |
| 3.3.2 | 2 | 2 |
| 3.3.3 | 3 | 2 |
| 3.3.4 | 1 | 1 |
| 3.3.7 | 1 | 1 |
| 3.3.8 | 2 | 2 |
| 4.1.1 | 0 | 0 |
| 4.1.2 | 14 | 14 |
| 4.1.3 | 4 | 4 |

## Per gebrek uit de sleutel

"gevonden" telt alleen waar beide indelingen van `compare --findings` het eens zijn; "-" is een run zonder geldige indeling.

| Gebrek | N1 | V1 | Nulmeting | Variant |
|---|---|---|---|---|
| 1.1.1-artikelfoto |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 1.1.1-bestandsnaam |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 1.1.1-logo-melding |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 1.1.1-tarieven |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 1.2.1-gesprek |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 1.2.2-ondertitels |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 1.2.3-beschrijving |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 1.2.5-audiodescriptie |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 1.3.1-keuzegroep |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 1.3.1-lijst-als-alinea |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 1.3.1-tabelkoppen |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 1.3.1-tussenkop-uitklapper |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 1.3.1-vette-tussenkop |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 1.3.1-voetkop |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 1.3.2-kaart-omgekeerd |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 1.3.2-zoekvolgorde |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 1.3.3-ronde-knop |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 1.3.4-draai |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 1.3.5-autocomplete |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 1.4.1-tekstlink |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 1.4.1-verplicht |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 1.4.2-melodie |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 1.4.3-datum |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 1.4.3-menu-aanwijzen |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 1.4.3-tekst-op-foto |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 1.4.4-inleiding |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 1.4.4-zoom-uit |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 1.4.5-zomerfeest |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 1.4.10-rooster |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 1.4.10-weigerknop |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 1.4.11-veldrand |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 1.4.12-tegel |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 1.4.13-uitleg |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 2.1.1-chat-sluit |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 2.1.1-naar-boven |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 2.1.1-nieuwskaart |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 2.1.1-productkaart |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 2.1.1-vinkje |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 2.1.2-chat |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 2.1.4-sneltoets |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 2.2.1-tijdslimiet |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 2.2.2-uitgelicht |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 2.4.1-skiplink |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 2.4.2-sjabloonrest |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 2.4.2-zelfde-titel |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 2.4.3-mobiel-menu |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 2.4.3-tabindex |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 2.4.4-klik-hier |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 2.4.4-sociaal |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 2.4.6-informatie |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 2.4.7-menu |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 2.4.11-melding |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 2.5.1-galerij |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 2.5.2-feedback |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 2.5.3-zoekknop |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 2.5.7-schuif |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 2.5.8-paginering |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 3.1.1-taal |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 3.1.2-engels |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 3.2.1-voetlink |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 3.2.2-wijk |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 3.2.3-menuvolgorde |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 3.2.4-zoekknop |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 3.2.6-hulp |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 3.3.1-rode-rand |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 3.3.2-plaatshouder |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 3.3.3-datum |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 3.3.4-controle |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 3.3.7-adres |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 3.3.8-wachtwoord |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 4.1.2-kadertitel |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 4.1.2-menuknop |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 4.1.2-rol-logo |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 4.1.2-tabs |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 4.1.2-uitklapper |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 4.1.2-venster |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 4.1.3-aantal |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 4.1.3-bedankt |gevonden | gevonden | 1 van 1 | 1 van 1 |
| 4.1.3-chat |gevonden | gevonden | 1 van 1 | 1 van 1 |

## Meldingen zonder tegenhanger

Bevindingen van een run die niet beide indelingen van `compare --findings` bij een gebrek uit de sleutel zetten. Alleen "onterecht volgens beide" telt mee in de toets; een melding die terecht is, kan een echt gebrek zijn dat niet in de sleutel staat. Waar de indelingen verschillen, staan beide klassen. "-" is een run zonder geldige indeling.

| Klasse | N1 | V1 |
|---|---|---|
| terecht volgens beide | 5 | 3 |
| discutabel volgens beide | 4 | 4 |
| onterecht volgens beide | 0 | 0 |
| samen | 9 | 7 |

## Open punten per soort

Wat nog open staat in het oordeel dat telt, over de criteria hierboven.

| Soort | N1 | V1 |
|---|---|---|
| mens nodig | 3 | 6 |
| samen | 3 | 6 |

## Verbruik per rol

Sessies, commando's en tijd uit de run. Tokens, beurten en kosten alleen uit een verbruiksbestand (--usage, te maken met `loep usage`), want de run telt die niet. Beoordelaars, verifieerders en de afmaakronde tellen alleen over de criteria hierboven; rondgangen en de stand-agent werken voor de hele run.

| Run | Rol | Agents | Commando's | Tijd in sessies | Invoer | Naar de cache | Uit de cache | Uitvoer | Beurten | Kosten |
|---|---|---|---|---|---|---|---|---|---|---|
| N1 | rondgang | 13 | 711 | 55 min | - | - | - | - | - | - |
| N1 | beoordelaar | 56 | 1.913 | 159 min | - | - | - | - | - | - |
| N1 | verifieerder | 56 | 1.110 | 117 min | - | - | - | - | - | - |
| V1 | rondgang | 13 | 737 | 59 min | - | - | - | - | - | - |
| V1 | beoordelaar | 56 | 1.855 | 177 min | - | - | - | - | - | - |
| V1 | verifieerder | 56 | 1.134 | 114 min | - | - | - | - | - | - |
