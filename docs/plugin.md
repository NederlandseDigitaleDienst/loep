# Plugin voor AI-assistenten

Soort: beschrijving die bij de code hoort. Een wijziging in de manifesten of de skills werkt haar in dezelfde commit bij.

Deze repository is zelf de plugin `nldd-a11y`: de manifesten staan in `.claude-plugin/`, `.cursor-plugin/` en `.plugin/`, de skills in `skills/`.

| Skill | Waarvoor |
|---|---|
| `nldd-a11y` | Wijst de weg naar de twee andere. |
| `nldd-a11y-audit` | Maakt het toegankelijkheidsonderzoek, stap voor stap. |
| `nldd-a11y-statement` | Maakt van een getekend onderzoek de toegankelijkheidsverklaring. |

De skills roepen de toolbox in `toolbox/` aan. Wie de plugin installeert, heeft dus de hele repository nodig en draait één keer `just install`; `just doctor` zegt welke hulpprogramma's ontbreken.

## Opnemen in de marketplace van de Nederlandse Digitale Dienst

De marketplace `NederlandseDigitaleDienst/ai-plugins` verwijst per plugin naar de repository waar hij staat. Opnemen is één blok in `.claude-plugin/marketplace.json` daar (en het overeenkomstige bestand voor Cursor):

```json
{
  "name": "nldd-a11y",
  "displayName": "NLDD loep",
  "description": "loep maakt een toegankelijkheidsonderzoek van een website (WCAG 2.2 en 2.1, niveau A en AA, WCAG-EM) en de toegankelijkheidsverklaring die erop steunt. Drie skills: nldd-a11y wijst de weg, nldd-a11y-audit maakt het onderzoek en nldd-a11y-statement maakt de verklaring. Vereist Node en just (just install).",
  "author": { "name": "Nederlandse Digitale Dienst" },
  "source": { "source": "github", "repo": "NederlandseDigitaleDienst/loep" },
  "category": "productivity",
  "tags": ["overheid", "toegankelijkheid", "wcag", "toegankelijkheidsverklaring", "rijksoverheid"]
}
```

Dat is nog niet gedaan. Voorwaarde: de marketplace is openbaar, dus een verwijzing werkt alleen als deze repository dat ook is.
