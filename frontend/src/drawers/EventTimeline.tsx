import { Card } from '../components/ui/Card'
import { fmtDate } from '../services/formatters'
import type { TimelineEvent } from '../types'

interface Props { timeline: TimelineEvent[] }

export function EventTimeline({ timeline }: Props) {
  if (timeline.length === 0) return null

  return (
    <Card>
      <div className="text-xs font-semibold tracking-tight mb-2.5">Event Timeline</div>
      <div className="space-y-2">
        {timeline.slice(0, 10).map((e, i) => (
          <div key={i} className="flex gap-3 items-start">
            <div className="flex flex-col items-center">
              <div className="w-2 h-2 rounded-full bg-accent mt-1" />
              {i < timeline.length - 1 && <div className="w-px h-6 bg-border" />}
            </div>
            <div>
              <div className="text-xs tracking-tight">{e.event}</div>
              <div className="text-[10px] text-text-tertiary">{fmtDate(e.date)}{e.detail ? ` — ${e.detail}` : ''}</div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}
