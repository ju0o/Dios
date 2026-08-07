import { createContext, useContext, useEffect, useState, ReactNode } from 'react'

export interface ScannedFile {
  path: string
  relPath: string
  content: string
  frontmatter: any
  hash: string
  wordCount: number
  createdAt: number
  updatedAt: number
}

interface ScanContextType {
  files: ScannedFile[]
  setFiles: (files: ScannedFile[]) => void
  roots: string[]
  setRoots: (roots: string[]) => void
}

const ScanContext = createContext<ScanContextType | undefined>(undefined)

export function ScanProvider({ children }: { children: ReactNode }) {
  const [files, setFiles] = useState<ScannedFile[]>([])
  const [roots, setRoots] = useState<string[]>([])

  useEffect(() => {
    try {
      const saved = localStorage.getItem('dios:scanRoots')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed)) setRoots(parsed.filter((root): root is string => typeof root === 'string'))
      }
    } catch {
      localStorage.removeItem('dios:scanRoots')
    }
  }, [])

  useEffect(() => {
    localStorage.setItem('dios:scanRoots', JSON.stringify(roots))
  }, [roots])

  return (
    <ScanContext.Provider value={{ files, setFiles, roots, setRoots }}>
      {children}
    </ScanContext.Provider>
  )
}

export function useScan() {
  const context = useContext(ScanContext)
  if (!context) {
    throw new Error('useScan must be used within ScanProvider')
  }
  return context
}
