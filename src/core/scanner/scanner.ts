import fg from 'fast-glob'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import matter from 'gray-matter'

export interface ScannedDocument {
  path: string
  relPath: string
  content: string
  frontmatter: any
  hash: string
  wordCount: number
  createdAt: number
  updatedAt: number
}

export async function scanRoots(roots: string[]): Promise<ScannedDocument[]> {
  const documents: ScannedDocument[] = []

  for (const root of roots) {
    if (!fs.existsSync(root)) {
      console.warn(`Root not found: ${root}`)
      continue
    }

    const files = await fg(['**/*.md', '**/*.html', '**/*.json', '**/*.yaml', '**/*.yml'], {
      cwd: root,
      absolute: true,
      ignore: ['**/node_modules/**', '**/dist/**', '**/release/**', '**/.git/**', '**/Cache/**', '**/Code Cache/**']
    })

    for (const filePath of files) {
      try {
        const stat = fs.statSync(filePath)
        const content = fs.readFileSync(filePath, 'utf-8')
        const hash = crypto.createHash('sha256').update(content).digest('hex')
        // Renderer components use POSIX-style paths consistently, including on Windows.
        const relPath = path.relative(root, filePath).split(path.sep).join('/')

        let frontmatter = {}
        let body = content
        if (filePath.endsWith('.md')) {
          const parsed = matter(content)
          frontmatter = parsed.data
          body = parsed.content
        }

        const wordCount = body.split(/\s+/).filter(Boolean).length

        documents.push({
          path: filePath,
          relPath,
          content: body,
          frontmatter,
          hash,
          wordCount,
          createdAt: stat.birthtimeMs,
          updatedAt: stat.mtimeMs
        })
      } catch (err) {
        console.error(`Failed to scan ${filePath}:`, err)
      }
    }
  }

  return documents
}
