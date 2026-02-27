import { useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Download, Printer, FileText, ShieldCheck, MapPin, Bold, Italic, List, Share2, ChevronDown, ExternalLink, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import AppLayout from "@/components/AppLayout";
import WizardSteps from "@/components/WizardSteps";
import { useResearch } from "@/contexts/ResearchContext";
import { toast } from "sonner";

const steps = ["Briefing", "Transcrição", "Briefing Técnico", "Palavras-chave", "Resultados", "Análise", "Relatório"];

interface ReportPatent {
  id: string;
  publicationNumber: string;
  title: string;
  applicant: string;
  date: string;
  abstract: string;
  selected: boolean;
  riskLevel: "high" | "medium" | "low";
  score: number;
  comments: string;
  imageUrl?: string;
  url?: string;
  number?: string;
  classification?: string;
}

export default function Report() {
  const navigate = useNavigate();
  const location = useLocation();
  const reportRef = useRef<HTMLDivElement>(null);
  const { briefing, cqlQuery, strategy } = useResearch();
  const patents: ReportPatent[] = location.state?.patents || [];

  const [isExporting, setIsExporting] = useState(false);

  // Derive invention title from briefing
  const inventionTitle = briefing?.solucaoProposta
    ? briefing.solucaoProposta.substring(0, 80).toUpperCase()
    : "INVENÇÃO EM ANÁLISE";

  const handlePrint = () => {
    window.print();
  };

  const execCommand = (command: string, value: string | undefined = undefined) => {
    document.execCommand(command, false, value);
  };

  const handleExportWord = () => {
    if (!reportRef.current) return;

    setIsExporting(true);
    toast.info("Preparando documento Word...");

    const header = "<html xmlns:o='urn:schemas-microsoft-com:office:office' " +
      "xmlns:w='urn:schemas-microsoft-com:office:word' " +
      "xmlns='http://www.w3.org/TR/REC-html40'>" +
      "<head><meta charset='utf-8'><title>Relatório de Patenteabilidade</title></head><body>";
    const footer = "</body></html>";
    const sourceHTML = header + reportRef.current.innerHTML + footer;

    const source = 'data:application/vnd.ms-word;charset=utf-8,' + encodeURIComponent(sourceHTML);
    const fileDownload = document.createElement("a");
    document.body.appendChild(fileDownload);
    fileDownload.href = source;
    fileDownload.download = `Relatorio_Patenteabilidade_${new Date().toISOString().split('T')[0]}.doc`;
    fileDownload.click();
    document.body.removeChild(fileDownload);

    setIsExporting(false);
    toast.success("Download iniciado!");
  };

  const highRiskPatents = patents.filter(p => p.riskLevel === "high");
  const mediumRiskPatents = patents.filter(p => p.riskLevel === "medium");
  const lowRiskPatents = patents.filter(p => p.riskLevel === "low");

  return (
    <AppLayout>
      <div className="print:hidden">
        <WizardSteps currentStep={6} steps={steps} />
      </div>

      <div className="max-w-5xl mx-auto pb-20 print:pb-0 print:max-w-none">
        {/* Editor Toolbar */}
        <div className="flex items-center justify-between mb-8 print:hidden sticky top-4 z-50 bg-background/80 backdrop-blur-md p-4 rounded-xl border shadow-lg">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-xl font-bold">Relatório Final</h1>
              <p className="text-muted-foreground text-[10px] uppercase tracking-wider font-bold">Modo Edição Ativo</p>
            </div>

            <Separator orientation="vertical" className="h-8 mx-2" />

            <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-lg">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => execCommand('bold')}>
                <Bold className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => execCommand('italic')}>
                <Italic className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => execCommand('insertUnorderedList')}>
                <List className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <div className="flex gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="gap-2 shadow-lg shadow-primary/20 bg-primary hover:bg-primary/90 transition-all">
                  <Download className="w-4 h-4" />
                  Exportar Relatório
                  <ChevronDown className="w-3 h-3 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={handlePrint} className="gap-2 cursor-pointer">
                  <Printer className="w-4 h-4 text-blue-500" />
                  <span>Salvar como PDF</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportWord} className="gap-2 cursor-pointer">
                  <FileText className="w-4 h-4 text-indigo-500" />
                  <span>Documento Word (.doc)</span>
                </DropdownMenuItem>
                <Separator className="my-1" />
                <DropdownMenuItem className="gap-2 cursor-pointer opacity-50" disabled>
                  <Share2 className="w-4 h-4" />
                  <span>Enviar por E-mail</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Report Document Sheet */}
        <div
          ref={reportRef}
          contentEditable
          suppressContentEditableWarning
          className="bg-white text-black rounded-sm shadow-2xl min-h-[29.7cm] p-[2.5cm] print:shadow-none print:p-0 print:w-full outline-none focus:ring-2 focus:ring-primary/20 transition-all duration-300"
        >

          {/* Header */}
          <div className="border-b-4 border-primary pb-4 mb-8 flex justify-between items-start print:border-black">
            <div>
              <h1 className="text-3xl font-black uppercase tracking-tighter text-primary print:text-black">PatentScope</h1>
              <p className="text-[10px] text-gray-400 font-bold mt-0.5 tracking-widest uppercase">Inteligência Avançada em Propriedade Industrial</p>
            </div>
            <div className="text-right text-[10px] text-gray-400 font-mono">
              <p className="font-bold text-gray-600">Ref: PESQ-{new Date().getFullYear()}-{String(Math.floor(Math.random() * 999) + 1).padStart(3, '0')}</p>
              <p>{new Date().toLocaleDateString("pt-BR")}</p>
              <p className="mt-1">{patents.length} doc(s) analisados</p>
            </div>
          </div>

          {/* Title Block */}
          <div className="text-center mb-12">
            <h2 className="text-xl font-bold border-y-2 border-gray-100 py-4 mb-4 uppercase tracking-tight">ESTUDO DE ANTERIORIDADE PARA ANÁLISE DE PATENTEABILIDADE</h2>
            <h3 className="text-sm font-semibold text-gray-500 mb-8 tracking-wide">
              OBJETO: "{inventionTitle}"
            </h3>
          </div>

          {/* 1. Briefing Técnico */}
          {briefing && (
            <section className="mb-10">
              <h4 className="font-black text-xs uppercase text-primary border-b border-gray-100 pb-1 mb-4 print:text-black">1. Descrição do Objeto</h4>
              <div className="pl-2 space-y-3 text-sm text-justify leading-relaxed">
                <div>
                  <strong className="text-xs text-gray-500">Problema Técnico:</strong>
                  <p>{briefing.problemaTecnico}</p>
                </div>
                <div>
                  <strong className="text-xs text-gray-500">Solução Proposta:</strong>
                  <p>{briefing.solucaoProposta}</p>
                </div>
                <div>
                  <strong className="text-xs text-gray-500">Diferenciais:</strong>
                  <p>{briefing.diferenciais}</p>
                </div>
                <div>
                  <strong className="text-xs text-gray-500">Aplicações:</strong>
                  <p>{briefing.aplicacoes}</p>
                </div>
              </div>
            </section>
          )}

          {/* 2. Metodologia */}
          <section className="mb-10">
            <h4 className="font-black text-xs uppercase text-primary border-b border-gray-100 pb-1 mb-4 print:text-black">
              {briefing ? "2" : "1"}. Metodologia e Estratégia de Busca
            </h4>
            <div className="text-sm text-justify leading-relaxed space-y-3">
              <p>
                A Lei de Propriedade Industrial (Lei nº 9.279/96) estabelece que pedidos de patentes são mantidos em sigilo por 18 meses a partir do depósito. Portanto, não é possível localizar documentos depositados neste período recente.
              </p>
              <p>
                Esta busca foi realizada utilizando estratégias de palavras-chave e classificações internacionais (IPC/CPC) em bases de dados oficiais do <strong>INPI</strong> (Brasil) e <strong>Espacenet</strong> (EPO), com análise de similaridade via inteligência artificial.
              </p>
              {strategy && (
                <div className="bg-gray-50 p-4 rounded-lg border border-gray-100 text-xs mt-2">
                  <p className="font-bold mb-1">Palavras-chave utilizadas:</p>
                  <p className="font-mono">{[...(strategy.keywords_pt || []), ...(strategy.keywords_en || [])].join(", ")}</p>
                  {strategy.ipc_codes?.length > 0 && (
                    <p className="mt-1 font-mono"><strong>Classificações IPC:</strong> {strategy.ipc_codes.join(", ")}</p>
                  )}
                  {cqlQuery && (
                    <p className="mt-1 font-mono text-[10px] text-gray-400 break-all"><strong>CQL:</strong> {cqlQuery}</p>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* 3. Resultados */}
          <section className="mb-10">
            <h4 className="font-black text-xs uppercase text-primary border-b border-gray-100 pb-1 mb-4 print:text-black">
              {briefing ? "3" : "2"}. Resultados - Documentos Relevantes
            </h4>
            <p className="text-sm mb-2">
              Foram selecionados <strong>{patents.length} documentos</strong> considerados relevantes após triagem:
              {highRiskPatents.length > 0 && <span className="text-red-600"> {highRiskPatents.length} alto risco</span>}
              {mediumRiskPatents.length > 0 && <span className="text-amber-600">{highRiskPatents.length > 0 ? "," : ""} {mediumRiskPatents.length} médio risco</span>}
              {lowRiskPatents.length > 0 && <span className="text-green-600">{(highRiskPatents.length > 0 || mediumRiskPatents.length > 0) ? "," : ""} {lowRiskPatents.length} baixo risco</span>}
              .
            </p>

            <div className="space-y-8">
              {patents.map((patent, index) => (
                <div key={index} className="border-l-4 border-gray-100 pl-6 py-4 rounded-r-lg break-inside-avoid print:border-black mb-10 bg-white shadow-sm border border-gray-100/50">
                  <div className="flex justify-between items-start mb-3">
                    <h5 className="font-bold text-sm leading-tight flex flex-col md:flex-row md:items-center gap-2">
                      <span>{briefing ? "3" : "2"}.{index + 1} {patent.publicationNumber} <span className="text-gray-400 font-normal mx-1">|</span> {patent.title}</span>
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const url = patent.url || `https://worldwide.espacenet.com/patent/search?q=${encodeURIComponent(patent.publicationNumber || patent.number || '')}`;
                          window.open(url, '_blank');
                        }}
                        className="inline-flex items-center gap-1.5 text-[10px] text-blue-600 hover:bg-blue-100 bg-blue-50 px-2.5 py-1 rounded-full border border-blue-200 print:hidden transition-colors w-max cursor-pointer"
                        contentEditable={false}
                      >
                        <ExternalLink className="w-3 h-3" />
                        Acessar Original
                      </button>
                    </h5>
                    <span className={`text-[9px] px-2 py-0.5 rounded-full text-white font-bold tracking-widest shrink-0 shadow-sm ${patent.riskLevel === "high" ? "bg-red-500" :
                      patent.riskLevel === "medium" ? "bg-amber-500" : "bg-emerald-500"
                      }`}>
                      {patent.riskLevel === "high" ? "ALTO RISCO" : patent.riskLevel === "medium" ? "MÉDIO RISCO" : "BAIXO RISCO"}
                      {patent.score > 0 ? ` (${patent.score}%)` : ""}
                    </span>
                  </div>

                  <div className="text-[10px] text-gray-400 mb-5 font-mono uppercase tracking-tighter">
                    <strong>Titular:</strong> {patent.applicant} <span className="mx-2">•</span>
                    <strong>Data:</strong> {patent.date || "N/A"}
                    {patent.classification && <><span className="mx-2">•</span><strong>IPC:</strong> {patent.classification}</>}
                  </div>

                  {/* Resumo da Patente */}
                  <div className="bg-gray-50/50 p-5 rounded-xl text-[11px] text-gray-600 text-justify italic border border-gray-100 print:bg-white leading-relaxed print:border-none print:p-0 mb-5">
                    <strong>Resumo do Documento:</strong><br /><br />
                    "{patent.abstract || 'Resumo não disponível.'}"
                  </div>

                  {patent.comments && (
                    <div className="text-sm mt-2 pt-4 border-t border-dashed border-gray-200 bg-amber-50/20 p-5 rounded-xl">
                      <p className="font-bold text-[10px] uppercase text-amber-600 mb-2 flex items-center gap-2">
                        <ShieldCheck className="w-3 h-3" /> Análise Técnica:
                      </p>
                      <p className="text-justify text-gray-800 leading-relaxed font-medium">{patent.comments}</p>
                    </div>
                  )}
                </div>
              ))}
              {patents.length === 0 && <p className="text-sm italic text-gray-500">Nenhum documento selecionado na análise.</p>}
            </div>
          </section>

          {/* 4. Parecer Técnico */}
          <section className="mb-10 break-inside-avoid">
            <h4 className="font-black text-xs uppercase text-primary border-b border-gray-100 pb-1 mb-4 print:text-black">
              {briefing ? "4" : "3"}. Parecer Técnico (Lei 9.279/96)
            </h4>
            <div className="space-y-6 text-sm text-justify leading-relaxed">
              <div>
                <strong className="text-xs uppercase tracking-tight block mb-1">
                  {briefing ? "4" : "3"}.1 Novidade (Art. 11):
                </strong>
                <p>
                  Considerando os {patents.length} documentos analisados,
                  {highRiskPatents.length > 0
                    ? ` foram identificados ${highRiskPatents.length} documento(s) com alto grau de sobreposição (${highRiskPatents.map(p => p.publicationNumber).join(", ")}), que merecem atenção especial na redação das reivindicações.`
                    : " o objeto proposto apresenta características não antecipadas integralmente pelos documentos encontrados."
                  }
                  {briefing?.diferenciais && ` Os diferenciais identificados no briefing técnico — ${briefing.diferenciais.substring(0, 200)} — sugerem nexo de novidade.`}
                </p>
              </div>
              <div>
                <strong className="text-xs uppercase tracking-tight block mb-1">
                  {briefing ? "4" : "3"}.2 Atividade Inventiva (Art. 13):
                </strong>
                <p>
                  {highRiskPatents.length === 0
                    ? "A solução técnica proposta não decorre de maneira óbvia ou evidente do estado da técnica para um técnico no assunto."
                    : "A solução técnica apresenta elementos que, embora guardem relação com o estado da arte, demonstram integração de componentes com superação de barreira técnica. Recomenda-se redação cuidadosa das reivindicações."
                  }
                </p>
              </div>
              <div>
                <strong className="text-xs uppercase tracking-tight block mb-1">
                  {briefing ? "4" : "3"}.3 Aplicação Industrial (Art. 15):
                </strong>
                <p>
                  O objeto é passível de fabricação industrial em série. Atende plenamente ao requisito.
                </p>
              </div>
            </div>
          </section>

          {/* 5. Conclusão */}
          <section className="mb-16 break-inside-avoid bg-primary/5 p-6 rounded-xl border border-primary/10 print:bg-white print:border-none print:p-0">
            <h4 className="font-black text-xs uppercase text-primary mb-4 print:text-black print:border-b print:pb-1">
              {briefing ? "5" : "4"}. Considerações Finais e Recomendações
            </h4>
            <p className="text-sm text-justify leading-relaxed">
              {highRiskPatents.length === 0
                ? "Com base na análise realizada, recomenda-se prosseguir com o depósito do pedido de patente. Não foram identificados documentos com alto grau de sobreposição que impeçam o prosseguimento."
                : `Com base na análise realizada, recomenda-se prosseguir com o depósito do pedido de patente com ATENÇÃO às ${highRiskPatents.length} patente(s) de alto risco identificada(s). Sugere-se revisão das reivindicações para evidenciar os diferenciais técnicos e evitar conflito direto com os documentos ${highRiskPatents.map(p => p.publicationNumber).join(", ")}.`
              }
            </p>
          </section>

          {/* Signature */}
          <div className="mt-24 text-center break-inside-avoid">
            <div className="inline-block border-t-2 border-primary px-16 pt-4 print:border-black">
              <p className="font-black text-sm uppercase tracking-tighter">Consultor PatentScope v2.0</p>
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">Agente de PI e Inteligência Técnica</p>
            </div>
            <div className="mt-10 flex justify-center items-center gap-2 text-[10px] text-gray-300 font-mono uppercase tracking-widest">
              <MapPin className="w-3 h-3 text-primary print:text-black" />
              São Paulo, {new Date().toLocaleDateString("pt-BR", { day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
          </div>

        </div>

        <div className="flex justify-between items-center mt-12 print:hidden bg-card/30 p-6 rounded-2xl border border-dashed border-border">
          <Button variant="ghost" onClick={() => navigate("/research/analysis")} className="gap-2 text-muted-foreground hover:text-foreground">
            Corrigir Análise
          </Button>
          <div className="flex items-center gap-4">
            <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">Processo Concluído</p>
            <Button onClick={() => navigate("/dashboard")} className="px-8 font-bold shadow-xl shadow-primary/10">
              Salvar no Histórico
            </Button>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
