import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Save } from "lucide-react";

export default function ResearchSettings() {
    return (
        <AppLayout>
            <div className="space-y-6">
                <div>
                    <h1 className="text-2xl font-bold mb-1">Configurações de Pesquisa</h1>
                    <p className="text-muted-foreground text-sm">Personalize os parâmetros de busca e análise de anterioridade</p>
                </div>

                <div className="grid gap-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">Fontes de Dados</CardTitle>
                            <CardDescription>Defina quais bases serão consultadas durante as pesquisas</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center justify-between">
                                <Label htmlFor="epo-source">Espacenet (EPO) - Mundial</Label>
                                <Switch id="epo-source" defaultChecked />
                            </div>
                            <div className="flex items-center justify-between">
                                <Label htmlFor="inpi-source">INPI (Brasil) - via Data Lake</Label>
                                <Switch id="inpi-source" defaultChecked />
                            </div>
                            <div className="flex items-center justify-between">
                                <Label htmlFor="uspto-source">USPTO (EUA)</Label>
                                <Switch id="uspto-source" defaultChecked />
                            </div>
                            <div className="flex items-center justify-between">
                                <Label htmlFor="wipo-source">WIPO (Internacional)</Label>
                                <Switch id="wipo-source" defaultChecked />
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">Modelos de IA</CardTitle>
                            <CardDescription>Selecione os motores de inferência para análise</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid gap-2">
                                <Label>Modelo de Raciocínio (Briefing)</Label>
                                <Select defaultValue="deepseek-r1">
                                    <SelectTrigger>
                                        <SelectValue placeholder="Selecione o modelo" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="deepseek-r1">DeepSeek R1 (7b) - Recomendado</SelectItem>
                                        <SelectItem value="llama-3">Llama 3 (8b)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid gap-2">
                                <Label>Modelo de Estratégia (Keywords/IPC)</Label>
                                <Select defaultValue="phi-3.5">
                                    <SelectTrigger>
                                        <SelectValue placeholder="Selecione o modelo" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="phi-3.5">Phi 3.5 (Mini)</SelectItem>
                                        <SelectItem value="mistral">Mistral 7B</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </CardContent>
                    </Card>

                    <div className="flex justify-end">
                        <Button className="gap-2 bg-accent hover:bg-accent/90">
                            <Save className="w-4 h-4" /> Salvar Preferências
                        </Button>
                    </div>
                </div>
            </div>
        </AppLayout>
    );
}
