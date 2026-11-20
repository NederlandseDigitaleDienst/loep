// The waste guide, published by the waste service on the third origin (Kijkpunt), one per
// municipality. make.sh writes the one of Lindewaard without tags and the one of Berkenveen with.
#let naam = sys.inputs.at("naam", default: "Lindewaard")
#set document(title: "Afvalwijzer 2027 " + naam, date: datetime(year: 2026, month: 10, day: 1))
#set text(lang: "nl", size: 11pt)
#set page(paper: "a5", margin: 1.5cm)

= Afvalwijzer 2027

Wanneer haalt de afvaldienst uw afval op in #naam?

#table(
  columns: (1fr, auto),
  table.header([Container], [Ophalen]),
  [Grijs: restafval], [eens per twee weken],
  [Blauw: papier], [eens per vier weken],
  [Groen: groente, fruit en tuin], [elke week],
)

== Tips

- Zet de container voor 7.30 uur aan de straat.
- Zet de container met de klep naar de straat.
