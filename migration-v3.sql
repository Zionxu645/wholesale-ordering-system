-- ============================================================
-- V3 升级脚本：网上商城 -> 无价格电子选款册 + 询价系统
-- 适用于已经运行过旧版 schema.sql 的 Supabase 项目。
-- 使用方法：在 Supabase SQL Editor 中复制并运行本文件全部内容。
-- 本脚本不会删除旧订单、客户、商品或库存数据。
-- ============================================================

create extension if not exists pgcrypto;

-- 1. 商品款号与图片
alter table public.products add column if not exists style_code text;

-- 旧版演示商品 UUID 的前 8 位相同，不能用前 8 位生成款号。
-- 这里会为“空款号”或“重复款号”分配可读且唯一的 EL-000001 形式款号。
drop index if exists public.uq_products_style_code;

with style_stats as (
  select
    id,
    style_code,
    count(*) over (partition by nullif(btrim(style_code), '')) as duplicate_count
  from public.products
),
max_existing_code as (
  select coalesce(
    max((substring(style_code from '^EL-([0-9]+)$'))::bigint),
    0
  ) as max_number
  from public.products
  where style_code ~ '^EL-[0-9]+$'
),
rows_to_fix as (
  select
    s.id,
    row_number() over (order by p.created_at nulls last, s.id) as row_no
  from style_stats s
  join public.products p on p.id = s.id
  where nullif(btrim(s.style_code), '') is null
     or s.duplicate_count > 1
)
update public.products p
set style_code = 'EL-' || lpad((m.max_number + f.row_no)::text, 6, '0')
from rows_to_fix f
cross join max_existing_code m
where p.id = f.id;

alter table public.products alter column style_code set not null;
create unique index if not exists uq_products_style_code on public.products(style_code);

create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  storage_path text,
  image_url text not null,
  is_cover boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_product_images_product on public.product_images(product_id, sort_order);
create unique index if not exists uq_product_images_storage_path
  on public.product_images(storage_path)
  where storage_path is not null;
create unique index if not exists uq_product_images_one_cover
  on public.product_images(product_id)
  where is_cover = true;

-- 将旧 image_url 作为历史封面写入图片表（不会复制文件，只保留原 URL）。
insert into public.product_images (product_id, storage_path, image_url, is_cover, sort_order)
select p.id, null, p.image_url, true, 0
from public.products p
where p.image_url is not null
  and btrim(p.image_url) <> ''
  and not exists (select 1 from public.product_images pi where pi.product_id = p.id)
on conflict do nothing;

-- 2. 询价单
create sequence if not exists public.inquiry_no_seq start 1;

create table if not exists public.inquiries (
  id uuid primary key default gen_random_uuid(),
  inquiry_no text not null unique,
  user_id uuid not null references public.users(id),
  customer_name text not null,
  customer_phone text not null,
  customer_company text,
  shipping_address text,
  total_quantity integer not null default 0 check (total_quantity >= 0),
  status text not null default 'pending'
    check (status in ('pending', 'contacted', 'quoted', 'considering', 'converted', 'lost')),
  remark text,
  converted_order_id uuid references public.orders(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inquiry_items (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.inquiries(id) on delete cascade,
  product_id uuid not null references public.products(id),
  product_name text not null,
  style_code text not null,
  sku_id uuid not null references public.product_skus(id),
  sku_code text not null,
  color text not null,
  size text not null,
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_inquiries_user on public.inquiries(user_id);
create index if not exists idx_inquiries_status on public.inquiries(status);
create index if not exists idx_inquiries_created on public.inquiries(created_at desc);
create index if not exists idx_inquiry_items_inquiry on public.inquiry_items(inquiry_id);

-- 正式订单记录来源询价单，保留旧数据兼容。
alter table public.orders add column if not exists source_inquiry_id uuid references public.inquiries(id);
create unique index if not exists uq_orders_source_inquiry
  on public.orders(source_inquiry_id)
  where source_inquiry_id is not null;

-- SKU 价格字段仅为旧版兼容，不再由前后台展示或使用。
alter table public.product_skus alter column wholesale_price set default 0;

-- updated_at 触发器
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists inquiries_set_updated_at on public.inquiries;
create trigger inquiries_set_updated_at before update on public.inquiries
for each row execute function public.set_updated_at();

-- 3. 创建询价单：不含价格、不扣库存。客户可先表达需求，再由老板线下报价和确认库存。
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
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception '选款单为空';
  end if;

  select * into v_user from public.users where id = p_user_id;
  if not found then
    raise exception '用户不存在';
  end if;

  select count(*), coalesce(sum(x.quantity), 0)::integer
    into v_item_count, v_total_quantity
  from jsonb_to_recordset(p_items) as x(sku_id uuid, quantity integer);

  if v_item_count <= 0 or v_item_count > 100 then
    raise exception '选款单规格数量必须在 1 至 100 之间';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as x(sku_id uuid, quantity integer)
    where x.sku_id is null or x.quantity is null or x.quantity <= 0
  ) then
    raise exception '选款数量无效';
  end if;

  select count(*) into v_valid_count
  from jsonb_to_recordset(p_items) as x(sku_id uuid, quantity integer)
  join public.product_skus s on s.id = x.sku_id
  join public.products p on p.id = s.product_id
  where p.status = 'on_sale';

  if v_valid_count <> v_item_count then
    raise exception '部分款式不存在或已下架，请刷新选款册后重试';
  end if;

  insert into public.inquiries (
    inquiry_no, user_id, customer_name, customer_phone, customer_company,
    shipping_address, total_quantity, status, remark
  ) values (
    'INQ-' || to_char(current_date, 'YYYYMMDD') || '-' || lpad(nextval('public.inquiry_no_seq')::text, 6, '0'),
    v_user.id, v_user.name, v_user.phone, v_user.company,
    nullif(btrim(coalesce(p_shipping_address, v_user.address, '')), ''),
    v_total_quantity, 'pending', nullif(btrim(coalesce(p_remark, '')), '')
  ) returning * into v_inquiry;

  insert into public.inquiry_items (
    inquiry_id, product_id, product_name, style_code,
    sku_id, sku_code, color, size, quantity
  )
  select
    v_inquiry.id, p.id, p.name, p.style_code,
    s.id, s.sku_code, s.color, s.size, x.quantity
  from jsonb_to_recordset(p_items) as x(sku_id uuid, quantity integer)
  join public.product_skus s on s.id = x.sku_id
  join public.products p on p.id = s.product_id;

  return jsonb_build_object(
    'inquiry', to_jsonb(v_inquiry) || jsonb_build_object(
      'items', coalesce((
        select jsonb_agg(to_jsonb(ii) order by ii.created_at)
        from public.inquiry_items ii
        where ii.inquiry_id = v_inquiry.id
      ), '[]'::jsonb)
    )
  );
end;
$$;

-- 4. 询价状态流转
create or replace function public.set_inquiry_status(
  p_inquiry_id uuid,
  p_new_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inquiry public.inquiries%rowtype;
  v_allowed boolean := false;
begin
  if p_new_status not in ('pending', 'contacted', 'quoted', 'considering', 'lost') then
    raise exception '无效的询价状态';
  end if;

  select * into v_inquiry from public.inquiries where id = p_inquiry_id for update;
  if not found then
    raise exception '询价单不存在';
  end if;

  if v_inquiry.status in ('converted', 'lost') then
    raise exception '当前询价单已结束，不能继续修改';
  end if;

  if v_inquiry.status = p_new_status then
    return to_jsonb(v_inquiry);
  end if;

  v_allowed := case
    when v_inquiry.status = 'pending' and p_new_status in ('contacted', 'lost') then true
    when v_inquiry.status = 'contacted' and p_new_status in ('quoted', 'considering', 'lost') then true
    when v_inquiry.status = 'quoted' and p_new_status in ('considering', 'contacted', 'lost') then true
    when v_inquiry.status = 'considering' and p_new_status in ('quoted', 'contacted', 'lost') then true
    else false
  end;

  if not v_allowed then
    raise exception '不允许从 % 变更为 %', v_inquiry.status, p_new_status;
  end if;

  update public.inquiries set status = p_new_status where id = p_inquiry_id returning * into v_inquiry;
  return to_jsonb(v_inquiry);
end;
$$;

-- 5. 询价单 -> 正式订单：此时锁定并扣减库存，价格统一记录为 0，仅用于旧表兼容。
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
  if not found then
    raise exception '询价单不存在';
  end if;

  if v_inquiry.status = 'converted' then
    raise exception '该询价单已经转为正式订单';
  end if;
  if v_inquiry.status = 'lost' then
    raise exception '未成交询价单不能转为订单';
  end if;

  if not exists (select 1 from public.inquiry_items where inquiry_id = p_inquiry_id) then
    raise exception '询价单没有商品明细';
  end if;

  perform s.id
  from public.product_skus s
  join public.inquiry_items ii on ii.sku_id = s.id
  where ii.inquiry_id = p_inquiry_id
  order by s.id
  for update;

  select s.sku_code, s.stock, ii.quantity, p.status
    into v_bad_code, v_bad_stock, v_bad_quantity, v_bad_status
  from public.inquiry_items ii
  join public.product_skus s on s.id = ii.sku_id
  join public.products p on p.id = s.product_id
  where ii.inquiry_id = p_inquiry_id
    and (p.status <> 'on_sale' or ii.quantity > s.stock)
  limit 1;

  if found then
    if v_bad_status <> 'on_sale' then
      raise exception '商品已下架：%', v_bad_code;
    end if;
    raise exception '库存不足：% 当前库存 %，需要 %', v_bad_code, v_bad_stock, v_bad_quantity;
  end if;

  insert into public.orders (
    order_no, user_id, customer_name, customer_phone, customer_company,
    shipping_address, total_amount, total_quantity, status, remark, source_inquiry_id
  ) values (
    'ORD-' || to_char(current_date, 'YYYYMMDD') || '-' || lpad(nextval('public.order_no_seq')::text, 6, '0'),
    v_inquiry.user_id, v_inquiry.customer_name, v_inquiry.customer_phone, v_inquiry.customer_company,
    coalesce(v_inquiry.shipping_address, ''), 0, v_inquiry.total_quantity, 'pending', v_inquiry.remark, v_inquiry.id
  ) returning * into v_order;

  insert into public.order_items (
    order_id, product_id, product_name, sku_id, sku_code,
    color, size, quantity, unit_price, subtotal
  )
  select
    v_order.id, ii.product_id, ii.product_name, ii.sku_id, ii.sku_code,
    ii.color, ii.size, ii.quantity, 0, 0
  from public.inquiry_items ii
  where ii.inquiry_id = p_inquiry_id;

  update public.product_skus s
  set stock = s.stock - ii.quantity
  from public.inquiry_items ii
  where ii.inquiry_id = p_inquiry_id and ii.sku_id = s.id;

  update public.inquiries
  set status = 'converted', converted_order_id = v_order.id
  where id = p_inquiry_id;

  return jsonb_build_object(
    'order', to_jsonb(v_order) || jsonb_build_object(
      'items', coalesce((
        select jsonb_agg(to_jsonb(oi) order by oi.created_at)
        from public.order_items oi
        where oi.order_id = v_order.id
      ), '[]'::jsonb)
    )
  );
end;
$$;

-- 6. Supabase Storage 公共图片桶
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 7. 权限
alter table public.product_images enable row level security;
alter table public.inquiries enable row level security;
alter table public.inquiry_items enable row level security;

revoke all on function public.create_inquiry(uuid, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.set_inquiry_status(uuid, text) from public, anon, authenticated;
revoke all on function public.convert_inquiry_to_order(uuid) from public, anon, authenticated;

grant execute on function public.create_inquiry(uuid, jsonb, text, text) to service_role;
grant execute on function public.set_inquiry_status(uuid, text) to service_role;
grant execute on function public.convert_inquiry_to_order(uuid) to service_role;
grant usage, select on sequence public.inquiry_no_seq to service_role;
grant all on table public.product_images, public.inquiries, public.inquiry_items to service_role;
