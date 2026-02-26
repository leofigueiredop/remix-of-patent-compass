import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Save, Bot } from "lucide-react";

export default function MonitoringSettings() {
    return (
        <AppLayout>
            <div className="space-y-6">
                <div>
                    <h1 className="text-2xl font-bold mb-1">Configurações de Monitoramento</h1>
                    <p className="text-muted-foreground text-sm">Ajuste os parâmetros do robô de vigilância (RPI Crawler)</p>
                </div>

                <div className="grid gap-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">Parâmetros de Varredura</CardTitle>
                            <CardDescription>Defina como e quando o sistema deve buscar novas colidências</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Frequência de Varredura</Label>
                                    <Select defaultValue="weekly">
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="weekly">Semanal (Toda Terça-feira)</SelectItem>
                                            <SelectItem value="daily" disabled>Diária (Requer plano Enterprise)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Horário do Job</Label>
                                    <Input type="time" defaultValue="08:00" />
                                </div>
                            </div>

                            <div className="pt-4 border-t">
                                <h4 className="text-sm font-semibold mb-3">Critérios de "Match" (Colidência)</h4>
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-0.5">
                                            <Label>Correspondência Fonética</Label>
                                            <p className="text-xs text-muted-foreground">Detectar nomes com som similar (ex: Souza / Sousa)</p>
                                        </div>
                                        <Switch defaultChecked />
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-0.5">
                                            <Label>Ignorar Stopwords em Títulos</Label>
                                            <p className="text-xs text-muted-foreground">Desconsiderar "de", "para", "com" na análise de títulos</p>
                                        </div>
                                        <Switch defaultChecked />
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">Notificações e Alertas</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center justify-between">
                                <Label htmlFor="email-alert">Enviar Resumo Semanal por Email</Label>
                                <Switch id="email-alert" defaultChecked />
                            </div>
                            <div className="flex items-center justify-between">
                                <Label htmlFor="urgent-alert">Alerta Imediato (Alta Probabilidade)</Label>
                                <Switch id="urgent-alert" defaultChecked />
                            </div>
                            <div className="space-y-2 pt-2">
                                <Label>Email para Notificação</Label>
                                <Input placeholder="ex: patentes@suaempresa.com" defaultValue="admin@patentcompass.com" />
                            </div>
                        </CardContent>
                    </Card>

                    <div className="flex justify-end">
                        <Button className="gap-2 bg-accent hover:bg-accent/90">
                            <Save className="w-4 h-4" /> Salvar Configurações
                        </Button>
                    </div>
                </div>
            </div>
        </AppLayout>
    );
}
