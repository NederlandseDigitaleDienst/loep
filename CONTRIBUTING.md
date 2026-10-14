# Werken aan loep

Voor mensen en voor agents die aan de toolbox werken. Wat de toolbox doet staat in [docs/methode.md](docs/methode.md); wat er nu loopt en wat hierna komt in [PLAN.md](PLAN.md); wat de metingen ons leerden in [validatie/lessen.md](validatie/lessen.md).

Voor iedereen die meedoet, in issues, voorstellen en elders, geldt de [gedragscode van de Nederlandse Digitale Dienst](https://github.com/NederlandseDigitaleDienst/.github/blob/main/CODE_OF_CONDUCT.md).

## Een fout, een vraag of een voorstel

- **Een fout in de toolbox of in een rapport:** open een [issue](https://github.com/NederlandseDigitaleDienst/loep/issues/new/choose). Noem de commit of versie, het commando, wat je verwachtte en wat er gebeurde. Zet geen run, rapport of manifest van een echte site in een issue zonder te kijken wat erin staat: er kan een naam of een sessie in zitten.
- **Een kwetsbaarheid:** niet in een issue. Zie [SECURITY.md](SECURITY.md).
- **Een oordeel dat je niet deelt:** dat is welkom als issue, met het criterium, de plek en de tekst van de norm waarop je je baseert. Een procedure volgt de normtekst, niet de testsite.
- **Code of tekst:** open eerst een issue als het om meer gaat dan een kleine reparatie, zodat we vooraf kunnen zeggen of het past bij [PLAN.md](PLAN.md). Een voorstel (pull request) gaat naar `main`, volgt de afspraken hieronder en haalt de controle. Iemand van het team kijkt het na; hoe besluiten vallen staat in [GOVERNANCE.md](GOVERNANCE.md).

Wat je bijdraagt valt onder de EUPL-1.2, zoals de rest van de repository.

## Afspraken

- **Taal.** Namen in code en commentaar in het Engels. Tekst voor lezers in het Nederlands: rapport, verklaring, procedures, opdrachten aan agents, foutmeldingen, documentatie en commitberichten. Zakelijk, B1 waar het kan, zonder gedachtestreepjes.
- **Geen namen en geen thuismappen.** Geen persoonsnamen en geen paden onder een thuismap in bestanden of commitberichten. Een collega wordt een rol.
- **Commits.** Klein, één onderwerp, nieuwe commits in plaats van herschrijven, bestanden bij naam toevoegen. Een commitbericht noemt geen hulpmiddel waarmee het is geschreven.
- **De vaste controle** moet slagen vóór een push, niet ernaast:
  ```
  cd toolbox && npx tsc --noEmit && node --test 'test/**/*.test.ts' && node src/cli.ts procedures
  ```
  en `just reuse` na een nieuw bestandstype. Bij elke push draait op GitHub een snelle controle (licenties, types, procedures, de tests zonder browser; `just test-quick`). De volledige controle op een schone machine duurt ongeveer 25 minuten en draait op een voorstel, één keer per nacht als er die dag iets is veranderd, en met de hand. Push daarom in één keer wat bij elkaar hoort: elke push naar een voorstel start die 25 minuten opnieuw.
- **Beschrijving in dezelfde commit.** Een wijziging in gedrag werkt in dezelfde commit de beschrijving bij: de methode, de README, de skill, de procedure.
- **Meten voor bouwen.** Tests zeggen dat de code doet wat bedoeld was, niet dat het onderzoek beter wordt. Na een reeks wijzigingen eerst een kleine meting op de criteria die geraakt zijn (`tasks --only`), dan verder. Zet de uitkomst in `validatie/` en werk `validatie/lessen.md` bij: wat er nu is, en of het is gemeten.
- **Een meting draait op een bevroren kopie.** Een eigen werkboom op een vaste commit, zodat verder bouwen de meting niet raakt en het rapport zegt met welke code het is gemaakt.
- **Een grens in een procedure volgt uit de norm.** De testsite laat zien dat iets misgaat, niet wat de regel moet zijn. Noem geen site in een procedure of opdracht.

## Wat nooit mag

- **De sites van de toetsset openen.** Een aantal sites is apart gehouden voor één eindmeting met een bevroren methode. Wie er eerder naar kijkt, maakt die meting waardeloos. Welke het zijn staat niet in deze repository; wie de toolbox onderhoudt, heeft de lijst. Geef de lijst mee aan elke agent die je start; de werkstroom in `skills/nldd-a11y-audit/onderzoek.workflow.js` neemt haar aan als `neverOpen`.
- **Iets versturen op een echte site** zonder een verklaring van wie daarover gaat (`inventory --test-environment ... --declared-by ...`). Vul die verklaring nooit zelf in, en zeg vooraf waar de naam terechtkomt.
- **Inloggen op een echte site, of een wachtwoord aannemen.** Dat doet een mens, met `login`, met een testaccount. Een agent krijgt geen wachtwoord en vult er geen in. Het sessiebestand van een run (`login-session.json`) is een geheim: het komt niet in een commit, een opdracht of een bericht.
- **De sleutel van de testsite lezen** (`toolbox/fixtures/key.json`) als agent die oordeelt.
- **Tekenen namens iemand.** `sign` doet een mens.
- **Een run delen of publiceren zonder te kijken wat erin staat.** Het manifest van een run kan een naam bevatten.

## Agents aan het werk zetten

Een agent krijgt alleen zijn opdrachtbestand en de regels hierboven. De werkstroom voor rondgangen, beoordelaars en verifieerders staat bij de skill. Op een echte site hooguit vier sessies tegelijk: drie agents naast de sessie van wie het onderzoek leidt, tenzij de eigenaar van de site meer toestaat.
