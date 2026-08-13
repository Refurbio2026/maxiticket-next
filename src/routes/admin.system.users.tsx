import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Search, UserPlus, ShieldCheck, Store } from "lucide-react";
import {
  listUsers,
  setUserRole,
  createUserWithRole,
  type AdminUserRow,
  type AppRole,
} from "@/lib/users.functions";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/admin/system/users")({
  head: () => ({ meta: [{ title: "Používatelia · vipky.sk Admin" }] }),
  component: Page,
});

const ROLE_LABEL: Record<AppRole, string> = {
  user: "Používateľ",
  organizer: "Organizátor",
  admin: "Admin",
};

const ROLE_CLASS: Record<AppRole, string> = {
  user: "bg-muted text-muted-foreground",
  organizer: "bg-accent/15 text-accent",
  admin: "bg-primary/15 text-primary",
};

const fmtDate = (s: string | null) =>
  s
    ? new Date(s).toLocaleDateString("sk-SK", { day: "numeric", month: "short", year: "numeric" })
    : "—";

function Page() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const fetchUsers = useServerFn(listUsers);
  const changeRole = useServerFn(setUserRole);
  const createUser = useServerFn(createUserWithRole);

  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [role, setRole] = useState<"all" | AppRole>("all");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    email: "",
    password: "",
    full_name: "",
    role: "organizer" as AppRole,
  });

  const q = useQuery({
    queryKey: ["admin-users", activeSearch, role],
    queryFn: () => fetchUsers({ data: { search: activeSearch || undefined, role } }),
  });

  const roleMutation = useMutation({
    mutationFn: (v: { user_id: string; role: AppRole; enabled: boolean }) =>
      changeRole({ data: v }),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast.success(
        v.enabled ? `Rola ${ROLE_LABEL[v.role]} pridelená` : `Rola ${ROLE_LABEL[v.role]} odobraná`,
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Zmena roly zlyhala"),
  });

  const createMutation = useMutation({
    mutationFn: () => createUser({ data: form }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast.success("Účet vytvorený");
      setCreating(false);
      setForm({ email: "", password: "", full_name: "", role: "organizer" });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Účet sa nepodarilo vytvoriť"),
  });

  const users = q.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Používatelia</h1>
          <p className="text-muted-foreground mt-1">
            Účty a ich role. Rolu organizátora aj admina prideľuje výhradne admin.
          </p>
        </div>
        <Button
          onClick={() => setCreating(true)}
          className="bg-gradient-flame text-primary-foreground shadow-glow"
        >
          <UserPlus className="size-4 mr-2" /> Nový používateľ
        </Button>
      </div>

      <Card className="p-4 bg-card/60 border-border/50">
        <div className="flex flex-wrap items-center gap-3">
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setActiveSearch(search);
            }}
          >
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Meno alebo e-mail"
                className="w-64 pl-8"
              />
            </div>
            <Button type="submit" variant="outline">
              Hľadať
            </Button>
          </form>
          <Select value={role} onValueChange={(v) => setRole(v as "all" | AppRole)}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Všetky role</SelectItem>
              <SelectItem value="admin">Admini</SelectItem>
              <SelectItem value="organizer">Organizátori</SelectItem>
              <SelectItem value="user">Bez zvláštnej roly</SelectItem>
            </SelectContent>
          </Select>
          <span className="ml-auto text-sm text-muted-foreground">
            {q.isLoading ? "Načítavam…" : `${users.length} účtov`}
          </span>
        </div>
      </Card>

      <Card className="bg-card/60 border-border/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Používateľ</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium text-right">Podujatia</th>
                <th className="px-4 py-3 font-medium">Registrovaný</th>
                <th className="px-4 py-3 font-medium">Naposledy prihlásený</th>
                <th className="px-4 py-3 font-medium text-right">Prideliť rolu</th>
              </tr>
            </thead>
            <tbody>
              {q.isLoading && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                    <Loader2 className="mx-auto size-5 animate-spin" />
                  </td>
                </tr>
              )}
              {!q.isLoading && users.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                    Žiadny účet nezodpovedá filtru.
                  </td>
                </tr>
              )}
              {users.map((u: AdminUserRow) => (
                <tr key={u.id} className="border-b border-border/30 last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium">{u.full_name || "—"}</div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {u.roles.map((r) => (
                        <Badge key={r} className={`${ROLE_CLASS[r]} border-0`}>
                          {ROLE_LABEL[r]}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{u.events_count || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{fmtDate(u.created_at)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{fmtDate(u.last_sign_in_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <RoleToggle
                        icon={Store}
                        label="Organizátor"
                        active={u.roles.includes("organizer")}
                        disabled={roleMutation.isPending}
                        onClick={() =>
                          roleMutation.mutate({
                            user_id: u.id,
                            role: "organizer",
                            enabled: !u.roles.includes("organizer"),
                          })
                        }
                      />
                      <RoleToggle
                        icon={ShieldCheck}
                        label="Admin"
                        active={u.roles.includes("admin")}
                        // Vlastnú admin rolu si odobrať nedá — server to odmietne,
                        // tak to ani neponúkame.
                        disabled={
                          roleMutation.isPending || (u.id === user?.id && u.roles.includes("admin"))
                        }
                        onClick={() =>
                          roleMutation.mutate({
                            user_id: u.id,
                            role: "admin",
                            enabled: !u.roles.includes("admin"),
                          })
                        }
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nový používateľ</DialogTitle>
            <DialogDescription>
              Účet vznikne rovno s potvrdeným e-mailom, takže sa vie hneď prihlásiť. Heslo mu
              odovzdaj a nech si ho zmení.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Meno a priezvisko</Label>
              <Input
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>E-mail</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Heslo (aspoň 8 znakov)</Label>
              <Input
                type="text"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Rola</Label>
              <Select
                value={form.role}
                onValueChange={(v) => setForm({ ...form, role: v as AppRole })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="organizer">Organizátor</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="user">Bežný používateľ</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>
              Zrušiť
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={
                createMutation.isPending ||
                !form.email ||
                form.password.length < 8 ||
                !form.full_name
              }
            >
              {createMutation.isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
              Vytvoriť účet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RoleToggle({
  icon: Icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      size="sm"
      variant={active ? "default" : "outline"}
      disabled={disabled}
      onClick={onClick}
      title={active ? `Odobrať rolu ${label}` : `Prideliť rolu ${label}`}
    >
      <Icon className="size-3.5 mr-1.5" />
      {label}
    </Button>
  );
}
