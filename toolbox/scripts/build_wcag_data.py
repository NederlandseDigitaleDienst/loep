"""Build data/wcag22-nl.json from the authorised Dutch translation of WCAG 2.2.

    uv run scripts/build_wcag_data.py < WCAG22-nl.html > data/wcag22-nl.json

Source: https://www.w3.org/Translations/WCAG22-nl/ . Titles are taken verbatim so
that reports cite the authorised wording. WCAG 2.1's 4.1.1 Parsing was removed in
2.2 and is added here by hand because the 2.1 view of a report still lists it.
"""

import html
import json
import re
import sys

SOURCE_URL = "https://www.w3.org/Translations/WCAG22-nl/"
NEW_IN_22 = {"2.4.11", "2.4.12", "2.4.13", "2.5.7", "2.5.8", "3.2.6", "3.3.7", "3.3.8", "3.3.9"}

HEADING = re.compile(
    r'<section class="(?P<kind>principle|guideline|sc[^"]*)"[^>]*id="(?P<slug>[^"]+)">.*?'
    r'<bdi class="secno">(?P<num>[\d.]+?)\.? </bdi>(?P<title>.*?)</h\d>'
    r'(?P<rest>.*?)(?=<section class="(?:principle|guideline|sc)|\Z)',
    re.S,
)
LEVEL = re.compile(r'class="conformance-level">\(Niveau (A{1,3})\)')


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", text))).strip()


def main() -> None:
    page = sys.stdin.read()
    principles, guidelines, criteria = {}, {}, []
    for match in HEADING.finditer(page):
        kind, num, title = match["kind"], match["num"], clean(match["title"])
        if kind == "principle":
            principles[num] = title
        elif kind == "guideline":
            guidelines[num] = title
        else:
            level = LEVEL.search(match["rest"])
            if not level:
                continue
            criteria.append(
                {
                    "id": num,
                    "slug": match["slug"],
                    "titleNl": title,
                    "level": level[1],
                    "versions": ["2.2"] if num in NEW_IN_22 else ["2.1", "2.2"],
                }
            )
    criteria.append(
        {"id": "4.1.1", "slug": "parsing", "titleNl": "Parsen", "level": "A", "versions": ["2.1"]}
    )
    criteria.sort(key=lambda c: [int(part) for part in c["id"].split(".")])
    json.dump(
        {"source": SOURCE_URL, "principles": principles, "guidelines": guidelines, "criteria": criteria},
        sys.stdout,
        ensure_ascii=False,
        indent=2,
    )
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
