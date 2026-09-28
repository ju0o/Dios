import { hangulShare, judge, leftoverEnglish, splitFront } from '../src/core/skill-board/translate'
import { isBrokenTranslation, isRepetitive, proseBlocks, summaryOk } from '../src/core/skill-board/translation-quality'

describe('translation quality checks', () => {
  it('flags Chinese characters and untranslated English, but not names the source keeps', () => {
    expect(judge('Run the tests.', '테스트를 실행하세요.')).toBe('')
    expect(judge('Run the tests.', '测试를 실행하세요.')).toContain('한자')
    expect(judge('Run the tests.', 'Run 테스트를 실행하세요. tests')).toContain('영어 단어')
    expect(judge('Use Agent Relay for the queue.', 'Agent Relay로 대기열을 처리하세요.')).toBe('')
    expect(judge('Run the tests.', 'Run the tests.')).toContain('한국어가 아니에요')
  })

  it('lists only the English words the source did not already have', () => {
    expect(leftoverEnglish('Open the Dashboard tab.', 'Dashboard 탭을 열고 refresh 하세요.')).toEqual(['refresh'])
  })

  it('rejects a translation that repeats itself or runs away, and keeps a short Korean sentence', () => {
    const piece = '설계 그림을 살펴보고 파일로 보내요.'
    expect(isRepetitive(piece.repeat(4))).toBe(true)
    expect(isRepetitive('파일을 팀에 보내요.')).toBe(false)
    expect(isBrokenTranslation(`${piece.repeat(4)}`)).toBe(true)
    expect(isBrokenTranslation(`한자 ${'가'.repeat(20)}`)).toBe(false)
    expect(isBrokenTranslation('设计를 봐요.')).toBe(true)
    expect(isBrokenTranslation(`x${'가'.repeat(520)}`)).toBe(true)
    expect(summaryOk('풀 리퀘스트를 살펴보고 짧은 의견을 남겨요.')).toBe(true)
    expect(summaryOk(piece.repeat(6))).toBe(false)
    expect(summaryOk('Send the file.')).toBe(false)
  })

  it('keeps a code fence whole and only translates the description line of the header', () => {
    const blocks = proseBlocks('Hello.\n\n```\nnpm test\n```\n\nNext line.')
    expect(blocks).toEqual(['Hello.', '', '```\nnpm test\n```', '', 'Next line.'])
    const split = splitFront('---\nname: demo\ndescription: Send the file.\n---\n\n# Title\n')
    expect(split.head).toContain('name: demo')
    expect(split.body.trim().startsWith('# Title')).toBe(true)
    expect(split.head).not.toContain('# Title')
  })

  it('measures how much of the letters are Hangul', () => {
    expect(hangulShare('한글만 있어요.')).toBe(1)
    expect(hangulShare('ab 한글')).toBe(0.5)
    expect(hangulShare('123')).toBe(0)
  })
})
