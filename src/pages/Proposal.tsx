
export default function Proposal() {
  return (
    <div className="proposal-page bg-white text-gray-900 min-h-screen">
      {/* Header */}
      <header className="border-b-4 border-[hsl(220,60%,20%)] pb-6 mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-[hsl(220,60%,20%)] tracking-tight">PatentScope</h1>
            <p className="text-sm text-gray-500 mt-1">Soluções em Análise de Propriedade Intelectual</p>
          </div>
          <div className="text-right text-sm text-gray-500">
            <p className="font-semibold text-gray-700">PROPOSTA COMERCIAL</p>
            <p>Data: {new Date().toLocaleDateString('pt-BR')}</p>
            <p>Validade: 15 dias</p>
          </div>
        </div>
      </header>

      {/* Título */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-[hsl(220,60%,20%)] mb-2">
          Proposta de Desenvolvimento — Sistema de Pesquisa e Análise de Patentes
        </h2>
        <p className="text-gray-600 leading-relaxed">
          Este documento apresenta o detalhamento técnico e comercial para o desenvolvimento do sistema <strong>PatentScope</strong>, 
          uma plataforma web para apoio à pesquisa, análise prévia e geração de relatórios de evidências sobre patentes, 
          destinada a profissionais e escritórios de propriedade intelectual.
        </p>
      </section>

      {/* FASE 1 */}
      <section className="mb-10">
        <div className="bg-[hsl(220,60%,20%)] text-white px-4 py-2 rounded-t-lg">
          <h3 className="text-lg font-bold">FASE 1 — Desenvolvimento Completo do Sistema</h3>
        </div>
        <div className="border border-t-0 border-gray-300 rounded-b-lg p-6">
          
          <h4 className="font-bold text-gray-800 mb-3 text-base">1. Objetivo</h4>
          <p className="text-sm text-gray-700 mb-5 leading-relaxed">
            Desenvolver e entregar o sistema PatentScope em sua versão funcional completa, incluindo todas as funcionalidades 
            apresentadas no protótipo navegável, com integração real às bases de dados de patentes e geração automatizada de relatórios.
          </p>

          <h4 className="font-bold text-gray-800 mb-3 text-base">2. Escopo Funcional Detalhado</h4>
          
          <div className="space-y-4 mb-6">
            <div className="border-l-4 border-[hsl(185,70%,38%)] pl-4">
              <h5 className="font-semibold text-gray-800 text-sm">2.1 Autenticação e Controle de Acesso</h5>
              <ul className="text-sm text-gray-600 mt-1 list-disc pl-5 space-y-1">
                <li>Tela de login com autenticação segura (e-mail e senha)</li>
                <li>Gerenciamento de sessão do usuário</li>
                <li>Controle de acesso por perfil (administrador / analista)</li>
              </ul>
            </div>

            <div className="border-l-4 border-[hsl(185,70%,38%)] pl-4">
              <h5 className="font-semibold text-gray-800 text-sm">2.2 Dashboard e Gestão de Pesquisas</h5>
              <ul className="text-sm text-gray-600 mt-1 list-disc pl-5 space-y-1">
                <li>Painel com visão geral das pesquisas realizadas</li>
                <li>Listagem com filtros por data, status e título</li>
                <li>Status de cada pesquisa: Em Edição, Analisada, Finalizada</li>
                <li>Criação de novas pesquisas via botão dedicado</li>
              </ul>
            </div>

            <div className="border-l-4 border-[hsl(185,70%,38%)] pl-4">
              <h5 className="font-semibold text-gray-800 text-sm">2.3 Coleta de Briefing da Invenção</h5>
              <ul className="text-sm text-gray-600 mt-1 list-disc pl-5 space-y-1">
                <li>Upload de áudio com transcrição automática via modelo de IA local (on-premise, sem dependência de serviços externos)</li>
                <li>Campo de texto para digitação manual do briefing</li>
                <li>Processamento e organização automática do texto transcrito</li>
                <li>Tela de revisão e edição da transcrição</li>
              </ul>
            </div>

            <div className="border-l-4 border-[hsl(185,70%,38%)] pl-4">
              <h5 className="font-semibold text-gray-800 text-sm">2.4 Estruturação Técnica do Briefing</h5>
              <ul className="text-sm text-gray-600 mt-1 list-disc pl-5 space-y-1">
                <li>Extração automática via modelo de IA local dos campos: Problema Técnico, Solução Proposta, Diferenciais e Aplicações</li>
                <li>Campos editáveis para ajuste pelo analista</li>
                <li>Confirmação e validação do briefing estruturado</li>
              </ul>
            </div>

            <div className="border-l-4 border-[hsl(185,70%,38%)] pl-4">
              <h5 className="font-semibold text-gray-800 text-sm">2.5 Extração de Palavras-chave e Classificações</h5>
              <ul className="text-sm text-gray-600 mt-1 list-disc pl-5 space-y-1">
                <li>Geração automática de palavras-chave a partir do briefing via processamento de linguagem natural local</li>
                <li>Sugestão de classificações técnicas internacionais (IPC/CPC — ex: H04W, G06F)</li>
                <li>Interface com checkboxes para seleção, adição e remoção manual</li>
                <li>Definição da estratégia de busca pelo analista</li>
              </ul>
            </div>

            <div className="border-l-4 border-[hsl(185,70%,38%)] pl-4">
              <h5 className="font-semibold text-gray-800 text-sm">2.6 Integração com Bases de Patentes</h5>
              <ul className="text-sm text-gray-600 mt-1 list-disc pl-5 space-y-1">
                <li>Integração com a API do INPI (Instituto Nacional da Propriedade Industrial)</li>
                <li>Integração com a base Espacenet (European Patent Office — EPO OPS)</li>
                <li>Integração com 2 (duas) bases de patentes adicionais a serem definidas em conjunto com o contratante</li>
                <li>Busca automatizada por palavras-chave e classificações IPC/CPC</li>
                <li>Exibição dos resultados em abas separadas por base de dados</li>
                <li>Informações de cada patente: número, título e score de similaridade</li>
              </ul>
            </div>

            <div className="border-l-4 border-[hsl(185,70%,38%)] pl-4">
              <h5 className="font-semibold text-gray-800 text-sm">2.7 Análise de Similaridade Técnica</h5>
              <ul className="text-sm text-gray-600 mt-1 list-disc pl-5 space-y-1">
                <li>Ranqueamento automático das patentes por nível de risco (Alto, Médio, Baixo)</li>
                <li>Score de similaridade calculado via modelo de IA executado localmente</li>
                <li>Resumo técnico de cada patente identificada</li>
                <li>Justificativa textual da similaridade gerada por IA local</li>
              </ul>
            </div>

            <div className="border-l-4 border-[hsl(185,70%,38%)] pl-4">
              <h5 className="font-semibold text-gray-800 text-sm">2.8 Geração de Relatório de Evidências</h5>
              <ul className="text-sm text-gray-600 mt-1 list-disc pl-5 space-y-1">
                <li>Relatório consolidado com todos os dados da pesquisa</li>
                <li>Visualização em tela com formatação profissional</li>
                <li>Exportação em PDF com layout para impressão</li>
                <li>Inclusão automática de: briefing, palavras-chave, patentes encontradas, análise de risco e conclusão</li>
              </ul>
            </div>
          </div>

          <h4 className="font-bold text-gray-800 mb-3 text-base">3. Tecnologias Utilizadas</h4>
          <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
            <div>
              <p className="font-semibold text-gray-700">Front-end</p>
              <p className="text-gray-600">React, TypeScript, Tailwind CSS</p>
            </div>
            <div>
              <p className="font-semibold text-gray-700">Back-end</p>
              <p className="text-gray-600">Supabase (PostgreSQL, Auth, Edge Functions)</p>
            </div>
            <div>
              <p className="font-semibold text-gray-700">Inteligência Artificial</p>
              <p className="text-gray-600">Modelos de IA open-source executados localmente (on-premise) — sem dependência de APIs externas como OpenAI. Inclui modelos para transcrição de áudio, processamento de linguagem natural e análise de similaridade semântica.</p>
            </div>
            <div>
              <p className="font-semibold text-gray-700">APIs de Patentes</p>
              <p className="text-gray-600">INPI, Espacenet (EPO OPS) e 2 bases adicionais a definir</p>
            </div>
          </div>

          <h4 className="font-bold text-gray-800 mb-3 text-base">4. Entregáveis</h4>
          <ul className="text-sm text-gray-600 list-disc pl-5 space-y-1 mb-6">
            <li>Sistema web funcional hospedado e acessível via navegador</li>
            <li>Código-fonte completo e documentado</li>
            <li>Manual de uso do sistema</li>
            <li>Suporte técnico por 30 dias após a entrega</li>
          </ul>

          <h4 className="font-bold text-gray-800 mb-3 text-base">5. Prazo de Entrega</h4>
          <p className="text-sm text-gray-700 mb-6">
            <strong>30 (trinta) dias corridos</strong> a partir da data de assinatura do contrato e confirmação do pagamento da entrada.
          </p>

          <h4 className="font-bold text-gray-800 mb-3 text-base">6. Investimento — Fase 1</h4>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-5">
            <p className="text-2xl font-bold text-[hsl(220,60%,20%)] mb-4">R$ 17.000,00 <span className="text-sm font-normal text-gray-500">(dezessete mil reais)</span></p>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-300">
                  <th className="text-left py-2 font-semibold text-gray-700">Parcela</th>
                  <th className="text-left py-2 font-semibold text-gray-700">Valor</th>
                  <th className="text-left py-2 font-semibold text-gray-700">Vencimento</th>
                </tr>
              </thead>
              <tbody className="text-gray-600">
                <tr className="border-b border-gray-100">
                  <td className="py-2">Entrada</td>
                  <td className="py-2 font-semibold">R$ 7.000,00</td>
                  <td className="py-2">No ato da assinatura</td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="py-2">2ª Parcela</td>
                  <td className="py-2 font-semibold">R$ 5.000,00</td>
                  <td className="py-2">30 dias após assinatura</td>
                </tr>
                <tr>
                  <td className="py-2">3ª Parcela</td>
                  <td className="py-2 font-semibold">R$ 5.000,00</td>
                  <td className="py-2">60 dias após assinatura</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* FASE 2 */}
      <section className="mb-10 proposal-page-break">
        <div className="bg-[hsl(185,70%,38%)] text-white px-4 py-2 rounded-t-lg">
          <h3 className="text-lg font-bold">FASE 2 — Expansão Comercial e Multi-Tenant</h3>
        </div>
        <div className="border border-t-0 border-gray-300 rounded-b-lg p-6">
          
          <h4 className="font-bold text-gray-800 mb-3 text-base">1. Objetivo</h4>
          <p className="text-sm text-gray-700 mb-5 leading-relaxed">
            Aperfeiçoar o sistema PatentScope para comercialização, transformando-o em uma plataforma SaaS (Software as a Service) 
            com suporte a múltiplos usuários e organizações, incluindo sistema de pagamentos integrado para assinaturas.
          </p>

          <h4 className="font-bold text-gray-800 mb-3 text-base">2. Escopo Funcional Detalhado</h4>
          
          <div className="space-y-4 mb-6">
            <div className="border-l-4 border-[hsl(185,70%,38%)] pl-4">
              <h5 className="font-semibold text-gray-800 text-sm">2.1 Arquitetura Multi-Tenant</h5>
              <ul className="text-sm text-gray-600 mt-1 list-disc pl-5 space-y-1">
                <li>Isolamento de dados por organização/cliente</li>
                <li>Gestão de múltiplos usuários por tenant</li>
                <li>Painel administrativo para gestão de contas e permissões</li>
                <li>Onboarding automatizado de novos clientes</li>
              </ul>
            </div>

            <div className="border-l-4 border-[hsl(185,70%,38%)] pl-4">
              <h5 className="font-semibold text-gray-800 text-sm">2.2 Sistema de Checkout e Pagamentos</h5>
              <ul className="text-sm text-gray-600 mt-1 list-disc pl-5 space-y-1">
                <li>Integração com gateway de pagamento (Stripe)</li>
                <li>Planos de assinatura configuráveis (mensal/anual)</li>
                <li>Página de checkout e gestão de assinatura</li>
                <li>Controle de acesso baseado no plano contratado</li>
                <li>Emissão automática de recibos/faturas</li>
              </ul>
            </div>

            <div className="border-l-4 border-[hsl(185,70%,38%)] pl-4">
              <h5 className="font-semibold text-gray-800 text-sm">2.3 Melhorias para Comercialização</h5>
              <ul className="text-sm text-gray-600 mt-1 list-disc pl-5 space-y-1">
                <li>Landing page institucional e de conversão</li>
                <li>Registro self-service de novos usuários</li>
                <li>Dashboard administrativo com métricas de uso</li>
                <li>Otimizações de performance e escalabilidade</li>
              </ul>
            </div>
          </div>

          <h4 className="font-bold text-gray-800 mb-3 text-base">3. Prazo de Entrega</h4>
          <p className="text-sm text-gray-700 mb-6">
            <strong>15 (quinze) dias corridos</strong> a partir da conclusão e aceite da Fase 1.
          </p>

          <h4 className="font-bold text-gray-800 mb-3 text-base">4. Investimento — Fase 2</h4>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-5">
            <p className="text-2xl font-bold text-[hsl(185,70%,38%)] mb-4">R$ 6.000,00 <span className="text-sm font-normal text-gray-500">(seis mil reais)</span></p>
            <p className="text-sm text-gray-600">Condições de pagamento a serem definidas na contratação da Fase 2.</p>
          </div>
        </div>
      </section>

      {/* Resumo Total */}
      <section className="mb-10">
        <h4 className="font-bold text-gray-800 mb-3 text-base">Resumo do Investimento Total</h4>
        <div className="bg-[hsl(220,60%,20%)] text-white rounded-lg p-5">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/20">
                <th className="text-left py-2">Fase</th>
                <th className="text-left py-2">Escopo</th>
                <th className="text-left py-2">Prazo</th>
                <th className="text-right py-2">Valor</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-white/10">
                <td className="py-2">Fase 1</td>
                <td className="py-2">Desenvolvimento completo</td>
                <td className="py-2">30 dias</td>
                <td className="py-2 text-right font-semibold">R$ 17.000,00</td>
              </tr>
              <tr className="border-b border-white/10">
                <td className="py-2">Fase 2</td>
                <td className="py-2">Expansão comercial / SaaS</td>
                <td className="py-2">15 dias</td>
                <td className="py-2 text-right font-semibold">R$ 6.000,00</td>
              </tr>
              <tr>
                <td className="py-3 font-bold" colSpan={3}>TOTAL</td>
                <td className="py-3 text-right font-bold text-lg">R$ 23.000,00</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Termos */}
      <section className="mb-10 text-sm text-gray-600 leading-relaxed">
        <h4 className="font-bold text-gray-800 mb-3 text-base">Observações Gerais</h4>
        <ol className="list-decimal pl-5 space-y-2">
          <li>Os valores não incluem custos de infraestrutura de hospedagem e servidor para execução dos modelos de IA, APIs de terceiros (EPO, bases adicionais) ou taxas de gateway de pagamento, que serão de responsabilidade do contratante.</li>
          <li>Alterações de escopo solicitadas após a aprovação desta proposta poderão impactar prazos e valores, sendo renegociadas em comum acordo.</li>
          <li>O suporte técnico de 30 dias cobre correção de bugs e orientações de uso. Novas funcionalidades não previstas nesta proposta serão orçadas separadamente.</li>
          <li>A Fase 2 poderá ser contratada independentemente, desde que a Fase 1 esteja concluída e aceita.</li>
          <li>Esta proposta tem validade de 15 (quinze) dias a partir da data de emissão.</li>
        </ol>
      </section>


      {/* Print styles */}
      <style>{`
        @media print {
          body { background: white !important; }
          .proposal-page { 
            padding: 0 !important; 
            font-size: 11pt;
          }
          .proposal-page-break { page-break-before: always; }
          @page { 
            margin: 2cm; 
            size: A4;
          }
        }
        @media screen {
          .proposal-page {
            max-width: 210mm;
            margin: 0 auto;
            padding: 40px;
            box-shadow: 0 0 20px rgba(0,0,0,0.1);
          }
        }
      `}</style>
    </div>
  );
}
