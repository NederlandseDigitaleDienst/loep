# Plugin voor AI-assistenten

Soort: beschrijving die bij de code hoort. Een wijziging in de manifesten of de skills werkt haar in dezelfde commit bij.

Deze repository is zelf de plugin `nldd-a11y`: de manifesten staan in `.claude-plugin/`, `.cursor-plugin/` en `.plugin/`, de skills in `skills/`.

| Skill | Waarvoor |
|---|---|
| `nldd-a11y` | Wijst de weg naar de twee andere. |
| `nldd-a11y-audit` | Maakt het toegankelijkheidsonderzoek, stap voor stap. |
| `nldd-a11y-statement` | Maakt van een getekend onderzoek de toegankelijkheidsverklaring. |

De skills roepen de toolbox in `toolbox/` aan. Wie de plugin installeert, heeft dus de hele repository nodig en draait één keer `just install`; `just doctor` zegt welke hulpprogramma's ontbreken.

## In de marketplace van de Nederlandse Digitale Dienst

De plugin staat in de marketplace `NederlandseDigitaleDienst/ai-plugins` (naam `nldd`). Die verwijst per plugin naar de repository waar hij staat, met één blok in `.claude-plugin/marketplace.json` en het overeenkomstige blok in `.cursor-plugin/marketplace.json`:

```json
{
  "name": "nldd-a11y",
  "displayName": "NLDD loep",
  "description": "Experimenteel. loep maakt een toegankelijkheidsonderzoek van een website (WCAG 2.2 en 2.1, niveau A en AA, WCAG-EM) en de toegankelijkheidsverklaring die erop steunt. Drie skills: nldd-a11y wijst de weg, nldd-a11y-audit maakt het onderzoek (scripts meten, agents beoordelen elk criterium met meetinstrumenten en maken elke bevinding opnieuw vanaf een verse pagina, een mens tekent) en nldd-a11y-statement maakt van een getekend onderzoek de verklaring. Vereist Node en just; zie de README.",
  "author": { "name": "Nederlandse Digitale Dienst" },
  "source": { "source": "github", "repo": "NederlandseDigitaleDienst/loep" },
  "category": "productivity",
  "tags": ["experimental", "overheid", "toegankelijkheid", "wcag", "wcag-em", "toegankelijkheidsverklaring", "rijksoverheid"]
}
```

Installeren in Claude Code:

```
/plugin marketplace add NederlandseDigitaleDienst/ai-plugins
/plugin install nldd-a11y@nldd
```

Verandert de beschrijving in de manifesten hier, werk dan ook het blok in de marketplace bij.
