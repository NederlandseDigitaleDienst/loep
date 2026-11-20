// The list of decisions of the council meeting. Tagged on both sites; make.sh passes
// --input titel=nee for one of them, which leaves the document without a title.
#let naam = sys.inputs.at("naam", default: "Lindewaard")
#let titel = sys.inputs.at("titel", default: "ja") == "ja"
#set document(title: if titel { "Besluitenlijst raadsvergadering 12 maart 2026" } else { none }, date: datetime(year: 2026, month: 3, day: 13))
#set text(lang: "nl", size: 11pt)
#set page(paper: "a4", margin: 2cm)

= Besluitenlijst raadsvergadering 12 maart 2026

Dit zijn de besluiten van de gemeenteraad van #naam in de vergadering van donderdag 12 maart 2026.

== Nieuwe fietsenstalling bij het station

De raad stemt in met de bouw van een bewaakte fietsenstalling voor 1.200 fietsen. De eerste 24 uur stallen is gratis.

== Begroting 2027

De raad stelt de begroting 2027 vast, met 14 stemmen voor en 5 stemmen tegen.
