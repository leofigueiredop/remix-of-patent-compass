import { useEffect, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Settings as SettingsIcon, Mail, Webhook, Tags, Database, Save, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import axios from "axios";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:3000").replace(/\/+$/, "");

export default function Settings() {
    const [activeTab, setActiveTab] = useState("smtp");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [smtp, setSmtp] = useState({
        host: "",
        port: "587",
        username: "",
        password: "",
        senderName: ""
    });
    const [templates, setTemplates] = useState({
        collision: "",
        process: ""
    });
    const [workflows, setWorkflows] = useState({
        statusesText: "nova, triagem, andamento, cliente, concluida",
        collisionSlaDays: "7",
        processSlaDays: "5",
        autoCreateDemandsFromCriticalAlerts: true
    });
    const [integrations, setIntegrations] = useState({
        inpiMode: "scrape",
        epoOpsEnabled: false,
        groqEnabled: false,
        groqModel: "llama-3.1-70b-versatile",
        webhookUrl: ""
    });

    const loadSettings = async () => {
        setLoading(true);
        try {
            const { data } = await axios.get(`${API_URL}/settings/system`);
            setSmtp({
                host: data?.smtp?.host || "",
                port: String(data?.smtp?.port || "587"),
                username: data?.smtp?.username || "",
                password: data?.smtp?.password || "",
                senderName: data?.smtp?.senderName || ""
            });
            setTemplates({
                collision: data?.templates?.collision || "",
                process: data?.templates?.process || ""
            });
            const workflowStatuses = Array.isArray(data?.workflows?.statuses)
                ? data.workflows.statuses
                : ["nova", "triagem", "andamento", "cliente", "concluida"];
            setWorkflows({
                statusesText: workflowStatuses.join(", "),
                collisionSlaDays: String(data?.workflows?.collisionSlaDays ?? "7"),
                processSlaDays: String(data?.workflows?.processSlaDays ?? "5"),
                autoCreateDemandsFromCriticalAlerts: Boolean(data?.workflows?.autoCreateDemandsFromCriticalAlerts ?? true)
            });
            setIntegrations({
                inpiMode: data?.integrations?.inpiMode || "scrape",
                epoOpsEnabled: Boolean(data?.integrations?.epoOpsEnabled),
                groqEnabled: Boolean(data?.integrations?.groqEnabled),
                groqModel: data?.integrations?.groqModel || "llama-3.1-70b-versatile",
                webhookUrl: data?.integrations?.webhookUrl || ""
            });
        } catch {
            toast.error("Não foi possível carregar configurações.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadSettings();
    }, []);

    const saveSettings = async () => {
        setSaving(true);
        try {
            await axios.put(`${API_URL}/settings/system`, {
                smtp,
                templates,
                workflows: {
                    statuses: workflows.statusesText
                        .split(",")
                        .map((item) => item.trim())
                        .filter(Boolean),
                    collisionSlaDays: Number(workflows.collisionSlaDays || 0),
                    processSlaDays: Number(workflows.processSlaDays || 0),
                    autoCreateDemandsFromCriticalAlerts: workflows.autoCreateDemandsFromCriticalAlerts
                },
                integrations
            });
            toast.success("Configurações salvas.");
        } catch {
            toast.error("Não foi possível salvar as configurações.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <AppLayout>
            <div className="flex flex-col gap-6 w-full mx-auto">
                <div className="flex justify-between items-end">
                    <div className="animate-in fade-in slide-in-from-left duration-700">
                        <h1 className="text-2xl font-bold flex items-center gap-3 text-slate-900 mb-2">
                            <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center">
                                <SettingsIcon className="w-5 h-5 text-slate-600" />
                            </div>
                            Configurações do Sistema
                        </h1>
                        <p className="text-muted-foreground text-sm mt-1">
                            Gerencie integrações, templates de email e parâmetros globais da plataforma.
                        </p>
                    </div>
                    <Button className="gap-2 bg-slate-900 hover:bg-slate-800 text-white" onClick={saveSettings} disabled={saving || loading}>
                        <Save className="w-4 h-4" /> Salvar Alterações
                    </Button>
                </div>

                <div className="flex flex-col md:flex-row gap-6">
                    {/* Sidebar Nav */}
                    <div className="w-full md:w-64 flex flex-col gap-1">
                        <button 
                            onClick={() => setActiveTab("smtp")}
                            className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${activeTab === "smtp" ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50"}`}
                        >
                            <Mail className="w-4 h-4" /> Servidor SMTP
                        </button>
                        <button 
                            onClick={() => setActiveTab("templates")}
                            className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${activeTab === "templates" ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50"}`}
                        >
                            <Webhook className="w-4 h-4" /> Templates de Email
                        </button>
                        <button 
                            onClick={() => setActiveTab("workflows")}
                            className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${activeTab === "workflows" ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50"}`}
                        >
                            <Tags className="w-4 h-4" /> Status & Workflows
                        </button>
                        <button 
                            onClick={() => setActiveTab("integrations")}
                            className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${activeTab === "integrations" ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50"}`}
                        >
                            <Database className="w-4 h-4" /> Fontes de Dados
                        </button>
                    </div>

                    {/* Content Area */}
                    <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                        {activeTab === "smtp" && (
                            <div className="space-y-6 animate-in fade-in">
                                <div>
                                    <h3 className="text-lg font-bold text-slate-800">Configuração de E-mail (SMTP)</h3>
                                    <p className="text-sm text-slate-500">Credenciais para envio de relatórios e alertas aos clientes.</p>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Host SMTP</Label>
                                        <Input placeholder="smtp.gmail.com" value={smtp.host} onChange={(e) => setSmtp((prev) => ({ ...prev, host: e.target.value }))} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Porta</Label>
                                        <Input placeholder="587" value={smtp.port} onChange={(e) => setSmtp((prev) => ({ ...prev, port: e.target.value }))} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Usuário</Label>
                                        <Input placeholder="email@suaempresa.com" value={smtp.username} onChange={(e) => setSmtp((prev) => ({ ...prev, username: e.target.value }))} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Senha</Label>
                                        <Input type="password" placeholder="••••••••" value={smtp.password} onChange={(e) => setSmtp((prev) => ({ ...prev, password: e.target.value }))} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Nome do Remetente</Label>
                                        <Input placeholder="Plataforma de Patentes" value={smtp.senderName} onChange={(e) => setSmtp((prev) => ({ ...prev, senderName: e.target.value }))} />
                                    </div>
                                </div>
                                <div className="pt-4 border-t border-slate-100 flex justify-end">
                                    <Button variant="outline" className="gap-2" onClick={saveSettings} disabled={saving || loading}>
                                        Testar Conexão
                                    </Button>
                                </div>
                            </div>
                        )}
                        
                        {activeTab === "templates" && (
                            <div className="space-y-6 animate-in fade-in">
                                <div>
                                    <h3 className="text-lg font-bold text-slate-800">Templates de E-mail</h3>
                                    <p className="text-sm text-slate-500">Configure os textos padrão enviados aos clientes.</p>
                                </div>
                                <div className="flex flex-col gap-4">
                                    <div className="space-y-2">
                                        <Label>Template - Alerta de Nova Colisão</Label>
                                        <Textarea
                                            value={templates.collision}
                                            onChange={(e) => setTemplates((prev) => ({ ...prev, collision: e.target.value }))}
                                            placeholder="Olá {{cliente}}, identificamos uma nova colisão para {{patente}}..."
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Template - Atualização Processual</Label>
                                        <Textarea
                                            value={templates.process}
                                            onChange={(e) => setTemplates((prev) => ({ ...prev, process: e.target.value }))}
                                            placeholder="Prezados, houve atualização processual na patente {{patente}}..."
                                        />
                                    </div>
                                    <div className="pt-2 flex justify-end">
                                        <Button onClick={saveSettings} disabled={saving || loading} className="bg-slate-900 hover:bg-slate-800 text-white">
                                            {saving ? "Salvando..." : "Salvar Templates"}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === "workflows" && (
                            <div className="space-y-6 animate-in fade-in">
                                <div>
                                    <h3 className="text-lg font-bold text-slate-800">Status & Workflows</h3>
                                    <p className="text-sm text-slate-500">Padronize funis e SLAs operacionais de monitoramento.</p>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="md:col-span-2 space-y-2">
                                        <Label>Status de Demandas (separados por vírgula)</Label>
                                        <Input
                                            value={workflows.statusesText}
                                            onChange={(e) => setWorkflows((prev) => ({ ...prev, statusesText: e.target.value }))}
                                            placeholder="nova, triagem, andamento, cliente, concluida"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>SLA Colidência (dias)</Label>
                                        <Input
                                            type="number"
                                            min={1}
                                            value={workflows.collisionSlaDays}
                                            onChange={(e) => setWorkflows((prev) => ({ ...prev, collisionSlaDays: e.target.value }))}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>SLA Processo (dias)</Label>
                                        <Input
                                            type="number"
                                            min={1}
                                            value={workflows.processSlaDays}
                                            onChange={(e) => setWorkflows((prev) => ({ ...prev, processSlaDays: e.target.value }))}
                                        />
                                    </div>
                                </div>
                                <label className="flex items-center gap-3 text-sm text-slate-700">
                                    <input
                                        type="checkbox"
                                        checked={workflows.autoCreateDemandsFromCriticalAlerts}
                                        onChange={(e) => setWorkflows((prev) => ({ ...prev, autoCreateDemandsFromCriticalAlerts: e.target.checked }))}
                                    />
                                    Criar demandas automaticamente para alertas críticos
                                </label>
                                <div className="pt-2 flex justify-end">
                                    <Button onClick={saveSettings} disabled={saving || loading} className="bg-slate-900 hover:bg-slate-800 text-white">
                                        {saving ? "Salvando..." : "Salvar Workflows"}
                                    </Button>
                                </div>
                            </div>
                        )}

                        {activeTab === "integrations" && (
                            <div className="space-y-6 animate-in fade-in">
                                <div>
                                    <h3 className="text-lg font-bold text-slate-800">Fontes de Dados</h3>
                                    <p className="text-sm text-slate-500">Controle operacional das integrações externas da plataforma.</p>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Modo INPI</Label>
                                        <select
                                            value={integrations.inpiMode}
                                            onChange={(e) => setIntegrations((prev) => ({ ...prev, inpiMode: e.target.value }))}
                                            className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm bg-white"
                                        >
                                            <option value="scrape">scrape</option>
                                            <option value="ops">ops</option>
                                            <option value="hybrid">hybrid</option>
                                        </select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Modelo Groq</Label>
                                        <Input
                                            value={integrations.groqModel}
                                            onChange={(e) => setIntegrations((prev) => ({ ...prev, groqModel: e.target.value }))}
                                            placeholder="llama-3.1-70b-versatile"
                                        />
                                    </div>
                                    <div className="md:col-span-2 space-y-2">
                                        <Label>Webhook de Notificações</Label>
                                        <Input
                                            value={integrations.webhookUrl}
                                            onChange={(e) => setIntegrations((prev) => ({ ...prev, webhookUrl: e.target.value }))}
                                            placeholder="https://seu-endpoint/webhook"
                                        />
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <label className="flex items-center gap-3 text-sm text-slate-700">
                                        <input
                                            type="checkbox"
                                            checked={integrations.epoOpsEnabled}
                                            onChange={(e) => setIntegrations((prev) => ({ ...prev, epoOpsEnabled: e.target.checked }))}
                                        />
                                        EPO OPS habilitado
                                    </label>
                                    <label className="flex items-center gap-3 text-sm text-slate-700">
                                        <input
                                            type="checkbox"
                                            checked={integrations.groqEnabled}
                                            onChange={(e) => setIntegrations((prev) => ({ ...prev, groqEnabled: e.target.checked }))}
                                        />
                                        Groq habilitado
                                    </label>
                                </div>
                                <div className="pt-2 flex justify-end">
                                    <Button onClick={saveSettings} disabled={saving || loading} className="bg-slate-900 hover:bg-slate-800 text-white">
                                        {saving ? "Salvando..." : "Salvar Integrações"}
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </AppLayout>
    );
}
