# Soorten bedieningselementen naar uiterlijk en gedrag, 16 oktober 2026

Issue #63: de proeven met aanwijzen, focus en indrukken in `states` deelden de bedieningselementen in soorten in per klasse en attribuut. Op een site met 19 pagina's in de steekproef gaf dat 633 soorten om aan te wijzen en 997 om in te drukken, en raakten beide grenzen vol. Nu is de maat uiterlijk en gedrag, zoals WCAG-EM 2.0 (§4.1, noot) zegt: "typically these components do not need to be re-evaluated on each occurrence unless they appear or behave differently". Wat er precies telt, staat in [docs/methode.md](../../../docs/methode.md) bij "Aanwijzen, focus en indrukken".

Deze meting gaat na of het aantal soorten daalt en of de ingebouwde gebreken die deze proeven moeten laten zien, er nog in staan. Zonder taalmodel: de proeven van `states` draaien rechtstreeks op elke pagina van beide testsites, in het standaardvenster en op 360 pixels breed, eerst met de code van `main` op commit `acaf2fe` en daarna met de nieuwe code. Het script staat ernaast: [vergelijk.ts](vergelijk.ts).

## Uitkomst

16 pagina's per site, zonder het deel achter de inlog en zonder de pagina voor een onbekend adres. De cookiemelding is eerst gesloten, zoals de veegronde doet met een blokkade uit het sitemodel.

| | Lindewaard, voor | Lindewaard, na | Berkenveen, voor | Berkenveen, na |
|---|---|---|---|---|
| Soorten om aan te wijzen | 78 | 75 | 97 | 90 |
| Aangewezen en gefocust | 108 | 105 | 131 | 124 |
| Soorten om in te drukken | 4 | 2 | 0 | 0 |
| Ingedrukt en werkte al bij indrukken | 4 | 2 | 0 | 0 |

De gebreken uit de sleutel die deze proeven laten zien, op Lindewaard:

| Gebrek | Voor | Na |
|---|---|---|
| `1.4.3-menu-aanwijzen`: menulink grijs op lichtgrijs onder de aanwijzer | gemeten, te laag contrast | gemeten, te laag contrast |
| `1.4.13-uitleg`: uitleg bij het rondje niet met Escape te sluiten | gevonden | gevonden |
| `2.4.7-menu`: menulinks zonder focusrand | gefocust | gefocust |
| `2.5.2-feedback`: knoppen Ja en Nee werken bij indrukken | gevonden, op beide knoppen | gevonden, op één knop |
| `3.2.1-voetlink`: voetlink die de focus wegneemt | aangewezen en gefocust | aangewezen en gefocust |

Op Berkenveen werkte geen enkele knop al bij het indrukken, voor en na.

## Wat dit zegt

- Het aantal soorten daalt, en geen ingebouwd gebrek van deze proeven verdwijnt. De vergelijking met de sleutel wordt dus niet slechter.
- De daling op de testsite is klein. De testsite heeft weinig klassen die per element verschillen: elke klasse daar hoort bij een eigen uiterlijk. Op een site met klassen per element, data-attributen en namen die een bouwprogramma maakt, is het verschil groter. De eenheidstest in `toolbox/test/coverage-probes.test.ts` laat dat zien op een pagina met zeven kaartlinks met zeven verschillende sets klassen: dat zijn nu twee soorten, en de ene link die onder de aanwijzer bleek wordt, blijft een eigen soort en wordt aangewezen.
- De knoppen Ja en Nee draaien dezelfde code bij het indrukken. Ze zijn nu één soort, en één van de twee wordt ingedrukt. Het gebrek blijft gevonden.
- Op één punt is de indeling fijner dan eerder: twee elementen met dezelfde klassen maar een andere lettergrootte, rand of hoogte buiten de marge zijn nu twee soorten. Ze zien er anders uit, dus dat hoort zo.

## Wat deze meting niet zegt

Het is geen volledige veegronde: geen sitemodel, geen toestanden en geen beoordeling door agents. Er is alleen nagegaan of de proeven met aanwijzen, focus en indrukken de elementen van de gebreken bereiken en laten zien wat er mis is. Op een echte site is de nieuwe indeling nog niet gemeten; hoeveel sneller `states` daar wordt, is dus niet bekend.
