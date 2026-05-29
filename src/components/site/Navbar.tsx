import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Ticket, Menu, User, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { ThemeToggle } from "@/components/theme-toggle";

const NAV_LINKS: { label: string; to: string }[] = [
  { label: "Podujatia", to: "/events" },
  { label: "Mestá", to: "/#cities" },
  { label: "Umelci", to: "/artists" },
  { label: "Marketing", to: "/marketing" },
  { label: "Podpora", to: "/support" },
  { label: "Spolupráca", to: "/partners" },
  { label: "Kontakt", to: "/contact" },
];

export function Navbar() {
  const { user, signOut } = useAuth();

  return (
    <motion.header
      initial={{ y: -24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="fixed top-0 inset-x-0 z-50"
    >
      <div className="mx-auto mt-4 max-w-7xl px-4">
        <div className="glass rounded-2xl px-4 py-3 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2 group shrink-0">
            <div className="size-9 rounded-xl bg-gradient-flame grid place-items-center shadow-glow">
              <Ticket className="size-5 text-primary-foreground" strokeWidth={2.5} />
            </div>
            <span className="font-display text-xl font-bold tracking-tight">
              maxi<span className="text-gradient-flame">ticket</span>
            </span>
          </Link>

          <nav className="hidden lg:flex items-center gap-5 xl:gap-6 text-sm text-muted-foreground">
            {NAV_LINKS.map((l) =>
              l.to.startsWith("/#") ? (
                <a key={l.label} href={l.to} className="hover:text-foreground transition-colors whitespace-nowrap">
                  {l.label}
                </a>
              ) : (
                <Link key={l.label} to={l.to} className="hover:text-foreground transition-colors whitespace-nowrap">
                  {l.label}
                </Link>
              ),
            )}
          </nav>

          <div className="flex items-center gap-2">
            <ThemeToggle className="rounded-xl" />
            {user ? (
              <>
                <Button asChild variant="ghost" className="rounded-xl text-sm">
                  <Link to="/account"><User className="size-4 mr-1.5" /> Účet</Link>
                </Button>
                <Button variant="ghost" className="rounded-xl text-sm" onClick={() => signOut()}>
                  <LogOut className="size-4 mr-1.5" /> Odhlásiť
                </Button>
              </>
            ) : (
              <Button asChild variant="ghost" className="hidden sm:inline-flex rounded-xl text-sm">
                <Link to="/login">Prihlásiť sa</Link>
              </Button>
            )}
            <Button asChild className="rounded-xl bg-gradient-flame text-primary-foreground hover:opacity-90 shadow-glow">
              <Link to="/login" search={{ section: "organizer" }}>Pridať podujatie</Link>
            </Button>
            <Button variant="ghost" size="icon" className="lg:hidden rounded-xl">
              <Menu className="size-5" />
            </Button>
          </div>
        </div>
      </div>
    </motion.header>
  );
}
