import { afterEach, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import plugin from "../src/index"
import type { SkillEditor } from "@opencode/plugin/promise/skill"
import { load, options, parse, scan } from "../src/library"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "skill-library-"))
  directories.push(directory)
  return directory
}

async function skill(root: string, id: string, frontmatter: string, body = `# ${id}\n`) {
  await mkdir(path.join(root, id), { recursive: true })
  await Bun.write(path.join(root, id, "SKILL.md"), `---\n${frontmatter}\n---\n${body}`)
}

test("options expand ~, resolve relative paths, accept string or array, default autoinvoke off", () => {
  const resolved = options({ paths: ["~/lib", "relative", "/abs"] }, "/project")
  expect(resolved.paths).toEqual([path.join(os.homedir(), "lib"), "/project/relative", "/abs"])
  expect(resolved.autoinvoke).toBe(false)
  expect(options({ path: "~/one", autoinvoke: true }, "/project")).toEqual({
    paths: [path.join(os.homedir(), "one")],
    autoinvoke: true,
  })
  expect(options({}, "/project").paths).toEqual([])
  expect(options({ paths: [42, "", "ok"] }, "/project").paths).toEqual(["/project/ok"])
})

test("parse derives IDs, honours frontmatter flags and unquoted colons", () => {
  const nested = parse(
    "/lib",
    "/lib/alpha/SKILL.md",
    "---\nname: Alpha\ndescription: Use when: things happen\n---\nbody\n",
  )
  expect(nested).toMatchObject({
    id: "alpha",
    name: "Alpha",
    description: "Use when: things happen",
    path: "/lib/alpha/SKILL.md",
    content: "body\n",
  })
  expect(nested?.autoinvoke).toBeUndefined()

  const flat = parse("/lib", "/lib/beta.md", "no frontmatter at all\n")
  expect(flat).toMatchObject({ id: "beta", name: "beta", content: "no frontmatter at all\n" })
  expect(flat?.description).toBeUndefined()

  expect(parse("/lib", "/lib/gamma/SKILL.md", "---\ndisable-model-invocation: true\n---\n")?.autoinvoke).toBe(false)
  expect(parse("/lib", "/lib/delta/SKILL.md", "---\nmetadata:\n  opencode/autoinvoke: yes\n---\n")?.autoinvoke).toBe(
    true,
  )
  expect(parse("/lib", "/lib/bad/SKILL.md", "---\nname: [unclosed\n---\n")).toBeUndefined()
  expect(parse("/lib", "/lib/bad/SKILL.md", "---\nname: 3\n---\n")).toBeUndefined()
})

test("scan finds nested SKILL.md and top-level markdown, skipping unreadable or malformed files", async () => {
  const root = await fixture()
  await skill(root, "one", "description: first")
  await skill(root, "two", "description: second")
  await mkdir(path.join(root, "two", "deep"))
  await Bun.write(path.join(root, "two", "deep", "notes.md"), "ignored: not a skill root\n")
  await Bun.write(path.join(root, "loose.md"), "---\ndescription: loose\n---\nloose body\n")
  await Bun.write(path.join(root, "broken", "SKILL.md"), "---\n: : :\n  - [\n---\n")
  expect((await scan(root)).map((item) => item.id as string)).toEqual(["loose", "one", "two"])
  expect(await scan(path.join(root, "missing"))).toEqual([])
})

test("load forces autoinvoke off unless the library opts in, later paths win", async () => {
  const a = await fixture()
  const b = await fixture()
  await skill(a, "shared", "description: from a")
  await skill(a, "only-a", "description: a\nmetadata:\n  opencode/autoinvoke: true")
  await skill(b, "shared", "description: from b")

  const hidden = await load({ paths: [a, b], autoinvoke: false })
  expect(hidden.map((item) => [item.id, item.description, item.autoinvoke])).toEqual([
    ["only-a", "a", false],
    ["shared", "from b", false],
  ])

  const visible = await load({ paths: [a], autoinvoke: true })
  expect(visible.find((item) => item.id === "only-a")?.autoinvoke).toBe(true)
  expect(visible.find((item) => item.id === "shared")?.autoinvoke).toBeUndefined()
})

test("plugin registers library skills behind existing ones and reloads on file changes", async () => {
  const root = await fixture()
  await skill(root, "lib-skill", "description: from the library")
  await skill(root, "opencode", "description: library copy must not shadow the built-in")

  const registry = new Map<string, { id: string; autoinvoke?: boolean; description?: string }>()
  registry.set("opencode", { id: "opencode", description: "built-in" })
  let transform: ((editor: SkillEditor) => void) | undefined
  const run = () => {
    const seed = new Map([["opencode", registry.get("opencode")!]])
    registry.clear()
    for (const [id, item] of seed) registry.set(id, item)
    const editor: Pick<SkillEditor, "get" | "add"> = {
      get: (id) => registry.get(id) as ReturnType<SkillEditor["get"]>,
      add: (item) => registry.set(item.id, item),
    }
    transform?.(editor as SkillEditor)
  }
  let reloads = 0
  const cleanup = await plugin.setup({
    options: { paths: [root] },
    location: { directory: root },
    skill: {
      transform: async (callback: (editor: SkillEditor) => void) => {
        transform = callback
        run()
        return { dispose: async () => {} }
      },
      reload: async () => {
        reloads += 1
        run()
      },
    },
  } as never)

  expect(registry.get("opencode")?.description).toBe("built-in")
  expect(registry.get("lib-skill")).toMatchObject({ description: "from the library", autoinvoke: false })

  await skill(root, "added-later", "description: appeared while running")
  const deadline = Date.now() + 3000
  while (!registry.has("added-later") && Date.now() < deadline) await Bun.sleep(25)
  expect(registry.get("added-later")).toMatchObject({ description: "appeared while running", autoinvoke: false })
  expect(reloads).toBeGreaterThan(0)

  if (typeof cleanup === "function") await cleanup()
})
