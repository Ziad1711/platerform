-- ============================================================
-- Finance — conserver l'historique financier : les paiements
-- ne doivent pas être supprimés en cascade quand on supprime
-- un agent ou un fournisseur.
-- ============================================================

alter table public.confirmation_agent_payments
  drop constraint if exists confirmation_agent_payments_agent_id_fkey;
alter table public.confirmation_agent_payments
  add constraint confirmation_agent_payments_agent_id_fkey
  foreign key (agent_id) references public.confirmation_agents(id) on delete restrict;

alter table public.supplier_purchases
  drop constraint if exists supplier_purchases_supplier_id_fkey;
alter table public.supplier_purchases
  add constraint supplier_purchases_supplier_id_fkey
  foreign key (supplier_id) references public.suppliers(id) on delete restrict;

alter table public.supplier_payments
  drop constraint if exists supplier_payments_supplier_id_fkey;
alter table public.supplier_payments
  add constraint supplier_payments_supplier_id_fkey
  foreign key (supplier_id) references public.suppliers(id) on delete restrict;
