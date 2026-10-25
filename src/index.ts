#!/usr/bin/env node
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/* ------------------------------------------------------------------ *
 * 1) Types and storage (helpers)
 * ------------------------------------------------------------------ */

type SegmentKind = "hook" | "intro" | "chapter" | "outro";

interface Segment {
  order: number;
  kind: SegmentKind;
  title: string;
  startSec: number;
  endSec: number;
  script?: string;
}

interface Project {
  name: string; // slug
  title: string;
  topic: string;
  audience: string;
  targetMinutes: number;
  wpm: number;
  segments: Segment[];
  createdAt: string;
}

// Where projects are stored: env variable, or a folder in the home directory
const DATA_DIR = process.env.VIDEO_MCP_DATA ?? path.join(os.homedir(), ".long-video-mcp");

const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "project";

const projectPath = (name: string) => path.join(DATA_DIR, `${slugify(name)}.json`);

async function loadProject(name: string): Promise<Project> {
  try {
    return JSON.parse(await fs.readFile(projectPath(name), "utf8")) as Project;
  } catch {
    throw new Error(`Project "${name}" not found. Use list_projects or create_project first.`);
  }
}

async function saveProject(p: Project): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(projectPath(p.name), JSON.stringify(p, null, 2), "utf8");
}

const fmtTime = (totalSec: number): string => {
  const s = Math.max(0, Math.round(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return (h > 0 ? `${h}:` : "") + `${mm}:${String(sec).padStart(2, "0")}`;
};

const countWords = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);

const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });

/* ------------------------------------------------------------------ *
 * 2) Planning logic: split a long video into segments
 * ------------------------------------------------------------------ */

function buildStructure(minutes: number, chapterCount?: number): Segment[] {
  const total = Math.round(minutes * 60);
  const hook = minutes >= 8 ? 30 : 20;
  const intro = minutes >= 20 ? 60 : 40;
  const outro = minutes >= 8 ? 60 : 30;
  const body = total - hook - intro - outro;
  if (body < 60) throw new Error("Video is too short for a chapter structure (use at least ~3 minutes).");

  // Ideal chapter length is roughly 3-6 minutes
  const auto = Math.round(body / 270);
  const n = Math.min(12, Math.max(2, chapterCount ?? auto));
  const per = Math.floor(body / n);

  const segs: Segment[] = [];
  let t = 0;
  const push = (kind: SegmentKind, title: string, dur: number) => {
    segs.push({ order: segs.length + 1, kind, title, startSec: t, endSec: t + dur });
    t += dur;
  };
  push("hook", "Hook", hook);
  push("intro", "Intro / promise", intro);
  for (let i = 1; i <= n; i++) {
    // The last chapter takes the remaining seconds so the total matches the target
    const dur = i === n ? body - per * (n - 1) : per;
    push("chapter", `Chapter ${i}`, dur);
  }
  push("outro", "Outro / CTA", outro);
  return segs;
}

const KIND_ADVICE: Record<SegmentKind, string> = {
  hook: "Open with the strongest moment or a bold claim. State the payoff. No logo/intro animation.",
  intro: "Who this is for, what they will get, and why stay until the end. Tease the best part.",
  chapter: "One idea per chapter. Open with a question or tension, deliver, then bridge to the next chapter.",
  outro: "Recap in one sentence, one clear call-to-action, and point to the next video.",
};

/* ------------------------------------------------------------------ *
 * 3) Server definition
 * ------------------------------------------------------------------ */

const server = new McpServer({ name: "long-video", version: "1.0.0" });

/* --- Tool: plan_structure (does not save anything) --- */
server.tool(
  "plan_structure",
  "Plan the segment structure (hook, intro, chapters, outro) of a long-form video for a target duration. Returns time ranges and retention advice. Does not save anything.",
  {
    minutes: z.number().min(3).max(240).describe("Target video length in minutes"),
    chapters: z.number().int().min(2).max(12).optional().describe("Number of chapters; auto if omitted"),
  },
  async ({ minutes, chapters }) => {
    try {
      const segs = buildStructure(minutes, chapters);
      const lines = segs.map(
        (s) => `${fmtTime(s.startSec)}–${fmtTime(s.endSec)}  [${s.kind}] ${s.title}\n    ${KIND_ADVICE[s.kind]}`,
      );
      return ok(
        `Structure for ${minutes} min:\n\n${lines.join("\n")}\n\n` +
          `Retention tip: add a mini-hook (a teaser, a question, or a visual change) about every 2–3 minutes inside long chapters.`,
      );
    } catch (e) {
      return fail((e as Error).message);
    }
  },
);

/* --- Tool: create_project --- */
server.tool(
  "create_project",
  "Create and save a long-video project with an auto-generated structure. Use the returned project name in other tools.",
  {
    title: z.string().min(2).describe("Working title of the video"),
    topic: z.string().min(2).describe("What the video is about"),
    audience: z.string().default("general audience").describe("Who the video is for"),
    minutes: z.number().min(3).max(240).describe("Target length in minutes"),
    chapters: z.number().int().min(2).max(12).optional(),
    wpm: z.number().int().min(80).max(220).default(150).describe("Narration speed in words per minute"),
  },
  async ({ title, topic, audience, minutes, chapters, wpm }) => {
    try {
      const project: Project = {
        name: slugify(title),
        title,
        topic,
        audience,
        targetMinutes: minutes,
        wpm,
        segments: buildStructure(minutes, chapters),
        createdAt: new Date().toISOString(),
      };
      await saveProject(project);
      return ok(
        `Project created: "${project.name}"\n` +
          project.segments.map((s) => `${s.order}. ${fmtTime(s.startSec)} [${s.kind}] ${s.title}`).join("\n") +
          `\n\nNext: rename segments with rename_segment, then save scripts with save_script.`,
      );
    } catch (e) {
      return fail((e as Error).message);
    }
  },
);

/* --- Tool: list_projects --- */
server.tool("list_projects", "List all saved video projects.", {}, async () => {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const files = (await fs.readdir(DATA_DIR)).filter((f) => f.endsWith(".json"));
    if (files.length === 0) return ok("No projects yet. Use create_project.");
    const rows: string[] = [];
    for (const f of files) {
      const p = JSON.parse(await fs.readFile(path.join(DATA_DIR, f), "utf8")) as Project;
      rows.push(`- ${p.name}: "${p.title}" (${p.targetMinutes} min, ${p.segments.length} segments)`);
    }
    return ok(rows.join("\n"));
  } catch (e) {
    return fail((e as Error).message);
  }
});

/* --- Tool: rename_segment --- */
server.tool(
  "rename_segment",
  "Give a segment (e.g. 'Chapter 2') a real title. Titles are used for YouTube chapter timestamps.",
  {
    project: z.string().describe("Project name"),
    order: z.number().int().min(1).describe("Segment number from the structure"),
    title: z.string().min(1).describe("New title"),
  },
  async ({ project, order, title }) => {
    try {
      const p = await loadProject(project);
      const seg = p.segments.find((s) => s.order === order);
      if (!seg) return fail(`No segment #${order}. Valid: 1–${p.segments.length}.`);
      seg.title = title;
      await saveProject(p);
      return ok(`Segment ${order} renamed to "${title}".`);
    } catch (e) {
      return fail((e as Error).message);
    }
  },
);

/* --- Tool: save_script --- */
server.tool(
  "save_script",
  "Save (or replace) the narration script of one segment and report its estimated speaking time versus the planned time.",
  {
    project: z.string(),
    order: z.number().int().min(1),
    script: z.string().min(1).describe("Narration text for this segment"),
  },
  async ({ project, order, script }) => {
    try {
      const p = await loadProject(project);
      const seg = p.segments.find((s) => s.order === order);
      if (!seg) return fail(`No segment #${order}. Valid: 1–${p.segments.length}.`);
      seg.script = script;
      await saveProject(p);
      const words = countWords(script);
      const est = (words / p.wpm) * 60;
      const planned = seg.endSec - seg.startSec;
      const diff = Math.round(est - planned);
      const verdict =
        Math.abs(diff) <= planned * 0.1
          ? "on target"
          : diff > 0
            ? `${diff}s too long — trim or raise the pace`
            : `${-diff}s short — add an example or story`;
      return ok(
        `Saved "${seg.title}": ${words} words ≈ ${fmtTime(est)} (planned ${fmtTime(planned)}) → ${verdict}.`,
      );
    } catch (e) {
      return fail((e as Error).message);
    }
  },
);

/* --- Tool: analyze_script (free text, no project needed) --- */
server.tool(
  "analyze_script",
  "Analyze any narration text: word count, estimated duration, and pacing warnings (very long sentences or paragraphs).",
  {
    text: z.string().min(1),
    wpm: z.number().int().min(80).max(220).default(150),
  },
  async ({ text, wpm }) => {
    const words = countWords(text);
    // The pattern also splits on the Arabic question mark so Arabic scripts are handled
    const sentences = text.split(/[.!?؟…]+/).map((s) => s.trim()).filter(Boolean);
    const paragraphs = text.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
    const avgSentence = sentences.length ? words / sentences.length : 0;
    const longSentences = sentences.filter((s) => countWords(s) > 35).length;
    const longParas = paragraphs.filter((p) => countWords(p) > 120).length;

    const warnings: string[] = [];
    if (avgSentence > 22) warnings.push(`Average sentence is ${avgSentence.toFixed(1)} words — aim for under 20 when spoken.`);
    if (longSentences) warnings.push(`${longSentences} sentence(s) longer than 35 words — split them.`);
    if (longParas) warnings.push(`${longParas} paragraph(s) longer than 120 words (~48s) — add a visual or a beat change.`);

    return ok(
      `Words: ${words}\nEstimated duration @${wpm} wpm: ${fmtTime((words / wpm) * 60)}\n` +
        `Sentences: ${sentences.length} (avg ${avgSentence.toFixed(1)} words)\nParagraphs: ${paragraphs.length}\n` +
        (warnings.length ? `\nWarnings:\n- ${warnings.join("\n- ")}` : "\nNo pacing warnings."),
    );
  },
);

/* --- Tool: project_report --- */
server.tool(
  "project_report",
  "Report progress of a project: which segments have scripts, estimated total runtime versus the target.",
  { project: z.string() },
  async ({ project }) => {
    try {
      const p = await loadProject(project);
      let totalEst = 0;
      const rows = p.segments.map((s) => {
        const planned = s.endSec - s.startSec;
        if (!s.script) return `${s.order}. ${s.title} — no script yet (planned ${fmtTime(planned)})`;
        const est = (countWords(s.script) / p.wpm) * 60;
        totalEst += est;
        return `${s.order}. ${s.title} — ${fmtTime(est)} / ${fmtTime(planned)}`;
      });
      const done = p.segments.filter((s) => s.script).length;
      return ok(
        `"${p.title}" — ${done}/${p.segments.length} segments scripted\n${rows.join("\n")}\n\n` +
          `Scripted runtime so far: ${fmtTime(totalEst)} of ${p.targetMinutes} min target.`,
      );
    } catch (e) {
      return fail((e as Error).message);
    }
  },
);

/* --- Tool: generate_timestamps --- */
server.tool(
  "generate_timestamps",
  "Generate YouTube chapter timestamps for a project. Uses actual script lengths when available, otherwise planned times.",
  {
    project: z.string(),
    use_script_lengths: z.boolean().default(true).describe("Compute times from saved scripts when present"),
  },
  async ({ project, use_script_lengths }) => {
    try {
      const p = await loadProject(project);
      let t = 0;
      const lines: string[] = [];
      for (const s of p.segments) {
        lines.push(`${fmtTime(t)} ${s.kind === "hook" ? "Intro" : s.title}`);
        const planned = s.endSec - s.startSec;
        const actual = s.script && use_script_lengths ? (countWords(s.script) / p.wpm) * 60 : planned;
        t += actual;
      }
      return ok(
        lines.join("\n") +
          `\n\nYouTube rules: the first stamp must be 0:00, at least 3 stamps, each chapter at least 10 seconds.`,
      );
    } catch (e) {
      return fail((e as Error).message);
    }
  },
);

/* --- Tool: shot_list --- */
const VISUALS = ["talking head", "b-roll", "screen / graphic", "text overlay", "b-roll", "diagram"];

server.tool(
  "shot_list",
  "Split a narration script into visual beats (a new visual every N seconds) with timecodes, so a long video never stays on one static shot.",
  {
    script: z.string().min(1),
    seconds_per_visual: z.number().min(3).max(30).default(8),
    wpm: z.number().int().min(80).max(220).default(150),
  },
  async ({ script, seconds_per_visual, wpm }) => {
    // The pattern also splits on the Arabic question mark so Arabic scripts are handled
    const sentences = script.split(/(?<=[.!?؟…])\s+/).map((s) => s.trim()).filter(Boolean);
    const beats: { start: number; text: string[] }[] = [];
    let t = 0;
    let cur = { start: 0, text: [] as string[] };
    let curDur = 0;
    for (const sent of sentences) {
      const d = (countWords(sent) / wpm) * 60;
      cur.text.push(sent);
      curDur += d;
      t += d;
      if (curDur >= seconds_per_visual) {
        beats.push(cur);
        cur = { start: t, text: [] };
        curDur = 0;
      }
    }
    if (cur.text.length) beats.push(cur);

    const out = beats.map((b, i) => {
      const preview = b.text.join(" ");
      const short = preview.length > 110 ? preview.slice(0, 107) + "…" : preview;
      return `${fmtTime(b.start)}  [${VISUALS[i % VISUALS.length]}]  ${short}`;
    });
    return ok(`${beats.length} visual beats (~every ${seconds_per_visual}s):\n\n${out.join("\n")}`);
  },
);

/* --- Tool: production_checklist --- */
server.tool(
  "production_checklist",
  "Return a stage-by-stage production checklist for a long-form video (pre-production, recording, editing, publishing).",
  {
    stage: z.enum(["pre", "recording", "editing", "publishing", "all"]).default("all"),
  },
  async ({ stage }) => {
    const lists: Record<string, string[]> = {
      pre: [
        "One-sentence promise of the video written down",
        "Title + thumbnail idea chosen before scripting",
        "Outline with time budget per chapter",
        "Sources and facts verified",
      ],
      recording: [
        "Audio checked first (clean audio matters more than video)",
        "Record the hook last, once the video is finished, if possible",
        "Leave 2 seconds of silence before/after each take",
        "Capture extra b-roll and screen recordings per chapter",
      ],
      editing: [
        "Cut dead air and filler; keep the first 30s tight",
        "Change the visual at least every 8–10 seconds",
        "Add chapter title cards and a subtle sound bed",
        "Captions / subtitles reviewed",
      ],
      publishing: [
        "Chapters/timestamps added (first one at 0:00)",
        "Description: summary + links in the first 2 lines",
        "End screen pointing to the next video",
        "Pinned comment with a question to start discussion",
      ],
    };
    const keys = stage === "all" ? Object.keys(lists) : [stage];
    return ok(keys.map((k) => `## ${k}\n- [ ] ${lists[k].join("\n- [ ] ")}`).join("\n\n"));
  },
);

/* ------------------------------------------------------------------ *
 * 4) Resources: files Claude can read (project://<project-name>)
 * ------------------------------------------------------------------ */

server.resource(
  "project",
  new ResourceTemplate("project://{name}", {
    list: async () => {
      try {
        await fs.mkdir(DATA_DIR, { recursive: true });
        const files = (await fs.readdir(DATA_DIR)).filter((f) => f.endsWith(".json"));
        return {
          resources: files.map((f) => {
            const name = f.replace(/\.json$/, "");
            return { uri: `project://${name}`, name, mimeType: "application/json" };
          }),
        };
      } catch {
        return { resources: [] };
      }
    },
  }),
  async (uri, { name }) => {
    const p = await loadProject(String(name));
    return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(p, null, 2) }] };
  },
);

/* ------------------------------------------------------------------ *
 * 5) Prompts: ready-made templates
 * ------------------------------------------------------------------ */

server.prompt(
  "write_chapter_script",
  "Template: write the narration for one segment of a project, respecting its time budget.",
  { project: z.string(), order: z.string().describe("Segment number") },
  async ({ project, order }) => {
    const p = await loadProject(project);
    const seg = p.segments.find((s) => s.order === Number(order));
    if (!seg) throw new Error(`No segment #${order}`);
    const dur = seg.endSec - seg.startSec;
    const words = Math.round((dur / 60) * p.wpm);
    return {
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `Write the narration for the "${seg.title}" segment (${seg.kind}) of the video "${p.title}".\n` +
              `Topic: ${p.topic}\nAudience: ${p.audience}\n` +
              `Time budget: ${fmtTime(dur)} ≈ ${words} words at ${p.wpm} wpm.\n` +
              `Guidance: ${KIND_ADVICE[seg.kind]}\n` +
              `Use short spoken sentences. When done, call save_script with project="${p.name}" and order=${seg.order}.`,
          },
        },
      ],
    };
  },
);

/* ------------------------------------------------------------------ *
 * 6) Run over stdio
 * ------------------------------------------------------------------ */

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Important: never use console.log here, it corrupts the stdio channel. Use console.error for debugging.
  console.error(`long-video MCP server running (data: ${DATA_DIR})`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
