-- =====================================================================
-- Atratis Approval · Etapa 1 · Base
-- Perfis, clientes, vínculos usuário × empresa, acesso da equipe,
-- configurações da agência e trilha de auditoria imutável.
--
-- Regras de segurança:
--   * Toda tabela de dados tem RLS ligado.
--   * O papel "anon" não tem acesso a nenhuma tabela.
--   * Funções auxiliares ficam no schema "private", que o Supabase não
--     expõe pela API (não podem ser chamadas via RPC).
--   * O papel do usuário (admin | equipe | cliente) só muda por admin
--     ou pela função de servidor (service_role). Nunca pelo próprio usuário.
-- =====================================================================

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create type public.user_role as enum ('admin', 'equipe', 'cliente');

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  nome        text,
  role        public.user_role not null default 'cliente',
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint profiles_email_chk check (email = lower(email)),
  constraint profiles_nome_chk check (nome is null or length(nome) <= 120)
);
create unique index profiles_email_uq on public.profiles (email);
comment on table public.profiles is 'Usuários do sistema. O papel define o que cada um enxerga.';

create table public.clients (
  id              uuid primary key default gen_random_uuid(),
  nome_comercial  text not null,
  razao_social    text,
  cnpj            text,
  endereco        text,
  bairro          text,
  cidade          text,
  uf              text,
  cep             text,
  telefone        text,
  email_contato   text,
  ativo           boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.profiles (id) on delete set null,
  constraint clients_nome_chk  check (length(btrim(nome_comercial)) between 1 and 200),
  constraint clients_cnpj_chk  check (cnpj is null or cnpj ~ '^[0-9]{14}$'),
  constraint clients_uf_chk    check (uf is null or uf ~ '^[A-Z]{2}$'),
  constraint clients_cep_chk   check (cep is null or cep ~ '^[0-9]{8}$'),
  constraint clients_email_chk check (email_contato is null or email_contato ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);
create unique index clients_nome_uq on public.clients (lower(btrim(nome_comercial)));
comment on column public.clients.cnpj is 'Somente dígitos (14).';
comment on column public.clients.endereco is 'Logradouro, número e complemento.';

-- Observações internas ficam numa tabela à parte: RLS é por linha,
-- então separar é o que garante que o cliente nunca as veja.
create table public.client_internal (
  client_id             uuid primary key references public.clients (id) on delete cascade,
  observacoes_internas  text,
  updated_at            timestamptz not null default now(),
  updated_by            uuid references public.profiles (id) on delete set null
);

-- Quem, do lado do cliente, acessa cada empresa (concedido um a um).
create table public.client_members (
  client_id     uuid not null references public.clients (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  pode_aprovar  boolean not null default true,
  ativo         boolean not null default true,
  created_at    timestamptz not null default now(),
  created_by    uuid references public.profiles (id) on delete set null,
  primary key (client_id, user_id)
);
create index client_members_user_idx on public.client_members (user_id);

-- Quais clientes cada pessoa da equipe interna pode ver (admin vê todos).
create table public.staff_client_access (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  client_id   uuid not null references public.clients (id) on delete cascade,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles (id) on delete set null,
  primary key (user_id, client_id)
);
create index staff_client_access_client_idx on public.staff_client_access (client_id);

-- Dados cadastrais da Atratis (uma única linha), usados no P.I.
create table public.agency_settings (
  id            boolean primary key default true,
  nome          text not null,
  razao_social  text,
  cnpj          text,
  endereco      text,
  bairro        text,
  cidade        text,
  uf            text,
  cep           text,
  telefone      text,
  email         text,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles (id) on delete set null,
  constraint agency_settings_singleton check (id),
  constraint agency_cnpj_chk check (cnpj is null or cnpj ~ '^[0-9]{14}$'),
  constraint agency_uf_chk   check (uf is null or uf ~ '^[A-Z]{2}$'),
  constraint agency_cep_chk  check (cep is null or cep ~ '^[0-9]{8}$')
);

-- Trilha de auditoria: só recebe linhas por gatilho; ninguém edita nem apaga.
create table public.audit_log (
  id           bigint generated always as identity primary key,
  occurred_at  timestamptz not null default now(),
  -- Sem chave estrangeira de propósito: o histórico é imutável e precisa
  -- sobreviver à exclusão de usuários e clientes, guardando id e e-mail.
  actor_id     uuid,
  actor_email  text,
  action       text not null,
  entity       text not null,
  entity_id    text,
  client_id    uuid,
  details      jsonb not null default '{}'::jsonb
);
create index audit_log_client_idx on public.audit_log (client_id, occurred_at desc);
create index audit_log_entity_idx on public.audit_log (entity, entity_id, occurred_at desc);

-- ---------------------------------------------------------------------
-- Funções auxiliares de permissão (schema private, security definer)
-- ---------------------------------------------------------------------

create or replace function private.current_app_role()
returns public.user_role
language sql stable security definer set search_path = ''
as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.ativo
$$;

create or replace function private.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(private.current_app_role() = 'admin', false) $$;

create or replace function private.is_staff()
returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(private.current_app_role() in ('admin', 'equipe'), false) $$;

create or replace function private.has_client_access(p_client uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select case private.current_app_role()
    when 'admin' then exists (select 1 from public.clients c where c.id = p_client)
    when 'equipe' then exists (
      select 1 from public.staff_client_access s
      where s.client_id = p_client and s.user_id = auth.uid())
    when 'cliente' then exists (
      select 1 from public.client_members m
      join public.clients c on c.id = m.client_id
      where m.client_id = p_client and m.user_id = auth.uid() and m.ativo and c.ativo)
    else false
  end
$$;

create or replace function private.can_approve(p_client uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.current_app_role() = 'cliente', false) and exists (
    select 1 from public.client_members m
    join public.clients c on c.id = m.client_id
    where m.client_id = p_client and m.user_id = auth.uid()
      and m.ativo and m.pode_aprovar and c.ativo)
$$;

-- True quando a requisição vem da função de servidor (chave service_role).
create or replace function private.is_service_role()
returns boolean
language plpgsql stable set search_path = ''
as $$
declare
  v text := current_setting('request.jwt.claims', true);
begin
  if v is null or v = '' then
    return false;
  end if;
  return coalesce((v::jsonb ->> 'role') = 'service_role', false);
exception when others then
  return false;
end;
$$;

-- Quem está agindo: o usuário logado ou, quando a função de servidor age em
-- nome de um admin, o id que ela informa no cabeçalho x-actor-id.
create or replace function private.actor_id()
returns uuid
language plpgsql stable set search_path = ''
as $$
declare
  v_headers text;
begin
  if auth.uid() is not null then
    return auth.uid();
  end if;
  if private.is_service_role() then
    v_headers := current_setting('request.headers', true);
    if v_headers is not null and v_headers <> '' then
      return nullif(v_headers::jsonb ->> 'x-actor-id', '')::uuid;
    end if;
  end if;
  return null;
exception when others then
  return null;
end;
$$;

grant execute on function
  private.current_app_role(), private.is_admin(), private.is_staff(),
  private.has_client_access(uuid), private.can_approve(uuid),
  private.is_service_role(), private.actor_id()
to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Gatilhos genéricos
-- ---------------------------------------------------------------------

create or replace function private.set_updated_at()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Gatilho de auditoria. Argumentos: (prefixo da ação, coluna com o id do cliente).
create or replace function private.audit_row()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_prefix     text := tg_argv[0];
  v_client_col text := nullif(tg_argv[1], '');
  v_new        jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_old        jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_row        jsonb := coalesce(v_new, v_old);
  v_changes    jsonb := '{}'::jsonb;
  v_key        text;
  v_actor      uuid := private.actor_id();
  v_details    jsonb;
  v_action     text;
  v_client     uuid;
begin
  if tg_op = 'UPDATE' then
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key not in ('updated_at', 'updated_by')
         and (v_new -> v_key) is distinct from (v_old -> v_key) then
        v_changes := v_changes || jsonb_build_object(
          v_key, jsonb_build_object('de', v_old -> v_key, 'para', v_new -> v_key));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then
      return new;
    end if;
    v_details := jsonb_build_object('alteracoes', v_changes);
    v_action := v_prefix || '.alterado';
  elsif tg_op = 'INSERT' then
    v_details := jsonb_build_object('registro', v_new - 'created_at' - 'updated_at');
    v_action := v_prefix || '.criado';
  else
    v_details := jsonb_build_object('registro', v_old - 'created_at' - 'updated_at');
    v_action := v_prefix || '.removido';
  end if;

  if v_client_col is not null then
    v_client := nullif(v_row ->> v_client_col, '')::uuid;
  end if;

  insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, client_id, details)
  values (
    v_actor,
    (select p.email from public.profiles p where p.id = v_actor),
    v_action,
    tg_table_name,
    coalesce(v_row ->> 'id',
             concat_ws(':', v_row ->> 'client_id', v_row ->> 'user_id')),
    v_client,
    v_details
  );
  return coalesce(new, old);
end;
$$;

create or replace function private.audit_log_immutable()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  raise exception 'O histórico de auditoria não pode ser alterado nem apagado.'
    using errcode = '42501';
end;
$$;

-- ---------------------------------------------------------------------
-- Gatilhos específicos
-- ---------------------------------------------------------------------

-- Cria o perfil quando um usuário nasce no Supabase Auth. O papel vem de
-- app_metadata, que só a chave de servidor consegue definir.
create or replace function private.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_role text := new.raw_app_meta_data ->> 'role';
begin
  insert into public.profiles (id, email, nome, role)
  values (
    new.id,
    lower(new.email),
    nullif(btrim(new.raw_user_meta_data ->> 'nome'), ''),
    case when v_role in ('admin', 'equipe', 'cliente') then v_role::public.user_role
         else 'cliente'::public.user_role end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create or replace function private.sync_user_email()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = lower(new.email) where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function private.sync_user_email();

-- Protege campos sensíveis do perfil e impede ficar sem administrador ativo.
create or replace function private.guard_profile_update()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_privileged boolean := private.is_admin() or private.is_service_role()
                          or session_user in ('postgres', 'supabase_admin');
begin
  if not v_privileged then
    if new.role is distinct from old.role
       or new.ativo is distinct from old.ativo
       or new.email is distinct from old.email
       or new.id is distinct from old.id then
      raise exception 'Somente um administrador pode alterar perfil, status ou e-mail.'
        using errcode = '42501';
    end if;
  end if;

  if old.role = 'admin' and old.ativo
     and (new.role <> 'admin' or not new.ativo)
     and not exists (
       select 1 from public.profiles p
       where p.role = 'admin' and p.ativo and p.id <> old.id) then
    raise exception 'É preciso manter pelo menos um administrador ativo.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- Ao mudar o papel, remove vínculos que deixaram de fazer sentido.
create or replace function private.cleanup_role_links()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.role is distinct from old.role then
    if new.role <> 'cliente' then
      delete from public.client_members where user_id = new.id;
    end if;
    if new.role <> 'equipe' then
      delete from public.staff_client_access where user_id = new.id;
    end if;
  end if;
  return new;
end;
$$;

-- Vínculo de empresa só para usuário com papel "cliente".
create or replace function private.check_member_role()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = new.user_id and p.role = 'cliente') then
    raise exception 'Só usuários com perfil Cliente podem ser vinculados a uma empresa.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Acesso de equipe só para usuário com papel "equipe".
create or replace function private.check_staff_role()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = new.user_id and p.role = 'equipe') then
    raise exception 'Só usuários com perfil Equipe recebem acesso por cliente (administradores já veem todos).'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Preenche created_by / updated_by com quem está agindo.
create or replace function private.stamp_created_by()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.created_by := coalesce(private.actor_id(), new.created_by);
  return new;
end;
$$;

create or replace function private.stamp_updated_by()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_by := private.actor_id();
  return new;
end;
$$;

-- profiles
create trigger profiles_guard before update on public.profiles
  for each row execute function private.guard_profile_update();
create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger profiles_cleanup after update of role on public.profiles
  for each row execute function private.cleanup_role_links();
create trigger profiles_audit after insert or update or delete on public.profiles
  for each row execute function private.audit_row('usuario', '');

-- clients
create trigger clients_created_by before insert on public.clients
  for each row execute function private.stamp_created_by();
create trigger clients_updated_at before update on public.clients
  for each row execute function private.set_updated_at();
create trigger clients_audit after insert or update or delete on public.clients
  for each row execute function private.audit_row('cliente', 'id');

-- client_internal
create trigger client_internal_updated before insert or update on public.client_internal
  for each row execute function private.stamp_updated_by();
create trigger client_internal_updated_at before update on public.client_internal
  for each row execute function private.set_updated_at();
create trigger client_internal_audit after insert or update or delete on public.client_internal
  for each row execute function private.audit_row('cliente.observacoes', 'client_id');

-- client_members
create trigger client_members_role before insert or update of user_id on public.client_members
  for each row execute function private.check_member_role();
create trigger client_members_created_by before insert on public.client_members
  for each row execute function private.stamp_created_by();
create trigger client_members_audit after insert or update or delete on public.client_members
  for each row execute function private.audit_row('cliente.aprovador', 'client_id');

-- staff_client_access
create trigger staff_access_role before insert or update of user_id on public.staff_client_access
  for each row execute function private.check_staff_role();
create trigger staff_access_created_by before insert on public.staff_client_access
  for each row execute function private.stamp_created_by();
create trigger staff_access_audit after insert or update or delete on public.staff_client_access
  for each row execute function private.audit_row('cliente.acesso_equipe', 'client_id');

-- agency_settings
create trigger agency_settings_updated before insert or update on public.agency_settings
  for each row execute function private.stamp_updated_by();
create trigger agency_settings_updated_at before update on public.agency_settings
  for each row execute function private.set_updated_at();
create trigger agency_settings_audit after insert or update on public.agency_settings
  for each row execute function private.audit_row('agencia', '');

-- audit_log
create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function private.audit_log_immutable();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function private.audit_log_immutable();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------

alter table public.profiles            enable row level security;
alter table public.clients             enable row level security;
alter table public.client_internal     enable row level security;
alter table public.client_members      enable row level security;
alter table public.staff_client_access enable row level security;
alter table public.agency_settings     enable row level security;
alter table public.audit_log           enable row level security;

-- profiles: cada um vê o próprio; a equipe interna vê todos.
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or private.is_staff());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or private.is_admin())
  with check (id = auth.uid() or private.is_admin());

-- clients
create policy clients_select on public.clients for select to authenticated
  using (private.has_client_access(id));
create policy clients_insert on public.clients for insert to authenticated
  with check (private.is_admin());
create policy clients_update on public.clients for update to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- client_internal: só equipe interna com acesso ao cliente.
create policy client_internal_select on public.client_internal for select to authenticated
  using (private.is_staff() and private.has_client_access(client_id));
create policy client_internal_insert on public.client_internal for insert to authenticated
  with check (private.is_staff() and private.has_client_access(client_id));
create policy client_internal_update on public.client_internal for update to authenticated
  using (private.is_staff() and private.has_client_access(client_id))
  with check (private.is_staff() and private.has_client_access(client_id));

-- client_members
create policy client_members_select on public.client_members for select to authenticated
  using (user_id = auth.uid() or (private.is_staff() and private.has_client_access(client_id)));
create policy client_members_insert on public.client_members for insert to authenticated
  with check (private.is_admin());
create policy client_members_update on public.client_members for update to authenticated
  using (private.is_admin()) with check (private.is_admin());
create policy client_members_delete on public.client_members for delete to authenticated
  using (private.is_admin());

-- staff_client_access
create policy staff_access_select on public.staff_client_access for select to authenticated
  using (private.is_admin() or user_id = auth.uid());
create policy staff_access_insert on public.staff_client_access for insert to authenticated
  with check (private.is_admin());
create policy staff_access_delete on public.staff_client_access for delete to authenticated
  using (private.is_admin());

-- agency_settings
create policy agency_select on public.agency_settings for select to authenticated
  using (private.is_staff());
create policy agency_update on public.agency_settings for update to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- audit_log: admin vê tudo; equipe vê o que é dos seus clientes.
create policy audit_select on public.audit_log for select to authenticated
  using (private.is_admin()
         or (private.is_staff() and client_id is not null and private.has_client_access(client_id)));

-- ---------------------------------------------------------------------
-- Privilégios (defesa em camadas, além do RLS)
-- ---------------------------------------------------------------------

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;

revoke insert, delete, truncate on public.profiles from authenticated;
revoke delete, truncate on public.clients, public.client_internal, public.agency_settings from authenticated;
revoke insert, delete, truncate on public.agency_settings from authenticated;
revoke insert, update, delete, truncate on public.audit_log from authenticated, service_role;

-- ---------------------------------------------------------------------
-- Registro de eventos feitos pela função de servidor (ex.: convite de
-- usuário, que acontece no Supabase Auth e não passa pela API de dados).
-- Só a chave de servidor executa; o autor vem do cabeçalho x-actor-id.
-- ---------------------------------------------------------------------
create or replace function public.log_admin_event(
  p_action text, p_entity text, p_entity_id text,
  p_client uuid default null, p_details jsonb default '{}'::jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := private.actor_id();
begin
  if not private.is_service_role() then
    raise exception 'Uso restrito à função de servidor.' using errcode = '42501';
  end if;
  insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, client_id, details)
  values (v_actor, (select p.email from public.profiles p where p.id = v_actor),
          p_action, p_entity, p_entity_id, p_client, coalesce(p_details, '{}'::jsonb));
end;
$$;
revoke all on function public.log_admin_event(text, text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.log_admin_event(text, text, text, uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------
-- Primeiro administrador
-- Rodar uma única vez no SQL Editor do Supabase, depois de criar o usuário:
--   select private.promote_to_admin('email@atratis.com.br');
-- ---------------------------------------------------------------------
create or replace function private.promote_to_admin(p_email text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.profiles where email = lower(btrim(p_email));
  if v_id is null then
    raise exception 'Nenhum usuário com o e-mail %. Crie o usuário em Authentication → Users antes.', p_email;
  end if;
  update public.profiles set role = 'admin', ativo = true where id = v_id;
  return 'OK: ' || lower(btrim(p_email)) || ' agora é administrador.';
end;
$$;
revoke all on function private.promote_to_admin(text) from public, authenticated, service_role;
