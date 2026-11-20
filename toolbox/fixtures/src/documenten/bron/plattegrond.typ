// The floor plan of the town hall as a picture file (make.sh writes a png). With --input
// namen=ja the rooms carry their names in the picture; without, the picture has no text and
// the page says which room is where.
#let namen = sys.inputs.at("namen", default: "nee") == "ja"
#set page(width: 16cm, height: 10cm, margin: 0.6cm, fill: white)
#set text(size: 15pt, font: "Libertinus Serif")

#let kamer(x, y, w, h, kleur, label) = place(dx: x, dy: y, rect(width: w, height: h, fill: kleur, stroke: 1.5pt + black, inset: 6pt, if namen { align(center + horizon, label) }))

#kamer(0cm, 0cm, 7cm, 4.2cm, rgb("#dfe9f5"), [Publieksbalie])
#kamer(7cm, 0cm, 7.8cm, 4.2cm, rgb("#f3e6cf"), [Raadzaal])
#kamer(0cm, 4.2cm, 4.6cm, 4.4cm, rgb("#e3f0dc"), [Wachtruimte])
#kamer(4.6cm, 4.2cm, 4.6cm, 4.4cm, rgb("#f6dede"), [Spreekkamers])
#kamer(9.2cm, 4.2cm, 5.6cm, 4.4cm, rgb("#ececec"), [Ingang Raadhuisplein])
