import { useEffect, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Users, Search, Plus, Filter, Mail, Briefcase, Sparkles, UserRoundCog, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { api } from "@/services/auth";
import OperationalPageHeader from "@/components/operations/OperationalPageHeader";
import OperationalKpiCard from "@/components/operations/OperationalKpiCard";

type Client = {
    id: string;
    name: string;
    email: string | null;
    document: string | null;
    status: string;
    created_at: string;
    _count?: {
        patents: number;
    };
    contacts_count?: number;
    pi_types?: Array<"patente" | "marca" | "di">;
    primary_pi_type?: "patente" | "marca" | "di";
};

type ClientContact = {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    role_area: "patents" | "financial" | "brands" | "general";
    is_primary: boolean;
    active: boolean;
    notes: string | null;
};

export default function Clients() {
    const [clients, setClients] = useState<Client[]>([]);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState("");
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    
    const [newName, setNewName] = useState("");
    const [newEmail, setNewEmail] = useState("");
    const [newDocument, setNewDocument] = useState("");
    const [creating, setCreating] = useState(false);
    const [autofilling, setAutofilling] = useState(false);
    const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
    const [hasContactFilter, setHasContactFilter] = useState<"all" | "yes" | "no">("all");
    const [piTypeFilter, setPiTypeFilter] = useState<"all" | "patente" | "marca" | "di">("all");
    const [profileOpen, setProfileOpen] = useState(false);
    const [selectedClient, setSelectedClient] = useState<Client | null>(null);
    const [contacts, setContacts] = useState<ClientContact[]>([]);
    const [newContactName, setNewContactName] = useState("");
    const [newContactEmail, setNewContactEmail] = useState("");
    const [newContactPhone, setNewContactPhone] = useState("");
    const [newContactRole, setNewContactRole] = useState<"patents" | "financial" | "brands" | "general">("patents");
    const [newContactPrimary, setNewContactPrimary] = useState(false);
    const [savingContact, setSavingContact] = useState(false);
    const [routingRules, setRoutingRules] = useState<Array<{ occurrenceType: string; roleArea: "patents" | "financial" | "brands" | "general"; overrideContactId?: string }>>([]);
    const [newPiTypes, setNewPiTypes] = useState<Array<"patente" | "marca" | "di">>(["patente"]);

    const loadClients = async () => {
        setLoading(true);
        try {
            const res = await api.get(`/clients`).catch(() => ({ data: [] }));
            setClients(res.data);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleAutofillCnpj = async () => {
        const documentOnly = newDocument.replace(/\D/g, "");
        if (documentOnly.length !== 14) {
            toast.error("Informe um CNPJ com 14 dígitos para autofill.");
            return;
        }
        setAutofilling(true);
        try {
            const { data } = await api.get(`/clients/cnpj/${documentOnly}/autofill`);
            if (!newName.trim()) setNewName(data?.legalName || "");
            if (!newEmail.trim()) setNewEmail(data?.email || "");
            toast.success("Dados preenchidos a partir do CNPJ.");
        } catch (error: any) {
            toast.error(error?.response?.data?.error || "Não foi possível consultar o CNPJ.");
        } finally {
            setAutofilling(false);
        }
    };

    const loadClientProfile = async (client: Client) => {
        setSelectedClient(client);
        setProfileOpen(true);
        try {
            const [{ data }, rulesRes] = await Promise.all([
                api.get(`/clients/${client.id}/contacts`),
                api.get(`/clients/${client.id}/routing-rules`).catch(() => ({ data: { rows: [] } }))
            ]);
            setContacts(Array.isArray(data?.rows) ? data.rows : []);
            setRoutingRules((Array.isArray(rulesRes?.data?.rows) ? rulesRes.data.rows : []).map((item: any) => ({
                occurrenceType: item.occurrence_type,
                roleArea: item.role_area,
                overrideContactId: item.override_contact_id || undefined
            })));
        } catch {
            setContacts([]);
            toast.error("Não foi possível carregar contatos do cliente.");
        }
    };

    const createContact = async () => {
        if (!selectedClient) return;
        if (!newContactName.trim() || !newContactEmail.trim()) {
            toast.error("Nome e email do contato são obrigatórios.");
            return;
        }
        setSavingContact(true);
        try {
            await api.post(`/clients/${selectedClient.id}/contacts`, {
                name: newContactName,
                email: newContactEmail,
                phone: newContactPhone || undefined,
                roleArea: newContactRole,
                isPrimary: newContactPrimary
            });
            const { data } = await api.get(`/clients/${selectedClient.id}/contacts`);
            setContacts(Array.isArray(data?.rows) ? data.rows : []);
            setNewContactName("");
            setNewContactEmail("");
            setNewContactPhone("");
            setNewContactRole("patents");
            setNewContactPrimary(false);
            await loadClients();
            toast.success("Contato cadastrado.");
        } catch (error: any) {
            toast.error(error?.response?.data?.error || "Erro ao salvar contato.");
        } finally {
            setSavingContact(false);
        }
    };

    const roleLabel: Record<string, string> = {
        patents: "Patentes",
        financial: "Financeiro",
        brands: "Marcas",
        general: "Geral"
    };

    const saveRoutingRules = async () => {
        if (!selectedClient) return;
        try {
            await api.put(`/clients/${selectedClient.id}/routing-rules`, { rules: routingRules });
            toast.success("Regras de destinatário atualizadas.");
        } catch (error: any) {
            toast.error(error?.response?.data?.error || "Erro ao salvar regras.");
        }
    };

    useEffect(() => {
        loadClients();
    }, []);

    const handleCreateClient = async () => {
        if (!newName.trim()) {
            toast.error("O nome do cliente é obrigatório");
            return;
        }
        
        setCreating(true);
        try {
            await api.post(`/clients`, {
                name: newName,
                email: newEmail || null,
                document: newDocument || null,
                piTypes: newPiTypes
            });
            toast.success("Cliente cadastrado com sucesso!");
            setIsCreateModalOpen(false);
            setNewName("");
            setNewEmail("");
            setNewDocument("");
            setNewPiTypes(["patente"]);
            loadClients();
        } catch (error: any) {
            toast.error(error.response?.data?.error || "Erro ao criar cliente. Verifique se o backend tem a rota implementada.");
        } finally {
            setCreating(false);
        }
    };

    const filteredClients = clients.filter((c) => {
        const matchesQuery = c.name.toLowerCase().includes(query.toLowerCase())
            || (c.document && c.document.includes(query))
            || (c.email && c.email.toLowerCase().includes(query.toLowerCase()));
        const normalizedStatus = String(c.status || "active").toLowerCase();
        const matchesStatus = statusFilter === "all" || normalizedStatus === statusFilter;
        const contactCount = Number(c.contacts_count || 0);
        const matchesContact = hasContactFilter === "all"
            || (hasContactFilter === "yes" && contactCount > 0)
            || (hasContactFilter === "no" && contactCount === 0);
        const matchesPiType = piTypeFilter === "all"
            || Array.isArray(c.pi_types) && c.pi_types.includes(piTypeFilter);
        return matchesQuery && matchesStatus && matchesContact && matchesPiType;
    });
    const crmClientMetrics = {
        total: clients.length,
        active: clients.filter((c) => String(c.status || "active").toLowerCase() === "active").length,
        withoutContact: clients.filter((c) => Number(c.contacts_count || 0) === 0).length,
        monitoredAssets: clients.reduce((sum, c) => sum + Number(c._count?.patents || 0), 0),
        patente: clients.filter((c) => (c.pi_types || []).includes("patente")).length,
        marca: clients.filter((c) => (c.pi_types || []).includes("marca")).length,
        di: clients.filter((c) => (c.pi_types || []).includes("di")).length
    };

    return (
        <AppLayout>
            <div className="flex flex-col gap-6 w-full mx-auto">
                <OperationalPageHeader
                    title="CRM de Clientes de PI"
                    description="Cadastre contas, responsáveis e regras de roteamento para operações de propriedade intelectual."
                    icon={<Users className="w-5 h-5 text-slate-600" />}
                    actions={
                        <Button onClick={() => setIsCreateModalOpen(true)} className="gap-2 h-10 text-sm bg-blue-600 hover:bg-blue-700 text-white">
                            <Plus className="w-4 h-4" /> Novo Cliente
                        </Button>
                    }
                />

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <OperationalKpiCard label="Clientes totais" value={crmClientMetrics.total} icon={<Users className="w-4 h-4" />} tone="default" />
                    <OperationalKpiCard label="Contas ativas" value={crmClientMetrics.active} icon={<CheckCircle2 className="w-4 h-4" />} tone="success" />
                    <OperationalKpiCard label="Sem contato cadastrado" value={crmClientMetrics.withoutContact} icon={<UserRoundCog className="w-4 h-4" />} tone="warning" />
                    <OperationalKpiCard label="Ativos monitorados" value={crmClientMetrics.monitoredAssets} icon={<Briefcase className="w-4 h-4" />} tone="info" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3">
                        <p className="text-xs text-indigo-700">Clientes com Patente</p>
                        <p className="text-2xl font-semibold text-indigo-700">{crmClientMetrics.patente}</p>
                    </div>
                    <div className="rounded-xl border border-fuchsia-200 bg-fuchsia-50 p-3">
                        <p className="text-xs text-fuchsia-700">Clientes com Marca</p>
                        <p className="text-2xl font-semibold text-fuchsia-700">{crmClientMetrics.marca}</p>
                    </div>
                    <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-3">
                        <p className="text-xs text-cyan-700">Clientes com DI</p>
                        <p className="text-2xl font-semibold text-cyan-700">{crmClientMetrics.di}</p>
                    </div>
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <Input 
                            className="pl-9 bg-slate-50 border-slate-200" 
                            placeholder="Buscar por nome, CNPJ ou email..." 
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                        />
                    </div>
                    <Select value={statusFilter} onValueChange={(value: any) => setStatusFilter(value)}>
                        <SelectTrigger className="w-full sm:w-40">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todos status</SelectItem>
                            <SelectItem value="active">Ativos</SelectItem>
                            <SelectItem value="inactive">Inativos</SelectItem>
                        </SelectContent>
                    </Select>
                    <Select value={hasContactFilter} onValueChange={(value: any) => setHasContactFilter(value)}>
                        <SelectTrigger className="w-full sm:w-44">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todos contatos</SelectItem>
                            <SelectItem value="yes">Com contato</SelectItem>
                            <SelectItem value="no">Sem contato</SelectItem>
                        </SelectContent>
                    </Select>
                    <Select value={piTypeFilter} onValueChange={(value: any) => setPiTypeFilter(value)}>
                        <SelectTrigger className="w-full sm:w-44">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todos tipos PI</SelectItem>
                            <SelectItem value="patente">Patente</SelectItem>
                            <SelectItem value="marca">Marca</SelectItem>
                            <SelectItem value="di">DI</SelectItem>
                        </SelectContent>
                    </Select>
                    <Button variant="outline" className="gap-2 h-10 text-sm bg-white text-slate-600 w-full sm:w-auto">
                        <Filter className="w-4 h-4" /> Filtros
                    </Button>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden min-h-[400px]">
                    {loading ? (
                        <div className="flex justify-center items-center h-64 text-slate-500">Carregando clientes...</div>
                    ) : filteredClients.length === 0 ? (
                        <div className="flex flex-col items-center justify-center text-center p-16">
                            <Users className="w-12 h-12 text-slate-300 mb-4" />
                            <h3 className="text-lg font-bold text-slate-800">Nenhum cliente encontrado</h3>
                            <p className="text-sm text-slate-500 mt-2 max-w-sm">
                                {query ? "Nenhum cliente corresponde à sua busca." : "Você ainda não cadastrou nenhum cliente no sistema."}
                            </p>
                            {!query && (
                                <Button onClick={() => setIsCreateModalOpen(true)} className="mt-6 gap-2 bg-blue-600 hover:bg-blue-700 text-white">
                                    <Plus className="w-4 h-4" /> Cadastrar Primeiro Cliente
                                </Button>
                            )}
                        </div>
                    ) : (
                        <>
                        <div className="md:hidden divide-y divide-slate-100">
                            {filteredClients.map((client) => (
                                <div key={`${client.id}-mobile`} className="p-3 space-y-2">
                                    <p className="font-semibold text-slate-800">{client.name}</p>
                                    <p className="text-xs text-slate-500">{client.document || "Sem documento"} • {client.email || "Sem e-mail"}</p>
                                    <div className="flex flex-wrap gap-1">
                                        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">{String(client.status || "active").toLowerCase() === "active" ? "Ativo" : "Inativo"}</Badge>
                                        <Badge variant="secondary">Contatos {client.contacts_count || 0}</Badge>
                                        <Badge variant="secondary">Ativos {client._count?.patents || 0}</Badge>
                                        {(client.pi_types || ["patente"]).map((type) => (
                                            <Badge key={`${client.id}-${type}`} variant="outline">{type.toUpperCase()}</Badge>
                                        ))}
                                    </div>
                                    <Button variant="outline" className="w-full h-9" onClick={() => loadClientProfile(client)}>
                                        Abrir Perfil
                                    </Button>
                                </div>
                            ))}
                        </div>
                        <Table className="hidden md:table">
                            <TableHeader className="bg-slate-50 border-b border-slate-100">
                                <TableRow className="hover:bg-transparent">
                                    <TableHead className="font-semibold text-slate-700">Cliente</TableHead>
                                    <TableHead className="font-semibold text-slate-700">Contato</TableHead>
                                    <TableHead className="font-semibold text-slate-700 text-center">Ativos Monitorados</TableHead>
                                    <TableHead className="font-semibold text-slate-700">Tipo PI</TableHead>
                                    <TableHead className="font-semibold text-slate-700">Status</TableHead>
                                    <TableHead className="font-semibold text-slate-700 text-right">Ações</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredClients.map((client) => (
                                    <TableRow key={client.id} className="hover:bg-slate-50/50 transition-colors">
                                        <TableCell>
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs">
                                                    {client.name.substring(0, 2).toUpperCase()}
                                                </div>
                                                <div>
                                                    <div className="font-semibold text-sm text-slate-800">{client.name}</div>
                                                    {client.document && <div className="text-xs text-slate-500 font-mono">{client.document}</div>}
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            {client.email ? (
                                                <div className="flex items-center gap-2 text-sm text-slate-600">
                                                    <Mail className="w-3.5 h-3.5 text-slate-400" />
                                                    {client.email}
                                                </div>
                                            ) : (
                                                <span className="text-xs text-slate-400 italic">Sem contato</span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <Badge variant="secondary" className="bg-slate-100 text-slate-700 font-mono">
                                                <Briefcase className="w-3 h-3 mr-1" /> {client._count?.patents || 0}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-wrap gap-1">
                                                {(client.pi_types || ["patente"]).map((type) => (
                                                    <Badge key={`${client.id}-desk-${type}`} variant="outline" className="uppercase">{type}</Badge>
                                                ))}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className={String(client.status || "active").toLowerCase() === "active" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-600 border-slate-200"}>
                                                {String(client.status || "active").toLowerCase() === "active" ? "Ativo" : "Inativo"}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="sm" className="text-blue-600 hover:text-blue-800 hover:bg-blue-50" onClick={() => loadClientProfile(client)}>
                                                Abrir Perfil
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                        </>
                    )}
                </div>
            </div>

            <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
                <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                        <DialogTitle>Novo Cliente</DialogTitle>
                        <DialogDescription>
                            Preencha os dados básicos para cadastrar o cliente no CRM.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="name" className="text-slate-700">Razão Social / Nome *</Label>
                            <Input 
                                id="name" 
                                value={newName} 
                                onChange={(e) => setNewName(e.target.value)} 
                                placeholder="Ex: TechCorp Inovações S.A." 
                                className="focus-visible:ring-blue-500"
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="document" className="text-slate-700">CNPJ / CPF</Label>
                            <div className="flex gap-2">
                                <Input
                                    id="document"
                                    value={newDocument}
                                    onChange={(e) => setNewDocument(e.target.value)}
                                    placeholder="Apenas números"
                                    className="focus-visible:ring-blue-500"
                                />
                                <Button type="button" variant="outline" onClick={handleAutofillCnpj} disabled={autofilling}>
                                    <Sparkles className="w-4 h-4 mr-1" />
                                    Autofill
                                </Button>
                            </div>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="email" className="text-slate-700">E-mail Principal</Label>
                            <Input 
                                id="email" 
                                type="email"
                                value={newEmail} 
                                onChange={(e) => setNewEmail(e.target.value)} 
                                placeholder="contato@empresa.com.br" 
                                className="focus-visible:ring-blue-500"
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label className="text-slate-700">Tipo de PI atendido</Label>
                            <div className="flex flex-wrap gap-2">
                                {(["patente", "marca", "di"] as const).map((type) => {
                                    const checked = newPiTypes.includes(type);
                                    return (
                                        <label key={type} className="flex items-center gap-2 text-xs text-slate-700 border rounded-md px-2 py-1 bg-slate-50">
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={(e) => {
                                                    setNewPiTypes((prev) => {
                                                        if (e.target.checked) return Array.from(new Set([...prev, type]));
                                                        const next = prev.filter((item) => item !== type);
                                                        return next.length ? next : ["patente"];
                                                    });
                                                }}
                                            />
                                            {type.toUpperCase()}
                                        </label>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsCreateModalOpen(false)}>Cancelar</Button>
                        <Button onClick={handleCreateClient} disabled={creating || !newName.trim()} className="bg-blue-600 hover:bg-blue-700 text-white">
                            {creating ? "Salvando..." : "Salvar Cliente"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
                <DialogContent className="sm:max-w-[840px]">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <UserRoundCog className="w-4 h-4" />
                            Perfil Operacional do Cliente
                        </DialogTitle>
                        <DialogDescription>
                            Configure responsáveis por assunto e contatos para roteamento de alertas.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="rounded-lg border p-4 space-y-3">
                            <p className="text-sm font-semibold text-slate-800">{selectedClient?.name || "-"}</p>
                            <p className="text-xs text-slate-500">CNPJ/CPF: {selectedClient?.document || "-"}</p>
                            <p className="text-xs text-slate-500">Contatos ativos: {contacts.filter((item) => item.active).length}</p>
                            <div className="space-y-2">
                                <Label>Novo responsável</Label>
                                <Input placeholder="Nome" value={newContactName} onChange={(e) => setNewContactName(e.target.value)} />
                                <Input placeholder="Email" value={newContactEmail} onChange={(e) => setNewContactEmail(e.target.value)} />
                                <Input placeholder="Telefone" value={newContactPhone} onChange={(e) => setNewContactPhone(e.target.value)} />
                                <Select value={newContactRole} onValueChange={(value: any) => setNewContactRole(value)}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Área" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="patents">Patentes</SelectItem>
                                        <SelectItem value="financial">Financeiro</SelectItem>
                                        <SelectItem value="brands">Marcas</SelectItem>
                                        <SelectItem value="general">Geral</SelectItem>
                                    </SelectContent>
                                </Select>
                                <label className="flex items-center gap-2 text-xs text-slate-600">
                                    <input type="checkbox" checked={newContactPrimary} onChange={(e) => setNewContactPrimary(e.target.checked)} />
                                    Definir como contato principal
                                </label>
                                <Button onClick={createContact} disabled={savingContact} className="w-full bg-blue-600 hover:bg-blue-700 text-white">
                                    {savingContact ? "Salvando..." : "Adicionar contato"}
                                </Button>
                            </div>
                        </div>
                        <div className="rounded-lg border p-4">
                            <p className="text-sm font-semibold mb-3">Responsáveis configurados</p>
                            <div className="space-y-2 max-h-[360px] overflow-y-auto">
                                {contacts.length === 0 ? (
                                    <p className="text-sm text-slate-500">Nenhum contato cadastrado.</p>
                                ) : contacts.map((contact) => (
                                    <div key={contact.id} className="rounded-md border p-2">
                                        <div className="flex items-center justify-between">
                                            <p className="text-sm font-medium">{contact.name}</p>
                                            <div className="flex gap-1">
                                                {contact.is_primary && <Badge className="bg-emerald-100 text-emerald-700">Principal</Badge>}
                                                <Badge variant="outline">{roleLabel[contact.role_area] || contact.role_area}</Badge>
                                            </div>
                                        </div>
                                        <p className="text-xs text-slate-600">{contact.email}</p>
                                        {contact.phone && <p className="text-xs text-slate-500">{contact.phone}</p>}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                    <div className="rounded-lg border p-4">
                        <div className="flex items-center justify-between mb-3">
                            <p className="text-sm font-semibold">Roteamento por tipo de ocorrência</p>
                            <Button size="sm" variant="outline" onClick={() => setRoutingRules((prev) => [...prev, { occurrenceType: "process_dispatch_61", roleArea: "patents" }])}>
                                Adicionar regra
                            </Button>
                        </div>
                        <div className="space-y-2">
                            {routingRules.map((rule, index) => (
                                <div key={`${rule.occurrenceType}-${index}`} className="grid grid-cols-1 md:grid-cols-4 gap-2">
                                    <Input value={rule.occurrenceType} onChange={(e) => setRoutingRules((prev) => prev.map((item, i) => i === index ? { ...item, occurrenceType: e.target.value } : item))} placeholder="Tipo de ocorrência" />
                                    <Select value={rule.roleArea} onValueChange={(value: any) => setRoutingRules((prev) => prev.map((item, i) => i === index ? { ...item, roleArea: value } : item))}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="patents">Patentes</SelectItem>
                                            <SelectItem value="financial">Financeiro</SelectItem>
                                            <SelectItem value="brands">Marcas</SelectItem>
                                            <SelectItem value="general">Geral</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <Select value={rule.overrideContactId || "none"} onValueChange={(value) => setRoutingRules((prev) => prev.map((item, i) => i === index ? { ...item, overrideContactId: value === "none" ? undefined : value } : item))}>
                                        <SelectTrigger><SelectValue placeholder="Contato override" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="none">Sem override</SelectItem>
                                            {contacts.map((contact) => (
                                                <SelectItem key={contact.id} value={contact.id}>{contact.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <Button variant="outline" onClick={() => setRoutingRules((prev) => prev.filter((_, i) => i !== index))}>Remover</Button>
                                </div>
                            ))}
                            {routingRules.length === 0 && <p className="text-xs text-slate-500">Sem regras específicas. O sistema usa fallback para contato principal.</p>}
                        </div>
                        <div className="flex justify-end mt-3">
                            <Button onClick={saveRoutingRules} className="bg-blue-600 hover:bg-blue-700 text-white">Salvar regras</Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </AppLayout>
    );
}
