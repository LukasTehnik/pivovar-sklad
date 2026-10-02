-- Pivovar sklad: shared inventory ledger. Run through the Supabase SQL editor.
create extension if not exists pgcrypto;

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  beer_name text,
  package_kind text not null check (package_kind in ('pet', 'keg', 'empty_keg')),
  volume_l numeric(6,2) not null check (volume_l > 0),
  active boolean not null default true,
  reorder_level integer not null default 0 check (reorder_level >= 0),
  created_at timestamptz not null default now()
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.stock_balances (
  product_id uuid primary key references public.products(id) on delete cascade,
  quantity integer not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now()
);

create table public.keg_loans (
  customer_id uuid not null references public.customers(id) on delete cascade,
  volume_l numeric(6,2) not null check (volume_l > 0),
  quantity integer not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (customer_id, volume_l)
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  movement_type text not null check (movement_type in ('in', 'out', 'return', 'adjustment')),
  product_id uuid not null references public.products(id),
  quantity integer not null check (quantity > 0),
  customer_id uuid references public.customers(id),
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index stock_movements_created_at_idx on public.stock_movements (created_at desc);
create index stock_movements_product_id_idx on public.stock_movements (product_id);
create index stock_movements_customer_id_idx on public.stock_movements (customer_id) where customer_id is not null;

create or replace function public.create_product_balance()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.stock_balances(product_id) values (new.id);
  return new;
end;
$$;
create trigger products_create_balance after insert on public.products
for each row execute function public.create_product_balance();

-- The function is the only mutable stock endpoint: balance, loans and history
-- are changed atomically, so two people cannot issue the same stock twice.
create or replace function public.record_stock_movement(
  p_movement_type text,
  p_product_id uuid,
  p_quantity integer,
  p_customer_id uuid default null,
  p_note text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_product public.products%rowtype;
  v_movement_id uuid;
  v_loan_quantity integer;
begin
  if auth.uid() is null then raise exception 'Přihlášení je vyžadováno'; end if;
  if p_quantity is null or p_quantity < 1 then raise exception 'Množství musí být alespoň 1'; end if;
  select * into v_product from public.products where id = p_product_id and active = true;
  if not found then raise exception 'Položka neexistuje nebo není aktivní'; end if;

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

  insert into public.stock_movements(movement_type, product_id, quantity, customer_id, note, created_by)
  values (p_movement_type, p_product_id, p_quantity, p_customer_id, nullif(trim(p_note), ''), auth.uid()) returning id into v_movement_id;
  return v_movement_id;
end;
$$;

alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.stock_balances enable row level security;
alter table public.keg_loans enable row level security;
alter table public.stock_movements enable row level security;

create policy "authenticated read products" on public.products for select to authenticated using (true);
create policy "authenticated manage products" on public.products for all to authenticated using (true) with check (true);
create policy "authenticated read customers" on public.customers for select to authenticated using (true);
create policy "authenticated manage customers" on public.customers for all to authenticated using (true) with check (true);
create policy "authenticated read balances" on public.stock_balances for select to authenticated using (true);
create policy "authenticated read loans" on public.keg_loans for select to authenticated using (true);
create policy "authenticated read movements" on public.stock_movements for select to authenticated using (true);

revoke all on function public.record_stock_movement(text, uuid, integer, uuid, text) from public;
grant execute on function public.record_stock_movement(text, uuid, integer, uuid, text) to authenticated;

alter publication supabase_realtime add table public.products, public.customers, public.stock_balances, public.keg_loans, public.stock_movements;
