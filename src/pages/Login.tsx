import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck, Lock, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    navigate("/dashboard");
  };

  return (
    <div className="min-h-screen flex">
      {/* Demo Banner */}
      <div className="demo-banner">
        ⚠ Versão de Demonstração — Dados simulados para fins de apresentação
      </div>

      {/* Left panel */}
      <div className="hidden lg:flex lg:w-1/2 items-center justify-center p-12" style={{ background: "var(--gradient-hero)" }}>
        <div className="max-w-md text-center">
          <div className="w-16 h-16 rounded-2xl bg-accent flex items-center justify-center mx-auto mb-8">
            <ShieldCheck className="w-8 h-8 text-accent-foreground" />
          </div>
          <h1 className="text-3xl font-bold text-primary-foreground mb-4">
            PatentScope
          </h1>
          <p className="text-primary-foreground/70 text-lg leading-relaxed">
            Sistema de apoio à pesquisa e análise prévia de patentes. 
            Colete briefings, extraia palavras-chave, pesquise em bases 
            e analise similaridade técnica.
          </p>
          <div className="mt-10 flex items-center justify-center gap-6 text-primary-foreground/50 text-sm">
            <span>INPI</span>
            <span className="w-1 h-1 rounded-full bg-primary-foreground/30" />
            <span>Espacenet</span>
            <span className="w-1 h-1 rounded-full bg-primary-foreground/30" />
            <span>AI Analysis</span>
          </div>
        </div>
      </div>

      {/* Right panel - Login form */}
      <div className="flex-1 flex items-center justify-center p-8 pt-16 bg-background">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-primary-foreground" />
            </div>
            <h1 className="text-xl font-bold">PatentScope</h1>
          </div>

          <h2 className="text-2xl font-bold mb-1">Bem-vindo de volta</h2>
          <p className="text-muted-foreground mb-8">
            Acesse sua conta para continuar
          </p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">E-mail</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  type="email"
                  placeholder="analista@empresa.com.br"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Senha</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <Button type="submit" className="w-full mt-2">
              Entrar
            </Button>
          </form>

          <p className="text-xs text-center text-muted-foreground mt-8">
            Demo — qualquer credencial funciona
          </p>
        </div>
      </div>
    </div>
  );
}
