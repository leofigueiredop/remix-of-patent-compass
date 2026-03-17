import { useEffect, useState } from "react";
import axios from "axios";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Save, Bot } from "lucide-react";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:3000").replace(/\/+$/, "");

type MonitoringConfig = {
    monitoredAttorneyNames: Array<{ id: string; name: string; active: boolean }>;
    monitoredPatents: Array<{
        id: string;
        patent_number: string;
        patent_id: string | null;
        source: string;
        matched_attorney: string | null;
        active: boolean;
        blocked_by_user: boolean;
    }>;
};

export default function MonitoringSettings() {
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [attorneyName, setAttorneyName] = useState("");
    const [config, setConfig] = useState<MonitoringConfig>({
        monitoredAttorneyNames: [],
        monitoredPatents: []
    });

    const refresh = async () => {
        setLoading(true);
        try {
            const { data } = await axios.get(`${API_URL}/monitoring/config`);
            setConfig({
                monitoredAttorneyNames: data?.monitoredAttorneyNames || [],
                monitoredPatents: data?.monitoredPatents || []
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void refresh();
    }, []);

    const addAttorney = async () => {
        const name = attorneyName.trim();
        if (!name) return;
        setSaving(true);
        try {
            await axios.post(`${API_URL}/monitoring/attorneys`, { name });
            setAttorneyName("");
            await refresh();
        } finally {
            setSaving(false);
        }
    };

    const toggleAttorney = async (id: string, active: boolean) => {
        await axios.post(`${API_URL}/monitoring/attorneys/${id}/toggle`, { active });
        await refresh();
    };

    const toggleMonitoredPatent = async (id: string, active: boolean) => {
        await axios.post(`${API_URL}/monitoring/patents/${id}/toggle`, { active, blockedByUser: !active });
        await refresh();
    };

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
                            <CardTitle className="text-lg">Procuradores Monitorados</CardTitle>
                            <CardDescription>Matches de procurador na RPI adicionam patentes automaticamente ao monitoramento</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex gap-2">
                                <Input
                                    placeholder="Ex.: DANNEMANN SIEMSEN BIGLER & IPANEMA MOREIRA"
                                    value={attorneyName}
                                    onChange={(e) => setAttorneyName(e.target.value)}
                                />
                                <Button onClick={addAttorney} disabled={saving || !attorneyName.trim()}>Adicionar</Button>
                            </div>
                            <div className="space-y-2">
                                {config.monitoredAttorneyNames.map((item) => (
                                    <div key={item.id} className="flex items-center justify-between rounded border px-3 py-2">
                                        <div className="text-sm">{item.name}</div>
                                        <Switch checked={item.active} onCheckedChange={(value) => void toggleAttorney(item.id, value)} />
                                    </div>
                                ))}
                                {config.monitoredAttorneyNames.length === 0 && (
                                    <div className="text-xs text-muted-foreground">Nenhum procurador monitorado cadastrado.</div>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">Patentes Monitoradas</CardTitle>
                            <CardDescription>Gerenciadas por usuário e por matches automáticos de procurador na RPI</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-2">
                            {config.monitoredPatents.map((item) => (
                                <div key={item.id} className="flex items-center justify-between rounded border px-3 py-2">
                                    <div className="space-y-1">
                                        <div className="text-sm font-mono">{item.patent_number}</div>
                                        <div className="text-xs text-muted-foreground">
                                            fonte={item.source} {item.matched_attorney ? `| procurador=${item.matched_attorney}` : ""}
                                        </div>
                                    </div>
                                    <Switch checked={item.active} onCheckedChange={(value) => void toggleMonitoredPatent(item.id, value)} />
                                </div>
                            ))}
                            {config.monitoredPatents.length === 0 && (
                                <div className="text-xs text-muted-foreground">Sem patentes monitoradas ainda.</div>
                            )}
                        </CardContent>
                    </Card>

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
                            <Save className="w-4 h-4" /> {loading ? "Atualizando..." : "Salvar Configurações"}
                        </Button>
                    </div>
                </div>
            </div>
        </AppLayout>
    );
}
