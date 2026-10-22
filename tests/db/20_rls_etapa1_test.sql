-- Testes de permissão da etapa 1. Conecta como "authenticator" (igual ao PostgREST).
\set ON_ERROR_STOP on
set client_min_messages = notice;

-- ===================================================================
\echo '— Visitante sem login (anon)'
-- ===================================================================
select tests.logout();
set role anon;
do $$ begin
  perform 1 from public.clients;
  raise exception 'FALHOU: anon leu clientes';
exception when insufficient_privilege then
  raise notice 'ok  anon não lê clientes';
end $$;
do $$ begin
  perform 1 from public.profiles;
  raise exception 'FALHOU: anon leu perfis';
exception when insufficient_privilege then
  raise notice 'ok  anon não lê perfis';
end $$;
reset role;

-- ===================================================================
\echo '— Perfis criados pelo cadastro no Auth'
-- ===================================================================
select tests.login('admin');
set role authenticated;
select tests.ok((select role from public.profiles where id = tests.id('cli_nortis')) = 'cliente',
  'usuário sem papel definido nasce como cliente');
select tests.ok((select role from public.profiles where id = tests.id('espertinho')) = 'cliente',
  'papel em user_metadata (editável pelo usuário) é ignorado');
select tests.ok((select email from public.profiles where id = tests.id('admin')) = 'thiago@atratis.com.br',
  'e-mail salvo em minúsculas');
select tests.ok((select nome from public.profiles where id = tests.id('cli_nortis')) = 'Aprovador Nortis',
  'nome vem do cadastro');
reset role;

-- ===================================================================
\echo '— Administrador'
-- ===================================================================
select tests.login('admin');
set role authenticated;
select tests.ok((select count(*) from public.clients) = 7, 'admin vê os 7 clientes, inclusive inativo');
select tests.ok((select count(*) from public.client_internal) = 2, 'admin vê observações internas');
select tests.ok((select count(*) from public.agency_settings) = 1, 'admin lê dados da agência');
select tests.ok((select cnpj from public.agency_settings) = '11647486000170', 'CNPJ da agência gravado');

insert into public.clients (nome_comercial, cnpj, uf, cep)
values ('Cliente Teste Admin', '04614281000123', 'CE', '60811341');
select tests.ok(exists (select 1 from public.clients where nome_comercial = 'Cliente Teste Admin'),
  'admin cadastra cliente');
select tests.ok((select created_by from public.clients where nome_comercial = 'Cliente Teste Admin') = tests.id('admin'),
  'cliente registra quem cadastrou');

update public.clients set razao_social = 'Nortis Energia LTDA' where id = tests.id('nortis');
select tests.ok(exists (
  select 1 from public.audit_log
  where entity = 'clients' and entity_id = tests.id('nortis')::text and action = 'cliente.alterado'
    and actor_id = tests.id('admin')
    and details -> 'alteracoes' -> 'razao_social' ->> 'para' = 'Nortis Energia LTDA'),
  'auditoria registra a alteração com autor e valor novo');

do $$ begin
  insert into public.clients (nome_comercial, cnpj) values ('CNPJ inválido', '123');
  raise exception 'FALHOU: aceitou CNPJ inválido';
exception when check_violation then raise notice 'ok  CNPJ com formato inválido é recusado';
end $$;

do $$ begin
  insert into public.clients (nome_comercial) values ('  nortis energia ');
  raise exception 'FALHOU: aceitou cliente duplicado';
exception when unique_violation then raise notice 'ok  nome comercial duplicado é recusado';
end $$;

update public.agency_settings set email = 'contato@atratis.com.br';
select tests.ok((select updated_by from public.agency_settings) = tests.id('admin'),
  'admin edita dados da agência e fica registrado');

do $$ begin
  insert into public.client_members (client_id, user_id)
  values (tests.id('nortis'), tests.id('equipe2'));
  raise exception 'FALHOU: vinculou usuário da equipe como aprovador';
exception when check_violation then raise notice 'ok  só perfil Cliente vira aprovador de empresa';
end $$;

do $$ begin
  insert into public.staff_client_access (user_id, client_id)
  values (tests.id('cli_nortis'), tests.id('dasart'));
  raise exception 'FALHOU: deu acesso de equipe a um cliente';
exception when check_violation then raise notice 'ok  acesso por cliente só para perfil Equipe';
end $$;

do $$ begin
  delete from public.audit_log;
  raise exception 'FALHOU: admin apagou auditoria';
exception when insufficient_privilege then raise notice 'ok  admin não apaga auditoria';
end $$;

do $$ begin
  update public.profiles set role = 'equipe' where id = tests.id('admin');
  raise exception 'FALHOU: rebaixou o único admin';
exception when raise_exception then raise notice 'ok  não deixa o sistema sem administrador';
end $$;

do $$ begin
  delete from public.clients where id = tests.id('dasart');
  raise exception 'FALHOU: apagou cliente';
exception when insufficient_privilege then raise notice 'ok  cliente não é apagado (só inativado)';
end $$;
reset role;

-- ===================================================================
\echo '— Equipe com acesso só à Nortis'
-- ===================================================================
select tests.login('equipe1');
set role authenticated;
select tests.ok((select count(*) from public.clients) = 1, 'equipe vê só o cliente autorizado');
select tests.ok((select id from public.clients) = tests.id('nortis'), 'o cliente visível é a Nortis');
select tests.ok((select count(*) from public.client_internal) = 1, 'vê observação interna só da Nortis');
select tests.ok((select count(*) from public.client_members) = 2, 'vê os usuários da Nortis');
select tests.ok((select count(*) from public.agency_settings) = 1, 'equipe lê dados da agência');
select tests.ok(not exists (select 1 from public.audit_log where client_id is distinct from tests.id('nortis')),
  'auditoria visível só da Nortis');

update public.client_internal set observacoes_internas = 'Atualizada pela equipe' where client_id = tests.id('nortis');
select tests.ok((select observacoes_internas from public.client_internal where client_id = tests.id('nortis')) = 'Atualizada pela equipe',
  'equipe edita observação interna do cliente autorizado');

do $$ begin
  insert into public.clients (nome_comercial) values ('Criado pela equipe');
  raise exception 'FALHOU: equipe criou cliente';
exception when insufficient_privilege then raise notice 'ok  equipe não cadastra cliente';
end $$;

update public.clients set nome_comercial = 'Hackeado' where id = tests.id('nortis');
update public.agency_settings set nome = 'Hackeado';
update public.client_internal set observacoes_internas = 'Hackeado' where client_id = tests.id('dasart');
reset role;
-- confere como admin
select tests.login('admin');
set role authenticated;
select tests.ok((select nome_comercial from public.clients where id = tests.id('nortis')) = 'Nortis Energia',
  'equipe não altera cadastro do cliente');
select tests.ok((select nome from public.agency_settings) = 'Atratis Digital', 'equipe não altera dados da agência');
select tests.ok((select observacoes_internas from public.client_internal where client_id = tests.id('dasart')) = 'Nota interna Dasart',
  'equipe não altera nota de cliente sem acesso');
reset role;
select tests.login('equipe1');
set role authenticated;

do $$ begin
  insert into public.client_members (client_id, user_id) values (tests.id('nortis'), tests.id('cli_dasart'));
  raise exception 'FALHOU: equipe vinculou aprovador';
exception when insufficient_privilege then raise notice 'ok  equipe não vincula aprovadores';
end $$;

do $$ begin
  update public.profiles set role = 'admin' where id = tests.id('equipe1');
  raise exception 'FALHOU: equipe se autopromoveu';
exception when insufficient_privilege then raise notice 'ok  equipe não muda o próprio papel';
end $$;
reset role;

-- ===================================================================
\echo '— Equipe sem nenhum cliente'
-- ===================================================================
select tests.login('equipe2');
set role authenticated;
select tests.ok((select count(*) from public.clients) = 0, 'equipe sem acesso não vê cliente nenhum');
select tests.ok((select count(*) from public.audit_log) = 0, 'nem auditoria');
reset role;

-- ===================================================================
\echo '— Cliente aprovador da Nortis'
-- ===================================================================
select tests.login('cli_nortis');
set role authenticated;
select tests.ok((select count(*) from public.clients) = 1, 'cliente vê só a própria empresa');
select tests.ok((select count(*) from public.clients where id = tests.id('dasart')) = 0,
  'buscar outra empresa pelo id não retorna nada');
select tests.ok((select count(*) from public.client_internal) = 0, 'cliente não vê observações internas');
select tests.ok((select count(*) from public.agency_settings) = 0, 'cliente não lê a tabela da agência');
select tests.ok((select count(*) from public.audit_log) = 0, 'cliente não lê a auditoria interna');
select tests.ok((select count(*) from public.profiles) = 1, 'cliente vê só o próprio perfil');
select tests.ok((select count(*) from public.client_members) = 1, 'cliente vê só o próprio vínculo');
select tests.ok((select count(*) from public.staff_client_access) = 0, 'cliente não vê acessos da equipe');
select tests.ok(private.can_approve(tests.id('nortis')), 'pode aprovar pela Nortis');
select tests.ok(not private.can_approve(tests.id('dasart')), 'não pode aprovar pela Dasart');

update public.profiles set nome = 'Aprovador Nortis (editado)' where id = tests.id('cli_nortis');
select tests.ok((select nome from public.profiles where id = tests.id('cli_nortis')) = 'Aprovador Nortis (editado)',
  'cliente edita o próprio nome');

do $$ begin
  update public.profiles set role = 'admin' where id = tests.id('cli_nortis');
  raise exception 'FALHOU: cliente virou admin';
exception when insufficient_privilege then raise notice 'ok  cliente não muda o próprio papel';
end $$;

do $$ begin
  update public.client_members set pode_aprovar = true where user_id = tests.id('cli_nortis');
  if found then raise exception 'FALHOU: cliente alterou o próprio vínculo'; end if;
  raise notice 'ok  cliente não altera o próprio vínculo';
end $$;

do $$ begin
  insert into public.client_members (client_id, user_id) values (tests.id('dasart'), tests.id('cli_nortis'));
  raise exception 'FALHOU: cliente se vinculou a outra empresa';
exception when insufficient_privilege then raise notice 'ok  cliente não se vincula a outra empresa';
end $$;

do $$ begin
  insert into public.client_internal (client_id, observacoes_internas) values (tests.id('nortis'), 'x');
  raise exception 'FALHOU: cliente escreveu nota interna';
exception when insufficient_privilege or unique_violation then raise notice 'ok  cliente não escreve nota interna';
end $$;

update public.clients set nome_comercial = 'Alterado pelo cliente' where id = tests.id('nortis');
reset role;
select tests.login('admin');
set role authenticated;
select tests.ok((select nome_comercial from public.clients where id = tests.id('nortis')) = 'Nortis Energia',
  'cliente não altera o cadastro da empresa');
reset role;

-- ===================================================================
\echo '— Cliente da Nortis sem permissão de aprovar'
-- ===================================================================
select tests.login('cli_nortis_leitor');
set role authenticated;
select tests.ok((select count(*) from public.clients) = 1, 'vê a própria empresa');
select tests.ok(not private.can_approve(tests.id('nortis')), 'mas não pode aprovar');
reset role;

-- ===================================================================
\echo '— Cliente de empresa inativa'
-- ===================================================================
select tests.login('cli_about');
set role authenticated;
select tests.ok((select count(*) from public.clients) = 0, 'empresa inativa some para o cliente');
select tests.ok(not private.can_approve(tests.id('about')), 'e ele não aprova nada');
reset role;

-- ===================================================================
\echo '— Função de servidor agindo em nome do admin'
-- ===================================================================
select tests.login_service('admin');
set role service_role;
update public.clients set telefone = '(85) 3216-7800' where id = tests.id('dasart');
reset role;
select tests.login('admin');
set role authenticated;
select tests.ok(exists (
  select 1 from public.audit_log
  where entity_id = tests.id('dasart')::text and action = 'cliente.alterado'
    and actor_id = tests.id('admin') and actor_email = 'thiago@atratis.com.br'),
  'auditoria atribui ao admin a ação feita pela função de servidor');

do $$ begin
  perform public.log_admin_event('usuario.convidado', 'profiles', 'x');
  raise exception 'FALHOU: usuário comum gravou evento de servidor';
exception when insufficient_privilege then raise notice 'ok  só a função de servidor registra eventos administrativos';
end $$;
reset role;

select tests.login_service('admin');
set role service_role;
select public.log_admin_event('usuario.convidado', 'profiles', tests.id('cli_nortis')::text, null, '{"perfil":"cliente"}');
reset role;
select tests.login('admin');
set role authenticated;
select tests.ok(exists (select 1 from public.audit_log where action = 'usuario.convidado' and actor_id = tests.id('admin')),
  'evento de convite registrado com o admin como autor');

-- ===================================================================
\echo '— Mudança de papel limpa vínculos'
-- ===================================================================
update public.profiles set role = 'equipe' where id = tests.id('cli_dasart');
select tests.ok(not exists (select 1 from public.client_members where user_id = tests.id('cli_dasart')),
  'ao virar Equipe, perde o vínculo de aprovador');
update public.profiles set ativo = false where id = tests.id('equipe1');
reset role;

select tests.login('equipe1');
set role authenticated;
select tests.ok((select count(*) from public.clients) = 0, 'usuário desativado deixa de ver clientes');
reset role;
select tests.logout();
