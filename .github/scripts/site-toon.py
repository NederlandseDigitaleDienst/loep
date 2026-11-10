"""Build the copy of site/ that Toon serves.

Toon allows scripts and styles from jsDelivr, but no fonts or images from
elsewhere. This copies site/ to the output directory, embeds the design
system's fonts as data URIs in a stylesheet of the site's own, loads the rest
of global.css without its font stylesheets, and serves the favicon and touch
icon from the site itself.

Usage: python3 site-toon.py <site-dir> <out-dir>
"""

import base64
import re
import shutil
import sys
import urllib.request
from pathlib import Path

FONTS = {
    ("RijksSans", "normal"): "RijksSansWeb-Regular.woff2",
    ("RijksSans", "italic"): "RijksSansWeb-Italic.woff2",
    ("JetBrains Mono", "normal"): "JetBrainsMono[wght].woff2",
    ("JetBrains Mono", "italic"): "JetBrainsMono-Italic[wght].woff2",
}
ICONS = ("favicon.svg", "touch-icon.png")


def fetch(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=60) as response:
        return response.read()


def main(site: Path, out: Path) -> None:
    html = (site / "index.html").read_text()
    match = re.search(r'https://cdn\.jsdelivr\.net/npm/@nldd/design-system@([\d.]+)/dist/', html)
    if not match:
        sys.exit("index.html does not load @nldd/design-system from jsDelivr")
    dist = match.group(0)

    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(site, out)

    faces = []
    for (family, style), name in FONTS.items():
        data = base64.b64encode(fetch(dist + "fonts/" + urllib.request.quote(name))).decode()
        faces.append(
            f"@font-face {{ font-family: '{family}'; font-style: {style}; font-weight: 100 900; "
            f"font-display: swap; src: url(data:font/woff2;base64,{data}) format('woff2-variations'); }}"
        )
    (out / "fonts.css").write_text("\n".join(faces) + "\n")

    for icon in ICONS:
        (out / icon).write_bytes(fetch(dist + icon))
        html = html.replace(dist + icon, icon)

    # global.css imports the font stylesheets, whose fonts Toon would refuse;
    # load the rest of what it imports, and the embedded fonts in their place.
    stylesheet = f'<link rel="stylesheet" href="{dist}css/global.css">'
    if stylesheet not in html:
        sys.exit("index.html does not load global.css")
    imports = re.findall(r'@import "\./([\w-]+\.css)";', fetch(dist + "css/global.css").decode())
    parts = list(dict.fromkeys(name for name in imports if not name.endswith("-font.css") and not name.endswith("-fonts.css")))
    if "variables.css" not in parts:
        sys.exit("global.css no longer imports variables.css; check this script")
    links = ['<link rel="stylesheet" href="fonts.css">'] + [f'<link rel="stylesheet" href="{dist}css/{name}">' for name in parts]
    html = html.replace(stylesheet, "\n  ".join(links))
    (out / "index.html").write_text(html)


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]))
