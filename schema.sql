-- ============================================================
-- 服装批发订货 + ERP 管理系统（Supabase / PostgreSQL）
-- 使用方法：复制本文件全部内容，在 Supabase SQL Editor 中一次性执行。
-- 所有业务数据仅由 Node.js 服务端使用 service_role key 访问。
-- ============================================================

create extension if not exists pgcrypto;

create sequence if not exists public.order_no_seq start 1;

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
  name text not null,
  category text not null,
  description text,
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
  wholesale_price numeric(12,2) not null check (wholesale_price >= 0),
  retail_price numeric(12,2) check (retail_price is null or retail_price >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_id, color, size)
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
  shipping_address text not null,
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
  unit_price numeric(12,2) not null check (unit_price >= 0),
  subtotal numeric(14,2) not null check (subtotal >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_skus_product on public.product_skus(product_id);
create index if not exists idx_cart_user on public.cart_items(user_id);
create index if not exists idx_orders_user on public.orders(user_id);
create index if not exists idx_orders_status on public.orders(status);
create index if not exists idx_orders_created on public.orders(created_at desc);
create index if not exists idx_order_items_order on public.order_items(order_id);

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
create trigger users_set_updated_at before update on public.users
for each row execute function public.set_updated_at();

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at before update on public.products
for each row execute function public.set_updated_at();

drop trigger if exists skus_set_updated_at on public.product_skus;
create trigger skus_set_updated_at before update on public.product_skus
for each row execute function public.set_updated_at();

drop trigger if exists cart_set_updated_at on public.cart_items;
create trigger cart_set_updated_at before update on public.cart_items
for each row execute function public.set_updated_at();

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at before update on public.orders
for each row execute function public.set_updated_at();

-- 购物车 -> 订单：在一个数据库事务中完成库存锁定、订单创建、库存扣减、购物车清空。
create or replace function public.create_order_from_cart(
  p_user_id uuid,
  p_shipping_address text,
  p_remark text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.users%rowtype;
  v_order public.orders%rowtype;
  v_total_amount numeric(14,2);
  v_total_quantity integer;
  v_bad_code text;
  v_bad_stock integer;
  v_bad_quantity integer;
  v_bad_status text;
begin
  if p_shipping_address is null or btrim(p_shipping_address) = '' then
    raise exception '收货地址不能为空';
  end if;

  select * into v_user from public.users where id = p_user_id;
  if not found then
    raise exception '用户不存在';
  end if;

  if not exists (select 1 from public.cart_items where user_id = p_user_id) then
    raise exception '购物车为空';
  end if;

  -- 对涉及的 SKU 行加锁，防止并发超卖。
  perform s.id
  from public.product_skus s
  join public.cart_items c on c.sku_id = s.id
  where c.user_id = p_user_id
  order by s.id
  for update;

  select s.sku_code, s.stock, c.quantity, p.status
    into v_bad_code, v_bad_stock, v_bad_quantity, v_bad_status
  from public.cart_items c
  join public.product_skus s on s.id = c.sku_id
  join public.products p on p.id = s.product_id
  where c.user_id = p_user_id
    and (p.status <> 'on_sale' or c.quantity > s.stock or c.quantity <= 0)
  limit 1;

  if found then
    if v_bad_status <> 'on_sale' then
      raise exception '商品已下架：%', v_bad_code;
    end if;
    raise exception '库存不足：% 当前库存 %，需要 %', v_bad_code, v_bad_stock, v_bad_quantity;
  end if;

  select
    coalesce(sum(c.quantity * s.wholesale_price), 0),
    coalesce(sum(c.quantity), 0)::integer
    into v_total_amount, v_total_quantity
  from public.cart_items c
  join public.product_skus s on s.id = c.sku_id
  where c.user_id = p_user_id;

  insert into public.orders (
    order_no, user_id, customer_name, customer_phone, customer_company,
    shipping_address, total_amount, total_quantity, status, remark
  ) values (
    'ORD-' || to_char(current_date, 'YYYYMMDD') || '-' || lpad(nextval('public.order_no_seq')::text, 6, '0'),
    v_user.id, v_user.name, v_user.phone, v_user.company,
    btrim(p_shipping_address), v_total_amount, v_total_quantity, 'pending', nullif(btrim(coalesce(p_remark, '')), '')
  ) returning * into v_order;

  insert into public.order_items (
    order_id, product_id, product_name, sku_id, sku_code,
    color, size, quantity, unit_price, subtotal
  )
  select
    v_order.id, p.id, p.name, s.id, s.sku_code,
    s.color, s.size, c.quantity, s.wholesale_price, c.quantity * s.wholesale_price
  from public.cart_items c
  join public.product_skus s on s.id = c.sku_id
  join public.products p on p.id = s.product_id
  where c.user_id = p_user_id;

  update public.product_skus s
  set stock = s.stock - c.quantity
  from public.cart_items c
  where c.user_id = p_user_id and c.sku_id = s.id;

  delete from public.cart_items where user_id = p_user_id;

  return jsonb_build_object(
    'order', to_jsonb(v_order) || jsonb_build_object(
      'items', coalesce((select jsonb_agg(to_jsonb(oi) order by oi.created_at) from public.order_items oi where oi.order_id = v_order.id), '[]'::jsonb)
    )
  );
end;
$$;

-- 严格状态流转；取消待确认/已确认订单时自动归还库存。
create or replace function public.set_order_status(
  p_order_id uuid,
  p_new_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_allowed boolean := false;
begin
  if p_new_status not in ('pending', 'confirmed', 'production', 'shipping', 'delivered', 'cancelled') then
    raise exception '无效的订单状态';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception '订单不存在';
  end if;

  if v_order.status = p_new_status then
    return to_jsonb(v_order);
  end if;

  v_allowed := case
    when v_order.status = 'pending' and p_new_status in ('confirmed', 'cancelled') then true
    when v_order.status = 'confirmed' and p_new_status in ('production', 'cancelled') then true
    when v_order.status = 'production' and p_new_status = 'shipping' then true
    when v_order.status = 'shipping' and p_new_status = 'delivered' then true
    else false
  end;

  if not v_allowed then
    raise exception '不允许从 % 变更为 %', v_order.status, p_new_status;
  end if;

  if p_new_status = 'cancelled' then
    update public.product_skus s
    set stock = s.stock + oi.quantity
    from public.order_items oi
    where oi.order_id = v_order.id and oi.sku_id = s.id;
  end if;

  update public.orders
  set status = p_new_status
  where id = p_order_id
  returning * into v_order;

  return to_jsonb(v_order);
end;
$$;

-- 服务端使用 service_role 访问；浏览器不直接连接数据库。
alter table public.users enable row level security;
alter table public.products enable row level security;
alter table public.product_skus enable row level security;
alter table public.cart_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

revoke all on function public.create_order_from_cart(uuid, text, text) from public, anon, authenticated;
revoke all on function public.set_order_status(uuid, text) from public, anon, authenticated;
grant execute on function public.create_order_from_cart(uuid, text, text) to service_role;
grant execute on function public.set_order_status(uuid, text) to service_role;
grant usage, select on sequence public.order_no_seq to service_role;
grant all on table public.users, public.products, public.product_skus, public.cart_items, public.orders, public.order_items to service_role;
