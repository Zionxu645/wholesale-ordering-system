-- ============================================================
-- Eluren V3.1 时区与生产单显示修复
-- 作用：
-- 1. 询价单号、订单号按中国标准时间（Asia/Shanghai）确定日期。
-- 2. 保留现有客户、商品、库存、询价单和订单，不删除任何数据。
-- 3. 可安全重复执行。
-- ============================================================

begin;

create or replace function public.create_inquiry(
  p_user_id uuid,
  p_items jsonb,
  p_shipping_address text default null,
  p_remark text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.users%rowtype;
  v_inquiry public.inquiries%rowtype;
  v_item_count integer;
  v_valid_count integer;
  v_total_quantity integer;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception '选款单为空'; end if;
  select * into v_user from public.users where id = p_user_id;
  if not found then raise exception '用户不存在'; end if;

  select count(*), coalesce(sum(x.quantity), 0)::integer into v_item_count, v_total_quantity
  from jsonb_to_recordset(p_items) as x(sku_id uuid, quantity integer);
  if v_item_count <= 0 or v_item_count > 100 then raise exception '选款单规格数量必须在 1 至 100 之间'; end if;
  if exists (select 1 from jsonb_to_recordset(p_items) as x(sku_id uuid, quantity integer) where x.sku_id is null or x.quantity is null or x.quantity <= 0) then raise exception '选款数量无效'; end if;

  select count(*) into v_valid_count
  from jsonb_to_recordset(p_items) as x(sku_id uuid, quantity integer)
  join public.product_skus s on s.id = x.sku_id
  join public.products p on p.id = s.product_id
  where p.status = 'on_sale';
  if v_valid_count <> v_item_count then raise exception '部分款式不存在或已下架，请刷新选款册后重试'; end if;

  insert into public.inquiries (inquiry_no, user_id, customer_name, customer_phone, customer_company, shipping_address, total_quantity, status, remark)
  values (
    'INQ-' || to_char(timezone('Asia/Shanghai', now()), 'YYYYMMDD') || '-' || lpad(nextval('public.inquiry_no_seq')::text, 6, '0'),
    v_user.id, v_user.name, v_user.phone, v_user.company,
    nullif(btrim(coalesce(p_shipping_address, v_user.address, '')), ''),
    v_total_quantity, 'pending', nullif(btrim(coalesce(p_remark, '')), '')
  ) returning * into v_inquiry;

  insert into public.inquiry_items (inquiry_id, product_id, product_name, style_code, sku_id, sku_code, color, size, quantity)
  select v_inquiry.id, p.id, p.name, p.style_code, s.id, s.sku_code, s.color, s.size, x.quantity
  from jsonb_to_recordset(p_items) as x(sku_id uuid, quantity integer)
  join public.product_skus s on s.id = x.sku_id
  join public.products p on p.id = s.product_id;

  return jsonb_build_object('inquiry', to_jsonb(v_inquiry) || jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(ii) order by ii.created_at) from public.inquiry_items ii where ii.inquiry_id = v_inquiry.id), '[]'::jsonb)
  ));
end;
$$;

create or replace function public.convert_inquiry_to_order(p_inquiry_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inquiry public.inquiries%rowtype;
  v_order public.orders%rowtype;
  v_bad_code text;
  v_bad_stock integer;
  v_bad_quantity integer;
  v_bad_status text;
begin
  select * into v_inquiry from public.inquiries where id = p_inquiry_id for update;
  if not found then raise exception '询价单不存在'; end if;
  if v_inquiry.status = 'converted' then raise exception '该询价单已经转为正式订单'; end if;
  if v_inquiry.status = 'lost' then raise exception '未成交询价单不能转为订单'; end if;
  if not exists (select 1 from public.inquiry_items where inquiry_id = p_inquiry_id) then raise exception '询价单没有商品明细'; end if;

  perform s.id from public.product_skus s join public.inquiry_items ii on ii.sku_id = s.id
  where ii.inquiry_id = p_inquiry_id order by s.id for update;

  select s.sku_code, s.stock, ii.quantity, p.status into v_bad_code, v_bad_stock, v_bad_quantity, v_bad_status
  from public.inquiry_items ii
  join public.product_skus s on s.id = ii.sku_id
  join public.products p on p.id = s.product_id
  where ii.inquiry_id = p_inquiry_id and (p.status <> 'on_sale' or ii.quantity > s.stock)
  limit 1;
  if found then
    if v_bad_status <> 'on_sale' then raise exception '商品已下架：%', v_bad_code; end if;
    raise exception '库存不足：% 当前库存 %，需要 %', v_bad_code, v_bad_stock, v_bad_quantity;
  end if;

  insert into public.orders (order_no, user_id, customer_name, customer_phone, customer_company, shipping_address, total_amount, total_quantity, status, remark, source_inquiry_id)
  values (
    'ORD-' || to_char(timezone('Asia/Shanghai', now()), 'YYYYMMDD') || '-' || lpad(nextval('public.order_no_seq')::text, 6, '0'),
    v_inquiry.user_id, v_inquiry.customer_name, v_inquiry.customer_phone, v_inquiry.customer_company,
    coalesce(v_inquiry.shipping_address, ''), 0, v_inquiry.total_quantity, 'pending', v_inquiry.remark, v_inquiry.id
  ) returning * into v_order;

  insert into public.order_items (order_id, product_id, product_name, sku_id, sku_code, color, size, quantity, unit_price, subtotal)
  select v_order.id, ii.product_id, ii.product_name, ii.sku_id, ii.sku_code, ii.color, ii.size, ii.quantity, 0, 0
  from public.inquiry_items ii where ii.inquiry_id = p_inquiry_id;

  update public.product_skus s set stock = s.stock - ii.quantity
  from public.inquiry_items ii where ii.inquiry_id = p_inquiry_id and ii.sku_id = s.id;

  update public.inquiries set status = 'converted', converted_order_id = v_order.id where id = p_inquiry_id;

  return jsonb_build_object('order', to_jsonb(v_order) || jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(oi) order by oi.created_at) from public.order_items oi where oi.order_id = v_order.id), '[]'::jsonb)
  ));
end;
$$;

create or replace function public.create_order_from_cart(p_user_id uuid, p_shipping_address text, p_remark text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.users%rowtype;
  v_order public.orders%rowtype;
  v_total_quantity integer;
  v_bad_code text;
  v_bad_stock integer;
  v_bad_quantity integer;
  v_bad_status text;
begin
  select * into v_user from public.users where id = p_user_id;
  if not found then raise exception '用户不存在'; end if;
  if not exists (select 1 from public.cart_items where user_id = p_user_id) then raise exception '购物车为空'; end if;
  perform s.id from public.product_skus s join public.cart_items c on c.sku_id = s.id where c.user_id = p_user_id order by s.id for update;
  select s.sku_code, s.stock, c.quantity, p.status into v_bad_code, v_bad_stock, v_bad_quantity, v_bad_status
  from public.cart_items c join public.product_skus s on s.id = c.sku_id join public.products p on p.id = s.product_id
  where c.user_id = p_user_id and (p.status <> 'on_sale' or c.quantity > s.stock or c.quantity <= 0) limit 1;
  if found then
    if v_bad_status <> 'on_sale' then raise exception '商品已下架：%', v_bad_code; end if;
    raise exception '库存不足：% 当前库存 %，需要 %', v_bad_code, v_bad_stock, v_bad_quantity;
  end if;
  select coalesce(sum(quantity), 0)::integer into v_total_quantity from public.cart_items where user_id = p_user_id;
  insert into public.orders (order_no, user_id, customer_name, customer_phone, customer_company, shipping_address, total_amount, total_quantity, status, remark)
  values ('ORD-' || to_char(timezone('Asia/Shanghai', now()), 'YYYYMMDD') || '-' || lpad(nextval('public.order_no_seq')::text, 6, '0'), v_user.id, v_user.name, v_user.phone, v_user.company, coalesce(p_shipping_address, ''), 0, v_total_quantity, 'pending', p_remark)
  returning * into v_order;
  insert into public.order_items (order_id, product_id, product_name, sku_id, sku_code, color, size, quantity, unit_price, subtotal)
  select v_order.id, p.id, p.name, s.id, s.sku_code, s.color, s.size, c.quantity, 0, 0
  from public.cart_items c join public.product_skus s on s.id = c.sku_id join public.products p on p.id = s.product_id where c.user_id = p_user_id;
  update public.product_skus s set stock = s.stock - c.quantity from public.cart_items c where c.user_id = p_user_id and c.sku_id = s.id;
  delete from public.cart_items where user_id = p_user_id;
  return jsonb_build_object('order', to_jsonb(v_order) || jsonb_build_object('items', coalesce((select jsonb_agg(to_jsonb(oi)) from public.order_items oi where oi.order_id = v_order.id), '[]'::jsonb)));
end;
$$;

revoke all on function public.create_inquiry(uuid, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.convert_inquiry_to_order(uuid) from public, anon, authenticated;
revoke all on function public.create_order_from_cart(uuid, text, text) from public, anon, authenticated;

grant execute on function public.create_inquiry(uuid, jsonb, text, text) to service_role;
grant execute on function public.convert_inquiry_to_order(uuid) to service_role;
grant execute on function public.create_order_from_cart(uuid, text, text) to service_role;

commit;
