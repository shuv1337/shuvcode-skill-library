# shuvcode-skill-library

A secondary, on-demand skill library for **Shuvcode / OpenCode V2**.

Core skill directories (`~/.config/shuvcode/skills`, `.opencode/skills`, the
`skills` config key) are *primary*: every skill with a description is listed in
the model's system prompt on every request. That is the right place for a small
set, and the wrong place for a large one.

This plugin adds *library* directories whose skills are:

- **not** listed in the system prompt (`<available_skills>`), so they cost no
  context until used;
- shown by `/skills` and the `@` / `$` prompt autocomplete alongside primary skills;
- fully loaded when the user mentions them (`@skill-id`) or the model calls the
  `skill` tool with their ID, exactly like a primary skill.

No core changes: it registers each library skill with `autoinvoke: false`, which
the skill instructions renderer already excludes from the prompt while the
registry, `/skills`, and the `skill` tool still see it.

## Install

Add the plugin with options to the `plugins` array of the server config
(`~/.config/shuvcode/opencode.json` for Shuvcode, `~/.config/opencode/opencode.json`
for upstream V2):

```json
{
  "plugins": [
    {
      "package": "shuvcode-skill-library@0.1.0",
      "options": { "paths": ["~/skills-library"] }
    }
  ]
}
```

Options:

| Option       | Type                 | Default | Meaning                                                                                                                 |
| ------------ | -------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------- |
| `paths`      | `string \| string[]` | `[]`    | Library directories. `~/` expands to the home directory; relative paths resolve against the project directory.           |
| `autoinvoke` | `boolean`            | `false` | When `true`, library skills keep their own frontmatter `autoinvoke` / `disable-model-invocation` value instead of being hidden. |

`path` is accepted as an alias of `paths`.

For local development configure the repository's `dist` directory as the
package instead of the npm name and run `bun run build` after editing.

## Layout and precedence

A library directory uses the same layout as a core skill directory:

```
~/skills-library/
  pdf/SKILL.md          → id "pdf"
  deploy/SKILL.md       → id "deploy"
  one-off.md            → id "one-off"
```

`SKILL.md` frontmatter supports `name`, `description`, `metadata`, and
`disable-model-invocation`. Files that are not valid frontmatter are skipped.

Precedence on duplicate IDs: built-in skills and plugins loaded earlier are never
overwritten; core's config-driven skills load after this plugin and therefore
override a library skill with the same ID. Among library paths, later entries win.

## Live reload

Each library directory that exists at startup is watched recursively. Adding,
editing, or removing a skill file re-scans the library and reloads the skill
registry a short debounce later; `/skills` reflects the change without a restart.
A directory created after startup is picked up on the next config reload or
server start.

## Development

```sh
bun install --frozen-lockfile
bun run check
bun run build
```

## License

MIT.
