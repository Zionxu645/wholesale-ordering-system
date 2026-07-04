-- Eluren V3.3 商品运营字段升级
-- 只新增字段，不删除现有商品、图片、SKU、询价或订单。

begin;

alter table public.products add column if not exists material text;
alter table public.products add column if not exists badge_text text;
alter table public.products add column if not exists customer_note text;

commit;
