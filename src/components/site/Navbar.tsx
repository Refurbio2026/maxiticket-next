import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Ticket, Search, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Navbar() {
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
            {["Podujatia", "Kategórie", "Mestá", "Organizátori", "Blog"].map((i) => (
              <a key={i} href="#" className="hover:text-foreground transition-colors">
                {i}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="rounded-xl">
              <Search className="size-4" />
            </Button>
            <Button variant="ghost" className="hidden sm:inline-flex rounded-xl text-sm">
              Prihlásiť
            </Button>
            <Button className="rounded-xl bg-gradient-flame text-primary-foreground hover:opacity-90 shadow-glow">
              Pridať podujatie
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
