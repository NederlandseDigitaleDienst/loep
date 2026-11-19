---
name: nldd-a11y-contribute
description: "Stuur het meetblad van een onderzoek met loep in naar de gedeelde verzameling, ook van onderzoeken van vroeger: wat een onderzoek zegt over loep, zonder de site. Gebruik dit bij 'meetblad insturen', 'bijdragen aan loep', 'mijn oude onderzoeken insturen', 'deel deze run', 'stuur de resultaten naar de verzameling'. Niet voor een rapport of een verklaring delen: op een meetblad staat geen site."
metadata:
  status: concept
---

# Een meetblad insturen

Je stuurt van een afgerond onderzoek of een snelle meting het meetblad in naar de verzameling van loep: de besloten repository `NederlandseDigitaleDienst/loep-meetbladen`. Uit die verzameling wordt gemeten hoe betrouwbaar elke regel van een regelset is, en hoe loep het doet over veel sites.

Een meetblad zegt iets over loep en niets over de site. Er staan regelnummers, criteria, uitkomsten, versies, het taalmodel per rol en aantallen op. Geen adres, geen pagina, geen selector, geen zin uit een oordeel, geen schermafbeelding, en niet wie tekende of besloot.

## Wat je nooit doet

- **Insturen zonder dat de gebruiker ja zei** nadat hij zag wat erop staat. Ook niet aan het eind van een onderzoek, en ook niet omdat het de vorige keer mocht.
- **Iets anders insturen dan meetbladen.** Geen rapport, geen run, geen evaluatie, geen schermafbeelding. De verzameling is daar niet voor.
- **Een site noemen** in een bestandsnaam, een commit, een pull request of een issue. Schrijf hoeveel onderzoeken, niet welke.
- **Een meetblad insturen dat loep weigerde.** loep weigert als er iets van de site op staat. Laat de melding zien en stop.
- **Een meetblad met de hand aanpassen**, of het sleutelbestand lezen, kopiëren of delen.
- **Pushen met `--force`**, of met een andere toegang dan die van de gebruiker zelf.

## Stappen

`LOEP` is `node <map van deze plugin>/toolbox/src/cli.ts`. De verzameling is `NederlandseDigitaleDienst/loep-meetbladen`, tenzij de gebruiker een andere noemt.

1. **Vraag wat er ingestuurd wordt, en vraag altijd ook naar vroeger.** Eén onderzoek of snelle meting (de map ervan), of alles onder een map. Noemt de gebruiker één onderzoek, vraag dan of er eerdere zijn en in welke map ze staan. Kies die map niet zelf: een map hoger kan onderzoeken van andere sites bevatten. Eerdere onderzoeken tellen even zwaar mee als nieuwe: het zijn er meer, een site van toen is niet opnieuw te meten, en samen laten ze zien of een regel na een wijziging in loep betrouwbaarder werd.

2. **Laat zien wat erop komt.** Kies één van de twee. Dit schrijft en verstuurt niets:

   ```
   LOEP contribute --run <map van het onderzoek>
   LOEP contribute --under <map met onderzoeken>
   ```

   `--under` neemt elk afgerond onderzoek onder die map mee, ook het onderzoek dat de gebruiker noemde. Geef de uitvoer door zoals ze is. Het aantal dat telt is het aantal meetbladen: een onderzoek dat in twee mappen staat, geeft er één. Bied aan een heel meetblad te laten zien, met `--run <map> --json`. Meldt loep `GEWEIGERD`, stop dan en zeg dat dit bij de makers van loep gemeld moet worden.

3. **Vraag of het mag.** Zeg erbij:

   - waar het heen gaat, en dat iedereen met toegang tot de verzameling het kan lezen;
   - dat het in de geschiedenis van git blijft staan, ook als het bestand later wordt verwijderd;
   - dat loep bij het eerste meetblad een sleutelbestand op deze machine zet, in `~/.config/loep`, en dat het daar blijft.

   De koppeling met een openbaar rapport staat al in de uitvoer van stap 2. Herhaal haar niet, tenzij de gebruiker die uitvoer niet zag. Ga alleen verder na een uitdrukkelijk ja.

4. **Haal de verzameling op**, in een map buiten het onderzoek. Staat er nog een kloon van een vorige keer, gebruik die dan en draai er `git pull --rebase` in.

   ```
   gh repo clone NederlandseDigitaleDienst/loep-meetbladen <map>
   ```

   Noemde de gebruiker een andere verzameling, kloon die dan met `git clone <adres> <map>`. Lukt het klonen niet, laat dan de melding zien. Zegt ze dat de repository niet bestaat of niet te lezen is, dan heeft de gebruiker geen toegang, en geeft een beheerder van de verzameling die. Probeer geen andere weg.

5. **Schrijf de meetbladen erin en controleer ze**, met hetzelfde commando als in stap 2 en `--out` erbij:

   ```
   LOEP contribute --under <map met onderzoeken> --out <map>/meetbladen
   node <map>/check.mjs
   ```

   loep zegt hoeveel meetbladen nieuw zijn, hoeveel het bijwerkte en hoeveel er al ongewijzigd stonden. Een onderzoek dat eerder is ingestuurd, houdt zijn nummer. Het wordt alleen bijgewerkt als het daarna opnieuw is geëvalueerd, gewogen of getekend. `check.mjs` telt alle meetbladen in de verzameling, ook die van anderen. Faalt de controle, stuur dan niets in, laat zien wat ze meldt en zet de map terug met `git checkout -- meetbladen` en daarna, als eigen commando, `git clean -f meetbladen`.

6. **Stuur in**, vanuit de map van de verzameling. Zijn er geen nieuwe en geen bijgewerkte meetbladen, dan valt er niets in te sturen: sla deze stap over. In het bericht staan de aantallen van loep uit stap 5:

   ```
   git add meetbladen
   git commit -m "meetbladen: <aantal> nieuw, <aantal> bijgewerkt"
   git pull --rebase
   git push
   ```

   Weigert de push omdat iemand anders net instuurde, draai dan `git pull --rebase` en `git push` nog een keer. Elk meetblad is een eigen bestand, dus een conflict hoort niet voor te komen. Komt er toch een, stop dan en laat de melding zien.

7. **Zeg wat er is gebeurd,** met de aantallen van loep uit stap 5: hoeveel meetbladen nieuw zijn ingestuurd, hoeveel er zijn bijgewerkt en hoeveel er al stonden. Zeg erbij dat weghalen kan. Noem geen site.

## Wat de gebruiker moet weten

Zeg dit als de gebruiker ernaar vraagt, of twijfelt bij de vraag in stap 3.

- **De site staat erop als een sleutel.** Die wordt gemaakt met een sleutelbestand dat loep op deze machine zet bij het eerste meetblad dat het schrijft, en dat er blijft. Alleen kijken maakt het niet aan. Twee meetbladen van dezelfde site vanaf deze machine horen daardoor bij elkaar, en niemand anders kan er een adres uit afleiden.
- **Een meetblad is te koppelen aan een openbaar rapport** van hetzelfde onderzoek, door de uitkomsten per criterium naast elkaar te leggen. Zonder openbaar rapport kan dat niet.
- **Weghalen kan:** het bestand verwijderen en pushen. Het blijft in de geschiedenis staan.
- **Is het onderzoek van de site van een ander,** dan staat er nog steeds geen site op het meetblad. Wil de gebruiker het toch eerst vragen, dan is dat aan hem.
