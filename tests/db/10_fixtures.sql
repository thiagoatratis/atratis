-- Dados de teste (rodados como superusuário). Nunca aplicar no projeto real.
create schema if not exists tests;
create table tests.ids (k text primary key, id uuid not null);

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000a001', 'Thiago@Atratis.com.br', '{"role":"admin"}',   '{"nome":"Thiago"}'),
  ('00000000-0000-0000-0000-00000000e001', 'equipe1@atratis.com.br', '{"role":"equipe"}', '{"nome":"Equipe Um"}'),
  ('00000000-0000-0000-0000-00000000e002', 'equipe2@atratis.com.br', '{"role":"equipe"}', '{"nome":"Equipe Dois"}'),
  ('00000000-0000-0000-0000-00000000c001', 'aprovador@nortis.com.br', '{}',               '{"nome":"Aprovador Nortis"}'),
  ('00000000-0000-0000-0000-00000000c002', 'aprovador@dasart.com.br', '{"role":"cliente"}', '{}'),
  ('00000000-0000-0000-0000-00000000c003', 'leitor@nortis.com.br',    '{"role":"cliente"}', '{}'),
  ('00000000-0000-0000-0000-00000000c004', 'contato@about.com.br',    '{"role":"cliente"}', '{}'),
  -- tentativa de se autopromover via metadata do usuário: deve virar "cliente"
  ('00000000-0000-0000-0000-00000000c005', 'espertinho@exemplo.com',  '{}',               '{"role":"admin"}');

insert into tests.ids (k, id) values
  ('admin',   '00000000-0000-0000-0000-00000000a001'),
  ('equipe1', '00000000-0000-0000-0000-00000000e001'),
  ('equipe2', '00000000-0000-0000-0000-00000000e002'),
  ('cli_nortis', '00000000-0000-0000-0000-00000000c001'),
  ('cli_dasart', '00000000-0000-0000-0000-00000000c002'),
  ('cli_nortis_leitor', '00000000-0000-0000-0000-00000000c003'),
  ('cli_about', '00000000-0000-0000-0000-00000000c004'),
  ('espertinho', '00000000-0000-0000-0000-00000000c005');

insert into tests.ids (k, id)
select 'nortis', id from public.clients where nome_comercial = 'Nortis Energia'
union all select 'dasart', id from public.clients where nome_comercial = 'Dasart Engenharia'
union all select 'about', id from public.clients where nome_comercial = 'About Brasil';

insert into public.staff_client_access (user_id, client_id)
select (select id from tests.ids where k = 'equipe1'), (select id from tests.ids where k = 'nortis');

insert into public.client_members (client_id, user_id, pode_aprovar) values
  ((select id from tests.ids where k = 'nortis'), (select id from tests.ids where k = 'cli_nortis'), true),
  ((select id from tests.ids where k = 'dasart'), (select id from tests.ids where k = 'cli_dasart'), true),
  ((select id from tests.ids where k = 'nortis'), (select id from tests.ids where k = 'cli_nortis_leitor'), false),
  ((select id from tests.ids where k = 'about'),  (select id from tests.ids where k = 'cli_about'), true);

update public.clients set ativo = false where id = (select id from tests.ids where k = 'about');

insert into public.client_internal (client_id, observacoes_internas) values
  ((select id from tests.ids where k = 'nortis'), 'Nota interna Nortis'),
  ((select id from tests.ids where k = 'dasart'), 'Nota interna Dasart');

-- Utilitários de teste
create or replace function tests.ok(cond boolean, msg text) returns void
language plpgsql as $$
begin
  if not coalesce(cond, false) then
    raise exception 'FALHOU: %', msg;
  end if;
  raise notice 'ok  %', msg;
end;
$$;

create or replace function tests.id(p_k text) returns uuid
language sql stable as $$ select id from tests.ids where k = p_k $$;

create or replace function tests.login(p_k text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', tests.id(p_k), 'role', 'authenticated')::text, false);
  perform set_config('request.headers', '', false);
end;
$$;

create or replace function tests.login_service(p_actor_k text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  perform set_config('request.headers',
    json_build_object('x-actor-id', tests.id(p_actor_k))::text, false);
end;
$$;

create or replace function tests.logout() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', false);
  perform set_config('request.headers', '', false);
end;
$$;

grant usage on schema tests to anon, authenticated, service_role, authenticator;
grant select on tests.ids to anon, authenticated, service_role, authenticator;
grant execute on all functions in schema tests to anon, authenticated, service_role, authenticator;
