# Vergelijking van varianten

Sleutel: reference-lindewaard.json. 9 criteria: 1.1.1, 1.3.1, 1.4.3, 1.4.11, 2.1.1, 2.4.3, 3.1.2, 3.3.1, 4.1.2.

| Run | Kant | Variant | Code | Veegronde |
|---|---|---|---|---|
| N1 opus-1 | nulmeting | opus | loep 0.11.0, `f63abea` | lindewaard-bron, loep 0.11.0 |
| N2 opus-2 | nulmeting | opus | loep 0.11.0, `f63abea` | lindewaard-bron, loep 0.11.0 |
| N3 opus-3 | nulmeting | opus | loep 0.11.0, `f63abea` | lindewaard-bron, loep 0.11.0 |
| V1 sonnet-1 | variant | sonnet | loep 0.11.0, `f63abea` | lindewaard-bron, loep 0.11.0 |
| V2 sonnet-2 | variant | sonnet | loep 0.11.0, `f63abea` | lindewaard-bron, loep 0.11.0 |
| V3 sonnet-3 | variant | sonnet | loep 0.11.0, `f63abea` | lindewaard-bron, loep 0.11.0 |

## Niet slechter

**Niet slechter: nee.**

| Toets | Nulmeting | Variant | Verschil (95%-interval) | Marge | Binnen de marge |
|---|---|---|---|---|---|
| Gevonden gebreken uit de sleutel, per run (29 gebreken) | 98,9% (96,6% tot 100,0%) | 97,7% (93,1% tot 100,0%) | -1,1 (-6,9 tot +3,4) procentpunt | ondergrens boven -5,0 | nee |
| Onterecht volgens beide, per run (9 criteria) | 0,0 (0,0 tot 0,0) | 0,0 (0,0 tot 0,0) | 0,0 (0,0 tot 0,0) | bovengrens onder +1,0 | ja |
| Open punten per run (ter informatie) | 5,0 (2,3 tot 7,7) | 6,0 (3,3 tot 9,0) | +1,0 (-2,0 tot +3,7) | geen | - |

Het verschil is variant min nulmeting. Het interval komt uit 10.000 trekkingen met teruglegging over de gebreken (bij meldingen en open punten over de criteria), elke trekking met dezelfde gebreken of criteria voor beide kanten, met seed 20261020. "Onterecht volgens beide" is een bevinding die beide indelingen van `compare --findings` onterecht noemen. Meldingen zonder tegenhanger die ze terecht of discutabel noemen, of waarover ze het oneens zijn, tellen niet mee; ze staan onder "Meldingen zonder tegenhanger". De marges staan vast voordat de variant wordt gemeten; zie validatie/verbruik/README.md.

## Overeenstemming tussen runs

Per criterium is een uitkomst "voldoet" (ook niet van toepassing), "voldoet niet" of "open" (kan niet bepalen, niet beoordeeld). Fleiss' kappa is 1 als alle runs gelijk zijn en rond 0 als ze niet meer overeenstemmen dan toeval.

| Kant | Runs | Zelfde uitkomst in alle runs | Fleiss' kappa |
|---|---|---|---|
| nulmeting | 3 | 9 van 9 | - |
| variant | 3 | 9 van 9 | - |

## Per criterium

Spreiding: het aandeel paren runs waarin het criterium een andere uitkomst kreeg, binnen de nulmeting (N), binnen de variant (V) en tussen een run van elk (N tegen V). Ligt N tegen V niet boven N en V, dan verschilt de variant niet meer dan de runs onderling.

| Criterium | Sleutel | N1 | N2 | N3 | V1 | V2 | V3 | N | V | N tegen V |
|---|---|---|---|---|---|---|---|---|---|---|
| 1.1.1 Niet-tekstuele content | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | 0% | 0% | 0% |
| 1.3.1 Info en relaties | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | 0% | 0% | 0% |
| 1.4.3 Contrast (minimum) | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | 0% | 0% | 0% |
| 1.4.11 Contrast van niet-tekstuele content | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | 0% | 0% | 0% |
| 2.1.1 Toetsenbord | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | 0% | 0% | 0% |
| 2.4.3 Focus volgorde | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | 0% | 0% | 0% |
| 3.1.2 Taal van onderdelen | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | 0% | 0% | 0% |
| 3.3.1 Foutidentificatie | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | 0% | 0% | 0% |
| 4.1.2 Naam, rol, waarde | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | 0% | 0% | 0% |

Bevindingen per criterium in de evaluatie:

| Criterium | N1 | N2 | N3 | V1 | V2 | V3 |
|---|---|---|---|---|---|---|
| 1.1.1 | 6 | 6 | 6 | 5 | 6 | 4 |
| 1.3.1 | 8 | 8 | 7 | 9 | 6 | 9 |
| 1.4.3 | 4 | 4 | 3 | 4 | 3 | 3 |
| 1.4.11 | 1 | 1 | 1 | 1 | 1 | 1 |
| 2.1.1 | 6 | 4 | 7 | 5 | 6 | 5 |
| 2.4.3 | 4 | 4 | 4 | 5 | 4 | 4 |
| 3.1.2 | 1 | 1 | 1 | 1 | 1 | 1 |
| 3.3.1 | 1 | 1 | 2 | 1 | 2 | 1 |
| 4.1.2 | 16 | 14 | 14 | 13 | 14 | 14 |

## Per gebrek uit de sleutel

"gevonden" telt alleen waar beide indelingen van `compare --findings` het eens zijn; "-" is een run zonder geldige indeling.

| Gebrek | N1 | N2 | N3 | V1 | V2 | V3 | Nulmeting | Variant |
|---|---|---|---|---|---|---|---|---|
| 1.1.1-artikelfoto |gevonden | gevonden | gevonden | gevonden | gevonden | gevonden | 3 van 3 | 3 van 3 |
| 1.1.1-bestandsnaam |gevonden | gevonden | gevonden | gevonden | gevonden | gevonden | 3 van 3 | 3 van 3 |
| 1.1.1-logo-melding |gevonden | gevonden | gevonden | gevonden | gevonden | gevonden | 3 van 3 | 3 van 3 |
| 1.1.1-tarieven |gevonden | gevonden | gevonden | gevonden | gevonden | gevonden | 3 van 3 | 3 van 3 |
| 1.3.1-keuzegroep |gevonden | gevonden | gevonden | gevonden | gevonden | gevonden | 3 van 3 | 3 van 3 |
| 1.3.1-lijst-als-alinea |gevonden | gevonden | gevonden | gevonden | gevonden | gevonden | 3 van 3 | 3 van 3 |
| 1.3.1-tabelkoppen |gevonden | gevonden | gevonden | gevonden | gevonden | gevonden | 3 van 3 | 3 van 3 |
| 1.3.1-tussenkop-uitklapper |gevonden | gevonden | gevonden | gevonden | gevonden | gevonden | 3 van 3 | 3 van 3 |
| 1.3.1-vette-tussenkop |gevonden | gevonden | gevonden | gevonden | gevonden | gevonden | 3 van 3 | 3 van 3 |
| 1.3.1-voetkop |gevonden | gevonden | gevonden | gevonden | gevonden | gevonden | 3 van 3 | 3 van 3 |
| 1.4.3-datum |gevonden | gevonden | gevonden | gevonden | gevonden | gevonden | 3 van 3 | 3 van 3 |
| 1.4.3-menu-aanwijzen |gevonden | gevonden | gevonden | gevonden | gevonden | gevonden | 3 van 3 | 3 van 3 |
| 1.4.3-tekst-op-foto |gevonden | gevonden | gevonden | gevonden | gevonden | gevonden | 3 van 3 | 3 van 3 |
| 1.4.11-veldrand |gevonden | gevonden | gevonden | gevonden | gevonden | gevonden | 3 van 3 | 3 van 3 |
| 2.1.1-chat-sluit |gevonden | gevonden | gevonden | gevonden | gevonden | gevonden | 3 van 3 | 3 van 3 |
| 2.1.1-naar-boven |gevonden | gevonden | gevonden | gevonden | gevonden | gevonden | 3 van 3 | 3 van 3 |
| 2.1.1-nieuwskaart |gevonden | gevonden | gevonden | gevonden | gevonden | gevonden | 3 van 3 | 3 van 3 |
| 2.1.1-productkaart |gevonden | gevonden | gevonden | gevonden | gevonden | gevonden | 3 van 3 | 3 van 3 |
| 2.1.1-vinkje |gevonden | gevonden | gevonden | gevonden | gevonden | gevonden | 3 van 3 | 3 van 3 |
| 2.4.3-mobiel-menu |gevonden | gevonden | gevonden | gevonden | gevonden | gevonden | 3 van 3 | 3 van 3 |
| 2.4.3-tabindex |gevonden | gevonden | gevonden | gevonden | gevonden | gevonden | 3 van 3 | 3 van 3 |
| 3.1.2-engels |gevonden | gevonden | gevonden | gevonden | gevonden | gevonden | 3 van 3 | 3 van 3 |
| 3.3.1-rode-rand |gevonden | gevonden | gevonden | gevonden | gevonden | gevonden | 3 van 3 | 3 van 3 |
| 4.1.2-kadertitel |gevonden | gevonden | gevonden | gevonden | gevonden | gevonden | 3 van 3 | 3 van 3 |
| 4.1.2-menuknop |gevonden | gevonden | gevonden | gevonden | gevonden | gevonden | 3 van 3 | 3 van 3 |
| 4.1.2-rol-logo |gevonden | gemist-bewijs-beoordeling | gevonden | gevonden | gevonden | gevonden | 2 van 3 | 3 van 3 |
| 4.1.2-tabs |gevonden | gevonden | gevonden | gevonden | gevonden | gevonden | 3 van 3 | 3 van 3 |
| 4.1.2-uitklapper |gevonden | gevonden | gevonden | gevonden | gevonden | gevonden | 3 van 3 | 3 van 3 |
| 4.1.2-venster |gevonden | gevonden | gevonden | gevonden | oneens | deels | 3 van 3 | 1 van 3 |

## Meldingen zonder tegenhanger

Bevindingen van een run die niet beide indelingen van `compare --findings` bij een gebrek uit de sleutel zetten. Alleen "onterecht volgens beide" telt mee in de toets; een melding die terecht is, kan een echt gebrek zijn dat niet in de sleutel staat. Waar de indelingen verschillen, staan beide klassen. "-" is een run zonder geldige indeling.

| Klasse | N1 | N2 | N3 | V1 | V2 | V3 |
|---|---|---|---|---|---|---|
| terecht volgens beide | 1 | 0 | 2 | 2 | 2 | 1 |
| discutabel volgens beide | 3 | 2 | 1 | 2 | 1 | 2 |
| onterecht volgens beide | 0 | 0 | 0 | 0 | 0 | 0 |
| oneens: tegenhanger / terecht | 1 | 0 | 1 | 1 | 0 | 0 |
| oneens: terecht / discutabel | 0 | 0 | 0 | 0 | 1 | 1 |
| samen | 5 | 2 | 4 | 5 | 4 | 4 |

## Open punten per soort

Wat nog open staat in het oordeel dat telt, over de criteria hierboven.

| Soort | N1 | N2 | N3 | V1 | V2 | V3 |
|---|---|---|---|---|---|---|
| proef werkte niet | 1 | 1 | 2 | 4 | 2 | 2 |
| mens nodig | 2 | 2 | 0 | 2 | 2 | 1 |
| versturen niet toegestaan | 0 | 3 | 4 | 1 | 1 | 2 |
| veegronde mist | 0 | 0 | 0 | 1 | 0 | 0 |
| samen | 3 | 6 | 6 | 8 | 5 | 5 |

## Verbruik per rol

Sessies, commando's en tijd uit de run. Tokens, beurten en kosten alleen uit een verbruiksbestand (--usage, te maken met `loep usage`), want de run telt die niet. Beoordelaars, verifieerders en de afmaakronde tellen alleen over de criteria hierboven; rondgangen en de stand-agent werken voor de hele run.

| Run | Rol | Agents | Commando's | Tijd in sessies | Invoer | Naar de cache | Uit de cache | Uitvoer | Beurten | Kosten |
|---|---|---|---|---|---|---|---|---|---|---|
| N1 | rondgang | 15 | 927 | 83 min | 1.664 | 1,28 M | 63,30 M | 82.997 | 832 | 20,72 dollar |
| N1 | beoordelaar | 9 | 620 | 54 min | 1.008 | 1,57 M | 76,61 M | 89.963 | 504 | 24,96 dollar |
| N1 | verifieerder | 9 | 516 | 45 min | 812 | 1,05 M | 45,71 M | 63.830 | 406 | 15,65 dollar |
| N1 | stand | 4 | - | - | 16 | 0,13 M | 0,20 M | 1.448 | 8 | 0,02 dollar |
| N2 | rondgang | 15 | 946 | 87 min | 1.718 | 1,29 M | 65,74 M | 66.241 | 859 | 20,92 dollar |
| N2 | beoordelaar | 9 | 725 | 58 min | 1.162 | 1,63 M | 92,40 M | 81.597 | 581 | 28,27 dollar |
| N2 | verifieerder | 9 | 468 | 44 min | 778 | 1,04 M | 42,89 M | 63.071 | 389 | 15,06 dollar |
| N2 | stand | 4 | - | - | 16 | 0,09 M | 0,24 M | 1.625 | 8 | 0,01 dollar |
| N3 | rondgang | 15 | 942 | 83 min | 1.644 | 1,28 M | 62,56 M | 67.863 | 822 | 20,26 dollar |
| N3 | beoordelaar | 9 | 705 | 61 min | 1.094 | 1,58 M | 84,94 M | 51.387 | 547 | 25,94 dollar |
| N3 | verifieerder | 9 | 504 | 40 min | 734 | 1,01 M | 38,91 M | 57.913 | 367 | 13,97 dollar |
| N3 | stand | 4 | - | - | 16 | 0,13 M | 0,20 M | 1.169 | 8 | 0,02 dollar |
| V1 | rondgang | 15 | 1.055 | 49 min | 984 | 1,16 M | 35,32 M | 21.089 | 492 | 6,64 dollar |
| V1 | beoordelaar | 9 | 642 | 107 min | 946 | 1,42 M | 66,26 M | 49.804 | 473 | 10,67 dollar |
| V1 | verifieerder | 9 | 431 | 57 min | 624 | 0,96 M | 35,16 M | 20.419 | 312 | 6,12 dollar |
| V1 | stand | 4 | - | - | 16 | 0,15 M | 0,18 M | 1.538 | 8 | 0,02 dollar |
| V2 | rondgang | 15 | 965 | 44 min | 894 | 1,09 M | 31,14 M | 15.302 | 447 | 5,99 dollar |
| V2 | beoordelaar | 9 | 721 | 53 min | 950 | 1,44 M | 67,76 M | 22.412 | 475 | 10,60 dollar |
| V2 | verifieerder | 9 | 350 | 81 min | 586 | 0,88 M | 29,55 M | 18.736 | 293 | 5,34 dollar |
| V2 | stand | 4 | - | - | 18 | 0,13 M | 0,24 M | 1.516 | 9 | 0,02 dollar |
| V3 | rondgang | 15 | 1.021 | 49 min | 932 | 1,14 M | 33,12 M | 26.018 | 466 | 6,43 dollar |
| V3 | beoordelaar | 9 | 789 | 61 min | 1.050 | 1,47 M | 76,64 M | 32.762 | 525 | 11,67 dollar |
| V3 | verifieerder | 9 | 433 | 28 min | 586 | 0,88 M | 29,53 M | 11.366 | 293 | 5,28 dollar |
| V3 | stand | 4 | - | - | 22 | 0,09 M | 0,36 M | 1.872 | 11 | 0,02 dollar |
