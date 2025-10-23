# CodeFlow CLI

CodeFlow is a terminal-first AI coding assistant that builds a dependency-aware graph of your project so it can deliver laser-focused context to language models. The result is lean prompts, lower token spend, and higher quality suggestions compared with assistants that stream entire files.

## Highlights

- **Graph-aware retrieval** – Symbols and files become graph nodes; imports, calls, and references become edges so the assistant understands real dependencies.
- **Automatic context curation** – Query scoring + dependency walks gather the minimum code required for each change, prioritising callers that would break.
- **Overlay workflow** – Graph edits live in an overlay layer so we can diff or merge them later instead of cloning the entire graph for every branch.
- **Ink-powered TUI** – A responsive terminal UI with `/file` commands, streaming output, edit previews, and status indicators.
- **Usage tracking** – Local JSONL logs surface total requests, tokens used, and savings.

## Quick Start

```bash
npm install -g codeflow-cli

# Initialise in your project
codeflow init

# Authenticate with OpenRouter
codeflow login

# Start a coding session (rebuild graph if needed)
codeflow start --rebuild
```

## Commands

| Command            | Description                                  |
| ------------------ | -------------------------------------------- |
| `codeflow init`    | Initialise config in the current directory   |
| `codeflow login`   | Store your OpenRouter API key securely       |
| `codeflow start`   | Launch the interactive Ink application       |
| `codeflow stats`   | Show total requests, tokens used, and saved  |

Inside the TUI you can use `/file path/to/file.ts` to set the current focus. Press `Esc` once to interrupt streaming with feedback, or twice to exit.

## Configuration

`codeflow init` creates a persistent config with sensible defaults:

```json
{
  "defaultModel": "anthropic/claude-sonnet-4.5",
  "autoTest": false,
  "reviewMode": "each",
  "graphStore": {
    "kind": "memory"
  }
}
```

Switching storage backends is just a config change:

```json
{
  "graphStore": {
    "kind": "neo4j",
    "uri": "neo4j+s://example.databases.neo4j.io",
    "username": "neo4j",
    "password": "super-secret"
  }
}
```

The Neo4j adapter is scaffolded and ready for implementation; the CLI will keep working with the in-memory store until you supply credentials.

## Development

```bash
npm install
npm run typecheck
npm run test        # fast unit suite, no API calls
npm run build
```

Heavy tests that require embeddings or GPU acceleration are gated behind environment flags (see `tests` for details) so you can run them manually on hardware like Vast.ai nodes.

## Roadmap

- Finish the Neo4j adapter for persistent graph overlays
- Expand integration tests that exercise the full retrieval → edit pipeline
- Add onboarding commands for lint/test automation hooks

Contributions, bug reports, and feature requests are welcome. Let’s make dependency-aware coding assistance the default experience. 🚀
