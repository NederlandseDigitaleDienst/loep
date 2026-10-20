# Beveiliging

Vond je een kwetsbaarheid in loep, meld die dan niet in een openbaar issue. Gebruik op GitHub de knop **Report a vulnerability** onder het tabblad Security van deze repository. Alleen de beheerders zien die melding.

Beschrijf wat je vond, hoe het na te doen is en welke versie of commit het betreft.

Waar het om gaat, bijvoorbeeld:

- een manier waarop een webpagina die loep onderzoekt code laat draaien buiten de browser, of bestanden buiten de map van de run leest of schrijft;
- een manier waarop een run verzoeken verstuurt die iets veranderen op een site, terwijl er geen testomgeving is verklaard;
- een sessiebestand van een inlog (`login-session.json`) dat in een rapport, een opdracht aan een agent of een logbestand terechtkomt.

## Scope en geheimen

Een sessie van een agent komt alleen bij de site die de run onderzoekt. Een adres is binnen de scope als het met `http`, `https`, `ws` of `wss` begint en op een host van de run ligt, met dezelfde poort. Een andere poort is een andere server. Een bestand op de machine (`file:`) of een adres als `data:` of `blob:` opent een sessie nooit. Een ingesloten venster op deze machine of een lokaal netwerk (loopback, 10/8, 172.16/12, 192.168/16, 169.254/16, fc00::/7, fe80::/10, `.local`) komt alleen in de inventaris en de scope als de site zelf lokaal draait; anders meldt `inventory` het en slaat het over.

De sessiebestanden van een inlog (`login-session.json`, `idle-session.json`) zijn geheimen. Ze staan in de map van de run, buiten het zegel en het rapport. `inventory` en `login` zetten ze in een `.gitignore` in de run, zodat ze niet per ongeluk in een commit komen. Een opdracht aan een agent zegt dat die bestanden nooit gelezen worden.
