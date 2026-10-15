# Plugin voor AI-assistenten

Soort: beschrijving die bij de code hoort. Een wijziging in de manifesten of de skills werkt haar in dezelfde commit bij.

Deze repository is zelf de plugin `nldd-a11y`: de manifesten staan in `.claude-plugin/`, `.cursor-plugin/` en `.plugin/`, de skills in `skills/`.

| Skill | Waarvoor |
|---|---|
| `nldd-a11y` | Wijst de weg naar de twee andere. |
| `nldd-a11y-audit` | Maakt het toegankelijkheidsonderzoek, stap voor stap. |
| `nldd-a11y-statement` | Maakt van een getekend onderzoek de toegankelijkheidsverklaring. |

Hoe je de skills gebruikt, staat in [gebruik.md](gebruik.md). De skills roepen de toolbox in `toolbox/` aan. Wie de plugin installeert, heeft dus de hele repository nodig en draait één keer `just install`; `just doctor` zegt welke hulpprogramma's ontbreken.

## In de marketplace van de Nederlandse Digitale Dienst

De plugin staat in de marketplace `NederlandseDigitaleDienst/ai-plugins` (naam `nldd`). Die verwijst per plugin naar de repository waar hij staat, met één blok in `.claude-plugin/marketplace.json` en het overeenkomstige blok in `.cursor-plugin/marketplace.json`:

```json
{
  "name": "nldd-a11y",
  "displayName": "NLDD loep",
  "description": "Experimenteel. loep maakt een toegankelijkheidsonderzoek van een website (WCAG 2.2 en 2.1, niveau A en AA, WCAG-EM) en de toegankelijkheidsverklaring die erop steunt. Drie skills: nldd-a11y wijst de weg, nldd-a11y-audit maakt het onderzoek (scripts meten, agents beoordelen elk criterium met meetinstrumenten en maken elke bevinding opnieuw vanaf een verse pagina, een mens tekent) en nldd-a11y-statement maakt van een getekend onderzoek de verklaring. Vereist Node en just; zie de README.",
  "author": { "name": "Nederlandse Digitale Dienst" },
  "source": { "source": "github", "repo": "NederlandseDigitaleDienst/loep", "ref": "v0.3.0" },
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

## Versies in de marketplace

Het blok wijst met `ref` naar de tag van een versie, niet naar `main`. Wie de plugin heeft, krijgt zo alleen versies die zijn uitgebracht; een onderzoek dat loopt, krijgt geen code die halverwege verandert. Claude Code ziet een update aan het veld `version` in `.claude-plugin/plugin.json`: blijft dat gelijk, dan blijft de plugin staan, ook als er nieuwe commits zijn.

Na `just release-tag` (zie [CONTRIBUTING.md](../CONTRIBUTING.md#versies)) zet een beheerder de nieuwe tag in beide blokken van de marketplace, in een voorstel aan `NederlandseDigitaleDienst/ai-plugins`. Een update komt bij een gebruiker met `/plugin marketplace update nldd`, of vanzelf als automatisch bijwerken voor deze marketplace aanstaat.
