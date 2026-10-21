# Vergelijking van varianten

Sleutel: reference-lindewaard.json. 9 criteria: 1.1.1, 1.3.1, 1.4.3, 1.4.11, 2.1.1, 2.4.3, 3.1.2, 3.3.1, 4.1.2.

| Run | Kant | Variant | Commit |
|---|---|---|---|
| N1 n1 | nulmeting | n1 | `6ad7e5c` |
| N2 n2 | nulmeting | n2 | `6ad7e5c` |
| V1 s1 | variant | s1 | `6ad7e5c` |
| V2 s2 | variant | s2 | `6ad7e5c` |
| V3 s3 | variant | s3 | `6ad7e5c` |

Let op: alleen de 9 criteria van --criteria tellen mee; n1 heeft er 56, n2 heeft er 56, de rest telt niet mee.

## Niet slechter

**Niet slechter: nee.**

| Toets | Nulmeting | Variant | Verschil (95%-interval) | Marge | Binnen de marge |
|---|---|---|---|---|---|
| Gevonden gebreken uit de sleutel, per run (29 gebreken) | 98,3% (94,8% tot 100,0%) | 97,7% (94,3% tot 100,0%) | -0,6 (-5,2 tot +4,0) procentpunt | ondergrens boven -5,0 | nee |
| Onterechte meldingen per run (9 criteria) | 4,0 (0,0 tot 9,0) | 2,3 (0,0 tot 5,3) | -1,7 (-4,2 tot +0,3) | bovengrens onder +1,0 | ja |
| Open punten per run (ter informatie) | 1,5 (0,0 tot 3,5) | 3,3 (0,7 tot 7,3) | +1,8 (-0,2 tot +4,2) | geen | - |

Het verschil is variant min nulmeting. Het interval komt uit 10.000 trekkingen met teruglegging over de gebreken (bij meldingen en open punten over de criteria), elke trekking met dezelfde gebreken of criteria voor beide kanten, met seed 20261020. Een onterechte melding is een bevinding die niet beide indelingen van `compare --findings` bij een gebrek uit de sleutel zetten. De marges staan vast voordat de variant wordt gemeten; zie validatie/verbruik/README.md.

## Overeenstemming tussen runs

Per criterium is een uitkomst "voldoet" (ook niet van toepassing), "voldoet niet" of "open" (kan niet bepalen, niet beoordeeld). Fleiss' kappa is 1 als alle runs gelijk zijn en rond 0 als ze niet meer overeenstemmen dan toeval.

| Kant | Runs | Zelfde uitkomst in alle runs | Fleiss' kappa |
|---|---|---|---|
| nulmeting | 2 | 9 van 9 | - |
| variant | 3 | 9 van 9 | - |

## Per criterium

Spreiding: het aandeel paren runs waarin het criterium een andere uitkomst kreeg, binnen de nulmeting (N), binnen de variant (V) en tussen een run van elk (N tegen V). Ligt N tegen V niet boven N en V, dan verschilt de variant niet meer dan de runs onderling.

| Criterium | Sleutel | N1 | N2 | V1 | V2 | V3 | N | V | N tegen V |
|---|---|---|---|---|---|---|---|---|---|
| 1.1.1 Niet-tekstuele content | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | 0% | 0% | 0% |
| 1.3.1 Info en relaties | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | 0% | 0% | 0% |
| 1.4.3 Contrast (minimum) | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | 0% | 0% | 0% |
| 1.4.11 Contrast van niet-tekstuele content | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | 0% | 0% | 0% |
| 2.1.1 Toetsenbord | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | 0% | 0% | 0% |
| 2.4.3 Focus volgorde | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | 0% | 0% | 0% |
| 3.1.2 Taal van onderdelen | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | 0% | 0% | 0% |
| 3.3.1 Foutidentificatie | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | 0% | 0% | 0% |
| 4.1.2 Naam, rol, waarde | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | voldoet niet | 0% | 0% | 0% |

Bevindingen per criterium in de evaluatie:

| Criterium | N1 | N2 | V1 | V2 | V3 |
|---|---|---|---|---|---|
| 1.1.1 | 5 | 6 | 5 | 6 | 6 |
| 1.3.1 | 9 | 9 | 8 | 6 | 8 |
| 1.4.3 | 4 | 3 | 4 | 4 | 4 |
| 1.4.11 | 1 | 2 | 1 | 1 | 1 |
| 2.1.1 | 8 | 6 | 6 | 7 | 4 |
| 2.4.3 | 4 | 4 | 5 | 4 | 4 |
| 3.1.2 | 1 | 1 | 1 | 1 | 1 |
| 3.3.1 | 1 | 1 | 1 | 1 | 1 |
| 4.1.2 | 13 | 13 | 13 | 12 | 15 |

## Per gebrek uit de sleutel

"gevonden" telt alleen waar beide indelingen van `compare --findings` het eens zijn; "-" is een run zonder geldige indeling.

| Gebrek | N1 | N2 | V1 | V2 | V3 | Nulmeting | Variant |
|---|---|---|---|---|---|---|---|
| 1.1.1-artikelfoto |gevonden | gevonden | gevonden | gevonden | gevonden | 2 van 2 | 3 van 3 |
| 1.1.1-bestandsnaam |gevonden | gevonden | gevonden | gevonden | gevonden | 2 van 2 | 3 van 3 |
| 1.1.1-logo-melding |gevonden | gevonden | gevonden | gevonden | gevonden | 2 van 2 | 3 van 3 |
| 1.1.1-tarieven |gevonden | gevonden | gevonden | gevonden | gevonden | 2 van 2 | 3 van 3 |
| 1.3.1-keuzegroep |gevonden | gevonden | gevonden | gevonden | gevonden | 2 van 2 | 3 van 3 |
| 1.3.1-lijst-als-alinea |gevonden | gevonden | gevonden | gevonden | gevonden | 2 van 2 | 3 van 3 |
| 1.3.1-tabelkoppen |gevonden | gevonden | gevonden | gevonden | gevonden | 2 van 2 | 3 van 3 |
| 1.3.1-tussenkop-uitklapper |gevonden | gevonden | gemist-bewijs-dossier | gevonden | gevonden | 2 van 2 | 2 van 3 |
| 1.3.1-vette-tussenkop |gevonden | gevonden | gevonden | gevonden | gevonden | 2 van 2 | 3 van 3 |
| 1.3.1-voetkop |gevonden | gevonden | gevonden | gevonden | gevonden | 2 van 2 | 3 van 3 |
| 1.4.3-datum |gevonden | gevonden | gevonden | gevonden | gevonden | 2 van 2 | 3 van 3 |
| 1.4.3-menu-aanwijzen |gevonden | gevonden | gevonden | gevonden | gevonden | 2 van 2 | 3 van 3 |
| 1.4.3-tekst-op-foto |gevonden | gevonden | gevonden | gevonden | gevonden | 2 van 2 | 3 van 3 |
| 1.4.11-veldrand |gevonden | gevonden | gevonden | gevonden | gevonden | 2 van 2 | 3 van 3 |
| 2.1.1-chat-sluit |gevonden | gevonden | gevonden | gevonden | gevonden | 2 van 2 | 3 van 3 |
| 2.1.1-naar-boven |gevonden | gevonden | gevonden | gevonden | gevonden | 2 van 2 | 3 van 3 |
| 2.1.1-nieuwskaart |gevonden | gevonden | gevonden | gevonden | gevonden | 2 van 2 | 3 van 3 |
| 2.1.1-productkaart |gevonden | gevonden | gevonden | gevonden | gevonden | 2 van 2 | 3 van 3 |
| 2.1.1-vinkje |gevonden | gevonden | gevonden | gevonden | gevonden | 2 van 2 | 3 van 3 |
| 2.4.3-mobiel-menu |gevonden | gevonden | gevonden | gevonden | gevonden | 2 van 2 | 3 van 3 |
| 2.4.3-tabindex |gevonden | gevonden | gevonden | gevonden | gevonden | 2 van 2 | 3 van 3 |
| 3.1.2-engels |gevonden | gevonden | gevonden | gevonden | gevonden | 2 van 2 | 3 van 3 |
| 3.3.1-rode-rand |gevonden | gevonden | gevonden | gevonden | gevonden | 2 van 2 | 3 van 3 |
| 4.1.2-kadertitel |gevonden | gevonden | gevonden | gevonden | gevonden | 2 van 2 | 3 van 3 |
| 4.1.2-menuknop |gevonden | gevonden | gevonden | gevonden | gevonden | 2 van 2 | 3 van 3 |
| 4.1.2-rol-logo |gemist-bewijs-beoordeling | gevonden | gevonden | gevonden | gevonden | 1 van 2 | 3 van 3 |
| 4.1.2-tabs |gevonden | gevonden | gevonden | gevonden | gevonden | 2 van 2 | 3 van 3 |
| 4.1.2-uitklapper |gevonden | gevonden | gevonden | gevonden | gevonden | 2 van 2 | 3 van 3 |
| 4.1.2-venster |gevonden | gevonden | gevonden | deels | gevonden | 2 van 2 | 2 van 3 |

## Open punten per soort

Wat nog open staat in het oordeel dat telt, over de criteria hierboven.

| Soort | N1 | N2 | V1 | V2 | V3 |
|---|---|---|---|---|---|
| proef werkte niet | 1 | 0 | 2 | 0 | 1 |
| mens nodig | 0 | 2 | 2 | 2 | 2 |
| niet bereikbaar | 0 | 0 | 0 | 1 | 0 |
| samen | 1 | 2 | 4 | 3 | 3 |

## Verbruik per rol

Sessies, commando's en tijd uit de run. Tokens, beurten en kosten alleen uit een verbruiksbestand (--usage), want de run telt die niet.

| Run | Rol | Agents | Commando's | Tijd in sessies | Invoer | Naar de cache | Uit de cache | Uitvoer | Beurten | Kosten |
|---|---|---|---|---|---|---|---|---|---|---|
| N1 | rondgang | 13 | 691 | 122 min | - | - | - | - | - | - |
| N1 | beoordelaar | 56 | 2.344 | 334 min | - | - | - | - | - | - |
| N1 | verifieerder | 56 | 1.305 | 223 min | - | - | - | - | - | - |
| N2 | rondgang | 13 | 732 | 125 min | - | - | - | - | - | - |
| N2 | beoordelaar | 56 | 2.336 | 347 min | - | - | - | - | - | - |
| N2 | verifieerder | 56 | 1.327 | 253 min | - | - | - | - | - | - |
| V1 | rondgang | 13 | 780 | 72 min | - | - | - | - | - | - |
| V1 | beoordelaar | 9 | 636 | 76 min | - | - | - | - | - | - |
| V1 | verifieerder | 9 | 342 | 38 min | - | - | - | - | - | - |
| V2 | rondgang | 13 | 888 | 72 min | - | - | - | - | - | - |
| V2 | beoordelaar | 9 | 660 | 84 min | - | - | - | - | - | - |
| V2 | verifieerder | 9 | 287 | 38 min | - | - | - | - | - | - |
| V3 | rondgang | 13 | 837 | 74 min | - | - | - | - | - | - |
| V3 | beoordelaar | 9 | 612 | 78 min | - | - | - | - | - | - |
| V3 | verifieerder | 9 | 444 | 49 min | - | - | - | - | - | - |
