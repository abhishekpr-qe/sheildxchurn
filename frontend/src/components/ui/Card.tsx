import type { ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  className?: string
  glass?: boolean
  hero?: boolean
  onClick?: () => void
}

export function Card({ children, className = '', glass, hero, onClick }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={`rounded-[14px] p-5 transition-colors ${
        glass
          ? 'bg-surface-1/80 backdrop-blur-[12px] border border-border'
          : hero
            ? 'bg-gradient-to-br from-[#5523B208] to-[#7C57CC08] border border-accent/20'
            : 'bg-surface-1 border border-border hover:border-border-hover'
      } ${onClick ? 'cursor-pointer' : ''} ${className}`}
    >
      {children}
    </div>
  )
}
