-- Orçamento editável depois de enviado, com histórico (migration 011). Conecta como "authenticator".
\set ON_ERROR_STOP on
set client_min_messages = notice;

select tests.login('admin');
set role authenticated;
update public.profiles set ativo = true where id = tests.id('equipe1');
reset role;

select tests.login('equipe1');
set role authenticated;
insert into public.budgets (id, client_id, mes_referencia) values ('70000000-0000-0000-0000-000000000001', tests.id('nortis'), '2027-01-01');
insert into public.budget_lines (id, version_id, plataforma, descricao, valor, ordem)
select x.id, v.id, x.p, x.d, x.valor, x.o from public.budget_versions v,
  (values ('70000000-0000-0000-0000-0000000000a1'::uuid, 'Meta Ads', 'Leads', 1100.00, 1),
          ('70000000-0000-0000-0000-0000000000a2'::uuid, 'Google Ads', 'Pesquisa', 500.00, 2)) as x (id, p, d, valor, o)
 where v.budget_id = '70000000-0000-0000-0000-000000000001';
update public.budget_lines set valor = 1200 where id = '70000000-0000-0000-0000-0000000000a1';
select tests.ok((select count(*) = 0 from public.budget_changes), 'mudanças no rascunho não entram no histórico');
select public.enviar_orcamento('70000000-0000-0000-0000-000000000001');

-- ===================================================================
\echo '— Com o cliente: equipe edita e o histórico registra'
-- ===================================================================
update public.budget_lines set valor = 1100 where id = '70000000-0000-0000-0000-0000000000a1';
insert into public.budget_lines (id, version_id, plataforma, valor, ordem)
select '70000000-0000-0000-0000-0000000000a3', v.id, 'LinkedIn Ads', 300, 3
  from public.budget_versions v where v.budget_id = '70000000-0000-0000-0000-000000000001';
update public.budget_lines set ordem = 9 where id = '70000000-0000-0000-0000-0000000000a3';
delete from public.budget_lines where id = '70000000-0000-0000-0000-0000000000a2';
select tests.ok((select string_agg(acao || ':' || plataforma || ':' || coalesce(valor_antes::text, '-') || '>' || coalesce(valor_depois::text, '-')
                                   || ':' || status_orcamento, ' ' order by id) from public.budget_changes)
                = 'alterada:Meta Ads:1200.00>1100.00:aguardando_aprovacao incluida:LinkedIn Ads:->300.00:aguardando_aprovacao removida:Google Ads:500.00>-:aguardando_aprovacao',
  'histórico registra alteração, inclusão e remoção com valores e situação (mudar só a ordem não entra)');
select tests.ok((select bool_and(user_nome = 'Equipe Um') from public.budget_changes), 'histórico registra quem mudou');
do $$ begin
  delete from public.budget_lines where version_id = (select id from public.budget_versions where budget_id = '70000000-0000-0000-0000-000000000001');
  raise exception 'FALHOU: apagou todas as linhas do orçamento enviado' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  orçamento enviado mantém pelo menos uma linha';
end $$;
do $$ begin
  insert into public.budget_changes (budget_id, version_id, client_id, acao, plataforma, status_orcamento)
  select b.id, v.id, b.client_id, 'alterada', 'Forjada', 'aprovado'
    from public.budgets b join public.budget_versions v on v.budget_id = b.id where b.id = '70000000-0000-0000-0000-000000000001';
  raise exception 'FALHOU: equipe escreveu no histórico direto' using errcode = 'TF001';
exception when insufficient_privilege then raise notice 'ok  histórico só é escrito pelo sistema';
end $$;
reset role;

select tests.login('cli_nortis');
set role authenticated;
select tests.ok((select count(*) = 3 from public.budget_changes where budget_id = '70000000-0000-0000-0000-000000000001'),
  'cliente vê o histórico do orçamento');
do $$ begin
  update public.budget_lines set valor = 1 where id = '70000000-0000-0000-0000-0000000000a1';
  if exists (select 1 from public.budget_lines where id = '70000000-0000-0000-0000-0000000000a1' and valor = 1) then
    raise exception 'FALHOU: cliente alterou valor' using errcode = 'TF001';
  end if;
  raise notice 'ok  cliente continua sem alterar valores';
exception when insufficient_privilege then raise notice 'ok  cliente continua sem alterar valores';
end $$;
do $$ begin
  update public.budget_changes set valor_depois = 1;
  if exists (select 1 from public.budget_changes where valor_depois = 1) then
    raise exception 'FALHOU: cliente alterou histórico' using errcode = 'TF001';
  end if;
  raise notice 'ok  histórico não é alterado';
exception when insufficient_privilege then raise notice 'ok  histórico não é alterado';
end $$;
-- Pede alteração; a equipe ajusta o mesmo orçamento e reenvia.
select public.decidir_orcamento('70000000-0000-0000-0000-000000000001', 'alteracoes_solicitadas', 'Subir o LinkedIn');
reset role;

select tests.login('cli_dasart');
set role authenticated;
select tests.ok((select count(*) = 0 from public.budget_changes), 'outra empresa não vê o histórico');
reset role;

select tests.login('equipe2');
set role authenticated;
select tests.ok((select count(*) = 0 from public.budget_changes), 'equipe sem acesso ao cliente não vê o histórico');
reset role;

-- ===================================================================
\echo '— Ajuste pedido: edita e reenvia o mesmo orçamento'
-- ===================================================================
select tests.login('equipe1');
set role authenticated;
update public.budget_lines set valor = 400 where id = '70000000-0000-0000-0000-0000000000a3';
select tests.ok((select status_orcamento = 'alteracoes_solicitadas' from public.budget_changes order by id desc limit 1),
  'mudança depois do pedido de alteração fica registrada');
select tests.ok(public.enviar_orcamento('70000000-0000-0000-0000-000000000001') = 'aguardando_aprovacao',
  'reenvio do mesmo orçamento depois do pedido de alteração');
select tests.ok((select count(*) = 1 and bool_and(status = 'pendente' and decidido_em is null) from public.budget_versions
                 where budget_id = '70000000-0000-0000-0000-000000000001'),
  'continua na versão 1, de novo aguardando o cliente');
reset role;

select tests.login('cli_nortis');
set role authenticated;
select tests.ok(public.decidir_orcamento('70000000-0000-0000-0000-000000000001', 'aprovado') = 'aprovado', 'cliente aprova');
select tests.ok((select total = 1500.00 from public.budget_approvals where budget_id = '70000000-0000-0000-0000-000000000001' and decisao = 'aprovado'),
  'aprovação guarda o total do momento (R$ 1.500,00)');
select tests.ok((select count(*) = 2 from public.budget_approvals where budget_id = '70000000-0000-0000-0000-000000000001'),
  'as duas decisões ficam registradas');
reset role;

-- ===================================================================
\echo '— Depois de aprovado: continua aprovado'
-- ===================================================================
select tests.login('equipe1');
set role authenticated;
update public.budget_lines set valor = 1150 where id = '70000000-0000-0000-0000-0000000000a1';
select tests.ok((select status = 'aprovado' from public.budgets where id = '70000000-0000-0000-0000-000000000001'),
  'mudar valor de orçamento aprovado não tira a aprovação');
select tests.ok((select status_orcamento = 'aprovado' and valor_antes = 1100 and valor_depois = 1150
                 from public.budget_changes order by id desc limit 1),
  'histórico mostra que mudou depois da aprovação');
do $$ begin
  perform public.enviar_orcamento('70000000-0000-0000-0000-000000000001');
  raise exception 'FALHOU: reenviou orçamento aprovado' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  orçamento aprovado não é reenviado';
end $$;

-- Versão nova: a anterior fica congelada.
select public.nova_versao_orcamento('70000000-0000-0000-0000-000000000001', 'Teste');
do $$ begin
  update public.budget_lines set valor = 10 where id = '70000000-0000-0000-0000-0000000000a1';
  raise exception 'FALHOU: alterou versão substituída' using errcode = 'TF001';
exception when insufficient_privilege then raise notice 'ok  versão anterior fica congelada';
end $$;
reset role;
