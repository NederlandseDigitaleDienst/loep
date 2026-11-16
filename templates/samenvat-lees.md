# Opdracht: de samenvatting naast het rapport leggen

Het toegankelijkheidsrapport van **{{site}}** opent met een samenvatting voor bestuurders en opdrachtgevers die alleen die tekst lezen. Een ander heeft haar geschreven. Jij bent de tweede lezer: je legt elke zin naast het rapport en zegt of het rapport die zin draagt.

Het rapport staat hier, als tekst en zonder de bijlagen:

```
{{source}}
```

Dit zijn de zinnen van de samenvatting, genummerd:

{{sentences}}

## Wat je per zin doet

Zoek in het rapport de plek waar staat wat de zin zegt. Zoek met de woorden van het rapport, niet met die van de samenvatting, en lees de plek zelf. Ga er niet van uit dat de schrijver gelijk heeft.

Een zin is **gedragen** als alles wat ze beweert in het rapport staat. Je geeft dan één of meer stukken tekst die je letterlijk uit het rapport kopieert en waaruit de zin volgt.

Een zin is **niet-gedragen** als ze op één punt iets anders zegt dan het rapport. Let hierop:

- een andere groep bezoekers dan het rapport bij dit gebrek noemt, of een groep minder zonder dat de zin dat zegt;
- een andere pagina, een ander onderdeel of een andere kerntaak;
- een gebrek dat het rapport niet heeft;
- lichter of zwaarder dan het rapport: "lukt met een omweg" waar het rapport zegt dat een groep vastloopt, of andersom;
- een criterium dat open staat en in de zin als goed of als zonder probleem klinkt;
- een oorzaak, een volgorde of een termijn die het rapport niet geeft;
- een gevolg voor bezoekers dat het rapport niet beschrijft.

Twee dingen tellen niet tegen een zin:

- De zin noemt de status zonder "voorlopig" en zonder iets over tekenen. Dat hoort zo: of de status voorlopig is, staat bij de status zelf, naast de samenvatting, en de schrijver mag er niets over zeggen.
- De zin zegt zelf, in haar eigen woorden, dat ze alleen gaat over wie vastloopt of over wie een omweg nodig heeft, en noemt daarvan elke groep die het rapport noemt. Een groep die volgens het rapport alleen extra moeite heeft, hoeft er dan niet bij. Zegt de zin algemener voor wie een gebrek geldt, wie het treft of wie er last van heeft, dan horen alle groepen erbij die het rapport bij dat gebrek noemt, ook een groep met alleen extra moeite. Ontbreekt er dan één, dan is de zin niet-gedragen. Dat de zin ervoor over omwegen ging, is niet genoeg.

Lees een zin in haar verband: "zij", "daar" en "dezelfde groepen" betekenen wat de zinnen ervoor zeggen.

Twijfel je of het rapport zegt wat de zin zegt, dan is de zin niet-gedragen. Je zegt in één of twee zinnen wat er niet klopt en wat het rapport wel zegt, zodat de schrijver het kan herstellen.

Een zin die alleen iets aankondigt of twee andere zinnen verbindt en zelf niets beweert, is gedragen door de plek van de zin die ze inleidt.

Je verandert de samenvatting niet en schrijft geen betere. Je oordeelt ook niet over wat de samenvatting weglaat.

## Wat je inlevert

Schrijf één JSON-bestand:

```
{{output}}
```

In deze vorm, met een regel voor elke zin:

```json
{
  "reportSha256": "{{reportSha256}}",
  "proposalSha256": "{{proposalSha256}}",
  "taskSha256": "{{taskSha256}}",
  "model": "<het model waarmee je draait, zoals je het zelf kent>",
  "sentences": [
    { "n": 1, "sentence": "<zin 1, letterlijk>", "verdict": "gedragen", "quotes": ["<letterlijk uit het rapport>"] },
    { "n": 2, "sentence": "<zin 2, letterlijk>", "verdict": "niet-gedragen", "noteNl": "<wat er niet klopt en wat het rapport wel zegt>" }
  ]
}
```

`reportSha256`, `proposalSha256` en `taskSha256` neem je letterlijk over. In `sentence` staat de zin waarover je oordeelt, letterlijk zoals hierboven. Een stuk in `quotes` is minstens drie woorden en hooguit 300 tekens lang, en staat teken voor teken zo in het rapport. Kopieer het, typ het niet over. Geef de zin of de paar zinnen waar het staat, niet de alinea eromheen; twee stukken mag ook. Eén plek in het rapport draagt hooguit twee zinnen: een kop of een regel die overal bij past, wijst geen plek aan. Zegt de zin het in andere woorden dan het rapport, zodat het stuk geen woord of getal met de zin deelt, zeg dan bij die zin in `noteNl` in één zin waarom ze eruit volgt. `taskSha256` is een kenmerk dat loep uitrekent, niet de hash van dit bestand.

## Controleren

Draai daarna de controle:

```
{{check}}
```

Ze kijkt of elke zin een oordeel heeft en of elk stuk in `quotes` letterlijk in het rapport staat. Of een zin uit een stuk volgt, ziet ze niet: dat is jouw oordeel, en daarvoor ben je hier. Meldt ze iets, herstel dat in het bestand en draai haar opnieuw. Ze meldt ook hoeveel zinnen je niet-gedragen vond; dat is geen fout van jou en je past je oordeel er niet op aan. Verander verder niets in de run.

Je werkmap is `{{workDir}}`. Schrijf daar wat je tussendoor wilt bewaren.
