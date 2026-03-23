# Estratégia de Produto — Monitoramentos (Colidência, Processo e Mercado)

## 1) Visão de Produto
Construir um sistema de monitoramento de PI que transforma RPI semanal em decisões acionáveis, com análise assistida por IA, priorização por risco e execução operacional integrada ao CRM.

Objetivo central: reduzir tempo entre “publicação no INPI” e “ação correta do time/cliente”.

---

## 2) Problema de Negócio
Hoje o volume de publicações e eventos é alto, a leitura manual é custosa e a resposta operacional tende a atrasar.  
O produto precisa:
- filtrar o que realmente importa;
- explicar por que importa;
- recomendar a ação mais adequada;
- permitir execução imediata (triagem, envio, demanda CRM).

---

## 3) Princípios de Produto
- Decisão primeiro, dado depois.
- IA como copiloto, não caixa-preta.
- Um pipeline comum para todos os monitoramentos.
- Menos fricção entre alerta e execução.
- Rastreabilidade completa (o que entrou, por que foi priorizado, quem decidiu, resultado).

---

## 4) Arquitetura de Fluxo (produto)
Fluxo único para os 3 tipos:

1. **Ingestão RPI**
2. **Enriquecimento de dados da publicação**
3. **Matching por perfis de monitoramento**
4. **Scoring inicial**
5. **Análise IA contextual**
6. **Ocorrência pronta para triagem**
7. **Ação operacional (CRM, envio cliente, descarte, revisão)**
8. **Feedback para aprendizado de regra/prompt**

---

## 5) Definição de cada monitoramento

## 5.1 Colidência
### Intenção
Detectar conflito potencial entre ativos monitorados e novas publicações relevantes.

### Unidade de análise
Comparação **lado A (ativo monitorado)** vs **lado B (publicação candidata)**.

### Resultado esperado
- score de colidência;
- explicação objetiva do que colide e por quê;
- recomendação de ação (investigar, monitorar, escalar jurídico, descartar).

### Saída ideal para a operação
- cartão de ocorrência com score e risco;
- modal de comparação A/B;
- resumo executivo pronto para triagem interna e comunicação com cliente.

---

## 5.2 Processo
### Intenção
Detectar eventos processuais relevantes em ativos monitorados para evitar perda de prazo e garantir reação rápida.

### Unidade de análise
Evento processual do INPI (despacho, exigência, petição, anuidade, manifestação de terceiro etc).

### Resultado esperado
- classificação do evento (tipo e urgência);
- impacto operacional;
- próxima ação recomendada;
- decisão de conversão em demanda CRM.

### Saída ideal para a operação
- fila priorizada por urgência/SLA;
- trilha de eventos por patente;
- conversão em demanda com contexto já preenchido.

---

## 5.3 Mercado
### Intenção
Gerar inteligência competitiva contínua baseada em sinais de RPI ligados a titulares, inventores, empresas, patentes e keywords.

### Unidade de análise
Sinal de mercado associado a watchlist/perfil de interesse.

### Resultado esperado
- relevância do sinal;
- entidade impactada;
- por que importa para o cliente;
- sugestão de follow-up (analisar, consolidar tendência, alertar cliente).

### Saída ideal para a operação
- feed de sinais com clusterização;
- alertas com explicação curta;
- rotina de monitoramento concorrencial recorrente.

---

## 6) Modelo de Decisão Operacional (comum)
Para cada ocorrência:
- **Relevância** (0–100)
- **Risco/Urgência** (baixo, médio, alto, crítico)
- **Confiança da análise**
- **Resumo em linguagem simples**
- **Ação recomendada**

Estados de operação:
- pendente triagem
- em revisão
- relevante
- enviado ao cliente
- convertido em demanda
- descartado
- fechado

---

## 7) Integração com CRM (valor de negócio)
Toda ocorrência relevante deve ter caminho curto para execução:
- criar demanda automaticamente ou com 1 clique;
- preencher contexto mínimo automaticamente;
- manter vínculo ocorrência ↔ demanda para rastreabilidade;
- permitir retorno do cliente e retroalimentação.

Segmentação de carteira:
- Patente
- Marca
- DI

---

## 8) Estratégia de IA (produto)
IA deve atuar em 3 camadas:
- **camada de interpretação**: resumir evento/comparação;
- **camada de justificativa**: explicar fatores de score;
- **camada de recomendação**: próxima ação objetiva.

Regras de qualidade:
- saída estruturada;
- sem alucinação factual;
- indicação explícita de insuficiência de dados;
- texto acionável para time não técnico.

---

## 9) Métricas de sucesso (produto)
Métricas primárias:
- tempo médio da publicação até triagem;
- taxa de ocorrência relevante;
- taxa de conversão ocorrência → demanda;
- SLA cumprido em eventos processuais críticos.

Métricas de qualidade:
- precisão percebida da IA na triagem;
- taxa de retrabalho de triagem;
- taxa de descarte após envio ao cliente;
- confiança operacional por tipo de monitoramento.

---

## 10) Roadmap estratégico (sem detalhe técnico)
### Fase 1 — Fechar Colidência
- comparação A/B obrigatória;
- score + explicação + recomendação confiáveis;
- triagem e decisão com baixo esforço.

### Fase 2 — Fechar Processo
- taxonomia de eventos processuais;
- urgência e prazo operacionais claros;
- conversão CRM robusta.

### Fase 3 — Escalar Mercado
- watchlists maduras;
- sinais consolidados por tema/entidade;
- inteligência concorrencial contínua.

### Fase 4 — Governança e aprendizado
- feedback loop das decisões;
- ajuste de regras e prompts;
- aumento contínuo da qualidade de priorização.

---

## 11) O que “produto pronto” significa
Quando estiver maduro, o sistema deve permitir:
- processar RPI sem análise manual extensiva;
- destacar apenas o que exige ação;
- explicar de forma simples e confiável;
- converter impacto em execução (CRM/cliente) rapidamente;
- aprender com decisões para melhorar a próxima semana.

---

## 12) Alinhamento final para squads técnico
Este documento é intencionalmente estratégico e orientado a operação.  
Frontend e backend devem detalhar implementação técnica mantendo:
- pipeline único;
- experiência de triagem consistente;
- rastreabilidade de ponta a ponta;
- foco em decisão e velocidade operacional.

---

## 13) Diagnóstico técnico do backend atual (base existente)
Estado atual útil para evolução:
- já existe pipeline de ingestão RPI, enriquecimento e filas de background;
- já existe camada de monitoramento com perfis, ocorrências, ações e integração CRM;
- já existe base de IA conectável (endpoint de análise por ocorrência), porém acoplada ao fluxo síncrono;
- já existe estrutura de status e score inicial para triagem.

Limitações técnicas a resolver antes de escalar:
- API monolítica concentrada em um único arquivo grande, com alto acoplamento de domínio;
- criação/alteração de tabelas em runtime via SQL dinâmico, sem governança formal de migração;
- coexistência de dois fluxos de monitoramento (alertas legados e central de ocorrências);
- ausência de contratos versionados de eventos internos entre ingestão, triagem e CRM;
- baixa separação entre regra determinística, orquestração operacional e camada IA.

Direção arquitetural:
- estabilizar primeiro a espinha dorsal transacional e operacional;
- manter IA como plug-in desacoplado por contrato;
- preparar backend para acoplar Groq Cloud sem retrabalho de domínio.

---

## 14) Arquitetura alvo do backend (sem detalhar motor IA)
### 14.1 Bounded contexts
Separar backend em módulos de domínio explícitos:
- **Ingestion Context**: RPI import, parsing, deduplicação e enriquecimento técnico;
- **Monitoring Context**: perfis, matching determinístico, score inicial, criação de ocorrência;
- **Triage Context**: fila de decisão, mudança de estado, atribuição, feedback interno/cliente;
- **CRM Context**: conversão de ocorrência em demanda, histórico, contatos e roteamento;
- **Notification Context**: pré-visualização e envio, logs de entrega e gatilhos;
- **AI Orchestration Context**: apenas contrato de entrada/saída e status de execução.

### 14.2 Camadas internas
Cada contexto deve seguir padrão:
1. **Route layer** (HTTP, validação de input/output, autenticação/autorização);
2. **Application layer** (casos de uso e regras de transição);
3. **Domain layer** (estado, invariantes, priorização, políticas de SLA);
4. **Infrastructure layer** (Prisma/SQL, fila, adapters externos INPI/OPS/Groq).

### 14.3 Estilo de comunicação
- síncrono para operações de UI (consultas, comandos de triagem, CRUD de perfil);
- assíncrono para pipeline pesado (RPI → matching → ocorrência → análise IA → ações automáticas);
- eventos internos versionados para evitar acoplamento entre módulos.

---

## 15) Modelo de dados alvo (evolução controlada)
### 15.1 Entidades centrais permanentes
- `monitoring_profiles`: perfil de monitoramento por cliente/ativo/watchlist;
- `monitoring_occurrences`: unidade operacional de decisão;
- `monitoring_occurrence_feedback`: trilha de aprendizado humano;
- `monitoring_rpi_runs`: auditoria de execução por RPI;
- `crm_demands` e histórico/comentários/anexos: execução comercial-operacional.

### 15.2 Tabelas de suporte operacional
- `client_contacts` e `client_routing_rules`: destino automático por tipo de ocorrência;
- `system_settings`: templates, workflows e integrações;
- `inpi_publication`, `inpi_patents` e jobs técnicos: base de origem do pipeline.

### 15.3 Ajustes necessários no schema
- formalizar enums de estado e prioridade;
- adicionar `idempotency_key` para comandos críticos (criar demanda, enviar cliente);
- adicionar `processing_stage` e `stage_timestamps` na ocorrência para rastrear funil;
- adicionar `retry_count`, `last_error_code` e `next_retry_at` para robustez;
- criar tabela de `monitoring_occurrence_events` para trilha de eventos imutável.

### 15.4 Estratégia de migração
- substituir DDL em runtime por migrations versionadas;
- manter backward compatibility com rollout em duas etapas:
  1) criar campos novos e dupla escrita;
  2) migrar leitura e remover legado.

---

## 16) Pipeline backend de ponta a ponta (alvo)
### 16.1 Pipeline operacional
1. **Importação RPI**: worker baixa ZIP/XML e normaliza publicações;
2. **Enriquecimento**: complementa dados bibliográficos por fontes externas;
3. **Matching determinístico**: aplica regras por perfil ativo;
4. **Scoring inicial**: calcula `rule_score`, `semantic_seed`, `legal_seed`, `final_seed`;
5. **Persistência de ocorrência**: cria ocorrência com estado `pending_triage`;
6. **Orquestração IA (assíncrona)**: envia envelope padronizado e atualiza `ia_status`;
7. **Triage operacional**: analista aplica ação (relevante, descarte, revisão, demanda);
8. **Execução CRM/Cliente**: gera demanda, envia comunicação, registra retorno;
9. **Feedback loop**: grava decisão e impacto para ajuste de regra/prompt.

### 16.2 Regras de idempotência
- ocorrência deve ser única por chave operacional:
  `profile_id + publication_id + event_type + rpi_number`;
- ações de comando com risco de duplicidade exigem token idempotente;
- reprocessamento deve ser seguro sem duplicar demanda ou envio.

### 16.3 Regras de fallback
- falha de IA não bloqueia triagem;
- falha de integração de e-mail não perde estado da ocorrência;
- falha de CRM cria evento de compensação para nova tentativa.

---

## 17) Contratos de API backend (versão alvo)
Padronizar namespace `/api/v1/monitoring` com sub-recursos:
- `GET /dashboard`
- `GET/POST /profiles`
- `PATCH /profiles/:id`
- `POST /profiles/:id/toggle`
- `POST /rpi/process`
- `GET /occurrences`
- `GET /occurrences/:id`
- `POST /occurrences/:id/actions`
- `POST /occurrences/:id/analyze-ai` (orquestração)
- `GET /occurrences/:id/email-preview`

Contratos transversais:
- payloads validados por schema;
- responses com `request_id` e `trace_id`;
- erros padronizados com `code`, `message`, `details`, `retryable`.

Integração CRM:
- `POST /crm/demands/from-occurrence`
- `POST /crm/demands/bulk-from-occurrence`
- `PATCH /crm/demands/:id/status`

---

## 18) Segurança, governança e compliance
- aplicar RBAC mínimo: admin, operador, gestor;
- restringir endpoints de debug e segredos em produção;
- mascarar dados sensíveis em logs e payloads de erro;
- validar e sanitizar todos os campos textuais antes de persistir;
- reforçar política de CORS por ambiente;
- trilha de auditoria para toda mudança de status e ação operacional.

---

## 19) Observabilidade e SRE do monitoramento
### 19.1 Métricas essenciais
- ingestão: RPI processadas, taxa de erro por etapa, tempo por job;
- ocorrência: criadas por tipo, prioridade, status e idade;
- triagem: lead time de `pending_triage` até decisão;
- CRM: conversão para demanda, SLA estourado, backlog por responsável;
- IA: latência, parse success, fallback rate, impacto em conversão.

### 19.2 Logs e rastreio
- log estruturado com `request_id`, `occurrence_id`, `profile_id`, `rpi_number`;
- eventos de domínio para cada transição relevante;
- painéis por contexto (Ingestion, Monitoring, Triage, CRM, IA).

---

## 20) Plano de implementação backend (pré-IA)
### Fase A — Foundation
- modularizar backend por contexto;
- introduzir migrations formais;
- consolidar modelo único de ocorrência (descontinuar fluxo duplicado legado).

### Fase B — Core Monitoring
- fortalecer matching determinístico com regras versionadas por perfil;
- padronizar composição de score seed;
- garantir idempotência na criação de ocorrência.

### Fase C — Operação e CRM
- endurecer máquina de estados de triagem;
- formalizar comandos de ação (`mark_relevant`, `discard`, `create_demand`, `send_client`);
- completar rastreabilidade ocorrência ↔ demanda ↔ feedback.

### Fase D — Orquestração IA Plugável
- implementar adapter de IA por contrato (sem lógica de modelo no core);
- executar análise de IA por job assíncrono com retry e backoff;
- manter fallback de triagem manual sem bloqueio.

### Fase E — Hardening
- observabilidade completa, dashboards e alertas operacionais;
- testes de contrato API + testes de integração de pipeline;
- revisão de segurança, performance e políticas de retenção.

---

## 21) Critério de “backend pronto para conectar Groq Cloud”
O backend é considerado pronto quando:
- pipeline de ocorrência está estável, idempotente e auditável;
- estados operacionais e comandos de ação estão fechados;
- CRM recebe ocorrência com contexto completo e sem duplicidade;
- adapter de IA já consome/produz envelopes versionados;
- falha de IA não interrompe triagem e execução operacional;
- métricas e logs permitem operar com SLA e melhoria contínua.
