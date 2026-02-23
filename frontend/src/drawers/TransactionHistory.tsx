import { useState } from 'react'
import { Card } from '../components/ui/Card'
import type { Transaction } from '../types'

interface Props { transactions: Transaction[] }

export function TransactionHistory({ transactions }: Props) {
  const [expanded, setExpanded] = useState(false)
  if (transactions.length === 0) return null

  const shown = expanded ? transactions : transactions.slice(0, 5)
  const cols = transactions.length > 0 ? Object.keys(transactions[0]).slice(0, 6) : []

  return (
    <Card>
      <div className="text-xs font-semibold tracking-tight mb-2.5">
        Transaction History <span className="text-text-tertiary font-normal">({transactions.length})</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {cols.map(c => (
                <th key={c} className="text-left px-2 py-1.5 text-[10px] text-text-tertiary border-b border-border uppercase tracking-tight font-semibold">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((tx, i) => (
              <tr key={i} className="border-b border-border/10">
                {cols.map(c => (
                  <td key={c} className="px-2 py-1.5 text-[10px] tracking-tight truncate max-w-[120px]">{String(tx[c] ?? '-')}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {transactions.length > 5 && (
        <button onClick={() => setExpanded(!expanded)} className="text-[10px] text-accent hover:underline mt-2">
          {expanded ? 'Show less' : `Show all ${transactions.length}`}
        </button>
      )}
    </Card>
  )
}
