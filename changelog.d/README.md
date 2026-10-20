# Fragmenten voor CHANGELOG.md

Wat een voorstel verandert, schrijf je hier in een eigen bestand, niet in [CHANGELOG.md](../CHANGELOG.md). Twee voorstellen schrijven zo nooit in hetzelfde bestand en botsen dus niet.

Een fragment heet `<issue>.<soort>.md`. De soort zegt onder welke kop de regel komt:

| Soort | Kop in CHANGELOG.md | Wanneer |
|---|---|---|
| `uitkomst` | Wat een uitkomst kan veranderen | Een oordeel of meting kan anders uitvallen. |
| `verder` | Verder | Al het andere. |

Maak een fragment met [towncrier](https://towncrier.readthedocs.io/):

```sh
uvx towncrier@26.9.0 create 161.verder.md --content "Wat er verandert, voor wie loep gebruikt."
```

Het bestand bevat alleen de tekst, zonder `- ` ervoor; towncrier maakt er een punt van en zet de link naar het issue erachter. Hoort een wijziging niet bij een issue, begin de naam dan met `+`, bijvoorbeeld `+zoekvenster.verder.md`. Een andere naam of soort laat de release falen.

`just release-prepare <versie>` zet alle fragmenten in het nieuwe deel van CHANGELOG.md, samen met de regels die daar nog onder "Nog niet uitgebracht" staan, en verwijdert de fragmenten in dezelfde commit. Zie [CONTRIBUTING.md](../CONTRIBUTING.md#versies).
