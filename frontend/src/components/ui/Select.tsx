import type { SelectHTMLAttributes } from 'react'

export function Select({ className = '', children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`px-3 py-2 rounded-[10px] border border-border bg-white text-text-primary text-xs tracking-tight outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent/20 ${className}`}
      {...props}
    >
      {children}
    </select>
  )
}
