alter table public.orders
  add column if not exists delivery_status_source text null,
  add column if not exists delivery_company_status_raw text null,
  add column if not exists dl_no_answer_at timestamptz null,
  add column if not exists dl_unreachable_at timestamptz null,
  add column if not exists dl_out_of_zone_at timestamptz null,
  add column if not exists dl_client_interested_at timestamptz null,
  add column if not exists dl_postponed_at timestamptz null,
  add column if not exists dl_address_change_at timestamptz null,
  add column if not exists dl_pickup_pending_at timestamptz null,
  add column if not exists dl_refund_at timestamptz null,
  add column if not exists dl_follow_up_request_at timestamptz null,
  add column if not exists dl_billing_error_at timestamptz null,
  add column if not exists dl_out_for_delivery_at timestamptz null;

alter table public.orders drop constraint if exists orders_status_check;

alter table public.orders
  add constraint orders_status_check
  check (
    status = any (
      array[
        'new'::text,
        'confirmation_rejected'::text,
        'follow_up_1'::text,
        'follow_up_2'::text,
        'follow_up_3'::text,
        'follow_up_4'::text,
        'follow_up_5'::text,
        'no_answer'::text,
        'wrong_number'::text,
        'voicemail'::text,
        'confirmed'::text,
        'picked_up'::text,
        'sent'::text,
        'delivered'::text,
        'cancelled'::text,
        'refused'::text,
        'returned_not_stocked'::text,
        'returned_stocked'::text,
        'dl_no_answer'::text,
        'dl_unreachable'::text,
        'dl_out_of_zone'::text,
        'dl_client_interested'::text,
        'dl_postponed'::text,
        'dl_address_change'::text,
        'dl_pickup_pending'::text,
        'dl_refund'::text,
        'dl_follow_up_request'::text,
        'dl_billing_error'::text,
        'dl_out_for_delivery'::text
      ]
    )
  );

alter table public.orders drop constraint if exists orders_delivery_status_source_check;

alter table public.orders
  add constraint orders_delivery_status_source_check
  check (
    delivery_status_source is null
    or delivery_status_source = any (array['manual'::text, 'delivery_company'::text])
  );