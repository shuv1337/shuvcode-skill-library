import { watch } from "node:fs"
import os from "node:os"
import path from "node:path"
import type { PluginOptions, Skill } from "@opencode/plugin"

export interface Options {
  readonly paths: readonly string[]
  readonly autoinvoke: boolean
}

export function options(input: PluginOptions, directory: string): Options {
  const raw: unknown = input.paths ?? input.path
  const list = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw : []
  return {
    paths: list
      .filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
      .map((entry) => resolve(entry, directory)),
    autoinvoke: input.autoinvoke === true,
  }
}

function resolve(entry: string, directory: string) {
  if (entry === "~") return os.homedir()
  if (entry.startsWith("~/")) return path.join(os.homedir(), entry.slice(2))
  return path.resolve(directory, entry)
}

export async function scan(directory: string): Promise<Skill.Info[]> {
  // Bun.Glob drops every match when `**` appears inside a brace group, so the
  // two shapes core accepts (`<dir>/<id>.md`, `<dir>/**/SKILL.md`) scan separately.
  const files = await Promise.all(
    ["*.md", "**/SKILL.md"].map((pattern) =>
      Array.fromAsync(
        new Bun.Glob(pattern).scan({
          cwd: directory,
          absolute: true,
          onlyFiles: true,
          followSymlinks: true,
          dot: true,
        }),
      ).catch(() => [] as string[]),
    ),
  )
  const skills = await Promise.all(
    Array.from(new Set(files.flat()))
      .toSorted()
      .map(async (filepath) => {
        const content = await Bun.file(filepath)
          .text()
          .catch(() => undefined)
        return content === undefined ? undefined : parse(directory, filepath, content)
      }),
  )
  return skills.filter((skill): skill is Skill.Info => skill !== undefined)
}

export async function load(opts: Options) {
  const skills = new Map<string, Skill.Info>()
  for (const directory of opts.paths) {
    // Later library paths win on duplicate IDs, matching core's skill source precedence.
    for (const skill of await scan(directory)) {
      skills.set(skill.id, opts.autoinvoke ? skill : { ...skill, autoinvoke: false })
    }
  }
  return Array.from(skills.values())
}

export function parse(directory: string, filepath: string, content: string): Skill.Info | undefined {
  const document = frontmatter(content)
  if (!document) return undefined
  const data = document.data
  if (data.name !== undefined && typeof data.name !== "string") return undefined
  if (data.description !== undefined && typeof data.description !== "string") return undefined
  const id =
    path.dirname(filepath) === directory && path.basename(filepath) !== "SKILL.md"
      ? path.basename(filepath, ".md")
      : path.basename(path.dirname(filepath))
  const autoinvoke =
    metadataBoolean(data.metadata, "opencode/autoinvoke") ??
    (boolean(data["disable-model-invocation"]) === true ? false : undefined)
  return {
    id: id as Skill.ID,
    name: (data.name ?? id) as Skill.Name,
    ...(data.description === undefined ? {} : { description: data.description }),
    ...(autoinvoke === undefined ? {} : { autoinvoke }),
    path: filepath as Skill.Info["path"],
    content: document.body,
  }
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/

function frontmatter(content: string) {
  const match = content.match(FRONTMATTER)
  if (!match) return { data: {} as Record<string, unknown>, body: content }
  const data = yaml(match[1]) ?? yaml(sanitize(match[1]))
  if (data === undefined) return undefined
  if (data === null) return { data: {} as Record<string, unknown>, body: match[2] }
  if (typeof data !== "object" || Array.isArray(data)) return undefined
  return { data: data as Record<string, unknown>, body: match[2] }
}

// The YAML parser throws on malformed frontmatter; that is the one boundary
// where a file we do not own gets rejected rather than crashing the scan.
function yaml(source: string): unknown {
  try {
    return Bun.YAML.parse(source)
  } catch {
    return undefined
  }
}

// Other coding agents accept unquoted colons in frontmatter values. Retry
// those values as YAML block scalars so existing skill files keep working.
function sanitize(source: string) {
  return source
    .split(/\r?\n/)
    .flatMap((line) => {
      if (line.trim().startsWith("#") || line.trim() === "" || /^\s+/.test(line)) return [line]
      const entry = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/)
      if (!entry) return [line]
      const value = entry[2].trim()
      if (value === "" || value === ">" || value === "|" || value.startsWith('"') || value.startsWith("'"))
        return [line]
      if (!value.includes(":")) return [line]
      return [`${entry[1]}: |-`, `  ${value}`]
    })
    .join("\n")
}

function metadataBoolean(metadata: unknown, key: string) {
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) return undefined
  return boolean((metadata as Record<string, unknown>)[key])
}

function boolean(value: unknown) {
  if (typeof value === "boolean") return value
  if (typeof value === "number") return value === 1 ? true : value === 0 ? false : undefined
  if (typeof value !== "string") return undefined
  const normalized = value.trim().toLowerCase()
  if (["true", "yes", "on", "1"].includes(normalized)) return true
  if (["false", "no", "off", "0"].includes(normalized)) return false
  return undefined
}

export function observe(directories: readonly string[], onChange: () => void, debounce = 200) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const watchers = directories.flatMap((directory) => {
    try {
      return [
        watch(directory, { recursive: true }, () => {
          clearTimeout(timer)
          timer = setTimeout(onChange, debounce)
        }),
      ]
    } catch {
      // A missing library directory is not an error; it is simply empty until created.
      return []
    }
  })
  return () => {
    clearTimeout(timer)
    for (const watcher of watchers) watcher.close()
  }
}
