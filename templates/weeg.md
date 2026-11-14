# Opdracht: wie wordt door welke bevinding gehinderd

Het onderzoek van **{{site}}** heeft {{findings}} bevindingen. Elke bevinding is een afwijking van WCAG en moet worden hersteld. Daar beslis jij niet over. Jij legt per bevinding vast welke bezoekers ze hindert, wat er voor hen gebeurt, en of ze dit deel van de site nodig hebben voor een kerntaak. De ernst volgt daar met een vaste tabel uit; die kies je niet zelf.

Wie een pagina van boven naar beneden kan lezen en een muis gebruikt, vindt bijna elk gebrek klein. Zo kijk je hier niet. Je kijkt per groep, met de manier van werken van die groep.

## De groepen

Dit zijn de groepen uit EN 301 549, de norm waar de wet naar verwijst. Een groep is geen ziekte of aandoening: één bezoeker kan in meer groepen vallen.

{{groups}}

- **everyone**: alle bezoekers. Alleen voor iets wat voor iedereen misgaat, met of zonder beperking: een formulier dat niet verstuurt, een link die nergens heen gaat. Deze groep mag bij elk criterium, zonder `whyGroupNl`.

## Wat je vastlegt

Eerst de kerntaken van de site, één keer. Daarna per bevinding:

1. `task`: de kerntaak waarvoor een bezoeker dit deel nodig heeft, of `null` als de taak ook zonder lukt.
2. `affected`: de groepen die de bevinding hindert. Per groep het gevolg, en in een paar zinnen hoe de groep hier werkt en wat er dan gebeurt.
3. `blocksNl`: alleen als een groep iets niet kan en je een kerntaak noemt. Eén zin die zegt waarom die taak zonder dit deel niet af te maken is.

De invoer zet bevindingen over dezelfde plek bij elkaar. Weeg elke bevinding op wat zij zelf beschrijft. Een feit uit een andere bevinding over dezelfde plek mag je gebruiken: dat het venster ook geen naam heeft, dat er een knop Zoeken naast het veld staat. Het gevolg van die andere bevinding tel je niet mee.

## Kerntaken

Een kerntaak is iets waarvoor bezoekers naar deze site komen: iets aanvragen, iets opzoeken, een afspraak maken, contact opnemen. Haal ze uit `site.descriptionNl` en uit de pagina's in de invoer. Noem er {{tasksMin}} tot {{tasksMax}}, elk met een kort `id` en een naam van hooguit acht woorden, in de woorden van een bezoeker ("Een afspraak maken").

Bij elke bevinding kies je `task` met twee vragen.

1. Heeft de bezoeker het deel waar het gebrek in zit nodig om een kerntaak af te maken? Een stap in een formulier, de knop Versturen, de tekst met het antwoord waarvoor hij kwam, de enige weg naar inloggen. Dan is `task` die kerntaak. Het deel is het onderdeel waar de bezoeker iets mee wil, zoals het venster, het formulier of de knop, en niet het ene element in de code.
2. Houdt het gebrek de bezoeker tegen voordat hij bij zo'n deel is? Iets wat over de pagina ligt, wat de focus opvangt of vasthoudt, of wat vanzelf geluid maakt of beweegt, moet de bezoeker eerst voorbij. Dan is `task` ook die kerntaak, ook als het deel zelf er weinig mee te maken heeft.

Is het antwoord twee keer nee, dan is `task` `null`. De taak lukt dan ook zonder dit deel: een lege kop, een foto ter versiering, de voet, een knop om te delen, een vraag of de pagina nuttig was, een filter naast een lijst die ook zonder filter te doorlopen is, één afbeelding of één document tussen vele. Dat een gebrek op een belangrijke pagina staat, is niet genoeg.

Staat het deel op elke pagina en geldt het antwoord voor elke kerntaak (het hoofdmenu, de kopbalk, een paneel dat op elke pagina de focus opvangt), gebruik dan `"all"`. Dat geldt ook voor iets op de startpagina waar elke taak begint. Hoort het deel bij meer kerntaken maar niet bij alle, zoals een knop die in drie formulieren staat of een paneel op de helft van de pagina's, neem dan de kerntaak van de plek die de bevinding het eerst noemt.

Kan een groep iets niet (`cannot`) en noem je een kerntaak, dan komt de bevinding op de hoogste trede en bovenaan het rapport: daar staat dat deze groep de taak niet kan afmaken. Schrijf daarom in `blocksNl` waarom de taak zonder dit deel niet af te maken is. Lukt dat niet zonder te overdrijven, dan is `task` `null`: de groep mist dit deel, maar de taak lukt. De puntjes in een paginering die te licht zijn, één schema in een rapport, een link in de kop die op een smal scherm ontbreekt: wie dat mist, kan nog steeds zoeken, het rapport lezen of de site gebruiken. Een verplicht veld zonder naam, de enige knop om te versturen, de controle tegen robots: daar stopt de taak.

## Het gevolg

Kies per groep één van de drie.

- `cannot`: de groep kan dit niet. Er is binnen de eigen manier van werken geen weg naar deze inhoud of deze functie.
- `detour`: de eigen weg loopt dood. De bezoeker komt er wel, maar moet een andere weg vinden die duidelijk meer kost: naar een andere pagina gaan, een hele pagina doorlezen om één ding te vinden, knoppen zonder naam één voor één proberen, een formulier opnieuw invullen, hulp vragen.
- `effort`: de eigen weg werkt, maar kost meer: tijd, ruis, of een moment van onzekerheid dat de volgende stap oplost.

## Vaste gevallen

Bij deze gebreken ligt het gevolg vast, zodat hetzelfde gebrek elke keer hetzelfde weegt. Past een bevinding in een van deze gevallen, neem dan dat gevolg; een vast geval gaat voor de regels verderop. Laat de bevinding zelf zien dat het hier anders is, dan mag je afwijken; `textNl` zegt dan wat er anders is.

- Informatie die alleen in beeld staat (een afbeelding, een schema, een video zonder beschrijving): wie niet ziet `cannot`. Is dezelfde informatie langs een andere weg op de pagina te krijgen, zoals een link of een geluidsspeler ernaast, dan `detour`. Is het beeld versiering, of staat dezelfde informatie in de tekst ernaast, dan `effort`.
- Gesproken informatie zonder ondertiteling of uitgeschreven tekst: wie niet hoort `cannot`.
- Een bedieningselement dat met het toetsenbord niet te bereiken of niet te bedienen is, en een plek waar de focus niet meer uit komt: wie zijn handen moeilijk gebruikt en wie niet ziet `cannot`.
- Een invulveld, keuzerondje, vinkje of keuzelijst zonder naam: wie niet ziet `cannot`. In een formulier hoort hij de velden, niet de tekst ertussen, ook als de vraag er vlak naast staat. Zegt de rol al wat het is, zoals een zoekveld naast een knop Zoeken, dan `effort`.
- Een knop of link zonder naam: wie niet ziet `detour`. Hij moet hem proberen om te weten wat hij doet.
- Een document zonder tags: wie niet ziet `detour`. De schermlezer leest de tekst, maar zonder koppen, lijsten en vaste volgorde. Is het een formulier, dan `cannot`.
- Tekst met te weinig contrast: wie slecht ziet `effort`. Onder 3 op 1 `detour`: onder die grens heeft ook wie goed ziet moeite, en de bezoeker moet eigen kleuren instellen, de tekst selecteren of sterk vergroten om haar te lezen. Onder 1,5 op 1 `cannot`: de tekst valt weg tegen de achtergrond. Dat geldt voor kleine en grote tekst, en ook als het contrast alleen bij aanwijzen of bij focus te laag is. Wie kleuren niet onderscheidt, neem je bij contrast alleen op als het verschil in kleur zit en niet in licht en donker.
- Een rand of pictogram met te weinig contrast: wie slecht ziet `effort`. Is het de enige aanwijzing dat er iets te bedienen is, dan `detour`.
- Een focusring met te weinig contrast: wie het toetsenbord gebruikt en slecht ziet `effort`.
- Inhoud of een knop die bij vergroten of op een smal scherm verdwijnt: wie slecht ziet `cannot` als ze nergens anders staat, `detour` als ze op een andere plek of pagina wel staat. Moet de bezoeker opzij schuiven om te lezen, dan `effort`.
- Vergroten is uitgezet: wie slecht ziet `detour`. De vergroting van het toestel zelf werkt nog.
- De focus is niet te zien: wie het toetsenbord gebruikt en het scherm ziet `effort` bij één onderdeel, `detour` als de focus meer stappen achter elkaar of in een heel onderdeel niet te zien is.
- Een toestand of melding die niet wordt gemeld (open of dicht, verplicht, ongeldig, een bedankje, het aantal resultaten): wie niet ziet `effort` als het bij de volgende stap blijkt of in de tekst erbij staat, `detour` als hij ervoor moet terugzoeken. Een foutmelding die voor hem nergens te vinden is: `cannot`.
- Een kop, lijst of tabelkop die ontbreekt of niet klopt: wie niet ziet `effort`. Moet hij daardoor een hele pagina of een lang formulier doorlezen, dan `detour`.
- Een verkeerde of ontbrekende taal: `effort`.
- Een veld dat de browser niet zelf kan invullen, en gegevens die opnieuw moeten worden getypt: `effort`.
- Invoer die verloren gaat (een tijdslimiet, een link die het formulier leegmaakt), en een foutmelding die niet zegt wat er fout is of hoe het goed moet: `detour`.
- Een aanvraag of betaling die zonder controle definitief is: `detour`. Herstellen kan alleen nog via de organisatie.
- Inloggen dat alleen lukt door iets te onthouden, over te typen of een puzzel op te lossen, zonder andere weg: wie moeite heeft met lezen, onthouden of concentreren `cannot`.
- Beeld dat flitst: wie gevoelig is voor flitsen `cannot`. Er is geen omweg.
- Iets wat voor iedereen misgaat (`everyone`): een functie die niet werkt `cannot`, een link die ergens anders uitkomt dan hij belooft `detour`.

## Regels

1. **Eén groep tegelijk.** De invoer geeft per bevinding onder `criterion.essentialFor` en `criterion.alsoHelps` de groepen die de norm bij dat criterium noemt. Loop ze af en vraag bij elke groep: hoe werkt deze bezoeker op deze plek, en wat gebeurt er dan? Neem alleen de groepen op die werkelijk iets merken. Noem je een andere groep dan `everyone` die de norm bij dit criterium niet noemt, zeg dan in `whyGroupNl` waarom.
2. **De grootte van een groep telt niet.** Of het veel of weinig mensen zijn, staat nergens in je antwoord. De controle weigert woorden als "niemand", "randgeval", "bijzaak" en "valt mee".
3. **Moeite is een gevolg.** Een extra toets, een woord dat verkeerd wordt uitgesproken, een veld dat met de hand moet worden ingevuld: dat is `effort`, niet niets. Voor wie met een schakelaar werkt of moeilijk typt, is elke stap werk.
4. **Onzekerheid is een gevolg.** Blijkt iets pas bij de volgende toets of door even verder te lezen, dan is dat `effort`, niet niets. Moet de bezoeker opnieuw beginnen, naar een andere pagina of de hele pagina doorzoeken, dan is het `detour`. Een paar toetsen terug is `effort`.
5. **Wat de bezoeker belangrijk vindt, bepaal jij niet.** Schrijf niet dat een functie er weinig toe doet. Heeft de bezoeker het deel niet nodig voor een kerntaak, dan zeg je dat met `task: null` en met niets anders. Het gevolg voor de groep blijft wat het is: wie een filter niet kan bedienen, kan dat filter niet gebruiken (`cannot`), ook als de lijst zonder filter te doorlopen is.
6. **Verzin geen gevolg.** Je hebt de pagina niet gezien en geen hulpsoftware gehoord. Schrijf alleen wat uit de bevinding blijkt, en zet alleen tussen aanhalingstekens wat letterlijk in de bevinding staat: de controle weigert een aanhaling die daar niet staat. Schrijf dus niet wat een schermlezer "zegt" als de bevinding dat niet meldt. Hangt je keuze af van een feit dat er niet staat (heeft het venster wel een naam, staat dezelfde tekst ook elders), kies dan op wat er wel staat en noem het ontbrekende feit in `unsureNl`.
7. **Geen groep gehinderd.** Het komt voor dat een afwijking voor geen enkele groep iets verandert: wie de zichtbare tekst van een link uitspreekt, bereikt hem ook als er in de verborgen naam een letter ontbreekt. Laat dan `affected` leeg en zeg onder `unaffected` voor elke groep onder `criterion.essentialFor` hoe die groep langs de eigen weg hetzelfde krijgt. De bevinding blijft een bevinding en blijft in de lijst. Bij een criterium met een gemeten grens (contrast, de grootte van een aanwijsgebied, flitsen) kan dit niet: de norm zegt daar zelf waar de hinder begint.
8. **Het zwaarste gevolg per groep.** Een groep staat één keer bij een bevinding, met het zwaarste gevolg dat de bevinding laat zien.
9. **Schrijf voor de lezer van het rapport.** `textNl` is twee of drie hele zinnen, {{wordsMin}} tot {{textMax}} woorden: hoe deze bezoekers hier werken en wat er dan gebeurt. Het rapport zet er zelf een zin voor die de groep en het gevolg noemt, zoals "Mensen die slecht zien komen er alleen met een omweg." Schrijf daarop door, in het meervoud, met "ze": "Ze vergroten de pagina tot 200 procent en zoeken de knop om in te loggen. Die staat niet meer in de kopbalk en ook niet in het menu, dus inloggen kan alleen nog via een andere pagina." Herhaal de groep en het gevolg niet. Schrijf zoals je het iemand zou vertellen: gewone zinnen op B1-niveau, geen opsomming, geen vaktermen, geen code. `blocksNl`, `sameNl` en `unsureNl` zijn elk één of twee hele zinnen van hooguit {{wordsMax}} woorden.
10. **Alleen de invoer telt.** Je bezoekt de website niet en je opent geen andere bestanden, ook niet de code van de controle.

## Je bestanden

- Invoer: `{{input}}` (JSON). Lees dit helemaal. Onder `site` staat wat de site is en wat een bezoeker er kan doen. Onder `pages` staan de pagina's bij hun label, onder `documents` de documenten. Onder `places` staat elke plek met haar bevindingen: nummer, criterium met de groepen die de norm daarbij noemt, en de volledige tekst.
- Schrijf je antwoord als JSON naar: `{{output}}`
- Controleer het daarna met: `{{check}}`
  Meldt die controle fouten, herstel ze en controleer opnieuw. Je bent pas klaar als de controle slaagt.

{{workRules}}

De controle weigert een antwoord waarin een bevinding ontbreekt of twee keer staat, waarin een groep, een gevolg of een taak niet bestaat, waarin een bevinding geen groep noemt en ook niet per groep zegt waarom niet, waarin `blocksNl` ontbreekt bij een groep die iets niet kan bij een kerntaak, of waarin een zin een groep wegstreept.

## Vorm van het antwoord

Elke bevinding uit de invoer staat er precies één keer in, onder haar nummer.

```json
{
  "tasks": [
    { "id": "afspraak", "nameNl": "Een afspraak maken" },
    { "id": "opzoeken", "nameNl": "Iets opzoeken" }
  ],
  "findings": [
    {
      "finding": "SITE-1.4.10-1a2b",
      "task": "afspraak",
      "affected": [
        {
          "group": "low-vision",
          "consequence": "detour",
          "textNl": "Ze vergroten de pagina tot 200 procent en zoeken de knop om in te loggen. Die staat niet meer in de kopbalk en ook niet in het menu, dus inloggen kan alleen nog via een andere pagina."
        }
      ]
    },
    {
      "finding": "SITE-4.1.2-5e6f",
      "task": "afspraak",
      "blocksNl": "Zonder de namen weet de bezoeker niet welk veld de datum en welk de tijd vraagt, en zonder die twee is er geen afspraak.",
      "affected": [
        {
          "group": "no-vision",
          "consequence": "cannot",
          "textNl": "Ze gaan met de schermlezer van veld naar veld door het formulier voor een afspraak. De velden voor datum en tijd hebben geen naam, dus ze horen alleen dat er een veld is."
        }
      ]
    },
    {
      "finding": "SITE-2.5.3-3c4d",
      "task": null,
      "affected": [],
      "unaffected": [
        {
          "group": "limited-manipulation",
          "sameNl": "Ze zeggen de tekst die op de link staat. De naam van de link begint met dezelfde woorden, dus de link gaat open."
        },
        {
          "group": "limited-reach",
          "sameNl": "Ze tikken op de link. Dat de verborgen naam een letter mist, verandert daar niets aan."
        }
      ]
    }
  ]
}
```

- `task`: het `id` van een van je kerntaken, `"all"` voor elke kerntaak, of `null`.
- `affected`: de groepen die de bevinding hindert, elk met `group`, `consequence` en `textNl`.
- `blocksNl`: alleen als een groep iets niet kan (`cannot`) en `task` een kerntaak of `"all"` is. Laat het anders weg.
- `whyGroupNl`: alleen bij een groep die de norm bij het criterium van de bevinding niet noemt.
- `unaffected`: alleen als `affected` leeg is. Laat het anders weg.
- `unsureNl`: alleen als je keuze afhangt van een feit dat niet in de invoer staat.
