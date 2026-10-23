-- Testes do plano por link (migration 010). Conecta como "authenticator".
\set ON_ERROR_STOP on
set client_min_messages = notice;

select tests.login('admin');
set role authenticated;
update public.profiles set ativo = true where id = tests.id('equipe1');
reset role;

select tests.login('equipe1');
set role authenticated;
insert into public.plans (id, client_id, titulo) values ('60000000-0000-0000-0000-000000000001', tests.id('nortis'), 'PCA Recife');
create temporary table l1 as select id from public.plan_versions where plan_id = '60000000-0000-0000-0000-000000000001';
grant select on l1 to authenticated;

-- ===================================================================
\echo '— Link: só do site da Atratis, com total de slides'
-- ===================================================================
do $$ begin
  perform public.definir_link_plano((select id from l1), 'https://exemplo.com/deck/', 10);
  raise exception 'FALHOU: aceitou link de fora' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  link precisa ser de atratis.com.br';
end $$;
do $$ begin
  perform public.definir_link_plano((select id from l1), 'https://atratis.com.br.golpe.com/deck/', 10);
  raise exception 'FALHOU: aceitou domínio parecido' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  domínio parecido não passa';
end $$;
do $$ begin
  perform public.definir_link_plano((select id from l1), 'http://atratis.com.br/uteis/deck/', 10);
  raise exception 'FALHOU: aceitou http' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  link precisa ser https';
end $$;
do $$ begin
  perform public.definir_link_plano((select id from l1), 'https://atratis.com.br/uteis/deck/', 0);
  raise exception 'FALHOU: aceitou zero slides' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  total de slides é obrigatório';
end $$;
do $$ begin
  update public.plan_versions set link_url = 'https://exemplo.com/' where id = (select id from l1);
  raise exception 'FALHOU: mudou o link direto na tabela' using errcode = 'TF001';
exception when insufficient_privilege then raise notice 'ok  link só pela função';
end $$;
select public.definir_link_plano((select id from l1), '  https://atratis.com.br/uteis/fortes/pca-recife/#12  ', 6);
select tests.ok((select link_url = 'https://atratis.com.br/uteis/fortes/pca-recife/' and paginas = 6 and pdf_path is null
                 from public.plan_versions where id = (select id from l1)),
  'link guardado sem espaços e sem o número do slide, com o total informado');

-- PDF junto precisa ter o mesmo número de slides.
insert into storage.objects (bucket_id, name)
values ('planos', tests.id('nortis') || '/60000000-0000-0000-0000-000000000001/a.pdf');
do $$ begin
  perform public.definir_pdf_plano((select id from l1), tests.id('nortis') || '/60000000-0000-0000-0000-000000000001/a.pdf', 7);
  raise exception 'FALHOU: aceitou PDF com outro número de slides' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  PDF e link precisam ter o mesmo número de slides';
end $$;
select public.definir_pdf_plano((select id from l1), tests.id('nortis') || '/60000000-0000-0000-0000-000000000001/a.pdf', 6);
do $$ begin
  perform public.definir_link_plano((select id from l1), 'https://atratis.com.br/uteis/fortes/pca-recife/', 8);
  raise exception 'FALHOU: aceitou link com outro número de slides' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  link não muda o total quando há PDF';
end $$;
select public.remover_material_plano((select id from l1), 'pdf');
select tests.ok((select pdf_path is null and link_url is not null and paginas = 6 from public.plan_versions where id = (select id from l1)),
  'dá para tirar o PDF e ficar só com o link');
do $$ begin
  perform public.remover_material_plano((select id from l1), 'link');
  raise exception 'FALHOU: ficou sem PDF e sem link' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  o plano não fica sem material';
end $$;

select public.salvar_secoes_plano((select id from l1),
  '[{"nome":"Abertura","pagina_inicio":1,"pagina_fim":2,"requer_aprovacao":false},{"nome":"Objetivos","pagina_inicio":3,"pagina_fim":4},{"nome":"Personas","pagina_inicio":5,"pagina_fim":6}]');
select public.enviar_plano('60000000-0000-0000-0000-000000000001');
select tests.ok((select status = 'aguardando_aprovacao' from public.plans where id = '60000000-0000-0000-0000-000000000001'),
  'plano só com link é enviado');
reset role;

-- ===================================================================
\echo '— Cliente vê o link e decide'
-- ===================================================================
select tests.login('cli_nortis');
set role authenticated;
select tests.ok((select link_url = 'https://atratis.com.br/uteis/fortes/pca-recife/' from public.plan_versions
                 where plan_id = '60000000-0000-0000-0000-000000000001'),
  'cliente vê o link da versão enviada');
select public.decidir_secao_plano(s.id, 'aprovada') from public.plan_sections s
  join public.plan_versions v on v.id = s.version_id
 where v.plan_id = '60000000-0000-0000-0000-000000000001' and s.nome = 'Objetivos';
select tests.ok(public.decidir_secao_plano(s.id, 'ajuste_solicitado', 'Mudar a persona', array[6]) = 'ajustes_solicitados',
  'decisão por seção funciona igual no link')
  from public.plan_sections s join public.plan_versions v on v.id = s.version_id
 where v.plan_id = '60000000-0000-0000-0000-000000000001' and s.nome = 'Personas';
reset role;

-- ===================================================================
\echo '— Versão nova precisa de endereço novo'
-- ===================================================================
select tests.login('equipe1');
set role authenticated;
create temporary table l2 as select public.nova_versao_plano('60000000-0000-0000-0000-000000000001') as id;
grant select on l2 to authenticated;
select tests.ok((select link_url = 'https://atratis.com.br/uteis/fortes/pca-recife/' and paginas = 6
                 from public.plan_versions where id = (select id from l2)),
  'versão nova começa com o link anterior');
do $$ begin
  perform public.enviar_plano('60000000-0000-0000-0000-000000000001');
  raise exception 'FALHOU: enviou versão nova com o mesmo link' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  versão nova com o mesmo link não é enviada';
end $$;
do $$ begin
  perform public.definir_link_plano((select id from l2), 'https://www.atratis.com.br/uteis/fortes//pca-recife/index.html?v=2', 6);
  perform public.enviar_plano('60000000-0000-0000-0000-000000000001');
  raise exception 'FALHOU: enviou o mesmo endereço disfarçado' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  mesmo endereço com www, barra, index.html ou parâmetro não passa';
end $$;
select public.definir_link_plano((select id from l2), 'https://atratis.com.br/uteis/fortes/pca-recife-v2/', 6);
select public.enviar_plano('60000000-0000-0000-0000-000000000001');
select tests.ok((select string_agg(nome || '=' || status, ' ' order by ordem) from public.plan_sections where version_id = (select id from l2))
                = 'Abertura=informativa Objetivos=aprovada Personas=pendente',
  'com endereço novo, envia e só Personas volta para o cliente');
reset role;

select tests.login('cli_nortis');
set role authenticated;
select tests.ok((select count(distinct link_url) = 2 from public.plan_versions where plan_id = '60000000-0000-0000-0000-000000000001'),
  'cada versão enviada guarda o seu link');
reset role;
