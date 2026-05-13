-- 在 Supabase：SQL Editor → New query → 粘贴运行

create table if not exists public.household_budget (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists household_budget_updated_at_idx
  on public.household_budget (updated_at desc);

alter table public.household_budget enable row level security;

create policy "budget_select_own"
  on public.household_budget for select
  using (auth.uid() = user_id);

create policy "budget_insert_own"
  on public.household_budget for insert
  with check (auth.uid() = user_id);

create policy "budget_update_own"
  on public.household_budget for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "budget_delete_own"
  on public.household_budget for delete
  using (auth.uid() = user_id);
