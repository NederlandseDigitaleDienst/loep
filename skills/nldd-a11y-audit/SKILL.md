---
name: nldd-a11y-audit
description: "Maak met loep een toegankelijkheidsonderzoek van een website: WCAG 2.2 en 2.1 niveau A en AA, WCAG-EM, EN 301 549. Gebruik dit bij 'toets deze site op toegankelijkheid', 'WCAG-onderzoek', 'toegankelijkheidsrapport', 'onderbouwing voor de toegankelijkheidsverklaring', 'heronderzoek'."
metadata:
  status: concept
---

# Toegankelijkheidsonderzoek

Je maakt een onderzoek dat door scripts en een taalmodel tot stand komt. De scripts bepalen de volgorde, verzamelen het bewijs en controleren elk resultaat. Jij start agents met de opdrachtbestanden die de scripts klaarzetten, en verder niets.

## De regel

**Handel en meet alleen via de sessie van loep, en elke uitspraak wijst naar een vastgelegde waarneming.** In een sessie geeft een agent een commando (`loep <commando>`); het instrument doet de handeling, meet en legt vast. Dat geldt voor jou en voor elke agent die je start.

## Wat je nooit doet

- **De site op een andere manier bezoeken of meten.** Geen andere browser, geen `curl`, geen eigen script. Is er een getal of een waarneming nodig, dan komt die uit een instrument.
- **Een opdrachtbestand aanpassen of zelf een prompt bedenken.** De prompts zijn vaste, versiebeheerde bestanden.
- **Een oordeel vellen in je eigen context.** Elke rondgang, elk oordeel, elke verificatie en elk oordeel van de afmaakronde komt van een aparte agent met een schone context, die alleen zijn opdrachtbestand krijgt.
- **Een resultaat herstellen dat de controle niet haalt.** De agent die het schreef herstelt het zelf; lukt dat niet, dan bestaat het resultaat niet.
- **Kandidaten doorgeven of bevindingen samenvoegen met de hand.** Dat doet de toolbox.
- **Het rapport met de hand bijwerken.** Het rapport wordt gegenereerd uit `evaluation.json`.
- **Ondertekenen namens iemand.** Tekenen doet een mens.
- **Een open punt beantwoorden namens iemand.** Wat een mens moet vaststellen of besluiten, legt die mens zelf vast met `LOEP answer`. Vul nooit zelf een antwoord, een naam of een functie in, ook niet als voorbeeld en ook niet als de gebruiker je het antwoord dicteert: laat de gebruiker het commando zelf draaien.
- **Iets versturen op een echte site.** Versturen mag alleen op een testomgeving die bij `inventory` is opgegeven. Dat vraagt een verklaring van de gebruiker: `--test-environment <origin> --declared-by "<naam>, <functie>"`. Er kan één origin worden verklaard, en dat mag de origin van alleen een ingesloten venster zijn, zoals een chat of formulier van een andere partij op een eigen adres: dan wordt alleen daarheen verstuurd, en naar de rest van de site niets. Neem de origin waar het bericht naartoe gaat; meestal is dat die van het venster zelf. Zeg de gebruiker vóór je erom vraagt wat ermee gebeurt: de naam komt in `manifest.json` van de run, het rapport en de verklaring noemen alleen de functie, en wie de map van de run deelt, deelt ook de naam. Vul de verklaring nooit zelf in.

- **Inloggen, uitloggen of een wachtwoord aannemen.** Voor een site achter een inlog logt de gebruiker zelf in met `LOEP login`, met een testaccount. Vraag nooit om een wachtwoord en neem er geen aan, ook niet als de gebruiker het aanbiedt. Plakt de gebruiker toch een wachtwoord in het gesprek, gebruik het dan niet, herhaal het niet en zet het in geen bestand en geen commando. Zeg de gebruiker dat het nu in het gesprek staat en dat het na het onderzoek moet worden gewijzigd. Lees `RUN/login-session.json` niet en geef het aan geen agent mee. Meldt een commando of een agent dat de inlogsessie is verlopen, vraag de gebruiker dan opnieuw in te loggen en herhaal daarna het commando dat stopte.

## Stappen

`LOEP` is `node <map van deze plugin>/toolbox/src/cli.ts`. `RUN` is de map voor dit onderzoek, bij voorkeur in de repository van de site: `toegankelijkheid/onderzoeken/<datum>`.

Een agent starten betekent steeds: een aparte agent die alleen dit krijgt: "Lees het bestand `<pad>` en voer de opdracht daarin precies uit." In elk opdrachtbestand staat de naam van de sessie van die agent en zijn budget; dat budget is voor die opdracht uitgerekend, en de agent kan het zelf twee keer verlengen. Twee agents delen nooit een sessie.

**Hoe lang het duurt.** Noem nooit een eigen schatting van de duur. Draai na `LOEP inventory` het commando `LOEP estimate --run RUN` (met `--at-once <aantal>` als je meer dan drie agents tegelijk start) en geef de uitkomst door zoals ze er staat: het totaal, de marge en wat de schatting niet dekt. Mag het van de eigenaar met meer agents (zie "Vooraf vragen"), draai het dan voor drie en voor het aantal dat de gebruiker noemde, geef beide uitkomsten, en laat de gebruiker vóór stap 6 kiezen. Vraagt iemand halverwege hoe lang het nog duurt, draai het dan opnieuw; wat klaar is, staat er dan met de gemeten duur. Wie het zonder commando wil weten, voor een site elders met alle criteria: minuten ≈ 27 + 2 × pagina's + (7 × paginatypen + 475) ÷ agents tegelijk, een kwart korter tot 40 procent langer. Daar komt de afmaakronde bij, als er criteria open blijven door het onderzoek zelf: 16 + 16 × dat aantal ÷ agents tegelijk. Hoeveel dat er zijn, weet niemand vooraf; `estimate` toont er een band voor. Waar de getallen vandaan komen staat in `docs/methode.md`.

**Vooraf vragen.** Een paar keuzes liggen vast zodra het onderzoek begint, en alleen de gebruiker kan ze maken. Stel de vragen hieronder in één bericht, vóór het eerste commando van stap 1, en begin pas als ze zijn beantwoord. Daarna loopt het onderzoek uren door zonder de gebruiker; wat je nu niet vraagt, onderbreekt het later of kost een nieuwe run. Wat de gebruiker in de opdracht al zei, vraag je niet opnieuw. Vraag niets wat de toolbox zelf vaststelt, zoals welke pagina's er zijn, of de site lokaal is en of VoiceOver er is (`just doctor`).

- **Inlog.** Staat de site, of een deel dat erbij hoort, achter een inlog? Op een site die niet lokaal is, kan inloggen alleen op een testomgeving, met een verklaring van de gebruiker dat het er een is (zie "Versturen" hieronder). Geef hier geen wachtwoord: je logt straks zelf in, in een browservenster. Voor een inlog is verder nodig: een testaccount en nooit een echt account, want schermafbeeldingen komen in het rapport; een rol en geen naam, want de rol komt in het manifest en in het rapport; en de gebruiker zelf aan een machine met een scherm, om vóór `inventory` twee keer in te loggen (stap 1). Een inlog kan verlopen; de gebruiker moet dan bereikbaar zijn om opnieuw in te loggen. Zonder inlog wordt wat erachter staat niet onderzocht.
- **Versturen.** Mag dit onderzoek versturen? Het gaat om alles wat pas iets laat zien nadat het is verstuurd: een formulier (een aanvraag, een contactformulier), een zoekfunctie die haar vraag met POST verstuurt, en een chat of formulier in een ingesloten venster op een ander adres dan de site, dat pas na een verstuurd bericht antwoordt. Er zijn drie antwoorden:
  - *De hele site is een testomgeving.* Dan is het `--test-environment <origin van de site>`, en versturen de agents waar de procedure dat vraagt.
  - *Alleen het adres dat het bericht ontvangt.* Bijvoorbeeld dat van de chat, of van de dienst waar de chat zijn berichten heen stuurt: `--test-environment <die origin>`. Er kan één origin worden verklaard; de rest van de site krijgt dan geen verzoeken die iets kunnen wijzigen. Meestal is het de origin van het venster zelf.
  - *Er wordt niets verstuurd.* Wat pas na versturen te zien is, blijft dan open als `versturen niet toegestaan`. Bij 3.3.1, 3.3.3 en 3.3.4 (wat de server na het versturen meldt of vraagt), 3.3.7 (een stap na het versturen), 2.4.3 (waar de focus daarna heen gaat) en 4.1.3 (de melding na een verzending, of een nieuw bericht in een chat) ligt de kern van het criterium daar. Heeft de site zo'n formulier of chat, dan blijven die criteria open, en blijft de status C. Bij nog zo'n twintig criteria is het deel na het versturen dan een beperking.

  Op een site op je eigen machine mag versturen met `--allow-writes`; dat vraag je niet. Elke andere verklaring vraagt een naam en een functie (`--declared-by "<naam>, <functie>"`): zeg erbij waar de naam terechtkomt (zie "Wat je nooit doet"). De verklaring ligt vast bij `inventory`: later toestaan kan alleen met een nieuwe run.
- **Agents tegelijk.** Is de gebruiker de eigenaar van de site, of heeft de gebruiker toestemming van de eigenaar om meer agents tegelijk te laten werken? Op een echte site werken er drie tegelijk (vier sessies), om de site niet te overbelasten. Met 56 criteria per fase bepaalt dat aantal het grootste deel van de duur. Is het antwoord ja, vraag dan hoeveel er ten hoogste tegelijk mogen. Noem geen eigen duur: wat het scheelt, zegt `LOEP estimate` na `inventory` (zie "Hoe lang het duurt"). Het aantal ligt vast per fase; later verhogen kan alleen tussen twee fasen. Voor een site op je eigen machine hoef je dit niet te vragen.
- **Afbakening.** Hoort alles op het domein bij het onderzoek? `inventory` volgt elke link op hetzelfde domein, tot 200 pagina's. Hoort een deel er niet bij (een archief, een ander loket), zet dan na `inventory` de adressen die wel horen uit `RUN/inventory.json` in een bestand, en draai `inventory` opnieuw met `--urls <bestand>` in een nieuwe map. Vraag ook of er sites zijn die geen agent mag openen; die geef je de werkstroom mee als `neverOpen` (stap 6).
- **Voor het rapport.** Hoe heet de site in het rapport, en van welke organisatie is ze (`evaluate --name` en `--organisation`, stap 7)? Is ze gebouwd met componenten van een leverancier of een designsysteem, en met welke letters beginnen de namen van die elementen (`--vendor-tags`, stap 2)? Dat laatste ligt vast bij `inventory`; weet de gebruiker het niet, ga dan zonder door.

1. **Eerste keer**: `just install` in de map van de plugin, en `just doctor` om te zien welke hulpprogramma's ontbreken (`just tools` installeert ze op macOS). De taken `just explore`, `sweep`, `tasks` en `report` in dezelfde map draaien dezelfde commando's als hieronder, voor wie het met de hand doet; deze skill roept de commando's zelf aan, omdat de afsluitcode van `gate` de volgende stap bepaalt.

   **Staat de site achter een inlog?** Dat heb je vooraf gevraagd. Dan logt de gebruiker in voordat je pagina's zoekt. Zeg vooraf: gebruik een testaccount en nooit een echt account, want schermafbeeldingen komen in het rapport; de rol die je opgeeft komt in het manifest en in het rapport, dus geef een rol en geen naam. Laat de gebruiker dit zelf draaien, in een terminal op een machine met een scherm: `LOEP login --run RUN --url <inlogpagina> --role "<rol van het testaccount>"`. Het is een stap van de gebruiker en geen commando in jouw reeks. Er opent een browservenster. De gebruiker logt in, gaat naar een pagina die alleen ingelogd te zien is en drukt in de terminal op Enter. Draait het onderzoek op een machine zonder scherm, dan logt de gebruiker elders in met `LOEP login --url <inlogpagina> --out <bestand>` en zet jij het bestand in de run met `LOEP login --run RUN --from <bestand>`. Op een site die niet lokaal is, weigert `inventory` een run met een inlog tenzij de gebruiker een testomgeving verklaart (`--test-environment` en `--declared-by`, zie "Wat je nooit doet"). Daarna gaat alles zoals hieronder: elke browser begint ingelogd, en de agents weten uit hun opdracht dat ze ingelogd zijn en niet mogen uitloggen.

   **Tweede inlog voor de sessieproef (2.2.1).** Vraag de gebruiker direct na de eerste inlog, vóór `collect`, nog een keer in te loggen: `LOEP login --run RUN --idle --url <inlogpagina>` (of elders `LOEP login --url <inlogpagina> --out <bestand>` en hier `LOEP login --run RUN --idle --from <bestand>`). Zonder `--url` haalt het commando het adres uit de inventaris; vóór `inventory` is die er nog niet. Hetzelfde testaccount mag. Die tweede sessie staat in `idle-session.json`, met dezelfde regels als de eerste, en alleen de sessieproef gebruikt haar: de meting zelf houdt de eerste sessie bezig, waardoor die nooit stil ligt. `collect` start de proef op de achtergrond en `evaluate` stopt haar; je hoeft er verder niets voor te doen. Zonder tweede inlog draait de proef niet, en blijft de duur van de sessie een keuze van de eigenaar (`keuze nodig`).

2. **Pagina's vinden** (geen taalmodel):
   ```
   LOEP inventory <url> --out RUN
   LOEP sample --run RUN
   ```
   Controleer dat het aantal pagina's klopt met wat je van de site verwacht. Meld het de gebruiker als pagina's zijn overgeslagen.
   Meldt `inventory` dat pagina's een wachtwoordveld tonen terwijl er niet is ingelogd, vraag de gebruiker dan nu of het deel achter die inlog erbij hoort. Zo ja: laat inloggen (stap 1) en begin opnieuw met `inventory` in een nieuwe map. Dit is het laatste moment waarop dat weinig kost; na de verkenning moet alles opnieuw. Een inlog op een ander domein ziet `inventory` niet; die moet uit de vragen vooraf komen.
   Meldt `inventory` in een run die niet mag versturen dat pagina's een eigen formulier hebben, of dat een ingesloten venster op een ander adres er een heeft, en is versturen vooraf niet besproken, vraag het de gebruiker dan nu (zie "Versturen" bij de vragen vooraf). Mag het op een testomgeving, begin dan opnieuw met `inventory` in een nieuwe map, met de verklaring. Een chat zonder formulierelement ziet `inventory` niet.
   Heeft de gebruiker vooraf gezegd met welke letters de namen van de elementen van een leverancier of een designsysteem beginnen, geef dat dan mee: `LOEP inventory <url> --out RUN --vendor-tags "nldd-" --vendor-name "designsysteem"`. Het rapport zet dan per element van de leverancier de bevindingen die het raken in een eigen lijst. Dat zegt waar een gebrek zit, niet wie het herstelt: de oorzaak kan in het component liggen of in het gebruik ervan. Zonder die invoer kan het onderzoek niet weten wat van de leverancier is.

3. **Verkennen.** Een agent brengt in kaart wat over de pagina ligt en welke onderdelen pas na een handeling iets tonen.
   ```
   LOEP explore --run RUN
   ```
   Start één agent met `RUN/explore/verken.md`. Daarna:
   ```
   LOEP check-site --run RUN
   ```
   Meldt de controle fouten, laat dezelfde agent ze herstellen. Trek daarna de steekproef opnieuw, want het sitemodel zegt welke ingesloten vensters meetellen en welke geen pagina horen te zijn:
   ```
   LOEP sample --run RUN
   ```

4. **Vegen** (geen taalmodel). Zegt `just doctor` dat de virtuele Mac met VoiceOver er is (de regel `virtuele Mac met VoiceOver (loep voiceover)` staat op `aanwezig`), start hem dan nu, op de achtergrond en tegelijk met de veegronde: `LOEP voiceover start`. Opstarten duurt 9 tot 20 minuten; zo is hij klaar voordat de beoordelaars beginnen. Beoordelaars, verifieerders en de afmaakronde laten VoiceOver dan zelf voorlezen waar de nagebootste schermlezer het niet kan vaststellen. Lukt het starten niet, of is er geen virtuele Mac, ga dan gewoon door: alles werkt zoals zonder. Stop hem na de laatste fase met agents (stap 6) met `LOEP voiceover stop`; hij neemt 2 tot 6 GB geheugen.

   De scripts meten elke pagina, met meldingen open en gesloten en met elk onderdeel geopend. Daarna halen ze de documenten van de steekproef op (pdf, kantoorbestanden en platte tekst op de site zelf) en meten die; staan er geen documenten op de site, dan doet dat laatste commando niets:
   ```
   LOEP collect --run RUN
   LOEP contrast --run RUN
   LOEP states --run RUN
   LOEP documents --run RUN
   ```
   Draai je de eerste drie een tweede keer, na een vervolgronde van de verkenner, dan meten ze alleen wat veranderd is: een pagina waarvan de inhoud en de blokkades gelijk zijn gebleven en een toestand waarvan het recept gelijk is gebleven, houden hun metingen. Met `--fresh` achter elk commando wordt alles opnieuw gemeten; doe dat na een nieuwe versie van de toolbox.

5. **Bewijspoort.** Is het bewijs bruikbaar?
   ```
   LOEP gate --run RUN
   ```
   - Afsluitcode 0: voldoende, ga door.
   - Afsluitcode 2: de vaste controles zijn in orde, de beelden zijn nog niet bekeken. Start één agent met het opdrachtbestand dat het commando noemt; noemt het er meer dan één (elk paginatype heeft een blad, en een opdracht telt hooguit acht bladen), start dan per bestand een eigen agent. Draai als ze klaar zijn `LOEP check-gate --run RUN` en daarna opnieuw `LOEP gate --run RUN`.
   - Afsluitcode 1: onvoldoende. Ga terug naar stap 3: `LOEP explore --run RUN` schrijft dan een vervolgopdracht met de gaten erin. Daarna opnieuw stap 4 en 5. Dat mag **hooguit twee keer**. Is het bewijs dan nog onvoldoende, stop dan: meld de gebruiker "bewijs onvoldoende" met de gaten uit `RUN/gate.json`. Er komt geen beoordeling.

6. **Rondgang, beoordelen, verifiëren en afmaken.** Vier fasen, steeds met dezelfde twee commando's:
   ```
   LOEP tasks --run RUN
   LOEP pending --run RUN
   ```
   `tasks` schrijft de opdrachtbestanden van de fase waarin de run is. `pending` zegt als JSON welke fase dat is (`phase`) en welke opdrachten nog open staan, met per opdracht het pad (`task`).
   - `phase: "walks"`: start per paginatype één agent met zijn opdracht. Elke agent loopt één paginatype door en schrijft kandidaten op.
   - `phase: "judges"`: start per criterium één agent met zijn opdracht. De kandidaten uit de rondgang staan dan al bij het juiste criterium.
   - `phase: "verifiers"`: start per criterium één agent met zijn opdracht. Die maakt elke bevinding opnieuw en schrijft het eindoordeel.
   - `phase: "finishers"`: de afmaakronde. Ze komt alleen als een criterium na de verificatie open bleef door het onderzoek zelf (iets was niet gemeten, een proef stopte bij een grens, een budget was op) of als er na twee pogingen geen oordeel kwam. Start per criterium uit de lijst `finishers` één agent met zijn opdracht. Die meet zelf wat ontbrak, met een budget van ten minste 280 commando's en 105 minuten, en komt tot een oordeel. Dat oordeel is dan het eindoordeel; het eerdere blijft bewaard.
   - `phase: "done"`: stop de virtuele Mac als je hem in stap 4 startte (`LOEP voiceover stop`) en ga door met stap 7. Bleef er geen criterium open door het onderzoek zelf, dan volgt `done` direct op `verifiers`.

   Elke agent van deze stap heeft een eigen sessie, en het sessieproces van de run laat een vast aantal sessies tegelijk toe. Dat aantal ligt vast als het proces start. Start het daarom zelf, vóór de eerste agent van elke fase:
   ```
   LOEP session start --run RUN --session regie --max-sessions 4
   ```
   Dat geeft jou een eigen sessie, `regie`. Ze telt mee, en zolang ze openstaat houdt het proces dit maximum. Zonder haar stopt het proces zodra de laatste agent zijn sessie stopt, en start de volgende agent het opnieuw met de standaard van vier. Start dus hooguit het maximum min één agents tegelijk: drie bij `--max-sessions 4`. Vier sessies is de standaard en wat je op een echte site aanhoudt. Alleen als de gebruiker vooraf zei dat de eigenaar meer toestaat, of op een testsite op je eigen machine, kies je een hoger getal met dezelfde som: `--max-sessions 11` voor tien agents. Het antwoord noemt onder `limits.maxSessions` wat het proces toelaat. Staat er een `warning` bij, dan liep het proces al met een ander maximum: reken met dat getal, of stop alle sessies met `LOEP session stop --run RUN` en start opnieuw. Stop je eigen sessie na de laatste fase: `LOEP session stop --run RUN --session regie`.

   Kan je omgeving werkstromen met meerdere agents draaien, gebruik dan `onderzoek.workflow.js` in de map van deze skill: die doet precies deze lus (opdrachten klaarzetten, per opdracht een agent, overslaan na twee mislukte pogingen) voor alle vier de fasen, tot de toolbox meldt dat alles klaar is. Ze houdt steeds het volle aantal agents aan het werk: zodra er één klaar is begint de volgende, en nooit lopen er meer dan `atOnce`. Geef mee: het pad van de CLI, het pad van de run, het aantal agents tegelijk (`atOnce`: het maximum van het sessieproces min één, dus `atOnce: 3` bij `--max-sessions 4`; dat is ook de standaard van de werkstroom) en de sites die volgens de gebruiker geen agent mag openen (`neverOpen`), als die er zijn.

   Draai na elke fase opnieuw `LOEP tasks` en `LOEP pending`. Draai `LOEP tasks` niet terwijl er nog agents van die fase bezig zijn: een opdracht die opnieuw moet, krijgt dan een nieuwe sessienaam, en een agent die nog met de oude naam werkt, haalt de controle niet meer. Een sessie houdt haar budget en haar klok de hele run; daarom krijgt elke nieuwe poging een eigen sessie (`b-143-2`). Binnen een fase mogen agents tegelijk lopen, hooguit drie naast je eigen sessie: meer sessies laat het sessieproces niet toe zonder hoger maximum, en een kleine site mag niet worden overbelast. Een oordeel waarvan het bewijs, de procedure, de opdracht of een aangehaalde waarneming is veranderd, komt vanzelf terug in `pending`.

   Levert een agent na twee pogingen geen geldig resultaat, leg dat dan vast, zodat de volgende fase kan beginnen:
   ```
   LOEP skip --run RUN --page-type <id> --reason "<waarom>"
   LOEP skip --run RUN --criterion <id> [--round final|finish] --reason "<waarom>"
   ```
   Een criterium waarvan de beoordelaar of de verifieerder is overgeslagen, krijgt daarna een afmaakronde. Wordt ook die overgeslagen (`--round finish`), dan blijft het criterium open of "niet beoordeeld", en zegt het rapport dat het onderzoek niet af is.

7. **Samenvoegen en rapport maken**:
   ```
   LOEP evaluate --run RUN --name "<naam van de site>" --organisation "<organisatie>" --model "<model-id>"
   LOEP render --run RUN
   LOEP seal --run RUN
   ```
   De naam en de organisatie zijn wat de gebruiker vooraf opgaf. Geef bij `--model` het model op waarmee de agents volgens jou draaiden. Elke agent geeft daarnaast zelf zijn model op als hij zijn sessie start (`session start --model`, zoals zijn opdracht zegt; de agent van de poort in zijn antwoord). Het rapport toont per rol wat de agents opgaven en zegt het als dat verschilt van wat jij opgaf. De toolbox kan geen van beide controleren.

   `evaluate` neemt per criterium het eindoordeel van de verificatie, of dat van de afmaakronde als die er was, telt de antwoorden van een persoon mee (stap 9), bewaart vervallen bevindingen met hun reden, en voegt bevindingen over dezelfde plek samen tot één gebrek. Het meldt door wie of wat de uitkomsten zijn vastgesteld en welke criteria open zijn. Staat er `LET OP: het onderzoek is niet af`, dan zijn er criteria die door het onderzoek zelf niet zijn vastgesteld: ga terug naar stap 6 (`LOEP tasks` en `LOEP pending`) en laat de afmaakronde lopen voordat je het rapport laat lezen. Wil je ook het voorstel voor verder samenvoegen: start één agent met `RUN/tasks/samenvoeg/taak.md`, draai `LOEP check-merge --run RUN` en daarna `LOEP merge --run RUN`, vóór `render`. Het rapport staat in `RUN/report/` en draagt het etiket "Concept, niet afgetekend": `rapport.md`, `rapport.pdf` en `rapport-kort.pdf`, hetzelfde rapport zonder bijlage A.

   `seal` komt als laatste: het legt de hash vast van elk bestand in de run, ook van de evaluatie, van de antwoorden van een persoon en van dit conceptrapport. Wat de gebruiker in stap 10 tekent, is dat zegel. Draai je daarna nog `evaluate`, `merge` of `render`, of legt iemand nog een antwoord vast, verzegel dan opnieuw voordat iemand tekent.

   Is er een eerder onderzoek van dezelfde site, geef dan bij `evaluate` ook `--previous <evaluation.json van toen>` mee: een bevinding op dezelfde plek houdt dan haar nummer. `LOEP diff --previous <toen> --current RUN/evaluation.json --out <map>` schrijft daarnaast `verschil.md` met wat is opgelost, gebleven en nieuw. Dat is een werkdocument en geen deel van het rapport.

8. **Laten zien.** Geef de gebruiker de uitkomst per criterium met erbij door wie of wat ze is vastgesteld (de verificatie, de afmaakronde of een persoon), en de beperkingen. Geef de telling van de open criteria door zoals het rapport haar bovenaan geeft: hoeveel een mens of een keuze van de eigenaar vragen, hoeveel daarvan alleen wachten op toestemming om te versturen, en hoeveel door dit onderzoek niet zijn vastgesteld. Dat tweede getal hoort nul te zijn; is het dat niet, zeg dan dat het onderzoek niet af is en welke criteria het zijn. "Geen afwijking gevonden, niet volledig gemeten" is ook open en telt niet als "voldoet". Maak het niet mooier dan het is: een goedkeuring betekent dat in het onderzochte bewijs geen afwijking is gevonden, en een oordeel uit de afmaakronde heeft geen verifieerder gehad.

9. **Wat een mens moet vaststellen.** Een criterium dat nog open is, wacht op een mens: iets wat geen instrument kan vaststellen (`mens nodig`) of een keuze van de eigenaar (`keuze nodig`). Het rapport noemt die punten volledig onder "Nog uitzoeken". Een punt `versturen niet toegestaan` wacht niet op een mens: het rapport zegt erbij welke verklaring bij `inventory` het had gesloten, met de origin als de punten die noemen. Wil de eigenaar dat, dan is dat een nieuw onderzoek met die verklaring, en geen antwoord met `answer`. Wie het werk doet (luisteren met een schermlezer, een besluit nemen), legt het antwoord zelf vast. Zeg vooraf waar naam en functie terechtkomen: de naam staat alleen in `RUN/antwoorden/<criterium>.json`; `evaluation.json`, het rapport en de verklaring noemen alleen de functie; het bestand valt onder het zegel, en wie de map van de run deelt of publiceert, deelt ook de naam.
   ```
   LOEP answer --run RUN --criterion <id>
   LOEP answer --run RUN --criterion <id> --point <nummer> --did "<wat is gedaan of besloten>" --outcome passed|failed|inapplicable --name "<naam>" --role "<functie>"
   ```
   Het eerste commando toont de open punten met hun nummer; dat mag je zelf draaien. Het tweede draait de gebruiker zelf, één keer per punt: het is een stap van de gebruiker en geen commando in jouw reeks. `--outcome` is wat het antwoord betekent voor het criterium op dat punt. Een punt dat niet voldoet, keurt het criterium af. Zijn alle open punten van een criterium beantwoord zonder afkeuring, dan voldoet het. Het commando weigert zolang het criterium nog een afmaakronde te goed heeft: eerst meet een instrument wat een instrument kan meten. Draai daarna stap 7 opnieuw (`evaluate`, `render`, `seal`); het rapport zegt bij het criterium "vastgesteld door een persoon, niet door een instrument", met de functie.

   Deze stap mag worden overgeslagen: dan blijven die criteria open en blijft de status C.

10. **Tekenen** doet de gebruiker zelf, na het lezen van het rapport in `RUN/report/`. Zeg vooraf waar naam en functie terechtkomen: in `RUN/signed/signature.json`, in het afgetekende rapport en in de verklaring.
   ```
   LOEP sign --run RUN --name "<naam>" --role "<functie>" --organisation "<organisatie>"
   LOEP render --run RUN
   LOEP verify --run RUN
   ```
   `sign` weigert als de run niet is verzegeld of na het verzegelen is veranderd; verzegel dan opnieuw en laat het rapport opnieuw lezen. De handtekening komt in `RUN/signed/signature.json` en noemt de hash van het zegel en van de evaluatie. Ze staat buiten het zegel: tekenen verandert niets aan wat verzegeld is. `render` schrijft daarna het rapport dat zegt wie tekende in `RUN/signed/`; het concept in `RUN/report/` blijft zoals het is gelezen. `verify` moet daarna nul afwijkingen melden en zeggen dat er is afgetekend.

   Wordt een afgetekende run opnieuw verzegeld nadat er iets is veranderd, dan vervalt de handtekening: `seal` verwijdert `RUN/signed/` en zegt dat. Er moet dan opnieuw worden gelezen en getekend.

## Terugmelden aan loep

Een criterium dat open blijft door loep zelf, is een fout in loep en geen uitkomst voor de site. Wie loep maakt, moet dat horen, anders gebeurt het bij de volgende site weer. Doe dit na stap 8, ook als de gebruiker stap 9 en 10 overslaat.

1. Draai `LOEP feedback --run RUN --out <map buiten de run>`. Buiten de run, want wat er na het zegel bij komt, ziet `verify` als afwijking. Het schrijft per criterium en per soort één tekst voor een issue: elk criterium dat door dit onderzoek niet is vastgesteld (`veegronde mist`, `budget op`, `proef werkte niet`, of geen oordeel), met de versie van loep en van de procedure. Een punt `versturen niet toegestaan` krijgt geen tekst: niet mogen versturen is een keuze van de eigenaar en geen fout in loep. Het commando noemt die criteria wel apart. Adressen, de naam en de organisatie van de site zijn eruit gehaald. Zegt het "Niets terug te melden", dan is dit klaar.
2. Laat de gebruiker de teksten lezen voordat er iets weggaat. Zeg erbij dat een issue openbaar is, en dat de punten door een agent zijn geschreven: er kan nog in staan welke site het is, zoals de naam van een dienst of een uniek stuk tekst. Haal weg wat de gebruiker niet openbaar wil. Verstuur niets zonder ja van de gebruiker.
3. Zoek per tekst of het issue er al is. De titel blijft van run tot run gelijk, dus zoek op die titel:
   ```
   gh issue list --repo NederlandseDigitaleDienst/loep --state all --search "\"<titel>\" in:title"
   ```
   Staat het er open, zet de tekst dan als reactie onder dat issue (`gh issue comment <nummer> --repo NederlandseDigitaleDienst/loep --body-file <bestand>`): zo is te zien hoe vaak het voorkomt. Is het gesloten, maak dan een nieuw issue en zet `Eerder: #<nummer>` bovenaan de tekst. Staat het er niet, maak het dan (`gh issue create --repo NederlandseDigitaleDienst/loep --title "<titel>" --label bug --body-file <bestand>`). Zonder `gh` geef je de gebruiker per tekst de titel, het bestand en de link https://github.com/NederlandseDigitaleDienst/loep/issues/new?labels=bug om het zelf te plakken.

Ook dit meld je, met hetzelfde ja van de gebruiker en zonder het adres van de site tenzij de gebruiker dat wil:

- **Een oordeel dat niet klopt.** Zegt de gebruiker dat loep een afwijking zag die er niet is, of er een miste, dan is dat een fout in loep: het formulier "Fout", met het criterium, wat loep zei en wat het had moeten zijn.
- **Een punt `mens nodig` dat een instrument had kunnen meten.** Denk je dat, dan is dat een voorstel: het formulier "Voorstel", met wat er gemeten had moeten worden. Bleef het punt alleen open omdat de run niet mocht versturen, dan had het `versturen niet toegestaan` moeten heten: dat is een fout, het formulier "Fout".

**Eerst zoeken, dan pas een nieuw issue.** Dat geldt voor elke melding, ook voor een fout of een voorstel zonder vaste titel. Zoek op het criterium en een paar woorden die het gedrag beschrijven, in open en gesloten issues: `gh issue list --repo NederlandseDigitaleDienst/loep --state all --search "<criterium> <woorden>"`. Lees wat je vindt.

- Een open issue over hetzelfde: zet een reactie eronder met wat deze run toevoegt (de versie van loep, wat er anders of nieuw is). Maak geen tweede issue.
- Een gesloten issue dat terugkomt: maak een nieuw issue en noem het oude erin (`Eerder: #<nummer>`). De oplossing van toen was dan niet genoeg.
- Twijfel je of het hetzelfde is, laat de gebruiker dan kiezen: de gevonden issues met hun titel, en wat jij zou doen.

## Als iets niet lukt

- `LOEP collect`, `contrast`, `states`, `gate` of `tasks` meldt dat de run geen sitemodel heeft: stap 3 is overgeslagen. Zonder verkenning wordt er niet gemeten en niet beoordeeld; ga terug naar stap 3.
- De verkenner of de poort stuit in een run zonder inlog op een inlogscherm dat bij het onderzoek hoort: vraag de gebruiker of dat deel erbij moet. Zo ja, dan begint het onderzoek opnieuw met `LOEP login` en `LOEP inventory` in een nieuwe map; zo nee, ga door, en het rapport zegt dat er niet is ingelogd.
- Een pagina laadt niet: de toolbox probeert het één keer opnieuw en meldt het. Onderzoek de pagina niet op een andere manier.
- Een agent levert geen geldig resultaat: start die ene opdracht opnieuw met hetzelfde opdrachtbestand. Na twee pogingen: `LOEP skip`.
- Een agent meldt "budget op": dat hoort niet meer voor te komen zonder twee verlengingen. Een agent verlengt zijn eigen sessie met `session extend --reason "<wat er nog gemeten moet worden>"`, hooguit twee keer, en `LOEP check-verdict` weigert een punt `budget op` van een sessie die dat niet deed. Stopt een agent toch op zijn budget zonder te verlengen, start die opdracht dan opnieuw met hetzelfde opdrachtbestand. Staat `budget op` in een geldig oordeel, dan is het een uitkomst en geen fout: het oordeel zegt wat niet is bekeken, en het criterium krijgt daarna een afmaakronde. Verhoog nooit zelf een budget en verleng nooit de sessie van een agent.
- Na het onderzoek: `LOEP gaps --run RUN` zet alle open punten per soort en per criterium op een rij, ook die de afmaakronde nog sloot. Wat open bleef door loep zelf, meld je zoals onder "Terugmelden aan loep".
- `LOEP evaluate` meldt dat het onderzoek niet af is: draai `LOEP tasks --run RUN` en `LOEP pending --run RUN`. Staat de run op `finishers`, start dan de afmaakronde. Staat hij op `done`, dan is de afmaakronde al geweest of overgeslagen: het punt kan alleen nog door een mens worden gesloten (stap 9).
- Een sessie blijft hangen: `LOEP session list --run RUN` toont de sessies, `LOEP session stop --run RUN --session <naam>` stopt er één.
- Een agent meldt dat er al te veel sessies lopen: er zijn meer agents tegelijk gestart dan het sessieproces toelaat, of een eerdere agent heeft zijn sessie niet gestopt. Start minder agents tegelijk (het maximum min één) en stop sessies die zijn blijven hangen. Verhoog het maximum alleen als de eigenaar van de site dat toestaat.
- `LOEP verify --run RUN` meldt een afwijking: er is na het verzegelen iets gewijzigd, toegevoegd of verdwenen. Het rapport is dan niet meer herleidbaar; draai de stappen vanaf de wijziging opnieuw, verzegel opnieuw en laat opnieuw tekenen.
- `LOEP sign` meldt dat het onderzoek niet is verzegeld of na het verzegelen is veranderd: draai `LOEP seal --run RUN` (na een wijziging eerst `LOEP render --run RUN`) en laat de gebruiker het rapport lezen dat er dan ligt.
