-- Mesmo o dono do banco não consegue reescrever a auditoria sem desligar gatilhos explicitamente.
\set ON_ERROR_STOP on
do $$ begin
  update public.audit_log set action = 'adulterado';
  raise exception 'FALHOU: superusuário alterou auditoria' using errcode = 'TF001';
exception when insufficient_privilege then raise notice 'ok  auditoria não aceita UPDATE';
end $$;
do $$ begin
  delete from public.audit_log;
  raise exception 'FALHOU: superusuário apagou auditoria' using errcode = 'TF001';
exception when insufficient_privilege then raise notice 'ok  auditoria não aceita DELETE';
end $$;
do $$ begin
  truncate public.audit_log;
  raise exception 'FALHOU: superusuário truncou auditoria' using errcode = 'TF001';
exception when insufficient_privilege then raise notice 'ok  auditoria não aceita TRUNCATE';
end $$;
select tests.ok((select count(*) from public.audit_log) > 10, 'auditoria acumulou os eventos dos testes');
select tests.ok(not exists (select 1 from public.audit_log where actor_id is null and action like 'cliente.alterado'
                            and occurred_at > now() - interval '1 minute' and entity_id = tests.id('nortis')::text
                            and details -> 'alteracoes' ? 'razao_social'),
  'alterações feitas por usuário nunca ficam sem autor');

-- Excluir um usuário no painel do Supabase não pode esbarrar na auditoria.
delete from auth.users where id = tests.id('cli_nortis_leitor');
select tests.ok(not exists (select 1 from public.profiles where id = tests.id('cli_nortis_leitor')),
  'usuário excluído no Auth some do sistema');
select tests.ok(exists (select 1 from public.audit_log where action = 'cliente.aprovador.removido'
                        and entity_id = tests.id('nortis')::text || ':' || tests.id('cli_nortis_leitor')::text),
  'a remoção do vínculo fica registrada no histórico');

-- P.I.: exclusão de quem emitiu só limpa o autor; qualquer outra mudança é barrada.
update public.insertion_orders set created_by = null where sequencia = 2;
select tests.ok((select created_by is null from public.insertion_orders where sequencia = 2),
  'excluir quem emitiu o P.I. não esbarra na proteção');
do $$ begin
  update public.insertion_orders set created_by = null, valor = 1 where sequencia = 3;
  raise exception 'FALHOU: alterou valor junto com o autor' using errcode = 'TF001';
exception when insufficient_privilege then raise notice 'ok  P.I. continua protegido contra outras mudanças';
end $$;

-- Versões enviadas: apagar o autor direto (sem excluir o usuário) é barrado.
do $$ begin
  update public.plan_versions set created_by = null where numero = 1 and plan_id = '50000000-0000-0000-0000-000000000001';
  raise exception 'FALHOU: apagou o autor da versão do plano direto' using errcode = 'TF001';
exception when insufficient_privilege then raise notice 'ok  autor de versão de plano enviada não é apagado direto';
end $$;
do $$ begin
  update public.budget_versions set created_by = null where status <> 'rascunho';
  raise exception 'FALHOU: apagou o autor da versão do orçamento direto' using errcode = 'TF001';
exception when insufficient_privilege then raise notice 'ok  autor de versão de orçamento enviada não é apagado direto';
end $$;

-- Membro da equipe que sai da agência: excluir no Auth não pode esbarrar
-- em nenhuma proteção (orçamentos, P.I., planos, criativos).
delete from auth.users where id = tests.id('equipe1');
select tests.ok(not exists (select 1 from public.profiles where id = tests.id('equipe1')),
  'membro da equipe que criou orçamentos, P.I. e planos pode ser excluído');
select tests.ok((select bool_and(created_by is null) from public.plan_versions), 'e o autor das versões do plano fica vazio');
