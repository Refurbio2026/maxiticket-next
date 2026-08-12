import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X, User, LogOut, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import logo from "@/assets/logo.png";

const NAV_LINKS: { key: string; to: string }[] = [
  { key: "nav.events", to: "/events" },
  { key: "nav.cities", to: "/#cities" },
  { key: "nav.artists", to: "/artists" },
  { key: "nav.marketing", to: "/marketing" },
  { key: "nav.support", to: "/support" },
  { key: "nav.partners", to: "/partners" },
  { key: "nav.contact", to: "/contact" },
];

export function Navbar() {
  const { user, signOut } = useAuth();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <motion.header
      initial={{ y: -24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="fixed top-0 inset-x-0 z-50"
    >
      <div className="glass border-x-0 border-t-0">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between gap-4">
          <Link
            to="/"
            className="flex items-center gap-2 group shrink-0"
            onClick={() => setOpen(false)}
          >
            <img src={logo} alt="vipky.sk" className="h-9 w-auto dark:invert" />
          </Link>

          <nav className="hidden lg:flex items-center gap-5 xl:gap-6 text-sm font-medium text-foreground/80">
            {NAV_LINKS.map((l) =>
              l.to.startsWith("/#") ? (
                <a
                  key={l.key}
                  href={l.to}
                  className="hover:text-foreground transition-colors whitespace-nowrap"
                >
                  {t(l.key)}
                </a>
              ) : (
                <Link
                  key={l.key}
                  to={l.to}
                  className="hover:text-foreground transition-colors whitespace-nowrap"
                >
                  {t(l.key)}
                </Link>
              ),
            )}
          </nav>

          <div className="flex items-center gap-2">
            <LanguageSwitcher className="rounded-xl" />
            <ThemeToggle className="rounded-xl" />
            {user ? (
              <>
                <Button
                  asChild
                  variant="ghost"
                  className="hidden md:inline-flex rounded-xl text-sm"
                >
                  <Link to="/account">
                    <User className="size-4 mr-1.5" /> {t("common.account")}
                  </Link>
                </Button>
                <Button
                  variant="ghost"
                  className="hidden md:inline-flex rounded-xl text-sm"
                  onClick={() => signOut()}
                >
                  <LogOut className="size-4 mr-1.5" /> {t("common.logout")}
                </Button>
              </>
            ) : (
              <Button asChild variant="ghost" className="hidden sm:inline-flex rounded-xl text-sm">
                <Link to="/login">{t("common.login")}</Link>
              </Button>
            )}
            <Button asChild variant="outline" className="hidden sm:inline-flex rounded-xl text-sm">
              <Link to="/scanner">
                <ScanLine className="size-4 mr-1.5" /> {t("common.scannerQR")}
              </Link>
            </Button>
            <Button
              asChild
              className="hidden sm:inline-flex rounded-xl bg-gradient-flame text-primary-foreground hover:opacity-90 shadow-glow"
            >
              <Link to="/login" search={{ section: "organizer" }}>
                {t("common.addEvent")}
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden rounded-xl"
              onClick={() => setOpen((v) => !v)}
              aria-label={open ? t("common.closeMenu") : t("common.openMenu")}
            >
              {open ? <X className="size-5" /> : <Menu className="size-5" />}
            </Button>
          </div>
        </div>

        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="lg:hidden mx-auto max-w-7xl px-4 pb-4 flex flex-col gap-1"
            >
              {NAV_LINKS.map((l) =>
                l.to.startsWith("/#") ? (
                  <a
                    key={l.key}
                    href={l.to}
                    onClick={() => setOpen(false)}
                    className="px-3 py-2.5 rounded-lg text-sm hover:bg-muted/40"
                  >
                    {t(l.key)}
                  </a>
                ) : (
                  <Link
                    key={l.key}
                    to={l.to}
                    onClick={() => setOpen(false)}
                    className="px-3 py-2.5 rounded-lg text-sm hover:bg-muted/40"
                  >
                    {t(l.key)}
                  </Link>
                ),
              )}
              <div className="h-px my-2 bg-border/50" />
              {user ? (
                <>
                  <Link
                    to="/account"
                    onClick={() => setOpen(false)}
                    className="px-3 py-2.5 rounded-lg text-sm hover:bg-muted/40 flex items-center gap-2"
                  >
                    <User className="size-4" /> {t("common.account")}
                  </Link>
                  <button
                    onClick={() => {
                      setOpen(false);
                      signOut();
                    }}
                    className="px-3 py-2.5 rounded-lg text-sm hover:bg-muted/40 flex items-center gap-2 text-left"
                  >
                    <LogOut className="size-4" /> {t("common.logout")}
                  </button>
                </>
              ) : (
                <Link
                  to="/login"
                  onClick={() => setOpen(false)}
                  className="px-3 py-2.5 rounded-lg text-sm hover:bg-muted/40"
                >
                  {t("common.login")}
                </Link>
              )}
              <Link
                to="/scanner"
                onClick={() => setOpen(false)}
                className="px-3 py-2.5 rounded-lg text-sm hover:bg-muted/40 flex items-center gap-2"
              >
                <ScanLine className="size-4" /> {t("common.scannerQR")}
              </Link>
              <Link
                to="/login"
                search={{ section: "organizer" }}
                onClick={() => setOpen(false)}
                className="mt-2 px-3 py-2.5 rounded-lg text-sm text-center bg-gradient-flame text-primary-foreground shadow-glow"
              >
                {t("common.addEvent")}
              </Link>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.header>
  );
}
