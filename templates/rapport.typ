// Report template of loep. It reads the evaluation JSON as it is; the few
// values that need the toolbox's own functions (the evaluation hash, the compliance
// status, the fixed sentences shared with the Markdown report) arrive as `derived`.
//
//   typst compile --root / --font-path templates/fonts --ignore-system-fonts \
//     --pdf-standard ua-1 --input evaluation=/abs/evaluation.json \
//     --input derived='{...}' templates/rapport.typ rapport.pdf

#let evaluation = json(sys.inputs.evaluation)
#let derived = json(bytes(sys.inputs.derived))
// "short" leaves appendix A out: the same report without its largest part. A reference to
// the appendix is then plain text, so the short report has no link that leads nowhere.
#let short = sys.inputs.at("part", default: "full") == "short"
#let t = derived.text
#let chain = derived.chain
#let status-line = derived.statusLine
#let site = evaluation.site
// The signature stands next to the evaluation, outside the seal; the derived data carries the one that counts.
#let signature = derived.signature
// A signature for an earlier version of the evaluation does not count.
#let unsigned = not derived.signed
#let stale-note = if derived.signatureStale { t.staleSignature } else { none }
#let criteria = evaluation.criteria
#let findings = criteria.map(c => c.findings).flatten()
// Findings grouped into things to repair; absent in an evaluation from before that step existed.
#let grouping = derived.defects
#let defects = evaluation.at("defects", default: ())
#let defect-by-id = defects.fold((:), (acc, defect) => {
  acc.insert(defect.id, defect)
  acc
})
#let measured-states = evaluation.at("measuredStates", default: (:))
// Per finding a piece of a screenshot of the run, made by render; absent when the run had no picture with the element's box.
#let cutouts = derived.at("cutouts", default: (:))
#let sample-items = evaluation.sample.items
#let page-labels = derived.pageLabels
// The documents of the sample; none when the site has no documents.
#let documents = derived.at("documents", default: none)
#let page-title = page-labels.zip(sample-items).fold((:), (acc, pair) => {
  acc.insert(pair.at(0), pair.at(1).title)
  acc
})
#let page-title = if documents == none { page-title } else {
  documents.rows.fold(page-title, (acc, row) => {
    acc.insert(row.label, row.title)
    acc
  })
}

// ---------------------------------------------------------------- identity

#let sans = ("Atkinson Hyperlegible Next", "DejaVu Sans Mono", "Noto Emoji")
#let mono-font = ("Atkinson Hyperlegible Mono", "DejaVu Sans Mono", "Noto Emoji")

#let ink = rgb("#17171c")
#let accent = rgb("#4630b8")
#let accent-soft = rgb("#eeebfa")
#let muted = rgb("#55566a")
#let hairline = rgb("#d5d5de")
#let panel = rgb("#f4f4f8")

// Colours support the shape and the label; none of them carries meaning alone.
#let outcome-color = (
  passed: rgb("#1a6b3c"),
  failed: rgb("#ad1f1f"),
  inapplicable: muted,
  cantTell: rgb("#7a4b00"),
  nothingFound: rgb("#7a4b00"),
  untested: ink,
)

// ---------------------------------------------------------------- helpers

// Break opportunities inside selectors, URLs and paths. An empty box lets the line
// break without adding a character that would end up in copied text.
#let break-after = (".", "/", ">", "[", "]", "#", ":", ",", "=", "&", "?", "_", "(", ")", "+", "~", "|", "@")
#let soft(value) = {
  let parts = ()
  let current = ""
  let clusters = str(value).clusters()
  for (index, cluster) in clusters.enumerate() {
    current += cluster
    // Never between two separators, so "__" and ">>>" stay whole.
    if cluster in break-after and index + 1 < clusters.len() and clusters.at(index + 1) not in break-after {
      parts.push(current)
      current = ""
    }
  }
  if current != "" { parts.push(current) }
  parts.join(box(width: 0pt))
}

#let mono(value, size: 0.9em, fill: auto) = {
  set text(font: mono-font, size: size, hyphenate: false)
  set text(fill: fill) if fill != auto
  soft(value)
}
// A full hash may break after every eighth character.
#let full-hash(value) = text(font: mono-font, size: 8.4pt, range(0, value.len(), step: 8).map(start => value.slice(start, calc.min(start + 8, value.len()))).join(box(width: 0pt)))
#let short-hash(value, length: 8) = if value == none { [geen] } else { mono(value.slice(0, calc.min(length, value.len()))) }
#let url-link(url) = link(url, mono(url))
// Texts from the data write code between backticks, as Markdown does. In the PDF the code is set
// in the mono font and the backticks go; with an odd number of backticks the text stays as it is.
#let prose(value) = {
  if type(value) != str or not value.contains("`") { return value }
  let parts = value.split("`")
  if calc.even(parts.len()) { return value }
  parts.enumerate().map(((index, part)) => if calc.odd(index) { mono(part, size: 0.92em) } else { [#part] }).join()
}
// Where a finding is: a selector in mono, or words with code between backticks.
#let where-text(value) = if value.contains("`") and calc.odd(value.split("`").len()) { text(size: 9pt, prose(value)) } else { mono(value, size: 8.8pt) }
// An identifier stays in one piece where it sits in running text.
#let id-text(value, size: 1em) = box(text(font: mono-font, size: size, hyphenate: false, value))

// What the report shows as the outcome of a criterion: "nothingFound" is "cantTell" in the data, shown apart.
#let shown(criterion) = derived.shown.at(criterion.id)

// The outcome shapes: filled circle, cross, dash, question mark, open ring, and a ring with a dot.
#let mark(outcome, size: 0.72em, fill: auto) = pdf.artifact(box(width: size, height: size, baseline: 6%, {
  let color = if fill == auto { outcome-color.at(outcome) } else { fill }
  let pen = (paint: color, thickness: size * 0.2, cap: "round")
  if outcome == "passed" {
    circle(radius: size / 2, fill: color)
  } else if outcome == "failed" {
    place(line(start: (10%, 10%), end: (90%, 90%), stroke: pen))
    place(line(start: (10%, 90%), end: (90%, 10%), stroke: pen))
  } else if outcome == "inapplicable" {
    place(line(start: (8%, 50%), end: (92%, 50%), stroke: pen))
  } else if outcome == "nothingFound" {
    place(center + horizon, circle(radius: size * 0.4, stroke: size * 0.17 + color))
    place(center + horizon, circle(radius: size * 0.16, fill: color))
  } else if outcome == "cantTell" {
    place(center + horizon, text(font: sans, weight: 800, size: size * 1.45, fill: color, top-edge: "cap-height", bottom-edge: "baseline", "?"))
  } else {
    place(center + horizon, circle(radius: size * 0.4, stroke: size * 0.17 + color))
  }
}))

#let outcome-label(outcome) = derived.outcomeLabel.at(outcome)
#let badge(outcome, weight: 600) = box[#mark(outcome)#h(0.4em)#text(weight: weight, fill: outcome-color.at(outcome), outcome-label(outcome))]
// The same in a table column: the label may wrap, so a long label cannot push the other columns aside.
#let badge-cell(outcome, weight: 600) = grid(columns: (auto, 1fr), column-gutter: 0.4em, mark(outcome), text(weight: weight, fill: outcome-color.at(outcome), outcome-label(outcome)))

// Severity as four bars plus the word. The fourth is for a function that works for nobody.
#let severity-rank = (blokkerend: 4, hoog: 3, midden: 2, laag: 1)
#let severity(level) = box[#pdf.artifact(box(baseline: 0pt, {
    for index in range(4) {
      let on = index < severity-rank.at(level)
      box(width: 2.4pt, height: 3.2pt + index * 1.6pt, fill: if on { ink } else { none }, stroke: 0.5pt + ink)
      h(1.6pt)
    }
  }))#h(0.25em)#text(weight: 600, upper(level.first()) + level.slice(1))]

#let eyebrow(body) = text(size: 8.5pt, weight: 600, fill: muted, body)

#let finding-link(finding) = link(label(finding.id), mono(finding.id, size: 0.86em))
#let criterion-link(id, body) = link(label("sc-" + id), body)
#let capitalise(value) = upper(value.first()) + value.slice(1)
#let or-none(value, fallback) = if value == none or value == "" { fallback } else { value }

#let group-criteria(items, depth) = {
  let groups = ()
  for criterion in items {
    let key = criterion.id.split(".").slice(0, depth).join(".")
    if groups.len() > 0 and groups.last().key == key {
      groups.last().criteria.push(criterion)
    } else {
      groups.push((key: key, name: if depth == 1 { criterion.principle } else { criterion.guideline }, criteria: (criterion,)))
    }
  }
  groups
}

// Label and value pairs, read in order: label, value, label, value.
#let facts(..pairs) = {
  let cells = ()
  for (index, pair) in pairs.pos().enumerate() {
    let line = if index == 0 { none } else { (top: 0.5pt + hairline) }
    cells.push(grid.cell(stroke: line, eyebrow(pair.at(0))))
    cells.push(grid.cell(stroke: line, pair.at(1)))
  }
  grid(columns: (38mm, 1fr), column-gutter: 4mm, inset: (y: 6pt), ..cells)
}

#let callout(body, fill: accent-soft, bar: accent) = block(width: 100%, fill: fill, stroke: (left: 3pt + bar), inset: (x: 12pt, y: 10pt), radius: (right: 3pt), body)

// Keep a block together unless it is too tall to fit a page on its own.
#let keep(body, limit: 150mm, above: 0pt, below: 0pt, sticky: false) = {
  if above != 0pt { v(above, weak: true) }
  layout(size => {
    let height = measure(width: size.width, body).height
    block(breakable: height > limit, sticky: sticky, width: 100%, body)
  })
  if below != 0pt { v(below, weak: true) }
}

#let plain-list(items) = list(..items.map(item => [#prose(item)]))

// The other criteria a defect breaks, each linked to its result.
#let also-criteria(defect) = [#lower(t.defect.also) #defect.alsoCriteria.map(id => criterion-link(id, id)).join(", ")]

// ---------------------------------------------------------------- document

#let document-title = t.title + " " + site.name + if short { ", " + t.shortVersion } else { "" }
// A link to the entry of a criterion in appendix A; in the short report only the words.
#let appendix-link(id, body) = if short { body } else { link(label("bijlage-" + id), body) }
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
  title: document-title,
  author: or-none(site.organisation, "loep"),
  description: derived.statusSentenceNl,
  // The verdicts were drafted by a language model: said in the metadata too, so a machine can read it.
  keywords: ("toegankelijkheid", "WCAG", "EN 301 549", ..derived.aiKeywords),
)
#set text(font: sans, size: 10.5pt, fill: ink, lang: "nl", region: "NL", hyphenate: false)
#set par(leading: 0.68em, spacing: 0.95em, justify: false)
#set list(marker: pdf.artifact(box(baseline: -32%, square(size: 3.2pt, fill: muted))), indent: 0pt, body-indent: 7pt, spacing: 0.7em)
#set enum(indent: 0pt, body-indent: 7pt)
#show link: set text(fill: accent)
#show link: underline.with(offset: 2pt, stroke: 0.5pt)

#set page(
  paper: "a4",
  margin: (top: 30mm, bottom: 26mm, left: 24mm, right: 22mm),
  header: context {
    if here().page() > 1 {
      set text(size: 8.5pt, fill: muted)
      align(right,
        [#t.title #site.name#if short [, #t.shortVersion]#if unsigned [#h(0.6em)#box(fill: ink, inset: (x: 4pt, y: 2pt), outset: (y: 1pt), radius: 2pt, text(fill: white, weight: 700, size: 7.5pt, "Concept"))]],
      )
      v(-5pt)
      line(length: 100%, stroke: 0.5pt + hairline)
    }
  },
  footer: context {
    if here().page() > 1 {
      set text(size: 8.5pt, fill: muted)
      grid(
        columns: (1fr, auto),
        [Evaluatie #mono(derived.hashShort)#h(0.8em)#derived.dateNl#h(0.8em)#derived.madeWithShortNl],
        text(number-width: "tabular")[Pagina #counter(page).display() van #counter(page).final().first()],
      )
    }
  },
)

// Headings: 1 section, 2 principle or group, 3 guideline, 4 criterion, 5 part of a
// criterion or a finding, 6 part of a finding.
#set heading(numbering: none)
#show heading: set block(sticky: true)
#show heading.where(level: 1): it => block(above: 34pt, below: 16pt, {
  pdf.artifact(block(below: 9pt, rect(width: 26pt, height: 4pt, fill: accent)))
  text(size: 24pt, weight: 800, tracking: -0.015em, it.body)
})
#show heading.where(level: 2): it => block(above: 24pt, below: 10pt, text(size: 16pt, weight: 700, tracking: -0.01em, it.body))
#show heading.where(level: 3): it => block(above: 20pt, below: 4pt, text(size: 10pt, weight: 600, fill: muted, it.body))
#show heading.where(level: 4): it => text(size: 12.5pt, weight: 700, it.body)
#show heading.where(level: 5): it => block(above: 13pt, below: 6pt, text(size: 9pt, weight: 700, fill: ink, it.body))
#show heading.where(level: 6): it => block(above: 9pt, below: 5pt, text(size: 8.5pt, weight: 600, fill: muted, it.body))

// Tables: no vertical rules, a firm line under the header, hairlines between rows.
#set table(
  stroke: (x, y) => (bottom: 0.5pt + hairline),
  inset: (x: 5pt, y: 5.5pt),
  align: left + top,
)
// A row never continues on the next page.
#set table.cell(breakable: false)
#show table: set text(size: 9.5pt, number-width: "tabular")
#show table: set par(leading: 0.55em)
#let th(body, ..args) = table.cell(stroke: (bottom: 0.9pt + ink), align: left + bottom, ..args, text(size: 8.5pt, weight: 600, body))
#let th-right(body) = th(body, align: right + bottom)

// ---------------------------------------------------------------- cover

#let relevant-22 = criteria.filter(c => "2.2" in c.versions)

// One shape per criterion, a row per principle: the evaluation at a glance.
#let fingerprint(size: 10pt, gap: 5pt) = pdf.artifact(grid(
  columns: (32mm, 1fr),
  row-gutter: 9pt,
  ..group-criteria(relevant-22, 1).map(principle => (
    text(size: 9.5pt, weight: 600, principle.key + " " + principle.name),
    box(group-criteria(principle.criteria, 2).map(guideline => guideline.criteria.map(c => mark(shown(c), size: size)).join(h(gap))).join(h(gap * 2.4))),
  )).flatten(),
))

// The cover has two parts: the coloured top and the white bottom. The bottom is at least 42% of the
// page and grows with its text (a long status, a grouping line, a long organisation name); the top
// takes what is left. So no text can run past the rule or off the page.
#let cover-bottom-upper = {
  eyebrow[Uitkomst per criterium, WCAG 2.2 niveau A en AA]
  v(9pt)
  fingerprint()
  v(12pt)
  {
    set text(size: 9pt)
    let tally = derived.tally.at("2.2")
    derived.outcomeOrder.map(outcome => box[#mark(outcome, fill: ink)#h(0.4em)#text(weight: 700, number-width: "tabular", str(tally.at(outcome))) #outcome-label(outcome)]).join(h(14pt))
    if grouping != none {
      v(7pt)
      text(weight: 700, upper(grouping.countsNl.first()) + grouping.countsNl.slice(1))
    }
  }
  v(12pt)
  text(size: 11pt, weight: 700, status-line.headingNl)
  linebreak()
  text(size: 9pt, weight: if status-line.unfinished { 700 } else { 400 }, status-line.openNl)
  if status-line.noteNl != none {
    linebreak()
    text(size: 9pt, status-line.noteNl)
  }
}
#let cover-bottom-lower = {
  line(length: 100%, stroke: 0.9pt + ink)
  v(8pt)
  grid(
    columns: (1.3fr, 1fr, 1fr, 1.5fr),
    column-gutter: 6mm,
    ..(
      ("Organisatie", or-none(site.organisation, "Niet opgegeven")),
      ("Datum", derived.dateNl),
      ("Versie", mono(derived.hashShort)),
      ("Status", if unsigned { text(weight: 700, t.concept) + if stale-note != none [\ #text(size: 9pt, stale-note)] } else [Afgetekend door #signature.role (#signature.organisation) op #derived.signedDateNl]),
    ).map(pair => stack(spacing: 6pt, eyebrow(pair.at(0)), pair.at(1))),
  )
  v(9pt)
  // Where the report came from, small: the report is of the organisation that brings it out.
  text(size: 8.5pt, fill: muted, derived.madeWithNl)
}

#page(margin: 0pt, header: none, footer: none, layout(size => {
  let side = 24mm
  let (bottom-top, bottom-bottom, gap) = (13mm, 16mm, 10mm)
  let inner = size.width - 2 * side
  let needed = bottom-top + measure(width: inner, cover-bottom-upper).height + gap + measure(width: inner, cover-bottom-lower).height + bottom-bottom
  let bottom-height = calc.max(size.height * 0.42, needed)
  block(width: 100%, height: size.height - bottom-height, fill: accent, inset: (x: side, top: 20mm, bottom: 15mm), spacing: 0pt, {
    set text(fill: white)
    grid(
      columns: (1fr, auto),
      align: (left + horizon, right + horizon),
      [],
      box(fill: white, radius: 20pt, inset: (x: 11pt, y: 6pt), text(fill: accent, size: 9.5pt, weight: 700, if unsigned { t.concept } else { "Afgetekend" })),
    )
    v(1fr)
    title({
      set par(leading: 14pt)
      text(size: 13pt, weight: 600, t.title + if short { ", " + t.shortVersion + " zonder bijlage A" } else { "" })
      linebreak()
      text(size: if site.name.len() > 28 { 32pt } else { 44pt }, weight: 800, tracking: -0.02em, site.name)
    })
    v(10pt)
    link(site.baseUrl, text(fill: white, mono(site.baseUrl, size: 10.5pt)))
  })
  block(width: 100%, height: bottom-height, inset: (x: side, top: bottom-top, bottom: bottom-bottom), spacing: 0pt, {
    cover-bottom-upper
    v(1fr)
    cover-bottom-lower
  })
}))

// ---------------------------------------------------------------- contents

#heading(level: 1, outlined: false, bookmarked: true)[Inhoud]
#{
  set outline.entry(fill: repeat(text(fill: hairline, "."), gap: 3pt))
  show outline.entry.where(level: 1): set block(above: 13pt)
  show outline.entry.where(level: 1): set text(weight: 700)
  show outline.entry: set text(number-width: "tabular")
  show link: set text(fill: ink)
  show link: it => it.body
  outline(title: none, depth: 2, indent: 14pt)
}

// ---------------------------------------------------------------- summary

#let score-table(version) = {
  let relevant = criteria.filter(c => version in c.versions)
  let tally = derived.tally.at(version)
  let number(value, weight: 400) = text(weight: weight, fill: if value == 0 { muted } else { ink }, str(value))
  table(
    // The outcome with the long name gets a wider column; the others make room for it.
    columns: (1fr,) + (if "nothingFound" in derived.outcomeOrder { derived.outcomeOrder.map(outcome => if outcome == "nothingFound" { 29mm } else { 18mm }) } else { (21mm,) * 5 }) + (14mm,),
    inset: (x: 5pt, y: 3.8pt),
    align: (x, y) => if x == 0 { left + top } else { right + top },
    table.header(
      th[WCAG #version, niveau A en AA],
      ..derived.outcomeOrder.map(outcome => th-right[#mark(outcome)#h(0.35em)#outcome-label(outcome)]),
      th-right[Totaal],
    ),
    ..group-criteria(relevant, 1).map(principle => (
      [#principle.key #principle.name],
      ..derived.outcomeOrder.map(outcome => number(principle.criteria.filter(c => shown(c) == outcome).len())),
      number(principle.criteria.len()),
    )).flatten(),
    ..(
      [Totaal],
      ..derived.outcomeOrder.map(outcome => number(tally.at(outcome), weight: 700)),
      number(tally.total, weight: 700),
    ).map(cell => table.cell(stroke: (top: 0.9pt + ink, bottom: none), text(weight: 700, cell))),
  )
}

#pagebreak(weak: true)
= Samenvatting

#text(size: 13.5pt, weight: 600, derived.statusSentenceNl)

#callout(fill: panel, bar: ink, {
  text(weight: 700, status-line.headingNl)
  if status-line.noteNl != none {
    linebreak()
    text(size: 9.5pt, status-line.noteNl)
  }
  linebreak()
  text(size: 9.5pt, weight: if status-line.unfinished { 700 } else { 400 }, status-line.openNl)
})

#if derived.forB != none {
  callout(fill: panel, bar: ink, {
    text(weight: 700)[Wat er nog ontbreekt voor status B]
    linebreak()
    text(size: 9.5pt)[Waarop de uitkomsten rusten: #derived.forB.basisNl]
    if derived.forB.doneNl != none {
      linebreak()
      text(size: 9.5pt, derived.forB.doneNl)
    } else {
      set text(size: 9.5pt)
      for row in derived.forB.openNl [
        - #row.criterion: #row.closesNl
      ]
    }
  })
}

#if grouping != none [Het onderzoek vond #grouping.countsNl.]

#score-table("2.2")
#score-table("2.1")
#text(size: 9pt, fill: muted, derived.scoreNoteNl)

#if grouping != none [
  == Zwaarste gebreken

  #{
    let top = grouping.topIds.map(id => defect-by-id.at(id))
    if top.len() == 0 [Er zijn geen gebreken.] else {
      table(
        columns: (auto, 1fr, 24mm, 27mm),
        inset: (x: 5pt, y: 3.8pt),
        table.header(th[Ernst], th[Gebrek], th[Criterium], th[Pagina's]),
        ..top.map(defect => (
          severity(defect.severity),
          link(label(defect.id), text(weight: 600, defect.titleNl)),
          {
            criterion-link(defect.mainCriterion, defect.mainCriterion)
            if defect.alsoCriteria.len() > 0 { text(size: 8.5pt, fill: muted)[\ #also-criteria(defect)] }
          },
          grouping.pagesNl.at(defect.id),
        )).flatten(),
      )
      text(size: 9pt, fill: muted, grouping.topNoteNl)
    }
  }
] else [
  == Zwaarste bevindingen

  #{
    let top = derived.topFindingIds.map(id => findings.find(f => f.id == id))
    if top.len() == 0 [Er zijn geen bevindingen.] else {
      table(
        columns: (auto, 1fr, auto, 30%),
        inset: (x: 5pt, y: 3.8pt),
        table.header(th[Ernst], th[Bevinding], th[Criterium], th[Pagina's]),
        ..top.map(finding => (
          severity(finding.severity),
          link(label(finding.id), text(weight: 600, finding.titleNl)),
          criterion-link(finding.criterion, finding.criterion),
          finding.pagesAffected,
        )).flatten(),
      )
      text(size: 9pt, fill: muted, derived.topFindingsNoteNl)
    }
  }
]

== Wat betekent dit

#{
  set text(size: 10pt)
  set par(leading: 0.62em)
  for paragraph in derived.meaningNl { block(above: 11pt, below: 11pt, prose(paragraph)) }
}

// ---------------------------------------------------------------- what next

#let intro-toolbox = t.investigate.toolboxIntro
// A reference to the entry of a criterion in appendix A.
#let appendix-ref(id) = appendix-link(id)[bijlage A]

// What the site is, right after what was found and before what has to be done about it.
#if site.at("descriptionNl", default: none) != none [
  = Over deze website

  #for paragraph in site.descriptionNl.split(regex("\n\s*\n")) { par(paragraph) }
]

#pagebreak(weak: true)
= Wat nu

#t.todoIntro

== Oplossen

#if derived.todo.person.len() > 0 [
  === #t.personFailed

  #par(t.personFailedIntro)
  #plain-list(derived.todo.person.map(item => [#criterion-link(item.criterion, item.criterion): #item.textNl]))
]

#if derived.todo.fix.len() == 0 [Er zijn geen bevindingen om op te lossen.] else if grouping != none {
  par(t.defectIntro)
  block(sticky: true, par(t.adviceNote))
  table(
    columns: (auto, auto, 1fr, 24mm, 27mm),
    table.header(th[Eigenaar], th[Ernst], th[Gebrek], th[Criterium], th[Pagina's]),
    ..grouping.fix.map(group => (
      table.cell(rowspan: group.defectIds.len(), breakable: true, text(weight: 700, capitalise(group.owner))),
      ..group.defectIds.map(id => defect-by-id.at(id)).map(defect => (
        severity(defect.severity),
        {
          [#link(label(defect.mainFindingId), text(weight: 600, defect.titleNl)) #label(defect.id)]
          linebreak()
          set text(size: 8.5pt, fill: muted)
          id-text(defect.id)
          if defect.findingIds.len() > 1 [ · #defect.findingIds.len() bevindingen: #defect.findingIds.map(id => link(label(id), id-text(id))).join(", ")]
        },
        {
          criterion-link(defect.mainCriterion, defect.mainCriterion)
          if defect.alsoCriteria.len() > 0 { text(size: 8.5pt, fill: muted)[\ #also-criteria(defect)] }
        },
        grouping.pagesNl.at(defect.id),
      )).flatten(),
    )).flatten(),
  )
} else {
  par(t.fixIntro)
  block(sticky: true, par(t.adviceNote))
  table(
    columns: (auto, auto, 1fr, auto),
    table.header(th[Eigenaar], th[Ernst], th[Bevinding], th[Criterium]),
    ..derived.todo.fix.map(group => (
      table.cell(rowspan: group.findingIds.len(), breakable: true, text(weight: 700, capitalise(group.owner))),
      ..group.findingIds.map(id => findings.find(f => f.id == id)).map(finding => (
        severity(finding.severity),
        link(label(finding.id), text(weight: 600, finding.titleNl)),
        criterion-link(finding.criterion, finding.criterion),
      )).flatten(),
    )).flatten(),
  )
}

#if derived.todo.vendor != none and derived.todo.vendor.elements.len() > 0 [
  == Raakt een component van #derived.todo.vendor.nameNl

  #block(sticky: true, par(t.vendorIntro))
  #table(
    columns: (34%, 1fr),
    table.header(th[Element], th[Bevindingen]),
    ..derived.todo.vendor.elements.map(element => (mono(element.tag, size: 8.8pt), element.findingIds.map(id => link(label(id), id-text(id))).join(", "))).flatten(),
  )
]

== Nog uitzoeken

#let open-points = derived.todo.investigate
// The criterion an open point belongs to, with its outcome; the first time it stands in the list, links to its open points land here.
#let open-head(item) = {
  let criterion = criteria.find(c => c.id == item.criterion)
  let name = text(weight: 700, criterion-link(criterion.id)[#criterion.id #criterion.titleNl])
  if item.anchor [#name #label("open-" + criterion.id)] else { name }
  [ #text(fill: muted)[(#item.outcomeNl)]]
}
// What waits only for permission to send: its own part, with the one declaration that would have let the evaluation send.
#let not-sent = open-points.at("notSent", default: none)
#let open-groups = (
  (t.investigate.owner, (t.investigate.ownerIntro,), open-points.owner),
  ..if not-sent != none { ((t.investigate.notSent, (t.investigate.notSentIntro, [#not-sent.declarationNl #mono(not-sent.flags)], not-sent.originNl), not-sent.items),) },
  // A part of the site that did not load: in full, because each point says what and when.
  (t.investigate.unreachable, (t.investigate.unreachableIntro,), open-points.at("unreachable", default: ())),
  (t.investigate.unsorted, (t.investigate.unsortedIntro,), open-points.unsorted),
)
#if open-groups.map(group => group.at(2).len()).sum() + open-points.toolbox.len() == 0 [Er zijn geen open punten.] else {
  par(t.investigateIntro)
  for (title, intro, items) in open-groups {
    if items.len() > 0 {
      // Over the full width: these lists are long, and a narrow column would double their length.
      heading(level: 3, title)
      set text(size: 9.5pt)
      set par(leading: 0.55em)
      for paragraph in intro { par(paragraph) }
      for item in items {
        block(above: 11pt, below: 6pt, sticky: true, width: 100%, stroke: (top: 0.5pt + hairline), inset: (top: 5pt), open-head(item))
        plain-list(item.pointsNl)
      }
    }
  }
  if open-points.toolbox.len() > 0 {
    heading(level: 3, t.investigate.toolbox)
    set text(size: 9.5pt)
    set par(leading: 0.55em)
    block(sticky: true, par(intro-toolbox))
    table(
      // The kind of point can be a long account of the coverage: it gets the room, not the name.
      columns: (34%, auto, 1fr),
      table.header(th[Criterium], th[Punten], th[Soort]),
      ..open-points.toolbox.map(item => (open-head(item), [#item.countNl, zie #appendix-ref(item.criterion)], [#item.kindsNl#if item.coverageNl != none [\ #t.measured: #item.coverageNl]])).flatten(),
    )
  }
}

// A recommendation is no part of an outcome: its own part, after everything that is wrong or open.
#if derived.recommendations.len() > 0 [
  == #t.recommendations

  #par(t.recommendationsIntro)
  #for item in derived.recommendations {
    let criterion = criteria.find(c => c.id == item.criterion)
    block(above: 11pt, below: 6pt, sticky: true, width: 100%, stroke: (top: 0.5pt + hairline), inset: (top: 5pt), {
      [#text(weight: 700, prose(item.titleNl)) #label(item.id)]
      linebreak()
      set text(size: 8.5pt, fill: muted)
      [#id-text(item.id) · bij #criterion-link(criterion.id)[#criterion.id #criterion.titleNl], aanbeveling #item.rule van de procedure]
    })
    {
      set text(size: 9.5pt)
      plain-list(("Gezien: " + item.observedNl, "Aanbeveling: " + item.recommendationNl, "Waar: " + item.placesNl.join("; ")))
    }
  }
]

// ---------------------------------------------------------------- measures

// What the organisation decided per defect: only in a signed report, from the layer of decisions next to the seal.
#let measures = derived.at("measures", default: none)
#if measures != none [
  #pagebreak(weak: true)
  = #t.measures.title

  #par(t.measures.intro)
  #par(measures.countsNl)
  #for row in measures.rows {
    block(above: 11pt, below: 6pt, sticky: true, width: 100%, stroke: (top: 0.5pt + hairline), inset: (top: 5pt), {
      [#link(label(row.defectId), text(weight: 700, prose(row.titleNl)))]
      linebreak()
      text(weight: 600, row.decisionNl)
      linebreak()
      set text(size: 8.5pt, fill: muted)
      [#id-text(row.defectId) · #row.severity · #row.criteriaNl]
    })
    if row.linesNl.len() > 0 {
      set text(size: 9.5pt)
      plain-list(row.linesNl)
    }
  }
  #par(text(size: 9pt, fill: muted, measures.layerNl))
]

// ---------------------------------------------------------------- facts

#pagebreak(weak: true)
= Onderzoeksgegevens

#facts(
  ("Site", site.name),
  ("URL", url-link(site.baseUrl)),
  // A site on more than one origin (inventory --also-origin): the further origins it covers.
  ..if site.at("origins", default: ()).len() > 1 { (("Ook onderdeel van de site", site.origins.slice(1).map(url-link).join(linebreak())),) },
  ("Organisatie", or-none(site.organisation, "Niet opgegeven")),
  ("Datum", derived.dateNl),
  ("Norm", (..evaluation.standards.wcag, evaluation.standards.en301549).join(linebreak())),
  ("Methode", link(evaluation.method.url)[#evaluation.method.name #evaluation.method.version]),
  ("Type onderzoek", evaluation.method.typeNl),
  (t.madeWith, derived.instrumentNl),
  ("Uitgevoerd door", t.performedBy),
  ..if derived.followsUpNl != none { ((t.followsUp, derived.followsUpNl),) },
  ..if chain.writesNl != none { (("Versturen van formulieren", chain.writesNl),) },
  ..if chain.at("readsNl", default: none) != none { (("Leesverzoeken", chain.readsNl),) },
  (
    "Afgetekend door",
    if unsigned { text(weight: 700, t.notSigned) + if stale-note != none [. #stale-note] } else [#signature.role, #signature.organisation, op #derived.signedDateNl#if derived.at("signatureRecordedNl", default: none) != none [, #derived.signatureRecordedNl]],
  ),
  ..if unsigned { () } else {
    (("Verklaring", [#signature.statementNl\ Getekend voor evaluatie #mono(signature.evaluationSha256.slice(0, calc.min(12, signature.evaluationSha256.len()))), verzegeld als #mono(signature.sealSha256.slice(0, calc.min(12, signature.sealSha256.len()))).]),)
  },
)

#if evaluation.method.deviationsNl.len() > 0 [
  == Afwijkingen van de methode
  #plain-list(evaluation.method.deviationsNl)
]

= Scope

#grid(
  columns: (1fr, 1fr),
  column-gutter: 10mm,
  [
    #heading(level: 2, outlined: false)[Binnen de scope]
    #plain-list(evaluation.scope.includedNl)
  ],
  [
    #heading(level: 2, outlined: false)[Buiten de scope]
    #if evaluation.scope.excludedNl.len() > 0 { plain-list(evaluation.scope.excludedNl) } else [Niets uitgesloten.]
  ],
)

#if derived.scopeFramesNl.len() > 0 [
  #heading(level: 2, outlined: false)[#t.scopeFrames]
  #plain-list(derived.scopeFramesNl)
]

= Basisniveau van ondersteuning

#facts(
  (
    "Browsers",
    evaluation.baseline.browsers.map(browser => [#browser.name #or-none(browser.version, "(versie onbekend)"), motor #browser.engine]).join(linebreak()),
  ),
  (
    "Hulpsoftware",
    {
      let tools = evaluation.baseline.assistiveTechnology
      if tools.len() == 0 {
        text(weight: 700, "Geen. ")
        or-none(evaluation.baseline.noteNl, t.noAssistiveTechnology)
      } else {
        tools.map(tool => [#tool.name #tool.version]).join(linebreak())
        if evaluation.baseline.noteNl != "" {
          linebreak()
          evaluation.baseline.noteNl
        }
      }
    },
  ),
  ("Technologieën", evaluation.technologies.join(", ")),
)

// ---------------------------------------------------------------- sample

= Steekproef

#evaluation.sample.note

#facts(
  ("Werkwijze", t.sampleMethod.at(evaluation.sample.method)),
  ("Unieke pagina's in de inventaris", str(evaluation.sample.populationSize)),
  ("Onderzochte pagina's", str(sample-items.len())),
  ("Seed voor de willekeurige keuze", mono(evaluation.sample.seed)),
)

#v(6pt)
#table(
  columns: (auto, 1fr, auto, 27%),
  table.header(th[Nr.], th[Pagina], th[Soort], th[Reden]),
  ..sample-items.enumerate().map(((index, item)) => (
    text(weight: 700, page-labels.at(index)),
    {
      text(weight: 600, or-none(item.title, "(geen titel)"))
      linebreak()
      link(item.url, mono(item.url, size: 0.88em))
      if item.aliases.len() > 0 {
        linebreak()
        text(size: 0.9em, fill: muted)[Dezelfde inhoud staat ook op: #item.aliases.map(alias => mono(alias, size: 0.95em)).join(", ")]
      }
      let states = measured-states.at(page-labels.at(index), default: ())
      if states.len() > 0 {
        linebreak()
        text(size: 0.9em, fill: muted)[#t.measuredStates: #states.join(", ")]
      }
    },
    t.sampleKind.at(item.kind),
    item.reason,
  )).flatten(),
)

#if evaluation.sample.at("pageTypes", default: none) != none [
  == Paginatypen

  #t.samplePageTypes

  #v(6pt)
  #table(
    columns: (1fr, auto, auto, 40%),
    table.header(th[Paginatype], th-right[Pagina's], th-right[Bekeken], th[Waarom deze]),
    ..evaluation.sample.pageTypes.map(type => (
      {
        text(weight: 600, type.id)
        if type.descriptionNl != "" {
          linebreak()
          text(size: 0.9em, fill: muted, type.descriptionNl)
        }
      },
      align(right, str(type.pages)),
      align(right, str(type.examined)),
      type.reasonNl,
    )).flatten(),
  )
]

#if documents != none [
  == Documenten

  #facts(..documents.factsNl.map(pair => (pair.at(0), pair.at(1))))

  #v(6pt)
  #table(
    columns: (auto, 1fr, auto, 27%),
    table.header(th[Nr.], th[Document], th[Soort], th[Ingelezen]),
    ..documents.rows.map(row => (
      text(weight: 700, row.label),
      {
        text(weight: 600, row.title)
        linebreak()
        link(row.url, mono(row.url, size: 0.88em))
        linebreak()
        text(size: 0.9em, fill: muted, row.reasonNl)
      },
      row.kindNl,
      row.statusNl,
    )).flatten(),
  )
]

// ---------------------------------------------------------------- tools

= Gereedschap

#{
  let toolchain = evaluation.toolchain
  let rendering = toolchain.rendering
  let agent-models = derived.at("agentModels", default: none)
  facts(
    ("Toolbox", [loep, versie #toolchain.toolbox.version, commit #if derived.toolboxCommit == none { t.commitUnknown } else { short-hash(derived.toolboxCommit, length: 12) }]),
    ("Lockfile", short-hash(toolchain.toolbox.lockfileSha256)),
    ("Runtime", [Node #toolchain.runtime.node op #toolchain.runtime.platform #toolchain.runtime.osRelease (#toolchain.runtime.arch)]),
    ("Pakketten", toolchain.packages.keys().sorted().map(name => [#mono(name) #toolchain.packages.at(name)]).join(linebreak())),
    (if derived.browsersNl.len() > 1 { "Browsers" } else { "Browser" }, derived.browsersNl.join(linebreak())),
    (
      "Weergave",
      [venster #rendering.viewport.width × #rendering.viewport.height, schaalfactor #rendering.deviceScaleFactor, taal #rendering.locale, tijdzone #rendering.timezoneId, voorkeur voor minder beweging: #if rendering.reducedMotion == "reduce" [aan] else [uit]],
    ),
    (
      "Wachttijden",
      [#(rendering.navigationTimeoutMs / 1000) seconden voor het laden van een pagina, #(rendering.settleTimeoutMs / 1000) seconden voor het tot rust komen],
    ),
    (t.model, [#evaluation.judgment.model (#if agent-models != none { t.modelNoteOperator } else { t.modelNote })]),
    ..if agent-models != none {
      ((t.agentModels, [#agent-models.perRoleNl.join(linebreak())\ #t.agentModelsNote#if agent-models.differsNl != none [ #agent-models.differsNl]]),)
    },
    ("Rondes", evaluation.judgment.rounds.join(", ")),
    ..if derived.at("extensionsNl", default: none) != none {
      ((t.extensions, [#derived.extensionsNl. #t.extensionsNote]),)
    },
    (
      "Opdrachtsjablonen",
      evaluation.judgment.promptTemplates.keys().sorted().map(name => [#name #short-hash(evaluation.judgment.promptTemplates.at(name))]).join(", "),
    ),
  )
  let instruments = evaluation.at("instruments", default: ())
  if instruments.len() > 0 {
    block(sticky: true, par(text(weight: 700)[Meetmethoden van de agents]))
    block(sticky: true, par(t.instrumentsIntro))
    set text(size: 8.8pt)
    table(
      // A long name or version would otherwise squeeze what the tool was used for.
      columns: (28%, 20%, 1fr, auto),
      table.header(th[Hulpmiddel], th[Versie], th[Gebruikt voor], th[Metingen]),
      ..instruments.enumerate().map(((index, tool)) => (mono(tool.implementation, size: 8.4pt), derived.instrumentVersions.at(index), tool.usedForNl.join(", "), str(tool.measurements))).flatten(),
    )
  }
  if derived.toolboxChanged { callout(fill: panel, bar: ink, text(weight: 600, t.dirty)) }
}

#chain.enginesNl

// ---------------------------------------------------------------- results

#pagebreak(weak: true)
= Resultaten per criterium

#block(sticky: true, par(t.overviewIntro))

#table(
  // Fixed widths for the outcome and who established it: as auto columns their longest text
  // took the width of the criterion's name.
  columns: (auto, 1fr, auto, 43mm, 21mm, auto),
  inset: (x: 5pt, y: 4pt),
  align: (x, y) => if x == 5 { right + top } else { left + top },
  table.header(th[Nr.], th[Criterium], th[Niveau], th[Uitkomst], th(t.establishedBy), th-right[Bevindingen]),
  ..criteria.map(criterion => (
    criterion-link(criterion.id, criterion.id),
    {
      show link: set text(fill: ink)
      show link: it => it.body
      criterion-link(criterion.id, criterion.titleNl)
    },
    criterion.level,
    badge-cell(shown(criterion)),
    text(size: 8.8pt, derived.briefs.at(criterion.id).establishedNl),
    text(fill: if criterion.findings.len() == 0 { muted } else { ink }, weight: if criterion.findings.len() == 0 { 400 } else { 700 }, str(criterion.findings.len())),
  )).flatten(),
)

#let version-note(criterion) = if "2.2" not in criterion.versions { "Alleen in WCAG 2.1" } else if "2.1" not in criterion.versions { "Nieuw in WCAG 2.2" } else { none }
#let round-label(outcome) = if outcome == none { text(fill: muted, "Geen oordeel") } else { badge(outcome, weight: 400) }

// The piece of a screenshot with the element of the finding outlined, at half a point per pixel; nothing when there is none.
#let cutout-of(finding) = {
  let cut = cutouts.at(finding.id, default: none)
  if cut != none {
    block(above: 9pt, below: 2pt, breakable: false, image(cut.path, alt: cut.altNl, width: calc.min(cut.width * 0.5, 400) * 1pt))
  }
}

// A finding whose defect is filed under another criterion: the same facts as a full card, set closer together.
#let compact-card(finding, place, lead: none) = {
  let defect = defect-by-id.at(place.defectId)
  let check = finding.at("verification", default: none)
  let part(name, body) = block(above: 5pt, below: 0pt)[#text(weight: 700, name + ":") #body]
  keep({
    if lead != none { block(above: 0pt, below: 8pt, sticky: true, lead) }
    block(width: 100%, stroke: (left: 3pt + hairline), inset: (left: 11pt, right: 0pt, y: 5pt), {
      grid(
        columns: (1fr, auto),
        align: (left + top, right + top),
        mono(finding.id, size: 8.5pt, fill: muted),
        text(size: 9pt, severity(finding.severity)),
      )
      show heading.where(level: 5): it => block(above: 6pt, below: 6pt, text(size: 10.5pt, weight: 700, it.body))
      [#heading(level: 5, finding.titleNl) #label(finding.id)]
      set text(size: 9pt)
      [#eyebrow[Eigenaar] #finding.owner #h(10pt)#if finding.at("vendorTags", default: ()).len() > 0 [#eyebrow[Raakt] #finding.vendorTags.join(", ") #h(10pt)] #eyebrow[Onderdeel] #or-none(finding.component, "geen") #h(10pt) #eyebrow[Pagina's] #finding.pagesAffected]
      linebreak()
      [#eyebrow(t.defect.label) #link(label(defect.id), id-text(defect.id, size: 0.95em)) #h(10pt) #eyebrow(t.defect.main) #criterion-link(defect.mainCriterion, defect.mainCriterion), zie #link(label(defect.mainFindingId), id-text(defect.mainFindingId, size: 0.95em))]
      if check != none [ #h(10pt) #eyebrow(t.defect.check) #chain.verification.at(check.status)]
      set text(size: 9.5pt)
      part("Wat is er mis", prose(finding.observedNl))
      part("Wie heeft er last van", prose(finding.impactNl))
      part("Oplossing", prose(finding.fixNl))
      for location in finding.locations {
        // Words of the page first: a heading and a text can be searched for in any source.
        let words = (
          if location.at("heading", default: none) != none { [onder de kop “#location.heading”] },
          if location.at("text", default: none) != none { [bij “#location.text”] },
        ).filter(word => word != none)
        part("Waar", [#location.page #page-title.at(location.page, default: ""): #if words.len() > 0 [#words.join(", "), ]#where-text(location.where)])
      }
      cutout-of(finding)
    })
  }, limit: 95mm, above: if lead != none { 14pt } else { 10pt })
}

#let finding-card(finding, lead: none) = {
  // A tall card may continue on the next page, but only between its parts.
  let card = block(width: 100%, fill: panel, radius: 4pt, inset: 12pt, {
    block(breakable: false, sticky: true, below: 11pt, {
      grid(
        columns: (1fr, auto),
        align: (left + top, right + top),
        mono(finding.id, size: 8.5pt, fill: muted),
        text(size: 9pt, severity(finding.severity)),
      )
      show heading.where(level: 5): it => block(above: 7pt, below: 8pt, text(size: 12pt, weight: 700, it.body))
      [#heading(level: 5, finding.titleNl) #label(finding.id)]
      text(size: 9pt)[#eyebrow[Eigenaar] #finding.owner #h(10pt)#if finding.at("vendorTags", default: ()).len() > 0 [#eyebrow[Raakt] #finding.vendorTags.join(", ") #h(10pt)] #eyebrow[Onderdeel] #or-none(finding.component, "geen") #h(10pt) #eyebrow[Pagina's] #finding.pagesAffected]
      // Which defect the finding belongs to, and under which criterion that defect is filed.
      let place = if grouping == none { none } else { grouping.ofFinding.at(finding.id, default: none) }
      let check = finding.at("verification", default: none)
      if place != none or check != none {
        linebreak()
        set text(size: 9pt)
        if place != none {
          let defect = defect-by-id.at(place.defectId)
          [#eyebrow(t.defect.label) #link(label(defect.id), id-text(defect.id, size: 0.95em))]
          if place.role == "main" [ #h(10pt) #eyebrow(t.defect.main) dit criterium #h(10pt) #eyebrow(t.defect.also) #if defect.alsoCriteria.len() > 0 { defect.alsoCriteria.map(id => criterion-link(id, id)).join(", ") } else [geen ander criterium]]
          if place.role == "other" [ #h(10pt) #eyebrow(t.defect.main) #criterion-link(defect.mainCriterion, defect.mainCriterion), zie #link(label(defect.mainFindingId), id-text(defect.mainFindingId, size: 0.95em))]
        }
        if check != none [ #h(10pt) #eyebrow(t.defect.check) #chain.verification.at(check.status)]
      }
    })
    cutout-of(finding)
    keep(limit: 110mm, grid(
      columns: (1fr, 1fr),
      column-gutter: 8mm,
      [
        #heading(level: 6, outlined: false)[Wat is er mis]
        #prose(finding.observedNl)
      ],
      [
        #heading(level: 6, outlined: false)[Wie heeft er last van]
        #prose(finding.impactNl)
      ],
    ))
    keep(limit: 110mm, above: 11pt, block(width: 100%, fill: white, stroke: (left: 3pt + accent), radius: (right: 3pt), inset: (x: 11pt, top: 2pt, bottom: 10pt), [
      #heading(level: 6, outlined: false)[Oplossing]
      #prose(finding.fixNl)
    ]))
    keep(limit: 70mm, {
      heading(level: 6, outlined: false)[Waar]
      for location in finding.locations {
        block(above: 5pt, below: 0pt, breakable: false, grid(
          columns: (auto, 1fr),
          column-gutter: 8pt,
          text(size: 9pt, weight: 700, number-width: "tabular", location.page),
          {
            let name = page-title.at(location.page, default: "")
            if name != "" {
              text(size: 9pt, name)
              linebreak()
            }
            // Words of the page first: a heading and a text can be searched for in any source.
            let heading = location.at("heading", default: none)
            let around = location.at("text", default: none)
            if heading != none or around != none {
              text(size: 9pt, (
                if heading != none { [onder de kop “#heading”] },
                if around != none { [bij “#around”] },
              ).filter(part => part != none).join(", "))
              linebreak()
            }
            where-text(location.where)
          },
        ))
      }
    })
  })
  keep({
    if lead != none { block(above: 0pt, below: 8pt, sticky: true, lead) }
    card
  }, limit: 95mm, above: if lead != none { 14pt } else { 10pt })
}

// Level, clause, version and the explanation of W3C: what is fixed about a criterion.
#let criterion-facts(criterion) = {
  [Niveau #criterion.level]
  [ · EN 301 549: #criterion.en301549]
  let note = version-note(criterion)
  if note != none [ · #note]
  [ · ]
  link(criterion.understandingUrl)[Uitleg van dit criterium bij W3C]
}

// The open points of a criterion stand once, in the work list; everywhere else a line points there.
#let open-ref(criterion) = [#derived.briefs.at(criterion.id).openNl, zie #link(label("open-" + criterion.id), t.openLink).]

// The criterion in the main part: outcome, summary, how firm the verdict is and where its
// open points are, then the findings. The full reasoning is in appendix A.
#let criterion-section(criterion) = {
  let brief = derived.briefs.at(criterion.id)
  let head = {
    line(length: 100%, stroke: 0.9pt + ink)
    v(-3pt)
    show heading.where(level: 4): it => text(size: 12.5pt, weight: 700, it.body)
    grid(
      columns: (1fr, auto),
      column-gutter: 6mm,
      align: (left + top, right + top),
      [#heading(level: 4)[#criterion.id #criterion.titleNl] #label("sc-" + criterion.id)],
      badge(shown(criterion), weight: 700),
    )
    v(-4pt)
    block(below: 8pt, text(size: 9pt, fill: muted, {
      criterion-facts(criterion)
      [ · ]
      appendix-link(criterion.id)[Onderbouwing in bijlage A]
      if brief.observationsNl != none [ #box[(#brief.observationsNl)]]
    }))
    prose(criterion.summaryNl)
    block(above: 9pt, below: 0pt, {
      set text(size: 9.5pt)
      grid(
        columns: (auto, 1fr),
        column-gutter: 4mm,
        row-gutter: 5pt,
        eyebrow[Zekerheid], brief.certaintyNl,
        ..if brief.coverageNl != none { (eyebrow(t.measured), brief.coverageNl) },
        ..if brief.openNl != none { (eyebrow[Open], open-ref(criterion)) },
        ..if brief.limitsCountNl != none { (eyebrow[Beperking], [#brief.limitsCountNl van dit onderzoek, de uitkomst hangt er niet van af; zie bijlage A]) },
      )
    })
  }
  // With findings, the head does not stay behind at the foot of a page while its findings start on the next.
  keep(head, above: 18pt, sticky: criterion.findings.len() > 0)

  for (index, finding) in criterion.findings.enumerate() {
    let lead = if index == 0 { text(size: 9pt, weight: 700)[Bevindingen (#criterion.findings.len())] }
    let place = if grouping == none { none } else { grouping.ofFinding.at(finding.id, default: none) }
    if place != none and place.compact { compact-card(finding, place, lead: lead) } else { finding-card(finding, lead: lead) }
  }
}

// Criteria with nothing to act on and nothing to look into: one row each, no block of their own.
#let quiet = criteria.filter(criterion => criterion.id in derived.quiet)
#if quiet.len() > 0 [
  == #t.quietTitle

  #block(sticky: true, par(t.quietIntro))

  #table(
    columns: (24%, auto, 40mm, 1fr),
    inset: (x: 5pt, y: 4pt),
    table.header(th[Criterium], th[Niveau], th[Uitkomst], th[Toelichting]),
    ..quiet.map(criterion => (
      [#appendix-link(criterion.id)[#criterion.id #criterion.titleNl] #label("sc-" + criterion.id)],
      criterion.level,
      badge-cell(criterion.outcome),
      text(size: 9.5pt, prose(criterion.summaryNl)),
    )).flatten(),
  )
]

#for principle in group-criteria(criteria.filter(criterion => criterion.id not in derived.quiet), 1) {
  // The blocks are read one at a time, so they can be set a little tighter than running text.
  set text(size: 10pt)
  set par(leading: 0.62em)
  heading(level: 2)[#principle.key #principle.name]
  for guideline in group-criteria(principle.criteria, 2) {
    heading(level: 3)[Richtlijn #guideline.key #guideline.name]
    for criterion in guideline.criteria { criterion-section(criterion) }
  }
}

// ---------------------------------------------------------------- findings, regrouped

= Bevindingen per onderdeel

#if findings.len() == 0 [Er zijn geen bevindingen.] else {
  // The introduction stays with its table, so the heading does not stand alone at the foot of a page.
  block(sticky: true, par(t.componentIntro))
  let groups = (:)
  let names = (:)
  let loose = ()
  for finding in findings {
    if finding.component == none or finding.component.trim() == "" {
      loose.push(finding)
    } else {
      let key = lower(finding.component).replace(regex("\s+"), " ").trim()
      if key not in groups {
        groups.insert(key, ())
        names.insert(key, finding.component.trim())
      }
      groups.at(key).push(finding)
    }
  }
  // A name that starts with an element of the site, such as nldd-card, keeps that element as it is written.
  let elements = findings.map(finding => finding.at("vendorTags", default: ())).flatten()
  let section-name(name) = if name.split(" ").first() in elements { name } else { capitalise(name) }
  let sections = groups.keys().sorted().map(key => (name: section-name(names.at(key)), items: groups.at(key)))
  if loose.len() > 0 { sections.push((name: "Zonder onderdeel", items: loose)) }
  table(
    columns: (34%, 1fr),
    table.header(th[Onderdeel], th[Bevindingen]),
    ..sections.map(section => (text(weight: 700, section.name), section.items.map(finding => finding-link(finding)).join(", "))).flatten(),
  )
}

#if grouping != none [= Gebreken per pagina] else [= Bevindingen per pagina]

#if findings.len() == 0 [Er zijn geen bevindingen.] else {
  block(sticky: true, par(if grouping != none { t.defectPageIntro } else { t.pageIntro }))
  table(
    columns: (auto, 40%, 1fr),
    table.header(th[Nr.], th[Pagina], if grouping != none { th[Gebreken] } else { th[Bevindingen] }),
    ..sample-items.enumerate().map(((index, item)) => {
      let page-label = page-labels.at(index)
      let here = if grouping != none {
        grouping.byPage.at(page-label).map(id => link(label(id), defect-by-id.at(id).titleNl))
      } else {
        findings.filter(finding => finding.locations.any(location => location.page == page-label)).map(finding => link(label(finding.id), finding.titleNl))
      }
      (
        text(weight: 700, page-label),
        text(weight: 600, or-none(item.title, "(geen titel)")),
        if here.len() == 0 { text(fill: muted, if grouping != none [Geen gebrek met een plek op deze pagina.] else [Geen bevinding met een plek op deze pagina.]) } else { here.join(linebreak()) },
      )
    }).flatten(),
    ..(if documents == none { () } else {
      documents.rows.map(row => (
        text(weight: 700, row.label),
        text(weight: 600, row.title),
        if row.here.len() > 0 { row.here.map(entry => link(label(entry.id), entry.titleNl)).join(linebreak()) } else if row.statusNl.starts-with("Ingelezen") { text(fill: muted, if grouping != none [Geen gebrek met een plek in dit document.] else [Geen bevinding met een plek in dit document.]) } else { text(fill: muted, row.statusNl) },
      )).flatten()
    }),
  )
}

// ---------------------------------------------------------------- reliability

= Betrouwbaarheid en beperkingen

#callout(chain.honestNl)

== #t.versionAccuracy

#derived.versionAccuracyNl

#if chain.stepsNl.len() > 0 [
  == Werkwijze
  #enum(..chain.stepsNl.map(step => [#text(weight: 700, step.nameNl + ".") #step.textNl]))
]

#derived.disagreementNl

#{
  let gate = evaluation.at("chain", default: (:)).at("gate", default: none)
  if gate != none and gate.acceptedNl.len() + gate.limitationsNl.len() > 0 {
    par[Wat de bewijspoort heeft vastgesteld:]
    plain-list((..gate.acceptedNl, ..gate.limitationsNl))
  }
}

#if grouping != none { grouping.mergeNl }

#if derived.generalLimitationsNl.len() > 0 [
  == Beperkingen van dit onderzoek
  #plain-list(derived.generalLimitationsNl)
]

#if derived.procedureLimitations > 0 [
  Bij #derived.procedureLimitations #if derived.procedureLimitations == 1 [criterium] else [criteria] heeft de procedure een eigen beperking. #t.procedureLimits
]

// ---------------------------------------------------------------- traceability

// The short report names the appendix and says where it is; the full report has it here.
#if short [
  #pagebreak(weak: true)
  = Bijlage A: onderbouwing per criterium

  #callout(fill: panel, bar: ink, t.appendixApart)
] else [
#pagebreak(weak: true)
= Bijlage A: onderbouwing per criterium <bijlage-a>

#callout(fill: panel, bar: ink, t.appendixIntro)

// Reference material: smaller, tighter, in two columns.
#let appendix-entry(criterion) = {
  let label-text(body) = text(weight: 700, body)
  [#heading(level: 2, outlined: false, bookmarked: true)[#criterion.id #criterion.titleNl] #label("bijlage-" + criterion.id)]
  // Heading, outcome and facts stay with the first observation, so no heading is left at the foot of a column.
  block(above: 4pt, below: 6pt, sticky: true)[#badge(shown(criterion)) #h(4pt) #link(label("sc-" + criterion.id))[Terug naar het resultaat]]
  // A criterion without a block in the main part has its fixed facts here.
  if criterion.id in derived.quiet { block(sticky: true, par(text(fill: muted, criterion-facts(criterion)))) }
  for (index, observation) in criterion.observations.enumerate() {
    // What the place came to stands first, in words; a place from before verdicts said so has none.
    let place = derived.briefs.at(criterion.id).placesNl.at(index, default: none)
    block(above: 7pt, below: 7pt, stroke: (left: 1.2pt + hairline), inset: (left: 6pt), {
      if place != none {
        par[#label-text[#(index + 1). #t.ruling.outcome:] #place.labelNl#if place.findingId != none [, #t.ruling.seeFinding #link(label(place.findingId), id-text(place.findingId, size: 0.95em))]]
        par[#label-text[Onderzocht:] #prose(observation.checkedNl)]
      } else {
        par[#label-text[#(index + 1). Onderzocht:] #prose(observation.checkedNl)]
      }
      par[#label-text[Hoe:] #prose(observation.howNl)]
      par[#label-text[Waargenomen:] #prose(observation.observedNl)]
      par[#label-text[Bewijs:] #observation.evidence.map(reference => mono(reference, size: 7.4pt)).join(", ")]
    })
  }
  par[#label-text[Oordeel:] #derived.briefs.at(criterion.id).roundsNl]
  if derived.briefs.at(criterion.id).answersNl.len() > 0 {
    par(label-text[#t.answers:])
    plain-list(derived.briefs.at(criterion.id).answersNl)
  }
  if derived.briefs.at(criterion.id).beforeNl.len() > 0 {
    par(label-text[#t.before:])
    plain-list(derived.briefs.at(criterion.id).beforeNl)
  }
  if criterion.challengeNl != none { par[#label-text[#chain.challengeLabel:] #prose(criterion.challengeNl)] }
  if criterion.droppedNl.len() > 0 {
    par(label-text[#chain.droppedLabel:])
    plain-list(criterion.droppedNl)
  }
  if derived.briefs.at(criterion.id).loopsNl.len() > 0 {
    par(label-text[#t.loops:])
    plain-list(derived.briefs.at(criterion.id).loopsNl)
  }
  par({
    label-text[Grondslag: ]
    if criterion.rule != none [beslisregel #criterion.rule, ]
    if criterion.procedure != none [procedure versie #criterion.procedure.version (#criterion.procedure.class).] else [geen procedure vastgelegd.]
  })
  if criterion.procedure != none and criterion.procedure.limitsNl != none {
    par[#label-text[Beperking van de procedure:] #criterion.procedure.limitsNl]
  }
  let later = derived.briefs.at(criterion.id).toolboxPointsNl
  if later.len() > 0 {
    par(label-text[#t.investigate.appendix:])
    plain-list(later)
  }
  let limits = derived.briefs.at(criterion.id).limitsNl
  if limits.len() > 0 {
    par(label-text[#t.investigate.limits:])
    plain-list(limits)
  }
  if derived.briefs.at(criterion.id).openNl != none { par[#label-text[Open:] #open-ref(criterion)] }
}

#{
  set text(size: 8.5pt)
  set par(leading: 0.52em, spacing: 0.5em)
  set list(spacing: 0.5em, body-indent: 5pt)
  show heading.where(level: 2): it => block(above: 12pt, below: 0pt, sticky: true, stroke: (top: 0.7pt + ink), inset: (top: 5pt), width: 100%, text(size: 9.5pt, weight: 700, fill: ink, it.body))
  columns(2, gutter: 7mm, for criterion in criteria { appendix-entry(criterion) })
}
]

// In the short report appendix A is only a note: appendix B follows on the same page, not after a nearly empty one.
#if not short { pagebreak(weak: true) }
= Bijlage B: herleidbaarheid

#t.traceIntro

#facts(
  ("Hash van de evaluatie", full-hash(derived.hash)),
  (
    "Commit van de toolbox",
    if derived.toolboxCommit == none { t.commitUnknown } else [#full-hash(derived.toolboxCommit)#if derived.toolboxChanged [ (met niet vastgelegde wijzigingen)]],
  ),
  ("Hash van de lockfile", full-hash(evaluation.toolchain.toolbox.lockfileSha256)),
  ..derived.speechModels.map(model => ([Hash van het spraakmodel #model.name], full-hash(model.sha256))),
)

#v(6pt)
#table(
  // One judge and a verifier: the two verdicts that exist.
  columns: (auto, 1fr, 1fr, 1fr, 1fr),
  table.header(th[Criterium], th[Procedure], th[Dossier], th(t.trace.judge), th(t.trace.final)),
  ..criteria.map(criterion => (
    criterion-link(criterion.id, criterion.id),
    if criterion.procedure == none [geen] else [v#criterion.procedure.version #short-hash(criterion.procedure.sha256)],
    short-hash(criterion.provenance.dossierSha256),
    short-hash(criterion.provenance.verdictSha256.at("a", default: none)),
    short-hash(criterion.provenance.verdictSha256.at("final", default: none)),
  )).flatten(),
)
