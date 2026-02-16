# CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE DESENVOLVIMENTO DE SOFTWARE E ACORDO DE CONFIDENCIALIDADE

Pelo presente instrumento particular, as partes abaixo qualificadas celebram entre si este Contrato de Prestação de Serviços de Desenvolvimento de Software ("Contrato"), que se regerá pelas cláusulas e condições seguintes:

## 1. DAS PARTES

**CONTRATANTE:**
**S/SIMOES SERVICOS DE PROPRIEDADE INDUSTRIAL**, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº **35.700.906/0001-01**, doravante denominada simplesmente **CONTRATANTE**.

**CONTRATADA:**
**SEAFEET - SERVICOS DE EDUCACAO E ASSISTENCIA FIT E TECH LTDA - ME**, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº **42.792.893/0001-03**, doravante denominada simplesmente **CONTRATADA**.

## 2. DO OBJETO

2.1. O objeto deste Contrato é a prestação de serviços de desenvolvimento de software pela CONTRATADA à CONTRATANTE, especificamente para a criação do sistema denominado **"PatentScope"** (ou "Projeto"), uma plataforma web para apoio à pesquisa, análise prévia e geração de relatórios de evidências sobre patentes.

2.2. O desenvolvimento será dividido em 2 (duas) Fases, conforme detalhado na Cláusula 3.

## 3. DO ESCOPO E DAS FASES DO PROJETO

O Projeto será executado em duas fases distintas, englobando as seguintes funcionalidades e características técnicas, baseadas na proposta técnica aprovada:

### FASE 1 - Desenvolvimento Completo do Sistema (MVP)

*   **Autenticação e Controle de Acesso:** Login seguro, gestão de sessão e perfis (admin/analista).
*   **Dashboard:** Gestão de pesquisas com filtros e status.
*   **Coleta de Briefing:** Upload de áudio com transcrição (IA Local), entrada de texto, processamento e revisão.
*   **Estruturação Técnica:** Extração automática de campos (Problema, Solução, Diferenciais) via IA Local.
*   **Extração de Palavras-chave/Classificação:** Sugestão automática de IPC/CPC e keywords.
*   **Integração com Bases:** INPI, Espacenet (EPO OPS) e até 2 bases adicionais definidas em conjunto.
*   **Análise de Similaridade:** Cálculo de score, ranqueamento de risco e justificativa via IA Local.
*   **Relatórios:** Geração de relatório consolidado e exportação em PDF.
*   **Tecnologias:** React, TypeScript, Tailwind CSS, Supabase, Modelos de IA On-premise.

### FASE 2 - Expansão Comercial e Multi-Tenant

*   **Arquitetura Multi-Tenant:** Isolamento de dados por cliente/organização.
*   **Sistema de Pagamentos:** Integração com Gateway (ex: Stripe), planos de assinatura, checkout e emissão de recibos.
*   **Comercialização:** Landing page institucional, registro self-service, dashboard administrativo de métricas.

## 4. DOS PRAZOS, ENTREGAS E HOMOLOGAÇÃO

4.1. O cronograma de execução obedecerá aos seguintes prazos:

**FASE 1:**
*   **Desenvolvimento:** 30 (trinta) dias corridos, contados a partir da assinatura deste contrato e confirmação do pagamento inicial.
*   **Homologação:** 30 (trinta) dias corridos, contados a partir da entrega da versão de desenvolvimento da Fase 1.

**FASE 2:**
*   **Desenvolvimento:** 15 (quinze) dias corridos, iniciando-se imediatamente após a conclusão da Homologação da Fase 1 ou em data acordada entre as partes.
*   **Homologação:** 30 (trinta) dias corridos, contados a partir da entrega da versão de desenvolvimento da Fase 2.

4.2. **DA HOMOLOGAÇÃO:** Durante os períodos de homologação, a CONTRATANTE testará o sistema.
*   **Parágrafo Único:** A CONTRATADA se obriga a realizar os ajustes e correções apontados pela CONTRATANTE durante a homologação, **incluindo alterações de maior complexidade que se revelem necessárias a partir da percepção de uso nos testes**, sem custo adicional, visando a plena aderência ao objetivo do produto.

## 5. DO PREÇO E DA FORMA DE PAGAMENTO

5.1. Pelo desenvolvimento das Fases 1 e 2, a CONTRATANTE pagará à CONTRATADA o valor total de **R$ 23.000,00 (Vinte e três mil reais)**, parcelado da seguinte forma:

*   **1ª Parcela:** **R$ 5.000,00 (Cinco mil reais)**, a ser paga no ato da assinatura deste contrato.
*   **2ª Parcela:** **R$ 6.000,00 (Seis mil reais)**, com vencimento em **07 de abril**.
*   **3ª Parcela:** **R$ 6.000,00 (Seis mil reais)**, com vencimento em **07 de maio**.
*   **4ª Parcela:** **R$ 6.000,00 (Seis mil reais)**, com vencimento em **07 de junho**.

5.2. A partir do mês de **Julho**, iniciará a cobrança de **Suporte e Manutenção** mensal.
*   **Valor Mensal:** **R$ 300,00 (Trezentos reais)**.
*   **Vencimento:** Todo dia **07 (sete)** de cada mês.
*   O suporte garantirá a disponibilidade do serviço, correções de bugs e manutenção da infraestrutura básica (excluindo custos de terceiros como servidores/cloud, que são de responsabilidade da CONTRATANTE, se aplicável).

## 6. DAS OBRIGAÇÕES

6.1. **Da CONTRATADA:**
    a) Executar os serviços com zelo e competência técnica.
    b) Entregar os códigos-fonte e documentação ao final do projeto.
    c) Respeitar os prazos estipulados.
    d) Manter sigilo absoluto sobre o projeto.

6.2. **Da CONTRATANTE:**
    a) Efetuar os pagamentos nas datas aprazadas.
    b) Fornecer informações e acessos necessários para o desenvolvimento.
    c) Realizar os testes de homologação dentro dos prazos estipulados.
    d) Arcar com custos de infraestrutura em nuvem (AWS, Google Cloud, etc.) ou APIs pagas, se houver, salvo se acordado o uso de infraestrutura da Contratada incluso no suporte.

## 7. DA CONFIDENCIALIDADE E NÃO DIVULGAÇÃO (NDA)

7.1. As partes reconhecem que, em virtude deste Contrato, a CONTRATADA terá acesso a Informações Confidenciais da CONTRATANTE, incluindo, mas não se limitando a: ideias de negócio, lógica de algoritmos, estratégias de inovação, dados de clientes e detalhes técnicos do "PatentScope".

7.2. A CONTRATADA compromete-se a:
    a) Não divulgar, revelar, reproduzir ou disponibilizar qualquer Informação Confidencial a terceiros sem a prévia autorização por escrito da CONTRATANTE.
    b) Utilizar as Informações Confidenciais exclusivamente para os fins de execução deste Contrato.
    c) Adotar todas as medidas de segurança razoáveis para proteger as Informações Confidenciais.

7.3. A obrigação de confidencialidade permanecerá vigente mesmo após o término deste contrato, por um período de **5 (cinco) anos**.

7.4. A quebra deste dever de sigilo sujeitará a parte infratora ao pagamento de perdas e danos comprovados, além das medidas judiciais cabíveis.

## 8. DA PROPRIEDADE INTELECTUAL

8.1. Todo o código-fonte, design, banco de dados e documentação desenvolvidos por força deste contrato serão de propriedade exclusiva da **CONTRATANTE** após a quitação integral dos valores descritos na Cláusula 5.1.

8.2. A CONTRATADA transfere, neste ato (condicionado ao pagamento), todos os direitos patrimoniais de autor sobre o software desenvolvido.

## 9. DA RESCISÃO

9.1. O presente contrato poderá ser rescindido por qualquer das partes, mediante aviso prévio por escrito de 30 (trinta) dias.

9.2. Em caso de rescisão antecipada por parte da CONTRATANTE, serão devidos os valores proporcionais às fases ou etapas já concluídas ou em andamento.

## 10. DO FORO

10.1. As partes elegem o foro da Comarca de [CIDADE/UF da Contratante ou Contratada], para dirimir quaisquer dúvidas oriundas deste Contrato.

E, por estarem assim justas e contratadas, assinam o presente em 2 (duas) vias de igual teor.

Local e Data: ______________________, _____ de ___________________ de 2026.

<br>
<br>

________________________________________________
**CONTRATANTE**
S/SIMOES SERVICOS DE PROPRIEDADE INDUSTRIAL
CNPJ: 35.700.906/0001-01

<br>
<br>

________________________________________________
**CONTRATADA**
SEAFEET - SERVICOS DE EDUCACAO E ASSISTENCIA FIT E TECH LTDA - ME
CNPJ: 42.792.893/0001-03
