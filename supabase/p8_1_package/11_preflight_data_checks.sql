-- ============================================================
-- P8.1 — Contrôles de données (LECTURE SEULE)
-- Projet autorisé : jisra-test / goqedvcdmgtejtyrawsp
-- ------------------------------------------------------------
-- Blocs (6), (7) et (8) extraits tels quels de
-- 10_preflight_capture.sql — aucune requête modifiée.
--
-- Ces trois blocs ne sont pas exploitables via l'API Management
-- read-only : la session supabase_read_only_user est soumise à
-- RLS (pg_read_all_data ne contourne pas les politiques).
-- Les exécuter dans le SQL Editor, qui s'exécute en rôle postgres
-- pour un Owner/Administrator du projet.
--
-- Aucune écriture : uniquement SELECT et agrégats.
-- ============================================================

-- (6) Invariant : chaque boutique a bien une appartenance owner active
--     Le helper de la migration reprend la sémantique de
--     is_store_admin_or_owner (appartenance, pas owner_user_id).
--     Résultat attendu : 0. Tout écart est un NO-GO (risque de refuser
--     une invitation légitime émise par un propriétaire sans ligne).
select count(*) as stores_without_active_owner_membership
from public.stores s
where not exists (
  select 1 from public.store_members sm
  where sm.store_id = s.id
    and sm.user_id = s.owner_user_id
    and sm.status = 'active'
    and sm.role = 'owner'
);

-- (7) Inventaire agrégé des invitations (aucune donnée personnelle) --
select ti.status,
       count(*) as invitations,
       count(*) filter (
         where exists (
           select 1 from public.team_invitation_assignments a
           where a.invitation_id = ti.id
             and not exists (
               select 1 from public.store_members sm
               where sm.store_id = a.store_id
                 and sm.user_id = ti.invited_by
                 and sm.status = 'active'
                 and sm.role in ('owner','admin')
             )
         )
       ) as with_inviter_no_longer_authorized
from public.team_invitations ti
group by ti.status
order by ti.status;

-- (8) Détail par boutique des invitations `pending` dont l'invitant
--     a perdu ses droits : décision métier requise avant application.
select a.store_id,
       count(*) as pending_assignments,
       min(ti.created_at) as oldest_created_at
from public.team_invitation_assignments a
join public.team_invitations ti on ti.id = a.invitation_id
where ti.status = 'pending'
  and not exists (
    select 1 from public.store_members sm
    where sm.store_id = a.store_id
      and sm.user_id = ti.invited_by
      and sm.status = 'active'
      and sm.role in ('owner','admin')
  )
group by a.store_id
order by a.store_id;
