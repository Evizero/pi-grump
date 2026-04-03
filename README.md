# pi-grump

Other coding harnesses might get a buddy. A friendly and cute companion. But who needs cute if there is slop to produce.
So here we are. It is 2026 and I actually took time out of my day to write for you `pi-grump`.

![banner](./banner.png)

In a worldview of minimal core, explicit files, composable extensions, and skepticism toward magic, a true companion
for pi should share those values instead of contradicting them. Other sidecar buddy concepts in other tools lean toward cheerful encouragement and ambient delight. Well, delight yourself on your own time.

So pi gets a grump instead.

`pi-grump` is a small sidecar extension that sits beside the input area, watches what the assistant just did, and occasionally mutters about it. It is not helpful in the conventional sense. It is an old wizard-beard creature living in your terminal who mostly stays quiet but cannot resist speaking up when the code smells like slop, the agent is overbuilding, someone left a secret in plain sight, or, very rarely, a change is so clean and boring that even the grump has to nod. Sometimes it would probably ban you and your clanker if it could. But it can't. So it grumps. For you.

## How it works

`pi-grump` is a pi extension package. It registers a sidecar widget with a sprite, a speech bubble, and a small command surface. Under the hood it runs a heuristic trigger engine that watches recent assistant activity (tool calls, file changes, shell commands, conversation scope) and scores whether the current turn is interesting enough to inspect.
If the score passes threshold and cooldown allows it, the grump assembles recent context and generates one short reaction.

The reaction can come from a cheap dedicated model (gpt-5.4-mini or haiku), the active pi model, or a local deterministic non-llm fallback, whatever is available. The extension does work even without any model at all. It just gets funnier with one.

Every grump has a rarity (Common, Rare, Epic, Legendary), a name, a sprite, and a set of stats that shape what it notices and how it phrases things. Stats split into temperament (GRUMP and WIT govern annoyance and sharpness) and concerns (YAGNI, OBSERVABILITY, DISCIPLINE, CRAFT, and PARANOIA govern what the grump actually cares about). A grump with high PARANOIA will not let an exposed credential slide. A grump with high WIT will find a meaner way to say it.

Legendary grumps are special authored variants with unique sprites, names, and small prompt addenda. There are two. One is very obvious. The other is literally shaped like π.

## Install

`pi-grump` is not published to npm yet. Install it from GitHub or a local path.

### From GitHub

```bash
pi install git:github.com/Evizero/pi-grump
# or pin a tag / commit
pi install git:github.com/Evizero/pi-grump@v0.1.0
```

Project-local install:

```bash
pi install -l git:github.com/Evizero/pi-grump
```

### From a local path

```bash
pi install /absolute/path/to/pi-grump
# or
pi install ./relative/path/to/pi-grump
```

## Quick start

After installing, open pi in a project and run:

```text
/grump
```

That manifests a grump if you do not have one yet. Then keep working normally. If something comment-worthy happens, the sidecar will react.

## Commands

- `/grump` show the current grump, or manifest one if none exists
- `/grump status` show identity, stats, effective model, and config summary
- `/grump model` inspect or configure which model generates reactions
- `/grump whisper <text>` whisper directly to the grump without sending a turn to the main assistant
- `/grump on` / `/grump off` unmute or mute reactions
- `/grump reset` manifest a fresh grump
- `/grump help` show command help

## Configuration

`pi-grump` uses dedicated config files. Project config overrides global config.

```text
~/.pi/agent/extensions/grump.json    # global
.pi/extensions/grump.json            # project
```

A minimal example:

```json
{
  "enabled": true,
  "muted": false,
  "commentary": {
    "enabled": true,
    "cooldownMs": 10000,
    "minScoreToSpeak": 4,
    "recentMessages": 6,
    "reactionModel": {
      "mode": "auto",
      "allowActiveModelFallback": true,
      "allowLocalFallback": true
    }
  },
  "ui": {
    "showTeaser": true,
    "reactionShowMs": 10000,
    "reactionFadeMs": 3000
  }
}
```

The reaction model defaults to `auto`, which picks a cheap model when possible (`gpt-5.4-mini` for OpenAI users, `claude-haiku-4-5` for Anthropic, `gemini-2.5-flash` for Google), falls back to the active model, then to local canned reactions. You can override this with `/grump model` or in config. Run `/grump model` to see what is currently active.

## Local development

```bash
npm install
npm run lint
npm run test
```

The extension source lives under `.pi/extensions/grump/`. The root `package.json` exists so the repo can be installed directly from git as a pi package. TypeScript source loads directly via pi's extension loader.
