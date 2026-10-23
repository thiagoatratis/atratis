-- Testes da etapa 5: plano de comunicação aprovado por seção. Conecta como "authenticator".
\set ON_ERROR_STOP on
set client_min_messages = notice;

-- ===================================================================
\echo '— Criação do plano e rascunho invisível ao cliente'
-- ===================================================================
select tests.login('equipe1');
set role authenticated;
insert into public.plans (id, client_id, titulo, status)
values ('50000000-0000-0000-0000-000000000001', tests.id('nortis'), '  Plano de Comunicação Digital 2027 ', 'aprovado');
select tests.ok((select status = 'rascunho' and titulo = 'Plano de Comunicação Digital 2027'
                 from public.plans where id = '50000000-0000-0000-0000-000000000001'),
  'plano nasce em rascunho, mesmo se o site mandar outro status');
select tests.ok((select count(*) = 1 and bool_and(numero = 1 and status = 'rascunho') from public.plan_versions
                 where plan_id = '50000000-0000-0000-0000-000000000001'),
  'plano nasce com a versão 1 em rascunho');
do $$ begin
  insert into public.plan_versions (plan_id, numero) values ('50000000-0000-0000-0000-000000000001', 9);
  raise exception 'FALHOU: criou versão direto na tabela' using errcode = 'TF001';
exception when insufficient_privilege then raise notice 'ok  versão só nasce pelo fluxo';
end $$;
do $$ begin
  insert into public.plan_sections (version_id, ordem, nome, pagina_inicio, pagina_fim)
  select id, 1, 'x', 1, 1 from public.plan_versions where plan_id = '50000000-0000-0000-0000-000000000001';
  raise exception 'FALHOU: criou seção direto na tabela' using errcode = 'TF001';
exception when insufficient_privilege then raise notice 'ok  seção só é gravada pelas funções do plano';
end $$;
do $$ begin
  update public.plans set status = 'aprovado' where id = '50000000-0000-0000-0000-000000000001';
  raise exception 'FALHOU: mudou status direto' using errcode = 'TF001';
exception when insufficient_privilege then raise notice 'ok  status do plano não muda direto na tabela';
end $$;
create temporary table v1 as
  select id from public.plan_versions where plan_id = '50000000-0000-0000-0000-000000000001' and numero = 1;
grant select on v1 to authenticated;
reset role;

select tests.login('cli_nortis');
set role authenticated;
select tests.ok((select count(*) = 0 from public.plans), 'cliente não vê plano em rascunho');
reset role;

select tests.login('equipe2');
set role authenticated;
select tests.ok((select count(*) = 0 from public.plans), 'equipe sem acesso ao cliente não vê o plano');
do $$ begin
  perform public.salvar_secoes_plano((select id from v1), '[{"nome":"x","pagina_inicio":1,"pagina_fim":1}]');
  raise exception 'FALHOU: equipe sem acesso salvou seções' using errcode = 'TF001';
exception when insufficient_privilege then raise notice 'ok  equipe sem acesso não mexe no plano';
end $$;
reset role;

-- ===================================================================
\echo '— PDF e seções'
-- ===================================================================
select tests.login('equipe1');
set role authenticated;
do $$ begin
  perform public.enviar_plano('50000000-0000-0000-0000-000000000001');
  raise exception 'FALHOU: enviou plano sem PDF' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  plano sem PDF não é enviado';
end $$;
do $$ begin
  perform public.salvar_secoes_plano((select id from v1), '[{"nome":"x","pagina_inicio":1,"pagina_fim":1}]');
  raise exception 'FALHOU: marcou seções sem PDF' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  seções só depois do PDF';
end $$;
do $$ begin
  insert into storage.objects (bucket_id, name) values ('planos', tests.id('dasart') || '/50000000-0000-0000-0000-000000000001/a.pdf');
  raise exception 'FALHOU: subiu PDF na pasta de outro cliente' using errcode = 'TF001';
exception when insufficient_privilege then raise notice 'ok  PDF só na pasta do cliente do plano';
end $$;
insert into storage.objects (bucket_id, name)
values ('planos', tests.id('nortis') || '/50000000-0000-0000-0000-000000000001/v1.pdf');
do $$ begin
  perform public.definir_pdf_plano((select id from v1), tests.id('nortis') || '/outro-plano/v1.pdf', 12);
  raise exception 'FALHOU: aceitou caminho de outro plano' using errcode = 'TF001';
exception when invalid_parameter_value then raise notice 'ok  caminho do PDF precisa ser da pasta do plano';
end $$;
do $$ begin
  perform public.definir_pdf_plano((select id from v1), tests.id('nortis') || '/50000000-0000-0000-0000-000000000001/nao-subiu.pdf', 12);
  raise exception 'FALHOU: aceitou PDF que não está no Storage' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  PDF precisa estar no Storage';
end $$;
select public.definir_pdf_plano((select id from v1), tests.id('nortis') || '/50000000-0000-0000-0000-000000000001/v1.pdf', 12);

do $$ begin
  perform public.salvar_secoes_plano((select id from v1),
    '[{"nome":"Capa","pagina_inicio":1,"pagina_fim":2},{"nome":"Objetivos","pagina_inicio":4,"pagina_fim":12}]');
  raise exception 'FALHOU: aceitou buraco entre seções' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  seções não podem pular páginas';
end $$;
do $$ begin
  perform public.salvar_secoes_plano((select id from v1),
    '[{"nome":"Capa","pagina_inicio":1,"pagina_fim":2},{"nome":"Objetivos","pagina_inicio":3,"pagina_fim":10}]');
  raise exception 'FALHOU: aceitou seções que não vão até o fim' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  seções precisam ir até a última página';
end $$;
do $$ begin
  perform public.salvar_secoes_plano((select id from v1),
    '[{"nome":"Capa","pagina_inicio":1,"pagina_fim":2},{"nome":"  ","pagina_inicio":3,"pagina_fim":12}]');
  raise exception 'FALHOU: aceitou seção sem nome' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  seção precisa de nome';
end $$;
select public.salvar_secoes_plano((select id from v1), '[
  {"nome":"Capa e sumário","pagina_inicio":1,"pagina_fim":2,"requer_aprovacao":false},
  {"nome":"Objetivos","pagina_inicio":3,"pagina_fim":5},
  {"nome":"Personas","pagina_inicio":6,"pagina_fim":9},
  {"nome":"Tom de voz","pagina_inicio":10,"pagina_fim":12}]');
select tests.ok((select string_agg(ordem || ':' || nome || ':' || pagina_inicio || '-' || pagina_fim, ' ' order by ordem)
                 from public.plan_sections where version_id = (select id from v1))
                = '1:Capa e sumário:1-2 2:Objetivos:3-5 3:Personas:6-9 4:Tom de voz:10-12',
  'seções gravadas em ordem cobrindo as 12 páginas');
update public.plan_versions set observacao = 'Primeira versão' where id = (select id from v1);
do $$ begin
  update public.plan_versions set paginas = 99 where id = (select id from v1);
  raise exception 'FALHOU: mudou páginas direto' using errcode = 'TF001';
exception when insufficient_privilege then raise notice 'ok  na versão, só a nota pode ser editada direto';
end $$;

select public.enviar_plano('50000000-0000-0000-0000-000000000001');
select tests.ok((select status = 'aguardando_aprovacao' from public.plans where id = '50000000-0000-0000-0000-000000000001'),
  'plano enviado aguarda aprovação');
select tests.ok((select string_agg(nome || '=' || status, ' ' order by ordem) from public.plan_sections
                 where version_id = (select id from v1))
                = 'Capa e sumário=informativa Objetivos=pendente Personas=pendente Tom de voz=pendente',
  'capa fica informativa e as demais seções pendentes');
do $$ begin
  perform public.salvar_secoes_plano((select id from v1), '[{"nome":"x","pagina_inicio":1,"pagina_fim":12}]');
  raise exception 'FALHOU: mudou seções de versão enviada' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  versão enviada não muda';
end $$;
reset role;

-- ===================================================================
\echo '— Visão do cliente'
-- ===================================================================
select tests.login('cli_dasart');
set role authenticated;
select tests.ok((select count(*) = 0 from public.plans), 'cliente de outra empresa não vê o plano');
select tests.ok((select count(*) = 0 from storage.objects where bucket_id = 'planos'), 'nem o PDF');
reset role;

select tests.login('cli_nortis_leitor');
set role authenticated;
select tests.ok((select count(*) = 1 from public.plans), 'quem só acompanha vê o plano');
do $$ begin
  perform public.decidir_secao_plano(s.id, 'aprovada') from public.plan_sections s where s.nome = 'Objetivos';
  raise exception 'FALHOU: quem só acompanha decidiu' using errcode = 'TF001';
exception when insufficient_privilege then raise notice 'ok  quem só acompanha não decide';
end $$;
reset role;

select tests.login('cli_nortis');
set role authenticated;
select tests.ok((select count(*) = 1 from storage.objects where bucket_id = 'planos'), 'cliente vê o PDF enviado');
select tests.ok((select count(*) = 4 from public.plan_sections), 'cliente vê as seções');
select public.registrar_visualizacao_plano('50000000-0000-0000-0000-000000000001');
select tests.ok((select status = 'em_analise' and visualizado_em is not null from public.plans), 'abrir o plano marca "em análise"');
do $$ begin
  insert into storage.objects (bucket_id, name) values ('planos', tests.id('nortis') || '/50000000-0000-0000-0000-000000000001/meu.pdf');
  raise exception 'FALHOU: cliente subiu PDF' using errcode = 'TF001';
exception when insufficient_privilege then raise notice 'ok  cliente não sobe PDF';
end $$;
do $$ begin
  perform public.decidir_secao_plano(s.id, 'aprovada') from public.plan_sections s where s.nome = 'Capa e sumário';
  raise exception 'FALHOU: decidiu seção informativa' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  seção informativa não pede decisão';
end $$;
do $$ begin
  perform public.decidir_secao_plano(s.id, 'ajuste_solicitado', ' ') from public.plan_sections s where s.nome = 'Personas';
  raise exception 'FALHOU: pediu ajuste sem comentário' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  pedir ajuste exige comentário';
end $$;
do $$ begin
  perform public.decidir_secao_plano(s.id, 'ajuste_solicitado', 'Trocar a foto', array[3]) from public.plan_sections s where s.nome = 'Personas';
  raise exception 'FALHOU: citou slide de outra seção' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  slides citados precisam ser da seção';
end $$;

select tests.ok(public.decidir_secao_plano(s.id, 'aprovada') = 'em_analise', 'aprovar uma seção mantém o plano em análise')
  from public.plan_sections s where s.nome = 'Objetivos';
select tests.ok(public.decidir_secao_plano(s.id, 'ajuste_solicitado', 'Persona 2 está jovem demais', array[8, 7, 8]) = 'em_analise',
  'pedir ajuste citando slides')
  from public.plan_sections s where s.nome = 'Personas';
select tests.ok((select slides = array[7, 8] from public.plan_section_decisions where comentario like 'Persona 2%'),
  'slides citados ficam guardados em ordem e sem repetição');
-- Mudou de ideia enquanto ainda havia seção pendente.
select public.decidir_secao_plano(s.id, 'ajuste_solicitado', 'Rever objetivo 3') from public.plan_sections s where s.nome = 'Objetivos';
select public.decidir_secao_plano(s.id, 'aprovada') from public.plan_sections s where s.nome = 'Objetivos';
select tests.ok(public.decidir_secao_plano(s.id, 'aprovada') = 'ajustes_solicitados',
  'última seção decidida fecha a versão com ajustes solicitados')
  from public.plan_sections s where s.nome = 'Tom de voz';
select tests.ok((select status = 'concluida' from public.plan_versions), 'versão concluída');
select tests.ok((select count(*) = 5 from public.plan_section_decisions), 'todas as decisões registradas');
do $$ begin
  perform public.decidir_secao_plano(s.id, 'aprovada') from public.plan_sections s where s.nome = 'Personas';
  raise exception 'FALHOU: decidiu depois de fechado' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  depois de fechado, ninguém decide mais';
end $$;
do $$ begin
  update public.plan_section_decisions set comentario = 'outro';
  raise exception 'FALHOU: alterou decisão' using errcode = 'TF001';
exception when insufficient_privilege then raise notice 'ok  decisão é imutável';
end $$;
reset role;

-- ===================================================================
\echo '— Versão nova: só o que mudou volta para o cliente'
-- ===================================================================
select tests.login('equipe1');
set role authenticated;
create temporary table v2 as select public.nova_versao_plano('50000000-0000-0000-0000-000000000001', 'Ajustamos as personas') as id;
grant select on v2 to authenticated;
select tests.ok((select status = 'em_revisao_interna' from public.plans), 'plano volta para revisão interna');
select tests.ok((select string_agg(nome || '=' || (mantem_aprovacao_de is not null)::text, ' ' order by ordem)
                 from public.plan_sections where version_id = (select id from v2))
                = 'Capa e sumário=false Objetivos=true Personas=false Tom de voz=true',
  'versão nova já mantém a aprovação das seções aprovadas');
select tests.ok((select pdf_path is not null and paginas = 12 from public.plan_versions where id = (select id from v2)),
  'versão nova começa com o PDF anterior');

-- PDF novo com uma página a mais nas personas.
insert into storage.objects (bucket_id, name)
values ('planos', tests.id('nortis') || '/50000000-0000-0000-0000-000000000001/v2.pdf');
select public.definir_pdf_plano((select id from v2), tests.id('nortis') || '/50000000-0000-0000-0000-000000000001/v2.pdf', 13);
select tests.ok((select pagina_fim = 13 and mantem_aprovacao_de is null from public.plan_sections
                 where version_id = (select id from v2) and nome = 'Tom de voz'),
  'PDF maior: a última seção vai até o fim e, como mudou de tamanho, perde a aprovação mantida');
do $$ begin
  perform public.salvar_secoes_plano((select id from v2), jsonb_build_array(
    jsonb_build_object('nome','Capa e sumário','pagina_inicio',1,'pagina_fim',2,'requer_aprovacao',false),
    jsonb_build_object('nome','Objetivos','pagina_inicio',3,'pagina_fim',6,
      'mantem_aprovacao_de',(select id from public.plan_sections where version_id = (select id from v1) and nome = 'Objetivos')),
    jsonb_build_object('nome','Personas','pagina_inicio',7,'pagina_fim',10),
    jsonb_build_object('nome','Tom de voz','pagina_inicio',11,'pagina_fim',13)));
  raise exception 'FALHOU: manteve aprovação de seção que ganhou slide' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  seção que muda de número de slides não mantém a aprovação';
end $$;
do $$ begin
  perform public.salvar_secoes_plano((select id from v2), jsonb_build_array(
    jsonb_build_object('nome','Capa e sumário','pagina_inicio',1,'pagina_fim',2,'requer_aprovacao',false),
    jsonb_build_object('nome','Orçamento de mídia','pagina_inicio',3,'pagina_fim',5,
      'mantem_aprovacao_de',(select id from public.plan_sections where version_id = (select id from v1) and nome = 'Objetivos')),
    jsonb_build_object('nome','Personas','pagina_inicio',6,'pagina_fim',13)));
  raise exception 'FALHOU: manteve aprovação em seção de outro assunto' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  aprovação mantida só na seção de mesmo nome';
end $$;
do $$ begin
  perform set_config('app.transicao', 'on', true);
  update public.plans set status = 'aprovado' where id = '50000000-0000-0000-0000-000000000001';
  raise exception 'FALHOU: equipe forjou status ligando a variável do fluxo' using errcode = 'TF001';
exception when insufficient_privilege then raise notice 'ok  ligar app.transicao por conta própria não libera mudar status';
end $$;
do $$ begin
  perform public.salvar_secoes_plano((select id from v2), jsonb_build_array(
    jsonb_build_object('nome','Capa e sumário','pagina_inicio',1,'pagina_fim',2,'requer_aprovacao',false),
    jsonb_build_object('nome','Objetivos','pagina_inicio',3,'pagina_fim',5),
    jsonb_build_object('nome','Personas','pagina_inicio',6,'pagina_fim',10,
      'mantem_aprovacao_de',(select id from public.plan_sections where version_id = (select id from v1) and nome = 'Personas')),
    jsonb_build_object('nome','Tom de voz','pagina_inicio',11,'pagina_fim',13)));
  raise exception 'FALHOU: manteve aprovação de seção que pediu ajuste' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  só mantém aprovação de seção aprovada';
end $$;
select public.salvar_secoes_plano((select id from v2), jsonb_build_array(
  jsonb_build_object('nome','Capa e sumário','pagina_inicio',1,'pagina_fim',2,'requer_aprovacao',false),
  jsonb_build_object('nome','Objetivos','pagina_inicio',3,'pagina_fim',5,
    'mantem_aprovacao_de',(select id from public.plan_sections where version_id = (select id from v1) and nome = 'Objetivos')),
  jsonb_build_object('nome','Personas','pagina_inicio',6,'pagina_fim',10),
  jsonb_build_object('nome','Tom de voz','pagina_inicio',11,'pagina_fim',13,
    'mantem_aprovacao_de',(select id from public.plan_sections where version_id = (select id from v1) and nome = 'Tom de voz'))));
do $$ begin
  delete from storage.objects where bucket_id = 'planos' and name like '%/v1.pdf';
  raise exception 'FALHOU: apagou PDF de versão enviada' using errcode = 'TF001';
exception when others then
  if (select count(*) from storage.objects where bucket_id = 'planos' and name like '%/v1.pdf') = 1
  then raise notice 'ok  PDF usado por versão não é apagado'; else raise; end if;
end $$;
reset role;

select tests.login('cli_nortis');
set role authenticated;
select tests.ok((select count(*) = 1 from public.plan_versions), 'cliente não vê a versão em rascunho');
select tests.ok((select count(*) = 1 from storage.objects where bucket_id = 'planos'), 'nem o PDF novo antes do envio');
reset role;

select tests.login('equipe1');
set role authenticated;
select public.enviar_plano('50000000-0000-0000-0000-000000000001');
select tests.ok((select string_agg(nome || '=' || status, ' ' order by ordem) from public.plan_sections
                 where version_id = (select id from v2))
                = 'Capa e sumário=informativa Objetivos=aprovada Personas=pendente Tom de voz=aprovada',
  'na versão 2, só Personas volta para o cliente');
reset role;

select tests.login('cli_nortis');
set role authenticated;
do $$ begin
  perform public.decidir_secao_plano(s.id, 'ajuste_solicitado', 'Mudei de ideia')
    from public.plan_sections s where s.nome = 'Objetivos' and s.version_id = (select id from v2);
  raise exception 'FALHOU: redecidiu seção com aprovação mantida' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  seção com aprovação mantida não é decidida de novo';
end $$;
select tests.ok(public.decidir_secao_plano(s.id, 'aprovada') = 'aprovado', 'aprovar a última seção aprova o plano')
  from public.plan_sections s where s.nome = 'Personas' and s.version_id = (select id from v2);
select tests.ok((select status = 'aprovado' and concluido_em is not null from public.plans), 'plano aprovado');
select tests.ok((select count(*) = 2 from storage.objects where bucket_id = 'planos'), 'cliente vê os PDFs das duas versões');
reset role;

-- ===================================================================
\echo '— Aprovação de um plano não vale para outro'
-- ===================================================================
select tests.login('equipe1');
set role authenticated;
insert into public.plans (id, client_id, titulo)
values ('50000000-0000-0000-0000-000000000002', tests.id('nortis'), 'Plano de outro ano');
insert into storage.objects (bucket_id, name)
values ('planos', tests.id('nortis') || '/50000000-0000-0000-0000-000000000002/a.pdf');
select public.definir_pdf_plano(v.id, tests.id('nortis') || '/50000000-0000-0000-0000-000000000002/a.pdf', 3)
  from public.plan_versions v where v.plan_id = '50000000-0000-0000-0000-000000000002';
do $$ begin
  perform public.salvar_secoes_plano(v.id, jsonb_build_array(jsonb_build_object('nome','Objetivos','pagina_inicio',1,'pagina_fim',3,
    'mantem_aprovacao_de',(select id from public.plan_sections where version_id = (select id from v1) and nome = 'Objetivos'))))
    from public.plan_versions v where v.plan_id = '50000000-0000-0000-0000-000000000002';
  raise exception 'FALHOU: aproveitou aprovação de outro plano' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  aprovação de um plano não vale para outro';
end $$;
reset role;

-- ===================================================================
\echo '— Aprovação ainda não final não passa para a versão nova'
-- ===================================================================
select tests.login('equipe1');
set role authenticated;
select public.salvar_secoes_plano(v.id, '[{"nome":"Abertura","pagina_inicio":1,"pagina_fim":1},{"nome":"Metas","pagina_inicio":2,"pagina_fim":3}]')
  from public.plan_versions v where v.plan_id = '50000000-0000-0000-0000-000000000002';
select public.enviar_plano('50000000-0000-0000-0000-000000000002');
reset role;
select tests.login('cli_nortis');
set role authenticated;
select public.decidir_secao_plano(s.id, 'aprovada') from public.plan_sections s
  join public.plan_versions v on v.id = s.version_id
 where v.plan_id = '50000000-0000-0000-0000-000000000002' and s.nome = 'Abertura';
reset role;
select tests.login('equipe1');
set role authenticated;
create temporary table p2v2 as select public.nova_versao_plano('50000000-0000-0000-0000-000000000002') as id;
grant select on p2v2 to authenticated;
select tests.ok((select mantem_aprovacao_de is null from public.plan_sections where version_id = (select id from p2v2) and nome = 'Abertura'),
  'aprovação dada com seção ainda pendente volta para o cliente na versão nova');
do $$ begin
  perform public.salvar_secoes_plano((select id from p2v2), jsonb_build_array(
    jsonb_build_object('nome','Abertura','pagina_inicio',1,'pagina_fim',1,
      'mantem_aprovacao_de',(select s.id from public.plan_sections s join public.plan_versions v on v.id = s.version_id
                              where v.plan_id = '50000000-0000-0000-0000-000000000002' and v.numero = 1 and s.nome = 'Abertura')),
    jsonb_build_object('nome','Metas','pagina_inicio',2,'pagina_fim',3)));
  raise exception 'FALHOU: manteve aprovação não final' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  só mantém aprovação final';
end $$;
select public.enviar_plano('50000000-0000-0000-0000-000000000002');
reset role;
select tests.login('cli_nortis');
set role authenticated;
select public.decidir_secao_plano(s.id, 'ajuste_solicitado', 'Trocar a meta', array[null, 3]::integer[])
  from public.plan_sections s where s.version_id = (select id from p2v2) and s.nome = 'Metas';
select tests.ok((select slides = array[3] from public.plan_section_decisions where comentario = 'Trocar a meta'),
  'slide vazio na citação é ignorado');
reset role;

select tests.login('equipe1');
set role authenticated;
insert into public.plans (id, client_id, titulo)
values ('50000000-0000-0000-0000-000000000003', tests.id('nortis'), 'Plano interno que nunca foi enviado');
select public.cancelar_plano('50000000-0000-0000-0000-000000000003', 'Interno: segurar');
reset role;
select tests.login('cli_nortis');
set role authenticated;
select tests.ok(not exists (select 1 from public.plans where id = '50000000-0000-0000-0000-000000000003'),
  'plano cancelado antes de ser enviado não aparece para o cliente');
reset role;

-- A mesma regra vale para criativos e orçamentos (correção 008).
select tests.login('equipe1');
set role authenticated;
insert into public.creative_requests (id, client_id, titulo)
values ('50000000-0000-0000-0000-0000000000c1', tests.id('nortis'), 'Peças que nunca saíram');
select public.cancelar_solicitacao('50000000-0000-0000-0000-0000000000c1', 'Interno: segurar');
insert into public.budgets (id, client_id, mes_referencia) values ('50000000-0000-0000-0000-0000000000b1', tests.id('nortis'), '2027-03-01');
select public.cancelar_orcamento('50000000-0000-0000-0000-0000000000b1', 'Interno: segurar');
reset role;
select tests.login('cli_nortis');
set role authenticated;
select tests.ok(not exists (select 1 from public.creative_requests where id = '50000000-0000-0000-0000-0000000000c1'),
  'solicitação de criativos cancelada antes de ser enviada não aparece para o cliente');
select tests.ok(not exists (select 1 from public.budgets where id = '50000000-0000-0000-0000-0000000000b1'),
  'orçamento cancelado antes de ser enviado não aparece para o cliente');
reset role;

-- ===================================================================
\echo '— Versão nova sem nada para aprovar e cancelamento'
-- ===================================================================
select tests.login('equipe1');
set role authenticated;
select public.nova_versao_plano('50000000-0000-0000-0000-000000000001');
do $$ begin
  perform public.enviar_plano('50000000-0000-0000-0000-000000000001');
  raise exception 'FALHOU: enviou versão sem seção para aprovar' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  versão em que tudo mantém a aprovação não é enviada';
end $$;
do $$ begin
  perform public.cancelar_plano('50000000-0000-0000-0000-000000000001', '');
  raise exception 'FALHOU: cancelou sem motivo' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  cancelamento exige motivo';
end $$;
select public.cancelar_plano('50000000-0000-0000-0000-000000000001', 'Cliente pausou o projeto');
select tests.ok((select status = 'cancelado' from public.plans where id = '50000000-0000-0000-0000-000000000001'), 'plano cancelado');
do $$ begin
  insert into storage.objects (bucket_id, name) values ('planos', tests.id('nortis') || '/50000000-0000-0000-0000-000000000001/v3.pdf');
  raise exception 'FALHOU: subiu PDF em plano cancelado' using errcode = 'TF001';
exception when insufficient_privilege then raise notice 'ok  plano cancelado não recebe PDF';
end $$;
reset role;

select tests.login('admin');
set role authenticated;
select tests.ok((select count(*) >= 3 from public.audit_log where action like 'plano.decisao%'), 'decisões entram na auditoria');
reset role;
