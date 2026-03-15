# Fluxo de Processamento RPI (3 Workers)

## Worker 1 - RPI Processing
- Lê ZIP/XML da RPI.
- Processa 100% dos despachos e grava em `InpiPublication` com:
  - número normalizado da patente (`patent_number`)
  - código/descrição/comentário/data
  - flag `eligible_for_doc_download`.
- Se despacho for `3.1` ou `16.1`:
  - cria/atualiza `InpiPatent` por número de patente
  - vincula histórico ao `patent_id`
  - cria/atualiza `DocumentDownloadJob`.
- Se despacho não for `3.1/16.1`:
  - mantém apenas histórico/referência
  - cria/atualiza `OpsBibliographicJob`.

## Worker 2 - Documentos e Figuras
- Consome `DocumentDownloadJob`.
- Resolve DOCDB no OPS.
- Baixa `FullDocument`, `Drawing` e `FirstPageClipping`.
- Salva no bucket:
  - `patent-docs/{numero}/full_document.pdf`
  - `patent-docs/{numero}/drawings.pdf`
  - `patent-docs/{numero}/first_page.pdf`.

## Worker 3 - Bibliografia OPS
- Consome `OpsBibliographicJob`.
- Consulta OPS bibliográfico sem baixar PDF.
- Atualiza `InpiPublication` (`ops_title`, `ops_applicant`, `ops_inventor`, `ops_ipc`, `ops_docdb_id`).
- Se patente já existir, enriquece campos vazios em `InpiPatent`.

## Operação
- Script de migração/rebuild: `npm run pipeline:rebuild` (em `backend`).
- O script:
  - limpa filas (`RpiImportJob`, `DocumentDownloadJob`, `OpsBibliographicJob`)
  - remove patentes sem título
  - normaliza elegibilidade 3.1/16.1
  - reenfileira janela histórica (5 anos).

## Rastreabilidade
- Todo despacho é persistido em `InpiPublication`, mesmo sem criação de patente.
- Patente nasce na camada canônica quando surge despacho elegível (3.1/16.1).
- Histórico permanece íntegro e vinculável por `patent_number`.
