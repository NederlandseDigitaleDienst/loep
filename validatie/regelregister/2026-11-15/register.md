# Regelregister van 2026-11-15

Wat er per regel van elke regelset bekend is. De ijkmeting is van 2026-11-15, met axe-core 4.14.0, Alfa 0.120.0, IBM 4.0.34, QualWeb 0.8.6. Het veld is 29 afgeronde onderzoeken van 13 sites: in 12 daarvan legde een beoordelaar per regel een uitspraak vast, in 19 draaide een agent de regelsets in een sessie.

## Hoeveel er is

| Regelset | Regels | ACT-regel | Techniek | Overig | Met ijkmeting | Met uitspraak van een beoordelaar | Met een uitslag uit sessies |
|---|---|---|---|---|---|---|---|
| Alfa | 89 | 44 | 0 | 45 | 44 | 15 | 16 |
| axe-core | 65 | 47 | 0 | 18 | 45 | 18 | 20 |
| IBM | 121 | 34 | 0 | 87 | 31 | 0 | 27 |
| QualWeb | 101 | 67 | 34 | 0 | 66 | 0 | 34 |

Van de 33 regels met een uitspraak van een beoordelaar rusten er 26 op minder dan drie sites.

## Wat beoordelaars over een regel zeiden

Alleen regels met een uitspraak op twee of meer sites. Bevestigd: op die site werd het een bevinding. Verworpen: geen bevinding, en de beoordelaar zei dat er niets aan de hand was.

| Regelset | Regel | Soort | Sites | Bevestigd | Verworpen | Anders |
|---|---|---|---|---|---|---|
| Alfa | sia-r14 | ACT-regel | 4 | 4 | 0 | 0 |
| Alfa | sia-r64 | ACT-regel | 4 | 4 | 0 | 0 |
| axe-core | label-content-name-mismatch | ACT-regel | 4 | 4 | 0 | 0 |
| Alfa | sia-r1 | ACT-regel | 3 | 3 | 0 | 0 |
| Alfa | sia-r68 | ACT-regel | 3 | 1 | 2 | 0 |
| Alfa | sia-r84 | ACT-regel | 3 | 0 | 3 | 0 |
| axe-core | document-title | ACT-regel | 3 | 3 | 0 | 0 |
| Alfa | sia-r11 | ACT-regel | 2 | 1 | 1 | 0 |
| Alfa | sia-r17 | ACT-regel | 2 | 0 | 2 | 0 |
| Alfa | sia-r4 | ACT-regel | 2 | 2 | 0 | 0 |
| Alfa | sia-r8 | ACT-regel | 2 | 2 | 0 | 0 |
| axe-core | aria-allowed-attr | ACT-regel | 2 | 2 | 0 | 0 |
| axe-core | button-name | ACT-regel | 2 | 2 | 0 | 0 |
| axe-core | html-has-lang | ACT-regel | 2 | 2 | 0 | 0 |
| axe-core | target-size | overig | 2 | 1 | 1 | 0 |

## Regels die afkeuren waar het criterium toch slaagt

Uit de sessies, voor alle vier de regelsets: de regel keurde ergens af op de site, en het onderzoek keurde het criterium goed. Alleen regels waar dat op twee of meer sites gebeurde. De laatste kolom zegt op hoeveel van alle sites het criterium is afgekeurd.

| Regelset | Regel | Soort | Criterium | Sites waar de regel afkeurde | Criterium afgekeurd | Criterium goedgekeurd | Criterium afgekeurd op alle sites |
|---|---|---|---|---|---|---|---|
| Alfa | sia-r84 | ACT-regel | 2.1.1 | 3 | 0 | 3 | 4 van 13 |
| QualWeb | QW-WCAG-T17 | techniek | 3.3.2 | 6 | 3 | 3 | 7 van 13 |
| QualWeb | QW-WCAG-T23 | techniek | 2.4.1 | 5 | 2 | 3 | 4 van 13 |
| QualWeb | QW-WCAG-T24 | techniek | 2.1.1 | 4 | 0 | 3 | 4 van 13 |
| axe-core | scrollable-region-focusable | ACT-regel | 2.1.1 | 4 | 1 | 2 | 4 van 13 |
| IBM | aria_attribute_allowed | ACT-regel | 4.1.2 | 3 | 0 | 2 | 10 van 13 |
| IBM | aria_widget_labelled | ACT-regel | 4.1.2 | 3 | 1 | 2 | 10 van 13 |
| QualWeb | QW-ACT-R12 | ACT-regel | 4.1.2 | 3 | 0 | 2 | 10 van 13 |
| QualWeb | QW-ACT-R43 | ACT-regel | 2.1.1 | 4 | 1 | 2 | 4 van 13 |
| QualWeb | QW-ACT-R66 | ACT-regel | 4.1.2 | 2 | 0 | 2 | 10 van 13 |
| QualWeb | QW-WCAG-T24 | techniek | 3.2.1 | 3 | 0 | 2 | 0 van 13 |
| QualWeb | QW-WCAG-T28 | techniek | 1.4.4 | 4 | 2 | 2 | 10 van 13 |
| QualWeb | QW-WCAG-T28 | techniek | 1.4.5 | 4 | 1 | 2 | 8 van 13 |

## Op de testgevallen van de ACT-regels

Regels die op de testgevallen iets onterecht meldden of iets misten. Een regel die een ACT-regel deelt met een andere regel van dezelfde regelset, is met die andere samen beoordeeld.

| Regelset | Regel | Beoordeeld | Gebreken | Gevonden | Gemist | Onterecht gemeld | Twijfel bij een gebrek |
|---|---|---|---|---|---|---|---|
| Alfa | sia-r14 | 36 | 16 | 13 | 3 | 3 | 0 |
| IBM | svg_graphics_labelled | 10 | 4 | 3 | 1 | 3 | 0 |
| Alfa | sia-r95 | 10 | 1 | 1 | 0 | 3 | 0 |
| axe-core | meta-refresh | 28 | 7 | 5 | 2 | 2 | 0 |
| QualWeb | QW-ACT-R30 | 36 | 16 | 14 | 2 | 2 | 0 |
| IBM | label_name_visible | 36 | 16 | 15 | 1 | 2 | 0 |
| Alfa | sia-r66 | 35 | 13 | 11 | 1 | 2 | 1 |
| Alfa | sia-r69 | 34 | 11 | 8 | 1 | 2 | 2 |
| axe-core | frame-focusable-content | 10 | 1 | 1 | 0 | 2 | 0 |
| IBM | html_lang_valid (met html_lang_exists) | 14 | 8 | 8 | 0 | 2 | 0 |
| Alfa | sia-r84 | 15 | 2 | 2 | 0 | 2 | 0 |
| IBM | text_contrast_sufficient | 34 | 11 | 7 | 1 | 1 | 3 |
| IBM | aria_attribute_exists (met aria_attribute_value_valid, aria_id_unique) | 21 | 7 | 7 | 0 | 1 | 0 |
| IBM | aria_attribute_value_valid (met aria_attribute_exists, aria_id_unique) | 21 | 7 | 7 | 0 | 1 | 0 |
| IBM | aria_hidden_nontabbable | 15 | 6 | 6 | 0 | 1 | 0 |
| IBM | aria_id_unique (met aria_attribute_exists, aria_attribute_value_valid, imagebutton_alt_exists) | 33 | 10 | 10 | 0 | 1 | 0 |
| IBM | element_lang_valid | 19 | 9 | 9 | 0 | 1 | 0 |
| IBM | frame_title_exists | 11 | 4 | 4 | 0 | 1 | 0 |
| IBM | html_lang_exists (met html_lang_valid) | 7 | 4 | 4 | 0 | 1 | 0 |
| axe-core | html-has-lang | 7 | 4 | 4 | 0 | 1 | 0 |
| IBM | input_autocomplete_valid | 30 | 10 | 10 | 0 | 1 | 0 |
| axe-core | label-content-name-mismatch | 36 | 16 | 16 | 0 | 1 | 0 |
| Alfa | sia-r17 | 15 | 6 | 6 | 0 | 1 | 0 |
| Alfa | sia-r4 | 7 | 4 | 4 | 0 | 1 | 0 |
| Alfa | sia-r93 | 24 | 6 | 6 | 0 | 1 | 0 |
| axe-core | color-contrast | 69 | 24 | 9 | 9 | 0 | 6 |
| axe-core | bypass | 56 | 14 | 0 | 4 | 0 | 10 |
| IBM | img_alt_null (met aria_attribute_valid) | 10 | 3 | 0 | 3 | 0 | 0 |
| axe-core | frame-title-unique | 23 | 4 | 0 | 2 | 0 | 2 |
| axe-core | meta-viewport | 16 | 7 | 5 | 2 | 0 | 0 |
| Alfa | sia-r18 | 26 | 7 | 5 | 2 | 0 | 0 |
| Alfa | sia-r68 | 24 | 10 | 8 | 2 | 0 | 0 |
| axe-core | aria-required-children (met aria-required-parent) | 39 | 14 | 13 | 1 | 0 | 0 |
| axe-core | avoid-inline-spacing | 62 | 14 | 13 | 1 | 0 | 0 |
| IBM | img_alt_valid | 18 | 5 | 4 | 1 | 0 | 0 |
| IBM | input_label_exists | 39 | 14 | 13 | 1 | 0 | 0 |
| QualWeb | QW-ACT-R12 | 28 | 11 | 10 | 1 | 0 | 0 |
| Alfa | sia-r46 | 16 | 3 | 2 | 1 | 0 | 0 |
| Alfa | sia-r8 | 22 | 9 | 8 | 1 | 0 | 0 |
| Alfa | sia-r81 | 24 | 8 | 0 | 1 | 0 | 7 |
| axe-core | th-has-data-cells | 16 | 3 | 0 | 1 | 0 | 2 |

Alle regels staan in register.json.
