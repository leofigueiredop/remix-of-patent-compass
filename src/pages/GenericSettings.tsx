import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export default function GenericSettings({ title }: { title: string }) {
    return (
        <AppLayout>
            <div className="space-y-6">
                <div>
                    <h1 className="text-2xl font-bold mb-1">{title}</h1>
                    <p className="text-muted-foreground text-sm">Configurações de preferências e notificações</p>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">Notificações</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center justify-between">
                            <Label htmlFor="email-notif">Notificações por Email</Label>
                            <Switch id="email-notif" defaultChecked />
                        </div>
                        <div className="flex items-center justify-between">
                            <Label htmlFor="push-notif">Notificações Push</Label>
                            <Switch id="push-notif" defaultChecked />
                        </div>
                        <div className="flex items-center justify-between">
                            <Label htmlFor="weekly-report">Relatório Semanal (RPI)</Label>
                            <Switch id="weekly-report" defaultChecked />
                        </div>
                    </CardContent>
                </Card>
            </div>
        </AppLayout>
    );
}
