import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Loader2, Download, ExternalLink, FileX } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

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
  classification?: string;
  source?: string;
  url: string;
  status?: string;
  figures?: string[];
  inpiUrl?: string;
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

  const normalizeApiUrl = API_URL.replace(/\/$/, "");
  const resolveAssetUrl = (value?: string | null) => {
    if (!value) return "";
    if (/^https?:\/\//i.test(value)) return value;
    const normalized = value.startsWith("/") ? value : `/${value}`;
    return `${normalizeApiUrl}${normalized}`;
  };

  const fullDocumentPath = resolveAssetUrl(patent?.storage?.fullDocumentPath || patent?.url || "");
  const drawingsPath = resolveAssetUrl(patent?.storage?.drawingsPath || "");
  const firstPagePath = resolveAssetUrl(patent?.storage?.firstPagePath || patent?.figures?.[0] || "");
  const hasDrawings = Boolean(drawingsPath);
  const hasFirstPage = Boolean(firstPagePath);
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

      setLoadingDetails(true);
      try {
        const codPedidoMatch = patent.url.match(/CodPedido=(\d+)/);
        const codPedido = codPedidoMatch ? codPedidoMatch[1] : patent.publicationNumber;
        
        const response = await axios.get(`${API_URL}/search/inpi/detail/${codPedido}`);
        if (!active) return;
        
        // Map backend fields to frontend interface
        const data = response.data;
        setDetailedData({
          ...patent,
          cod_pedido: data.cod_pedido || codPedido,
          title: data.title || patent.title,
          abstract: data.abstract || patent.abstract,
          applicant: data.applicant || patent.applicant,
          inventor: data.inventors || patent.inventor,
          date: data.filing_date || patent.date,
          status: data.status || patent.status,
          figures: Array.isArray(data.figures) ? data.figures : patent.figures,
          inpiUrl: data.inpiUrl || patent.inpiUrl,
          storage: data.storage || patent.storage,
          publications: data.publications,
          petitions: data.petitions,
          annuities: data.annuities,
          scraping_status: data.scraping_status
        });
      } catch (err) {
        console.error("Failed to load details:", err);
        setDetailedData(patent);
      } finally {
        if (active) setLoadingDetails(false);
      }
    };

    void loadDetails();

    const loadPdf = async () => {
      if (!open) return;
      const targetUrl = viewerMode === "doc"
        ? fullDocumentPath
        : viewerMode === "drawings"
          ? drawingsPath
          : firstPagePath;
      if (!targetUrl) return;
      setLoadingPdf(true);
      setPdfError("");
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
      setPdfUrl(null);

      try {
        if (targetUrl.includes("/patent/storage/")) {
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
  }, [open, patent, viewerMode, fullDocumentPath, drawingsPath, firstPagePath]);

  const handleQueueScraping = async () => {
    if (!detailedData?.cod_pedido) return;
    setQueueing(true);
    try {
      await axios.post(`${API_URL}/patent/queue`, { codPedido: detailedData.cod_pedido });
      setDetailedData(prev => prev ? { ...prev, scraping_status: 'pending' } : null);
    } catch (err) {
      console.error("Failed to queue:", err);
    } finally {
      setQueueing(false);
    }
  };

  const headerItems = useMemo(() => {
    if (!patent) return [];
    return [
      { label: "Número", value: patent.publicationNumber || "N/A" },
      { label: "Fonte", value: patent.source || "N/A" },
      { label: "Titular", value: patent.applicant || "N/A" },
      { label: "Inventor", value: patent.inventor || "N/A" },
      { label: "Data", value: patent.date || "N/A" },
      { label: "IPC", value: patent.classification || "N/A" },
      { label: "Situação", value: patent.status || "N/A" }
    ];
  }, [patent]);

  const handleDownload = () => {
    if (!pdfUrl || !patent) return;
    if (/^https?:\/\//i.test(pdfUrl) || pdfUrl.includes("/patent/storage/")) {
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
      <DialogContent className="max-w-7xl w-[96vw] h-[92vh] p-4 flex flex-col gap-3">
        {patent && (
          <>
            <div className="rounded-lg border bg-muted/30 p-3 space-y-2 overflow-auto max-h-[40vh]">
              <div className="flex justify-between items-start gap-2">
                <h3 className="text-sm font-semibold leading-snug flex-1">{patent.title || "Sem título"}</h3>
                {patent.source === "INPI" && (
                  <Button 
                    size="xs" 
                    variant={detailedData?.scraping_status === 'pending' || detailedData?.scraping_status === 'running' ? "secondary" : "default"}
                    onClick={handleQueueScraping}
                    disabled={queueing || detailedData?.scraping_status === 'pending' || detailedData?.scraping_status === 'running'}
                  >
                    {queueing ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                    {detailedData?.scraping_status === 'pending' ? 'Na fila...' : 
                     detailedData?.scraping_status === 'running' ? 'Processando...' : 
                     'Solicitar Raspagem Completa'}
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
                {headerItems.map((item) => (
                  <div key={item.label} className="text-xs rounded border bg-background px-2 py-1.5">
                    <span className="text-muted-foreground">{item.label}:</span>{" "}
                    <span className="font-medium">{item.value}</span>
                  </div>
                ))}
              </div>
              {patent.abstract && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium">Resumo:</span> {patent.abstract}
                </p>
              )}

              {loadingDetails ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-2 border-t">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Carregando histórico do INPI...
                </div>
              ) : (
                <div className="space-y-4 pt-2 border-t">
                  {detailedData?.publications && detailedData.publications.length > 0 && (
                    <div className="space-y-1.5">
                      <h4 className="text-[10px] font-bold uppercase text-muted-foreground">Histórico de Publicações (RPI)</h4>
                      <div className="rounded border overflow-hidden">
                        <table className="w-full text-[10px] text-left border-collapse">
                          <thead className="bg-muted text-muted-foreground">
                            <tr>
                              <th className="px-2 py-1 border-b">RPI</th>
                              <th className="px-2 py-1 border-b">Data</th>
                              <th className="px-2 py-1 border-b">Código</th>
                              <th className="px-2 py-1 border-b">Descrição</th>
                              <th className="px-2 py-1 border-b">Complemento</th>
                              <th className="px-2 py-1 border-b">Elegível Doc</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detailedData.publications.map((p) => (
                              <tr key={p.id} className={p.despacho_code === '3.1' ? "bg-yellow-500/10" : "hover:bg-muted/50"}>
                                <td className="px-2 py-1 border-b font-medium">{p.rpi}</td>
                                <td className="px-2 py-1 border-b">{p.date}</td>
                                <td className="px-2 py-1 border-b">{p.despacho_code}</td>
                                <td className="px-2 py-1 border-b">{p.despacho_desc}</td>
                                <td className="px-2 py-1 border-b">{p.complement}</td>
                                <td className="px-2 py-1 border-b">{p.eligible_for_doc_download ? "Sim" : "Não"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {availableDocumentRows.length > 0 && (
                    <div className="space-y-1.5">
                      <h4 className="text-[10px] font-bold uppercase text-muted-foreground">Documentos Disponíveis (Bucket)</h4>
                      <div className="rounded border overflow-hidden">
                        <table className="w-full text-[10px] text-left border-collapse">
                          <thead className="bg-muted text-muted-foreground">
                            <tr>
                              <th className="px-2 py-1 border-b">Código</th>
                              <th className="px-2 py-1 border-b">Data</th>
                              <th className="px-2 py-1 border-b">Descrição</th>
                              <th className="px-2 py-1 border-b">Comentário</th>
                              <th className="px-2 py-1 border-b">Documento</th>
                              <th className="px-2 py-1 border-b text-right">Ações</th>
                            </tr>
                          </thead>
                          <tbody>
                            {availableDocumentRows.map((item) => (
                              <tr key={item.key} className="hover:bg-muted/50">
                                <td className="px-2 py-1 border-b">{item.despacho_code || "-"}</td>
                                <td className="px-2 py-1 border-b">{item.date || "-"}</td>
                                <td className="px-2 py-1 border-b">{item.descricao || "-"}</td>
                                <td className="px-2 py-1 border-b">{item.comentario || "-"}</td>
                                <td className="px-2 py-1 border-b font-mono">{item.name}</td>
                                <td className="px-2 py-1 border-b text-right">
                                  <div className="inline-flex gap-1">
                                    <Button
                                      size="xs"
                                      variant="outline"
                                      onClick={() => {
                                        setViewerMode(item.asset);
                                        setPdfUrl(item.path);
                                      }}
                                    >
                                      Visualizar
                                    </Button>
                                    <Button
                                      size="xs"
                                      variant="secondary"
                                      onClick={() => window.open(item.path, "_blank", "noopener,noreferrer")}
                                    >
                                      Baixar
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {detailedData?.petitions && detailedData.petitions.length > 0 && (
                    <div className="space-y-1.5">
                      <h4 className="text-[10px] font-bold uppercase text-muted-foreground">Petições</h4>
                      <div className="rounded border overflow-hidden">
                        <table className="w-full text-[10px] text-left border-collapse">
                          <thead className="bg-muted text-muted-foreground">
                            <tr>
                              <th className="px-2 py-1 border-b">Código</th>
                              <th className="px-2 py-1 border-b">Protocolo</th>
                              <th className="px-2 py-1 border-b">Data</th>
                              <th className="px-2 py-1 border-b">Cliente</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detailedData.petitions.map((p) => (
                              <tr key={p.id} className="hover:bg-muted/50">
                                <td className="px-2 py-1 border-b">{p.service_code}</td>
                                <td className="px-2 py-1 border-b">{p.protocol}</td>
                                <td className="px-2 py-1 border-b">{p.date}</td>
                                <td className="px-2 py-1 border-b truncate max-w-[150px]">{p.client}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {detailedData?.annuities && detailedData.annuities.length > 0 && (
                    <div className="space-y-1.5">
                      <h4 className="text-[10px] font-bold uppercase text-muted-foreground">Anuidades</h4>
                      <div className="rounded border overflow-hidden">
                        <table className="w-full text-[10px] text-left border-collapse">
                          <thead className="bg-muted text-muted-foreground">
                            <tr>
                              <th className="px-2 py-1 border-b">Título</th>
                              <th className="px-2 py-1 border-b">Vencimento</th>
                              <th className="px-2 py-1 border-b">Pagamento</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detailedData.annuities.map((a) => (
                              <tr key={a.id} className="hover:bg-muted/50">
                                <td className="px-2 py-1 border-b font-medium">{a.title}</td>
                                <td className="px-2 py-1 border-b">{a.end_date}</td>
                                <td className="px-2 py-1 border-b">{a.payment_date || '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">Documento técnico da patente</p>
              <div className="flex items-center gap-2">
                {pdfUrl && (
                  <Button type="button" variant="secondary" size="sm" className="gap-1.5" onClick={handleDownload}>
                    <Download className="w-3.5 h-3.5" />
                    Baixar PDF
                  </Button>
                )}
                <Button
                  type="button"
                  variant={viewerMode === "doc" ? "secondary" : "outline"}
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setViewerMode("doc")}
                  disabled={!fullDocumentPath}
                >
                  Documento
                </Button>
                <Button
                  type="button"
                  variant={viewerMode === "drawings" ? "secondary" : "outline"}
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setViewerMode("drawings")}
                  disabled={!hasDrawings}
                >
                  Figuras
                </Button>
                <Button
                  type="button"
                  variant={viewerMode === "first" ? "secondary" : "outline"}
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setViewerMode("first")}
                  disabled={!hasFirstPage}
                >
                  Primeira página
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => window.open(patent.inpiUrl || patent.url, "_blank", "noopener,noreferrer")}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Fonte original
                </Button>
                {patent.source !== "INPI" && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={handleTranslateDocument}
                    disabled={loadingTranslation}
                  >
                    {loadingTranslation ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    {loadingTranslation ? "Traduzindo..." : "Traduzir conteúdo"}
                  </Button>
                )}
              </div>
            </div>

            <div className="flex-1 min-h-0 rounded-lg border overflow-hidden bg-background">
              {loadingPdf ? (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Carregando PDF...
                </div>
              ) : pdfUrl ? (
                <iframe title="Visualizador de patente" src={pdfUrl} className="w-full h-full" />
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground gap-2">
                  <FileX className="w-4 h-4" />
                  {pdfError || "PDF indisponível para esta patente."}
                </div>
              )}
            </div>
            {(translatedText || translationError || loadingTranslation) && (
              <div className="rounded-lg border bg-background p-3">
                <p className="text-xs text-muted-foreground mb-2">Tradução automática do conteúdo do documento</p>
                {loadingTranslation ? (
                  <div className="text-sm text-muted-foreground flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Processando tradução...
                  </div>
                ) : translatedText ? (
                  <div className="max-h-48 overflow-auto text-sm whitespace-pre-wrap leading-relaxed">{translatedText}</div>
                ) : (
                  <div className="text-sm text-muted-foreground">{translationError}</div>
                )}
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
