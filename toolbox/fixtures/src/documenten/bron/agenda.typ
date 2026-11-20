// The agenda of the council meeting. Both sites get the same text, title and language;
// make.sh writes it once with tags and once without (typst --no-pdf-tags).
#let naam = sys.inputs.at("naam", default: "Lindewaard")
#set document(title: "Agenda raadsvergadering 12 maart 2026", date: datetime(year: 2026, month: 3, day: 2))
#set text(lang: "nl", size: 11pt)
#set page(paper: "a4", margin: 2cm)

= Agenda raadsvergadering 12 maart 2026

De gemeenteraad van #naam vergadert op donderdag 12 maart 2026 om 19.30 uur in de raadzaal van het gemeentehuis, Raadhuisplein 1. De vergadering is openbaar.

== Onderwerpen

#table(
  columns: (auto, 1fr),
  table.header([Tijd], [Onderwerp]),
  [19.30], [Opening en mededelingen],
  [19.40], [Nieuwe fietsenstalling bij het station],
  [20.30], [Begroting 2027],
  [21.45], [Sluiting],
)

== Spreken in de raad

Wilt u inspreken over een onderwerp op de agenda? Meld u dan aan bij de griffie:

- uiterlijk op dinsdag 10 maart om 12.00 uur;
- met uw naam en het onderwerp waarover u wilt spreken;
- u krijgt vijf minuten spreektijd.
