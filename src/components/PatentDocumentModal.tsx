import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { Loader2, Download, ExternalLink, FileX } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:3000").replace(/\/+$/, "");

export interface InpiPublication {
  id: string;
  rpi: string;
  date?: string;
  despacho_code?: string;
  despacho_desc?: string;
  complement?: string;
  rpi_url?: string;
  eligible_for_doc_download?: boolean;
}

export interface InpiPetition {
  id: string;
  service_code?: string;
  protocol?: string;
  date?: string;
  client?: string;
}

export interface InpiAnnuity {
  id: string;
  title?: string;
  start_date?: string;
  end_date?: string;
  payment_date?: string;
  status?: string;
}

export interface PatentDocumentData {
  publicationNumber: string;
  cod_pedido?: string;
  title: string;
  applicant?: string;
  inventor?: string;
  date?: string;
  abstract?: string;
  resumo_detalhado?: string;
  procurador?: string;
  classification?: string;
  source?: string;
  url: string;
  status?: string;
  figures?: string[];
  inpiUrl?: string;
  googlePatentsUrl?: string;
  espacenetUrl?: string;
  storage?: {
    hasStoredDocument?: boolean;
    fullDocumentPath?: string;
    drawingsPath?: string;
    firstPagePath?: string;
  };
  publications?: InpiPublication[];
  petitions?: InpiPetition[];
  annuities?: InpiAnnuity[];
  scraping_status?: string;
  document_status?: string;
  document_error?: string | null;
  doc_jobs?: Array<{
    id: string;
    publication_number?: string;
    status?: string;
    attempts?: number;
    error?: string | null;
    updated_at?: string;
  }>;
}

interface PatentDocumentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patent: PatentDocumentData | null;
}

export default function PatentDocumentModal({ open, onOpenChange, patent }: PatentDocumentModalProps) {
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState("");
  const [loadingTranslation, setLoadingTranslation] = useState(false);
  const [translatedText, setTranslatedText] = useState("");
  const [translationError, setTranslationError] = useState("");
  const detailsRequestKeyRef = useRef("");

  useEffect(() => {
    return () => {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
    };
  }, [pdfUrl]);

  useEffect(() => {
    if (!open) {
      setTranslatedText("");
      setTranslationError("");
      setLoadingTranslation(false);
      detailsRequestKeyRef.current = "";
      return;
    }
    setTranslatedText("");
    setTranslationError("");
    setLoadingTranslation(false);
  }, [open, patent?.publicationNumber]);

  useEffect(() => {
    if (!open) return;
    setViewerMode("doc");
  }, [open, patent?.publicationNumber]);

  const [detailedData, setDetailedData] = useState<PatentDocumentData | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const [viewerMode, setViewerMode] = useState<"doc" | "drawings" | "first">("doc");
  const [detailsRefreshKey, setDetailsRefreshKey] = useState(0);

  const resolveAssetUrl = (value?: string | null) => {
    if (!value) return "";
    if (/^https?:\/\//i.test(value)) return value;
    const normalized = value.startsWith("/") ? value : `/${value}`;
    return `${API_URL}${normalized}`;
  };
  const isStorageAssetUrl = useCallback((value?: string | null) => Boolean(value && value.includes("/patent/storage/")), []);

  const storageData = detailedData?.storage || patent?.storage;
  const fullDocumentPath = resolveAssetUrl(storageData?.fullDocumentPath || "");
  const drawingsPath = resolveAssetUrl(storageData?.drawingsPath || "");
  const firstPagePath = resolveAssetUrl(storageData?.firstPagePath || "");
  const externalFigurePath = resolveAssetUrl((detailedData?.figures?.[0] || patent?.figures?.[0] || ""));
  const googlePatentDocumentUrl = detailedData?.googlePatentsUrl || patent?.googlePatentsUrl || "";
  const hasDrawings = Boolean(drawingsPath);
  const hasFirstPage = Boolean(firstPagePath || externalFigurePath);
  const formatStorageName = (pathValue: string) => pathValue.split("/").pop() || "documento.pdf";
  const normalizeCode = (value?: string) => (value || "").replace(",", ".").replace(/\s+/g, "");

  const availableDocumentRows = useMemo(() => {
    const basePublications = (detailedData?.publications || []).filter((item) => {
      if (item.eligible_for_doc_download === true) return true;
      const code = normalizeCode(item.despacho_code);
      return code === "3.1" || code === "16.1";
    });
    const rows: Array<{
      key: string;
      despacho_code?: string;
      date?: string;
      descricao?: string;
      comentario?: string;
      name: string;
      path: string;
      asset: "doc" | "drawings" | "first";
    }> = [];

    for (const item of basePublications) {
      if (fullDocumentPath) {
        rows.push({
          key: `${item.id}-doc`,
          despacho_code: item.despacho_code,
          date: item.date,
          descricao: item.despacho_desc,
          comentario: item.complement,
          name: formatStorageName(fullDocumentPath),
          path: fullDocumentPath,
          asset: "doc"
        });
      }
      if (drawingsPath) {
        rows.push({
          key: `${item.id}-draw`,
          despacho_code: item.despacho_code,
          date: item.date,
          descricao: item.despacho_desc,
          comentario: item.complement,
          name: formatStorageName(drawingsPath),
          path: drawingsPath,
          asset: "drawings"
        });
      }
      if (firstPagePath) {
        rows.push({
          key: `${item.id}-first`,
          despacho_code: item.despacho_code,
          date: item.date,
          descricao: item.despacho_desc,
          comentario: item.complement,
          name: formatStorageName(firstPagePath),
          path: firstPagePath,
          asset: "first"
        });
      }
    }
    return rows;
  }, [detailedData?.publications, fullDocumentPath, drawingsPath, firstPagePath]);

  useEffect(() => {
    let active = true;
    const loadDetails = async () => {
      if (!open || !patent) return;
      if (patent.source !== "INPI") {
        setDetailedData(patent);
        return;
      }
      const codPedidoMatch = patent.url.match(/CodPedido=(\d+)/);
      const codPedido = patent.cod_pedido || (codPedidoMatch ? codPedidoMatch[1] : patent.publicationNumber);
      const requestKey = `${codPedido}-${patent.publicationNumber}`;
      if (detailsRequestKeyRef.current === requestKey) return;
      detailsRequestKeyRef.current = requestKey;
      setLoadingDetails(true);
      try {
        const response = await axios.get(`${API_URL}/search/inpi/detail/${encodeURIComponent(codPedido)}`);
        if (!active) return;
        const data = response.data;
        setDetailedData({
          ...patent,
          cod_pedido: data.cod_pedido || codPedido,
          title: data.title || patent.title,
          abstract: data.abstract || patent.abstract,
          resumo_detalhado: data.resumo_detalhado || data.abstract || patent.resumo_detalhado || patent.abstract,
          procurador: data.procurador || patent.procurador,
          applicant: data.applicant || patent.applicant,
          inventor: data.inventors || patent.inventor,
          date: data.filing_date || patent.date,
          status: data.status || patent.status,
          figures: Array.isArray(data.figures) ? data.figures : patent.figures,
          inpiUrl: data.inpiUrl || patent.inpiUrl,
          googlePatentsUrl: data.googlePatentsUrl || patent.googlePatentsUrl,
          espacenetUrl: data.espacenetUrl || patent.espacenetUrl,
          storage: data.storage || patent.storage,
          publications: data.publications,
          petitions: data.petitions,
          annuities: data.annuities,
          scraping_status: data.scraping_status,
          document_status: data.document_status,
          document_error: data.document_error,
          doc_jobs: data.doc_jobs
        });
      } catch (err) {
        console.error("Failed to load details:", err);
        if (active) setDetailedData(patent);
      } finally {
        if (active) setLoadingDetails(false);
      }
    };
    void loadDetails();
    return () => {
      active = false;
    };
  }, [open, patent, detailsRefreshKey]);

  useEffect(() => {
    let active = true;
    const loadPdf = async () => {
      if (!open) return;
      const targetUrl = viewerMode === "doc"
        ? (fullDocumentPath || googlePatentDocumentUrl)
        : viewerMode === "drawings"
          ? drawingsPath
          : (firstPagePath || externalFigurePath);
      if (!targetUrl) return;
      setLoadingPdf(true);
      setPdfError("");
      setPdfUrl((current) => {
        if (current && !isStorageAssetUrl(current)) {
          URL.revokeObjectURL(current);
        }
        return null;
      });

      try {
        if (isStorageAssetUrl(targetUrl)) {
          if (!active) return;
          setPdfUrl(targetUrl);
          return;
        }
        const response = await axios.get(`${API_URL}/patent/document`, {
          params: {
            url: targetUrl,
            publicationNumber: patent.publicationNumber
          },
          responseType: "blob",
          timeout: 45000
        });

        if (!active) return;
        const nextUrl = URL.createObjectURL(response.data);
        setPdfUrl(nextUrl);
      } catch {
        if (!active) return;
        setPdfError("Não foi possível localizar um PDF automaticamente para esta patente.");
      } finally {
        if (active) {
          setLoadingPdf(false);
        }
      }
    };

    void loadPdf();

    return () => {
      active = false;
    };
  }, [open, patent, viewerMode, fullDocumentPath, drawingsPath, firstPagePath, externalFigurePath, googlePatentDocumentUrl, isStorageAssetUrl]);

  const handleQueueScraping = async () => {
    if (!detailedData?.cod_pedido) return;
    setQueueing(true);
    try {
      await axios.post(`${API_URL}/patent/queue`, {
        codPedido: detailedData.cod_pedido,
        publicationNumber: detailedData.publicationNumber
      });
      setDetailedData(prev => prev ? { ...prev, scraping_status: 'pending', document_status: 'pending' } : null);
      detailsRequestKeyRef.current = "";
      setDetailsRefreshKey((value) => value + 1);
    } catch (err) {
      console.error("Failed to queue:", err);
    } finally {
      setQueueing(false);
    }
  };

  const headerItems = useMemo(() => {
    const target = detailedData || patent;
    if (!target) return [];
    return [
      { label: "Número", value: target.publicationNumber || "N/A" },
      { label: "Fonte", value: target.source || "N/A" },
      { label: "Titular", value: target.applicant || "N/A" },
      { label: "Inventor", value: target.inventor || "N/A" },
      { label: "Data", value: target.date || "N/A" },
      { label: "IPC", value: target.classification || "N/A" },
      { label: "Situação", value: target.status || "N/A" },
      { label: "Documento", value: (target.document_status || (target.storage?.hasStoredDocument ? "completed" : "not_queued")).toUpperCase() }
    ];
  }, [patent, detailedData]);

  const handleDownload = () => {
    if (!pdfUrl || !patent) return;
    if (isStorageAssetUrl(pdfUrl)) {
      window.open(pdfUrl, "_blank", "noopener,noreferrer");
      return;
    }
    const anchor = document.createElement("a");
    anchor.href = pdfUrl;
    anchor.download = `${(patent.publicationNumber || "patente").replace(/[^\w.-]/g, "_")}.pdf`;
    anchor.click();
  };

  const handleTranslateDocument = async () => {
    if (!patent?.url || patent.source === "INPI") return;
    setLoadingTranslation(true);
    setTranslationError("");
    try {
      const response = await axios.get(`${API_URL}/patent/document/translation`, {
        params: {
          url: patent.url,
          publicationNumber: patent.publicationNumber
        },
        timeout: 60000
      });
      const text = typeof response.data?.translatedText === "string" ? response.data.translatedText : "";
      setTranslatedText(text.trim());
      if (!text.trim()) {
        setTranslationError("Não foi possível gerar tradução para este documento.");
      }
    } catch {
      setTranslationError("Não foi possível traduzir automaticamente este documento.");
    } finally {
      setLoadingTranslation(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[1400px] h-[95vh] p-0 flex flex-col gap-0 overflow-hidden bg-slate-50 border-slate-200">
        <DialogTitle className="sr-only">
          Detalhes da patente {patent?.publicationNumber || ""}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Visualização de histórico, documentos e metadados da patente.
        </DialogDescription>
        
        {patent && (
          <div className="flex h-full flex-col lg:flex-row">
            {/* Esquerda: Detalhes, Metadados e Histórico (Stitch Prototype Style) */}
            <div className="w-full lg:w-[450px] xl:w-[500px] flex flex-col border-r border-slate-200 bg-white h-full overflow-hidden shrink-0">
              {/* Header Fixo */}
              <div className="p-5 border-b border-slate-100 bg-white sticky top-0 z-10">
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <Badge className="bg-slate-900 text-white font-mono text-xs">{patent.publicationNumber || "N/A"}</Badge>
                  <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200">{patent.source}</Badge>
                  {(detailedData?.document_status === 'completed' || patent.storage?.hasStoredDocument) && (
                    <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                      Documento Disponível
                    </Badge>
                  )}
                </div>
                <h3 className="text-lg font-bold text-slate-900 leading-snug line-clamp-3 mb-4">
                  {patent.title || "Sem título"}
                </h3>
                
                {patent.source === "INPI" && (
                  <Button 
                    size="sm" 
                    variant={detailedData?.scraping_status === 'pending' || detailedData?.scraping_status === 'running' ? "secondary" : "default"}
                    onClick={handleQueueScraping}
                    disabled={queueing || detailedData?.scraping_status === 'pending' || detailedData?.scraping_status === 'running'}
                    className="w-full gap-2 shadow-sm"
                  >
                    {queueing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                    {detailedData?.scraping_status === 'pending' ? 'Na fila de processamento...' : 
                     detailedData?.scraping_status === 'running' ? 'Extraindo dados...' : 
                     'Solicitar Raspagem Completa'}
                  </Button>
                )}
              </div>

              {/* Scrollable Content (Tabs and Details) */}
              <div className="flex-1 overflow-hidden flex flex-col">
                <Tabs defaultValue="metadata" className="flex-1 flex flex-col h-full">
                  <div className="px-5 pt-3 border-b border-slate-100 bg-slate-50/50">
                    <TabsList className="w-full h-9 bg-transparent p-0 justify-start gap-6 border-none">
                      <TabsTrigger value="metadata" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-slate-900 rounded-none px-1 py-2 text-xs font-semibold text-slate-500 data-[state=active]:text-slate-900 h-full">
                        Metadados
                      </TabsTrigger>
                      <TabsTrigger value="history" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-slate-900 rounded-none px-1 py-2 text-xs font-semibold text-slate-500 data-[state=active]:text-slate-900 h-full flex items-center gap-2">
                        Histórico INPI
                        {detailedData?.publications && <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-200 h-4 px-1.5 text-[9px]">{detailedData.publications.length}</Badge>}
                      </TabsTrigger>
                      <TabsTrigger value="petitions" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-slate-900 rounded-none px-1 py-2 text-xs font-semibold text-slate-500 data-[state=active]:text-slate-900 h-full flex items-center gap-2">
                        Petições
                        {detailedData?.petitions && <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-200 h-4 px-1.5 text-[9px]">{detailedData.petitions.length}</Badge>}
                      </TabsTrigger>
                      <TabsTrigger value="annuities" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-slate-900 rounded-none px-1 py-2 text-xs font-semibold text-slate-500 data-[state=active]:text-slate-900 h-full flex items-center gap-2">
                        Anuidades
                        {detailedData?.annuities && <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-200 h-4 px-1.5 text-[9px]">{detailedData.annuities.length}</Badge>}
                      </TabsTrigger>
                    </TabsList>
                  </div>

                  <div className="flex-1 overflow-y-auto">
                    <TabsContent value="metadata" className="m-0 p-5 space-y-6">
                      {/* Grid de Metadados (Mais clean) */}
                      <div className="grid grid-cols-2 gap-4">
                        {headerItems.filter(item => !['Número', 'Fonte', 'Documento'].includes(item.label)).map((item) => (
                          <div key={item.label} className="flex flex-col gap-1">
                            <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">{item.label}</span>
                            <span className="text-sm font-medium text-slate-800 break-words">{item.value}</span>
                          </div>
                        ))}
                      </div>

                      {(detailedData?.procurador || patent.procurador) && (
                        <div className="flex flex-col gap-1 pt-4 border-t border-slate-100">
                          <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Procurador</span>
                          <span className="text-sm font-medium text-slate-800">{detailedData?.procurador || patent.procurador}</span>
                        </div>
                      )}

                      {(detailedData?.resumo_detalhado || detailedData?.abstract || patent.resumo_detalhado || patent.abstract) && (
                        <div className="flex flex-col gap-2 pt-4 border-t border-slate-100">
                          <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Resumo</span>
                          <p className="text-sm text-slate-600 leading-relaxed text-justify">
                            {detailedData?.resumo_detalhado || detailedData?.abstract || patent.resumo_detalhado || patent.abstract}
                          </p>
                        </div>
                      )}

                      {(detailedData?.document_error || patent.document_error) && (
                        <div className="p-3 bg-red-50 rounded-lg border border-red-100 mt-4">
                          <span className="text-xs font-bold text-red-800 block mb-1">Último erro de documento:</span> 
                          <span className="text-xs text-red-600">{detailedData?.document_error || patent.document_error}</span>
                        </div>
                      )}
                    </TabsContent>

                    <TabsContent value="history" className="m-0 p-5">
                      {loadingDetails ? (
                        <div className="flex items-center justify-center gap-2 text-sm text-slate-500 py-8">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Carregando histórico do INPI...
                        </div>
                      ) : (
                        <div className="space-y-2 relative before:absolute before:inset-0 before:ml-2 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-200 before:to-transparent">
                          {detailedData?.publications && detailedData.publications.length > 0 ? detailedData.publications.map((p) => (
                            <div key={p.id} className={`relative flex items-start gap-4 p-3 rounded-lg border transition-colors ${p.despacho_code === '3.1' ? 'bg-amber-50/50 border-amber-100' : 'bg-white border-slate-100 hover:border-slate-200'}`}>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-xs font-bold text-slate-700">{p.date}</span>
                                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4">{p.despacho_code}</Badge>
                                  <span className="text-[10px] text-slate-400 font-mono">RPI {p.rpi}</span>
                                </div>
                                <p className="text-xs font-medium text-slate-800">{p.despacho_desc}</p>
                                {p.complement && <p className="text-xs text-slate-500 mt-1 line-clamp-2" title={p.complement}>{p.complement}</p>}
                              </div>
                            </div>
                          )) : (
                            <p className="text-sm text-slate-500 text-center py-8">Nenhum evento registrado.</p>
                          )}
                        </div>
                      )}
                    </TabsContent>

                    <TabsContent value="petitions" className="m-0 p-5">
                      {loadingDetails ? (
                        <div className="flex items-center justify-center gap-2 text-sm text-slate-500 py-8">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Carregando petições...
                        </div>
                      ) : (
                        <div className="rounded-lg border border-slate-200 overflow-hidden">
                          <table className="w-full text-xs text-left">
                            <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                              <tr>
                                <th className="px-3 py-2 font-medium">Data</th>
                                <th className="px-3 py-2 font-medium">Código</th>
                                <th className="px-3 py-2 font-medium">Protocolo</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {detailedData?.petitions && detailedData.petitions.length > 0 ? detailedData.petitions.map((p) => (
                                <tr key={p.id} className="bg-white hover:bg-slate-50">
                                  <td className="px-3 py-2 whitespace-nowrap">{p.date}</td>
                                  <td className="px-3 py-2 font-mono">{p.service_code}</td>
                                  <td className="px-3 py-2 font-mono">{p.protocol}</td>
                                </tr>
                              )) : (
                                <tr>
                                  <td colSpan={3} className="px-3 py-8 text-center text-slate-500">Nenhuma petição encontrada.</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </TabsContent>

                    <TabsContent value="annuities" className="m-0 p-5">
                      {loadingDetails ? (
                        <div className="flex items-center justify-center gap-2 text-sm text-slate-500 py-8">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Carregando anuidades...
                        </div>
                      ) : (
                        <div className="rounded-lg border border-slate-200 overflow-hidden">
                          <table className="w-full text-xs text-left">
                            <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                              <tr>
                                <th className="px-3 py-2 font-medium">Anuidade</th>
                                <th className="px-3 py-2 font-medium">Vencimento</th>
                                <th className="px-3 py-2 font-medium">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {detailedData?.annuities && detailedData.annuities.length > 0 ? detailedData.annuities.map((a) => (
                                <tr key={a.id} className="bg-white hover:bg-slate-50">
                                  <td className="px-3 py-2 font-medium">{a.title}</td>
                                  <td className="px-3 py-2">{a.end_date}</td>
                                  <td className="px-3 py-2">
                                    {a.payment_date ? (
                                      <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-200 border-none font-normal text-[10px]">Pago: {a.payment_date}</Badge>
                                    ) : (
                                      <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-200 border-none font-normal text-[10px]">Pendente</Badge>
                                    )}
                                  </td>
                                </tr>
                              )) : (
                                <tr>
                                  <td colSpan={3} className="px-3 py-8 text-center text-slate-500">Nenhuma anuidade encontrada.</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </TabsContent>
                  </div>
                </Tabs>
              </div>
            </div>

            {/* Direita: Visualizador de Documentos */}
            <div className="flex-1 flex flex-col min-w-0 bg-slate-50/50">
              {/* Toolbar do Documento */}
              <div className="p-4 border-b border-slate-200 bg-white flex flex-wrap items-center justify-between gap-4 sticky top-0 z-10">
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                  <Button
                    type="button"
                    variant={viewerMode === "doc" ? "secondary" : "ghost"}
                    size="sm"
                    className={viewerMode === "doc" ? "bg-slate-100 text-slate-900" : "text-slate-500"}
                    onClick={() => setViewerMode("doc")}
                    disabled={!fullDocumentPath}
                  >
                    Documento Principal
                  </Button>
                  <Button
                    type="button"
                    variant={viewerMode === "drawings" ? "secondary" : "ghost"}
                    size="sm"
                    className={viewerMode === "drawings" ? "bg-slate-100 text-slate-900" : "text-slate-500"}
                    onClick={() => setViewerMode("drawings")}
                    disabled={!hasDrawings}
                  >
                    Figuras
                  </Button>
                  <Button
                    type="button"
                    variant={viewerMode === "first" ? "secondary" : "ghost"}
                    size="sm"
                    className={viewerMode === "first" ? "bg-slate-100 text-slate-900" : "text-slate-500"}
                    onClick={() => setViewerMode("first")}
                    disabled={!hasFirstPage}
                  >
                    Primeira Página
                  </Button>
                  
                  <div className="w-px h-4 bg-slate-200 mx-2"></div>
                  
                  {availableDocumentRows.length > 0 && availableDocumentRows.map((item) => (
                    <Button
                      key={item.key}
                      type="button"
                      variant={viewerMode === item.asset ? "secondary" : "ghost"}
                      size="sm"
                      className={`text-xs ${viewerMode === item.asset ? "bg-blue-50 text-blue-700" : "text-slate-500"}`}
                      onClick={() => {
                        setViewerMode(item.asset);
                        setPdfUrl(null);
                      }}
                      title={item.descricao}
                    >
                      {item.despacho_code ? `Doc ${item.despacho_code}` : 'Anexo'}
                    </Button>
                  ))}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {pdfUrl && (
                    <Button type="button" variant="outline" size="sm" className="gap-2 bg-white text-slate-700" onClick={handleDownload}>
                      <Download className="w-4 h-4" />
                      Baixar
                    </Button>
                  )}
                  
                  <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                    {(detailedData?.googlePatentsUrl || patent.googlePatentsUrl) && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="gap-1.5 h-8 text-xs text-slate-600"
                        onClick={() => window.open(detailedData?.googlePatentsUrl || patent.googlePatentsUrl, "_blank", "noopener,noreferrer")}
                      >
                        Google
                      </Button>
                    )}
                    {(detailedData?.espacenetUrl || patent.espacenetUrl) && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="gap-1.5 h-8 text-xs text-slate-600"
                        onClick={() => window.open(detailedData?.espacenetUrl || patent.espacenetUrl, "_blank", "noopener,noreferrer")}
                      >
                        Espacenet
                      </Button>
                    )}
                  </div>
                  <DialogClose asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-slate-900 rounded-full">
                      <span className="sr-only">Fechar</span>
                      <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11.7816 4.03157C12.0062 3.80702 12.0062 3.44295 11.7816 3.2184C11.5571 2.99385 11.193 2.99385 10.9685 3.2184L7.50005 6.68682L4.03164 3.2184C3.80708 2.99385 3.44301 2.99385 3.21846 3.2184C2.99391 3.44295 2.99391 3.80702 3.21846 4.03157L6.68688 7.49999L3.21846 10.9684C2.99391 11.193 2.99391 11.557 3.21846 11.7816C3.44301 12.0061 3.80708 12.0061 4.03164 11.7816L7.50005 8.31316L10.9685 11.7816C11.193 12.0061 11.5571 12.0061 11.7816 11.7816C12.0062 11.557 12.0062 11.193 11.7816 10.9684L8.31322 7.49999L11.7816 4.03157Z" fill="currentColor" fillRule="evenodd" clipRule="evenodd"></path></svg>
                    </Button>
                  </DialogClose>
                </div>
              </div>

              {/* PDF Viewer */}
              <div className="flex-1 min-h-0 bg-slate-200/50 p-4 md:p-6 lg:p-8 flex flex-col relative">
                <div className="flex-1 rounded-xl overflow-hidden bg-white shadow-xl ring-1 ring-slate-900/5 flex flex-col">
                  {loadingPdf ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-3">
                      <Loader2 className="w-8 h-8 animate-spin text-slate-300" />
                      <span className="text-sm font-medium">Carregando visualizador...</span>
                    </div>
                  ) : pdfUrl ? (
                    <iframe title="Visualizador de patente" src={pdfUrl} className="w-full h-full border-0 bg-white" />
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-4 p-8 text-center bg-slate-50/50">
                      <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center">
                        <FileX className="w-8 h-8 text-slate-300" />
                      </div>
                      <div>
                        <h4 className="text-slate-700 font-medium mb-1">Documento Indisponível</h4>
                        <p className="text-sm max-w-sm">
                          {pdfError || "Não foi possível carregar este documento. Solicite a raspagem completa ou verifique as fontes originais."}
                        </p>
                      </div>
                      {patent.source === "INPI" && (
                        <Button 
                          onClick={handleQueueScraping}
                          disabled={queueing || detailedData?.scraping_status === 'pending' || detailedData?.scraping_status === 'running'}
                          className="mt-2 bg-slate-900 text-white"
                        >
                          Solicitar Documento
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                {/* Translation Box - Float at bottom if exists */}
                {(translatedText || translationError || loadingTranslation) && (
                  <div className="absolute bottom-8 left-8 right-8 bg-white/95 backdrop-blur shadow-lg rounded-xl border border-slate-200 p-4 max-h-[30vh] flex flex-col">
                    <div className="flex justify-between items-center mb-2 pb-2 border-b border-slate-100">
                      <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Tradução Automática</p>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0 rounded-full" onClick={() => setTranslatedText("")}>
                        <FileX className="w-3 h-3" />
                      </Button>
                    </div>
                    {loadingTranslation ? (
                      <div className="text-sm text-slate-500 flex items-center justify-center py-4 gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Processando tradução...
                      </div>
                    ) : translatedText ? (
                      <div className="overflow-auto text-sm text-slate-700 whitespace-pre-wrap leading-relaxed flex-1 pr-2 custom-scrollbar">
                        {translatedText}
                      </div>
                    ) : (
                      <div className="text-sm text-red-500 py-2">{translationError}</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
