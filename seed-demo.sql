-- 可选演示数据。真实使用时可以不执行。
insert into public.products (id, style_code, name, category, description, status)
values
('00000000-0000-4000-8000-000000000001', 'EL-DEMO-001', '圆领卫衣（演示）', '上衣', '演示款式，不显示价格', 'on_sale'),
('00000000-0000-4000-8000-000000000002', 'EL-DEMO-002', '双面摇粒绒（演示）', '外套', '演示款式，不显示价格', 'on_sale')
on conflict (id) do update set style_code = excluded.style_code;

insert into public.product_skus (id, product_id, sku_code, color, size, stock, wholesale_price, retail_price)
values
('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'SWEAT-BLK-M', '黑色', 'M', 100, 0, null),
('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'SWEAT-GRY-L', '浅灰', 'L', 100, 0, null),
('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000002', 'FLEECE-BLK-L', '黑色', 'L', 80, 0, null)
on conflict (id) do nothing;
