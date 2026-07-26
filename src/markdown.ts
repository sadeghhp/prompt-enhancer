import DOMPurify from 'dompurify'
import { marked } from 'marked'

marked.setOptions({ gfm: true, breaks: true })

/**
 * Render prompt text to sanitized HTML for the preview pane. Prompts come
 * from users and LLM responses, so the output is always run through
 * DOMPurify before being bound with x-html.
 */
export function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { async: false }))
}
