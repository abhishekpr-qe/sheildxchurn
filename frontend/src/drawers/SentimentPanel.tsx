import { Card } from '../components/ui/Card'
import { sentimentColor } from '../services/formatters'
import type { SentimentData } from '../types'

interface Props { sentiment: SentimentData | null }

export function SentimentPanel({ sentiment }: Props) {
  if (!sentiment) return null

  return (
    <Card>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold tracking-tight">Support Sentiment</span>
        <span className="text-xs font-semibold capitalize" style={{ color: sentimentColor(sentiment.sentiment) }}>
          {sentiment.sentiment}
        </span>
      </div>
      {sentiment.pain_points?.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {sentiment.pain_points.map((p, i) => (
            <span key={i} className="text-[10px] px-2 py-[2px] rounded-md bg-surface-2 border border-border text-text-tertiary">{p}</span>
          ))}
        </div>
      )}
      {sentiment.summary && (
        <p className="text-xs text-text-secondary leading-relaxed tracking-tight">{sentiment.summary}</p>
      )}
      {!sentiment.has_conversations && sentiment.sentiment === 'unknown' && (
        <p className="text-[10px] text-text-tertiary italic">No conversation data available</p>
      )}
    </Card>
  )
}
