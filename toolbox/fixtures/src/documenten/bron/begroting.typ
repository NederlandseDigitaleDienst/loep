// The budget. The file in the repository is small; the server of the fixture makes it larger
// than the limit of the toolbox when it serves it (see fixtures/documents.ts). make.sh writes
// it once with tags and once without.
#let naam = sys.inputs.at("naam", default: "Lindewaard")
#set document(title: "Begroting 2027", date: datetime(year: 2026, month: 2, day: 16))
#set text(lang: "nl", size: 11pt)
#set page(paper: "a4", margin: 2cm)

= Begroting 2027

In deze begroting staat wat de gemeente #naam in 2027 wil doen en wat dat kost.

== Lasten per programma

#table(
  columns: (1fr, auto),
  table.header([Programma], [Lasten in euro]),
  [Bestuur en dienstverlening], [4.120.000],
  [Verkeer en vervoer], [2.860.000],
  [Afval en milieu], [3.340.000],
)

== Wat verandert er?

- De afvalstoffenheffing stijgt met 3 procent.
- De parkeervergunning blijft 52,40 euro per jaar.
