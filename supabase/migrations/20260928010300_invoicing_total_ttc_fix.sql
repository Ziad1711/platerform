
-- ---------- RPC : émettre une facture depuis une commande ----------
-- Correctif : le total TTC doit valoir `HT + TVA`. L'ancienne formule
-- `net + port` omettait la TVA lorsque les prix unitaires sont saisis hors taxe
-- (`prices_include_vat = false`). Avec des prix TTC le résultat est inchangé,
-- car `HT + TVA = net + port` ligne par ligne.
create or replace function public.rpc_issue_invoice(
  p_store_id uuid,
  p_order_id uuid,
  p_buyer jsonb default '{}'::jsonb,
  p_lines jsonb default null,
  p_options jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
  v_settings public.store_invoice_settings%rowtype;
  v_existing public.invoices%rowtype;
  v_currency text;
  v_rate numeric := 0;
  v_include boolean := true;
  v_delivery_taxable boolean := false;
  v_issue_date date;
  v_year integer;
  v_seq integer;
  v_number text;
  v_prefix text;
  v_invoice_id uuid;
  v_lines jsonb := '[]'::jsonb;
  v_priced jsonb := '[]'::jsonb;
  v_gross_total numeric := 0;
  v_discount_total numeric := 0;
  v_net_total numeric := 0;
  v_shipping numeric := 0;
  v_ht numeric := 0;
  v_vat numeric := 0;
  v_ship_ht numeric := 0;
  v_ship_vat numeric := 0;
  v_total_ttc numeric := 0;
  v_cum_gross numeric := 0;
  v_cum_net numeric := 0;
  v_target numeric := 0;
  v_src record;
  v_line record;
  v_gross numeric := 0;
  v_net numeric := 0;
  v_discount numeric := 0;
  v_line_ht numeric := 0;
  v_line_vat numeric := 0;
  v_desc text;
  v_no integer := 0;
  v_provided jsonb;
  v_db_lines integer := 0;
  v_notes text;
begin
  if v_actor is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if p_store_id is null or p_order_id is null then
    raise exception 'MISSING_INVOICE_TARGET';
  end if;

  if not public.can_issue_store_invoices(p_store_id) then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_order
    from public.orders
   where id = p_order_id and store_id = p_store_id
   for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if v_order.status in ('cancelled', 'confirmation_rejected') then
    raise exception 'ORDER_NOT_INVOICEABLE';
  end if;

  -- Idempotence : double clic ou rejeu réseau -> on renvoie la facture déjà émise.
  select * into v_existing
    from public.invoices
   where store_id = p_store_id and order_id = p_order_id;

  if found then
    return jsonb_build_object(
      'duplicate', true,
      'invoiceId', v_existing.id,
      'invoiceNumber', v_existing.invoice_number,
      'status', v_existing.status,
      'totalTtc', v_existing.total_ttc,
      'currency', v_existing.currency
    );
  end if;

  select * into v_settings
    from public.store_invoice_settings
   where store_id = p_store_id;

  if not found then
    raise exception 'INVOICE_SETTINGS_MISSING';
  end if;

  if coalesce(btrim(v_settings.legal_name), '') = '' then
    raise exception 'INVOICE_SETTINGS_INCOMPLETE';
  end if;

  select upper(coalesce(nullif(btrim(s.currency), ''), 'MAD')) into v_currency
    from public.stores s
   where s.id = p_store_id;

  v_currency := coalesce(v_currency, 'MAD');
  v_rate := case when v_settings.vat_regime = 'assujetti' then coalesce(v_settings.vat_rate, 0) else 0 end;
  v_include := coalesce(v_settings.prices_include_vat, true);
  v_delivery_taxable := coalesce(v_settings.delivery_taxable, false);
  v_prefix := upper(btrim(coalesce(nullif(v_settings.invoice_prefix, ''), 'FAC')));
  v_notes := nullif(btrim(coalesce(p_options->>'notes', '')), '');

  begin
    v_issue_date := coalesce(nullif(btrim(p_options->>'issueDate'), '')::date, current_date);
  exception
    when others then
      raise exception 'INVALID_ISSUE_DATE';
  end;

  v_year := extract(year from v_issue_date)::integer;

  -- ---------- Construction des lignes depuis la commande ----------
  select count(*) into v_db_lines
    from public.order_items oi
   where oi.order_id = p_order_id
     and oi.store_id = p_store_id
     and oi.quantity > 0;

  if v_db_lines = 0 then
    raise exception 'ORDER_HAS_NO_ITEMS';
  end if;

  if p_lines is not null and jsonb_typeof(p_lines) = 'array' then
    if jsonb_array_length(p_lines) <> v_db_lines then
      raise exception 'INVOICE_LINE_MISMATCH';
    end if;
  end if;

  for v_src in
    select
      oi.id,
      oi.product_id,
      oi.quantity,
      oi.unit_selling_price,
      coalesce(nullif(btrim(oi.product_name_override), ''), p.name, 'Article') as label,
      pv.name as variant_name
    from public.order_items oi
    left join public.products p on p.id = oi.product_id
    left join public.product_variants pv on pv.id = oi.product_variant_id
    where oi.order_id = p_order_id
      and oi.store_id = p_store_id
      and oi.quantity > 0
    order by oi.updated_at, oi.id
  loop
    v_desc := v_src.label;
    if v_src.variant_name is not null and btrim(v_src.variant_name) <> '' then
      v_desc := v_desc || ' - ' || btrim(v_src.variant_name);
    end if;

    v_provided := null;
    if p_lines is not null and jsonb_typeof(p_lines) = 'array' then
      select elem
        into v_provided
        from jsonb_array_elements(p_lines) as elem
       where (elem->>'orderItemId') = v_src.id::text
       limit 1;
    end if;

    if v_provided is not null then
      if nullif(btrim(v_provided->>'description'), '') is not null then
        v_desc := left(btrim(v_provided->>'description'), 200);
      end if;

      if nullif(btrim(v_provided->>'quantity'), '') is not null
         and (v_provided->>'quantity')::numeric <> v_src.quantity then
        raise exception 'INVOICE_LINE_MISMATCH';
      end if;

      if nullif(btrim(v_provided->>'unitPrice'), '') is not null
         and (v_provided->>'unitPrice')::numeric <> v_src.unit_selling_price then
        raise exception 'INVOICE_LINE_MISMATCH';
      end if;
    end if;

    v_no := v_no + 1;
    v_gross := round(v_src.quantity * v_src.unit_selling_price, 2);
    v_gross_total := v_gross_total + v_gross;

    v_lines := v_lines || jsonb_build_object(
      'orderItemId', v_src.id::text,
      'productId', v_src.product_id::text,
      'lineNo', v_no,
      'description', v_desc,
      'quantity', v_src.quantity,
      'unitPrice', v_src.unit_selling_price,
      'gross', v_gross
    );
  end loop;

  -- ---------- Remise répartie au prorata, sans dérive d'arrondi ----------
  v_gross_total := round(v_gross_total, 2);
  v_discount_total := round(least(greatest(coalesce(v_order.discount_amount, 0), 0), v_gross_total), 2);
  v_net_total := round(v_gross_total - v_discount_total, 2);
  v_shipping := round(greatest(coalesce(v_order.delivery_charge_to_customer, 0), 0), 2);

  for v_line in
    select value as item from jsonb_array_elements(v_lines)
  loop
    v_gross := (v_line.item->>'gross')::numeric;
    v_cum_gross := v_cum_gross + v_gross;

    if v_gross_total > 0 then
      v_target := round(v_net_total * v_cum_gross / v_gross_total, 2);
    else
      v_target := 0;
    end if;

    v_net := round(v_target - v_cum_net, 2);
    v_cum_net := v_target;
    v_discount := round(v_gross - v_net, 2);

    if v_include then
      v_line_ht := round(v_net / (1 + v_rate / 100), 2);
      v_line_vat := round(v_net - v_line_ht, 2);
    else
      v_line_ht := v_net;
      v_line_vat := round(v_net * v_rate / 100, 2);
    end if;

    v_ht := v_ht + v_line_ht;
    v_vat := v_vat + v_line_vat;

    v_priced := v_priced || v_line.item || jsonb_build_object(
      'discount', v_discount,
      'net', v_net,
      'ht', v_line_ht,
      'vat', v_line_vat
    );
  end loop;

  if v_delivery_taxable and v_shipping > 0 and v_rate > 0 then
    if v_include then
      v_ship_ht := round(v_shipping / (1 + v_rate / 100), 2);
      v_ship_vat := round(v_shipping - v_ship_ht, 2);
    else
      v_ship_ht := v_shipping;
      v_ship_vat := round(v_shipping * v_rate / 100, 2);
    end if;
  else
    v_ship_ht := v_shipping;
    v_ship_vat := 0;
  end if;

  v_ht := round(v_ht + v_ship_ht, 2);
  v_vat := round(v_vat + v_ship_vat, 2);
  v_total_ttc := round(v_ht + v_vat, 2);

  -- ---------- Numérotation : verrou de ligne, aucune réutilisation ----------
  insert into public.invoice_counters (store_id, period_year, last_number)
  values (p_store_id, v_year, 1)
  on conflict (store_id, period_year)
  do update set last_number = public.invoice_counters.last_number + 1
  returning last_number into v_seq;

  v_number := v_prefix || '-' || v_year::text || '-' || lpad(v_seq::text, 6, '0');

  -- ---------- Facture + lignes dans la même transaction ----------
  insert into public.invoices (
    store_id, order_id, order_reference, invoice_number, invoice_year, sequence_number,
    status, issue_date, currency, template_version,
    seller, buyer, payment, order_snapshot,
    vat_regime, vat_rate, prices_include_vat, delivery_taxable,
    items_ttc, discount_ttc, shipping_ttc, total_ht, total_vat, total_ttc,
    order_total_snapshot, notes, issued_by
  ) values (
    p_store_id, p_order_id, left(p_order_id::text, 8), v_number, v_year, v_seq,
    'issued', v_issue_date, v_currency, 1,
    jsonb_build_object(
      'legalName', v_settings.legal_name,
      'legalForm', v_settings.legal_form,
      'activity', v_settings.activity,
      'address', v_settings.address,
      'city', v_settings.city,
      'phone', v_settings.phone,
      'email', v_settings.email,
      'website', v_settings.website,
      'ice', v_settings.ice,
      'if', v_settings.if_number,
      'rc', v_settings.rc_number,
      'tp', v_settings.tp_number,
      'bankName', v_settings.bank_name,
      'bankRib', v_settings.bank_rib,
      'paymentTerms', v_settings.payment_terms,
      'legalMentions', v_settings.legal_mentions,
      'logoUrl', (select s.logo_url from public.stores s where s.id = p_store_id)
    ),
    jsonb_build_object(
      'name', coalesce(nullif(btrim(p_buyer->>'name'), ''), v_order.customer_name),
      'ice', nullif(btrim(p_buyer->>'ice'), ''),
      'phone', coalesce(nullif(btrim(p_buyer->>'phone'), ''), v_order.phone),
      'address', coalesce(nullif(btrim(p_buyer->>'address'), ''), v_order.address),
      'city', coalesce(nullif(btrim(p_buyer->>'city'), ''), v_order.city)
    ),
    jsonb_build_object(
      'method', nullif(btrim(p_options->>'paymentMethod'), ''),
      'reference', nullif(btrim(p_options->>'paymentReference'), '')
    ),
    jsonb_build_object(
      'status', v_order.status,
      'orderDate', v_order.order_date,
      'subtotalAmount', v_order.subtotal_amount,
      'totalSellingPrice', v_order.total_selling_price,
      'deliveryChargeToCustomer', v_order.delivery_charge_to_customer,
      'discountAmount', v_order.discount_amount,
      'discountType', v_order.discount_type,
      'trackingNumber', v_order.tracking_number
    ),
    v_settings.vat_regime, v_rate, v_include, v_delivery_taxable,
    v_gross_total, v_discount_total, v_shipping, v_ht, v_vat, v_total_ttc,
    v_order.total_selling_price, v_notes, v_actor
  )
  returning id into v_invoice_id;

  insert into public.invoice_items (
    invoice_id, store_id, order_item_id, product_id, line_no, description,
    quantity, unit_price, line_gross_ttc, line_discount_ttc, line_net_ttc,
    line_ht, line_vat, vat_rate
  )
  select
    v_invoice_id,
    p_store_id,
    nullif(elem->>'orderItemId', '')::uuid,
    nullif(elem->>'productId', '')::uuid,
    (elem->>'lineNo')::integer,
    elem->>'description',
    (elem->>'quantity')::numeric,
    (elem->>'unitPrice')::numeric,
    (elem->>'gross')::numeric,
    (elem->>'discount')::numeric,
    (elem->>'net')::numeric,
    (elem->>'ht')::numeric,
    (elem->>'vat')::numeric,
    v_rate
  from jsonb_array_elements(v_priced) as elem;

  return jsonb_build_object(
    'duplicate', false,
    'invoiceId', v_invoice_id,
    'invoiceNumber', v_number,
    'invoiceYear', v_year,
    'sequenceNumber', v_seq,
    'status', 'issued',
    'issueDate', v_issue_date,
    'currency', v_currency,
    'itemsTtc', v_gross_total,
    'discountTtc', v_discount_total,
    'shippingTtc', v_shipping,
    'totalHt', v_ht,
    'totalVat', v_vat,
    'totalTtc', v_total_ttc,
    'orderTotalSnapshot', v_order.total_selling_price,
    'totalMismatch', (
      v_order.total_selling_price is not null
      and abs(v_total_ttc - v_order.total_selling_price) > 0.01
    )
  );
end;
$$;

comment on function public.rpc_issue_invoice(uuid, uuid, jsonb, jsonb, jsonb) is
  'Émet la facture d''une commande : calcule remise/TVA depuis les lignes réelles, attribue le numéro et enregistre la facture dans une seule transaction. Idempotent par commande.';
