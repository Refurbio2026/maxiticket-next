import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Ticket, Menu, Shield, LayoutDashboard, User, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";

export function Navbar() {
  const { user, isAdmin, isOrganizer, signOut } = useAuth();

  return (
    <motion.header
      initial={{ y: -24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="fixed top-0 inset-x-0 z-50"
    >
      <div className="mx-auto mt-4 max-w-7xl px-4">
        <div className="glass rounded-2xl px-4 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 group">
            <div className="size-9 rounded-xl bg-gradient-flame grid place-items-center shadow-glow">
              <Ticket className="size-5 text-primary-foreground" strokeWidth={2.5} />
            </div>
            <span className="font-display text-xl font-bold tracking-tight">
              maxi<span className="text-gradient-flame">ticket</span>
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-7 text-sm text-muted-foreground">
            <Link to="/events" className="hover:text-foreground transition-colors">Podujatia</Link>
            <a href="#categories" className="hover:text-foreground transition-colors">Kategórie</a>
            <a href="#cities" className="hover:text-foreground transition-colors">Mestá</a>
            <a href="#organizers" className="hover:text-foreground transition-colors">Organizátori</a>
            {isAdmin && (
              <Link to="/admin" className="text-primary font-semibold inline-flex items-center gap-1.5">
                <Shield className="size-4" /> Admin
              </Link>
            )}
            {isOrganizer && (
              <Link to="/organizer" className="hover:text-foreground transition-colors inline-flex items-center gap-1.5">
                <LayoutDashboard className="size-4" /> Organizer
              </Link>
            )}
          </nav>

          <div className="flex items-center gap-2">
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
              <>
                <Button asChild variant="ghost" className="hidden sm:inline-flex rounded-xl text-sm">
                  <Link to="/login">Prihlásiť</Link>
                </Button>
                <Button asChild variant="ghost" className="hidden sm:inline-flex rounded-xl text-sm">
                  <Link to="/register">Registrácia</Link>
                </Button>
              </>
            )}
            <Button asChild className="rounded-xl bg-gradient-flame text-primary-foreground hover:opacity-90 shadow-glow">
              <Link to={isOrganizer ? "/organizer/events/new" : "/login"}>Pridať podujatie</Link>
            </Button>
            <Button variant="ghost" size="icon" className="md:hidden rounded-xl">
              <Menu className="size-5" />
            </Button>
          </div>
        </div>
      </div>
    </motion.header>
  );
}
