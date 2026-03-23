# Coolify - API e Worker Separados

## Objetivo
Rodar API e workers em serviços separados, usando a mesma database e mantendo o painel atual da aplicação para controle de filas.

## Serviço 1 - API
- Repositório: mesmo monorepo
- Dockerfile: `backend/Dockerfile`
- Docker Build Stage Target: `api`
- Start command: `npx prisma migrate deploy && BACKGROUND_WORKERS_ROLE=api node dist/server.js`
- Variáveis: mesmas já usadas hoje (`DATABASE_URL`, `S3_*`, `OPS_*`, `INPI_*`, `JWT_SECRET`, etc.)

## Serviço 2 - Worker
- Repositório: mesmo monorepo
- Dockerfile: `backend/Dockerfile`
- Docker Build Stage Target: `worker`
- Start command: manter padrão do Dockerfile (não usar post-deploy para subir worker)
- Variáveis: mesmas da API (`DATABASE_URL`, `S3_*`, `OPS_*`, `INPI_*`, `JWT_SECRET`, etc.)

## Redis
- Subir Redis no Coolify e manter URL interna disponível para próximo passo de migração para BullMQ.
- Nesta etapa de split, workers continuam usando a mesma base de dados (sem trocar pipeline de filas ainda).

## Comportamento esperado
- Com `BACKGROUND_WORKERS_ROLE=api`, a API não executa loops de worker.
- Com `BACKGROUND_WORKERS_ROLE=worker`, o serviço worker executa loops de filas.
- Controles da UI continuam funcionais:
  - Pausa/retomada de filas do background agora persistem em tabela `background_worker_control`.
  - Estado de fila exibido na UI continua vindo da API e usa contagem da base quando API está em modo `api`.

## Rollout sugerido
1. Deploy da API com `BACKGROUND_WORKERS_ROLE=api`.
2. Deploy do Worker com `BACKGROUND_WORKERS_ROLE=worker`.
3. Confirmar em `/background-workers/state` que há execução só via worker.
4. Usar tela atual de workers para pausar/retomar e reprocessar.
