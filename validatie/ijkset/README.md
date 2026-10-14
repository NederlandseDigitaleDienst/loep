# IJkset: de instrumenten gemeten op de testgevallen van de ACT-regels

De toolbox legt vier regelsets (axe-core, Alfa, IBM, QualWeb) en eigen metingen naast elkaar. Deze map bevat de metingen van hoe vaak elk daarvan gelijk heeft, op de testgevallen die W3C bij de ACT-regels onderhoudt. Per datum een map met de uitkomst. De testgevallen zelf staan hier niet.

## Draaien

```
just calibrate
```

Dat haalt de testgevallen op (één verzoek, ongeveer 90 MB, één keer), controleert de hash van de lijst, serveert de pagina's vanaf de eigen machine en meet elke pagina met alles wat er iets over kan zeggen. Een volledige meting duurt ongeveer vijf minuten. Ze hoort niet bij een onderzoek en niet bij de vaste controle. Met `--only` gevolgd door de nummers van ACT-regels meet je een deel; de uitkomst zegt dan dat ze niet volledig is.

De gevallen komen in een map buiten de repository: de map uit de omgevingsvariabele `LOEP_ACT_CACHE`, en anders `loep/act-rules` onder de cachemap van de gebruiker. Tijdens het meten wordt elk verzoek naar buiten de eigen machine geweigerd, en een pagina die de bezoeker na een tijd doorstuurt, blijft staan zoals ze is geserveerd.

## Bestanden per meting

| Bestand | Inhoud |
|---|---|
| `uitkomst.md` | De leesbare uitkomst: bron en hashes, versies, totalen per instrument, de regelsets naast elkaar, en een tabel per ACT-regel |
| `uitkomst.json` | Dezelfde uitkomst als gegevens, met de gevallen waarop de regelsets het oneens zijn |
| `gevallen.json` | Per testgeval de verwachte uitkomst en wat elk instrument zei. Alleen het nummer van de regel en van het geval; de pagina zelf niet |

## Bron

De ACT-regels worden geschreven in de repository `act-rules/act-rules.github.io`. De testgevallen staan daar als voorbeelden in de tekst van elke regel. Bij elke wijziging maakt een script er losse pagina's en één lijst van, en zet die in de repository `w3c/wcag-act-rules`, in de map `content-assets/wcag-act-rules`. W3C serveert die map op `www.w3.org/WAI/content-assets/wcag-act-rules/`. De lijst heet `testcases.json`; de pagina's verwijzen naar hun hulpbestanden (beeld, video, geluid, scripts) met dat pad. De meting haalt de tweede repository op, op een vaste commit; de commit en de hash van de lijst staan in `toolbox/src/commands/calibrate.ts` en in elke uitkomst.

In dezelfde repository staat per regelset het implementatierapport dat W3C publiceert. Daaruit komt de koppeling tussen een regel van Alfa en een ACT-regel, omdat het pakket van Alfa die niet zelf noemt. axe-core, IBM en QualWeb noemen de ACT-regel in de metadata van hun eigen pakket; daar wordt die opgave gebruikt.

## Licentie, nagegaan op 13 oktober 2026

| Vindplaats | Wat er staat |
|---|---|
| De kop van `testcases.json`, veld `license` | Het adres `https://act-rules.github.io/pages/license/` |
| Die pagina, en `pages/license.md` in `act-rules/act-rules.github.io` | De "W3C Software and Document Notice and License": kopiëren, wijzigen en verspreiden mag, voor elk doel en zonder kosten, als de tekst van de licentie, bestaande vermeldingen en een melding van wijzigingen meegaan |
| `LICENSE.md` in `act-rules/act-rules.github.io` | "W3C Community Contributor License Agreement (CLA)", met een verwijzing naar de pagina hierboven |
| `LICENSE.md` in `w3c/wcag-act-rules`, waar de lijst en de pagina's staan | Alle documenten in de repository vallen onder de "W3C Document License" |
| `https://www.w3.org/copyright/document-license-2023/` | Kopiëren en verspreiden mag, in elk medium en voor elk doel, met een link naar het origineel en de vermelding van het auteursrecht. Wijzigen mag niet, behalve in software en in documentatie bij software die de specificatie uitvoert. Voorbeelden van code vallen onder de softwarelicentie van W3C |

Beide licenties staan toe de gevallen op te halen en ermee te meten. Opnemen in deze repository is een andere vraag. De softwarelicentie zou het toestaan, met een eigen regel in `REUSE.toml`. De documentlicentie staat een letterlijke kopie toe en geen wijziging. De twee plekken noemen niet dezelfde licentie, en van de hulpbestanden (beeld, video, geluid) is de herkomst niet per bestand nagegaan. Daarom staan de gevallen niet in de repository: ze worden bij gebruik opgehaald. Hier staan alleen de uitkomst, de commit en de hashes. De test van de ijkmeting draait op een handvol gevallen die voor de toolbox zelf zijn geschreven (`toolbox/test/fixtures/calibration/`).

De namen van de ACT-regels in de uitkomst zijn overgenomen uit de lijst, als aanduiding van de regel.

## Hoe de getallen te lezen

- **De gevallen zijn klein en kunstmatig.** Een paar regels HTML per geval. Een instrument dat hier goed scoort, kan op een echte site nog missen: daar staat een knop in een component, komt de naam uit een script en hangt de kleur van een toestand af.
- **De score is aan de gunstige kant.** De makers van de regelsets testen zelf tegen deze gevallen en stellen hun regels erop af.
- **Alleen wat een ACT-regel heeft, is gemeten.** Voor veel succescriteria bestaat geen ACT-regel, en een regelset heeft meer regels dan die met een ACT-regel erachter. Over die regels zegt de meting niets.
- **Geen uitspraak is geen misser.** Heeft een regelset volgens zijn maker geen regel voor een ACT-regel, of draait de toolbox die regel niet, dan telt het geval voor die regelset niet mee.
- **Gemeten is hoe de toolbox de regelsets leest.** Een regel die afkeurt, telt als afkeuring. IBM geeft bij een deel van zijn regels per reden op wat die voor de ACT-regel betekent; de toolbox leest die reden niet, en de meting dus ook niet.
- **Bij een naam bepaalt Chromium waar de regel over gaat.** Welke elementen een knop, link, kop, menu-item of formulierveld zijn, komt uit de toegankelijkheidsboom van Chromium. Per methode telt daarna of de naam leeg is. Een verschil met de verwachte uitkomst kan dus ook aan die boom liggen.
- **Eén run, in Chromium, in de lichte weergave**, met de instellingen waarmee de toolbox ook een site meet.
