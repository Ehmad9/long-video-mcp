// Smoke test: starts the server over stdio and calls the tools the way Claude does
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "lv-mcp-"));
const transport = new StdioClientTransport({
  command: "node",
  args: ["build/index.js"],
  env: { ...process.env, VIDEO_MCP_DATA: dataDir },
});
const client = new Client({ name: "smoke-test", version: "1.0.0" });
await client.connect(transport);

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.[0]?.text ?? "";
  console.log(`\n=== ${name} ${r.isError ? "(ERROR)" : ""} ===\n${text}`);
  if (r.isError) process.exitCode = 1;
  return text;
};

const tools = await client.listTools();
console.log("Tools:", tools.tools.map((t) => t.name).join(", "));

await call("plan_structure", { minutes: 20 });
await call("create_project", {
  title: "How Coffee Conquered The World",
  topic: "History of coffee trade",
  audience: "curious adults",
  minutes: 20,
});
await call("rename_segment", { project: "how-coffee-conquered-the-world", order: 3, title: "The Ethiopian origins" });
await call("save_script", {
  project: "how-coffee-conquered-the-world",
  order: 1,
  script:
    "What if I told you a single bean changed the course of empires. It fueled revolutions. It built banks. And it all started with goats.",
});
await call("project_report", { project: "how-coffee-conquered-the-world" });
await call("generate_timestamps", { project: "how-coffee-conquered-the-world" });
await call("analyze_script", { text: "This is a short test. It has two sentences." });
await call("shot_list", {
  script: "First we look at the origin. Then we follow the trade routes across the sea. Finally we reach Europe and the first coffee houses.",
  seconds_per_visual: 4,
});
await call("production_checklist", { stage: "pre" });
await call("list_projects");

const prompt = await client.getPrompt({
  name: "write_chapter_script",
  arguments: { project: "how-coffee-conquered-the-world", order: "3" },
});
console.log("\n=== prompt ===\n" + prompt.messages[0].content.text);

const res = await client.listResources();
console.log("\nResources:", res.resources.map((r) => r.uri).join(", "));
const read = await client.readResource({ uri: res.resources[0].uri });
console.log("Resource read OK, bytes:", read.contents[0].text.length);

await client.close();
console.log("\nSMOKE TEST PASSED");
