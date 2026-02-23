import { useState } from 'react'

interface InfoBubbleProps {
  text: string
  detail?: string
}

export function InfoBubble({ text, detail }: InfoBubbleProps) {
  const [show, setShow] = useState(false)

  return (
    <span
      className="relative inline-flex items-center justify-center w-4 h-4 rounded-full border border-border-hover bg-surface-2 text-text-tertiary text-[8px] font-semibold cursor-pointer ml-1.5 align-middle hover:border-accent hover:text-accent hover:bg-accent/10 transition-all"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      i
      {show && (
        <div className="absolute bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2 bg-surface-2 border border-border rounded-[10px] px-4 py-3 text-xs font-normal text-text-primary leading-[1.4] w-[280px] z-[300] shadow-[0_12px_32px_rgba(30,10,78,0.12)] pointer-events-none">
          <div>{text}</div>
          {detail && <div className="text-accent text-[10px] mt-1 italic">{detail}</div>}
        </div>
      )}
    </span>
  )
}
