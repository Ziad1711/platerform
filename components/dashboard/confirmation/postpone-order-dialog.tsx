'use client'

import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

type PostponeOrderDialogProps = {
  open: boolean
  customerName: string | null
  requireDatetime: boolean
  busy: boolean
  onClose: () => void
  onSubmit: (callbackAtIso: string, note: string) => void
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function toDateValue(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function toTimeValue(date: Date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function addMinutes(minutes: number) {
  return new Date(Date.now() + minutes * 60 * 1000)
}

function buildQuickOptions() {
  const afternoon = new Date()
  afternoon.setHours(16, 0, 0, 0)

  const tomorrowMorning = new Date()
  tomorrowMorning.setDate(tomorrowMorning.getDate() + 1)
  tomorrowMorning.setHours(10, 0, 0, 0)

  return [
    { label: 'Dans 30 minutes', date: addMinutes(30) },
    { label: 'Dans 1 heure', date: addMinutes(60) },
    { label: 'Cet après-midi', date: afternoon },
    { label: 'Demain 10:00', date: tomorrowMorning },
  ]
}

export default function PostponeOrderDialog({
  open,
  customerName,
  requireDatetime,
  busy,
  onClose,
  onSubmit,
}: PostponeOrderDialogProps) {
  const [dateValue, setDateValue] = useState('')
  const [timeValue, setTimeValue] = useState('')
  const [note, setNote] = useState('')
  const [localError, setLocalError] = useState('')

  useEffect(() => {
    if (!open) return
    const defaultDate = addMinutes(60)
    setDateValue(toDateValue(defaultDate))
    setTimeValue(toTimeValue(defaultDate))
    setNote('')
    setLocalError('')
  }, [open])

  const handleQuickOption = (date: Date) => {
    setDateValue(toDateValue(date))
    setTimeValue(toTimeValue(date))
    setLocalError('')
  }

  const handleSubmit = () => {
    if (requireDatetime && (!dateValue || !timeValue)) {
      setLocalError('La date et l’heure du rappel sont obligatoires.')
      return
    }

    if (!dateValue || !timeValue) {
      setLocalError('La date et l’heure du rappel sont obligatoires.')
      return
    }

    const target = new Date(`${dateValue}T${timeValue}:00`)
    if (Number.isNaN(target.getTime())) {
      setLocalError('Date ou heure invalide.')
      return
    }

    if (target.getTime() <= Date.now()) {
      setLocalError('La date du rappel doit être dans le futur.')
      return
    }

    onSubmit(target.toISOString(), note.trim())
  }

  return (
    <Dialog open={open} onOpenChange={(value) => (value ? undefined : onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reporter le rappel</DialogTitle>
          <DialogDescription>
            {customerName ? `Client : ${customerName}. ` : ''}
            La commande reviendra automatiquement dans la file « À rappeler ».
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {buildQuickOptions().map((option) => (
              <button
                key={option.label}
                type="button"
                onClick={() => handleQuickOption(option.date)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-secondary"
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm text-foreground space-y-1">
              <span>Date du rappel *</span>
              <input
                type="date"
                value={dateValue}
                onChange={(event) => setDateValue(event.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm text-foreground space-y-1">
              <span>Heure du rappel *</span>
              <input
                type="time"
                value={timeValue}
                onChange={(event) => setTimeValue(event.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </label>
          </div>

          <label className="text-sm text-foreground space-y-1 block">
            <span>Note (facultatif)</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              placeholder="Ex. le client demande un rappel après 18h"
            />
          </label>

          {localError ? <div className="text-sm text-rose-600">{localError}</div> : null}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Fermer
          </Button>
          <Button onClick={handleSubmit} disabled={busy}>
            {busy ? 'Enregistrement...' : 'Programmer le rappel'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
