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

1. **Vraag wat er ingestuurd wordt, en vraag altijd ook naar vroeger.** Eén onderzoek of snelle meting (de map ervan), of alles onder een map. Noemt de gebruiker één onderzoek, vraag dan of er eerdere zijn: in de map ernaast, of waar hij ze bewaart. De verzameling heeft het meest aan oude onderzoeken, omdat ze met andere versies van loep zijn gemaakt. `LOEP contribute --under <map>` telt ze, zonder iets te schrijven of te versturen. Noem het aantal en vraag of ze mee mogen.

2. **Laat zien wat erop komt.** Dit schrijft en verstuurt niets:

   ```
   LOEP contribute --run <map van het onderzoek>
   LOEP contribute --under <map met onderzoeken>
   ```

   Geef de uitvoer door zoals ze is: hoeveel meetbladen, wat erop staat en wat niet. Wil de gebruiker het hele meetblad zien, geef dan `--json` mee. Meldt loep `GEWEIGERD`, stop dan en zeg dat dit bij de makers van loep gemeld moet worden.

3. **Vraag of het mag.** Zeg erbij waar het heen gaat, dat iedereen met schrijfrechten op de verzameling het kan lezen, en dat het in de geschiedenis van git blijft staan ook als het bestand later wordt verwijderd. Ga alleen verder na een uitdrukkelijk ja.

4. **Haal de verzameling op**, in een map buiten het onderzoek:

   ```
   gh repo clone NederlandseDigitaleDienst/loep-meetbladen <map>
   ```

   Lukt dat niet, dan heeft de gebruiker geen toegang. Zeg dat, en dat een beheerder van de verzameling die geeft. Probeer geen andere weg.

5. **Schrijf de meetbladen erin en controleer ze:**

   ```
   LOEP contribute --run <map van het onderzoek> --out <map>/meetbladen
   LOEP contribute --under <map met onderzoeken> --out <map>/meetbladen
   node <map>/check.mjs
   ```

   Een meetblad dat er al staat, heeft dezelfde naam en verandert niets. Faalt de controle, stuur dan niets in en laat zien wat ze meldt.

6. **Stuur in**, vanuit de map van de verzameling:

   ```
   git add meetbladen
   git commit -m "meetbladen: <aantal> onderzoeken"
   git pull --rebase
   git push
   ```

   Zegt git dat er niets te committen is, dan stonden ze er al. Zeg dat.

7. **Zeg wat er is gebeurd:** hoeveel meetbladen er zijn ingestuurd en hoeveel er al stonden. Noem geen site.

## Wat de gebruiker moet weten

- **De site staat erop als een sleutel.** Die wordt gemaakt met een sleutelbestand dat loep bij de eerste keer op deze machine zet en dat er blijft. Twee meetbladen van dezelfde site vanaf deze machine horen daardoor bij elkaar, en niemand anders kan er een adres uit afleiden.
- **Wie het onderzoek al heeft, kan het meetblad erbij terugvinden** aan de maand, de versie van loep en het aantal pagina's.
- **Weghalen kan:** het bestand verwijderen en pushen. Het blijft in de geschiedenis staan.
- **Is het onderzoek van de site van een ander,** dan staat er nog steeds geen site op het meetblad. Wil de gebruiker het toch eerst vragen, dan is dat aan hem.
