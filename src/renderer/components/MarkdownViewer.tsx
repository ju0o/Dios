import { marked } from 'marked'

interface MarkdownViewerProps {
  content: string
  className?: string
}

export function sanitizeHtml(html: string): string {
  const template = document.createElement('template')
  template.innerHTML = html
  template.content.querySelectorAll('script, iframe, object, embed, form, style').forEach((node) => node.remove())
  template.content.querySelectorAll('*').forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase()
      const value = attribute.value.trim().toLowerCase()
      if (name.startsWith('on') || ((name === 'href' || name === 'src') && (value.startsWith('javascript:') || value.startsWith('data:')))) {
        element.removeAttribute(attribute.name)
      }
    })
  })
  return template.innerHTML
}

export function MarkdownViewer({ content, className = '' }: MarkdownViewerProps) {
  const html = sanitizeHtml(marked.parse(content, { async: false }) as string)

  return (
    <div
      className={`prose prose-invert max-w-none ${className}`}
      style={{
        lineHeight: 1.7,
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
