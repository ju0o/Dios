import { describe, expect, it } from 'vitest'
import { blurbBlocked, blurbStatusLine, createBlurbQueue, pendingBlurbNames, type BlurbProgress } from '../src/core/skill-library/blurb-queue'

describe('background Korean sentences', () => {
  it('keeps only cards that have no sentence yet', () => {
    expect(pendingBlurbNames([
      { name: 'a', korean: '' },
      { name: 'b', korean: '이미 있어요.' },
    ])).toEqual(['a'])
  })

  it('stops when the translator is missing and skips a bad sentence', async () => {
    const blocked = createBlurbQueue({
      listPending: () => ['a', 'b'],
      translate: async () => ({ ok: false, message: '번역 프로그램(Ollama)이 이 컴퓨터에 없어요.', korean: '' }),
    }, { gapMs: 0 })
    await blocked.run()
    expect(blocked.state().phase).toBe('stopped')
    expect(blurbBlocked(blocked.state().message)).toBe(true)

    const have = new Set<string>()
    const calls: string[] = []
    const queue = createBlurbQueue({
      listPending: () => ['a', 'b', 'c'].filter((name) => !have.has(name)),
      translate: async (name) => {
        calls.push(name)
        if (name === 'b') return { ok: false, message: '한 문장으로 자연스럽게 만들지 못했어요.', korean: '' }
        have.add(name)
        return { ok: true, message: '', korean: '한글 설명이에요.' }
      },
    }, { gapMs: 0 })
    await queue.run()
    expect(calls).toEqual(['a', 'b', 'c'])
    expect(queue.state().phase).toBe('done')
    expect(queue.state().message).toContain('몇 개')
  })

  it('stops before the next card when paused', async () => {
    const calls: string[] = []
    const queue = createBlurbQueue({
      listPending: () => ['a', 'b'].filter((name) => !calls.includes(name)),
      translate: async (name) => {
        calls.push(name)
        if (name === 'a') queue.pause()
        return { ok: true, message: '', korean: '한글 설명이에요.' }
      },
    }, { gapMs: 0 })
    await queue.run()
    expect(calls).toEqual(['a'])
    expect(queue.state().phase).toBe('paused')
    const working: BlurbProgress = { phase: 'working', done: 1, total: 4, name: 'a', korean: '', message: '' }
    expect(blurbStatusLine(working)).toBe('한글 설명을 미리 만들고 있어요 · 1/4')
  })
})
