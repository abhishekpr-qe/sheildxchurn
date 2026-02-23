interface EmptyStateProps {
  message?: string
}

export function EmptyState({ message = 'No data available' }: EmptyStateProps) {
  return (
    <div className="text-center py-16 text-text-tertiary">
      <div className="text-3xl mb-2 opacity-30">--</div>
      <p className="text-sm">{message}</p>
    </div>
  )
}
