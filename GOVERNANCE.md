# Hoe besluiten vallen

loep is een project van de Nederlandse Digitale Dienst en is experimenteel. Er is geen belofte over onderhoud of ondersteuning op termijn. Wat een versie is en hoe die uitkomt, staat in [CONTRIBUTING.md](CONTRIBUTING.md#versies); wat er per versie veranderde in [CHANGELOG.md](CHANGELOG.md).

## Wie wat doet

- **Beheerders** zijn de leden van het team van loep bij de Nederlandse Digitale Dienst met schrijfrechten op deze repository. Zij besluiten wat er binnenkomt en over de methode, zetten agents aan het werk en houden de lijst van de toetsset bij (zie [CONTRIBUTING.md](CONTRIBUTING.md)).
- **Bijdragers** zijn iedereen die een issue opent, een voorstel doet of een rapport van loep nakijkt. Daar is geen toestemming voor nodig.
- **Wie een rapport aftekent**, is verantwoordelijk voor dat rapport. Niet de beheerders van loep en niet het taalmodel.

## Hoe een wijziging binnenkomt

Elke wijziging gaat via een voorstel (pull request) naar `main`, en daar via een merge queue. De queue test een voorstel samen met `main` en de voorstellen die ervoor staan, en voegt het pas toe als de verplichte controle `volledig` slaagt. Een review is niet verplicht. Alleen wie schrijfrechten heeft, kan een voorstel in de queue zetten: een beheerder, of een agent die met de rechten van een beheerder werkt.

De meeste wijzigingen schrijven agents: een beheerder maakt of kiest een issue, een agent bouwt de wijziging met tests, opent het voorstel en zet het in de queue. Niet elk van die voorstellen leest een mens voordat het binnenkomt. Wat er dan tegenhoudt, zijn de tests, de vaste controles en de regels in [CONTRIBUTING.md](CONTRIBUTING.md). Wat een wijziging doet, staat in een fragment in [changelog.d/](changelog.d/README.md), dat bij een nieuwe versie in de CHANGELOG komt.

Voor de methode gelden twee extra regels:

- Een grens in een procedure volgt uit de normtekst van WCAG. De testsite laat zien dat iets misgaat, niet wat de regel moet zijn.
- Een wijziging die het onderzoek kan veranderen (een procedure, een instrument, een nieuwe versie van een regel-engine) heet in haar fragment en in de CHANGELOG zo ("Wat een uitkomst kan veranderen"), en het voorstel zegt of ze met agents is gemeten.

## Meten: het doel en hoe ver we zijn

Het doel is dat elke versie die een uitkomst kan veranderen (het middelste getal, zie [CONTRIBUTING.md](CONTRIBUTING.md#versies)) eerst is gemeten op de testsite, met de uitkomst in [validatie/](validatie/README.md). Dat halen we nu niet. Versie 0.2.0 tot en met 0.10.0 zijn uitgebracht zonder volledige nieuwe meting; de CHANGELOG zegt dat bij elke versie. De eerste stap terug is een meting van de herhaalbaarheid op de testsite met v0.11.0: hoeveel twee runs van dezelfde code van elkaar verschillen. Zonder dat getal kan een meting van een wijziging niet zeggen of een verschil van de wijziging komt. Daarna komen de varianten uit [validatie/verbruik/README.md](validatie/verbruik/README.md). Wat er loopt en wat daarna komt, staat in [PLAN.md](PLAN.md).

## Wat openstaat

Wat er loopt, wat hierna komt en welke besluiten openstaan, staat in [PLAN.md](PLAN.md). Een besluit dat de methode raakt, komt in [docs/methode.md](docs/methode.md) met de reden erbij.
