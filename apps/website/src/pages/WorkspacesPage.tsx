import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore, WorkspaceSummary } from '../store/authStore';
import { api, ApiError } from '../lib/api';
import { Building2, Plus, ArrowRight, Star, Loader2, Settings } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
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
  const { workspaces, loadWorkspaces, isLoading, setTenantAuth, logoutAccount } = useAuthStore();
  const [enteringId, setEnteringId] = useState<string | null>(null);
  const navigate = useNavigate();
  const reduce = useReducedMotion();

  useEffect(() => {
    loadWorkspaces().catch(() => {});
  }, [loadWorkspaces]);

  const handleEnterWorkspace = async (workspace: WorkspaceSummary) => {
    setEnteringId(workspace.tenantId);
    try {
      const response = await api.post('/v1/accounts/workspaces/session', {
        tenantId: workspace.tenantId
      });
      setTenantAuth(response.auth.accessToken, response.workspace);

      // In local dev, *.localhost subdomains don't resolve in browsers.
      // Redirect to plain localhost:3001 — the JWT already carries tenant context.
      if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        window.open(`http://${workspace.subdomain}.localhost:3001/?token=${response.auth.accessToken}`, '_blank', 'noopener,noreferrer');
      } else {
        window.open((workspace.workspaceUrl || `https://${workspace.subdomain}.unifiedtree.com`) + `/?token=${response.auth.accessToken}`, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to enter workspace');
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
      <main className="flex min-h-screen flex-col px-4 pb-10 pt-24 sm:px-6 lg:h-screen lg:min-h-0 lg:pb-6 lg:pt-24">
        <motion.div
          initial={{ opacity: 0, y: reduce ? 0 : 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="m-auto w-full max-w-5xl"
        >
          <div className="grid overflow-hidden rounded-3xl border border-border bg-surface shadow-card-hover lg:grid-cols-[minmax(0,11fr)_minmax(0,9fr)]">

            {/* ── List pane ─────────────────────────────────────────────── */}
            <div className="flex flex-col p-4 sm:p-8 lg:justify-center lg:px-10 lg:py-9">
              <h1
                className="font-heading text-[24px] font-bold tracking-tight text-text-primary"
                style={{ fontVariationSettings: "'opsz' 32" }}
              >
                Your workspaces
              </h1>
              <p className="mt-1 font-body text-sm text-text-secondary">
                Select a workspace to enter, or create a new one to get started.
              </p>

              {isLoading && workspaces.length === 0 ? (
                <div className="mt-6 flex items-center justify-center rounded-2xl border border-border/70 bg-surface-2/60 py-16">
                  <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
                </div>
              ) : workspaces.length === 0 ? (
                <div className="mt-6 rounded-2xl border border-border/70 bg-surface-2/60 px-6 py-10 text-center">
                  <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-primary/10">
                    <Building2 className="h-7 w-7 text-primary" />
                  </div>
                  <h3 className="font-heading text-lg font-bold text-text-primary">No workspaces yet</h3>
                  <p className="mx-auto mt-1 max-w-xs font-body text-sm text-text-secondary">
                    Create your first workspace to start managing your organization's HR and operations.
                  </p>
                  <button
                    onClick={() => navigate('/pricing')}
                    className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 font-body text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-dark"
                  >
                    <Plus size={16} />
                    Create your first Workspace
                  </button>
                </div>
              ) : (
                <>
                  {/* Soft container, one quiet row per workspace. Caps at ~3
                      visible rows on desktop and scrolls internally beyond. */}
                  <div className="mt-6 overscroll-contain rounded-2xl border border-border/70 bg-surface-2/60 p-1.5 sm:p-2 lg:max-h-[264px] lg:overflow-y-auto">
                    <ul className="divide-y divide-border/60">
                      {workspaces.map((ws, i) => (
                        <motion.li
                          key={ws.tenantId}
                          initial={{ opacity: 0, y: reduce ? 0 : 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.35, delay: reduce ? 0 : 0.05 * i }}
                          className="flex items-center gap-2.5 px-2 py-3 sm:gap-3 sm:px-3"
                        >
                          {/* Initial tile */}
                          <div
                            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl font-heading text-base font-bold text-white shadow-sm sm:h-11 sm:w-11"
                            style={{ background: 'linear-gradient(135deg, #059669, #047857)' }}
                          >
                            {ws.tenantName.charAt(0).toUpperCase()}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <h3 className="truncate font-heading text-[15px] font-bold text-text-primary">{ws.tenantName}</h3>
                              <span className="shrink-0 rounded-md border border-border bg-surface px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-widest text-text-secondary">
                                {ws.role}
                              </span>
                              {ws.defaultWorkspace && (
                                <span title="Default Workspace" className="shrink-0">
                                  <Star size={13} className="fill-warning text-warning" />
                                </span>
                              )}
                            </div>
                            <p className="mt-0.5 whitespace-nowrap font-body text-xs font-medium text-text-secondary">
                              {ws.subdomain}.unifiedtree.com
                            </p>
                            <p className="font-body text-xs text-text-tertiary">{moduleSummary(ws.activeModules)}</p>
                          </div>

                          {/* Goes to the workspace's own admin-gated plan page.
                              Previously opened the public /edit-workspace editor,
                              which changed modules with no authentication at all —
                              removed 2026-08-08, see App.tsx. Managing modules is a
                              billing action and belongs behind a login. */}
                          <a
                            href={`https://${ws.subdomain}.unifiedtree.com/plan`}
                            onClick={(e) => e.stopPropagation()}
                            className="shrink-0 rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-primary/10 hover:text-primary"
                            title="Manage plan & modules"
                          >
                            <Settings size={16} />
                          </a>

                          {/* Row primary action — same launch flow as before */}
                          <button
                            onClick={() => handleEnterWorkspace(ws)}
                            disabled={enteringId === ws.tenantId}
                            className="group/btn flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-2.5 py-2 font-body text-[13px] font-semibold text-white shadow-sm transition-all hover:bg-primary-dark disabled:opacity-60 sm:px-4"
                          >
                            {enteringId === ws.tenantId ? (
                              <>
                                <Loader2 size={14} className="animate-spin" />
                                <span className="hidden sm:inline">Entering…</span>
                              </>
                            ) : (
                              <>
                                <span className="hidden sm:inline">Enter</span>
                                <ArrowRight size={14} className="transition-transform group-hover/btn:translate-x-0.5" />
                              </>
                            )}
                          </button>
                        </motion.li>
                      ))}
                    </ul>
                  </div>

                  {/* Quiet create row below the container */}
                  <button
                    onClick={() => navigate('/pricing')}
                    className="group mt-4 flex items-center gap-3 self-start rounded-xl p-1 pr-3 text-left transition-colors"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-dashed border-border bg-surface-2/60 text-text-secondary transition-colors group-hover:border-primary/40 group-hover:text-primary">
                      <Plus size={18} />
                    </span>
                    <span className="font-body text-sm font-semibold text-text-secondary transition-colors group-hover:text-text-primary">
                      Create new workspace
                    </span>
                  </button>
                </>
              )}
            </div>

            {/* ── Decorative pane — deep emerald, colour-on-colour geometry,
                   one real customer quote at the bottom. Hidden below lg. ── */}
            <div
              className="relative hidden overflow-hidden lg:flex lg:min-h-[480px] lg:flex-col"
              style={{ background: 'linear-gradient(160deg, #04503A 0%, #033325 55%, #02291E 100%)' }}
            >
              <div
                aria-hidden
                className={`absolute -right-24 -top-20 h-72 w-72 rotate-12 rounded-[56px] ${reduce ? '' : 'animate-float'}`}
                style={{ background: 'rgba(16,185,129,0.16)' }}
              />
              <div
                aria-hidden
                className="absolute -left-16 top-1/3 h-56 w-56 -rotate-6 rounded-[48px]"
                style={{ background: 'rgba(167,243,208,0.10)' }}
              />
              <div
                aria-hidden
                className={`absolute bottom-36 right-10 h-40 w-40 rotate-45 rounded-[36px] ${reduce ? '' : 'animate-float'}`}
                style={{ background: 'rgba(16,185,129,0.12)', animationDelay: '2.2s' }}
              />
              <span aria-hidden className="grain grain-dark" />

              {/* Fabricated "Vikram Patel / VPL Industries" testimonial
                  removed 2026-08-17 (CRIT #5). Replaced with a neutral
                  product statement that says what the platform actually
                  does — no invented attribution. */}
              <figure className="relative mt-auto p-8 xl:p-10">
                <blockquote className="font-body text-[15px] leading-relaxed text-white/85">
                  One connected core: HR, Payroll and Attendance share the same
                  records the moment you unlock them. Statutory calculations
                  (PF, ESI, TDS) run against the same ledger — no exports, no
                  re-keying.
                </blockquote>
                <figcaption className="mt-4">
                  <p className="font-body text-sm font-semibold text-white">Platform promise</p>
                  <p className="font-body text-xs text-white/60">The same records everywhere, from day one</p>
                </figcaption>
              </figure>
            </div>

          </div>
        </motion.div>
      </main>
    </div>
  );
}
