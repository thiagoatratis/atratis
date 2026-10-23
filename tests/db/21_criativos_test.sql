-- Testes da etapa 2: fluxo de aprovação de criativos. Conecta como "authenticator".
\set ON_ERROR_STOP on
set client_min_messages = notice;

-- O teste 20 desativou a equipe1; reativa para este teste.
select tests.login('admin');
set role authenticated;
update public.profiles set ativo = true where id = tests.id('equipe1');
reset role;

-- ===================================================================
\echo '— Equipe monta a solicitação (rascunho)'
-- ===================================================================
select tests.login('equipe1');
set role authenticated;

insert into public.campaigns (id, client_id, nome, objetivo)
values ('10000000-0000-0000-0000-0000000000c1', tests.id('nortis'), 'Conta de luz', 'Leads');

insert into public.creative_requests (id, client_id, campaign_id, titulo, status, enviado_em, instrucoes_cliente)
values ('10000000-0000-0000-0000-000000000001', tests.id('nortis'), '10000000-0000-0000-0000-0000000000c1',
        'Criativos de novembro', 'aprovado', now(), 'Confira os textos.');
select tests.ok((select status from public.creative_requests where id = '10000000-0000-0000-0000-000000000001') = 'rascunho',
  'solicitação nasce como rascunho mesmo se tentarem outro status');
select tests.ok((select enviado_em from public.creative_requests where id = '10000000-0000-0000-0000-000000000001') is null,
  'data de envio não pode ser preenchida à mão');

insert into public.creative_request_internal (request_id, observacoes_internas)
values ('10000000-0000-0000-0000-000000000001', 'Margem apertada, não comentar com o cliente');

insert into public.creative_pieces (id, request_id, nome, canal, formato, ordem) values
  ('10000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 'Conta na mão', 'Meta Ads', 'Feed', 1),
  ('10000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000001', 'Vídeo prazo', 'Meta Ads', 'Reels', 2);

insert into public.piece_versions (id, piece_id, tipo, link_url) values
  ('10000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'link', 'https://figma.com/arquivo');

-- arquivo: primeiro o upload no Storage, depois a versão
insert into storage.objects (bucket_id, name)
values ('criativos', tests.id('nortis') || '/10000000-0000-0000-0000-000000000001/10000000-0000-0000-0000-00000000000b/v1.mp4');
insert into public.piece_versions (id, piece_id, tipo, storage_path, nome_arquivo, mime_type, tamanho_bytes) values
  ('10000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', 'arquivo',
   tests.id('nortis') || '/10000000-0000-0000-0000-000000000001/10000000-0000-0000-0000-00000000000b/v1.mp4',
   'video.mp4', 'video/mp4', 1048576);
select tests.ok((select numero from public.piece_versions where id = '10000000-0000-0000-0000-0000000000b1') = 1,
  'primeira versão recebe o número 1');

do $$ begin
  insert into public.piece_versions (piece_id, tipo, link_url)
  values ('10000000-0000-0000-0000-00000000000a', 'link', 'https://outro.com');
  raise exception 'FALHOU: criou segunda versão com rascunho aberto' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  não cria versão nova enquanto há rascunho';
end $$;

do $$ begin
  insert into public.piece_versions (piece_id, tipo, storage_path, mime_type)
  values ('10000000-0000-0000-0000-00000000000b', 'arquivo', 'x/y/z.exe', 'application/x-msdownload');
  raise exception 'FALHOU: aceitou arquivo executável' using errcode = 'TF001';
exception when check_violation or raise_exception then raise notice 'ok  só aceita JPG, PNG, WEBP, MP4 e PDF';
end $$;

do $$ begin
  update public.creative_requests set status = 'aprovado' where id = '10000000-0000-0000-0000-000000000001';
  raise exception 'FALHOU: equipe mudou status direto' using errcode = 'TF001';
exception when insufficient_privilege then raise notice 'ok  status não muda direto na tabela';
end $$;

do $$ begin
  insert into storage.objects (bucket_id, name)
  values ('criativos', tests.id('dasart') || '/10000000-0000-0000-0000-000000000001/x/y.png');
  raise exception 'FALHOU: enviou arquivo para pasta de outro cliente' using errcode = 'TF001';
exception when insufficient_privilege then raise notice 'ok  equipe não envia arquivo para cliente sem acesso';
end $$;
reset role;

-- ===================================================================
\echo '— Rascunho é invisível para o cliente e para quem não tem acesso'
-- ===================================================================
select tests.login('cli_nortis');
set role authenticated;
select tests.ok((select count(*) from public.creative_requests) = 0, 'cliente não vê solicitação em rascunho');
select tests.ok((select count(*) from storage.objects where bucket_id = 'criativos') = 0, 'nem os arquivos do rascunho');
reset role;

select tests.login('equipe2');
set role authenticated;
select tests.ok((select count(*) from public.creative_requests) = 0, 'equipe sem acesso ao cliente não vê a solicitação');
reset role;

-- ===================================================================
\echo '— Envio para aprovação'
-- ===================================================================
select tests.login('equipe1');
set role authenticated;
select tests.ok(public.enviar_solicitacao('10000000-0000-0000-0000-000000000001') = 'aguardando_aprovacao',
  'enviar coloca em "aguardando aprovação"');
select tests.ok((select count(*) from public.piece_versions where status = 'pendente') = 2, 'as duas versões ficam pendentes');
do $$ begin
  perform public.enviar_solicitacao('10000000-0000-0000-0000-000000000001');
  raise exception 'FALHOU: reenviou sem nada novo' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  não reenvia sem peça ou versão nova';
end $$;
do $$ begin
  update public.piece_versions set link_url = 'https://trocado.com' where id = '10000000-0000-0000-0000-0000000000a1';
  raise exception 'FALHOU: alterou versão já enviada' using errcode = 'TF001';
exception when insufficient_privilege then raise notice 'ok  versão enviada não pode ser alterada';
end $$;
reset role;

-- ===================================================================
\echo '— Cliente vê e decide'
-- ===================================================================
select tests.login('cli_dasart');
set role authenticated;
select tests.ok((select count(*) from public.creative_requests) = 0, 'cliente de outra empresa não vê nada');
select tests.ok((select count(*) from storage.objects where bucket_id = 'criativos') = 0, 'nem arquivos');
reset role;

select tests.login('cli_nortis_leitor');
set role authenticated;
select tests.ok((select count(*) from public.creative_pieces) = 2, 'quem só visualiza vê as peças');
do $$ begin
  perform public.decidir_versao('10000000-0000-0000-0000-0000000000a1', 'aprovado');
  raise exception 'FALHOU: leitor aprovou' using errcode = 'TF001';
exception when insufficient_privilege then raise notice 'ok  quem só visualiza não aprova';
end $$;
reset role;

select tests.login('cli_nortis');
set role authenticated;
select tests.ok((select count(*) from public.creative_requests) = 1, 'cliente vê a solicitação enviada');
select tests.ok((select count(*) from public.creative_request_internal) = 0, 'cliente não vê observações internas');
select tests.ok((select count(*) from storage.objects where bucket_id = 'criativos') = 1, 'cliente lê o arquivo enviado');
select public.registrar_visualizacao('10000000-0000-0000-0000-000000000001');
select tests.ok((select status from public.creative_requests) = 'em_analise', 'ao abrir, fica "em análise pelo cliente"');

select tests.ok(public.decidir_versao('10000000-0000-0000-0000-0000000000a1', 'aprovado') = 'em_analise',
  'aprovar uma peça mantém em análise enquanto houver outra pendente');
do $$ begin
  perform public.decidir_versao('10000000-0000-0000-0000-0000000000b1', 'alteracoes_solicitadas', '');
  raise exception 'FALHOU: pediu alteração sem dizer o quê' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  pedido de alteração exige descrição';
end $$;
select tests.ok(public.decidir_versao('10000000-0000-0000-0000-0000000000b1', 'alteracoes_solicitadas', 'Trocar a trilha') = 'alteracoes_solicitadas',
  'devolver uma peça deixa a solicitação em "alterações solicitadas"');
select tests.ok((select status from public.piece_versions where id = '10000000-0000-0000-0000-0000000000a1') = 'aprovado',
  'a aprovação da outra peça é preservada');
do $$ begin
  perform public.decidir_versao('10000000-0000-0000-0000-0000000000a1', 'alteracoes_solicitadas', 'mudei de ideia');
  raise exception 'FALHOU: decidiu duas vezes' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  peça já decidida não recebe outra decisão';
end $$;

do $$ begin
  update public.approvals set decisao = 'aprovado';
  raise exception 'FALHOU: cliente reescreveu decisão' using errcode = 'TF001';
exception when insufficient_privilege then raise notice 'ok  cliente não altera o histórico de decisões';
end $$;
do $$ begin
  insert into public.approvals (version_id, piece_id, request_id, client_id, decisao)
  values ('10000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b',
          '10000000-0000-0000-0000-000000000001', tests.id('nortis'), 'aprovado');
  raise exception 'FALHOU: cliente gravou decisão direto' using errcode = 'TF001';
exception when insufficient_privilege then raise notice 'ok  decisão só pelo fluxo';
end $$;

insert into public.comments (request_id, piece_id, autor_id, corpo)
values ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000b', tests.id('admin'), 'Pode usar a trilha 2?');
select tests.ok((select autor_id from public.comments order by id desc limit 1) = tests.id('cli_nortis'),
  'comentário fica sempre no nome de quem está logado');
reset role;

-- ===================================================================
\echo '— Equipe corrige com versão nova'
-- ===================================================================
select tests.login('equipe1');
set role authenticated;
select tests.ok((select count(*) from public.approvals) = 2, 'equipe vê as decisões do cliente');
do $$ begin
  perform public.enviar_solicitacao('10000000-0000-0000-0000-000000000001');
  raise exception 'FALHOU: reenviou sem corrigir' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  não reenvia peça devolvida sem versão nova';
end $$;

insert into storage.objects (bucket_id, name)
values ('criativos', tests.id('nortis') || '/10000000-0000-0000-0000-000000000001/10000000-0000-0000-0000-00000000000b/v2.mp4');
insert into public.piece_versions (id, piece_id, tipo, storage_path, mime_type, observacao) values
  ('10000000-0000-0000-0000-0000000000b2', '10000000-0000-0000-0000-00000000000b', 'arquivo',
   tests.id('nortis') || '/10000000-0000-0000-0000-000000000001/10000000-0000-0000-0000-00000000000b/v2.mp4',
   'video/mp4', 'Trilha trocada');
select tests.ok((select numero = 2 and parent_version_id = '10000000-0000-0000-0000-0000000000b1' and status = 'rascunho'
                 from public.piece_versions where id = '10000000-0000-0000-0000-0000000000b2'),
  'versão 2 ligada à versão 1, em rascunho');
select tests.ok((select status from public.creative_requests) = 'em_revisao_interna', 'solicitação vai para "em revisão interna"');
reset role;

select tests.login('cli_nortis');
set role authenticated;
select tests.ok((select count(*) from public.piece_versions where piece_id = '10000000-0000-0000-0000-00000000000b') = 1,
  'cliente não vê a versão nova antes do reenvio');
select tests.ok((select count(*) from storage.objects where name like '%/v2.mp4') = 0, 'nem o arquivo dela');
reset role;

select tests.login('equipe1');
set role authenticated;
select tests.ok(public.enviar_solicitacao('10000000-0000-0000-0000-000000000001') = 'aguardando_aprovacao', 'reenvio funciona');
reset role;

select tests.login('cli_nortis');
set role authenticated;
select tests.ok(public.aprovar_pendentes('10000000-0000-0000-0000-000000000001') = 1, '"aprovar todas" aprova só o que está pendente');
select tests.ok((select status from public.creative_requests) = 'aprovado', 'tudo aprovado: solicitação aprovada');
reset role;

-- ===================================================================
\echo '— Alterar peça aprovada exige nova aprovação'
-- ===================================================================
select tests.login('equipe1');
set role authenticated;
insert into public.piece_versions (id, piece_id, tipo, link_url, status, enviado_em, decidido_em) values
  ('10000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'link', 'https://figma.com/v2',
   'aprovado', now(), now());
select tests.ok((select status = 'rascunho' and enviado_em is null and decidido_em is null
                 from public.piece_versions where id = '10000000-0000-0000-0000-0000000000a2'),
  'versão nova de peça aprovada não herda a aprovação, mesmo forçando');
select tests.ok((select status from public.piece_versions where id = '10000000-0000-0000-0000-0000000000a1') = 'aprovado',
  'a aprovação da versão anterior continua no histórico');
select tests.ok((select status from public.creative_requests) = 'em_revisao_interna', 'solicitação volta para revisão');

do $$ begin
  perform public.cancelar_solicitacao('10000000-0000-0000-0000-000000000001', '');
  raise exception 'FALHOU: cancelou sem motivo' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  cancelamento exige motivo';
end $$;
select public.cancelar_solicitacao('10000000-0000-0000-0000-000000000001', 'Campanha suspensa pelo cliente');
select tests.ok((select status from public.creative_requests) = 'cancelado', 'solicitação cancelada');
do $$ begin
  insert into public.creative_pieces (request_id, nome, canal, formato)
  values ('10000000-0000-0000-0000-000000000001', 'Nova', 'Meta Ads', 'Feed');
  raise exception 'FALHOU: adicionou peça em solicitação cancelada' using errcode = 'TF001';
exception when insufficient_privilege then raise notice 'ok  solicitação cancelada não recebe peça';
end $$;
reset role;

select tests.login('cli_nortis');
set role authenticated;
do $$ begin
  insert into public.comments (request_id, corpo) values ('10000000-0000-0000-0000-000000000001', 'oi');
  raise exception 'FALHOU: comentou em cancelada' using errcode = 'TF001';
exception when insufficient_privilege then raise notice 'ok  sem comentários em solicitação cancelada';
end $$;
do $$ begin
  insert into storage.objects (bucket_id, name)
  values ('criativos', tests.id('nortis') || '/10000000-0000-0000-0000-000000000001/x/hack.png');
  raise exception 'FALHOU: cliente enviou arquivo' using errcode = 'TF001';
exception when insufficient_privilege then raise notice 'ok  cliente não envia arquivos';
end $$;
reset role;

-- ===================================================================
\echo '— Histórico'
-- ===================================================================
select tests.login('admin');
set role authenticated;
select tests.ok((select count(*) from public.audit_log where action = 'decisao.criado'
                 and actor_id = tests.id('cli_nortis') and client_id = tests.id('nortis')) = 3,
  'cada decisão do cliente fica no histórico com autor');
select tests.ok(exists (select 1 from public.audit_log where action = 'solicitacao.alterado'
                        and details -> 'alteracoes' -> 'status' ->> 'para' = 'cancelado'
                        and actor_id = tests.id('equipe1')),
  'o cancelamento fica no histórico com autor');
reset role;
select tests.logout();
