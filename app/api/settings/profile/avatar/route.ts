import { NextResponse } from 'next/server'
import { requireAuthenticatedUser } from '@/lib/assistant/security'

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireAuthenticatedUser()

    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'Aucun fichier fourni.' }, { status: 400 })
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: 'Format non supporté. Utilisez JPEG, PNG, WebP ou GIF.' }, { status: 400 })
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024
    if (file.size > maxSize) {
      return NextResponse.json({ error: 'Fichier trop volumineux. Maximum 5 Mo.' }, { status: 400 })
    }

    // Delete old avatar if exists
    const { data: profile } = await supabase
      .from('profiles')
      .select('avatar_url')
      .eq('id', user.id)
      .maybeSingle()

    if (profile?.avatar_url) {
      const oldPath = profile.avatar_url.split('/avatars/')[1]
      if (oldPath) {
        await supabase.storage.from('avatars').remove([oldPath])
      }
    }

    // Upload new avatar
    const extension = file.name.split('.').pop() || 'png'
    const safeName = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(safeName, file, { upsert: false })

    if (uploadError) throw uploadError

    const { data: publicUrlData } = supabase.storage.from('avatars').getPublicUrl(safeName)
    const avatarUrl = publicUrlData.publicUrl

    // Update profile
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ avatar_url: avatarUrl, updated_at: new Date().toISOString() })
      .eq('id', user.id)

    if (updateError) throw updateError

    return NextResponse.json({ avatar_url: avatarUrl })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AVATAR_UPLOAD_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE() {
  try {
    const { supabase, user } = await requireAuthenticatedUser()

    const { data: profile } = await supabase
      .from('profiles')
      .select('avatar_url')
      .eq('id', user.id)
      .maybeSingle()

    if (profile?.avatar_url) {
      const oldPath = profile.avatar_url.split('/avatars/')[1]
      if (oldPath) {
        await supabase.storage.from('avatars').remove([oldPath])
      }
    }

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ avatar_url: null, updated_at: new Date().toISOString() })
      .eq('id', user.id)

    if (updateError) throw updateError

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AVATAR_DELETE_FAILED'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
