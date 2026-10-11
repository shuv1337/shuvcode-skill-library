import { Plugin, type Skill } from "@opencode/plugin"
import { load, observe, options } from "./library"

export default Plugin.define({
  id: "shuvcode.skill-library",
  async setup(context) {
    const config = options(context.options, context.location.directory)
    let skills: Skill.Info[] = await load(config)

    // One transform for the plugin's lifetime; a reload re-runs it against the
    // latest scan. Skills already registered (built-ins, earlier plugins) are
    // left alone, and core's config skills run after this plugin, so a primary
    // skill with the same ID always wins over a library copy.
    await context.skill.transform((editor) => {
      for (const skill of skills) {
        if (editor.get(skill.id)) continue
        editor.add(skill)
      }
    })

    let pending = Promise.resolve()
    const refresh = () => {
      pending = pending
        .then(async () => {
          skills = await load(config)
          await context.skill.reload()
        })
        .catch((error) => console.error("[shuvcode.skill-library] refresh failed", error))
    }
    return observe(config.paths, refresh)
  },
})
