-- Aprovação em reunião (migration 012). Conecta como "authenticator".
\set ON_ERROR_STOP on
set client_min_messages = notice;

select tests.login('admin');
set role authenticated;
update public.profiles set ativo = true where id = tests.id('equipe1');
reset role;

-- ===================================================================
\echo '— Orçamento em rascunho aprovado em reunião'
-- ===================================================================
select tests.login('equipe1');
set role authenticated;
insert into public.budgets (id, client_id, mes_referencia) values ('80000000-0000-0000-0000-000000000001', tests.id('nortis'), '2027-02-01');
insert into public.budget_lines (version_id, plataforma, valor)
select v.id, 'Meta Ads', 1100 from public.budget_versions v where v.budget_id = '80000000-0000-0000-0000-000000000001';
do $$ begin
  perform public.aprovar_orcamento_em_reuniao('80000000-0000-0000-0000-000000000001', now() + interval '2 days', 'Maria');
  raise exception 'FALHOU: aceitou reunião no futuro' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  reunião não pode estar no futuro';
end $$;
do $$ begin
  perform public.aprovar_orcamento_em_reuniao('80000000-0000-0000-0000-000000000001', now() - interval '1 hour', ' ');
  raise exception 'FALHOU: aceitou sem dizer quem aprovou' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  precisa dizer quem aprovou pelo cliente';
end $$;
select tests.ok(public.aprovar_orcamento_em_reuniao('80000000-0000-0000-0000-000000000001', '2026-10-29 15:00-03',
                'Maria (diretora)', 'Reunião de alinhamento pelo Meet') = 'aprovado',
  'orçamento em rascunho é enviado e aprovado em reunião');
select tests.ok((select via = 'reuniao' and aprovado_por_cliente = 'Maria (diretora)' and reuniao_em = '2026-10-29 15:00-03'
                        and user_nome = 'Equipe Um' and total = 1100 and observacao_reuniao = 'Reunião de alinhamento pelo Meet'
                 from public.budget_approvals where budget_id = '80000000-0000-0000-0000-000000000001'),
  'decisão guarda reunião, quem aprovou, quem registrou, total e observação');
select tests.ok((select enviado_em is not null and status = 'aprovado' from public.budgets where id = '80000000-0000-0000-0000-000000000001'),
  'orçamento fica enviado e aprovado');
do $$ begin
  perform public.aprovar_orcamento_em_reuniao('80000000-0000-0000-0000-000000000001', now(), 'Maria');
  raise exception 'FALHOU: aprovou duas vezes' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  não aprova de novo o que já está aprovado';
end $$;
-- P.I. sai normalmente de orçamento aprovado em reunião.
select tests.ok((select count(*) = 1 from public.emitir_pis('80000000-0000-0000-0000-000000000001', false,
  '{"campanha":"Teste","periodo":"01/02/2027 a 28/02/2027","prazo_pagamento":"Data do vencimento do boleto","faturamento":"bruto","entrega_fatura":"cliente"}'::jsonb)),
  'P.I. é emitido a partir do orçamento aprovado em reunião');
reset role;

select tests.login('cli_nortis');
set role authenticated;
select tests.ok((select via = 'reuniao' from public.budget_approvals where budget_id = '80000000-0000-0000-0000-000000000001'),
  'cliente vê que foi aprovado em reunião');
do $$ begin
  perform public.aprovar_orcamento_em_reuniao('80000000-0000-0000-0000-000000000001', now(), 'Eu');
  raise exception 'FALHOU: cliente registrou reunião' using errcode = 'TF001';
exception when insufficient_privilege then raise notice 'ok  só a equipe registra aprovação em reunião';
end $$;
reset role;

select tests.login('equipe2');
set role authenticated;
do $$ begin
  perform public.aprovar_orcamento_em_reuniao('80000000-0000-0000-0000-000000000001', now(), 'Maria');
  raise exception 'FALHOU: equipe sem acesso registrou' using errcode = 'TF001';
exception when insufficient_privilege then raise notice 'ok  equipe sem acesso ao cliente não registra';
end $$;
reset role;

-- ===================================================================
\echo '— Orçamento com alteração pedida aprovado em reunião'
-- ===================================================================
select tests.login('equipe1');
set role authenticated;
insert into public.budgets (id, client_id, mes_referencia) values ('80000000-0000-0000-0000-000000000002', tests.id('nortis'), '2027-03-01');
insert into public.budget_lines (version_id, plataforma, valor)
select v.id, 'Google Ads', 500 from public.budget_versions v where v.budget_id = '80000000-0000-0000-0000-000000000002';
select public.enviar_orcamento('80000000-0000-0000-0000-000000000002');
reset role;
select tests.login('cli_nortis');
set role authenticated;
select public.decidir_orcamento('80000000-0000-0000-0000-000000000002', 'alteracoes_solicitadas', 'Vamos conversar');
reset role;
select tests.login('equipe1');
set role authenticated;
select tests.ok(public.aprovar_orcamento_em_reuniao('80000000-0000-0000-0000-000000000002', now() - interval '10 minutes', 'João') = 'aprovado',
  'depois do pedido de alteração, a aprovação em reunião vale');
reset role;

-- ===================================================================
\echo '— Plano aprovado em reunião'
-- ===================================================================
select tests.login('equipe1');
set role authenticated;
insert into public.plans (id, client_id, titulo) values ('80000000-0000-0000-0000-0000000000a1', tests.id('nortis'), 'Plano reunião');
select public.definir_link_plano(v.id, 'https://atratis.com.br/uteis/nortis/plano-reuniao/', 4)
  from public.plan_versions v where v.plan_id = '80000000-0000-0000-0000-0000000000a1';
select public.salvar_secoes_plano(v.id, '[{"nome":"Capa","pagina_inicio":1,"pagina_fim":1,"requer_aprovacao":false},{"nome":"Objetivos","pagina_inicio":2,"pagina_fim":3},{"nome":"Personas","pagina_inicio":4,"pagina_fim":4}]')
  from public.plan_versions v where v.plan_id = '80000000-0000-0000-0000-0000000000a1';
select public.enviar_plano('80000000-0000-0000-0000-0000000000a1');
reset role;
select tests.login('cli_nortis');
set role authenticated;
select public.decidir_secao_plano(s.id, 'ajuste_solicitado', 'Rever personas') from public.plan_sections s
  join public.plan_versions v on v.id = s.version_id where v.plan_id = '80000000-0000-0000-0000-0000000000a1' and s.nome = 'Personas';
reset role;
select tests.login('equipe1');
set role authenticated;
select tests.ok(public.aprovar_plano_em_reuniao('80000000-0000-0000-0000-0000000000a1', now() - interval '1 hour', 'Ana') = 'aprovado',
  'plano com seção pendente e ajuste pedido é aprovado em reunião');
select tests.ok((select string_agg(s.nome || '=' || s.status, ' ' order by s.ordem) from public.plan_sections s
                  join public.plan_versions v on v.id = s.version_id where v.plan_id = '80000000-0000-0000-0000-0000000000a1')
                = 'Capa=informativa Objetivos=aprovada Personas=aprovada',
  'seções que faltavam ficam aprovadas; informativa continua informativa');
select tests.ok((select count(*) = 2 and bool_and(via = 'reuniao' and aprovado_por_cliente = 'Ana') from public.plan_section_decisions
                  where plan_id = '80000000-0000-0000-0000-0000000000a1' and via = 'reuniao'),
  'uma decisão de reunião por seção aprovada');
do $$ begin
  perform public.aprovar_plano_em_reuniao('80000000-0000-0000-0000-0000000000a1', now(), 'Ana');
  raise exception 'FALHOU: aprovou plano já aprovado' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  plano aprovado não é aprovado de novo';
end $$;
reset role;

-- ===================================================================
\echo '— Criativos aprovados em reunião'
-- ===================================================================
select tests.login('equipe1');
set role authenticated;
insert into public.creative_requests (id, client_id, titulo) values ('80000000-0000-0000-0000-0000000000c1', tests.id('nortis'), 'Peças de março');
insert into public.creative_pieces (id, request_id, nome, canal, formato, ordem) values
  ('80000000-0000-0000-0000-0000000000d1', '80000000-0000-0000-0000-0000000000c1', 'Feed 1', 'Meta Ads', 'Feed', 1),
  ('80000000-0000-0000-0000-0000000000d2', '80000000-0000-0000-0000-0000000000c1', 'Story 1', 'Meta Ads', 'Stories', 2),
  ('80000000-0000-0000-0000-0000000000d3', '80000000-0000-0000-0000-0000000000c1', 'Reels 1', 'Meta Ads', 'Reels', 3);
insert into public.piece_versions (piece_id, tipo, link_url) values
  ('80000000-0000-0000-0000-0000000000d1', 'link', 'https://drive.google.com/a'),
  ('80000000-0000-0000-0000-0000000000d2', 'link', 'https://drive.google.com/b');
select public.enviar_solicitacao('80000000-0000-0000-0000-0000000000c1');
-- Peça incluída depois do envio, ainda em rascunho.
insert into public.piece_versions (piece_id, tipo, link_url) values ('80000000-0000-0000-0000-0000000000d3', 'link', 'https://drive.google.com/c');
reset role;
select tests.login('cli_nortis');
set role authenticated;
select public.decidir_versao(v.id, 'alteracoes_solicitadas', 'Trocar a foto') from public.piece_versions v
 where v.piece_id = '80000000-0000-0000-0000-0000000000d2';
reset role;
select tests.login('equipe1');
set role authenticated;
select tests.ok(public.aprovar_solicitacao_em_reuniao('80000000-0000-0000-0000-0000000000c1', now() - interval '30 minutes',
                'Pedro', 'Aprovou tudo na call') = 'aprovado',
  'solicitação com peça pendente, peça com ajuste e peça em rascunho fica aprovada em reunião');
select tests.ok((select count(*) = 3 and bool_and(via = 'reuniao') from public.approvals
                  where request_id = '80000000-0000-0000-0000-0000000000c1' and via = 'reuniao'),
  'uma decisão de reunião por peça');
select tests.ok((select bool_and(status = 'aprovado' and enviado_em is not null) from public.piece_versions v
                  join public.creative_pieces p on p.id = v.piece_id where p.request_id = '80000000-0000-0000-0000-0000000000c1'
                    and v.id in (select version_id from private.versoes_atuais('80000000-0000-0000-0000-0000000000c1'))),
  'versões atuais ficam aprovadas e enviadas (a que era rascunho também)');
do $$ begin
  perform public.aprovar_solicitacao_em_reuniao('80000000-0000-0000-0000-0000000000c1', now(), 'Pedro');
  raise exception 'FALHOU: aprovou de novo' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  sem peça para aprovar, não registra';
end $$;
reset role;

select tests.login('cli_nortis');
set role authenticated;
select tests.ok((select count(*) = 3 from public.approvals where request_id = '80000000-0000-0000-0000-0000000000c1' and via = 'reuniao'),
  'cliente vê as aprovações em reunião das peças');
reset role;

-- ===================================================================
\echo '— Registro de P.I.s enviados'
-- ===================================================================
select tests.login('equipe1');
set role authenticated;
do $$ begin
  insert into public.pi_envios (budget_id, client_id, pis, numeros, para, assunto)
  values ('80000000-0000-0000-0000-000000000001', tests.id('nortis'), '{}', '{}', '{x@y.com}', 'Forjado');
  raise exception 'FALHOU: equipe gravou envio direto' using errcode = 'TF001';
exception when insufficient_privilege then raise notice 'ok  registro de envio só pela função de servidor';
end $$;
reset role;
