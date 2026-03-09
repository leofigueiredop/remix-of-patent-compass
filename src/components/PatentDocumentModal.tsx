import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Loader2, Download, ExternalLink, FileX } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

export interface PatentDocumentData {
  publicationNumber: string;
  title: string;
  applicant?: string;
  inventor?: string;
  date?: string;
  abstract?: string;
  classification?: string;
  source?: string;
  url: string;
  status?: string;
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
    let active = true;

    const loadPdf = async () => {
      if (!open || !patent?.url) return;
      if (patent.source === "INPI") {
        setLoadingPdf(false);
        setPdfUrl(null);
        setPdfError("O INPI não disponibiliza PDF direto neste link. Use \"Fonte original\" para abrir o documento oficial.");
        return;
      }
      setLoadingPdf(true);
      setPdfError("");
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
      setPdfUrl(null);

      try {
        const response = await axios.get(`${API_URL}/patent/document`, {
          params: {
            url: patent.url,
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
  }, [open, patent]);

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
            <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
              <h3 className="text-sm font-semibold leading-snug">{patent.title || "Sem título"}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
                {headerItems.map((item) => (
                  <div key={item.label} className="text-xs rounded border bg-background px-2 py-1.5">
                    <span className="text-muted-foreground">{item.label}:</span>{" "}
                    <span className="font-medium">{item.value}</span>
                  </div>
                ))}
              </div>
              {patent.abstract && (
                <p className="text-xs text-muted-foreground line-clamp-2">
                  <span className="font-medium">Resumo:</span> {patent.abstract}
                </p>
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
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => window.open(patent.url, "_blank", "noopener,noreferrer")}
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
