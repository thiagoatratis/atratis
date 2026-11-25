-- Voltar peça retirada (migration 015). Conecta como "authenticator".
\set ON_ERROR_STOP on
set client_min_messages = notice;

select tests.login('equipe1');
set role authenticated;
insert into public.creative_requests (id, client_id, titulo) values ('b0000000-0000-0000-0000-0000000000c1', tests.id('nortis'), 'Peças de abril');
insert into public.creative_pieces (id, request_id, nome, canal, formato, ordem) values
  ('b0000000-0000-0000-0000-0000000000d1', 'b0000000-0000-0000-0000-0000000000c1', 'Feed 1', 'Meta Ads', 'Feed', 1),
  ('b0000000-0000-0000-0000-0000000000d2', 'b0000000-0000-0000-0000-0000000000c1', 'Feed 2', 'Meta Ads', 'Feed', 2);
insert into public.piece_versions (piece_id, tipo, link_url) values
  ('b0000000-0000-0000-0000-0000000000d1', 'link', 'https://drive.google.com/a'),
  ('b0000000-0000-0000-0000-0000000000d2', 'link', 'https://drive.google.com/b');
select public.enviar_solicitacao('b0000000-0000-0000-0000-0000000000c1');
reset role;

select tests.login('cli_nortis');
set role authenticated;
select public.decidir_versao(v.id, 'aprovado', null) from public.piece_versions v where v.piece_id = 'b0000000-0000-0000-0000-0000000000d1';
reset role;

select tests.login('equipe1');
set role authenticated;
select tests.ok(public.retirar_peca('b0000000-0000-0000-0000-0000000000d2') = 'aprovado',
  'retirar a peça pendente deixa a solicitação aprovada');
select tests.ok(public.voltar_peca('b0000000-0000-0000-0000-0000000000d2') in ('aguardando_aprovacao', 'em_analise'),
  'peça volta e a solicitação volta a aguardar o cliente');
select tests.ok((select ativo from public.creative_pieces where id = 'b0000000-0000-0000-0000-0000000000d2')
            and (select status = 'pendente' from public.piece_versions where piece_id = 'b0000000-0000-0000-0000-0000000000d2'),
  'peça ativa de novo, com a mesma versão aguardando decisão');
do $$ begin
  perform public.voltar_peca('b0000000-0000-0000-0000-0000000000d2');
  raise exception 'FALHOU: voltou peça que já estava ativa' using errcode = 'TF001';
exception when raise_exception then raise notice 'ok  peça ativa não volta de novo';
end $$;
reset role;

select tests.login('equipe1');
set role authenticated;
select public.retirar_peca('b0000000-0000-0000-0000-0000000000d2');
reset role;
select tests.login('equipe2');
set role authenticated;
do $$ begin
  perform public.voltar_peca('b0000000-0000-0000-0000-0000000000d2');
  raise exception 'FALHOU: equipe sem acesso voltou a peça' using errcode = 'TF001';
exception when insufficient_privilege then raise notice 'ok  equipe sem acesso ao cliente não volta peça';
end $$;
reset role;
select tests.login('cli_nortis');
set role authenticated;
do $$ begin
  perform public.voltar_peca('b0000000-0000-0000-0000-0000000000d2');
  raise exception 'FALHOU: cliente voltou a peça' using errcode = 'TF001';
exception when insufficient_privilege then raise notice 'ok  cliente não volta peça';
end $$;
reset role;
