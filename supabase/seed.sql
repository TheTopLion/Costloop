-- Local-only deterministic demo identities. Password for both users: AppraiseDemo1!
insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token)
values
 ('00000000-0000-0000-0000-000000000000','10000000-0000-0000-0000-000000000001','authenticated','authenticated','owner@appraise.local',crypt('AppraiseDemo1!',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{"display_name":"Demo Owner"}',now(),now(),'','','',''),
 ('00000000-0000-0000-0000-000000000000','20000000-0000-0000-0000-000000000001','authenticated','authenticated','other@appraise.local',crypt('AppraiseDemo1!',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{"display_name":"Other Owner"}',now(),now(),'','','','')
on conflict(id) do nothing;

insert into public.companies(id,name,legal_name,base_currency,created_by) values
 ('a0000000-0000-0000-0000-000000000001','Caspian Industrial Demo','Caspian Industrial Services LLP','KZT','10000000-0000-0000-0000-000000000001'),
 ('b0000000-0000-0000-0000-000000000001','Isolation Test Company',null,'USD','20000000-0000-0000-0000-000000000001')
on conflict(id) do nothing;
insert into public.user_profiles(user_id,display_name) values ('10000000-0000-0000-0000-000000000001','Demo Owner'),('20000000-0000-0000-0000-000000000001','Other Owner') on conflict(user_id) do nothing;
insert into public.company_memberships(company_id,user_id,role) values
 ('a0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','owner'),
 ('b0000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','owner') on conflict do nothing;
insert into public.projects(id,company_id,name,project_number,client_name,status,currency,created_by) values
 ('a1000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','Pump Station Overhaul','CIS-2026-001','Aktau Utilities','estimating','KZT','10000000-0000-0000-0000-000000000001'),
 ('a1000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','Workshop Ventilation Upgrade','CIS-2026-002','Demo Client','draft','KZT','10000000-0000-0000-0000-000000000001'),
 ('b1000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001','Confidential Other Project','ISO-001','Other Client','draft','USD','20000000-0000-0000-0000-000000000001') on conflict(id) do nothing;
insert into public.suppliers(id,company_id,name,email,created_by) values
 ('a2000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','Mangystau Supply','sales@example.local','10000000-0000-0000-0000-000000000001'),
 ('a2000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','Caspian Technical Trade','quotes@example.local','10000000-0000-0000-0000-000000000001'),
 ('b2000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001','Private Supplier',null,'20000000-0000-0000-0000-000000000001') on conflict(id) do nothing;
insert into public.spec_items(id,company_id,project_id,position,description,quantity,unit,normalized_quantity,normalized_unit,sort_order,created_by) values
 ('a3000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','1','Supply centrifugal pump DN50',2.00000000,'pcs',2.00000000,'each',1,'10000000-0000-0000-0000-000000000001'),
 ('a3000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','2','Install and test centrifugal pump DN50',16.00000000,'hour',16.00000000,'h',2,'10000000-0000-0000-0000-000000000001'),
 ('b3000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001','1','Private line item',1.00000000,'pcs',1.00000000,'each',1,'20000000-0000-0000-0000-000000000001') on conflict(id) do nothing;

