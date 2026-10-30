-- Blocos de boleto no orçamento (migration 014). Conecta como "authenticator".
\set ON_ERROR_STOP on
set client_min_messages = notice;

-- ===================================================================
\echo '— Montar e enviar orçamento com dois blocos'
-- ===================================================================
select tests.login('equipe1');
set role authenticated;
insert into public.budgets (id, client_id, mes_referencia) values ('a0000000-0000-0000-0000-000000000001', tests.id('nortis'), '2027-07-01');
insert into public.budget_lines (version_id, bloco, projeto, plataforma, descricao, valor, ordem)
select v.id, x.bloco, x.projeto, x.plataforma, x.objetivo, x.valor, x.ordem
  from public.budget_versions v,
       (values (null, 'Institucional', 'Meta Ads', 'Impulsionamento', 200, 1),
               ('', 'Embrapii', 'Google Ads', 'HR | Comercial', 2400, 2),
               ('Geral', 'Institucional', 'Google Ads', 'Pesquisa', 300, 3),
               ('  Revista  ', 'Revista', 'Meta Ads', 'MR | WP', 1000, 4),
               ('Revista', 'Revista', 'Google Ads', 'MR | WP', 1500, 5)) as x(bloco, projeto, plataforma, objetivo, valor, ordem)
 where v.budget_id = 'a0000000-0000-0000-0000-000000000001';
select tests.ok((select string_agg(bloco || ':' || status, ',' order by bloco) from public.budget_blocks
                  where budget_id = 'a0000000-0000-0000-0000-000000000001') = 'Geral:rascunho,Revista:rascunho',
  'bloco vazio vira Geral, espaços somem; blocos nascem em rascunho');
select tests.ok(public.enviar_orcamento('a0000000-0000-0000-0000-000000000001') = 'aguardando_aprovacao', 'envia os dois blocos');
select tests.ok((select bool_and(status = 'pendente' and enviado_em is not null) from public.budget_blocks
                  where budget_id = 'a0000000-0000-0000-0000-000000000001'), 'blocos ficam pendentes');
reset role;

-- ===================================================================
\echo '— Cliente decide bloco por bloco'
-- ===================================================================
select tests.login('cli_dasart');
set role authenticated;
do $$ begin
  perform public.decidir_bloco_orcamento('a0000000-0000-0000-0000-000000000001', 'Geral', 'aprovado', null, 2900);
  raise exception 'FALHOU: outra empresa decidiu o bloco' using errcode = 'TF001';
exception when insufficient_privilege then raise notice 'ok  outra empresa não decide bloco';
end $$;
reset role;

select tests.login('cli_nortis');
set role authenticated;
select tests.ok((select count(*) = 2 from public.budget_blocks where budget_id = 'a0000000-0000-0000-0000-000000000001'),
  'cliente vê os blocos enviados');
do $$ begin
  perform public.decidir_bloco_orcamento('a0000000-0000-0000-0000-000000000001', 'Geral', 'aprovado', null, 2600);
  raise exception 'FALHOU: aprovou bloco com total errado' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  total do bloco é conferido';
end $$;
select tests.ok(public.decidir_bloco_orcamento('a0000000-0000-0000-0000-000000000001', 'Geral', 'aprovado', null, 2900)
                in ('aguardando_aprovacao', 'em_analise'),
  'aprovar só o Geral deixa o orçamento aguardando o outro bloco');
select tests.ok((select bloco = 'Geral' and total = 2900 from public.budget_approvals
                  where budget_id = 'a0000000-0000-0000-0000-000000000001'), 'decisão guarda bloco e total do bloco');
do $$ begin
  perform public.decidir_bloco_orcamento('a0000000-0000-0000-0000-000000000001', 'Geral', 'aprovado', null, 2900);
  raise exception 'FALHOU: decidiu bloco já aprovado' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  bloco já aprovado não é decidido de novo';
end $$;
reset role;

-- ===================================================================
\echo '— P.I. só de bloco aprovado, com projetos na observação'
-- ===================================================================
select tests.login('equipe1');
set role authenticated;
do $$ begin
  perform public.emitir_pis('a0000000-0000-0000-0000-000000000001', true,
    '{"campanha":"Teste","periodo":"Permanente","prazo_pagamento":"Boleto","faturamento":"bruto","entrega_fatura":"cliente"}'::jsonb,
    array['Revista']);
  raise exception 'FALHOU: emitiu P.I. de bloco pendente' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  bloco pendente não gera P.I.';
end $$;
select tests.ok((select string_agg(bloco || '/' || veiculacao || '/' || valor || '/' || observacoes, ' | ' order by numero)
                   from public.emitir_pis('a0000000-0000-0000-0000-000000000001', true,
                     '{"campanha":"Teste","periodo":"Permanente","prazo_pagamento":"Boleto","faturamento":"bruto","entrega_fatura":"cliente"}'::jsonb))
                = 'Geral/Meta Ads/200.00/Projetos: Institucional | Geral/Google Ads/2700.00/Projetos: Embrapii, Institucional',
  'sem escolher bloco: só os aprovados, um P.I. por canal, projetos na observação');
reset role;

select tests.login('cli_nortis');
set role authenticated;
select tests.ok(public.decidir_bloco_orcamento('a0000000-0000-0000-0000-000000000001', 'Revista', 'alteracoes_solicitadas',
                'Trocar o Meta por Google', null) = 'alteracoes_solicitadas',
  'ajuste pedido no Revista: orçamento volta para a equipe');
reset role;

-- ===================================================================
\echo '— Reenvio só do bloco com ajuste; aprovação em reunião por bloco'
-- ===================================================================
select tests.login('equipe1');
set role authenticated;
update public.budget_lines set plataforma = 'Google Ads'
 where bloco = 'Revista' and plataforma = 'Meta Ads'
   and version_id = (select id from public.budget_versions where budget_id = 'a0000000-0000-0000-0000-000000000001');
select public.enviar_orcamento('a0000000-0000-0000-0000-000000000001');
select tests.ok((select string_agg(bloco || ':' || status, ',' order by bloco) from public.budget_blocks
                  where budget_id = 'a0000000-0000-0000-0000-000000000001') = 'Geral:aprovado,Revista:pendente',
  'reenvio: Geral continua aprovado, Revista volta para o cliente');
do $$ begin
  perform public.aprovar_orcamento_em_reuniao('a0000000-0000-0000-0000-000000000001', now(), 'Maria', null, array['Geral']);
  raise exception 'FALHOU: aprovou em reunião bloco já aprovado' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  reunião não reaprova bloco aprovado';
end $$;
select tests.ok(public.aprovar_orcamento_em_reuniao('a0000000-0000-0000-0000-000000000001', now() - interval '1 hour', 'Maria',
                null, array['Revista']) = 'aprovado',
  'Revista aprovado em reunião: orçamento todo aprovado');
select tests.ok((select string_agg(bloco || '/' || veiculacao || '/' || valor || '/' || observacoes, ' | ')
                   from public.emitir_pis('a0000000-0000-0000-0000-000000000001', false,
                     '{"campanha":"Revista","periodo":"Permanente","prazo_pagamento":"Boleto","faturamento":"bruto","entrega_fatura":"cliente","observacoes":"Pagar até dia 10"}'::jsonb,
                     array['Revista']))
                = E'Revista/Google Ads/2500.00/Projetos: Revista\nPagar até dia 10',
  'P.I. consolidado só do Revista, com projetos e a observação digitada');

-- Bloco novo depois da aprovação: só ele volta para o cliente.
insert into public.budget_lines (version_id, bloco, projeto, plataforma, valor, ordem)
select id, 'Extra', 'Case GreenAnt', 'Meta Ads', 600, 6 from public.budget_versions where budget_id = 'a0000000-0000-0000-0000-000000000001';
select tests.ok((select status = 'aguardando_aprovacao' from public.budgets where id = 'a0000000-0000-0000-0000-000000000001')
            and (select string_agg(bloco || ':' || status, ',' order by bloco) from public.budget_blocks
                  where budget_id = 'a0000000-0000-0000-0000-000000000001') = 'Extra:pendente,Geral:aprovado,Revista:aprovado',
  'bloco novo fica pendente e o orçamento volta a aguardar; os outros continuam aprovados');
select tests.ok((select count(*) = 2 from public.emitir_pis('a0000000-0000-0000-0000-000000000001', true,
                   '{"campanha":"Teste","periodo":"Permanente","prazo_pagamento":"Boleto","faturamento":"bruto","entrega_fatura":"cliente"}'::jsonb,
                   array['Geral'])),
  'bloco aprovado continua gerando P.I. enquanto outro está pendente');
-- Mudar linha de bloco aprovado: continua aprovado e vai para o histórico com o bloco.
update public.budget_lines set bloco = 'Extra'
 where projeto = 'Embrapii' and version_id = (select id from public.budget_versions where budget_id = 'a0000000-0000-0000-0000-000000000001');
select tests.ok((select bloco_antes = 'Geral' and bloco = 'Extra' and status_orcamento = 'aprovado' from public.budget_changes
                  where budget_id = 'a0000000-0000-0000-0000-000000000001' and acao = 'alterada' order by id desc limit 1),
  'linha que muda de bloco vai para o histórico com o bloco antes e depois');
reset role;

-- ===================================================================
\echo '— Nova versão mantém blocos sem mudança'
-- ===================================================================
select tests.login('cli_nortis');
set role authenticated;
select tests.ok(public.decidir_orcamento('a0000000-0000-0000-0000-000000000001', 'aprovado') = 'aprovado',
  'decisão do orçamento inteiro aprova os blocos pendentes');
reset role;
select tests.login('equipe1');
set role authenticated;
select public.nova_versao_orcamento('a0000000-0000-0000-0000-000000000001', 'Ajuste no Extra');
update public.budget_lines set valor = 700
 where bloco = 'Extra' and plataforma = 'Meta Ads'
   and version_id = (select id from public.budget_versions where budget_id = 'a0000000-0000-0000-0000-000000000001' and numero = 2);
select public.enviar_orcamento('a0000000-0000-0000-0000-000000000001');
select tests.ok((select string_agg(k.bloco || ':' || k.status, ',' order by k.bloco) from public.budget_blocks k
                   join public.budget_versions v on v.id = k.version_id
                  where v.budget_id = 'a0000000-0000-0000-0000-000000000001' and v.numero = 2)
                = 'Extra:pendente,Geral:aprovado,Revista:aprovado',
  'versão nova: blocos iguais continuam aprovados, o alterado volta para o cliente');
reset role;

select tests.login('cli_nortis');
set role authenticated;
do $$ begin
  insert into public.budget_blocks (version_id, budget_id, bloco, status)
  select id, budget_id, 'Forjado', 'aprovado' from public.budget_versions where budget_id = 'a0000000-0000-0000-0000-000000000001' limit 1;
  raise exception 'FALHOU: cliente gravou bloco direto' using errcode = 'TF001';
exception when insufficient_privilege then raise notice 'ok  blocos só mudam pelo fluxo';
end $$;
reset role;
