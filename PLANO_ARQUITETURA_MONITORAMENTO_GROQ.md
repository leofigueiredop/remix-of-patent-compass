# Plano Detalhado de Arquitetura de Monitoramento com Groq Cloud

## 1) Objetivo do documento
Definir a arquitetura da **camada de análise IA** dos monitoramentos (Colidência, Processo e Mercado), com foco no uso do **Groq Cloud já integrado**, para orientar implementação consistente e escalável.

Este plano não detalha a arquitetura interna do backend (fila, storage, workers, etc.), mas define o que a camada IA precisa receber, processar e devolver.

---

## 2) Escopo da camada IA
- Classificar relevância e prioridade das ocorrências.
- Gerar explicação objetiva para triagem humana.
- Produzir recomendação operacional acionável.
- Fornecer payload estruturado para CRM e comunicação com cliente.
- Garantir consistência entre tipos de monitoramento.

Fora de escopo:
- Gestão de infraestrutura de banco/filas.
- Regras jurídicas finais de decisão.
- Autonomia de fechamento sem validação humana.

---

## 3) Princípios de arquitetura IA
- **JSON-first**: saída sempre estruturada e parseável.
- **Determinismo operacional**: prompts e schemas versionados.
- **Camadas de score**: rule score + IA score + score final.
- **Fallback seguro**: falha de IA não interrompe operação.
- **Rastreabilidade**: prompt hash, versão, modelo, latência e custo lógico por ocorrência.

---

## 4) Macrofluxo de análise
1. Backend detecta ocorrência candidata (evento RPI + matching por perfil).
2. Backend envia payload canônico para camada IA.
3. Camada IA monta prompt por tipo (colidência/processo/mercado).
4. Chamada ao Groq Cloud.
5. Parser valida schema e normaliza campos.
6. Calcula score final com fórmula de composição.
7. Persistência do resultado e atualização de status da ocorrência.
8. Exposição para UI de triagem, ação e CRM.

---

## 5) Contrato canônico de entrada (IA Input Envelope)
Todos os tipos devem seguir envelope comum:

- `occurrence_id`
- `monitoring_type` (`collision | process | market`)
- `profile_context`
  - `profile_id`
  - `profile_name`
  - `sensitivity`
  - `rules_applied`
- `reference_context`
  - ativo monitorado (patente/empresa/titular/keyword)
- `candidate_context`
  - publicação/evento identificado na RPI
- `scores_pre_ai`
  - `rule_score`
  - `semantic_seed_score`
  - `legal_seed_score`
- `metadata`
  - `rpi_number`
  - `publication_date`
  - `source`
  - `schema_version`

---

## 6) Contrato canônico de saída (IA Output Envelope)
- `analysis_version`
- `monitoring_type`
- `relevance_score_0_100`
- `confidence_0_100`
- `risk_level` (`low | medium | high | critical`)
- `reasoning_summary` (2–5 frases)
- `key_signals` (lista curta)
- `recommended_action` (ação interna)
- `recommended_client_message` (linguagem simples)
- `structured_extras` (campos específicos por tipo)

Campos obrigatórios sempre presentes; ausências devem virar `null` explícito, nunca campo faltante.

---

## 7) Especialização por tipo de monitoramento

## 7.1 Colidência
### Entrada específica
- Lado A (ativo monitorado): título, resumo, IPC, titular, inventor, principais elementos técnicos.
- Lado B (publicação candidata): título, resumo, despacho, complemento, metadados bibliográficos.

### Saída específica (`structured_extras`)
- `novelty_overlap_score_0_100`
- `claims_overlap_proxy_score_0_100`
- `technical_proximity_score_0_100`
- `collision_focus` (o que colide)
- `differentiators` (o que diferencia)
- `escalation_recommendation` (seguir, revisar, escalar jurídico)

### UX-alvo
- Comparação lado a lado A/B pronta para decisão.

---

## 7.2 Processo
### Entrada específica
- Tipo de despacho/evento.
- Datas de publicação e prazo.
- Histórico resumido do ativo monitorado.

### Saída específica (`structured_extras`)
- `event_classification` (exigência, anuidade, petição de terceiro, deferimento etc.)
- `urgency_score_0_100`
- `deadline_risk` (`none | low | medium | high`)
- `recommended_internal_action`
- `recommended_client_action`

### UX-alvo
- Fila processual com prioridade de ação e SLA.

---

## 7.3 Mercado
### Entrada específica
- Entidades monitoradas (empresa, inventor, keywords, patente âncora).
- Escopo da watchlist.

### Saída específica (`structured_extras`)
- `market_signal_type`
- `importance_score_0_100`
- `entity_impacted`
- `cluster_summary`
- `why_it_matters`
- `recommended_followup`

### UX-alvo
- Feed de sinais relevantes com narrativa executiva curta.

---

## 8) Estratégia de prompting
Ter prompts versionados por tipo:
- `prompt_collision_v1`
- `prompt_process_v1`
- `prompt_market_v1`

Cada prompt deve conter:
- instruções de papel (analista PI sênior),
- regras de não alucinação,
- formato JSON estrito,
- exemplos de saída mínima.

Adicionar `system_prompt` global:
- linguagem PT-BR,
- objetividade,
- foco em decisão operacional,
- declarar insuficiência de dados quando necessário.

---

## 9) Parsing, validação e normalização
- Validar JSON de saída contra schema.
- Se inválido: tentativa de reparo leve.
- Se persistir inválido: fallback para saída mínima segura.
- Normalizar scores para 0–100.
- Mapear `risk_level` por thresholds padrão.
- Registrar `parse_status` (`ok | repaired | failed_fallback`).

---

## 10) Composição de score final
Modelo recomendado:
- `final_score = 0.40 * rule_score + 0.35 * semantic_score + 0.25 * legal_score`

Onde:
- `rule_score`: matching determinístico.
- `semantic_score`: retorno IA de aderência semântica.
- `legal_score`: retorno IA de risco processual/jurídico proxy.

Faixas de prioridade:
- `critical` >= 86
- `high` 70–85
- `medium` 50–69
- `low` < 50

---

## 11) Cache de análise IA
Objetivo: reduzir custo, latência e variação.

Chave de cache recomendada:
- hash de (`monitoring_type + reference_context + candidate_context + rules_applied + prompt_version`)

Política:
- reutilizar análise quando contexto semântico não mudou;
- invalidar cache quando mudar versão de prompt/modelo/regras.

---

## 12) Resiliência e fallback
- Timeout por chamada IA.
- Retry com backoff curto.
- Circuit breaker por tipo de monitoramento.
- Se IA indisponível:
  - manter ocorrência viva com `ia_status=error`,
  - preservar rule score,
  - permitir triagem manual imediata.

---

## 13) Observabilidade da camada IA
Para cada execução registrar:
- `occurrence_id`
- `monitoring_type`
- `model_name`
- `prompt_version`
- `latency_ms`
- `parse_status`
- `token_usage` (quando disponível)
- `cache_hit`
- `ia_status`

Dashboards recomendados:
- taxa de sucesso de parse,
- latência p50/p95,
- taxa de fallback,
- distribuição de score por tipo,
- conversão para demanda por faixa de score.

---

## 14) Segurança e governança
- Remover dados sensíveis desnecessários do payload IA.
- Limitar contexto ao mínimo necessário.
- Versionar prompts e schemas.
- Trilhar auditoria de “quem decidiu o quê” após recomendação IA.

---

## 15) Plano de rollout
### Fase 1 — Colidência
- Padronizar entrada/saída e comparação A/B.
- Medir qualidade de score e utilidade da explicação.

### Fase 2 — Processo
- Taxonomia de eventos + urgência + ação recomendada.

### Fase 3 — Mercado
- Sinais com clusterização e relevância operacional.

### Fase 4 — Otimização
- Ajuste fino de prompts/thresholds com feedback de triagem.

---

## 16) Critérios de aceite (produto + IA)
- Toda ocorrência processada possui saída estruturada válida.
- IA explica “por que” e “o que fazer” de forma acionável.
- Score final é consistente entre execuções equivalentes.
- Falhas de IA não bloqueiam operação.
- Triagem humana fica mais rápida e com menor retrabalho.

---

## 17) Entregáveis para a task técnica de backend
Este plano deve ser traduzido em:
- contratos de payload (input/output envelopes),
- schemas de validação,
- versionamento de prompt,
- tabela/campos de telemetria de IA,
- políticas de cache e fallback.

Com isso, frontend e backend conseguem evoluir em paralelo com um contrato único de inteligência.
