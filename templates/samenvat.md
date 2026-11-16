# Opdracht: een samenvatting voor de leiding

Je schrijft de samenvatting waarmee het toegankelijkheidsrapport van **{{site}}** opent. De lezers zijn bestuurders en opdrachtgevers die alleen deze tekst lezen. Ze willen weten wat er met de site aan de hand is, wat het zwaarst weegt, en wat er nu moet gebeuren.

Het rapport staat hier, als tekst en zonder de bijlagen:

```
{{source}}
```

Lees het helemaal, in delen als het groot is. Gebruik niets van buiten het rapport: geen eigen kennis van de site, geen eigen oordeel over toegankelijkheid. Je voegt geen bevinding toe en laat geen afkeuring weg die voor de lezers telt.

## Wat de tekst beantwoordt

1. Wat is de uitkomst: voldoet de site, hoeveel criteria zijn niet gehaald en hoeveel staan open, welke status het is en waardoor.
2. Voor wie gaat het mis en bij welke taak. Noem de groep bezoekers en wat hun gebeurt. Loopt een groep vast bij een kerntaak, dan is dat het eerste wat de lezers horen na de uitkomst. Loopt geen groep vast, zeg dat dan, en zeg erbij dat dit alleen geldt voor wat is onderzocht als er criteria open staan.
3. De gebreken die het zwaarst wegen, in gewone woorden. Kies er hooguit vier, en zeg bij elk voor welke groep bezoekers het geldt. Noem alle groepen die het rapport bij dat gebrek noemt. Noem je alleen wie vastloopt of een omweg nodig heeft, zeg dat dan in de zin zelf, zoals "een omweg is nodig voor mensen die niet zien"; schrijf niet "dat treft" of "dat geldt voor" met een groep minder dan het rapport. Twee gebreken aan hetzelfde onderdeel mag je als één noemen.
4. Wat de eigenaar nu moet doen, en wat daarvan eerst komt. Schrijf dat als advies van het onderzoek, zoals "Herstel eerst het formulier" of "Het onderzoek raadt aan eerst het formulier te herstellen". Schrijf nooit "de eigenaar herstelt" of "de gemeente zet": de eigenaar heeft niets toegezegd, en zo'n zin leest als een belofte. De volgorde haal je uit de werklijst: de zwaarste eerst, en bij dezelfde ernst eerst wat bij een kerntaak hoort.
5. Wat het onderzoek niet heeft kunnen vaststellen.

## Regels

- Hooguit {{wordsMax}} woorden, in {{paragraphsMin}} tot {{paragraphsMax}} alinea's. Dat is weinig: kies, en laat weg wat de lezers niet nodig hebben om te beslissen. Schrap eerder een gebrek dan de groep bij een gebrek.
- Lopende zinnen. Geen opsommingstekens, geen kopjes, geen vet, geen haakjes, geen webadressen. De naam van de site mag.
- Nederlands, voor iemand die WCAG niet kent. Noem de norm één keer bij naam, als "WCAG 2.2 niveau A en AA", en leg er verder niets van uit. Een criterium noem je in woorden, zoals "contrast van tekst", nooit met een nummer.
- Begin niet met de zin waarmee het rapport zelf opent. Zeg de uitkomst in je eigen woorden.
- De tekst spreekt het rapport nergens tegen en verzacht niets. Keurt het rapport criteria af, dan staan de woorden "voldoet niet" in je tekst.
- Ernst telt per groep bezoekers, en de zwaarste groep telt. Een afkeuring is nooit "formeel" of "technisch". Schrijf nooit dat niemand er last van heeft.
- Een criterium dat open staat, is niet goedgekeurd. Zeg dat het niet is vastgesteld.
- Elk getal neem je letterlijk over uit het rapport. Een aantal schrijf je in cijfers, ook als het klein is; een termijn die het rapport in letters schrijft, zoals "zes maanden", neem je zo over. Reken niets uit en rond niets af.
- Zeg met de woorden "niet gehaald" hoeveel criteria niet zijn gehaald, en noem in een zin met "niet vastgesteld" of "open" hoeveel er open staan. In de zin met "niet gehaald" staan alleen die aantallen en het totaal.
- Noem de status met de letter uit het rapport, als "status C", en zeg in dezelfde zin waardoor ze dat is. Status C komt door de criteria die niet zijn vastgesteld, niet door het aantal dat niet is gehaald. Schrijf dus niet "daaruit volgt status C" achter de twee aantallen. Noem geen andere letter. Zeg niet of de status voorlopig is en schrijf niets over tekenen of over een concept: dat staat bij de status zelf, en jouw tekst blijft staan als het rapport is afgetekend.
- Geen woorden van het onderzoek zelf, zoals veegronde, beoordelaar, taalmodel of run.
- Geen afkortingen met een punt, zoals "bijv." of "o.a."; schrijf ze voluit. Gebruik de woorden "niet gehaald" alleen bij het aantal criteria.
- Geen gedachtestreepjes. Geen rijtje van drie als stijlmiddel. Geen slotzin die de opening herhaalt.

## Wat je inlevert

Schrijf één JSON-bestand:

```
{{output}}
```

In deze vorm:

```json
{
  "reportSha256": "{{reportSha256}}",
  "taskSha256": "{{taskSha256}}",
  "model": "<het model waarmee je draait, zoals je het zelf kent>",
  "paragraphs": [
    { "textNl": "<de eerste alinea>", "sources": ["status"] },
    { "textNl": "<de tweede alinea>", "sources": ["vastlopen", "SITE-G-1a2b"] }
  ]
}
```

`reportSha256` en `taskSha256` neem je letterlijk over: ze zeggen uit welk rapport en met welke versie van deze opdracht je schreef. Het zijn kenmerken die loep uitrekent, niet de hash van dit bestand. Verandert het rapport, dan krijg je een nieuwe opdracht met een andere waarde, en schrijf je de samenvatting opnieuw uit het nieuwe rapport.

Bij elke alinea staat in `sources` waar ze in het rapport op rust. Dat is het nummer van een gebrek zoals het rapport het geeft, het nummer van een criterium, of een van deze delen:

{{parts}}

Een alinea waarvoor je geen plek in het rapport kunt aanwijzen, hoort niet in de samenvatting.

## Controleren

Draai daarna de controle:

```
{{check}}
```

Ze houdt je tekst aan het rapport: de lengte, de status, elk getal, de woorden die niet mogen, en of `sources` naar iets bestaands wijst. Meldt ze iets, herstel dat in het bestand en draai haar opnieuw, tot ze niets meer meldt. Verander verder niets in de run.

De controle ziet niet of een zin in gewone woorden iets beweert wat het rapport niet zegt. Daarna legt een tweede lezer elke zin naast het rapport en wijst aan waar die staat. Een zin die het rapport niet draagt, houdt de hele samenvatting uit het rapport. Lees je tekst daarom na het schrijven nog één keer naast het rapport, zin voor zin.

Staat er al een oordeel van de tweede lezer over een eerdere tekst, dan staat het hier:

```
{{reading}}
```

Lees het als het er is. Wat daar niet-gedragen heet, herstel je uit het rapport, niet door de zin anders te verwoorden.

Je werkmap is `{{workDir}}`. Schrijf daar wat je tussendoor wilt bewaren.
