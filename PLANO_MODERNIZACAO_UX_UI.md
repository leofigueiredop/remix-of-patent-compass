# Plano de Modernização UX/UI (Operações, Pesquisa, Monitoramentos e CRM)

## Objetivo
Organizar e modernizar a experiência das telas operacionais do sistema, reduzindo confusão em cabeçalhos, ações e filtros, melhorando leitura de dados críticos e preparando componentes reutilizáveis para crescimento do produto.

---

## Escopo desta rodada
- Padronização visual e funcional de telas tipo dashboard e listas operacionais.
- Evolução forte da tela de Pesquisa Avançada (Nova Pesquisa e fluxo de pesquisa).
- Reorganização da Saúde do Sistema para leitura de risco e ação.
- Ajustes estruturais no CRM para aderência ao negócio de PI.
- Base para templates de e-mail e configuração de gatilhos.

---

## Princípios de desenho
- Hierarquia clara: contexto > métricas > ações > dados detalhados.
- Uma ação principal por contexto, secundárias agrupadas.
- Menos ruído de UI: reduzir botões concorrentes no mesmo nível visual.
- Leitura em varredura: informações-chave em 5–10 segundos.
- Consistência de padrões entre telas.
- Estados explícitos: loading, vazio, erro, sucesso e bloqueio.

---

## Bloco A — Padronização Cross-Screen (todas as telas operacionais)

### Resultado esperado
Toda tela operacional passa a ter o mesmo padrão mental de navegação e operação.

### Tasks detalhadas
1. Definir estrutura fixa de topo para telas operacionais:
   - Título.
   - Subtítulo de propósito.
   - KPIs sintéticos.
   - Barra de ações.
2. Criar padrão único de action bar:
   - Ação primária destacada.
   - Ações secundárias em grupo.
   - Ações destrutivas separadas visualmente.
3. Criar padrão único de filtros:
   - Busca textual.
   - Filtros avançados em dropdown/painel.
   - Chips de filtros ativos.
   - Limpar filtros.
   - Persistência de filtros na URL.
4. Criar padrão único de listas/tabelas:
   - Largura total útil.
   - Colunas com min-width.
   - Número/id sem quebra.
   - Ações por linha consistentes.
5. Criar e aplicar estados visuais padronizados:
   - Skeleton.
   - Empty state com CTA.
   - Erro com ação de retry.
   - Estado de sucesso discreto.
6. Consolidar tipografia e espaçamento:
   - Escalas de título/subtítulo.
   - Distâncias entre blocos.
   - Densidade de tabela por tipo de tela.

### Critérios de conclusão
- Em qualquer tela operacional, o usuário entende “onde está” e “o que fazer” em até 3 segundos.
- Não existem padrões diferentes de filtros e ações para telas equivalentes.

---

## Bloco B — Pesquisa Avançada (Nova Pesquisa + fluxo de análise)

### Resultado esperado
Fluxo de pesquisa mais claro, moderno e eficiente, sem gargalo visual no início da jornada.

### Tasks detalhadas
1. Redesenhar o topo do fluxo de pesquisa:
   - Stepper compacto, legível e com estado atual forte.
   - Passos futuros com baixa ênfase.
2. Reorganizar entrada de dados do briefing:
   - Cards de entrada (áudio, arquivos, digitação) com comportamento uniforme.
   - Feedback de seleção ativo/inativo.
   - Microcopy objetiva para orientar o preenchimento.
3. Melhorar área de descrição técnica:
   - Campo com altura adequada.
   - Indicadores de progresso (ex.: conteúdo mínimo recomendado).
   - Salvamento automático.
4. Reorganizar ações da etapa:
   - Botão principal único por etapa.
   - Botões secundários com menor peso.
5. Melhorar transições de etapa:
   - Persistir dados entre etapas sem perda.
   - Estados de carregamento contextualizados.
6. Revisar telas derivadas do fluxo:
   - Resultados.
   - Análise.
   - Relatório.
   - Garantir consistência de layout com o novo padrão.

### Critérios de conclusão
- Usuário inicia uma pesquisa sem dúvidas de fluxo.
- Queda de erro operacional por “clique errado” em ações de etapa.

---

## Bloco C — Saúde do Sistema (System Health)

### Resultado esperado
Tela deixa de ser “painel estático” e vira console de decisão operacional.

### Tasks detalhadas
1. Reorganizar cards de integrações:
   - Status técnico.
   - Último heartbeat.
   - Latência/tempo de resposta.
   - Impacto no negócio quando indisponível.
2. Criar seção “Ações necessárias agora”:
   - Lista de pendências priorizadas.
   - CTA de correção por item.
3. Estruturar timeline de sincronizações:
   - Últimas execuções.
   - Duração.
   - Resultado.
   - Próxima execução.
4. Padronizar semântica de risco:
   - Crítico.
   - Atenção.
   - Operacional.
5. Melhorar mensagens de erro:
   - Texto técnico curto.
   - Orientação prática de próximo passo.
6. Ajustar atualização manual/automática:
   - Auto refresh configurável.
   - Indicador visual de última atualização da tela.

### Critérios de conclusão
- Em 10 segundos o operador identifica problema e ação.
- Menos dependência de leitura de logs brutos.

---

## Bloco D — CRM aderente ao negócio de PI

### Resultado esperado
CRM passa a refletir natureza jurídica/operacional de Patente, Marca e DI.

### Tasks detalhadas
1. Adicionar segmentação obrigatória por tipo PI:
   - Patente.
   - Marca.
   - DI.
2. Aplicar segmentação em entidades centrais:
   - Cadastro de cliente.
   - Cadastro de demanda.
   - Pipeline.
3. Incluir filtros por tipo PI no CRM:
   - Lista de clientes.
   - Lista de demandas.
   - Visão kanban/lista.
4. Ajustar campos e labels por tipo:
   - Patente: dados processuais e despacho.
   - Marca: classes e estado de exame.
   - DI: dados de desenho industrial.
5. Revisar pipeline para suportar variações:
   - Colunas base comuns.
   - Variações por tipo sem quebrar UX.
6. Melhorar visualização de prioridade/SLA:
   - SLA por tipo PI.
   - Alertas visuais por atraso.

### Critérios de conclusão
- Usuário consegue operar carteira mista (Patente/Marca/DI) sem workaround manual.
- O pipeline não mistura contextos de negócio de forma confusa.

---

## Bloco E — Templates de e-mail e gatilhos (CRM)

### Resultado esperado
Envio de comunicação padronizada, escalável e configurável sem atrito.

### Tasks detalhadas
1. Criar biblioteca de templates:
   - Template base com logo.
   - Assinatura padrão da empresa.
   - Cabeçalho/rodapé institucional.
2. Criar suporte a variáveis de substituição:
   - Cliente.
   - Demanda.
   - Prazo.
   - Responsável.
   - Status.
3. Criar UI simples de edição:
   - Editor com preview.
   - Lista de variáveis disponíveis.
   - Teste rápido de render.
4. Criar gestão de versões de template:
   - Rascunho/publicado.
   - Histórico de alteração.
5. Criar tela de gatilhos simplificada:
   - Evento.
   - Condição.
   - Template.
   - Destinatário.
6. Criar gatilhos iniciais de alto valor:
   - Mudança de etapa.
   - SLA próximo do vencimento.
   - Atraso crítico.
   - Retorno pendente do cliente.

### Critérios de conclusão
- Usuário cria template reutilizável sem depender de edição manual externa.
- Gatilhos básicos ficam operacionais para rotinas principais.

---

## Bloco F — Componentização e reuso

### Resultado esperado
Redução de divergência visual e aumento da velocidade de entrega.

### Tasks detalhadas
1. Extrair componentes compartilhados:
   - Header operacional.
   - Action bar.
   - Filter bar.
   - KPI card.
   - Data table operacional.
2. Criar variações controladas:
   - Densidade compacta/normal.
   - Estado simples/avançado.
3. Definir contrato de props e estados:
   - loading.
   - empty.
   - error.
   - disabled.
4. Revisar páginas existentes para troca gradual:
   - Dashboard.
   - Monitoramentos.
   - Base.
   - Operações.
   - CRM.
5. Documentar uso interno de componentes:
   - Quando usar cada bloco.
   - Exemplo mínimo de composição.

### Critérios de conclusão
- Novas telas seguem padrão sem retrabalho de UX.
- Redução de inconsistências de cabeçalho/filtro/lista entre módulos.

---

## Sequência recomendada de execução
1. Bloco A (fundação visual).
2. Bloco B (Pesquisa Avançada).
3. Bloco C (Saúde do Sistema).
4. Bloco D (CRM segmentado por tipo PI).
5. Bloco E (templates e gatilhos).
6. Bloco F (componentização e consolidação final).

---

## Checklist de validação final (global)
- Cabeçalhos e ações consistentes em todas as telas.
- Filtros claros, persistentes e sem ambiguidades.
- Tabelas aproveitando largura com leitura estável.
- Pesquisa avançada fluida e com progressão clara.
- Saúde do sistema orientada à ação.
- CRM com separação Patente/Marca/DI aplicada em clientes e pipeline.
- Templates e gatilhos prontos para uso operacional.
- Padrões reaproveitáveis documentados e adotados.
