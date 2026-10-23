-- Testes da etapa 4: Pedidos de Inserção. Conecta como "authenticator".
\set ON_ERROR_STOP on
set client_min_messages = notice;

select tests.login('admin');
set role authenticated;
update public.profiles set ativo = true where id = tests.id('equipe1');
update public.clients set razao_social = 'Nortis Energia LTDA', cnpj = '04614281000123', cidade = 'Fortaleza', uf = 'CE'
 where id = tests.id('nortis');
reset role;

-- ===================================================================
\echo '— Preparação: orçamento aprovado e outro ainda em rascunho'
-- ===================================================================
select tests.login('equipe1');
set role authenticated;
insert into public.budgets (id, client_id, mes_referencia)
values ('30000000-0000-0000-0000-000000000001', tests.id('nortis'), '2026-11-01'),
       ('30000000-0000-0000-0000-000000000002', tests.id('nortis'), '2026-12-01');
insert into public.budget_lines (version_id, plataforma, descricao, valor, ordem)
select v.id, x.plataforma, x.descricao, x.valor, x.ordem
  from public.budget_versions v,
       (values ('Meta Ads', 'Leads', 1100.00, 1), ('Google Ads', 'Pesquisa', 300.00, 2), ('Meta Ads', 'Remarketing', 400.00, 3))
         as x (plataforma, descricao, valor, ordem)
 where v.budget_id = '30000000-0000-0000-0000-000000000001';
insert into public.budget_lines (version_id, plataforma, valor)
select v.id, 'Meta Ads', 500 from public.budget_versions v where v.budget_id = '30000000-0000-0000-0000-000000000002';
select public.enviar_orcamento('30000000-0000-0000-0000-000000000001');
reset role;

select tests.login('cli_nortis');
set role authenticated;
select public.decidir_orcamento('30000000-0000-0000-0000-000000000001', 'aprovado');
reset role;

create temporary table dados_pi as
select '{"campanha":"Conta de luz","periodo":"01/11/2026 a 30/11/2026","prazo_pagamento":"Data do vencimento do boleto","faturamento":"bruto","entrega_fatura":"cliente"}'::jsonb as d;
grant select on dados_pi to authenticated;

-- ===================================================================
\echo '— Quem pode emitir'
-- ===================================================================
select tests.login('equipe1');
set role authenticated;
do $$ begin
  perform public.emitir_pis('30000000-0000-0000-0000-000000000002', false, (select d from dados_pi));
  raise exception 'FALHOU: emitiu P.I. de orçamento não aprovado';
exception when raise_exception then raise notice 'ok  P.I. só sai de orçamento aprovado';
end $$;
do $$ begin
  perform public.emitir_pis('30000000-0000-0000-0000-000000000001', false,
    (select d || '{"faturamento":"talvez"}' from dados_pi));
  raise exception 'FALHOU: aceitou forma de faturamento inválida';
exception when raise_exception then raise notice 'ok  forma de faturamento precisa ser bruto ou líquido';
end $$;
do $$ begin
  insert into public.insertion_orders (numero, data_emissao, sequencia, budget_id, version_id, client_id, veiculacao, valor,
    mes_referencia, campanha, periodo, prazo_pagamento, faturamento, entrega_fatura, dados_cliente, dados_agencia)
  select '999999.99', current_date, 99, b.id, v.id, b.client_id, 'Meta Ads', 1, b.mes_referencia, 'x', 'x', 'x',
         'bruto', 'cliente', '{}', '{}'
    from public.budgets b join public.budget_versions v on v.budget_id = b.id
   where b.id = '30000000-0000-0000-0000-000000000001';
  raise exception 'FALHOU: criou P.I. direto na tabela';
exception when insufficient_privilege then raise notice 'ok  P.I. só nasce pela função de emissão';
end $$;
reset role;

select tests.login('equipe2');
set role authenticated;
do $$ begin
  perform public.emitir_pis('30000000-0000-0000-0000-000000000001', false, (select d from dados_pi));
  raise exception 'FALHOU: equipe sem acesso emitiu';
exception when insufficient_privilege then raise notice 'ok  equipe sem acesso ao cliente não emite';
end $$;
reset role;

select tests.login('cli_nortis');
set role authenticated;
do $$ begin
  perform public.emitir_pis('30000000-0000-0000-0000-000000000001', false, (select d from dados_pi));
  raise exception 'FALHOU: cliente emitiu';
exception when insufficient_privilege then raise notice 'ok  cliente não emite P.I.';
end $$;
reset role;

-- ===================================================================
\echo '— Emissão consolidada e por plataforma, com numeração do dia'
-- ===================================================================
select tests.login('equipe1');
set role authenticated;
create temporary table hoje as select to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYMMDD') as p;

select * from public.emitir_pis('30000000-0000-0000-0000-000000000001', false, (select d from dados_pi));
select tests.ok((select count(*) from public.insertion_orders) = 1, 'consolidado gera um P.I.');
select tests.ok((select numero = (select p from hoje) || '.01' and valor = 1800.00 and veiculacao = 'Meta Ads, Google Ads'
                        and plataforma is null from public.insertion_orders),
  'consolidado: número AAMMDD.01, valor do boleto R$ 1.800,00, plataformas na ordem do orçamento');
select tests.ok((select dados_cliente ->> 'razao_social' = 'Nortis Energia LTDA' and dados_agencia ->> 'cnpj' = '11647486000170'
                 from public.insertion_orders),
  'P.I. guarda os dados do cliente e da agência');

select * from public.emitir_pis('30000000-0000-0000-0000-000000000001', true, (select d from dados_pi));
select tests.ok((select string_agg(numero || '=' || plataforma || ':' || valor, ' ' order by sequencia)
                   from public.insertion_orders where plataforma is not null)
                = (select p from hoje) || '.02=Meta Ads:1500.00 ' || (select p from hoje) || '.03=Google Ads:300.00',
  'por plataforma: um P.I. para cada, com os próximos números do dia');

do $$ begin
  update public.insertion_orders set valor = 1 where plataforma = 'Meta Ads';
  raise exception 'FALHOU: alterou P.I. emitido';
exception when insufficient_privilege then raise notice 'ok  P.I. emitido não é alterado';
end $$;
reset role;

select tests.login('admin');
set role authenticated;
update public.clients set razao_social = 'Outro nome' where id = tests.id('nortis');
select tests.ok((select bool_and(dados_cliente ->> 'razao_social' = 'Nortis Energia LTDA') from public.insertion_orders),
  'mudar o cadastro do cliente não altera P.I. já emitido');
update public.clients set razao_social = 'Nortis Energia LTDA' where id = tests.id('nortis');
reset role;

-- ===================================================================
\echo '— PDF no Storage'
-- ===================================================================
select tests.login('equipe1');
set role authenticated;
insert into storage.objects (bucket_id, name)
select 'pis', client_id || '/' || id || '.pdf' from public.insertion_orders where sequencia = 1;
do $$ begin
  insert into storage.objects (bucket_id, name) values ('pis', tests.id('nortis') || '/qualquer.pdf');
  raise exception 'FALHOU: enviou PDF com nome solto';
exception when insufficient_privilege then raise notice 'ok  PDF só com o nome do P.I.';
end $$;
select public.registrar_pdf_pi(id, client_id || '/' || id || '.pdf') from public.insertion_orders where sequencia = 1;
select tests.ok((select pdf_path is not null from public.insertion_orders where sequencia = 1), 'caminho do PDF registrado');
do $$ begin
  perform public.registrar_pdf_pi(id, 'outro/caminho.pdf') from public.insertion_orders where sequencia = 2;
  raise exception 'FALHOU: aceitou caminho de PDF inválido';
exception when invalid_parameter_value then raise notice 'ok  caminho do PDF precisa ser o do P.I.';
end $$;
reset role;

-- ===================================================================
\echo '— Cliente vê e baixa; outra empresa não'
-- ===================================================================
select tests.login('cli_nortis_leitor');
set role authenticated;
select tests.ok((select count(*) from public.insertion_orders) = 3, 'cliente (mesmo só visualizador) vê os P.I.s da empresa');
select tests.ok((select count(*) from storage.objects where bucket_id = 'pis') = 1, 'cliente enxerga o PDF para baixar');
do $$ begin
  insert into storage.objects (bucket_id, name)
  select 'pis', client_id || '/' || id || '.pdf' from public.insertion_orders where sequencia = 2;
  raise exception 'FALHOU: cliente enviou PDF';
exception when insufficient_privilege then raise notice 'ok  cliente não envia PDF';
end $$;
do $$ begin
  perform public.cancelar_pi(id, 'Não quero') from public.insertion_orders where sequencia = 2;
  raise exception 'FALHOU: cliente cancelou P.I.';
exception when insufficient_privilege then raise notice 'ok  cliente não cancela P.I.';
end $$;
reset role;

select tests.login('cli_dasart');
set role authenticated;
select tests.ok((select count(*) from public.insertion_orders) = 0, 'outra empresa não vê os P.I.s');
select tests.ok((select count(*) from storage.objects where bucket_id = 'pis') = 0, 'outra empresa não vê os PDFs');
reset role;

-- ===================================================================
\echo '— Cancelamento não libera número'
-- ===================================================================
select tests.login('equipe1');
set role authenticated;
select public.cancelar_pi(id, 'Emitido em duplicidade') from public.insertion_orders where plataforma is null;
select tests.ok((select status = 'cancelado' and motivo_cancelamento = 'Emitido em duplicidade'
                 from public.insertion_orders where plataforma is null), 'P.I. cancelado com motivo');
select * from public.emitir_pis('30000000-0000-0000-0000-000000000001', false, (select d from dados_pi));
select tests.ok((select max(numero) from public.insertion_orders) = (select p from hoje) || '.04',
  'número de P.I. cancelado não é reaproveitado');
reset role;

-- ===================================================================
\echo '— Histórico'
-- ===================================================================
select tests.login('admin');
set role authenticated;
select tests.ok((select count(*) from public.audit_log where action = 'pi.criado' and actor_id = tests.id('equipe1')) = 4,
  'cada P.I. emitido fica no histórico com autor');
select tests.ok(exists (select 1 from public.audit_log where action = 'pi.alterado'
                        and details -> 'alteracoes' -> 'status' ->> 'para' = 'cancelado'),
  'o cancelamento do P.I. fica no histórico');
reset role;
select tests.logout();
