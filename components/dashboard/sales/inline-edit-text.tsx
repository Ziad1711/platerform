'use client'

import { useState, useRef, useEffect } from 'react'

interface InlineEditTextProps {
  value: string
  onSave: (value: string) => void
  placeholder?: string
  className?: string
  inputClassName?: string
  type?: string
}

export default function InlineEditText({
  value,
  onSave,
  placeholder = '',
  className = '',
  inputClassName = '',
  type = 'text',
}: InlineEditTextProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const handleSave = () => {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed !== value) {
      onSave(trimmed)
    }
  }

  const handleCancel = () => {
    setEditing(false)
    setDraft(value)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type={type}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleSave}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSave()
          if (e.key === 'Escape') handleCancel()
        }}
        placeholder={placeholder}
        className={`w-full border border-primary rounded px-2 py-1 bg-background text-foreground text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary ${inputClassName}`}
      />
    )
  }

  return (
    <div
      onDoubleClick={() => {
        setDraft(value)
        setEditing(true)
      }}
      className={`cursor-pointer hover:bg-secondary/50 rounded px-1 -mx-1 ${className}`}
      title="Double-clic pour modifier"
    >
      {value || <span className="text-muted-foreground italic">{placeholder || '—'}</span>}
    </div>
  )
}
