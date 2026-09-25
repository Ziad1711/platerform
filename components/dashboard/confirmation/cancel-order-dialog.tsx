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
import { CANCELLATION_REASON_OPTIONS } from '@/lib/confirmation/constants'

type CancelOrderDialogProps = {
  open: boolean
  customerName: string | null
  requireReason: boolean
  busy: boolean
  onClose: () => void
  onSubmit: (reasonCode: string, note: string) => void
}

export default function CancelOrderDialog({
  open,
  customerName,
  requireReason,
  busy,
  onClose,
  onSubmit,
}: CancelOrderDialogProps) {
  const [reasonCode, setReasonCode] = useState('')
  const [note, setNote] = useState('')
  const [localError, setLocalError] = useState('')

  useEffect(() => {
    if (!open) return
    setReasonCode('')
    setNote('')
    setLocalError('')
  }, [open])

  const isOtherReason = reasonCode === 'other'

  const handleSubmit = () => {
    if (requireReason && !reasonCode) {
      setLocalError('Le motif d’annulation est obligatoire.')
      return
    }

    if (isOtherReason && !note.trim()) {
      setLocalError('Précisez le motif dans la note.')
      return
    }

    onSubmit(reasonCode || 'other', note.trim())
  }

  return (
    <Dialog open={open} onOpenChange={(value) => (value ? undefined : onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Annuler la commande</DialogTitle>
          <DialogDescription>
            {customerName ? `Client : ${customerName}. ` : ''}
            La commande quittera la file de confirmation et sera marquée comme annulée.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <label className="text-sm text-foreground space-y-1 block">
            <span>Motif d’annulation {requireReason ? '*' : ''}</span>
            <select
              value={reasonCode}
              onChange={(event) => {
                setReasonCode(event.target.value)
                setLocalError('')
              }}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="">— Choisir un motif —</option>
              {CANCELLATION_REASON_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm text-foreground space-y-1 block">
            <span>Note {isOtherReason ? '*' : '(facultatif)'}</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              placeholder="Précision utile pour l’équipe"
            />
          </label>

          {localError ? <div className="text-sm text-rose-600">{localError}</div> : null}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Fermer
          </Button>
          <Button variant="destructive" onClick={handleSubmit} disabled={busy}>
            {busy ? 'Annulation...' : 'Confirmer l’annulation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
