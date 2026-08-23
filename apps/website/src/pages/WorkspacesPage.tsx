import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore, WorkspaceSummary } from '../store/authStore';
import { api, ApiError } from '../lib/api';
import { Building2, Plus, ArrowRight, Star, Loader2, Settings, Check, X as XIcon } from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Navbar } from '../components/layout/Navbar';

/* Compact one-line module summary for a workspace row — the rows stay quiet,
   so instead of a chip per module we show "4 modules · Attendance, HRMS +2". */
function moduleSummary(mods: WorkspaceSummary['activeModules']): string {
  if (!mods || mods.length === 0) return 'No active modules';
  const names = mods.slice(0, 2).map((m) => m.displayName).join(', ');
  const extra = mods.length - 2;
  return `${mods.length} module${mods.length > 1 ? 's' : ''} · ${names}${extra > 0 ? ` +${extra}` : ''}`;
}

export function WorkspacesPage() {
  const {
    workspaces,
    loadWorkspaces,
    isLoading,
    isHydrating,
    accountToken,
    setTenantAuth,
  } = useAuthStore();
  const [enteringId, setEnteringId] = useState<string | null>(null);
  const navigate = useNavigate();
  const reduce = useReducedMotion();

  // Soft one-time acknowledgement after a successful Google OAuth round-trip.
  // The backend /callback 302s here with ?welcome=1 once the ut_acct_rt
  // refresh cookie is set — we surface a quiet banner so the user knows the
  // sign-in landed, then strip the query so a reload doesn't re-show it.
  // Read the flag from a synchronous searchParams snapshot rather than
  // useSearchParams state so setSearchParams() elsewhere can't retrigger it.
  const [searchParams] = useSearchParams();
  const [welcome, setWelcome] = useState(() => searchParams.get('welcome') === '1');
  useEffect(() => {
    if (!welcome) return;
    // Strip ?welcome=1 from the URL without triggering a navigation — the
    // router keeps its current location but a browser refresh won't
    // re-surface the banner.
    const url = new URL(window.location.href);
    url.searchParams.delete('welcome');
    window.history.replaceState(
      window.history.state,
      '',
      url.pathname + (url.search ? url.search : '') + url.hash,
    );
    // Auto-dismiss after ~5s so the layout returns to its resting state
    // without the user having to click it away.
    const t = window.setTimeout(() => setWelcome(false), 5000);
    return () => window.clearTimeout(t);
  }, [welcome]);

  useEffect(() => {
    // Wait for session hydration to finish before firing the /me/workspaces
    // call. Hitting it while `accountToken` is still null (the pre-refresh
    // window) would return 401 and bounce the user to /login — the exact
    // flash-of-logout the hydration flow exists to prevent.
    if (isHydrating) return;
    if (!accountToken) {
      // Hydration finished with no session — send the visitor to /login
      // rather than sitting on an empty "Your workspaces" screen.
      navigate('/login', { replace: true });
      return;
    }
    loadWorkspaces().catch(() => {});
  }, [loadWorkspaces, isHydrating, accountToken, navigate]);

  // Hydration-in-flight shim: a signed-in user reloading the page should
  // land back on their workspaces, not flash the login screen for ~300ms
  // while the refresh-cookie exchange completes.
  if (isHydrating) {
    return (
      <div className="surface-soft min-h-screen">
        <Navbar tone="light" />
        <main className="flex min-h-screen items-center justify-center px-4 pt-24">
          <div
            role="status"
            aria-label="Restoring your session"
            className="h-10 w-10 animate-spin rounded-full border-4 border-primary/20 border-t-primary"
          />
        </main>
      </div>
    );
  }

  const handleEnterWorkspace = async (workspace: WorkspaceSummary) => {
    setEnteringId(workspace.tenantId);
    try {
      const response = await api.post('/v1/accounts/workspaces/session', {
        tenantId: workspace.tenantId
      });
      setTenantAuth(response.auth.accessToken, response.workspace);

      // In local dev, *.localhost subdomains don't resolve in browsers.
      // Redirect to plain localhost:3001 — the JWT already carries tenant context.
      const target =
        window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
          ? `http://${workspace.subdomain}.localhost:3001/?token=${response.auth.accessToken}`
          : (workspace.workspaceUrl || `https://${workspace.subdomain}.unifiedtree.com`)
            + `/?token=${response.auth.accessToken}`;

      // Deliberately NOT passing 'noopener' in the feature string.
      //
      // Per the HTML spec, `window.open(..., 'noopener')` returns null even on
      // SUCCESS — severing the opener is exactly what the flag asks for. An
      // earlier version treated that null as "the popup was blocked" and fell
      // back to navigating this tab, so a successful click opened the workspace
      // in a new tab AND redirected the page behind it. Both happened at once.
      //
      // Opening without the flag and clearing `opener` ourselves keeps the same
      // reverse-tabnabbing protection while leaving a usable handle, so a null
      // return once again means what we need it to mean: genuinely blocked.
      const opened = window.open(target, '_blank');

      if (opened) {
        // Cut the back-reference so the workspace tab cannot touch window.opener.
        try { opened.opener = null; } catch { /* cross-origin: already isolated */ }
      } else {
        // Genuinely blocked by the browser. Navigating this tab is a direct
        // user-gesture navigation, which no popup blocker intercepts — better
        // than leaving the user staring at a button that did nothing.
        window.location.assign(target);
      }
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to enter workspace');
    } finally {
      // MUST run on the success path too. Previously this lived only in the
      // catch block, so once the workspace opened in a new tab the original
      // tab was pinned on "Entering…" indefinitely — the customer saw the
      // workspace launch correctly yet the button never recovered, and a
      // second workspace could not be opened without a full page reload.
      setEnteringId(null);
    }
  };

  return (
    <div className="surface-soft min-h-screen lg:h-screen lg:overflow-hidden">
      {/* Full site header — same treatment as the login page: the switcher
          reads as part of the site, not a detached app screen. */}
      <Navbar tone="light" />

      {/* Centred composition: one rounded card floating on the soft ground,
          workspace list left, deep-emerald decorative pane right. Below lg
          the emerald pane is hidden and the page scrolls normally. */}
      {/* Google-SSO acknowledgement — a soft toast anchored top-right of the
          viewport, out of the way of the main workspace list. Fades in when
          the user lands here via ?welcome=1 and auto-dismisses after 5s. */}
      <AnimatePresence>
        {welcome && (
          <motion.div
            initial={{ opacity: 0, y: reduce ? 0 : -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduce ? 0 : -8 }}
            transition={{ duration: 0.25 }}
            role="status"
            aria-live="polite"
            className="fixed right-4 top-20 z-40 flex max-w-sm items-start gap-2.5 rounded-xl border border-primary/20 bg-surface px-4 py-3 shadow-card-hover sm:right-6"
          >
            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
              <Check size={12} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-body text-[13px] font-semibold text-text-primary">
                Signed in with Google — welcome
              </p>
            </div>
            <button
              type="button"
              onClick={() => setWelcome(false)}
              aria-label="Dismiss"
              className="shrink-0 rounded-md p-0.5 text-text-tertiary transition-colors hover:bg-bg hover:text-text-primary"
            >
              <XIcon size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="flex min-h-screen flex-col px-4 pb-10 pt-24 sm:px-6 lg:h-screen lg:min-h-0 lg:pb-12 lg:pt-32">
        <motion.div
          initial={{ opacity: 0, y: reduce ? 0 : 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="m-auto w-full max-w-6xl"
        >
          <div className="grid overflow-hidden rounded-[2.5rem] border border-border/40 bg-surface shadow-[0_24px_64px_-12px_rgba(0,0,0,0.08)] lg:grid-cols-[minmax(0,13fr)_minmax(0,11fr)]">
            
            {/* ── List pane ─────────────────────────────────────────────── */}
            <div className="flex flex-col p-6 sm:p-10 lg:justify-center lg:px-14 lg:py-12">
              <h1
                className="font-heading text-3xl font-extrabold tracking-tight text-text-primary sm:text-4xl"
                style={{ fontVariationSettings: "'opsz' 32" }}
              >
                Your workspaces
              </h1>
              <p className="mt-2 font-body text-[15px] text-text-secondary/90">
                Select a workspace to enter, or create a new one to get started.
              </p>

              {isLoading && workspaces.length === 0 ? (
                <div className="mt-8 flex items-center justify-center rounded-3xl border border-border/40 bg-surface-2/30 py-20">
                  <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
                </div>
              ) : workspaces.length === 0 ? (
                <div className="mt-8 rounded-3xl border border-border/40 bg-surface-2/30 px-6 py-12 text-center">
                  <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 shadow-inner">
                    <Building2 className="h-8 w-8 text-primary" />
                  </div>
                  <h3 className="font-heading text-xl font-bold text-text-primary">No workspaces yet</h3>
                  <p className="mx-auto mt-2 max-w-sm font-body text-[15px] text-text-secondary/90">
                    Create your first workspace to start managing your organization's HR and operations.
                  </p>
                  <button
                    onClick={() => navigate('/pricing')}
                    className="mt-8 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-primary to-emerald-600 px-7 py-3 font-body text-[15px] font-semibold text-white shadow-lg transition-all hover:scale-[1.02] hover:shadow-xl hover:from-primary hover:to-emerald-500"
                  >
                    <Plus size={18} />
                    Create your first Workspace
                  </button>
                </div>
              ) : (
                <>
                  <div className="mt-8 overscroll-contain lg:max-h-[340px] lg:overflow-y-auto lg:pr-2">
                    <ul className="space-y-3">
                      {workspaces.map((ws, i) => (
                        <motion.li
                          key={ws.tenantId}
                          initial={{ opacity: 0, y: reduce ? 0 : 12 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.4, delay: reduce ? 0 : 0.08 * i }}
                          className="group/card relative flex items-center gap-3.5 rounded-2xl border border-border/40 bg-surface p-4 shadow-sm transition-all hover:-translate-y-1 hover:border-primary/20 hover:shadow-md sm:gap-4 sm:p-5"
                        >
                          {/* Initial tile */}
                          <div
                            className="grid h-12 w-12 shrink-0 place-items-center rounded-[14px] font-heading text-lg font-bold text-white shadow-inner sm:h-14 sm:w-14"
                            style={{ background: 'linear-gradient(135deg, #059669, #047857)' }}
                          >
                            {ws.tenantName.charAt(0).toUpperCase()}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2.5">
                              <h3 className="truncate font-heading text-base font-bold text-text-primary transition-colors group-hover/card:text-primary">{ws.tenantName}</h3>
                              <span className="shrink-0 rounded-md border border-border bg-surface-2 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-widest text-text-secondary">
                                {ws.role}
                              </span>
                              {ws.defaultWorkspace && (
                                <span title="Default Workspace" className="shrink-0">
                                  <Star size={14} className="fill-warning text-warning" />
                                </span>
                              )}
                            </div>
                            <p className="mt-0.5 truncate font-body text-[13px] font-medium text-text-secondary/80">
                              {ws.subdomain}.unifiedtree.com
                            </p>
                            <p className="mt-1 font-body text-[13px] text-text-tertiary">{moduleSummary(ws.activeModules)}</p>
                          </div>

                          <a
                            href={`https://${ws.subdomain}.unifiedtree.com/plan`}
                            onClick={(e) => e.stopPropagation()}
                            className="shrink-0 rounded-xl p-2 text-text-tertiary opacity-0 transition-all hover:bg-primary/10 hover:text-primary group-hover/card:opacity-100 focus:opacity-100"
                            title="Manage plan & modules"
                          >
                            <Settings size={18} />
                          </a>

                          <button
                            onClick={() => handleEnterWorkspace(ws)}
                            disabled={enteringId === ws.tenantId}
                            className="group/btn flex shrink-0 items-center gap-2 rounded-full bg-surface-2 px-4 py-2.5 font-body text-[14px] font-semibold text-text-primary shadow-sm ring-1 ring-inset ring-border/50 transition-all hover:bg-primary hover:text-white hover:ring-primary hover:shadow-md disabled:opacity-60 sm:px-5"
                          >
                            {enteringId === ws.tenantId ? (
                              <>
                                <Loader2 size={16} className="animate-spin" />
                                <span className="hidden sm:inline">Entering…</span>
                              </>
                            ) : (
                              <>
                                <span className="hidden sm:inline">Enter</span>
                                <ArrowRight size={16} className="transition-transform group-hover/btn:translate-x-1" />
                              </>
                            )}
                          </button>
                        </motion.li>
                      ))}
                    </ul>
                  </div>

                  <button
                    onClick={() => navigate('/pricing')}
                    className="group mt-5 flex items-center gap-3.5 self-start rounded-2xl p-1.5 pr-4 text-left transition-all hover:bg-surface-2/50"
                  >
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] border border-dashed border-border/80 bg-surface-2/40 text-text-secondary transition-colors group-hover:border-primary/40 group-hover:bg-primary/5 group-hover:text-primary">
                      <Plus size={20} />
                    </span>
                    <span className="font-body text-[15px] font-semibold text-text-secondary transition-colors group-hover:text-primary">
                      Create new workspace
                    </span>
                  </button>
                </>
              )}
            </div>

            {/* ── Decorative pane ────────────────────────────────────────── */}
            <div
              className="relative hidden overflow-hidden lg:flex lg:min-h-[560px] lg:flex-col"
              style={{ background: 'linear-gradient(160deg, #02291E 0%, #033325 50%, #04503A 100%)' }}
            >
              {/* Glassmorphic decorative orbs */}
              <div
                aria-hidden
                className={`absolute -right-20 -top-20 h-96 w-96 rounded-full blur-[80px] ${reduce ? '' : 'animate-pulse'}`}
                style={{ background: 'rgba(5, 150, 105, 0.4)', animationDuration: '8s' }}
              />
              <div
                aria-hidden
                className="absolute -left-20 top-1/4 h-72 w-72 rounded-full blur-[60px]"
                style={{ background: 'rgba(4, 120, 87, 0.3)' }}
              />
              <div
                aria-hidden
                className={`absolute bottom-10 right-10 h-64 w-64 rounded-full blur-[60px] ${reduce ? '' : 'animate-pulse'}`}
                style={{ background: 'rgba(16, 185, 129, 0.25)', animationDelay: '4s', animationDuration: '10s' }}
              />
              <span aria-hidden className="grain grain-dark opacity-30" />

              <div className="relative z-10 flex h-full flex-col p-10 xl:p-14">
                <figure className="mt-auto rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur-md">
                  <blockquote className="font-body text-[16px] leading-relaxed text-emerald-50">
                    One connected core: HR, Payroll and Attendance share the same
                    records the moment you unlock them. Statutory calculations
                    (PF, ESI, TDS) run against the same ledger — no exports, no
                    re-keying.
                  </blockquote>
                  <figcaption className="mt-6 flex items-center gap-4">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/10 shadow-inner">
                      <Star className="h-5 w-5 text-emerald-200" />
                    </div>
                    <div>
                      <p className="font-heading text-[15px] font-bold tracking-wide text-white">Platform promise</p>
                      <p className="font-body text-[13px] font-medium text-emerald-200/80">The same records everywhere, from day one</p>
                    </div>
                  </figcaption>
                </figure>
              </div>
            </div>

          </div>
        </motion.div>
      </main>
    </div>
  );
}
