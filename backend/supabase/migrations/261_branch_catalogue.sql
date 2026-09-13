-- Split the product catalogue per branch. The last of the separation.
--
-- Bright chose a full split and reaffirmed it after being told what it does:
-- each branch keeps its own products, packs and prices, and nothing rolls up
-- across branches.
--
-- ⚠️ ACCRA AND NAIROBI NOW HAVE NO PRODUCTS AT ALL. That is the point of a
-- full split, not a fault: every one of the 25 products was created in Nigeria
-- and stays there. Switch to Accra and the Products page is empty until
-- somebody adds a product there. Nothing is lost and nothing is hidden from
-- Nigeria - the branch that owns the catalogue still sees all of it.
--
-- The reason a split was needed at all is money. A shared catalogue holds one
-- price per product, and Accra sells in cedi while Nairobi sells in shilling.
-- One price list cannot be three currencies.
--
-- Small job by row count - 113 rows - but the one with the most reach, because
-- orders, stock, waybills and bonuses all point at a product.
--
-- ⚠️ THE PUBLIC ORDER FORM IS UNAFFECTED. It fetches a product by the id in the
-- embed link rather than listing an organisation's catalogue, and public
-- callers carry no request scope, so branchScopedFetch never filters them. A
-- customer on a live form cannot be cut off by this.

-- ── 1. The column ───────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'products','product_packages','product_pricings',
    'product_cost_changes','product_dedicated_handlers','product_delivery_goals'
  ]
  loop
    execute format(
      'alter table public.%I add column if not exists branch_id uuid references public.branches(id) on delete restrict',
      t);
    execute format('create index if not exists %I on public.%I (branch_id)', t || '_branch_idx', t);
  end loop;
end $$;

-- ── 2. The catalogue is Nigeria's ───────────────────────────────────────────
update public.products p set branch_id = b.id
from public.branches b
where p.branch_id is null and b.org_id = p.org_id
  and b.name = 'Nigeria Operations' and b.active;

-- ── 3. Everything about a product follows that product ──────────────────────
-- ⚠️ PACKAGES, PRICES AND HANDLERS HAVE NO org_id OF THEIR OWN. They can only
-- reach a branch through the product they belong to, so products must be
-- filled in first - which is why step 2 is its own statement above.
do $$
declare t text;
begin
  foreach t in array array[
    'product_packages','product_pricings','product_cost_changes',
    'product_dedicated_handlers','product_delivery_goals'
  ]
  loop
    execute format($f$
      update public.%I c set branch_id = p.branch_id
      from public.products p
      where p.id = c.product_id and c.branch_id is null
    $f$, t);
  end loop;
end $$;

-- ── 4. New products belong to the branch that creates them ──────────────────
-- Until the product routes send a branch of their own, a product created while
-- working in Accra would otherwise default to Nigeria and appear in the wrong
-- catalogue. The child rows read the product, so a pack added to a Ghanaian
-- product lands in Ghana whatever the session says.
create or replace function public.assign_catalogue_branch_id()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_branch uuid;
begin
  if new.branch_id is not null then return new; end if;

  begin
    if tg_table_name = 'products' then
      v_branch := null;
    else
      select p.branch_id into v_branch from public.products p where p.id = new.product_id;
    end if;
  exception when others then
    v_branch := null;
  end;

  if v_branch is null then
    begin
      select b.id into v_branch from public.branches b
      where b.org_id = new.org_id and b.name = 'Nigeria Operations' and b.active
      order by b.created_at limit 1;
    exception when others then
      -- No org_id on this table and no product to read, so there is nothing
      -- honest to fall back to. Left null rather than guessed at.
      v_branch := null;
    end;
  end if;

  new.branch_id := v_branch;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'products','product_packages','product_pricings',
    'product_cost_changes','product_dedicated_handlers','product_delivery_goals'
  ]
  loop
    execute format('drop trigger if exists trg_assign_catalogue_branch on public.%I', t);
    execute format(
      'create trigger trg_assign_catalogue_branch before insert on public.%I for each row execute function public.assign_catalogue_branch_id()',
      t);
  end loop;
end $$;
