-- Testes da etapa 3: orçamentos. Conecta como "authenticator".
\set ON_ERROR_STOP on
set client_min_messages = notice;

select tests.login('admin');
set role authenticated;
update public.profiles set ativo = true where id = tests.id('equipe1');
reset role;

-- ===================================================================
\echo '— Equipe monta o orçamento (rascunho)'
-- ===================================================================
select tests.login('equipe1');
set role authenticated;

insert into public.budgets (id, client_id, mes_referencia, status, enviado_em, instrucoes_cliente)
values ('20000000-0000-0000-0000-000000000001', tests.id('nortis'), '2026-11-01', 'aprovado', now(), 'Verba de novembro.');
select tests.ok((select status from public.budgets where id = '20000000-0000-0000-0000-000000000001') = 'rascunho',
  'orçamento nasce como rascunho mesmo se tentarem outro status');
select tests.ok((select enviado_em from public.budgets where id = '20000000-0000-0000-0000-000000000001') is null,
  'data de envio não pode ser preenchida à mão');
select tests.ok((select count(*) from public.budget_versions where budget_id = '20000000-0000-0000-0000-000000000001'
                 and numero = 1 and status = 'rascunho') = 1,
  'orçamento nasce com a versão 1 em rascunho');

do $$ begin
  insert into public.budgets (client_id, mes_referencia) values (tests.id('nortis'), '2026-11-15');
  raise exception 'FALHOU: aceitou mês de referência fora do dia 1';
exception when check_violation then raise notice 'ok  mês de referência é sempre o dia 1';
end $$;

do $$ begin
  insert into public.budgets (client_id, mes_referencia) values (tests.id('dasart'), '2026-11-01');
  raise exception 'FALHOU: criou orçamento de cliente sem acesso';
exception when insufficient_privilege then raise notice 'ok  equipe não cria orçamento de cliente sem acesso';
end $$;

do $$ begin
  update public.budgets set client_id = tests.id('dasart') where id = '20000000-0000-0000-0000-000000000001';
  raise exception 'FALHOU: trocou o cliente do orçamento';
exception when insufficient_privilege then raise notice 'ok  cliente do orçamento não muda';
end $$;

do $$ begin
  insert into public.budget_versions (budget_id, numero) values ('20000000-0000-0000-0000-000000000001', 2);
  raise exception 'FALHOU: criou versão direto na tabela';
exception when insufficient_privilege then raise notice 'ok  versão nova só pela função de fluxo';
end $$;

insert into public.budget_internal (budget_id, observacoes_internas)
values ('20000000-0000-0000-0000-000000000001', 'Cliente costuma cortar Google');

insert into public.budget_lines (id, version_id, plataforma, descricao, valor, aliquota, ordem)
select '20000000-0000-0000-0000-0000000000a1', v.id, ' Meta Ads ', 'Leads', 1100.00, 0, 1
  from public.budget_versions v where v.budget_id = '20000000-0000-0000-0000-000000000001';
insert into public.budget_lines (id, version_id, plataforma, descricao, valor, aliquota, ordem)
select '20000000-0000-0000-0000-0000000000a2', v.id, 'Google Ads', null, 500.00, 0.5, 2
  from public.budget_versions v where v.budget_id = '20000000-0000-0000-0000-000000000001';

select tests.ok((select aliquota = 0.1215 and imposto = 119.17 and verba = 980.83 and plataforma = 'Meta Ads'
                 from public.budget_lines where id = '20000000-0000-0000-0000-0000000000a1'),
  'Meta Ads: boleto de R$ 1.100,00 = R$ 980,83 para anúncios + R$ 119,17 de imposto');
select tests.ok((select aliquota = 0 and imposto = 0 and verba = 500.00
                 from public.budget_lines where id = '20000000-0000-0000-0000-0000000000a2'),
  'outras plataformas não têm imposto, mesmo se tentarem informar alíquota');

do $$ begin
  insert into public.budget_lines (version_id, plataforma, valor)
  select v.id, 'TikTok Ads', 0 from public.budget_versions v where v.budget_id = '20000000-0000-0000-0000-000000000001';
  raise exception 'FALHOU: aceitou linha com valor zero';
exception when check_violation then raise notice 'ok  linha precisa de valor maior que zero';
end $$;

do $$ begin
  update public.budgets set status = 'aprovado' where id = '20000000-0000-0000-0000-000000000001';
  raise exception 'FALHOU: equipe mudou status direto';
exception when insufficient_privilege then raise notice 'ok  status não muda direto na tabela';
end $$;
reset role;

-- ===================================================================
\echo '— Rascunho é invisível para o cliente e para quem não tem acesso'
-- ===================================================================
select tests.login('cli_nortis');
set role authenticated;
select tests.ok((select count(*) from public.budgets) = 0, 'cliente não vê orçamento em rascunho');
select tests.ok((select count(*) from public.budget_lines) = 0, 'cliente não vê linhas do rascunho');
select tests.ok((select count(*) from public.budget_internal) = 0, 'cliente não vê observações internas');
do $$ begin
  perform public.enviar_orcamento('20000000-0000-0000-0000-000000000001');
  raise exception 'FALHOU: cliente enviou orçamento';
exception when insufficient_privilege then raise notice 'ok  cliente não envia orçamento';
end $$;
reset role;

select tests.login('equipe2');
set role authenticated;
select tests.ok((select count(*) from public.budgets) = 0, 'equipe sem acesso ao cliente não vê o orçamento');
do $$ begin
  perform public.enviar_orcamento('20000000-0000-0000-0000-000000000001');
  raise exception 'FALHOU: equipe sem acesso enviou';
exception when insufficient_privilege then raise notice 'ok  equipe sem acesso não envia';
end $$;
reset role;

-- ===================================================================
\echo '— Envio e decisão do cliente'
-- ===================================================================
select tests.login('equipe1');
set role authenticated;
select tests.ok(public.enviar_orcamento('20000000-0000-0000-0000-000000000001') = 'aguardando_aprovacao',
  'envio deixa o orçamento aguardando aprovação');
select tests.ok((select status = 'pendente' and enviado_em is not null from public.budget_versions
                 where budget_id = '20000000-0000-0000-0000-000000000001' and numero = 1),
  'versão enviada fica pendente com data de envio');

do $$ begin
  update public.budget_lines set valor = 900 where id = '20000000-0000-0000-0000-0000000000a1';
  raise exception 'FALHOU: alterou valor de versão enviada';
exception when insufficient_privilege then raise notice 'ok  valor de versão enviada não muda';
end $$;
do $$ begin
  delete from public.budget_lines where id = '20000000-0000-0000-0000-0000000000a2';
  raise exception 'FALHOU: apagou linha de versão enviada';
exception when insufficient_privilege then raise notice 'ok  linha de versão enviada não é apagada';
end $$;
do $$ begin
  perform public.enviar_orcamento('20000000-0000-0000-0000-000000000001');
  raise exception 'FALHOU: reenviou sem versão nova';
exception when raise_exception then raise notice 'ok  não reenvia a mesma versão';
end $$;
reset role;

select tests.login('cli_dasart');
set role authenticated;
select tests.ok((select count(*) from public.budgets) = 0, 'cliente de outra empresa não vê o orçamento');
do $$ begin
  perform public.decidir_orcamento('20000000-0000-0000-0000-000000000001', 'aprovado');
  raise exception 'FALHOU: outra empresa aprovou';
exception when insufficient_privilege then raise notice 'ok  outra empresa não aprova';
end $$;
reset role;

select tests.login('cli_nortis_leitor');
set role authenticated;
select tests.ok((select count(*) from public.budget_lines) = 2, 'visualizador vê as linhas enviadas');
do $$ begin
  perform public.decidir_orcamento('20000000-0000-0000-0000-000000000001', 'aprovado');
  raise exception 'FALHOU: visualizador aprovou';
exception when insufficient_privilege then raise notice 'ok  visualizador não aprova';
end $$;
reset role;

select tests.login('cli_nortis');
set role authenticated;
select public.registrar_visualizacao_orcamento('20000000-0000-0000-0000-000000000001');
select tests.ok((select status from public.budgets where id = '20000000-0000-0000-0000-000000000001') = 'em_analise',
  'quando o cliente abre, o orçamento fica em análise');
select tests.ok((select count(*) from public.budget_internal) = 0, 'cliente continua sem ver observações internas');
do $$ begin
  update public.budget_lines set valor = 1 where id = '20000000-0000-0000-0000-0000000000a1';
  if exists (select 1 from public.budget_lines where valor = 1) then
    raise exception 'FALHOU: cliente alterou valor';
  end if;
  raise notice 'ok  cliente não altera valores';
exception when insufficient_privilege then raise notice 'ok  cliente não altera valores';
end $$;
do $$ begin
  perform public.decidir_orcamento('20000000-0000-0000-0000-000000000001', 'alteracoes_solicitadas', '');
  raise exception 'FALHOU: pediu alteração sem comentário';
exception when raise_exception then raise notice 'ok  pedido de alteração exige comentário';
end $$;
select tests.ok(public.decidir_orcamento('20000000-0000-0000-0000-000000000001', 'alteracoes_solicitadas',
                'Reduzir Google para R$ 300') = 'alteracoes_solicitadas',
  'cliente pede alteração');
select tests.ok((select total = 1600.00 and comentario = 'Reduzir Google para R$ 300' from public.budget_approvals
                 where budget_id = '20000000-0000-0000-0000-000000000001'),
  'decisão guarda o total da versão e o comentário');
do $$ begin
  perform public.decidir_orcamento('20000000-0000-0000-0000-000000000001', 'aprovado');
  raise exception 'FALHOU: decidiu duas vezes';
exception when raise_exception then raise notice 'ok  não decide de novo a mesma versão';
end $$;
do $$ begin
  delete from public.budget_approvals;
  if exists (select 1 from public.budget_approvals) then raise notice 'ok  decisão não é apagada'; end if;
exception when insufficient_privilege then raise notice 'ok  decisão não é apagada';
end $$;
reset role;

-- ===================================================================
\echo '— Versão nova e aprovação'
-- ===================================================================
select tests.login('equipe1');
set role authenticated;
select tests.ok(public.nova_versao_orcamento('20000000-0000-0000-0000-000000000001', 'Google reduzido') is not null,
  'equipe cria versão nova');
select tests.ok((select status from public.budgets where id = '20000000-0000-0000-0000-000000000001') = 'em_revisao_interna',
  'orçamento volta para revisão interna');
select tests.ok((select count(*) from public.budget_lines l join public.budget_versions v on v.id = l.version_id
                 where v.budget_id = '20000000-0000-0000-0000-000000000001' and v.numero = 2) = 2,
  'versão nova começa com as linhas da anterior');
do $$ begin
  perform public.nova_versao_orcamento('20000000-0000-0000-0000-000000000001');
  raise exception 'FALHOU: criou segundo rascunho';
exception when raise_exception then raise notice 'ok  só um rascunho por vez';
end $$;
update public.budget_lines l set valor = 300
  from public.budget_versions v
 where v.id = l.version_id and v.budget_id = '20000000-0000-0000-0000-000000000001' and v.numero = 2
   and l.plataforma = 'Google Ads';
select tests.ok((select valor from public.budget_lines where id = '20000000-0000-0000-0000-0000000000a2') = 500,
  'versão anterior continua com o valor original');
select public.enviar_orcamento('20000000-0000-0000-0000-000000000001');
reset role;

select tests.login('cli_nortis');
set role authenticated;
select tests.ok((select count(*) from public.budget_versions) = 2, 'cliente vê as duas versões enviadas');
select tests.ok(public.decidir_orcamento('20000000-0000-0000-0000-000000000001', 'aprovado') = 'aprovado',
  'cliente aprova a versão 2');
select tests.ok((select total from public.budget_approvals where decisao = 'aprovado') = 1400.00,
  'aprovação registra o total de R$ 1.400,00');
reset role;

-- ===================================================================
\echo '— Mudança depois de aprovado e substituição'
-- ===================================================================
select tests.login('equipe1');
set role authenticated;
select public.nova_versao_orcamento('20000000-0000-0000-0000-000000000001', 'Incluir TikTok');
select tests.ok((select status from public.budget_versions
                 where budget_id = '20000000-0000-0000-0000-000000000001' and numero = 2) = 'aprovado',
  'versão aprovada continua aprovada no histórico');
select public.enviar_orcamento('20000000-0000-0000-0000-000000000001');
select public.nova_versao_orcamento('20000000-0000-0000-0000-000000000001', 'Corrigir valor');
select tests.ok((select status from public.budget_versions
                 where budget_id = '20000000-0000-0000-0000-000000000001' and numero = 3) = 'substituida',
  'versão enviada e trocada antes da decisão fica substituída');
select public.cancelar_orcamento('20000000-0000-0000-0000-000000000001', 'Cliente pausou a mídia');
select tests.ok((select status from public.budgets where id = '20000000-0000-0000-0000-000000000001') = 'cancelado',
  'orçamento cancelado');
do $$ begin
  insert into public.budget_lines (version_id, plataforma, valor)
  select v.id, 'Meta Ads', 10 from public.budget_versions v
   where v.budget_id = '20000000-0000-0000-0000-000000000001' and v.numero = 4;
  raise exception 'FALHOU: incluiu linha em orçamento cancelado';
exception when insufficient_privilege then raise notice 'ok  orçamento cancelado não muda';
end $$;
reset role;

select tests.login('cli_nortis');
set role authenticated;
do $$ begin
  perform public.decidir_orcamento('20000000-0000-0000-0000-000000000001', 'aprovado');
  raise exception 'FALHOU: aprovou orçamento cancelado';
exception when raise_exception then raise notice 'ok  orçamento cancelado não é aprovado';
end $$;
reset role;

-- ===================================================================
\echo '— Histórico'
-- ===================================================================
select tests.login('admin');
set role authenticated;
select tests.ok((select count(*) from public.audit_log where action = 'orcamento.decisao.criado'
                 and actor_id = tests.id('cli_nortis') and client_id = tests.id('nortis')) = 2,
  'cada decisão do cliente fica no histórico com autor e cliente');
select tests.ok(exists (select 1 from public.audit_log where action = 'orcamento.linha.alterado'
                        and actor_id = tests.id('equipe1') and client_id = tests.id('nortis')),
  'mudança de valor fica no histórico');
select tests.ok(exists (select 1 from public.audit_log where action = 'orcamento.alterado'
                        and details -> 'alteracoes' -> 'status' ->> 'para' = 'cancelado'),
  'o cancelamento fica no histórico');
reset role;
select tests.logout();
