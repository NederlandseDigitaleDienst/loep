---
name: nldd-a11y-quick
description: "Bewaak met loep in een pipeline dat een website niet minder toegankelijk wordt: een snelle meting zonder taalmodel, vergeleken met de vorige release. Gebruik dit bij 'is de site slechter geworden', 'toegankelijkheid in de pipeline', 'CI-check op toegankelijkheid', 'snelle meting', 'basislijn', 'mag niet dalen per release'. Niet voor een onderzoek of een verklaring: daarvoor is nldd-a11y-audit."
metadata:
  status: concept
---

# Snelle meting

Je zet een meting op die bij elke release zegt of de site slechter is geworden dan de vorige keer. Ze duurt ongeveer een halve minuut per pagina, gebruikt geen taalmodel en verstuurt niets naar de site.

Dit is geen onderzoek. Vraagt de gebruiker of de site aan WCAG voldoet, of wil hij een rapport of een verklaring, gebruik dan `nldd-a11y-audit`.

## Wat je nooit doet

- **Zeggen dat de site toegankelijk is.** De meting vindt ongeveer een kwart van wat een onderzoek afkeurt. Een lege lijst en een groene pipeline zeggen dat er niets bij is gekomen dat een meetprogramma ziet.
- **De basislijn vervangen als de meting slechter is.** Dat besluit neemt de gebruiker. Jij laat zien wat slechter is.
- **Een onderzoek beginnen in de map van een snelle meting.** `explore` weigert die map. Een onderzoek krijgt een eigen map.
- **De uitkomst gebruiken voor een toegankelijkheidsverklaring.**

## Stappen

`LOEP` is `node <map van deze plugin>/toolbox/src/cli.ts`. Ontbreken de pakketten of de browsers, draai dan eerst `just install` in de map van de plugin.

1. **Vraag welke pagina's bewaakt worden.** Vijf tot vijftien adressen die samen de site dekken: de startpagina, elk soort pagina één keer, de pagina's met een formulier. Schrijf ze in een bestand, één adres per regel, bijvoorbeeld `toegankelijkheid/snel/paginas.txt`. Weet de gebruiker het niet, meet dan één keer zonder `--urls`. De meting zoekt dan zelf hooguit 15 pagina's, en de adressen in `summary.json` zijn je voorstel.

2. **Meet de basislijn.**

   ```
   LOEP quick https://voorbeeld.nl --out <map> --urls toegankelijkheid/snel/paginas.txt
   ```

   De map moet nieuw zijn. Lees `<map>/quick/samenvatting.md` en vertel de gebruiker wat erin staat: welke criteria de meetprogramma's aanwijzen, en wat niet is gemeten.

   Zegt de samenvatting dat er iets over de pagina's lag, zoals een cookiemelding, vraag dan welke knop haar sluit en meet opnieuw in een nieuwe map met `--dismiss "<selector van die knop>"`. Zonder dat meten de proeven de melding mee. Gebruik daarna bij elke meting dezelfde `--dismiss`. Bewaar `<map>/quick/summary.json` als `toegankelijkheid/snel/basislijn.json` in de repository van de site.

3. **Vergelijk een volgende release.**

   ```
   LOEP quick https://preview.voorbeeld.nl --out <nieuwe map> --urls <lijst voor de preview> --baseline toegankelijkheid/snel/basislijn.json
   ```

   Pagina's worden vergeleken op hun pad. Een preview op een ander adres heeft dus een lijst met dezelfde paden en haar eigen begin. Het commando eindigt met 1 als een pagina meer plekken heeft die twee of meer meetprogramma's afkeuren of die een proef van loep ziet, of als een pagina uit de basislijn niet gemeten kon worden. Wat één meetprogramma alleen meldt, houdt niets tegen. Zet `--strict` er alleen bij als de gebruiker daarom vraagt: dan faalt de stap ook op een nieuwe link die één regelset afkeurt. Wat er veranderde staat in `quick/verschil.md`. Eindigt het met 2, dan is de meting zelf mislukt en zegt dat niets over de site: lees de foutmelding.

4. **Zet het in de pipeline, als de gebruiker dat wil.** De stap haalt loep op bij een versie, installeert de pakketten en Chromium (de snelle meting gebruikt geen andere browser), start de site of wijst naar de preview, en draait het commando van stap 3. Faalt het commando, dan faalt de stap. Bewaar `quick/verschil.md` en `quick/samenvatting.md` als artefact, zodat iemand kan lezen waarom. Vraag welk systeem de gebruiker heeft en schrijf de stap in de vorm van dat systeem. Verzin geen action of image die niet bestaat.

   ```
   git clone --depth 1 --branch v<versie> https://github.com/NederlandseDigitaleDienst/loep
   (cd loep/toolbox && npm ci && npx playwright install --with-deps chromium)
   node loep/toolbox/src/cli.ts quick "$PREVIEW_URL" --out snel --urls paginas-preview.txt --baseline toegankelijkheid/snel/basislijn.json
   ```

5. **Zeg wanneer de basislijn opschuift.** Na een release die goed is, wordt haar `summary.json` de nieuwe basislijn. Wat is opgelost, kan dan niet ongemerkt terugkomen. Dat is een commit van de gebruiker, niet van jou.

## De uitkomst uitleggen

- **Slechter.** Lees `verschil.md` en open de pagina erbij. Per pagina en criterium staat hoeveel plekken erbij kwamen en volgens hoeveel meetprogramma's. De plekken zelf staan in `summary.json` onder `findings`.
- **Niet bevestigd.** Een pagina die slechter leek, is twee keer gemeten en gaf de tweede keer iets anders. Dat houdt niets tegen. Komt hetzelfde vaak terug, dan laadt dat deel van de pagina wisselend; zeg dat tegen de gebruiker.
- **Niet meer gemeten.** Een pagina uit de basislijn gaf een fout of bestaat niet meer. Is ze bewust weg, haal haar dan uit de lijst en maak een nieuwe basislijn.
- **Zwakke aanwijzingen.** Wat één meetprogramma alleen meldt, of de proef voor tekstafstand. Dat houdt niets tegen. Noem het, en zeg dat het een zwakke aanwijzing is.
- **Een melding die niet klopt.** Is ze slechter gemeld en klopt ze niet, dan beslist de gebruiker: de basislijn opschuiven en zeggen waarom.
- **Niets veranderd.** Zeg erbij wat de meting niet ziet: wat pas na een handeling verschijnt (een menu, een foutmelding), formulieren, documenten, en of een tekstalternatief of kop klopt. Daarvoor is een onderzoek.

Hoe de meting werkt en wat ze waard is, staat in `docs/methode.md` onder "De snelle meting" en in `validatie/snelle-meting/README.md`.
