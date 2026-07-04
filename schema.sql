-- ============================================================
-- Eluren 服装电子选款册 + 询价/订单管理系统 V3
-- Supabase / PostgreSQL 全新安装脚本
-- 使用方法：复制本文件全部内容，在 Supabase SQL Editor 中一次性执行。
-- 已安装旧版数据库时，请改为运行 migration-v3.sql。
-- ============================================================

create extension if not exists pgcrypto;
create sequence if not exists public.order_no_seq start 1;
create sequence if not exists public.inquiry_no_seq start 1;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  password_hash text not null,
  name text not null,
  company text,
  address text,
  level text not null default 'normal' check (level in ('normal', 'vip')),
  role text not null default 'customer' check (role in ('customer', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  style_code text not null unique,
  name text not null,
  category text not null,
  description text,
  material text,
  badge_text text,
  customer_note text,
  image_url text,
  status text not null default 'on_sale' check (status in ('on_sale', 'off_sale')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_skus (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  sku_code text not null unique,
  color text not null,
  size text not null,
  stock integer not null default 0 check (stock >= 0),
  wholesale_price numeric(12,2) not null default 0 check (wholesale_price >= 0),
  retail_price numeric(12,2) check (retail_price is null or retail_price >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_id, color, size)
);

create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  storage_path text,
  image_url text not null,
  is_cover boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.cart_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  sku_id uuid not null references public.product_skus(id) on delete cascade,
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, sku_id)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique,
  user_id uuid not null references public.users(id),
  customer_name text not null,
  customer_phone text not null,
  customer_company text,
  shipping_address text not null default '',
  total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
  total_quantity integer not null default 0 check (total_quantity >= 0),
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'production', 'shipping', 'delivered', 'cancelled')),
  remark text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  product_name text not null,
  sku_id uuid not null references public.product_skus(id),
  sku_code text not null,
  color text not null,
  size text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null default 0 check (unit_price >= 0),
  subtotal numeric(14,2) not null default 0 check (subtotal >= 0),
  created_at timestamptz not null default now()
);

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

alter table public.orders add column if not exists source_inquiry_id uuid references public.inquiries(id);

create index if not exists idx_skus_product on public.product_skus(product_id);
create index if not exists idx_product_images_product on public.product_images(product_id, sort_order);
create unique index if not exists uq_product_images_storage_path on public.product_images(storage_path) where storage_path is not null;
create unique index if not exists uq_product_images_one_cover on public.product_images(product_id) where is_cover = true;
create index if not exists idx_cart_user on public.cart_items(user_id);
create index if not exists idx_orders_user on public.orders(user_id);
create index if not exists idx_orders_status on public.orders(status);
create index if not exists idx_orders_created on public.orders(created_at desc);
create unique index if not exists uq_orders_source_inquiry on public.orders(source_inquiry_id) where source_inquiry_id is not null;
create index if not exists idx_order_items_order on public.order_items(order_id);
create index if not exists idx_inquiries_user on public.inquiries(user_id);
create index if not exists idx_inquiries_status on public.inquiries(status);
create index if not exists idx_inquiries_created on public.inquiries(created_at desc);
create index if not exists idx_inquiry_items_inquiry on public.inquiry_items(inquiry_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at before update on public.users for each row execute function public.set_updated_at();
drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at before update on public.products for each row execute function public.set_updated_at();
drop trigger if exists skus_set_updated_at on public.product_skus;
create trigger skus_set_updated_at before update on public.product_skus for each row execute function public.set_updated_at();
drop trigger if exists cart_set_updated_at on public.cart_items;
create trigger cart_set_updated_at before update on public.cart_items for each row execute function public.set_updated_at();
drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at before update on public.orders for each row execute function public.set_updated_at();
drop trigger if exists inquiries_set_updated_at on public.inquiries;
create trigger inquiries_set_updated_at before update on public.inquiries for each row execute function public.set_updated_at();

-- 无价格询价单
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

create or replace function public.set_inquiry_status(p_inquiry_id uuid, p_new_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inquiry public.inquiries%rowtype;
  v_allowed boolean := false;
begin
  if p_new_status not in ('pending', 'contacted', 'quoted', 'considering', 'lost') then raise exception '无效的询价状态'; end if;
  select * into v_inquiry from public.inquiries where id = p_inquiry_id for update;
  if not found then raise exception '询价单不存在'; end if;
  if v_inquiry.status in ('converted', 'lost') then raise exception '当前询价单已结束，不能继续修改'; end if;
  if v_inquiry.status = p_new_status then return to_jsonb(v_inquiry); end if;
  v_allowed := case
    when v_inquiry.status = 'pending' and p_new_status in ('contacted', 'lost') then true
    when v_inquiry.status = 'contacted' and p_new_status in ('quoted', 'considering', 'lost') then true
    when v_inquiry.status = 'quoted' and p_new_status in ('considering', 'contacted', 'lost') then true
    when v_inquiry.status = 'considering' and p_new_status in ('quoted', 'contacted', 'lost') then true
    else false
  end;
  if not v_allowed then raise exception '不允许从 % 变更为 %', v_inquiry.status, p_new_status; end if;
  update public.inquiries set status = p_new_status where id = p_inquiry_id returning * into v_inquiry;
  return to_jsonb(v_inquiry);
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

-- 旧版购物车下单兼容函数：仍可运行，但金额固定为 0。V3 前台不再调用。
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

create or replace function public.set_order_status(p_order_id uuid, p_new_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_allowed boolean := false;
begin
  if p_new_status not in ('pending', 'confirmed', 'production', 'shipping', 'delivered', 'cancelled') then raise exception '无效的订单状态'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception '订单不存在'; end if;
  if v_order.status = p_new_status then return to_jsonb(v_order); end if;
  v_allowed := case
    when v_order.status = 'pending' and p_new_status in ('confirmed', 'cancelled') then true
    when v_order.status = 'confirmed' and p_new_status in ('production', 'cancelled') then true
    when v_order.status = 'production' and p_new_status = 'shipping' then true
    when v_order.status = 'shipping' and p_new_status = 'delivered' then true
    else false
  end;
  if not v_allowed then raise exception '不允许从 % 变更为 %', v_order.status, p_new_status; end if;
  if p_new_status = 'cancelled' then
    update public.product_skus s set stock = s.stock + oi.quantity from public.order_items oi where oi.order_id = v_order.id and oi.sku_id = s.id;
  end if;
  update public.orders set status = p_new_status where id = p_order_id returning * into v_order;
  return to_jsonb(v_order);
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

alter table public.users enable row level security;
alter table public.products enable row level security;
alter table public.product_skus enable row level security;
alter table public.product_images enable row level security;
alter table public.cart_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.inquiries enable row level security;
alter table public.inquiry_items enable row level security;

revoke all on function public.create_inquiry(uuid, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.set_inquiry_status(uuid, text) from public, anon, authenticated;
revoke all on function public.convert_inquiry_to_order(uuid) from public, anon, authenticated;
revoke all on function public.create_order_from_cart(uuid, text, text) from public, anon, authenticated;
revoke all on function public.set_order_status(uuid, text) from public, anon, authenticated;

grant execute on function public.create_inquiry(uuid, jsonb, text, text) to service_role;
grant execute on function public.set_inquiry_status(uuid, text) to service_role;
grant execute on function public.convert_inquiry_to_order(uuid) to service_role;
grant execute on function public.create_order_from_cart(uuid, text, text) to service_role;
grant execute on function public.set_order_status(uuid, text) to service_role;
grant usage, select on sequence public.order_no_seq, public.inquiry_no_seq to service_role;
grant all on table public.users, public.products, public.product_skus, public.product_images, public.cart_items, public.orders, public.order_items, public.inquiries, public.inquiry_items to service_role;
