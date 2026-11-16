# Plugin voor AI-assistenten

Soort: beschrijving die bij de code hoort. Een wijziging in de manifesten of de skills werkt haar in dezelfde commit bij.

Deze repository is zelf de plugin `nldd-a11y`: de manifesten staan in `.claude-plugin/`, `.cursor-plugin/` en `.plugin/`, de skills in `skills/`.

| Skill | Waarvoor |
|---|---|
| `nldd-a11y` | Wijst de weg naar de andere. |
| `nldd-a11y-audit` | Maakt het toegankelijkheidsonderzoek, stap voor stap. |
| `nldd-a11y-statement` | Maakt van een getekend onderzoek de toegankelijkheidsverklaring. |
| `nldd-a11y-quick` | Zet een snelle meting zonder taalmodel op die in een pipeline met de vorige release vergelijkt. |
| `nldd-a11y-contribute` | Stuurt het meetblad van een onderzoek in naar de gedeelde verzameling, ook van onderzoeken van vroeger. |

Hoe je de skills gebruikt, staat in [gebruik.md](gebruik.md). De skills roepen de toolbox in `toolbox/` aan. Wie de plugin installeert, heeft dus de hele repository nodig en draait `just install`, ook na elke update: elke versie staat in een eigen map. `just doctor` zegt wat ontbreekt.

## In de marketplace van de Nederlandse Digitale Dienst

De plugin staat in de marketplace `NederlandseDigitaleDienst/ai-plugins` (naam `nldd`). Die verwijst per plugin naar de repository waar hij staat, met één blok in `marketplace.json` in de root. Dat bestand is de bron. De bestanden die elke tool leest, `.claude-plugin/marketplace.json`, `.cursor-plugin/marketplace.json` en `.agents/plugins/marketplace.json`, maakt een script daaruit; die pas je niet met de hand aan. Het blok in de bron:

```json
{
  "name": "nldd-a11y",
  "displayName": "NLDD loep",
  "description": "Experimenteel. loep maakt een toegankelijkheidsonderzoek van een website (WCAG 2.2 en 2.1, niveau A en AA, WCAG-EM) en de toegankelijkheidsverklaring die erop steunt. Vijf skills: nldd-a11y wijst de weg, nldd-a11y-audit maakt het onderzoek (scripts meten, agents beoordelen elk criterium met meetinstrumenten en maken elke bevinding opnieuw vanaf een verse pagina, een mens tekent), nldd-a11y-statement maakt van een getekend onderzoek de verklaring, nldd-a11y-quick bewaakt in een pipeline zonder taalmodel dat een site niet slechter wordt, en nldd-a11y-contribute stuurt van een onderzoek een meetblad zonder de site in naar een gedeelde verzameling. Het register van toegankelijkheidsverklaringen heeft een onderzoek met loep niet bevestigd als onderbouwing van status A of B. Vereist Node en just; zie de README.",
  "author": { "name": "Nederlandse Digitale Dienst" },
  "source": { "source": "github", "repo": "NederlandseDigitaleDienst/loep", "ref": "v0.24.1" },
  "category": "productivity",
  "tags": ["experimental", "overheid", "toegankelijkheid", "wcag", "wcag-em", "toegankelijkheidsverklaring", "rijksoverheid"]
}
```

Installeren in Claude Code:

```
/plugin marketplace add NederlandseDigitaleDienst/ai-plugins
/plugin install nldd-a11y@nldd
```

Verandert de beschrijving in de manifesten hier, werk dan ook het blok in de marketplace bij, op dezelfde manier als een nieuwe versie hieronder.

## Versies in de marketplace

Het blok wijst met `ref` naar de tag van een versie, niet naar `main`. Wie de plugin heeft, krijgt zo alleen versies die zijn uitgebracht; een onderzoek dat loopt, krijgt geen code die halverwege verandert. Claude Code ziet een update aan het veld `version` in `.claude-plugin/plugin.json`: blijft dat gelijk, dan blijft de plugin staan, ook als er nieuwe commits zijn.

Na `just release-tag` (zie [CONTRIBUTING.md](../CONTRIBUTING.md#versies)) zet een beheerder de nieuwe tag in de marketplace, in een voorstel aan `NederlandseDigitaleDienst/ai-plugins`:

1. Zet in `marketplace.json` in de root bij `nldd-a11y` de nieuwe tag in `ref`.
2. Draai de generator van ai-plugins, het script `generate_marketplace.py` in de map .github/scripts (in de justfile daar de taak `generate`). Die schrijft de bestanden voor Claude Code, Cursor en Codex opnieuw.
3. Neem de bron en de gemaakte bestanden op in één voorstel. De CI draait `generate_marketplace.py --check` en weigert een voorstel waarin ze niet bij de bron passen.

Een update komt bij een gebruiker met `/plugin marketplace update nldd`, of vanzelf als automatisch bijwerken voor deze marketplace aanstaat.
