# Opdracht: welke bevindingen zijn hetzelfde gebrek

Het onderzoek van **{{site}}** is per WCAG-succescriterium beoordeeld. Eén ding dat mis is op een pagina staat daardoor soms onder meerdere criteria als bevinding. Een selectievakje dat voor hulpsoftware niet bestaat, staat bijvoorbeeld onder 1.3.1, 2.1.1 en 4.1.2. Voor wie de site moet herstellen is dat één gebrek.

Vaste regels hebben de {{findings}} bevindingen al gegroepeerd tot {{defects}} gebreken. Die regels voegen alleen samen wat zeker is: bevindingen die dezelfde plek in dezelfde woorden aanwijzen. Jij kijkt naar wat de regels niet konden beslissen.

## Wat je mag

1. **Gebreken samenvoegen** als hun bevindingen hetzelfde gebrek op dezelfde plek beschrijven.
2. **Het hoofdcriterium kiezen** van een gebrek: het criterium van een van zijn bevindingen.

Meer mag je niet. Je schrijft geen bevinding, je verandert geen bevinding, je laat geen bevinding weg en je oordeelt niet opnieuw over een criterium.

## Regels waar je je aan houdt

1. **Hetzelfde gebrek is dezelfde plek.** Voeg samen als de bevindingen hetzelfde element aanwijzen, of dezelfde rij van gelijke elementen, op dezelfde pagina. Wie dat element herstelt, pakt ze samen op. Voorbeeld: "het zoekveld heeft geen label" (3.3.2) en "het zoekveld heeft geen naam" (4.1.2).
2. **Dezelfde soort fout op een andere plek is een ander gebrek.** Een kop zonder inhoud in het menu en een kop zonder inhoud in de voettekst blijven twee gebreken. Twee formulieren met dezelfde fout blijven twee gebreken, tenzij een bevinding ze zelf samen noemt.
3. **Het blok eromheen is niet de plek.** "De koppen in de zoekresultaten kloppen niet" en "de zoekresultaten schuiven opzij op een smal scherm" staan in hetzelfde onderdeel, maar gaan over andere elementen en vragen een ander herstel. Voeg ze niet samen.
4. **Te weinig contrast is een eigen gebrek.** Kleur en contrast (1.4.1, 1.4.3, 1.4.11) worden in de opmaak hersteld, wat er verder ook mis is met het element. Voeg een bevinding over contrast alleen samen met een andere bevinding over contrast op dezelfde plek.
5. **Bij twijfel: niet samenvoegen.** Een gebrek te veel kost de lezer een regel. Twee gebreken ten onrechte samengevoegd verbergen er één.
6. **Een brede bevinding houdt smalle bij elkaar.** Noemt één bevinding drie knoppen en gaan drie andere bevindingen elk over één van die knoppen, dan is dat samen één gebrek. Zonder zo'n brede bevinding blijven het drie gebreken. De controle weigert een gebrek waarin geen enkele bevinding de plekken van alle andere omvat.
7. **Wat de regels hebben samengevoegd, blijft bij elkaar.** In de invoer staat dat als `"joinedByRules": true`. Je mag zo'n gebrek uitbreiden, niet splitsen.
8. **Het hoofdcriterium is het criterium dat over de oorzaak gaat**, niet over het gevolg. De invoer geeft per gebrek het hoofdcriterium volgens de vaste volgorde. Neem dat over, tenzij een ander criterium van het gebrek de oorzaak duidelijk beter noemt. Schrijf dan in één zin waarom.
9. **Elke samenvoeging krijgt een reden** in `reasonNl`: welke plek het is en waarom één herstel alle bevindingen oplost. Eén zin, Nederlands op B1-niveau.
10. **Alleen de invoer telt.** Je bezoekt de website niet en je opent geen andere bestanden.

## Je bestanden

- Invoer: `{{input}}` (JSON). Lees dit helemaal. Onder `defects` staat elk gebrek met zijn bevindingen: nummer, criterium, titel, wat er mis is (ingekort), onderdeel, pagina's en onder `where` de plekken. Onder `pages` staan de pagina's bij hun label.
- Schrijf je voorstel als JSON naar: `{{output}}`
- Controleer het daarna met: `{{check}}`
  Meldt die controle fouten, herstel ze en controleer opnieuw. Je bent pas klaar als de controle slaagt.

{{workRules}}

De controle weigert een voorstel waarin een bevinding ontbreekt of twee keer staat, waarin een gebrek van de vaste regels is gesplitst, waarin de bevindingen van een gebrek geen pagina delen, waarin bevindingen aantoonbaar een andere plek aanwijzen, of waarin het hoofdcriterium niet bij een van de bevindingen hoort.

## Vorm van het voorstel

Het voorstel noemt elk gebrek, ook de gebreken waar je niets aan verandert. Elke bevinding uit de invoer staat er precies één keer in.

```json
{
  "defects": [
    {
      "findings": ["SITE-3.3.2-c7c7", "SITE-4.1.2-8954"],
      "mainCriterion": "3.3.2",
      "reasonNl": "Beide gaan over het zoekveld op de zoekpagina; een zichtbaar label lost ze samen op."
    },
    {
      "findings": ["SITE-1.4.3-ded7"],
      "mainCriterion": "1.4.3"
    }
  ]
}
```

- `findings`: de nummers van de bevindingen van dit gebrek.
- `mainCriterion`: het criterium van een van die bevindingen.
- `reasonNl`: verplicht als je gebreken samenvoegt of een ander hoofdcriterium kiest dan de invoer geeft. Laat het anders weg.
