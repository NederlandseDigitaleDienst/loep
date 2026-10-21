# Procedures

Eén bestand per succescriterium van WCAG 2.2 niveau A en AA, plus 4.1.1 uit WCAG 2.1. Samen zijn ze de methode: wat er per criterium wordt onderzocht, met welk bewijs, en volgens welke regels het oordeel tot stand komt. Ze worden met elk rapport meegepubliceerd.

Een procedure is tegelijk de opdracht aan het taalmodel dat het criterium beoordeelt. Het model krijgt de procedure, een dossier met bewijs dat scripts hebben verzameld, en een sessie met instrumenten. De scripts leveren de dekking: elke pagina, beide kleurenschema's, het smalle scherm, elke melding in haar eigen toestand en elk onderdeel geopend. Het model doet die veegronde niet over. Het haalt op wat het dossier niet kan laten zien, kijkt de kandidaten uit de rondgang na en bevestigt het dossier met een steekproef. Het handelt en meet alleen via die instrumenten, en elke uitspraak wijst naar een vastgelegde waarneming. Elf procedures vragen ook het onderdeel `documents`: de pdf- en kantoorbestanden van de steekproef.

## Opbouw van een bestand

```markdown
---
id: "1.4.10"
version: 1
class: probe
evidence: [reflow, engine, screenshots]
inapplicable_if_zero: [video, audio]   # optioneel
pass_observations: [reflow, look]      # optioneel
decisive: [focus]                      # optioneel
pass_explains: ["reflow.clippedText"]  # optioneel
limits: "..."                          # optioneel
---

## Wat het criterium vraagt
## Werkwijze
## Zelf nagaan
## Beslisregels
## Aanbevelingen                        # optioneel
## Bewijs bij goedkeuring
## Valkuilen
## Wat de veegronde moet leveren
```

- `version`: geheel getal. Verhoog het bij elke inhoudelijke wijziging; het staat bij elk oordeel dat met de procedure is geveld.
- `class`: hoe het bewijs tot stand komt.
  - `engine`: de regel-engines dekken het criterium grotendeels.
  - `engine+oordeel`: engines vinden fouten, het model beoordeelt de kwaliteit.
  - `probe`: een script meet het gedrag in de browser.
  - `probe+oordeel`: een script meet, het model beoordeelt wat de meting betekent.
  - `oordeel`: het model beoordeelt op basis van schermafbeeldingen en structuur.
  - `inventaris`: het criterium gaat over content die er meestal niet is; de telling over alle pagina's is het bewijs.
- `evidence`: de onderdelen die in het dossier komen. De namen zijn de extractors uit `toolbox/src/lib/extractors.ts`. Vraag alleen wat de werkwijze gebruikt.
- `inapplicable_if_zero`: tellingen uit de inventaris die allemaal nul moeten zijn voordat "niet van toepassing" overwogen mag worden. Het dossier krijgt dan een onderdeel `inventoryForApplicability`.
- `pass_observations`: de commando's van de sessie waarvan een goedkeuring minstens één waarneming moet noemen. Alleen kijk- en meetcommando's: `look`, `crop`, `ax`, `style`, `html`, `find`, `document`, `contrast`, `focus`, `target`, `reflow`, `spacing`, `zoom`, `order`, `name`, `rules`, `taborder`, `lang`, `source`, `ocr`, `motion`, `timers`, `paste`, `press`, `drag`, `swipe`, `media`, `speak`, `forced`, `distinct`, `voiceover`. De controle op een oordeel weigert een goedkeuring zonder die waarnemingen.
- `decisive`: de commando's waarvan het voor dit criterium uitmaakt of de methoden het eens zijn. Een goedkeuring die leunt op zo'n meting met `disagree`, moet zeggen waarmee het verschil is beslecht. Zonder deze sleutel gelden de commando's uit `pass_observations`. Een lege lijst betekent: geen.
- `pass_explains`: lijsten in het dossier waarvan een goedkeuring elke rij apart moet verklaren, omdat de meting daar verlies ziet. Een pad loopt door lijsten heen (`textSpacing.states.newlyClippedText` neemt de rijen van elke toestand). Na een dubbele punt staat een veld: een rij waarin dat veld onwaar is, is gemeten als geen verlies en hoeft niet verklaard (`textSpacing.newlyClippedText:textLost`). De controle weigert een goedkeuring als een rij niet met haar tekst wordt genoemd in een waarneming met `noIssue` die naar een eigen kijk- of meetwaarneming wijst.
- `limits`: wat ook na het gebruik van de instrumenten niet is vastgesteld. Deze zin komt in het rapport onder de beperkingen. Wat blijft, is meestal dit: zonder testomgeving wordt niets naar een server verstuurd, zonder `login` wordt niet ingelogd, een echte schermlezer (VoiceOver met Safari) is alleen gebruikt waar een agent hem liet voorlezen en NVDA en JAWS nooit, de veegronde meet in één browser, een ingesloten venster dat is uitgezonderd of niet laadt is niet onderzocht, en media die niet als bestand op te halen is wordt niet beluisterd of bekeken. Een deel dat alleen geldt zonder echte schermlezer of zonder inlog, staat tussen accolades: `{zonder-schermlezer: Er is geen echte schermlezer gebruikt.}` of `{zonder-inlog: Pagina's achter een login zijn niet onderzocht.}`. Het rapport laat zo'n deel weg als VoiceOver voor dit criterium heeft voorgelezen, of als de run is ingelogd. Na een `|` staat de tekst die er dan voor in de plaats komt: `{zonder-inlog: Er wordt niet ingelogd.|Het inloggen zelf is door een mens gedaan.}`. Een ander woord voor de dubbele punt weigert de controle.

## Regels voor de inhoud

1. **Wat het criterium vraagt**: twee of drie zinnen in eigen woorden, met de uitzonderingen die ertoe doen. Geen normtekst overnemen.
2. **Werkwijze**: genummerde stappen. Elke stap noemt het onderdeel van het dossier bij naam (`reflow.clippedText`) en zegt wat ermee te doen. Een stap die om kijken vraagt, zegt welk bestand open moet.
3. **Zelf nagaan**: per gat in het dossier een punt N1, N2, enzovoort. Elk punt noemt het gat, de commando's waarmee de beoordelaar het dicht (kort geschreven als `loep contrast <ref>`), en wat elke uitkomst betekent: een bevinding, een waarneming die een goedkeuring steunt, of een open punt. Heeft de kernvraag van het criterium een commando dat met meer methoden meet (naam, contrast, focus, aanwijsgebied, Tab-volgorde, taal, geldige code, tekst in een afbeelding, beweging), dan staat hier ook wat de beoordelaar doet als de methoden het oneens zijn: dichterbij kijken, nooit het gunstigste antwoord kiezen. De sectie eindigt met "Wat geen instrument kan vaststellen": wat ook met instrumenten "kan niet bepalen" blijft, en waarom.
4. **Beslisregels**: gesloten regels R1, R2, enzovoort, in de volgorde waarin ze worden toegepast. Eerst de regels die tot `failed` leiden, dan `passed`, dan `inapplicable` als dat kan. De laatste regel is altijd "Anders: kan niet bepalen (`cantTell`)". Die regel stuurt de beoordelaar eerst naar "Zelf nagaan" en noemt daarna alleen wat geen instrument kan vaststellen, een onderdeel dat na een echte poging niet openging, methoden die het oneens blijven, een dekking die de veegronde had moeten leveren, en een budget dat op is. Wat pas na het versturen van een formulier verschijnt, is alleen buiten bereik als de run niet mag versturen; dan begint het punt met `versturen niet toegestaan:`.
5. **Bewijs bij goedkeuring**: wat er minimaal in de waarnemingen moet staan voordat een goedkeuring telt, uit het dossier en uit wat de beoordelaar zelf heeft gemeten. Altijd met aantallen, en in lijn met `pass_observations`.
6. **Wat de veegronde moet leveren**: de laatste sectie. Eén regel per dekking die het dossier moet bevatten voordat een goedkeuring kan: welk onderdeel, op welke pagina's, in welke toestanden, breedtes en kleurenschema's, en of het dossier dit nu al heeft ("nieuw" als de veegronde het nog moet gaan leveren). Een goedkeuring rust op die dekking plus een steekproef van de beoordelaar. Mist het dossier een dekking, dan schrijft de beoordelaar `veegronde mist: ...` in `missingNl`. Elk open punt daar begint met zijn soort: `mens nodig:`, `keuze nodig:` of `versturen niet toegestaan:` voor wat de eigenaar van de site moet nagaan, kiezen of toestaan, en `veegronde mist:`, `budget op:` of `proef werkte niet:` voor wat over het onderzoek zelf gaat. Zijn er alleen punten van de tweede groep en is er niets fout gevonden, dan kan het oordeel zeggen "geen afwijking gevonden, niet volledig gemeten"; de uitkomst blijft `cantTell`.
8. **Aanbevelingen** (optioneel, na de beslisregels): regels A1, A2, enzovoort, voor een patroon dat de site beter maakt en dat de norm niet vraagt, elk met de bron (de gangbare onderzoekspraktijk, een patroon uit een designsysteem). Een aanbeveling verandert de uitkomst nooit, en een regel hier noemt er geen. Wat de norm fout noemt, hoort onder een beslisregel; een regel die strenger is dan de letter van het criterium, hoort hier. Een agent geeft alleen een aanbeveling onder een regel uit deze sectie.
7. **Valkuilen** (staat in het bestand vóór de vorige sectie): bekende valse meldingen van engines, methoden waarvan bekend is dat ze hier fout meten, en waar dit criterium ophoudt en een ander begint.

Een goedkeuring vraagt positief bewijs. Kan het dossier een deel van het criterium niet aantonen, schrijf dan onder "Zelf nagaan" met welk commando de beoordelaar het wel aantoont. Kan geen instrument het aantonen, schrijf dan een beslisregel die in dat geval op `cantTell` uitkomt, en zet de beperking in `limits`. Een procedure die een criterium laat slagen omdat er niets gevonden is, is fout.

## Controleren

```
just procedures
```

De controle faalt als `id`, `version`, `class` of `evidence` ontbreekt of ongeldig is, als een procedure een onbekende extractor vraagt, een verplicht kopje mist (ook "Zelf nagaan"), in `pass_observations` of `decisive` een commando noemt dat geen kijk- of meetcommando is, in `pass_explains` een pad noemt buiten de onderdelen van `evidence`, als de beslisregels nergens "kan niet bepalen" noemen, als de sectie "Aanbevelingen" geen regel heeft, een regel twee keer noemt of een uitkomst noemt, of als er een procedure ontbreekt of te veel is.
