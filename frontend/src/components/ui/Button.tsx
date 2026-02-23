import type { ReactNode, ButtonHTMLAttributes } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'success' | 'warning' | 'danger' | 'outline' | 'ghost'
  size?: 'sm' | 'md'
  children: ReactNode
}

const variants: Record<string, string> = {
  primary: 'bg-gradient-to-br from-[#5523B2] to-[#7C57CC] text-white shadow-[0_2px_12px_rgba(85,35,178,0.25)]',
  success: 'bg-tier-low text-white',
  warning: 'bg-tier-high text-white',
  danger: 'bg-tier-critical text-white',
  outline: 'bg-transparent border border-border text-text-secondary hover:border-accent hover:text-accent',
  ghost: 'bg-transparent text-text-secondary hover:text-text-primary hover:bg-surface-2',
}

export function Button({ variant = 'primary', size = 'md', children, className = '', disabled, ...props }: ButtonProps) {
  const sizeClass = size === 'sm' ? 'px-3 py-[5px] text-xs' : 'px-4 py-2 text-sm'
  return (
    <button
      className={`rounded-[10px] font-semibold tracking-tight transition-all hover:brightness-[0.92] hover:-translate-y-px active:translate-y-0 disabled:opacity-50 disabled:pointer-events-none ${sizeClass} ${variants[variant]} ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  )
}
