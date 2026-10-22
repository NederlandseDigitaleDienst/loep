# Taken voor loep. Een onderzoek in volgorde: install, explore, (verkenner-agent), sweep, tasks, (agents), report. De namen volgen de commando's van de toolbox.

toolbox := justfile_directory() / "toolbox"
cli := "node " + toolbox / "src/cli.ts"

# Toon de beschikbare taken
default:
    @just --list

# Installeer alles wat de toolbox zelf nodig heeft: de vastgepinde pakketten en de drie browsers. Controleert daarna wat er verder op de machine staat
install:
    cd {{toolbox}} && npm ci
    cd {{toolbox}} && if [ "$(uname)" = Linux ] && command -v apt-get >/dev/null; then npx playwright install --with-deps chromium firefox webkit; else npx playwright install chromium firefox webkit; fi
    @just doctor

# Installeer de hulpprogramma's voor pdf, documenten van de site, tekst in beeld, video en geluid, en haal het spraakmodel op. Met Homebrew (macOS) alles; op Debian en Ubuntu wat de pakketbron heeft
tools:
    #!/usr/bin/env sh
    set -e
    if command -v brew >/dev/null; then
      brew install typst poppler qpdf verapdf openjdk ffmpeg tesseract tesseract-lang whisper-cpp
    elif command -v apt-get >/dev/null; then
      sudo apt-get update -qq
      sudo apt-get install -y -qq poppler-utils qpdf ffmpeg tesseract-ocr tesseract-ocr-nld default-jre-headless
      echo "typst, verapdf en whisper-cpp zitten niet in de pakketbron: zie https://github.com/typst/typst, https://verapdf.org en https://github.com/ggml-org/whisper.cpp. Zonder werkt de rest; just doctor zegt wat ontbreekt."
    else
      echo "Geen Homebrew of apt gevonden. Installeer zelf: typst, poppler, qpdf, verapdf, java, ffmpeg, tesseract (met Nederlands) en whisper-cpp. just doctor zegt wat ontbreekt."
    fi
    if command -v whisper-cli >/dev/null; then
      mkdir -p "$HOME/.cache/whisper"
      [ -f "${LOEP_WHISPER_MODEL:-$HOME/.cache/whisper/ggml-small.bin}" ] || curl -L --fail -o "$HOME/.cache/whisper/ggml-small.bin" https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin
    fi
    just doctor

# Zeg wat er op deze machine staat en wat ontbreekt. Zonder een hulpprogramma werkt de rest gewoon; de meting die het nodig heeft meldt zich dan als niet beschikbaar
doctor:
    #!/usr/bin/env sh
    ok() { printf '  aanwezig   %s\n' "$1"; }
    oud() { printf '  TE OUD     %s\n             %s\n' "$1" "$2"; }
    # Is version $1 lower than $2? The first two numbers count.
    lager() { awk -v a="$1" -v b="$2" 'BEGIN { split(a, x, "."); split(b, y, "."); exit !((x[1] + 0 < y[1] + 0) || (x[1] + 0 == y[1] + 0 && x[2] + 0 < y[2] + 0)) }'; }
    # A tool with a lowest version: only where the code shows it needs one. $1 name and what for, $2 found version, $3 lowest, $4 why.
    vanaf() { if [ -n "$2" ] && lager "$2" "$3"; then oud "$1: versie $2" "$4"; else ok "$1: versie ${2:-onbekend}"; fi; }
    eerste() { "$@" 2>&1 | head -1; }
    mist() { printf '  ONTBREEKT  %s\n             %s\n' "$1" "$2"; }
    echo "Nodig:"
    # Node: toolbox/package.json asks for 22.18, the first version that runs TypeScript without a flag.
    if command -v node >/dev/null; then vanaf "node" "$(node --version | sed 's/^v//')" 22.18 "de toolbox draait TypeScript direct met node en heeft Node.js 22.18 of nieuwer nodig (engines in toolbox/package.json)"; else mist "node" "installeer Node.js 22.18 of nieuwer"; fi
    if [ -d "{{toolbox}}/node_modules" ]; then ok "pakketten van de toolbox"; else mist "pakketten van de toolbox" "just install"; fi
    if (cd "{{toolbox}}" && npx playwright install --dry-run chromium 2>/dev/null | grep -q "Install location" && [ -d "$(cd "{{toolbox}}" && npx playwright install --dry-run chromium 2>/dev/null | awk '/Install location/ {print $3; exit}')" ]); then ok "Chromium voor de metingen"; else mist "Chromium voor de metingen" "just install"; fi
    echo "Voor een deel van het werk:"
    # typst: the report is compiled with --pdf-standard ua-1 and the template uses pdf.artifact; both came with typst 0.14.
    if command -v typst >/dev/null; then vanaf "typst (rapport en verklaring als pdf)" "$(eerste typst --version | awk '{print $2}')" 0.14 "het rapport wordt gemaakt als PDF/UA-1 (--pdf-standard ua-1, pdf.artifact); dat kan vanaf typst 0.14"; else mist "typst (rapport en verklaring als pdf)" "just tools; zonder typst krijg je alleen Markdown"; fi
    if command -v pdfinfo >/dev/null && command -v pdftotext >/dev/null && command -v pdftoppm >/dev/null; then ok "poppler: pdfinfo, pdftotext en pdftoppm (pdf-bestanden van de site: tekst, tags en beeld; controle van het eigen rapport): versie $(eerste pdfinfo -v | awk '{print $3}')"; else mist "poppler: pdfinfo, pdftotext en pdftoppm (pdf-bestanden van de site)" "just tools; zonder poppler is van een pdf geen tekst, geen tekst per tag en geen beeld gelezen"; fi
    # qpdf: a pdf is read with --json --json-stream-data=none; that option came with qpdf 11.
    if command -v qpdf >/dev/null; then vanaf "qpdf (pdf-bestanden van de site: tags, tekstalternatieven, formuliervelden, bladwijzers)" "$(eerste qpdf --version | awk '{print $3}')" 11.0 "een pdf wordt gelezen met --json-stream-data; dat kan vanaf qpdf 11"; else mist "qpdf (pdf-bestanden van de site)" "just tools; zonder qpdf is van een pdf alleen gelezen wat pdfinfo zegt"; fi
    if command -v verapdf >/dev/null; then ok "verapdf (PDF/UA-1 van pdf-bestanden van de site en van het eigen rapport): versie $(eerste verapdf --version | awk '{print $2}')"; else mist "verapdf (PDF/UA-1)" "just tools; zonder verapdf is PDF/UA niet gecontroleerd"; fi
    # java: the classes in vnu.jar are built for Java 11.
    if command -v java >/dev/null; then vanaf "java (geldige HTML met de Nu-validator, en verapdf)" "$(eerste java -version | sed -n 's/.*version "\([^"]*\)".*/\1/p')" 11.0 "de Nu-validator (vnu.jar) is gebouwd voor Java 11 of hoger"; else mist "java (geldige HTML met de Nu-validator, en verapdf)" "just tools"; fi
    if command -v tesseract >/dev/null; then ok "tesseract (tekst in afbeeldingen, contrast van tekst in beeld, scans in pdf-bestanden): versie $(eerste tesseract --version | awk '{print $2}')"; else mist "tesseract (tekst in afbeeldingen, scans in pdf-bestanden)" "just tools"; fi
    if command -v ffmpeg >/dev/null && command -v ffprobe >/dev/null; then ok "ffmpeg en ffprobe (video en geluid): versie $(eerste ffmpeg -version | awk '{print $3}')"; else mist "ffmpeg en ffprobe (video en geluid)" "just tools"; fi
    if command -v whisper-cli >/dev/null; then ok "whisper-cli (spraak uitschrijven): versie $(whisper-cli --version 2>&1 | sed -n 's/.*version:* *v*\([0-9][0-9A-Za-z.-]*\).*/\1/p' | head -1)"; else mist "whisper-cli (spraak uitschrijven)" "just tools"; fi
    model="${LOEP_WHISPER_MODEL:-$HOME/.cache/whisper/ggml-small.bin}"
    # The name of a model says little: the sha256 says which file it is. A run records the same hash with every measurement that listens.
    if [ -f "$model" ]; then ok "spraakmodel voor whisper: $(basename "$model"), sha256 $( (command -v sha256sum >/dev/null && sha256sum "$model" || shasum -a 256 "$model") | awk '{print $1}')"; else mist "spraakmodel voor whisper" "just tools, of zet LOEP_WHISPER_MODEL op het pad van een model"; fi
    echo "Optioneel:"
    # A real screen reader in a virtual Mac: never missing, a run works the same without it.
    vm="${LOEP_VOICEOVER_VM:-loep-voiceover}"
    if ! command -v lume >/dev/null; then printf '  niet ingericht  %s\n                  %s\n' "virtuele Mac met VoiceOver (loep voiceover): lume staat niet op deze machine" "alleen nodig voor een echte schermlezer naast de nagebootste; zie docs/voiceover.md en just voiceover-setup"
    elif ! lume get "$vm" >/dev/null 2>&1; then printf '  niet ingericht  %s\n                  %s\n' "virtuele Mac met VoiceOver (loep voiceover): lume $(eerste lume --version) is er, de virtuele Mac $vm niet" "just voiceover-setup"
    else ok "virtuele Mac met VoiceOver (loep voiceover): $vm, lume $(eerste lume --version)"; fi
    echo "Een run legt zelf vast waarmee is gemeten; zie het rapport onder Gereedschap en Herleidbaarheid. TE OUD staat er alleen waar de toolbox aantoonbaar een versie nodig heeft; van de andere hulpprogramma's is geen laagste versie bekend."

# Richt de optionele virtuele Mac met VoiceOver in (loep voiceover): controleert lume en de virtuele Mac, zet in de virtuele Mac wat zonder mens kan en zegt per stap wat je zelf moet doen. Installeert niets op deze machine; zie docs/voiceover.md
voiceover-setup:
    {{cli}} voiceover setup

# Draai de unittests. Met --test-shard=<i>/<n> alleen het i-de van n delen, zoals de volledige controle op GitHub doet
test *flags:
    cd {{toolbox}} && node --test {{flags}} 'test/**/*.test.ts'

# Draai alleen de tests die geen browser starten: een paar seconden, voor tussendoor en voor de snelle controle bij een push
test-quick:
    cd {{toolbox}} && node --test test/compare-findings.test.ts test/contrast.test.ts test/core.test.ts test/defects.test.ts test/docs.test.ts test/estimate.test.ts test/release.test.ts test/searchbody.test.ts test/extractors.test.ts test/feedback.test.ts test/instrument-tasks.test.ts test/origins.test.ts test/portrait.test.ts test/render.test.ts test/sequence.test.ts test/statement.test.ts test/sweepstamp.test.ts test/timing.test.ts test/atonce.test.ts test/verdict.test.ts test/voiceover.test.ts test/again.test.ts test/sweep-check.test.ts

# Controleer de types
check:
    cd {{toolbox}} && npx tsc --noEmit

# Controleer de procedurecatalogus
procedures:
    {{cli}} procedures

# Vind de pagina's van een site en schrijf de opdracht voor de verkenner; start daarna één agent met <run>/explore/verken.md
explore url run:
    {{cli}} inventory {{url}} --out {{run}}
    {{cli}} sample --run {{run}}
    {{cli}} explore --run {{run}}

# Na de verkenner: controleer het sitemodel, trek de steekproef opnieuw (vensters van derden vallen eruit), meet alles, ook de documenten, en vraag de poort. Een tweede keer meet alleen wat veranderd is; met --fresh alles opnieuw. Met --at-once <n> meet de veegronde n pagina's tegelijk, als de eigenaar van de site meer agents toestaat: nooit meer dan het sessieproces van de run toelaat, met dezelfde tijd tussen twee navigaties
sweep run *flags:
    {{cli}} check-site --run {{run}}
    {{cli}} sample --run {{run}}
    {{cli}} collect --run {{run}} {{flags}}
    {{cli}} contrast --run {{run}} {{flags}}
    {{cli}} states --run {{run}} {{flags}}
    {{cli}} documents --run {{run}}
    -{{cli}} gate --run {{run}}

# Zet de opdrachten voor de agents klaar en zeg welke nog open staan (rondgangen, beoordelingen, verificaties)
tasks run:
    {{cli}} tasks --run {{run}}
    {{cli}} pending --run {{run}}

# Zeg in welke fase een run is, zonder iets te schrijven
status run:
    {{cli}} pending --run {{run}}

# Reken de verwachte duur per onderdeel en in totaal uit, naast wat de run al heeft gemeten. Kan vanaf de inventaris en zegt halverwege wat er nog komt; schrijft niets. Met --at-once <n> voor het aantal agents tegelijk en de pagina's tegelijk in de veegronde, --json voor wie verder rekent
estimate run *flags:
    {{cli}} estimate --run {{run}} {{flags}}

# Verzamel de open punten van een of meer runs per soort en per criterium: de werklijst voor wie de veegronde verbetert. Schrijft niets; met --json voor wie verder rekent
gaps run *meer:
    {{cli}} gaps --run {{run}} {{meer}}

# Schrijf voor elk criterium dat open bleef door loep zelf een tekst voor een issue op de repository van loep, zonder adres of naam van de site. Verstuurt niets; met --out <map> een bestand per tekst, --json voor wie verder rekent
feedback run *flags:
    {{cli}} feedback --run {{run}} {{flags}}

# Maak de evaluatie en het rapport van een run waarvan alle opdrachten klaar zijn, en verzegel de run
report run naam organisatie model:
    {{cli}} evaluate --run {{run}} --name "{{naam}}" --organisation "{{organisatie}}" --model "{{model}}"
    {{cli}} render --run {{run}}
    {{cli}} seal --run {{run}}
    @echo "Rapport: {{run}}/report/rapport.pdf, rapport-kort.pdf (zonder bijlage A) en rapport.md. Het is een verzegeld concept tot iemand het leest en tekent met: {{cli}} sign --run {{run}} --name ... --role ... --organisation ... Daarna maakt {{cli}} render --run {{run}} het afgetekende rapport in {{run}}/signed/"

# Leg twee evaluaties van dezelfde site naast elkaar (opgelost, gebleven, nieuw) en schrijf het werkdocument verschil.md in de map uit
diff vorige nieuwe uit:
    {{cli}} diff --previous {{vorige}} --current {{nieuwe}} --out {{uit}}

# IJk de instrumenten op de testgevallen van de ACT-regels van W3C: per instrument en per regel terecht gevonden, gemist en onterecht gemeld. Geen stap van een onderzoek. Haalt de gevallen één keer op naar een map buiten de repository en serveert ze lokaal; de uitkomst komt in validatie/ijkset/<datum>
calibrate *flags:
    {{cli}} calibrate {{flags}}

# Controleer dat elk bestand een rechthebbende en een licentie heeft (REUSE); nieuwe bestandstypes komen in REUSE.toml
reuse:
    uvx --from 'reuse[charset-normalizer]' reuse lint

# Reken alle hashes van een run na
verify run:
    {{cli}} verify --run {{run}}

# Serveer de testsite met ingebouwde gebreken en de schone tweeling (poorten 4710, 4711 en 4712)
testsite *args:
    node {{toolbox}}/fixtures/serve.ts {{args}}

# Regressietoets van de veegronde op de testsite, zonder taalmodel: inventory, het vaste sitemodel uit toolbox/fixtures/sweep, collect, contrast en states op beide varianten, en per gebrek uit de sleutel of het bewijs in het dossier staat (toolbox/fixtures/evidence.ts). Faalt als iets uit de basislijn ontbreekt of de tweeling bewijs krijgt. Met --out <map>, --at-once <n>, --variant defect of clean, --fixed-ports om de testsite op 4710 tot en met 4712 te serveren zodat de runs in <out>/runs een bevroren veegronde voor een meting kunnen zijn, --runs <map> om bestaande runs opnieuw te lezen, --from-report <sweep-check.json> (twee keer, de artefacten van de CI) en --update-baseline om de basislijn bij te werken
sweep-check *flags:
    node {{toolbox}}/scripts/sweep-check.ts {{flags}}

# Bouw de testsite opnieuw uit de bronnen in toolbox/fixtures/src
testsite-build:
    node {{toolbox}}/fixtures/build.ts

# Zet een nieuwe versie klaar op een branch: alle versienummers en het deel in CHANGELOG.md (met de fragmenten uit changelog.d/, via towncrier), als één commit. Daarna een voorstel naar main. Weigert zonder meting in validatie/versies/<versie>.json, tenzij met --unmeasured "<reden>"; die reden komt in CHANGELOG.md
[positional-arguments]
release-prepare version *flags:
    node {{toolbox}}/scripts/release.ts prepare "$@"

# Na de merge, op main: tag de versie, zet de tag op GitHub en maak de release met de tekst uit CHANGELOG.md
release-tag:
    node {{toolbox}}/scripts/release.ts tag
