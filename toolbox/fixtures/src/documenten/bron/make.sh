#!/bin/sh
# Writes the documents of the fixture site into src/documenten/ from the sources here:
# a is the file for Lindewaard, b the one for Berkenveen. The output is committed, and
# build.ts only copies it, so the build does not need typst or pandoc. Run this again only
# when a source changes; a newer typst or pandoc writes other bytes.
#
#   sh fixtures/src/documenten/bron/make.sh      (from toolbox/)
set -eu
here=$(cd "$(dirname "$0")" && pwd)
out="$here/.."
mkdir -p "$out"
export SOURCE_DATE_EPOCH=1772409600
pdf() { # source, output, extra typst arguments
  source=$1; target=$2; shift 2
  typst compile --root "$here" "$@" "$here/$source" "$out/tmp-$target"
  # A cross-reference table instead of a stream: the server appends to the budget in place (see fixtures/documents.ts).
  qpdf --object-streams=disable --deterministic-id "$out/tmp-$target" "$out/$target"
  rm "$out/tmp-$target"
}
pdf agenda.typ agenda.a.pdf --no-pdf-tags --input naam=Lindewaard
pdf agenda.typ agenda.b.pdf --input naam=Berkenveen
pdf besluitenlijst.typ besluitenlijst.a.pdf --input naam=Lindewaard --input titel=nee
pdf besluitenlijst.typ besluitenlijst.b.pdf --input naam=Berkenveen
pdf begroting.typ begroting.a.pdf --no-pdf-tags --input naam=Lindewaard
pdf begroting.typ begroting.b.pdf --input naam=Berkenveen
pdf afvalwijzer.typ afvalwijzer.a.pdf --no-pdf-tags --input naam=Lindewaard
pdf afvalwijzer.typ afvalwijzer.b.pdf --input naam=Berkenveen
typst compile --root "$here" --format png --ppi 96 --input namen=ja "$here/plattegrond.typ" "$out/plattegrond.a.png"
typst compile --root "$here" --format png --ppi 96 "$here/plattegrond.typ" "$out/plattegrond.b.png"
pandoc "$here/ontheffing.a.md" -o "$out/ontheffing.a.docx"
pandoc "$here/ontheffing.b.md" -o "$out/ontheffing.b.docx"
