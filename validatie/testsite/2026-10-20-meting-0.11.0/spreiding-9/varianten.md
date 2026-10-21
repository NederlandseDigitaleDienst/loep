# Vergelijking van varianten

Sleutel: reference-lindewaard.json. 9 criteria: 1.1.1, 1.3.1, 1.4.3, 1.4.11, 2.1.1, 2.4.3, 3.1.2, 3.3.1, 4.1.2.

| Run | Kant | Variant | Commit |
|---|---|---|---|
| N1 n1 | nulmeting | n1 | `6ad7e5c` |
| N2 n2 | nulmeting | n2 | `6ad7e5c` |

Let op: alleen de 9 criteria van --criteria tellen mee; n1 heeft er 56, n2 heeft er 56, de rest telt niet mee.

## Overeenstemming tussen runs

Per criterium is een uitkomst "voldoet" (ook niet van toepassing), "voldoet niet" of "open" (kan niet bepalen, niet beoordeeld). Fleiss' kappa is 1 als alle runs gelijk zijn en rond 0 als ze niet meer overeenstemmen dan toeval.

| Kant | Runs | Zelfde uitkomst in alle runs | Fleiss' kappa |
|---|---|---|---|
| nulmeting | 2 | 9 van 9 | - |

## Per criterium

Spreiding: het aandeel paren runs waarin het criterium een andere uitkomst kreeg, binnen de nulmeting (N), binnen de variant (V) en tussen een run van elk (N tegen V). Ligt N tegen V niet boven N en V, dan verschilt de variant niet meer dan de runs onderling.

| Criterium | Sleutel | N1 | N2 | N | V | N tegen V |
|---|---|---|---|---|---|---|
| 1.1.1 Niet-tekstuele content | voldoet niet | voldoet niet | voldoet niet | 0% | - | - |
| 1.3.1 Info en relaties | voldoet niet | voldoet niet | voldoet niet | 0% | - | - |
| 1.4.3 Contrast (minimum) | voldoet niet | voldoet niet | voldoet niet | 0% | - | - |
| 1.4.11 Contrast van niet-tekstuele content | voldoet niet | voldoet niet | voldoet niet | 0% | - | - |
| 2.1.1 Toetsenbord | voldoet niet | voldoet niet | voldoet niet | 0% | - | - |
| 2.4.3 Focus volgorde | voldoet niet | voldoet niet | voldoet niet | 0% | - | - |
| 3.1.2 Taal van onderdelen | voldoet niet | voldoet niet | voldoet niet | 0% | - | - |
| 3.3.1 Foutidentificatie | voldoet niet | voldoet niet | voldoet niet | 0% | - | - |
| 4.1.2 Naam, rol, waarde | voldoet niet | voldoet niet | voldoet niet | 0% | - | - |

Bevindingen per criterium in de evaluatie:

| Criterium | N1 | N2 |
|---|---|---|
| 1.1.1 | 5 | 6 |
| 1.3.1 | 9 | 9 |
| 1.4.3 | 4 | 3 |
| 1.4.11 | 1 | 2 |
| 2.1.1 | 8 | 6 |
| 2.4.3 | 4 | 4 |
| 3.1.2 | 1 | 1 |
| 3.3.1 | 1 | 1 |
| 4.1.2 | 13 | 13 |

## Per gebrek uit de sleutel

"gevonden" telt alleen waar beide indelingen van `compare --findings` het eens zijn; "-" is een run zonder geldige indeling.

| Gebrek | N1 | N2 | Nulmeting | Variant |
|---|---|---|---|---|
| 1.1.1-artikelfoto |gevonden | gevonden | 2 van 2 | - |
| 1.1.1-bestandsnaam |gevonden | gevonden | 2 van 2 | - |
| 1.1.1-logo-melding |gevonden | gevonden | 2 van 2 | - |
| 1.1.1-tarieven |gevonden | gevonden | 2 van 2 | - |
| 1.3.1-keuzegroep |gevonden | gevonden | 2 van 2 | - |
| 1.3.1-lijst-als-alinea |gevonden | gevonden | 2 van 2 | - |
| 1.3.1-tabelkoppen |gevonden | gevonden | 2 van 2 | - |
| 1.3.1-tussenkop-uitklapper |gevonden | gevonden | 2 van 2 | - |
| 1.3.1-vette-tussenkop |gevonden | gevonden | 2 van 2 | - |
| 1.3.1-voetkop |gevonden | gevonden | 2 van 2 | - |
| 1.4.3-datum |gevonden | gevonden | 2 van 2 | - |
| 1.4.3-menu-aanwijzen |gevonden | gevonden | 2 van 2 | - |
| 1.4.3-tekst-op-foto |gevonden | gevonden | 2 van 2 | - |
| 1.4.11-veldrand |gevonden | gevonden | 2 van 2 | - |
| 2.1.1-chat-sluit |gevonden | gevonden | 2 van 2 | - |
| 2.1.1-naar-boven |gevonden | gevonden | 2 van 2 | - |
| 2.1.1-nieuwskaart |gevonden | gevonden | 2 van 2 | - |
| 2.1.1-productkaart |gevonden | gevonden | 2 van 2 | - |
| 2.1.1-vinkje |gevonden | gevonden | 2 van 2 | - |
| 2.4.3-mobiel-menu |gevonden | gevonden | 2 van 2 | - |
| 2.4.3-tabindex |gevonden | gevonden | 2 van 2 | - |
| 3.1.2-engels |gevonden | gevonden | 2 van 2 | - |
| 3.3.1-rode-rand |gevonden | gevonden | 2 van 2 | - |
| 4.1.2-kadertitel |gevonden | gevonden | 2 van 2 | - |
| 4.1.2-menuknop |gevonden | gevonden | 2 van 2 | - |
| 4.1.2-rol-logo |gemist-bewijs-beoordeling | gevonden | 1 van 2 | - |
| 4.1.2-tabs |gevonden | gevonden | 2 van 2 | - |
| 4.1.2-uitklapper |gevonden | gevonden | 2 van 2 | - |
| 4.1.2-venster |gevonden | gevonden | 2 van 2 | - |

## Open punten per soort

Wat nog open staat in het oordeel dat telt, over de criteria hierboven.

| Soort | N1 | N2 |
|---|---|---|
| proef werkte niet | 1 | 0 |
| mens nodig | 0 | 2 |
| samen | 1 | 2 |

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
