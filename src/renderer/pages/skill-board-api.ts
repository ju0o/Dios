import type { BoardResult, SkillBoard } from '../../core/skill-board/model'
import type { Place } from '../../core/skill-board/places'
import type { CompareColumn, CompareRow, PlaceBoard } from '../../core/skill-board/board-service'
import type { SkillVersion } from '../../core/skill-board/library'
import type { TrashItem } from '../../core/skill-board/keeping'

export type { BoardResult, SkillBoard, CompareColumn, CompareRow, SkillVersion, TrashItem }

/** Skill board calls exposed by the Electron preload. */
export interface BoardApi {
  skillBoardPlaces: () => Promise<Place[]>
  skillBoardGet: (placeId: string) => Promise<PlaceBoard>
  skillBoardLink: (placeId: string, agentId: string, skillName: string) => Promise<BoardResult>
  skillBoardUnlink: (placeId: string, agentId: string, skillName: string) => Promise<BoardResult>
  skillBoardAck: (placeId: string, skillName: string) => Promise<BoardResult>
  skillBoardCreate: (placeId: string, name: string, summary: string, steps: string[], agentIds: string[]) => Promise<BoardResult>
  skillBoardRead: (placeId: string, name: string) => Promise<{ ok: boolean; message: string; text: string }>
  skillBoardSave: (placeId: string, name: string, text: string) => Promise<BoardResult>
  skillBoardSend: (fromId: string, toId: string, name: string, overwrite: boolean, agentIds?: string[]) => Promise<BoardResult>
  skillBoardGuide: (placeId: string, agentId: string, on: boolean) => Promise<BoardResult>
  skillBoardHolders: (placeId: string, name: string) => Promise<{ ok: boolean; message: string; places: Array<{ id: string; name: string; state: 'same' | 'different' | 'missing' }> }>
  skillBoardReflect: (placeId: string, name: string, toIds: string[]) => Promise<BoardResult>
  skillBoardHistory: (placeId: string, name: string) => Promise<{ ok: boolean; message: string; versions: SkillVersion[] }>
  skillBoardRestore: (placeId: string, name: string, versionId: string) => Promise<BoardResult>
  skillBoardTrash: (placeId: string, name: string) => Promise<BoardResult>
  skillBoardTrashList: (placeId: string) => Promise<{ ok: boolean; message: string; items: TrashItem[] }>
  skillBoardUntrash: (placeId: string, id: string) => Promise<BoardResult>
  skillBoardCompare: (placeId: string) => Promise<{ columns: CompareColumn[]; rows: CompareRow[] }>
  skillBoardTranslate: (placeId: string, name: string, text: string) => Promise<{ ok: boolean; message: string; text: string }>
}

/** The preload API, or null when the page is opened outside the desktop app. */
export function boardApi(): BoardApi | null {
  const api = (window as unknown as { electronAPI?: Partial<BoardApi> }).electronAPI
  return api?.skillBoardGet && api.skillBoardPlaces ? (api as BoardApi) : null
}

/** "방금", "3분 전", "2시간 전", "4일 전", or a local date for older times. */
export function whenText(ms: number, now: number = Date.now()): string {
  const minutes = Math.floor((now - ms) / 60000)
  if (minutes < 1) return '방금'
  if (minutes < 60) return `${minutes}분 전`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}시간 전`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}일 전`
  const date = new Date(ms)
  return `${date.getMonth() + 1}월 ${date.getDate()}일`
}

/** What the compare row can do against the computer currently open. */
export function compareMoves(baseId: string, cells: Record<string, string>): { align: string[]; send: string[]; bring: string[] } {
  const align: string[] = []
  const send: string[] = []
  const bring: string[] = []
  const here = cells[baseId]
  for (const [id, state] of Object.entries(cells)) {
    if (id === baseId || state === 'unknown') continue
    if (here === 'base' && state === 'different') align.push(id)
    if (here === 'base' && state === 'missing') send.push(id)
    if (here === 'missing' && state === 'different') bring.push(id)
  }
  return { align, send, bring }
}

/** Case-insensitive match on the skill name and its Korean summary. */
export function matchesSearch(skill: { name: string; summary: string }, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return skill.name.toLowerCase().includes(q) || skill.summary.toLowerCase().includes(q)
}
