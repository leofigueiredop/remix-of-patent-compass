import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle2, Clock, ShieldAlert, Upload, FileCode, Search, ChevronRight } from "lucide-react";
import { InpiParser, InpiMonitor, CollisionResult } from "@/services/inpi";
import LoadingTransition from "@/components/LoadingTransition";

const DEMO_XML = `<?xml version="1.0" encoding="UTF-8"?>
<revista numero="2823" dataPublicacao="11/02/2025">
  <despachos>
    <despacho codigo="1.1" nome="Publicação de Pedido de Patente">
      <processo-patente>
        <numero>BR 10 2024 012345 6</numero>
        <data-deposito>10/01/2024</data-deposito>
        <titulo>SISTEMA DE MONITORAMENTO DE COLIDÊNCIA E ANÁLISE DE PATENTES</titulo>
        <titular nome-razao-social="TECH INNOVATION LTDA" pais="BR" uf="SP"/>
        <classificacao-nacional>
            <codigo>G06Q 50/18</codigo>
        </classificacao-nacional>
        <resumo>Sistema automatizado para monitoramento de despachos em órgãos de propriedade industrial utilizando inteligência artificial.</resumo>
      </processo-patente>
    </despacho>
    <despacho codigo="1.1" nome="Publicação de Pedido de Patente">
       <processo-patente>
        <numero>BR 10 2024 098765 4</numero>
        <data-deposito>15/01/2024</data-deposito>
        <titulo>DISPOSITIVO MODULAR PARA CONSTRUÇÃO CIVIL</titulo>
        <titular nome-razao-social="CONSTRUTORA EXEMPLO S.A." pais="BR" uf="MG"/>
        <classificacao-nacional>
            <codigo>E04B 2/00</codigo>
        </classificacao-nacional>
        <resumo>Painel parede modular com isolamento térmico e acústico.</resumo>
      </processo-patente>
    </despacho>
  </despachos>
</revista>`;

const USER_KEYWORDS = ["monitoramento", "colidência", "patentes", "modular", "painel", "construção"];

export default function MonitoringDashboard() {
    const [results, setResults] = useState<CollisionResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [processed, setProcessed] = useState(false);

    const runSimulation = () => {
        setLoading(true);
        setTimeout(() => {
            try {
                const revista = InpiParser.parseXML(DEMO_XML);
                const collisions = InpiMonitor.checkCollisions(revista, USER_KEYWORDS);
                setResults(collisions);
                setProcessed(true);
            } catch (e) {
                console.error("Erro no parser:", e);
            }
        }, 1500); // Process faster than animation to ensure data is ready
    };

    const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setLoading(true);
        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target?.result as string;
            try {
                const revista = InpiParser.parseXML(text);
                const collisions = InpiMonitor.checkCollisions(revista, USER_KEYWORDS);
                setResults(collisions);
                setProcessed(true);
            } catch (err) {
                console.error("Erro ao ler arquivo", err);
            }
        };
        reader.readAsText(file);
    };

    return (
        <AppLayout>
            {loading && (
                <LoadingTransition
                    message="Processando Dados do INPI..."
                    subMessage="Lendo XML da RPI e cruzando com suas palavras-chave monitoradas"
                    duration={2000}
                    onComplete={() => setLoading(false)}
                />
            )}
            <div className="space-y-8">
                <div>
                    <h1 className="text-2xl font-bold mb-1">Monitoramento de Colidência</h1>
                    <p className="text-muted-foreground text-sm">
                        Acompanhamento em tempo real de novas publicações e possíveis conflitos
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-sm font-medium">Patentes Monitoradas</CardTitle>
                            <Clock className="w-4 h-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">12</div>
                            <p className="text-xs text-muted-foreground">+2 desde o último RPI</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-sm font-medium">Alertas de Colidência</CardTitle>
                            <ShieldAlert className="w-4 h-4 text-risk-high" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-risk-high">{results.length > 0 ? results.length : 3}</div>
                            <p className="text-xs text-muted-foreground">Requer atenção imediata</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-sm font-medium">Bases Ativas</CardTitle>
                            <CheckCircle2 className="w-4 h-4 text-risk-low" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">6</div>
                            <p className="text-xs text-muted-foreground">INPI, Espacenet, USPTO...</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-sm font-medium">Próxima Varredura</CardTitle>
                            <AlertCircle className="w-4 h-4 text-accent" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">Terça-feira</div>
                            <p className="text-xs text-muted-foreground">Publicação semanal da RPI</p>
                        </CardContent>
                    </Card>
                </div>

                {/* Import Area */}
                <Card className="border-dashed border-2 bg-muted/20">
                    <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                            <FileCode className="w-5 h-5" /> Importação Manual RPI (XML)
                        </CardTitle>
                        <CardDescription>
                            Carregue o arquivo XML da Revista da Propriedade Industrial para análise imediata.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex gap-4">
                        <div className="relative">
                            <input
                                type="file"
                                accept=".xml"
                                onChange={handleFileUpload}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            />
                            <Button variant="outline" className="gap-2">
                                <Upload className="w-4 h-4" /> Carregar Arquivo .xml
                            </Button>
                        </div>
                        <Button onClick={runSimulation} className="gap-2 bg-accent hover:bg-accent/90">
                            <Search className="w-4 h-4" /> Simular RPI da Semana (Demo)
                        </Button>
                    </CardContent>
                </Card>

                {/* Results Section */}
                {processed && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-700">
                        <div className="flex items-center justify-between">
                            <h2 className="text-xl font-bold">Resultados da Análise RPI #2823</h2>
                            <Badge variant="outline" className="text-xs">Processado em: {new Date().toLocaleDateString()}</Badge>
                        </div>

                        <div className="grid gap-4">
                            {results.map((result, idx) => (
                                <Card key={idx} className="border-l-4 border-l-risk-high">
                                    <div className="p-6 flex flex-col md:flex-row gap-6">
                                        <div className="flex-1 space-y-3">
                                            <div className="flex items-start justify-between">
                                                <div>
                                                    <Badge variant="secondary" className="mb-2">{result.despacho.codigo} - {result.despacho.descricao}</Badge>
                                                    <h3 className="text-lg font-bold text-foreground">{result.patente.titulo}</h3>
                                                    <p className="text-sm font-mono text-muted-foreground">{result.patente.numero} • {result.patente.dataDeposito}</p>
                                                </div>
                                                <Badge className="bg-risk-high text-white">Score: {result.score}</Badge>
                                            </div>

                                            <div className="bg-muted/50 p-3 rounded-md text-sm text-balance">
                                                <span className="font-semibold text-muted-foreground">Resumo: </span>
                                                {result.patente.resumo}
                                            </div>

                                            <div className="flex flex-wrap gap-2 pt-2">
                                                {result.matchedKeywords.map(kw => (
                                                    <Badge key={kw} variant="outline" className="border-risk-high text-risk-high bg-risk-high/5">
                                                        Match: {kw}
                                                    </Badge>
                                                ))}
                                                {result.patente.classificacao?.map(ipc => (
                                                    <Badge key={ipc} variant="secondary" className="font-mono">
                                                        IPC: {ipc}
                                                    </Badge>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="w-full md:w-48 shrink-0 flex flex-col justify-center gap-2 border-t md:border-t-0 md:border-l pl-0 md:pl-6 pt-4 md:pt-0">
                                            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Titular</div>
                                            <div className="font-medium text-sm">{result.patente.titulares[0]?.nome}</div>
                                            <div className="text-xs text-muted-foreground">{result.patente.titulares[0]?.uf}/{result.patente.titulares[0]?.pais}</div>

                                            <Button size="sm" variant="outline" className="mt-4 w-full gap-2">
                                                Ver Detalhes <ChevronRight className="w-3 h-3" />
                                            </Button>
                                        </div>
                                    </div>
                                </Card>
                            ))}
                            {results.length === 0 && (
                                <div className="p-12 text-center border-2 border-dashed rounded-lg bg-muted/10">
                                    <CheckCircle2 className="w-12 h-12 text-status-success mx-auto mb-4" />
                                    <h3 className="text-lg font-semibold">Nenhuma colidência detectada</h3>
                                    <p className="text-muted-foreground">O arquivo analisado não contém conflitos com suas palavras-chave.</p>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </AppLayout>
    );
}
