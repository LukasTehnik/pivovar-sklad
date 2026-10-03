-- Allow products and customers to be removed without losing the audit trail.
alter table public.stock_movements
  add column if not exists product_name text,
  add column if not exists customer_name text;

update public.stock_movements m set product_name = p.name
from public.products p where m.product_id = p.id and m.product_name is null;
update public.stock_movements m set customer_name = c.name
from public.customers c where m.customer_id = c.id and m.customer_name is null;

alter table public.stock_movements drop constraint if exists stock_movements_product_id_fkey;
alter table public.stock_movements alter column product_id drop not null;
alter table public.stock_movements add constraint stock_movements_product_id_fkey
  foreign key (product_id) references public.products(id) on delete set null;
alter table public.stock_movements drop constraint if exists stock_movements_customer_id_fkey;
alter table public.stock_movements add constraint stock_movements_customer_id_fkey
  foreign key (customer_id) references public.customers(id) on delete set null;

create or replace function public.prevent_nonempty_product_delete()
returns trigger language plpgsql set search_path = public as $$
begin
  if exists (select 1 from public.stock_balances where product_id = old.id and quantity > 0) then
    raise exception 'Položku nelze smazat, dokud jsou kusy skladem';
  end if;
  return old;
end;
$$;
drop trigger if exists products_prevent_nonempty_delete on public.products;
create trigger products_prevent_nonempty_delete before delete on public.products
for each row execute function public.prevent_nonempty_product_delete();

create or replace function public.prevent_customer_with_loans_delete()
returns trigger language plpgsql set search_path = public as $$
begin
  if exists (select 1 from public.keg_loans where customer_id = old.id and quantity > 0) then
    raise exception 'Odběratele nelze smazat, dokud má nevrácené sudy';
  end if;
  return old;
end;
$$;
drop trigger if exists customers_prevent_loans_delete on public.customers;
create trigger customers_prevent_loans_delete before delete on public.customers
for each row execute function public.prevent_customer_with_loans_delete();

create or replace function public.record_stock_movement(
  p_movement_type text, p_product_id uuid, p_quantity integer,
  p_customer_id uuid default null, p_note text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_product public.products%rowtype;
  v_customer_name text;
  v_movement_id uuid;
begin
  if auth.uid() is null then raise exception 'Přihlášení je vyžadováno'; end if;
  if p_quantity is null or p_quantity < 1 then raise exception 'Množství musí být alespoň 1'; end if;
  select * into v_product from public.products where id = p_product_id and active = true;
  if not found then raise exception 'Položka neexistuje nebo není aktivní'; end if;
  if p_customer_id is not null then select name into v_customer_name from public.customers where id = p_customer_id; end if;

  if p_movement_type = 'in' then
    update public.stock_balances set quantity = quantity + p_quantity, updated_at = now() where product_id = p_product_id;
  elsif p_movement_type = 'out' then
    if v_product.package_kind = 'empty_keg' then raise exception 'Nelze vydat prázdný sud'; end if;
    update public.stock_balances set quantity = quantity - p_quantity, updated_at = now()
      where product_id = p_product_id and quantity >= p_quantity;
    if not found then raise exception 'Nelze vydat více kusů než je skladem'; end if;
    if v_product.package_kind = 'keg' then
      if p_customer_id is null then raise exception 'U výdeje sudu je nutný odběratel'; end if;
      insert into public.keg_loans(customer_id, volume_l, quantity) values (p_customer_id, v_product.volume_l, p_quantity)
      on conflict (customer_id, volume_l) do update set quantity = public.keg_loans.quantity + excluded.quantity, updated_at = now();
    end if;
  elsif p_movement_type = 'return' then
    if v_product.package_kind <> 'empty_keg' or p_customer_id is null then raise exception 'Vrácení musí být prázdný sud od odběratele'; end if;
    update public.keg_loans set quantity = quantity - p_quantity, updated_at = now()
      where customer_id = p_customer_id and volume_l = v_product.volume_l and quantity >= p_quantity;
    if not found then raise exception 'Odběratel nemá tolik nevrácených sudů'; end if;
    update public.stock_balances set quantity = quantity + p_quantity, updated_at = now() where product_id = p_product_id;
  elsif p_movement_type = 'adjustment' then
    update public.stock_balances set quantity = quantity + p_quantity, updated_at = now() where product_id = p_product_id;
  else raise exception 'Neznámý typ pohybu'; end if;

  insert into public.stock_movements(movement_type, product_id, product_name, quantity, customer_id, customer_name, note, created_by)
  values (p_movement_type, p_product_id, v_product.name, p_quantity, p_customer_id, v_customer_name, nullif(trim(p_note), ''), auth.uid())
  returning id into v_movement_id;
  return v_movement_id;
end;
$$;
revoke all on function public.record_stock_movement(text, uuid, integer, uuid, text) from public, anon;
grant execute on function public.record_stock_movement(text, uuid, integer, uuid, text) to authenticated;
revoke all on function public.create_product_balance() from public, anon, authenticated;
revoke all on function public.prevent_nonempty_product_delete() from public, anon, authenticated;
revoke all on function public.prevent_customer_with_loans_delete() from public, anon, authenticated;

-- The former hide action is gone, so make any previously hidden rows visible again.
update public.products set active = true where active = false;
update public.customers set active = true where active = false;
