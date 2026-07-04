-- 可选演示数据。正式录入真实商品前可不执行。
insert into public.products (id, name, category, description, status)
values
('00000000-0000-4000-8000-000000000001', '圆领卫衣（演示）', '上衣', '演示商品，请在后台修改为真实信息', 'on_sale'),
('00000000-0000-4000-8000-000000000002', '双面摇粒绒（演示）', '外套', '演示商品，请在后台修改为真实信息', 'on_sale')
on conflict (id) do nothing;

insert into public.product_skus (id, product_id, sku_code, color, size, stock, wholesale_price, retail_price)
values
('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'SWEAT-BLK-M', '黑色', 'M', 100, 39.00, null),
('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'SWEAT-GRY-L', '浅灰', 'L', 100, 39.00, null),
('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000002', 'FLEECE-BLK-L', '黑色', 'L', 80, 59.00, null)
on conflict (id) do nothing;
