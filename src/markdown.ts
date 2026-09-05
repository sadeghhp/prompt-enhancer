import DOMPurify from 'dompurify'
import { marked } from 'marked'

marked.setOptions({ gfm: true, breaks: true })

/**
 * Links inside a previewed prompt open in a new tab: following one in place
 * would abandon the session the user is working on. `noopener noreferrer`
 * keeps the opened page from reaching back into this one.
 */
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node instanceof HTMLElement && node.tagName === 'A' && node.hasAttribute('href')) {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

/**
 * Render prompt text to sanitized HTML for the preview pane. Prompts come
 * from users and LLM responses, so the output is always run through
 * DOMPurify before being bound with x-html.
 */
export function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { async: false }))
}
