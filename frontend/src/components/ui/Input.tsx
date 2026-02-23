import type { InputHTMLAttributes } from 'react'

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full px-3 py-2 rounded-[10px] border border-border bg-white text-text-primary text-xs tracking-tight outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent/20 placeholder:text-text-tertiary ${className}`}
      {...props}
    />
  )
}
