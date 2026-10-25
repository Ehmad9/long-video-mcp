# long-video-mcp

An MCP (Model Context Protocol) server that helps Claude plan, script, pace and package
long-form videos (10 to 60+ minutes).

## Tools

| Tool | What it does |
|---|---|
| `plan_structure` | Splits a target duration into Hook, Intro, Chapters and Outro, with advice for each part (saves nothing) |
| `create_project` | Creates and saves a project with an auto-generated structure |
| `list_projects` | Lists saved video projects |
| `rename_segment` | Gives a segment a real title (used for YouTube chapters) |
| `save_script` | Saves the narration of a segment and compares its speaking time with the planned time |
| `analyze_script` | Analyzes any text: word count, duration, and long sentences or paragraphs |
| `project_report` | Progress report: scripted segments and total runtime versus the target |
| `generate_timestamps` | Generates YouTube chapter timestamps (`0:00 ...`) |
| `shot_list` | Splits a script into visual beats, with a new visual every N seconds |
| `production_checklist` | Checklist for pre-production, recording, editing and publishing |

**Resources:** `project://<project-name>` returns the full project data (JSON).
**Prompts:** `write_chapter_script` is a template for writing a segment within its time budget.

## Install

Requires [Node.js](https://nodejs.org) (LTS) and [Claude Desktop](https://claude.ai/download).

```bash
git clone https://github.com/Ehmad9/long-video-mcp.git
cd long-video-mcp
npm install
npm run build        # produces build/index.js
npm test             # starts the server and calls every tool
```

## Connect to Claude Desktop

Open `Settings → Developer → Edit Config` and add the server, using the absolute path to
`build/index.js`:

```json
{
  "mcpServers": {
    "long-video": {
      "command": "node",
      "args": ["/absolute/path/to/long-video-mcp/build/index.js"]
    }
  }
}
```

On Windows use forward slashes, for example `C:/long-video-mcp/build/index.js`.
Then fully quit Claude (from the system tray) and open it again.

Projects are stored in `~/.long-video-mcp` by default. Set the `VIDEO_MCP_DATA`
environment variable to change the location.

## Example prompts

- "Create a 25-minute video project about the history of coffee"
- "Write the script for chapter 3, save it, and tell me if it is too long"
- "Generate YouTube chapters for the project"
- "Make a shot list for this script"

## Notes

- Never use `console.log` inside the server, because it corrupts the stdio channel. Use `console.error`.
- The default narration speed is 150 words per minute. For slower speech, set `wpm` to 120-140.

## Contributing and security

Pull Requests are welcome, but **every change is reviewed by hand before merging**, because this
server runs on users' computers. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
