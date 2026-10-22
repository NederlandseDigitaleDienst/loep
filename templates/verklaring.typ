// Template for the accessibility statement and the answer sheet of loep, in
// the identity of the report. It renders a block model (headings, paragraphs, lists,
// notes) that the toolbox writes as JSON; the same model gives the Markdown version.
//
//   typst compile --root / --font-path templates/fonts --ignore-system-fonts \
//     --pdf-standard ua-1 --input document=/abs/verklaring-model.json \
//     templates/verklaring.typ verklaring.pdf

#let doc = json(sys.inputs.document)
#let concept = doc.concept
#let open-items = doc.openItems

// ---------------------------------------------------------------- identity

#let sans = ("Atkinson Hyperlegible Next", "DejaVu Sans Mono", "Noto Emoji")
#let mono-font = ("Atkinson Hyperlegible Mono", "DejaVu Sans Mono", "Noto Emoji")

#let ink = rgb("#17171c")
#let accent = rgb("#4630b8")
#let accent-soft = rgb("#eeebfa")
#let muted = rgb("#55566a")
#let hairline = rgb("#d5d5de")
#let panel = rgb("#f4f4f8")

// ---------------------------------------------------------------- helpers

// Break opportunities inside URLs. An empty box lets the line break without adding a
// character that would end up in copied text.
#let break-after = (".", "/", ">", "[", "]", "#", ":", ",", "=", "&", "?", "_", "(", ")", "+", "~", "|", "@", "-")
#let soft(value) = {
  let parts = ()
  let current = ""
  let clusters = str(value).clusters()
  for (index, cluster) in clusters.enumerate() {
    current += cluster
    if cluster in break-after and index + 1 < clusters.len() and clusters.at(index + 1) not in break-after {
      parts.push(current)
      current = ""
    }
  }
  if current != "" { parts.push(current) }
  parts.join(box(width: 0pt))
}

#let mono(value, size: 0.9em) = text(font: mono-font, size: size, hyphenate: false, soft(value))
#let eyebrow(body) = text(size: 8.5pt, weight: 600, fill: muted, body)

// What the organisation still has to fill in: marked with a frame and a tint, and
// with its own words in brackets, so it also stands out in greyscale and when read aloud.
#let placeholder(what) = highlight(
  fill: accent-soft,
  stroke: 0.6pt + accent,
  radius: 2pt,
  extent: 1.5pt,
  top-edge: "ascender",
  bottom-edge: "descender",
  text(weight: 600, fill: ink, "[nog invullen: " + what + "]"),
)

#let spans(items) = for span in items {
  if "text" in span { span.text } else if "link" in span { link(span.link, soft(span.link)) } else { placeholder(span.open) }
}

// The status as a shape next to its name: full, half, open, or a question mark.
#let status-mark(code, size: 13pt) = pdf.artifact(box(width: size, height: size, baseline: 12%, {
  let pen = size * 0.12 + ink
  if code == "A" {
    circle(radius: size / 2, fill: ink)
  } else if code == "B" {
    place(box(width: size / 2, height: size, clip: true, circle(radius: size / 2, fill: ink)))
    place(center + horizon, circle(radius: size / 2 - size * 0.06, stroke: pen))
  } else if code == "C" {
    place(center + horizon, circle(radius: size / 2 - size * 0.06, stroke: pen))
  } else {
    place(center + horizon, circle(radius: size / 2 - size * 0.06, stroke: (paint: ink, thickness: size * 0.1, dash: "dashed")))
    place(center + horizon, text(font: sans, weight: 800, size: size * 0.72, fill: ink, top-edge: "cap-height", bottom-edge: "baseline", "?"))
  }
}))

#let callout(body, fill: panel, bar: ink) = block(width: 100%, fill: fill, stroke: (left: 3pt + bar), inset: (x: 12pt, y: 10pt), radius: (right: 3pt), body)

// ---------------------------------------------------------------- document

// Text no bundled font can show stops PDF/UA-1. The toolbox then compiles again with that
// text in `unshown` (see typst.ts), and it is set as its code points.
#show: body => {
  let unshown = sys.inputs.at("unshown", default: none)
  if unshown == none { return body }
  show regex(unshown): it => "[" + it.text.codepoints().map(c => {
    let hex = upper(str(c.to-unicode(), base: 16))
    "U+" + "0" * calc.max(0, 4 - hex.len()) + hex
  }).join(" ") + "]"
  body
}
#set document(
  title: doc.title,
  author: "loep",
  keywords: ("toegankelijkheid", "toegankelijkheidsverklaring", "EN 301 549"),
)
#set text(font: sans, size: 10.5pt, fill: ink, lang: "nl", region: "NL", hyphenate: false)
#set par(leading: 0.68em, spacing: 0.95em, justify: false)
#set list(marker: pdf.artifact(box(baseline: -32%, square(size: 3.2pt, fill: muted))), indent: 0pt, body-indent: 7pt, spacing: 0.7em)
#show link: set text(fill: accent)
#show link: underline.with(offset: 2pt, stroke: 0.5pt)

#let band-height = 82mm
#let top-margin = 30mm
#let concept-chip = box(fill: ink, inset: (x: 4pt, y: 2pt), outset: (y: 1pt), radius: 2pt, text(fill: white, weight: 700, size: 7.5pt, "Concept"))

#set page(
  paper: "a4",
  margin: (top: top-margin, bottom: 26mm, left: 24mm, right: 22mm),
  background: context {
    if here().page() == 1 { place(top + left, block(width: 100%, height: band-height, fill: accent)) }
  },
  header: context {
    if here().page() == 1 {
      grid(
        columns: (1fr, auto),
        align: (left + horizon, right + horizon),
        [],
        if concept { box(fill: white, radius: 20pt, inset: (x: 11pt, y: 6pt), text(fill: accent, size: 9.5pt, weight: 700, "Concept, niet publiceren")) },
      )
    } else {
      set text(size: 8.5pt, fill: muted)
      align(right, [#doc.title#if concept [#h(0.6em)#concept-chip]])
      v(-5pt)
      line(length: 100%, stroke: 0.5pt + hairline)
    }
  },
  footer: context {
    set text(size: 8.5pt, fill: muted)
    grid(
      columns: (1fr, auto),
      [Evaluatie #mono(doc.evaluationShort)#h(0.8em)#doc.evaluatedNl#h(0.8em)#doc.madeWithNl],
      text(number-width: "tabular")[Pagina #counter(page).display() van #counter(page).final().first()],
    )
  },
)

// The model's second and third heading levels are the first and second of the PDF;
// its first level is the title block.
#show heading: set block(sticky: true)
#show heading.where(level: 1): it => block(above: 26pt, below: 11pt, {
  pdf.artifact(block(below: 8pt, rect(width: 22pt, height: 3.5pt, fill: accent)))
  text(size: 16pt, weight: 800, tracking: -0.01em, it.body)
})
#show heading.where(level: 2): it => block(above: 18pt, below: 8pt, text(size: 12pt, weight: 700, it.body))

// ---------------------------------------------------------------- title block

#block(width: 100%, height: band-height - top-margin, spacing: 0pt, {
  set text(fill: white)
  v(1fr)
  title({
    set par(leading: 12pt)
    text(size: 12.5pt, weight: 600, doc.kindLabel)
    linebreak()
    text(size: if doc.site.name.len() > 28 { 26pt } else { 34pt }, weight: 800, tracking: -0.02em, doc.site.name)
  })
  v(8pt)
  link(doc.site.baseUrl, text(fill: white, mono(doc.site.baseUrl, size: 10pt)))
  v(11mm)
})

#v(9mm)
#grid(
  columns: (1.5fr, 1.2fr, 1fr),
  column-gutter: 7mm,
  // The status first: it is what a reader of a statement looks for.
  if doc.status != none {
    block(width: 100%, stroke: 0.9pt + ink, radius: 4pt, inset: (x: 11pt, y: 9pt), stack(
      spacing: 7pt,
      eyebrow[Nalevingsstatus],
      [#status-mark(doc.status.code)#h(7pt)#text(size: 13pt, weight: 800, if doc.status.code == "geen" { "Geen status" } else { "Status " + doc.status.code })],
      text(size: 9.5pt, upper(doc.status.name.first()) + doc.status.name.slice(1)),
    ))
  } else {
    stack(spacing: 6pt, eyebrow[Bestemd voor], [De invulassistent op toegankelijkheidsverklaring.nl])
  },
  {
    stack(spacing: 6pt, eyebrow[Organisatie], spans(doc.organisation))
    v(11pt, weak: true)
    stack(spacing: 6pt, eyebrow[Norm], doc.standard)
  },
  {
    stack(spacing: 6pt, eyebrow[Onderzoek], doc.evaluatedNl)
    v(11pt, weak: true)
    stack(spacing: 6pt, eyebrow[Versie], mono(doc.evaluationShort))
  },
)
#v(4mm)

// What is still missing, counted and named, before the text itself.
#let open-summary = if open-items.len() > 0 {
  block(above: 9pt, below: 0pt, {
    text(weight: 700)[Nog #open-items.len() #if open-items.len() == 1 [punt] else [punten] in te vullen.]
    [ Ze zijn in de tekst gemarkeerd als #placeholder("...").]
    set text(size: 9pt)
    // Two even columns, read down the first and then down the second.
    let half = calc.ceil(open-items.len() / 2)
    block(above: 8pt, grid(
      columns: (1fr, 1fr),
      column-gutter: 7mm,
      list(spacing: 0.55em, ..open-items.slice(0, half).map(item => [#item])),
      if open-items.len() > half { list(spacing: 0.55em, ..open-items.slice(half).map(item => [#item])) },
    ))
  })
}

#if not concept and open-items.len() > 0 { callout(open-summary) }

// ---------------------------------------------------------------- the statement

#let render-list(block) = list(..block.items.map(item => {
  spans(item.spans)
  if item.items.len() > 0 { list(..item.items.map(nested => spans(nested))) }
}))

#for block in doc.blocks {
  if block.type == "heading" {
    // Level 1 is the title block above.
    if block.level > 1 { heading(level: block.level - 1, spans(block.spans)) }
  } else if block.type == "note" {
    callout({
      text(weight: 700, block.title)
      [ ]
      spans(block.spans)
      open-summary
    })
  } else if block.type == "paragraph" {
    par(spans(block.spans))
  } else if block.type == "list" {
    render-list(block)
  }
}
