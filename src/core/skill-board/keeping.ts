import fs from 'fs'
import path from 'path'
import { attachSummary } from './library'
import { linkSkill, loadBoard, unlinkSkill, type BoardResult } from './model'

/** One skill waiting in Dios's trash. `when` is milliseconds since 1970. */
export interface TrashItem {
  id: string
  name: string
  when: number
  /** Agents it was attached to. They are attached again when it comes back. */
  agents: string[]
}

const SAFE_NAME = /^[a-z0-9][a-z0-9-]{0,80}$/
const TRASH_ID = /^[a-z0-9][a-z0-9-]{0,80}--\d+$/

/**
 * Attach one skill to several agents in a single pass.
 * Agents that are not connected on this computer, or that refuse the link, are listed as skipped.
 */
export function attachMany(home: string, skillName: string, agentIds: string[]): { linked: string[]; skipped: string[] } {
  const linked: string[] = []
  const skipped: string[] = []
  const agents = loadBoard(home).agents
  for (const id of agentIds) {
    const agent = agents.find((item) => item.id === id)
    if (!agent?.ready) {
      skipped.push(agent?.name ?? id)
      continue
    }
    if (linkSkill(home, id, skillName).ok) linked.push(agent.name)
    else skipped.push(agent.name)
  }
  return { linked, skipped }
}

/** Board action form of attachMany. */
export function attachAll(home: string, skillName: string, agentIds: string[]): BoardResult {
  if (!SAFE_NAME.test(skillName)) return { ok: false, message: '스킬 이름이 이상해요.', board: loadBoard(home) }
  if (!fs.existsSync(path.join(skillsDir(home), skillName, 'SKILL.md'))) {
    return { ok: false, message: '그 스킬 원본이 없어요.', board: loadBoard(home) }
  }
  const { linked, skipped } = attachMany(home, skillName, agentIds)
  return { ok: true, message: attachSummary(linked, skipped), board: loadBoard(home) }
}

/**
 * Take a skill off every agent, then move its folder into Dios's trash.
 * Refuses when an agent holds a real copy instead of a link, so no text is lost.
 */
export function trashSkill(home: string, skillName: string): BoardResult {
  if (!SAFE_NAME.test(skillName)) return { ok: false, message: '스킬 이름이 이상해요.', board: loadBoard(home) }
  const src = path.join(skillsDir(home), skillName)
  if (!fs.existsSync(path.join(src, 'SKILL.md'))) return { ok: false, message: '그 스킬 원본이 없어요.', board: loadBoard(home) }
  const board = loadBoard(home)
  const attached = board.skills.find((skill) => skill.name === skillName)?.agents ?? []
  const removed: string[] = []
  const kept: string[] = []
  for (const id of attached) {
    if (unlinkSkill(home, id, skillName).ok) removed.push(id)
    else kept.push(board.agents.find((agent) => agent.id === id)?.name ?? id)
  }
  if (kept.length) {
    return { ok: false, message: `${kept.join(', ')} 안에 복사본이 있어서 지우지 않았어요.`, board: loadBoard(home) }
  }
  const when = Date.now()
  const id = `${skillName}--${when}`
  fs.mkdirSync(trashDir(home), { recursive: true })
  moveDir(src, path.join(trashDir(home), id))
  fs.writeFileSync(path.join(trashDir(home), `${id}.json`), JSON.stringify({ name: skillName, when, agents: removed }))
  return { ok: true, message: '휴지통으로 옮겼어요. 휴지통에서 다시 꺼낼 수 있어요.', board: loadBoard(home) }
}

/** Skills in the trash, newest first. */
export function listTrash(home: string): { ok: boolean; message: string; items: TrashItem[] } {
  const dir = trashDir(home)
  const items: TrashItem[] = []
  if (fs.existsSync(dir)) {
    for (const file of fs.readdirSync(dir).filter((item) => item.endsWith('.json')).sort().reverse()) {
      const id = file.slice(0, -5)
      if (!TRASH_ID.test(id) || !fs.existsSync(path.join(dir, id))) continue
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as Partial<TrashItem>
        items.push({ id, name: meta.name ?? id.split('--')[0], when: Number(meta.when) || 0, agents: Array.isArray(meta.agents) ? meta.agents : [] })
      } catch {
        // A broken note file only hides that one item; its folder stays in the trash.
      }
    }
  }
  items.sort((a, b) => b.when - a.when)
  return { ok: true, message: items.length ? '' : '휴지통이 비어 있어요.', items }
}

/** Bring a skill back from the trash and attach it where it was before. */
export function untrashSkill(home: string, id: string): BoardResult {
  if (!TRASH_ID.test(id)) return { ok: false, message: '휴지통에서 찾지 못했어요.', board: loadBoard(home) }
  const folder = path.join(trashDir(home), id)
  if (!fs.existsSync(folder)) return { ok: false, message: '휴지통에서 찾지 못했어요.', board: loadBoard(home) }
  const name = id.slice(0, id.lastIndexOf('--'))
  const dest = path.join(skillsDir(home), name)
  if (fs.existsSync(dest)) return { ok: false, message: '같은 이름의 스킬이 이미 있어서 꺼내지 않았어요.', board: loadBoard(home) }
  let agents: string[] = []
  const metaFile = path.join(trashDir(home), `${id}.json`)
  try {
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')) as Partial<TrashItem>
    agents = Array.isArray(meta.agents) ? meta.agents : []
  } catch {
    agents = []
  }
  fs.mkdirSync(skillsDir(home), { recursive: true })
  moveDir(folder, dest)
  fs.rmSync(metaFile, { force: true })
  const { linked, skipped } = attachMany(home, name, agents)
  const extra = attachSummary(linked, skipped)
  return { ok: true, message: extra ? `다시 꺼냈어요. ${extra}` : '다시 꺼냈어요.', board: loadBoard(home) }
}

function skillsDir(home: string): string {
  return path.join(home, '.agents', 'skills')
}

function trashDir(home: string): string {
  return path.join(home, '.local', 'share', 'dios', 'skill-trash')
}

function moveDir(from: string, to: string): void {
  try {
    fs.renameSync(from, to)
  } catch {
    fs.cpSync(from, to, { recursive: true })
    fs.rmSync(from, { recursive: true, force: true })
  }
}
