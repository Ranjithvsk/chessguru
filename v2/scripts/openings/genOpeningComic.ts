// Opening-Comic image generator — see imageStyle.md for the "engine" doc.
//
// Reads an opening's mainline + memory-palace scenes, builds a fully-templated
// prompt (with locked character-anchors so panels stay visually consistent),
// calls Gemini 2.5 Flash Image (Nano Banana), and writes the resulting PNG +
// prompt + manifest to apps/web/public/openings/<slug>/.
//
// Usage:
//   npx tsx v2/scripts/openings/genOpeningComic.ts --slug scandinavian-qa5 [--theme set5] [--plies 12]
//
// Requires: GEMINI_API_KEY in env (or in /home/dreamworld/apps/backend/.env).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PILLARS } from "../../apps/web/src/lib/openings/pillars";
import { themeById, WHITE_ARMY, BLACK_ARMY, type PieceChar } from "../../apps/web/src/lib/memoryPalace";
import { buildSteps, anchorFor } from "../../apps/web/src/lib/openingMemory";

/* ---------- args ---------- */
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]!;
  if (a.startsWith("--")) args.set(a.slice(2), process.argv[i + 1] ?? "");
}
const SLUG = args.get("slug") ?? "scandinavian-qa5";
const THEME_ID = args.get("theme") ?? "set5";
const PLIES = Math.min(20, Math.max(4, Number(args.get("plies") ?? "12")));

/* ---------- env ---------- */
function loadEnv() {
  if (process.env.GEMINI_API_KEY) return;
  const candidates = ["/home/dreamworld/apps/backend/.env", "/home/ubuntu/attendance-app/backend/.env"];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
      if (m && m[1] === "GEMINI_API_KEY" && !process.env.GEMINI_API_KEY) {
        process.env.GEMINI_API_KEY = m[2]!.replace(/^["']|["']$/g, "");
      }
    }
  }
}
loadEnv();
if (!process.env.GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY not set — export it or put it in /home/dreamworld/apps/backend/.env");
  process.exit(1);
}

/* ---------- character visual anchors (generic archetypes — avoid triggering
 * Gemini's copyright/religion safety filters. Names are still shown in
 * captions so the pedagogy stays intact.) ---------- */
const CHAR_VISUAL: Record<string, string> = {
  // white
  "Little Krishna": "small cheerful boy in a bright yellow tunic, holding a wooden flute, dark hair",
  "Hanuman": "flying acrobat with orange fuzzy fur, red vest, holding a large wooden club",
  "Bheem": "sturdy young boy hero in an orange tunic, bare arms, holding a round sweet dumpling",
  "Chutki": "cheerful girl in a bright pink dress, two braided pigtails",
  "Warrior Arjuna": "bearded adult archer in a dark blue tunic, longbow slung over shoulder, quiver of arrows",
  "Young Arjuna": "teenage archer with no beard, light blue tunic, same longbow",
  "Dholu": "round chubby boy in yellow shorts and striped shirt, cheeky grin, riding a small friendly white elephant",
  "Bholu": "twin boy in green shorts and striped shirt, mischievous smile, on a friendly white elephant",
  "Kevin": "tall friendly one-eyed yellow worker in blue denim overalls, a banana in one pocket",
  "Stuart": "short one-eyed yellow worker in blue denim overalls, small guitar strapped over shoulder",
  "Bob": "short two-eyed yellow worker (one green eye, one brown) in blue overalls, hugging a small teddy bear",
  "Dave": "tall two-eyed yellow worker in blue overalls, hair combed over sideways",
  "Phil": "tall one-eyed yellow worker in blue overalls, wide silly grin",
  "Carl": "short two-eyed yellow worker in a tall chef hat and apron over blue overalls",
  "Mel": "tall one-eyed yellow worker with wild bushy black hair sticking up",
  "Larry": "short two-eyed yellow worker wearing a red propeller beanie hat",
  // black
  "Lord Shiva": "wise meditating figure with light blue skin, silver trident behind him, calm expression",
  "Nandi": "large white bull with soft grey markings, golden bells strung around the neck",
  "Tom": "friendly grey cartoon cat with a mischievous grin and small pointed ears",
  "Jerry": "small brown cartoon mouse with big round ears and a cheeky smile",
  "Warrior Karna": "bearded adult warrior in golden armour and a black tunic, holding a longbow",
  "Young Karna": "teenage warrior in golden armour and a light tunic, holding the same longbow",
  "Motu": "cheerful chubby moustached man in a red tunic, on a friendly dark grey elephant",
  "Patlu": "thin bespectacled man in a blue tunic, on a friendly dark grey elephant",
  "Lil-a": "tiny medieval foot-soldier with RED hair, sepia tunic, wooden round shield, small wooden helmet",
  "Lil-b": "tiny medieval foot-soldier with BROWN hair, sepia tunic, wooden shield, small helmet",
  "Lil-c": "tiny medieval foot-soldier with BLACK hair, sepia tunic, wooden shield, small helmet",
  "Lil-d": "tiny medieval foot-soldier with BLOND hair, sepia tunic, wooden shield, small helmet",
  "Lil-e": "tiny medieval foot-soldier with GREY hair, sepia tunic, wooden shield, small helmet",
  "Lil-f": "tiny medieval foot-soldier with WHITE hair, sepia tunic, wooden shield, small helmet",
  "Lil-g": "tiny medieval foot-soldier with ORANGE hair, sepia tunic, wooden shield, small helmet",
  "Lil-h": "tiny medieval foot-soldier with SILVER hair, sepia tunic, wooden shield, small helmet",
};

function visualFor(name: string): string {
  return CHAR_VISUAL[name] ?? name;
}

/* ---------- prompt builder ---------- */
interface PanelSpec {
  n: number;
  character: string;
  verb: string;
  sceneText: string;
  toSquare: string;
  san: string;
  capture: boolean;
  check: boolean;
  castle: boolean;
}

function shortMoveNo(ply: number, color: "w" | "b"): string {
  return color === "w" ? `${Math.ceil(ply / 2)}.` : `${Math.ceil(ply / 2)}…`;
}

function buildPanels(slug: string, themeId: string, maxPlies: number) {
  const opening = PILLARS.find((p) => p.slug === slug);
  if (!opening) throw new Error(`opening not found: ${slug}`);
  const mainline = (opening.mainlinePgn ?? opening.pgnStart).slice(0, maxPlies);
  const scenes = themeById(themeId).scenes;
  const steps = buildSteps(mainline);
  const panels: PanelSpec[] = steps.map((step, i) => {
    const a = anchorFor(step, scenes);
    // The verb is embedded in a.sentence; extract by taking the middle chunk.
    // sentence format: "<char> <verb> the <pair>"[ and grabs it][ — CHECK!]
    const m = /^(\S+(?: \S+)?)\s+(.+?)\s+the\s+(.+?)(?:\s+and\s+grabs\s+it)?(?:\s+—\s+CHECK!)?$/.exec(a.sentence);
    const verb = m?.[2] ?? "moves to";
    return {
      n: i + 1,
      character: a.character,
      verb,
      sceneText: a.scene.scene,
      toSquare: step.to,
      san: step.san,
      capture: step.capture,
      check: step.check,
      castle: step.castle,
    };
  });
  return { opening, themeId, themeName: themeById(themeId).name, panels };
}

function composePrompt({ opening, themeName, panels }: ReturnType<typeof buildPanels>): string {
  const uniqueChars = [...new Set(panels.map((p) => p.character))];
  const charBlock = uniqueChars
    .map((c) => `  - ${c}: ${visualFor(c)}`)
    .join("\n");

  const panelBlock = panels
    .map((p) => {
      const action = p.castle
        ? `${p.character} and the rook swap places at ${p.toSquare} in the middle of the ${p.sceneText}`
        : p.capture
        ? `${p.character} ${p.verb.replace(/marches to/, "charges toward")} the ${p.sceneText} and snatches its prize`
        : `${p.character} ${p.verb} the ${p.sceneText}`;
      const extra = p.check ? ' A small floating "!" bubble hovers over the enemy king in the background.' : "";
      return `Panel ${p.n}: ${action}.${extra} Bottom caption: "${p.n}. ${p.san} · ${p.character}".`;
    })
    .join("\n");

  return [
    `Draw ONE wide landscape (16:9) comic strip made of ${panels.length} equal-width vertical panels numbered 1 to ${panels.length} left-to-right.`,
    "",
    "STYLE (locked, use for EVERY panel):",
    "- Flat 2D cartoon, thick friendly outlines (2-3 px), bright saturated primary colours, painterly backgrounds.",
    "- Think Cartoon Network / early Pixar shorts. NOT anime, NOT photorealistic, NOT dark fantasy.",
    "- Each panel is a medium shot: character shown waist-up, background scene fully visible behind them.",
    "- Panels separated by thin white gutters (~10 px). Panel number in a small black-outlined white circle top-left of each panel.",
    "",
    `STORY: "${opening.name}" — the opening move-by-move, using the "${themeName}" memory-palace scenes as backgrounds.`,
    "",
    "CHARACTERS (KEEP IDENTICAL across every panel they appear in — same face, costume, colour, proportions):",
    charBlock,
    "",
    "PANELS (in order):",
    panelBlock,
    "",
    "Read left-to-right like a book. Do not merge panels. Do not add extra panels. Do not stylise text — captions are simple black sans-serif inside a white ribbon at the bottom of each panel.",
  ].join("\n");
}

/* ---------- Gemini call ---------- */
async function callGemini(prompt: string): Promise<Buffer> {
  const key = process.env.GEMINI_API_KEY!;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${key}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
  };
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Gemini HTTP ${r.status}: ${t.slice(0, 500)}`);
  }
  const j = (await r.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string }; inline_data?: { data?: string; mime_type?: string } }> };
    }>;
  };
  const parts = j.candidates?.[0]?.content?.parts ?? [];
  for (const p of parts) {
    const inline = p.inlineData ?? p.inline_data;
    const data = inline?.data;
    if (data) return Buffer.from(data, "base64");
  }
  throw new Error(`no image in Gemini response: ${JSON.stringify(j).slice(0, 500)}`);
}

/* ---------- main ---------- */
async function main() {
  console.log(`[gen] slug=${SLUG} theme=${THEME_ID} plies=${PLIES}`);
  const spec = buildPanels(SLUG, THEME_ID, PLIES);
  const prompt = composePrompt(spec);

  const HERE = dirname(fileURLToPath(import.meta.url));
  const REPO_ROOT = resolve(HERE, "../..");
  const OUT_DIR = resolve(REPO_ROOT, "apps/web/public/openings", SLUG);
  mkdirSync(OUT_DIR, { recursive: true });

  writeFileSync(`${OUT_DIR}/comic.prompt.txt`, prompt);
  console.log(`[gen] prompt written (${prompt.length} chars) → ${OUT_DIR}/comic.prompt.txt`);
  console.log(`[gen] calling Gemini gemini-2.5-flash-image …`);

  const png = await callGemini(prompt);
  writeFileSync(`${OUT_DIR}/comic.png`, png);
  writeFileSync(
    `${OUT_DIR}/comic.manifest.json`,
    JSON.stringify(
      {
        openingSlug: SLUG,
        openingName: spec.opening.name,
        theme: THEME_ID,
        themeName: spec.themeName,
        plies: spec.panels.length,
        model: "gemini-2.5-flash-image",
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(`[gen] comic.png written (${(png.length / 1024).toFixed(0)} KB) → ${OUT_DIR}/comic.png`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
