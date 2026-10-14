# IJkmeting op de testgevallen van de ACT-regels

Gemeten op 2026-10-13 met `just calibrate`. Per instrument en per ACT-regel: hoe vaak het een fout terecht vindt, mist of onterecht meldt. De cijfers per geval staan in `gevallen.json`, alles hieronder ook in `uitkomst.json`.

## Bron

- Testgevallen: de repository `w3c/wcag-act-rules` op commit `f39b7f81cee60efe1f23205a893e031a7a02821b`, opgehaald als https://codeload.github.com/w3c/wcag-act-rules/tar.gz/f39b7f81cee60efe1f23205a893e031a7a02821b.
- `testcases.json`: sha256 `49051da603afa6d28b94ef3e758146dafcbe72bade7202a24636bab3ea4c0036`; 1211 gevallen bij 87 regels, op 1098 verschillende pagina's.
- Alle 1593 bestanden die lokaal zijn geserveerd (de gevallen en hun hulpbestanden): sha256 `d0d69801e164cb7de0f0ea2ba12958d5c6b7bd9b1fa150ec706c576d8ff87588` over de gesorteerde regels "sha256, twee spaties, pad".
- Licentie volgens de kop van `testcases.json`: https://act-rules.github.io/pages/license/. De gevallen staan niet in deze repository; ze worden bij gebruik opgehaald.
- De meting is volledig: alle gevallen van de lijst.

## Waarmee gemeten

Toolbox op commit `f653610bb7d31c3a1e68917321ca0f15eadb9eb9`, lockfile sha256 `f4791be823f17a17d98b91fcd1f2edaea60d3672fb3af8f8cdb7e0656c118b64`, chromium 153.0.8010.12. 1098 pagina's gemeten in 269 seconden met 4 tegelijk; 0 laadden niet. 30 verzoeken naar buiten de lokale server zijn geweigerd.

| Instrument | Soort | Versie | Waar de koppeling met een ACT-regel vandaan komt |
|---|---|---|---|
| axe-core | regelset | 4.13.0 | de metadata van het pakket zelf (actIds per regel) |
| alfa | regelset | 0.119.0 | het implementatierapport dat W3C publiceert (_data/wcag-act-rules/implementations/alfa.json op dezelfde commit, gemaakt met Alfa 0.118.0); het pakket zelf noemt geen ACT-regels |
| ibm | regelset | 4.0.34 | de metadata van het pakket zelf (act per regel) |
| qualweb | regelset | 0.8.6 | de metadata van het pakket zelf (mapping per regel) |
| chromium | eigen meting | chromium 153.0.8010.12 | een tabel in de toolbox (OWN_MAPPINGS), alleen waar de ACT-regel hetzelfde vraagt |
| alfa-aria | eigen meting | 0.119.0 | een tabel in de toolbox (OWN_MAPPINGS), alleen waar de ACT-regel hetzelfde vraagt |
| axe-name | eigen meting | 4.13.0 | een tabel in de toolbox (OWN_MAPPINGS), alleen waar de ACT-regel hetzelfde vraagt |
| playwright | eigen meting | 1.63.0 | een tabel in de toolbox (OWN_MAPPINGS), alleen waar de ACT-regel hetzelfde vraagt |
| dom-accessibility-api | eigen meting | 0.7.1 | een tabel in de toolbox (OWN_MAPPINGS), alleen waar de ACT-regel hetzelfde vraagt |
| pixels | eigen meting | 0.0.1 chromium 153.0.8010.12 | een tabel in de toolbox (OWN_MAPPINGS), alleen waar de ACT-regel hetzelfde vraagt |
| eld | eigen meting | 2.1.0 | een tabel in de toolbox (OWN_MAPPINGS), alleen waar de ACT-regel hetzelfde vraagt |
| cld3 | eigen meting | 4.0.0 | een tabel in de toolbox (OWN_MAPPINGS), alleen waar de ACT-regel hetzelfde vraagt |
| eld+cld3 | eigen meting | 2.1.0 en 4.0.0 | een tabel in de toolbox (OWN_MAPPINGS), alleen waar de ACT-regel hetzelfde vraagt |

## Hoe er is geteld

- Een testgeval is één pagina met de verwachte uitkomst van één regel: afgekeurd, geslaagd of niet van toepassing.
- Een instrument keurt een geval af als één van zijn regels voor die ACT-regel op de pagina iets afkeurt. Zo leest de toolbox de regelsets ook: adviezen die een regelset zelf niet als overtreding telt, tellen niet mee.
- Terecht gevonden: verwacht afgekeurd, en afgekeurd. Gemist: verwacht afgekeurd, en geslaagd of niet van toepassing. Onterecht gemeld: verwacht geslaagd of niet van toepassing, en afgekeurd.
- Twijfel: het instrument zegt dat het niet kan beslissen. Dat is geen vondst en geen misser; in de trefkans telt het als niet gevonden.
- Geen uitspraak: het instrument heeft volgens zijn maker geen regel voor die ACT-regel, of de toolbox zet die regel niet aan. Dat telt niet als gemist.
- Trefkans: terecht gevonden, gedeeld door de fouten waarover het instrument een uitspraak deed. Onterecht van alle meldingen: onterecht gemeld, gedeeld door alles wat het instrument afkeurde.

## Totaal per regelset

| Instrument | Gevallen met een uitspraak | waarvan een fout | Terecht gevonden | Gemist | Twijfel bij een fout | Onterecht gemeld | Twijfel zonder fout | Geen uitspraak | Liep vast | Trefkans | Onterecht van alle meldingen |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| axe-core | 687 | 209 | 162 | 22 | 25 | 10 | 32 | 524 | 0 | 77,5% (162 van 209) | 5,8% (10 van 172) |
| alfa | 766 | 245 | 212 | 12 | 21 | 15 | 26 | 445 | 0 | 86,5% (212 van 245) | 6,6% (15 van 227) |
| ibm | 534 | 172 | 151 | 10 | 11 | 13 | 5 | 677 | 0 | 87,8% (151 van 172) | 7,9% (13 van 164) |
| qualweb | 932 | 314 | 221 | 3 | 90 | 2 | 114 | 267 | 12 | 70,4% (221 van 314) | 0,9% (2 van 223) |

Alleen de regels die W3C heeft goedgekeurd (de andere zijn voorstellen):

| Instrument | Gevallen met een uitspraak | waarvan een fout | Terecht gevonden | Gemist | Twijfel bij een fout | Onterecht gemeld | Twijfel zonder fout | Geen uitspraak | Liep vast | Trefkans | Onterecht van alle meldingen |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| axe-core | 479 | 156 | 137 | 12 | 7 | 9 | 10 | 79 | 0 | 87,8% (137 van 156) | 6,2% (9 van 146) |
| alfa | 520 | 167 | 162 | 2 | 3 | 9 | 5 | 38 | 0 | 97,0% (162 van 167) | 5,3% (9 van 171) |
| ibm | 433 | 141 | 127 | 5 | 9 | 9 | 5 | 125 | 0 | 90,1% (127 van 141) | 6,6% (9 van 136) |
| qualweb | 501 | 164 | 160 | 1 | 3 | 0 | 7 | 50 | 7 | 97,6% (160 van 164) | 0,0% (0 van 160) |

## Totaal per eigen meting

| Instrument | Gevallen met een uitspraak | waarvan een fout | Terecht gevonden | Gemist | Twijfel bij een fout | Onterecht gemeld | Twijfel zonder fout | Geen uitspraak | Liep vast | Trefkans | Onterecht van alle meldingen |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| chromium | 102 | 38 | 33 | 5 | 0 | 0 | 0 | 1109 | 0 | 86,8% (33 van 38) | 0,0% (0 van 33) |
| alfa-aria | 102 | 38 | 33 | 5 | 0 | 1 | 0 | 1109 | 0 | 86,8% (33 van 38) | 2,9% (1 van 34) |
| axe-name | 102 | 38 | 33 | 5 | 0 | 1 | 0 | 1109 | 0 | 86,8% (33 van 38) | 2,9% (1 van 34) |
| playwright | 102 | 38 | 33 | 5 | 0 | 2 | 0 | 1109 | 0 | 86,8% (33 van 38) | 5,7% (2 van 35) |
| dom-accessibility-api | 102 | 38 | 33 | 5 | 0 | 4 | 0 | 1109 | 0 | 86,8% (33 van 38) | 10,8% (4 van 37) |
| pixels | 34 | 11 | 9 | 1 | 1 | 4 | 4 | 1177 | 0 | 81,8% (9 van 11) | 30,8% (4 van 13) |
| eld | 29 | 9 | 5 | 1 | 3 | 2 | 6 | 1182 | 0 | 55,6% (5 van 9) | 28,6% (2 van 7) |
| cld3 | 29 | 9 | 5 | 1 | 3 | 1 | 6 | 1182 | 0 | 55,6% (5 van 9) | 16,7% (1 van 6) |
| eld+cld3 | 29 | 9 | 5 | 1 | 3 | 0 | 11 | 1182 | 0 | 55,6% (5 van 9) | 0,0% (0 van 5) |

De eigen metingen zijn alleen gekoppeld aan de regels in deze tabel. Bij een regel over een naam bepaalt de toegankelijkheidsboom van Chromium welke elementen de rol hebben waar de regel over gaat; daarna telt per methode of de naam leeg is.

| ACT-regel | Eigen meting | Waarom dezelfde vraag |
|---|---|---|
| afw4f7 | pixels | de regel vraagt de contrastverhouding van zichtbare tekst tegen 4,5 op 1 of 3 op 1 voor grote tekst; dat is wat de contrastmeting op de pixels meet |
| ucwvc8 | eld, cld3, eld+cld3 | de regel vraagt of de taal van de pagina klopt met de taal die op het html-element is opgegeven; dat is de vraag van de taalherkenning voor de pagina |
| off6ek | eld, cld3, eld+cld3 | de regel vraagt of de taal van een element met een eigen lang-attribuut klopt met de tekst erin; dat is de vraag van de taalherkenning voor een deel |
| 97a4e1 | chromium, alfa-aria, axe-name, playwright, dom-accessibility-api | de regel vraagt of een knop een toegankelijke naam heeft die niet leeg is |
| 59796f | chromium, alfa-aria, axe-name, playwright, dom-accessibility-api | de regel vraagt of een afbeeldingsknop een toegankelijke naam heeft die niet leeg is |
| c487ae | chromium, alfa-aria, axe-name, playwright, dom-accessibility-api | de regel vraagt of een link een toegankelijke naam heeft die niet leeg is |
| ffd0e9 | chromium, alfa-aria, axe-name, playwright, dom-accessibility-api | de regel vraagt of een kop een toegankelijke naam heeft die niet leeg is |
| m6b1q3 | chromium, alfa-aria, axe-name, playwright, dom-accessibility-api | de regel vraagt of een menu-item een toegankelijke naam heeft die niet leeg is |
| e086e5 | chromium, alfa-aria, axe-name, playwright, dom-accessibility-api | de regel vraagt of een formulierveld een toegankelijke naam heeft die niet leeg is |

## De vier regelsets naast elkaar

Regelsets: axe-core, alfa, ibm, qualweb. Vergeleken zijn de 700 gevallen waarop minstens twee van hen een uitspraak deden die geen twijfel is.

- Eens: 639 gevallen; in 636 daarvan klopt wat ze samen zeggen met de verwachte uitkomst.
- Oneens: 61 gevallen. De meerderheid had gelijk in 50, ongelijk in 5; 6 keer staakten de stemmen.
- axe-core had gelijk in 49,0% (24 van 49) van de gevallen waarop het meedeed en de regelsets het oneens waren.
- alfa had gelijk in 65,0% (39 van 60) van de gevallen waarop het meedeed en de regelsets het oneens waren.
- ibm had gelijk in 45,9% (17 van 37) van de gevallen waarop het meedeed en de regelsets het oneens waren.
- qualweb had gelijk in 95,0% (57 van 60) van de gevallen waarop het meedeed en de regelsets het oneens waren.

| Zoals de toolbox het noemt | Gevallen | waarvan een fout | Aandeel |
|---|---:|---:|---:|
| eens: twee of meer keuren af, geen keurt goed | 196 | 192 | 98,0% (192 van 196) |
| alleen: één keurt af, de rest zwijgt | 24 | 16 | 66,7% (16 van 24) |
| oneens: één keurt af wat een ander goedkeurt | 41 | 22 | 53,7% (22 van 41) |
| onzeker: niemand keurt af, minstens één twijfelt | 214 | 89 | 41,6% (89 van 214) |
| geen afkeuring | 490 | 3 | 0,6% (3 van 490) |

### De twee regelsets van de veegronde

Regelsets: axe-core, alfa. Vergeleken zijn de 583 gevallen waarop minstens twee van hen een uitspraak deden die geen twijfel is.

- Eens: 551 gevallen; in 547 daarvan klopt wat ze samen zeggen met de verwachte uitkomst.
- Oneens: 32 gevallen. De meerderheid had gelijk in 0, ongelijk in 0; 32 keer staakten de stemmen.
- axe-core had gelijk in 31,3% (10 van 32) van de gevallen waarop het meedeed en de regelsets het oneens waren.
- alfa had gelijk in 68,8% (22 van 32) van de gevallen waarop het meedeed en de regelsets het oneens waren.

| Zoals de toolbox het noemt | Gevallen | waarvan een fout | Aandeel |
|---|---:|---:|---:|
| eens: twee of meer keuren af, geen keurt goed | 161 | 158 | 98,1% (158 van 161) |
| alleen: één keurt af, de rest zwijgt | 54 | 42 | 77,8% (42 van 54) |
| oneens: één keurt af wat een ander goedkeurt | 23 | 16 | 69,6% (16 van 23) |
| onzeker: niemand keurt af, minstens één twijfelt | 85 | 36 | 42,4% (36 van 85) |
| geen afkeuring | 513 | 11 | 2,1% (11 van 513) |

## Per ACT-regel, de regelsets

In de kolom Gevallen: verwacht afgekeurd / geslaagd / niet van toepassing. Per regelset: terecht gevonden / gemist / onterecht gemeld, met `?` het aantal keren twijfel en met `!` het aantal keren dat de regelset vastliep. Leeg: de regelset heeft geen regel voor deze ACT-regel. Staat uit: de regelset heeft er een, maar de toolbox draait of telt die niet.

| ACT-regel | Naam | Gevallen | axe-core | alfa | ibm | qualweb | Oneens |
|---|---|---:|---:|---:|---:|---:|---:|
| 674b10 | Role attribute has valid value | 2/3/6 | 2/0/0 | 2/0/0 | 2/0/0 ?1 | 2/0/0 |  |
| 6a7281 | ARIA state or property has valid value | 7/10/4 | 7/0/0 ?1 | 7/0/0 | 7/0/1 | 7/0/0 | 1 |
| 5f99a7 | ARIA attribute is defined in WAI-ARIA | 2/5/1 | 2/0/0 | 2/0/0 | 2/0/0 | 2/0/0 |  |
| de46e4 | Element with lang attribute has valid language tag | 9/5/5 | 9/0/0 | 9/0/0 | 9/0/1 | 9/0/0 | 1 |
| m6b1q3 | Menuitem has non-empty accessible name | 2/4/2 | 2/0/0 | 2/0/0 | 2/0/0 | 2/0/0 |  |
| akn7bn | Iframe with interactive elements is not excluded from tab-order | 1/2/7 | 1/0/2 | 1/0/3 | 1/0/0 | 1/0/0 | 3 |
| 24afc2 | Important letter spacing in style attributes is wide enough | 4/6/9 | 4/0/2 | 4/0/0 | 4/0/0 | 4/0/0 !1 | 2 |
| 9e45ec | Important word spacing in style attributes is wide enough | 4/6/9 | 4/0/3 | 4/0/0 | 4/0/0 | 4/0/0 !1 | 3 |
| 78fd32 | Important line height in style attributes is wide enough | 6/8/10 | 5/1/0 | 6/0/1 | 6/0/0 | 6/0/0 !1 | 2 |
| 73f2c2 | `autocomplete` attribute has valid value | 10/9/11 | 10/0/0 | 10/0/0 | 10/0/1 | 10/0/0 | 1 |
| 97a4e1 | Button has non-empty accessible name | 5/7/5 | 5/0/0 | 5/0/0 | 5/0/0 | 5/0/0 |  |
| 46ca7f | Element marked as decorative is not exposed | 3/6/1 | staat uit | 3/0/0 | 0/3/0 | 3/0/0 | 3 |
| e086e5 | Form field has non-empty accessible name | 9/10/3 | 9/0/0 | 8/1/0 | 8/1/0 | 9/0/0 | 1 |
| bf051a | HTML page `lang` attribute has valid language tag | 4/2/1 | 4/0/0 | 4/0/0 | 4/0/1 | 4/0/0 !1 | 1 |
| 2779a5 | HTML page has non-empty title | 6/6/1 | 6/0/0 | 6/0/0 | 6/0/0 | 6/0/0 !1 |  |
| 59796f | Image button has non-empty accessible name | 3/4/5 | 3/0/0 | 3/0/0 | 3/0/0 | 3/0/0 |  |
| 23a2a8 | Image has non-empty accessible name | 5/8/5 | 5/0/0 | 5/0/0 | 4/1/0 | 5/0/0 | 1 |
| c487ae | Link has non-empty accessible name | 11/11/6 | 11/0/0 | 11/0/0 | 11/0/0 | 10/1/0 | 1 |
| 7d6734 | SVG element with explicit role has non-empty accessible name | 4/3/3 | 4/0/0 | 4/0/0 | 3/1/3 | 4/0/0 | 4 |
| 307n5z | Element with presentational children has no focusable content | 5/4/3 | 5/0/0 | 5/0/0 | 1/0/0 ?4 | 5/0/0 |  |
| a25f45 | Headers attribute specified on a cell refers to cells in the same table element | 4/8/7 | 4/0/0 | 4/0/0 | 4/0/0 | 4/0/0 |  |
| 6cfa84 | Element with aria-hidden has no content in sequential focus navigation | 6/6/3 | 5/0/0 ?2 | 6/0/1 | 6/0/1 | 6/0/0 | 1 |
| bc659a | Meta element has no refresh delay | 4/3/8 | 4/0/1 | 4/0/0 | 0/0/0 ?5 | 4/0/0 | 1 |
| b4f0c3 | Meta viewport allows for zoom | 7/5/4 | 5/2/0 | 7/0/0 | staat uit | 7/0/0 | 2 |
| 8fc3b6 | Object element rendering non-text content has non-empty accessible name | 6/4/8 | 6/0/0 | 6/0/0 | 6/0/0 | 6/0/0 |  |
| b5c3f8 | HTML page has lang attribute | 4/1/2 | 4/0/1 | 4/0/1 | 4/0/1 | 4/0/0 !2 |  |
| c4a8a4 | HTML page title is descriptive | 3/3/1 |  | staat uit |  |  |  |
| qt1vmo | Image accessible name is descriptive | 3/3/10 |  |  |  |  |  |
| 0ssw9k | Scrollable content can be reached with sequential focus navigation | 2/4/9 | 2/0/0 | 2/0/2 | staat uit | 2/0/0 | 2 |
| oj04fd | Element in sequential focus order has visible focus | 1/5/3 |  | 0/0/0 ?4 |  | 0/0/0 ?6 |  |
| afw4f7 | Text has minimum contrast | 11/12/11 | 8/0/0 ?8 | 8/1/2 ?4 | 7/1/1 ?6 | 9/0/0 ?4 | 4 |
| 09o5cg | Text has enhanced contrast | 13/11/11 | 1/9/0 ?7 | 11/1/2 ?2 |  | 12/0/0 ?2 | 12 |
| 0va7u6 | HTML images contain no text | 5/8/2 |  |  |  |  |  |
| bisz58 | Meta element has no refresh delay (no exception) | 3/2/8 | 1/2/1 | 3/0/0 | staat uit | 3/0/0 | 3 |
| b33eff | Orientation of the page is not restricted using CSS transforms | 4/3/6 | staat uit | 4/0/0 | 4/0/0 | 4/0/0 |  |
| 4e8ab6 | Element with role attribute has required states and properties | 5/7/4 | 5/0/0 | 5/0/0 | 5/0/0 | 5/0/0 |  |
| 2t702h | Summary element has non-empty accessible name | 3/5/4 |  | 3/0/0 |  |  |  |
| kb1m8s (voorstel) | ARIA global properties not used where prohibited | 5/3/1 |  | 3/2/0 |  |  |  |
| ff89c9 (voorstel) | ARIA required context role | 4/6/5 | 4/0/0 | 4/0/0 | 4/0/0 | 4/0/0 |  |
| bc4a75 (voorstel) | ARIA required owned elements | 10/10/4 | 9/1/0 | 8/2/0 | staat uit | 10/0/0 | 3 |
| 5c01ea (voorstel) | ARIA state or property is permitted | 2/13/2 | 2/0/0 | 2/0/0 | 0/2/0 | 2/0/0 | 2 |
| afb423 (voorstel) | Audio element content is media alternative for text | 4/1/2 | staat uit |  |  | 0/0/0 ?7 |  |
| 80f0bf (voorstel) | Audio or video element avoids automatically playing audio | 2/3/3 | 0/0/0 ?4 |  |  | 2/0/0 |  |
| e7aa44 (voorstel) | Audio element content has text alternative | 2/3/3 |  |  |  | 0/0/0 ?7 |  |
| 2eb176 (voorstel) | Audio element content has transcript | 6/3/2 | staat uit |  |  | 0/0/0 ?11 |  |
| aaa1bf (voorstel) | Audio or video element that plays automatically has no audio that lasts more than 3 seconds | 2/2/3 |  |  |  | 2/0/0 |  |
| 4c31df (voorstel) | Audio or video element that plays automatically has a control mechanism | 5/3/3 |  |  |  | 5/0/0 |  |
| efbfc7 (voorstel) | Text content that changes automatically can be paused, stopped or hidden | 1/5/5 |  |  |  |  |  |
| 3e12e1 (voorstel) | Block of repeated content is collapsible | 3/4/1 | 0/0/0 ?7 |  |  | 0/0/0 ?7 !1 |  |
| cf77f2 (voorstel) | Bypass Blocks of Repeated Content | 1/12/1 | 0/0/0 ?5 |  |  | 0/0/0 ?13 !1 |  |
| c249d5 (voorstel) | Device motion based changes to the content can be disabled | 1/3/1 |  |  |  |  |  |
| 7677a9 (voorstel) | Device motion based changes to the content can also be created from the user interface | 1/4/1 |  |  |  |  |  |
| 047fe0 (voorstel) | Document has heading for non-repeated content | 4/9/1 | 0/2/0 ?2 |  |  | 0/0/0 ?12 !1 |  |
| ye5d6e (voorstel) | Document has an instrument to move focus to non-repeated content | 3/8/1 | 0/2/0 ?2 |  |  | 0/0/0 ?11 !1 |  |
| b40fd1 (voorstel) | Document has a landmark with non-repeated content | 3/4/1 | 0/0/0 ?3 |  |  | 0/0/0 ?6 !1 |  |
| off6ek (voorstel) | HTML element language subtag matches language | 4/5/5 |  |  |  |  |  |
| 80af7b (voorstel) | Focusable element has no keyboard trap | 5/7/4 |  |  |  |  |  |
| ebe86a (voorstel) | Focusable element has no keyboard trap via non-standard navigation | 3/3/1 |  |  |  |  |  |
| a1b64e (voorstel) | Focusable element has no keyboard trap via standard navigation | 3/4/4 |  |  |  |  |  |
| cc0f0a (voorstel) | Form field label is descriptive | 6/7/3 |  |  |  |  |  |
| b49b2e (voorstel) | Heading is descriptive | 4/6/2 |  | staat uit |  |  |  |
| ffd0e9 (voorstel) | Heading has non-empty accessible name | 8/5/2 | staat uit | 8/0/0 |  | 8/0/0 |  |
| ucwvc8 (voorstel) | HTML page language subtag matches default language | 5/4/6 |  | staat uit |  |  |  |
| 4b1c6c (voorstel) | Iframe elements with identical accessible names have equivalent purpose | 4/10/9 | 0/2/0 ?10 | 0/0/0 ?9 |  | 0/0/0 ?14 |  |
| cae760 (voorstel) | Iframe element has non-empty accessible name | 4/3/4 | 4/0/0 | 4/0/0 | 4/0/1 | 4/0/0 | 1 |
| e88epe (voorstel) | Image not in the accessibility tree is decorative | 5/5/10 |  |  |  |  |  |
| 36b590 (voorstel) | Error message describes invalid form field value | 5/3/1 |  |  |  | 0/0/0 ?8 |  |
| aizyf1 (voorstel) | Link is descriptive | 5/4/3 |  |  |  |  |  |
| 5effbb (voorstel) | Link in context is descriptive | 6/9/3 |  |  |  |  |  |
| b20e66 (voorstel) | Links with identical accessible names have equivalent purpose | 6/12/3 | staat uit | 0/0/0 ?13 |  | 0/0/0 ?13 |  |
| fd3a94 (voorstel) | Links with identical accessible names and same context serve equivalent purpose | 8/9/7 |  | 0/1/0 ?15 |  | 0/0/0 ?16 |  |
| 9bd38c (voorstel) | Content has alternative for visual reference | 4/15/2 |  |  |  |  |  |
| ffbc54 (voorstel) | No keyboard shortcut uses only printable characters | 2/6/2 |  |  |  |  |  |
| d0f69e (voorstel) | Table header cell has assigned cells | 3/6/7 | 0/1/0 ?2 | 2/1/0 |  | 3/0/0 | 1 |
| eac66b (voorstel) | Video element auditory content has accessible alternative | 2/2/2 | 0/0/0 ?4 |  |  | 0/0/0 ?5 |  |
| c5a4ea (voorstel) | Video element visual content has accessible alternative | 4/3/2 |  |  |  | 0/0/0 ?8 |  |
| ab4d13 (voorstel) | Video element content is media alternative for text | 4/1/2 |  |  |  | 0/0/0 ?6 |  |
| 1ea59c (voorstel) | Video element visual content has audio description | 3/2/2 |  |  |  | 0/0/0 ?6 |  |
| f51b46 (voorstel) | Video element auditory content has captions | 4/2/2 |  |  |  | 0/0/0 ?7 |  |
| c3232f (voorstel) | Video element visual-only content has accessible alternative | 4/3/2 |  |  |  | 0/0/0 ?7 |  |
| fd26cf (voorstel) | Video element visual-only content is media alternative for text | 4/1/2 |  |  |  | 0/0/0 ?5 |  |
| d7ba54 (voorstel) | Video element visual-only content has audio track alternative | 2/1/2 |  |  |  | 0/0/0 ?3 |  |
| ee13b5 (voorstel) | Video element visual-only content has transcript | 3/3/2 |  |  |  | 0/0/0 ?6 |  |
| 1ec09b (voorstel) | Video element visual content has strict accessible alternative | 3/2/2 |  |  |  | 0/0/0 ?6 |  |
| 1a02b0 (voorstel) | Audio and visuals of video element have transcript | 4/4/1 |  |  |  | 0/0/0 ?8 |  |
| 2ee8b8 (voorstel) | Visible label is part of accessible name | 16/16/4 | staat uit | 13/3/3 | 15/1/2 | 14/2/2 | 5 |
| 59br37 (voorstel) | Zoomed text node is not clipped with CSS overflow | 5/4/5 |  |  |  |  |  |

## Per ACT-regel, de eigen metingen

| ACT-regel | Naam | Gevallen | chromium | alfa-aria | axe-name | playwright | dom-accessibility-api | pixels | eld | cld3 | eld+cld3 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| m6b1q3 | Menuitem has non-empty accessible name | 2/4/2 | 2/0/0 | 2/0/0 | 2/0/0 | 2/0/0 | 2/0/0 |  |  |  |  |
| 97a4e1 | Button has non-empty accessible name | 5/7/5 | 5/0/0 | 5/0/0 | 5/0/0 | 5/0/0 | 5/0/0 |  |  |  |  |
| e086e5 | Form field has non-empty accessible name | 9/10/3 | 8/1/0 | 8/1/0 | 8/1/0 | 8/1/0 | 8/1/1 |  |  |  |  |
| 59796f | Image button has non-empty accessible name | 3/4/5 | 0/3/0 | 0/3/0 | 0/3/0 | 0/3/0 | 0/3/0 |  |  |  |  |
| c487ae | Link has non-empty accessible name | 11/11/6 | 10/1/0 | 10/1/1 | 10/1/1 | 10/1/2 | 10/1/3 |  |  |  |  |
| afw4f7 | Text has minimum contrast | 11/12/11 |  |  |  |  |  | 9/1/4 ?5 |  |  |  |
| off6ek (voorstel) | HTML element language subtag matches language | 4/5/5 |  |  |  |  |  |  | 2/1/1 ?3 | 2/1/1 ?3 | 2/1/0 ?5 |
| ffd0e9 (voorstel) | Heading has non-empty accessible name | 8/5/2 | 8/0/0 | 8/0/0 | 8/0/0 | 8/0/0 | 8/0/0 |  |  |  |  |
| ucwvc8 (voorstel) | HTML page language subtag matches default language | 5/4/6 |  |  |  |  |  |  | 3/0/1 ?6 | 3/0/0 ?6 | 3/0/0 ?9 |

## Welke regels van een regelset bij welke ACT-regel horen

| ACT-regel | axe-core | alfa | ibm | qualweb |
|---|---|---|---|---|
| 674b10 | aria-deprecated-role, aria-roles | sia-r110 | aria_role_allowed | QW-ACT-R20 |
| 6a7281 | aria-valid-attr-value | sia-r19 | aria_attribute_exists, aria_attribute_value_valid, aria_id_unique | QW-ACT-R34 |
| 5f99a7 | aria-valid-attr | sia-r20 | aria_attribute_allowed | QW-ACT-R27 |
| de46e4 | valid-lang | sia-r7 | element_lang_valid | QW-ACT-R22 |
| m6b1q3 | button-name | sia-r94 | aria_widget_labelled | QW-ACT-R66 |
| akn7bn | frame-focusable-content | sia-r95 | iframe_interactive_tabbable | QW-ACT-R70 |
| 24afc2 | avoid-inline-spacing | sia-r91 | text_spacing_valid | QW-ACT-R67 |
| 9e45ec | avoid-inline-spacing | sia-r92 | text_spacing_valid | QW-ACT-R69 |
| 78fd32 | avoid-inline-spacing | sia-r93 | text_spacing_valid | QW-ACT-R68 |
| 73f2c2 | autocomplete-valid | sia-r10 | input_autocomplete_valid | QW-ACT-R24 |
| 97a4e1 | aria-command-name, button-name, input-button-name | sia-r12 | input_label_exists | QW-ACT-R11 |
| 46ca7f | presentation-role-conflict (uit) | sia-r86 | aria_attribute_valid, img_alt_null | QW-ACT-R48 |
| e086e5 | aria-input-field-name, aria-toggle-field-name, label, select-name | sia-r8 | input_label_exists | QW-ACT-R16 |
| bf051a | html-lang-valid | sia-r5 | html_lang_valid | QW-ACT-R5 |
| 2779a5 | document-title | sia-r1 | page_title_exists | QW-ACT-R1 |
| 59796f | input-image-alt | sia-r28 | aria_id_unique, imagebutton_alt_exists | QW-ACT-R6 |
| 23a2a8 | image-alt, role-img-alt | sia-r2 | img_alt_valid, aria_accessiblename_exists (uit), aria_img_labelled (uit) | QW-ACT-R17 |
| c487ae | area-alt, link-name | sia-r11 | a_text_purpose | QW-ACT-R12 |
| 7d6734 | svg-img-alt | sia-r43 | svg_graphics_labelled, aria_graphic_labelled (uit), aria_img_labelled (uit) | QW-ACT-R21 |
| 307n5z | nested-interactive | sia-r90 | aria_descendant_valid | QW-ACT-R65 |
| a25f45 | td-headers-attr | sia-r45 | table_headers_ref_valid | QW-ACT-R36 |
| 6cfa84 | aria-hidden-focus | sia-r17 | aria_hidden_nontabbable | QW-ACT-R13 |
| bc659a | meta-refresh | sia-r9 | meta_refresh_delay | QW-ACT-R4 |
| b4f0c3 | meta-viewport | sia-r47 | meta_viewport_zoomable (uit) | QW-ACT-R14 |
| 8fc3b6 | object-alt | sia-r63 | object_text_exists | QW-ACT-R42 |
| b5c3f8 | html-has-lang | sia-r4 | html_lang_exists, html_lang_valid | QW-ACT-R2 |
| c4a8a4 |  | sia-r114 (uit) |  |  |
| 0ssw9k | scrollable-region-focusable | sia-r84 | element_scrollable_tabbable (uit) | QW-ACT-R43 |
| oj04fd |  | sia-r65 |  | QW-ACT-R62 |
| afw4f7 | color-contrast | sia-r69 | text_contrast_sufficient | QW-ACT-R37 |
| 09o5cg | color-contrast, color-contrast-enhanced (uit) | sia-r66 |  | QW-ACT-R76 |
| bisz58 | meta-refresh, meta-refresh-no-exceptions (uit) | sia-r96 | meta_redirect_optional (uit) | QW-ACT-R71 |
| b33eff | css-orientation-lock (uit) | sia-r44 | element_orientation_unlocked | QW-ACT-R7 |
| 4e8ab6 | aria-required-attr | sia-r16 | aria_attribute_required, combobox_popup_reference | QW-ACT-R28 |
| 2t702h |  | sia-r116 |  |  |
| kb1m8s |  | sia-r18 |  |  |
| ff89c9 | aria-required-children, aria-required-parent | sia-r42 | aria_parent_required | QW-ACT-R33 |
| bc4a75 | aria-required-children | sia-r68 | aria_child_valid (uit) | QW-ACT-R38 |
| 5c01ea | aria-allowed-attr, aria-conditional-attr, aria-prohibited-attr | sia-r18 | aria_attribute_valid | QW-ACT-R25 |
| afb423 | audio-caption (uit) |  |  | QW-ACT-R59 |
| 80f0bf | no-autoplay-audio |  |  | QW-ACT-R15 |
| e7aa44 |  |  |  | QW-ACT-R29 |
| 2eb176 | audio-caption (uit) |  |  | QW-ACT-R58 |
| aaa1bf |  |  |  | QW-ACT-R49 |
| 4c31df |  |  |  | QW-ACT-R50 |
| 3e12e1 | bypass |  |  | QW-ACT-R73 |
| cf77f2 | bypass |  |  | QW-ACT-R75 |
| 047fe0 | bypass |  |  | QW-ACT-R64 |
| ye5d6e | bypass |  |  | QW-ACT-R74 |
| b40fd1 | bypass |  |  | QW-ACT-R63 |
| b49b2e |  | sia-r115 (uit) |  |  |
| ffd0e9 | empty-heading (uit) | sia-r64 |  | QW-ACT-R35 |
| ucwvc8 |  | sia-r109 (uit) |  |  |
| 4b1c6c | frame-title-unique | sia-r15 |  | QW-ACT-R10 |
| cae760 | frame-title | sia-r13 | frame_title_exists | QW-ACT-R19 |
| 36b590 |  |  |  | QW-ACT-R41 |
| b20e66 | identical-links-same-purpose (uit) | sia-r41 |  | QW-ACT-R9 |
| fd3a94 |  | sia-r81 |  | QW-ACT-R44 |
| d0f69e | th-has-data-cells | sia-r46 |  | QW-ACT-R39 |
| eac66b | video-caption |  |  | QW-ACT-R26 |
| c5a4ea |  |  |  | QW-ACT-R23 |
| ab4d13 |  |  |  | QW-ACT-R56 |
| 1ea59c |  |  |  | QW-ACT-R55 |
| f51b46 |  |  |  | QW-ACT-R60 |
| c3232f |  |  |  | QW-ACT-R31 |
| fd26cf |  |  |  | QW-ACT-R51 |
| d7ba54 |  |  |  | QW-ACT-R54 |
| ee13b5 |  |  |  | QW-ACT-R53 |
| 1ec09b |  |  |  | QW-ACT-R32 |
| 1a02b0 |  |  |  | QW-ACT-R61 |
| 2ee8b8 | label-content-name-mismatch (uit) | sia-r14 | label_name_visible | QW-ACT-R30 |
