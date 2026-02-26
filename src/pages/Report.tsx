import { useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Download, Printer, FileText, Calendar, User, ShieldCheck, MapPin, Bold, Italic, List, Save, Share2, ChevronDown, ExternalLink, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import AppLayout from "@/components/AppLayout";
import WizardSteps from "@/components/WizardSteps";
import { OpsSearchResult } from "@/services/espacenet";
import { toast } from "sonner";

const steps = ["Briefing", "Transcrição", "Briefing Técnico", "Palavras-chave", "Resultados", "Análise", "Relatório"];

interface AnalyzedPatent extends OpsSearchResult {
  id: string;
  selected: boolean;
  riskLevel: "high" | "medium" | "low";
  comments: string;
  imageUrl?: string;
  url?: string;
  number?: string;
}

export default function Report() {
  const navigate = useNavigate();
  const location = useLocation();
  const reportRef = useRef<HTMLDivElement>(null);
  const patents: AnalyzedPatent[] = location.state?.patents || [];

  const [isExporting, setIsExporting] = useState(false);

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
              <p className="font-bold text-gray-600">Ref: PESQ-{new Date().getFullYear()}-001</p>
              <p>{new Date().toLocaleDateString("pt-BR")}</p>
            </div>
          </div>

          {/* Title Block */}
          <div className="text-center mb-12">
            <h2 className="text-xl font-bold border-y-2 border-gray-100 py-4 mb-4 uppercase tracking-tight">ESTUDO DE ANTERIORIDADE PARA ANÁLISE DE PATENTEABILIDADE</h2>
            <h3 className="text-sm font-semibold text-gray-500 mb-8 tracking-wide">OBJETO: "SISTEMA DE MONITORAMENTO ESTRUTURAL"</h3>

            <div className="inline-block text-left bg-gray-50 p-6 rounded-lg border border-gray-100 text-sm shadow-sm">
              <p className="mb-1"><strong className="text-gray-400 uppercase text-[10px] block">CLIENTE:</strong> Empresa Exemplo Ltda</p>
              <p><strong className="text-gray-400 uppercase text-[10px] block">SOLICITANTE:</strong> Eng. Responsável</p>
            </div>
          </div>

          {/* 1. Objetivos */}
          <section className="mb-10">
            <h4 className="font-black text-xs uppercase text-primary border-b border-gray-100 pb-1 mb-4 print:text-black">1. Objetivos</h4>
            <div className="pl-2 space-y-2 text-sm text-justify leading-relaxed">
              <p>• Pesquisar documentos de patente relacionados ao objeto de interesse informado pelo cliente.</p>
              <p>• Identificar anterioridades relevantes nas bases nacionais (INPI) e internacionais (Espacenet).</p>
              <p>• Avaliar a viabilidade de patenteabilidade (Novidade e Atividade Inventiva) com base na LPI 9.279/96.</p>
            </div>
          </section>

          {/* 2. Considerações Iniciais */}
          <section className="mb-10">
            <h4 className="font-black text-xs uppercase text-primary border-b border-gray-100 pb-1 mb-4 print:text-black">2. Considerações Iniciais</h4>
            <p className="text-sm text-justify mb-3 leading-relaxed">
              A Lei de Propriedade Industrial (Lei nº 9.279/96) estabelece que pedidos de patentes são mantidos em sigilo por 18 meses a partir do depósito. Portanto, não é possível localizar documentos depositados neste período recente.
            </p>
            <p className="text-sm text-justify leading-relaxed">
              Esta busca foi realizada utilizando estratégias de palavras-chave e classificações internacionais (IPC/CPC) em bases de dados oficiais, aplicando o motor de busca **Patent Engine v2.0**.
            </p>
          </section>

          {/* 3. Resultados */}
          <section className="mb-10">
            <h4 className="font-black text-xs uppercase text-primary border-b border-gray-100 pb-1 mb-4 print:text-black">3. Resultados - Documentos Relevantes</h4>
            <p className="text-sm mb-6">
              Foram encontrados <strong>{patents.length} documentos</strong> considerados críticos após triagem algoritmica:
            </p>

            <div className="space-y-8">
              {patents.map((patent, index) => (
                <div key={index} className="border-l-4 border-gray-100 pl-6 py-4 rounded-r-lg break-inside-avoid print:border-black mb-10 bg-white shadow-sm border border-gray-100/50">
                  <div className="flex justify-between items-start mb-3">
                    <h5 className="font-bold text-sm leading-tight flex flex-col md:flex-row md:items-center gap-2">
                      <span>3.{index + 1} {patent.publicationNumber} <span className="text-gray-400 font-normal mx-1">|</span> {patent.title}</span>
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const url = patent.url || `https://worldwide.espacenet.com/patent/search?q=${encodeURIComponent(patent.publicationNumber || patent.number)}`;
                          window.open(url, '_blank');
                        }}
                        className="inline-flex items-center gap-1.5 text-[10px] text-blue-600 hover:bg-blue-100 bg-blue-50 px-2.5 py-1 rounded-full border border-blue-200 print:hidden transition-colors w-max cursor-pointer"
                        contentEditable={false}
                      >
                        <ExternalLink className="w-3 h-3" />
                        Acessar Documento Original
                      </button>
                    </h5>
                    <span className={`text-[9px] px-2 py-0.5 rounded-full text-white font-bold tracking-widest shrink-0 shadow-sm ${patent.riskLevel === "high" ? "bg-red-500" :
                      patent.riskLevel === "medium" ? "bg-amber-500" : "bg-emerald-500"
                      }`}>
                      {patent.riskLevel === "high" ? "ALTO RISCO" : patent.riskLevel === "medium" ? "MÉDIO RISCO" : "BAIXO RISCO"}
                    </span>
                  </div>

                  <div className="text-[10px] text-gray-400 mb-5 font-mono uppercase tracking-tighter">
                    <strong>Titular:</strong> {patent.applicant} <span className="mx-2">•</span> <strong>Data de Pub:</strong> {patent.date ? new Date(patent.date.toString().replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')).toLocaleDateString("pt-BR") : "N/A"}
                  </div>

                  <div className="flex flex-col md:flex-row gap-6 mb-5">
                    {/* Imagem/Figura Principal da Patente */}
                    <div className="w-full md:w-1/3 bg-gray-50 rounded-xl border border-gray-200/60 p-2 flex flex-col items-center justify-center min-h-[180px] relative overflow-hidden group print:border-gray-300 print:bg-transparent">
                      <div className="absolute top-2 left-2 flex items-center gap-1.5 text-[8px] font-bold text-gray-500 uppercase tracking-widest bg-white/90 px-2 py-1 rounded-md shadow-sm z-10 print:hidden">
                        <ImageIcon className="w-3 h-3 text-primary" /> Figura Representativa
                      </div>
                      <img
                        src={patent.imageUrl ? patent.imageUrl : `https://placehold.co/600x400/f8f9fa/a0aec0?text=${encodeURIComponent('SEM FIGURA\n' + (patent.publicationNumber || patent.number))}`}
                        alt={`Figura da Patente ${patent.publicationNumber || patent.number}`}
                        className="w-full h-full min-h-[180px] object-contain object-center transition-all duration-300"
                        contentEditable={false}
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.src = `https://placehold.co/600x400/f8f9fa/a0aec0?text=${encodeURIComponent('ERRO NA IMAGEM\n' + (patent.publicationNumber || patent.number))}`;
                        }}
                      />
                    </div>

                    {/* Resumo da Patente */}
                    <div className="w-full md:w-2/3 bg-gray-50/50 p-5 rounded-xl text-[11px] text-gray-600 text-justify italic border border-gray-100 print:bg-white leading-relaxed print:border-none print:p-0">
                      <strong>Resumo do Documento:</strong><br /><br />
                      "{patent.abstract}"
                    </div>
                  </div>

                  <div className="text-sm mt-2 pt-4 border-t border-dashed border-gray-200 bg-amber-50/20 p-5 rounded-xl">
                    <p className="font-bold text-[10px] uppercase text-amber-600 mb-2 flex items-center gap-2">
                      <ShieldCheck className="w-3 h-3" /> Análise do Consultor Especializado:
                    </p>
                    <p className="text-justify text-gray-800 leading-relaxed font-medium">{patent.comments || "Sem observações adicionais ou notas inseridas neste bloco analisado."}</p>
                  </div>
                </div>
              ))}
              {patents.length === 0 && <p className="text-sm italic text-gray-500">Nenhum documento selecionado na análise.</p>}
            </div>
          </section>

          {/* 4. Parecer Técnico */}
          <section className="mb-10 break-inside-avoid">
            <h4 className="font-black text-xs uppercase text-primary border-b border-gray-100 pb-1 mb-4 print:text-black">4. Parecer Técnico (Lei 9.279/96)</h4>
            <div className="space-y-6 text-sm text-justify leading-relaxed">
              <div>
                <strong className="text-xs uppercase tracking-tight block mb-1">4.1 Novidade (Art. 11):</strong>
                <p>
                  Considerando os documentos analisados, o objeto proposto [apresenta/não apresenta] características antecipadas integralmente.
                  Os diferenciais identificados no briefing técnico sugerem nexo de novidade em relação às anterioridades {patents.map(p => p.publicationNumber).join(", ")}.
                </p>
              </div>
              <div>
                <strong className="text-xs uppercase tracking-tight block mb-1">4.2 Atividade Inventiva (Art. 13):</strong>
                <p>
                  A solução técnica [decorre/não decorre] de maneira óbvia ou evidente do estado da técnica para um técnico no assunto. A integração de componentes descrita no projeto demonstra superação de barreira técnica.
                </p>
              </div>
              <div>
                <strong className="text-xs uppercase tracking-tight block mb-1">4.3 Aplicação Industrial (Art. 15):</strong>
                <p>
                  O objeto é passível de fabricação industrial em série. Atende plenamente ao requisito.
                </p>
              </div>
            </div>
          </section>

          {/* 5. Conclusão */}
          <section className="mb-16 break-inside-avoid bg-primary/5 p-6 rounded-xl border border-primary/10 print:bg-white print:border-none print:p-0">
            <h4 className="font-black text-xs uppercase text-primary mb-4 print:text-black print:border-b print:pb-1">5. Considerações Finais e Recomendações</h4>
            <p className="text-sm text-justify leading-relaxed">
              Com base na análise realizada por inteligência híbrida e revisão de consultoria, recomenda-se prosseguir com o depósito do pedido de patente, focado nas reivindicações dos diferenciais identificados no item 4.1. Sugere-se revisão das reivindicações para evitar conflito direto com as patentes de alto risco listadas neste documento.
            </p>
          </section>

          {/* Signature */}
          <div className="mt-24 text-center break-inside-avoid">
            <div className="inline-block border-t-2 border-primary px-16 pt-4 print:border-black">
              <p className="font-black text-sm uppercase tracking-tighter">Consultor PatentScope v2.0</p>
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">Agente de PI e Inteligência Técnica</p>
            </div>
            <div className="mt-10 flex justify-center items-center gap-2 text-[10px] text-gray-300 font-mono uppercase tracking-widest">
              <MapPin className="w-3 h-3 text-primary print:text-black" /> São Paulo, {new Date().toLocaleDateString("pt-BR", { day: 'numeric', month: 'long', year: 'numeric' })}
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
