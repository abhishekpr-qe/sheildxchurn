import type { ReactNode } from 'react'

interface Column<T> {
  key: string
  label: string
  render?: (row: T) => ReactNode
  align?: 'left' | 'right' | 'center'
}

interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  onRowClick?: (row: T) => void
  emptyMessage?: string
}

const ALIGN: Record<string, string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
}

function renderCell<T>(col: Column<T>, row: T): ReactNode {
  try {
    if (col.render) return col.render(row)
    const val = (row as Record<string, unknown>)[col.key]
    if (val == null) return '-'
    if (typeof val === 'object') return JSON.stringify(val)
    return String(val)
  } catch {
    return '-'
  }
}

export function DataTable<T>({ columns, data, onRowClick, emptyMessage = 'No data' }: DataTableProps<T>) {
  if (!Array.isArray(data) || data.length === 0) {
    return <div className="text-center py-10 text-text-tertiary text-sm">{emptyMessage}</div>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {columns.map(col => (
              <th
                key={col.key}
                className={`${ALIGN[col.align || 'left']} px-3.5 py-2.5 text-[10px] text-text-tertiary border-b border-border uppercase tracking-tight font-semibold`}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr
              key={i}
              onClick={() => onRowClick?.(row)}
              className={`border-b border-border/10 hover:bg-surface-2/50 transition-colors ${onRowClick ? 'cursor-pointer' : ''}`}
            >
              {columns.map(col => (
                <td key={col.key} className={`px-3.5 py-2.5 text-xs tracking-tight ${ALIGN[col.align || 'left']}`}>
                  {renderCell(col, row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
