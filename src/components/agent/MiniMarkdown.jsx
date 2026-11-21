// Small, safe markdown renderer for agent replies: paragraphs, **bold**, *italic*, `code`,
// bullet / numbered lists, headings and links. No raw HTML is ever injected.
import { Fragment } from 'react'

function inline(text, keyBase) {
  const out = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)|\*[^*\s][^*]*\*)/g
  let last = 0
  let m
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    const k = `${keyBase}-${i++}`
    if (tok.startsWith('**')) out.push(<strong key={k} className="font-semibold">{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith('`')) out.push(<code key={k} className="px-1 py-0.5 rounded bg-slate-900/5 text-[0.85em]">{tok.slice(1, -1)}</code>)
    else if (tok.startsWith('[')) {
      const label = tok.slice(1, tok.indexOf(']'))
      const href = m[2]
      const external = /^https?:/.test(href)
      out.push(<a key={k} href={href} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined} className="text-blue-700 underline underline-offset-2">{label}</a>)
    } else out.push(<em key={k}>{tok.slice(1, -1)}</em>)
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export default function MiniMarkdown({ text }) {
  const lines = String(text || '').replace(/\r/g, '').split('\n')
  const blocks = []
  let list = null
  const flush = () => {
    if (list) blocks.push(list)
    list = null
  }
  lines.forEach((raw, idx) => {
    const line = raw.trimEnd()
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/)
    const numbered = line.match(/^\s*(\d+)[.)]\s+(.*)$/)
    const heading = line.match(/^#{1,4}\s+(.*)$/)
    if (bullet || numbered) {
      const type = bullet ? 'ul' : 'ol'
      if (!list || list.type !== type) { flush(); list = { type, items: [] } }
      list.items.push(bullet ? bullet[1] : numbered[2])
      return
    }
    flush()
    if (!line.trim()) { blocks.push({ type: 'gap', key: idx }); return }
    if (heading) { blocks.push({ type: 'h', text: heading[1], key: idx }); return }
    blocks.push({ type: 'p', text: line, key: idx })
  })
  flush()

  return (
    <div className="space-y-1.5 leading-relaxed break-words">
      {blocks.map((b, i) => {
        if (b.type === 'gap') return <Fragment key={`g${i}`} />
        if (b.type === 'h') return <p key={i} dir="auto" className="font-semibold">{inline(b.text, `h${i}`)}</p>
        if (b.type === 'p') return <p key={i} dir="auto">{inline(b.text, `p${i}`)}</p>
        const Tag = b.type
        return (
          <Tag key={i} dir="auto" className={`${b.type === 'ul' ? 'list-disc' : 'list-decimal'} ps-5 space-y-0.5`}>
            {b.items.map((it, j) => <li key={j}>{inline(it, `l${i}-${j}`)}</li>)}
          </Tag>
        )
      })}
    </div>
  )
}
