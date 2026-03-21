import { useEffect, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Users, Search, Plus, Filter, Mail, Phone, MapPin, Building, Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import axios from "axios";
import { toast } from "sonner";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:3000").replace(/\/+$/, "");

type Client = {
    id: string;
    name: string;
    email: string | null;
    document: string | null;
    status: string;
    created_at: string;
    _count?: {
        patents: number;
    }
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

    const loadClients = async () => {
        setLoading(true);
        try {
            const res = await axios.get(`${API_URL}/clients`).catch(() => ({ data: [] }));
            setClients(res.data);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
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
            await axios.post(`${API_URL}/clients`, {
                name: newName,
                email: newEmail || null,
                document: newDocument || null
            });
            toast.success("Cliente cadastrado com sucesso!");
            setIsCreateModalOpen(false);
            setNewName("");
            setNewEmail("");
            setNewDocument("");
            loadClients();
        } catch (error: any) {
            toast.error(error.response?.data?.error || "Erro ao criar cliente. Verifique se o backend tem a rota implementada.");
        } finally {
            setCreating(false);
        }
    };

    const filteredClients = clients.filter(c => 
        c.name.toLowerCase().includes(query.toLowerCase()) || 
        (c.document && c.document.includes(query)) ||
        (c.email && c.email.toLowerCase().includes(query.toLowerCase()))
    );

    return (
        <AppLayout>
            <div className="flex flex-col gap-6 w-full mx-auto">
                <div className="flex justify-between items-end">
                    <div className="animate-in fade-in slide-in-from-left duration-700">
                        <h1 className="text-2xl font-bold flex items-center gap-3 text-slate-900 mb-2">
                            <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center">
                                <Users className="w-5 h-5 text-blue-600" />
                            </div>
                            Gestão de Clientes
                        </h1>
                        <p className="text-muted-foreground text-sm mt-1">
                            Administre o portfólio de clientes, demandas e vínculos de monitoramento.
                        </p>
                    </div>
                    <Button onClick={() => setIsCreateModalOpen(true)} className="gap-2 bg-blue-600 hover:bg-blue-700 text-white">
                        <Plus className="w-4 h-4" /> Novo Cliente
                    </Button>
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <Input 
                            className="pl-9 bg-slate-50 border-slate-200" 
                            placeholder="Buscar por nome, CNPJ ou email..." 
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                        />
                    </div>
                    <Button variant="outline" className="gap-2 bg-white text-slate-600">
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
                        <Table>
                            <TableHeader className="bg-slate-50 border-b border-slate-100">
                                <TableRow className="hover:bg-transparent">
                                    <TableHead className="font-semibold text-slate-700">Cliente</TableHead>
                                    <TableHead className="font-semibold text-slate-700">Contato</TableHead>
                                    <TableHead className="font-semibold text-slate-700 text-center">Ativos Monitorados</TableHead>
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
                                            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                                                Ativo
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="sm" className="text-blue-600 hover:text-blue-800 hover:bg-blue-50">
                                                Abrir Perfil
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
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
                            <Input 
                                id="document" 
                                value={newDocument} 
                                onChange={(e) => setNewDocument(e.target.value)} 
                                placeholder="Apenas números" 
                                className="focus-visible:ring-blue-500"
                            />
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
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsCreateModalOpen(false)}>Cancelar</Button>
                        <Button onClick={handleCreateClient} disabled={creating || !newName.trim()} className="bg-blue-600 hover:bg-blue-700 text-white">
                            {creating ? "Salvando..." : "Salvar Cliente"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </AppLayout>
    );
}
