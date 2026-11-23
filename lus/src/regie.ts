import { join } from "node:path";
import type { Site } from "./backlog.ts";
import { repoRoot, stateDir, toolboxCli, workflowFile } from "./paths.ts";

/*
 * The prompt of the regie, and the command line it runs with. Everything the skill asks a person
 * before the first command is answered here, because a `claude -p` has nobody to ask; everything the
 * skill needs a person for later becomes a stop with a vraag.md. The prompt never repeats the
 * procedure: it names the skill and adds only the rules a headless session needs.
 *
 * The skill comes from this checkout (`--plugin-dir`), never from a global install, so the skill, the
 * toolbox and the workflow of a run are the same version as lus.
 */

export interface RegieOptions {
  site: Site;
  run: string;
  /** Agents at the same time, as the phases of the workflow can have them. */
  atOnce: number;
  /** What a person did since the last stop; absent on a first start. */
  resumeNl?: string | null | undefined;
}

/** A site on this machine: sending there reaches nobody, so the toolbox allows it without a declaration. */
export function isLocalHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  if (host === "localhost" || host === "::1" || host.endsWith(".localhost")) return true;
  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host) || /^192\.168\./.test(host)) return true;
  return /^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

const quip = (items: string[]): string => items.map((item) => `"${item}"`).join(", ");

/** What the person answered about sending, in the words the regie needs to run inventory the right way. */
function sendingNl(site: Site): string {
  if (!site.sending.allow) return "niet toegestaan: agents drukken wel op een verzendknop met de vaste testwaarden, maar inventory krijgt geen --allow-writes en geen --test-environment.";
  if (isLocalHost(site.url)) return `op deze machine toegestaan met --allow-writes, hooguit ${site.sending.max} verzendingen voor de hele run (inventory --max-writes ${site.sending.max}).`;
  return `alleen op een verklaarde testomgeving, hooguit ${site.sending.max} verzendingen. De gebruiker verklaart die omgeving zelf en draait inventory daarom zelf in een terminal: stop daarvoor (zie de spelregels) en zet in vraag.md het hele inventory-commando met --test-environment <origin> --declared-by "<naam>, <functie>" --max-writes ${site.sending.max}.`;
}

function loginNl(site: Site, run: string): string {
  if (!site.login) return "geen: de site heeft geen inlog die erbij hoort.";
  const role = site.login.role === "" ? "de rol van het testaccount" : `"${site.login.role}"`;
  return `de site staat achter een inlog op ${site.login.page}. De gebruiker logt zelf in, twee keer (de meting en de sessieproef), op een machine met een scherm: stop daarvoor en zet de commando's in vraag.md, eerst \`node ${toolboxCli} login --run ${run} --url ${site.login.page} --role ${role}\`, daarna hetzelfde met --idle. Vraag het testaccount en nooit een echt account, en geen wachtwoord.`;
}

function mailboxNl(site: Site): string {
  if (!site.mailbox) return "geen: pagina's die alleen via een link in een e-mail te bereiken zijn, blijven open.";
  return `de run heeft een mailbox (${site.mailbox}). De gebruiker draait inventory zelf, in een terminal, met --mailbox ${site.mailbox} en bevestigt dat; stop daarvoor. De inloggegevens van de mailbox staan in de omgeving of de sleutelhanger, nooit in het gesprek of een bestand.`;
}

/** The prompt the regie gets: the site, what the person decided, and the rules of a headless session. */
export function regiePrompt(options: RegieOptions): string {
  const { site, run } = options;
  const lines: string[] = [];
  lines.push(`Je voert een toegankelijkheidsonderzoek uit volgens de skill \`nldd-a11y-audit\`, precies zoals die het beschrijft. Site: ${site.url}. Run: ${run}.`);
  lines.push("");
  lines.push("De keuzes die de skill onder \"Vooraf vragen\" noemt, zijn hieronder beantwoord. Stel ze niet opnieuw, en vraag niets wat de toolbox zelf vaststelt.");
  lines.push("");
  lines.push(`- Naam van de site in het rapport: ${site.name}`);
  lines.push(`- Organisatie van de site: ${site.organisation === "" ? "onbekend; vraag het alleen als het rapport het nodig heeft" : site.organisation}`);
  lines.push(`- Doel van het onderzoek: ${site.purpose === "verantwoorden" ? "verantwoorden hoe de site ervoor staat (purpose verantwoorden)" : "de site beter maken (purpose verbeteren)"}`);
  const scope = [`alles op de origin van ${site.url}`];
  if (site.alsoOrigins.length > 0) scope.push(`daarnaast ${quip(site.alsoOrigins)}, elk met een eigen --also-origin`);
  lines.push(`- Afbakening: ${scope.join("; ")}.${site.neverOpen.length > 0 ? ` Geen agent opent of bevraagt ${quip(site.neverOpen)}, op geen enkele manier.` : ""}`);
  lines.push(`- Versturen: ${sendingNl(site)}`);
  lines.push(`- Inlog: ${loginNl(site, run)}`);
  lines.push(`- Mailbox: ${mailboxNl(site)}`);
  lines.push(`- Agents tegelijk: ${options.atOnce}. Geef dat aan estimate mee als --at-once ${options.atOnce} en aan de werkstroom als atOnce ${options.atOnce}. Start de sessie van de run met ruimte voor ${options.atOnce + 1} sessies als de skill dat vraagt.`);
  if (site.vendorTags.length > 0) lines.push(`- Leverancier: de namen van de elementen beginnen met ${quip(site.vendorTags)}; geef ze aan inventory mee met --vendor-tags ${site.vendorTags.join(",")}.`);
  else lines.push("- Leverancier: onbekend; ga zonder door.");
  if (site.note !== "") lines.push(`- Wat de gebruiker verder meegaf: ${site.note}`);
  if (options.resumeNl) {
    lines.push("");
    lines.push(`Deze run loopt al. ${options.resumeNl}`);
    lines.push("Draai eerst `pending --run <run> --brief` en ga verder waar de run staat; meet niets opnieuw wat al gemeten is.");
  }
  lines.push("");
  lines.push("Spelregels die boven de skill gaan:");
  lines.push("");
  lines.push(`1. Start een agent nooit zelf. Stap 6 draai je met de Workflow-tool op ${workflowFile}, met args {cli: "${toolboxCli}", run: "${run}", atOnce: ${options.atOnce}} en zonder models. Een losse agent start je met de subagent-tool (Task, in sommige versies Agent), met de inhoud van het taakbestand als opdracht. Een werkstroom met honderdvijftig agents over twintig ronden is hier de bedoeling.`);
  lines.push("2. Kan een stap alleen met een mens, of wijst loep je naar een terminal, dan stop je. Schrijf in vraag.md in je werkmap: de vraag in gewone zinnen, het exacte commando tussen drie backticks, en wat er daarna moet bestaan. Verzin geen antwoord, ga niet verder, en teken nooit en verklaar nooit een testomgeving.");
  lines.push("3. Houd lange uitvoer uit je context: schrijf wat lang is naar uitvoer.log in je werkmap en lees daar de laatste veertig regels van.");
  lines.push("4. Meet de site nooit buiten loep om: geen eigen browsers, geen eigen verzoeken naar de site, geen WebFetch. Bash staat open voor gereedschap en voor de commando's uit de skill, maar een verzoek aan de site gaat altijd via loep; curl en wget zijn geweigerd en een eigen scriptje met fetch mag niet.");
  lines.push("");
  lines.push(`Je werkmap is ${join(stateDir(), site.slug)}; de run staat daar met --add-dir open. Alles wat je in de run schrijft, moet loep zelf geschreven hebben: het zegel dekt elk bestand in de run.`);
  return lines.join("\n");
}

/** The command line of the regie. `--tools` has to name Workflow and Task, or those do not exist in a headless session. */
export function regieArgs(prompt: string, run: string): string[] {
  return [
    "-p",
    prompt,
    "--plugin-dir",
    repoRoot,
    "--no-session-persistence",
    "--permission-prompts",
    "none",
    "--permission-mode",
    "acceptEdits",
    "--tools",
    "Bash,Read,Write,Edit,Glob,Grep,Workflow,Task",
    // Bash staat open: de skill schrijft commando's als `cd … && just doctor | tail -60`, en een
    // toelating per commando weigert die samengestelde vormen. Wat de site raakt, houdt de lijst
    // hieronder tegen, en die erft elke agent van de werkstroom.
    "--allowedTools",
    "Bash",
    "Read",
    "Write",
    "Edit",
    "Glob",
    "Grep",
    "Workflow",
    "Task",
    "--disallowedTools",
    "WebFetch",
    "WebSearch",
    "Bash(curl:*)",
    "Bash(wget:*)",
    "Bash(nc:*)",
    "Bash(ssh:*)",
    "--add-dir",
    run,
    "--output-format",
    "stream-json",
    "--verbose",
  ];
}

/**
 * The environment of the regie: an empty config folder keeps the settings, the plugins and the
 * CLAUDE.md of the person out of a run. `--safe-mode` cannot do that here, because it also switches
 * off the skill.
 */
export function regieEnv(): NodeJS.ProcessEnv {
  return { ...process.env, CLAUDE_CONFIG_DIR: join(stateDir(), "claude-home") };
}
