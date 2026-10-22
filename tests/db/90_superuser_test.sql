-- Mesmo o dono do banco não consegue reescrever a auditoria sem desligar gatilhos explicitamente.
\set ON_ERROR_STOP on
do $$ begin
  update public.audit_log set action = 'adulterado';
  raise exception 'FALHOU: superusuário alterou auditoria';
exception when insufficient_privilege then raise notice 'ok  auditoria não aceita UPDATE';
end $$;
do $$ begin
  delete from public.audit_log;
  raise exception 'FALHOU: superusuário apagou auditoria';
exception when insufficient_privilege then raise notice 'ok  auditoria não aceita DELETE';
end $$;
do $$ begin
  truncate public.audit_log;
  raise exception 'FALHOU: superusuário truncou auditoria';
exception when insufficient_privilege then raise notice 'ok  auditoria não aceita TRUNCATE';
end $$;
select tests.ok((select count(*) from public.audit_log) > 10, 'auditoria acumulou os eventos dos testes');
select tests.ok(not exists (select 1 from public.audit_log where actor_id is null and action like 'cliente.alterado'
                            and occurred_at > now() - interval '1 minute' and entity_id = tests.id('nortis')::text
                            and details -> 'alteracoes' ? 'razao_social'),
  'alterações feitas por usuário nunca ficam sem autor');
