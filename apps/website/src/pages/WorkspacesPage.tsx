import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore, WorkspaceSummary } from '../store/authStore';
import { api, ApiError } from '../lib/api';
import { Building2, Plus, ArrowRight, Star, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { Navbar } from '../components/layout/Navbar';
import { Footer } from '../components/layout/Footer';

export function WorkspacesPage() {
  const { workspaces, loadWorkspaces, isLoading, setTenantAuth, logoutAccount } = useAuthStore();
  const [enteringId, setEnteringId] = useState<string | null>(null);
  const navigate = useNavigate();

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
    <div className="min-h-screen bg-bg flex flex-col font-body">
      <Navbar />

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-32 pb-16">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4 }}
          >
            <h1 className="text-3xl font-heading font-extrabold text-text-primary tracking-tight">
              Your Workspaces
            </h1>
            <p className="text-text-secondary mt-1 text-sm sm:text-base">
              Select a workspace to enter or create a new one to get started.
            </p>
          </motion.div>

          <motion.button 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4 }}
            onClick={() => navigate('/pricing')}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white hover:bg-primary-dark transition-all font-semibold text-sm shadow-sm hover:shadow shadow-primary/20"
          >
            <Plus size={18} />
            Create new workspace
          </motion.button>
        </div>

        {isLoading && workspaces.length === 0 ? (
          <div className="flex justify-center items-center py-32">
            <div className="relative">
              <div className="w-12 h-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
            </div>
          </div>
        ) : workspaces.length === 0 ? (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-surface rounded-2xl border border-border p-12 text-center shadow-sm mt-8 max-w-2xl mx-auto"
          >
            <div className="w-20 h-20 bg-primary/5 rounded-full flex items-center justify-center mx-auto mb-6">
              <Building2 className="text-primary w-10 h-10" />
            </div>
            <h3 className="font-heading font-bold text-2xl text-text-primary mb-3">No workspaces yet</h3>
            <p className="text-text-secondary mb-8 text-lg max-w-md mx-auto">Create your first workspace to start managing your organization's HR and operations.</p>
            <button 
              onClick={() => navigate('/pricing')}
              className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-primary text-white hover:bg-primary-dark transition-all font-semibold shadow-lg shadow-primary/25 hover:-translate-y-0.5"
            >
              <Plus size={20} />
              Create your first Workspace
            </button>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {workspaces.map((ws, i) => (
              <motion.div 
                key={ws.tenantId}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className="bg-surface border border-border hover:border-primary/30 rounded-2xl p-6 shadow-sm hover:shadow-md transition-all group flex flex-col h-full relative overflow-hidden"
              >
                {/* Accent top border */}
                <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-primary to-accent opacity-0 group-hover:opacity-100 transition-opacity" />

                <div className="flex items-start justify-between mb-5">
                  <div className="min-w-0 pr-4">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-heading font-bold text-lg text-text-primary truncate">{ws.tenantName}</h3>
                      {ws.defaultWorkspace && (
                        <span title="Default Workspace" className="shrink-0">
                          <Star size={16} className="text-warning fill-warning" />
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-text-secondary truncate">
                      {ws.subdomain}.unifiedtree.com
                    </p>
                  </div>
                  <div className="px-2.5 py-1 rounded-lg bg-surface-2 text-[10px] font-extrabold text-text-secondary uppercase tracking-widest border border-border shrink-0">
                    {ws.role}
                  </div>
                </div>

                <div className="flex-1 mb-6">
                  <p className="text-[11px] font-bold text-text-tertiary mb-3 uppercase tracking-wider">Active Modules</p>
                  <div className="flex flex-wrap gap-2">
                    {ws.activeModules?.length > 0 ? (
                      ws.activeModules.map(mod => (
                        <span key={mod.key} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary/5 text-primary border border-primary/10">
                          {mod.displayName}
                        </span>
                      ))
                    ) : (
                      <span className="text-sm text-text-tertiary italic">No active modules</span>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => handleEnterWorkspace(ws)}
                  disabled={enteringId === ws.tenantId}
                  className="w-full flex items-center justify-between px-5 py-3.5 rounded-xl bg-surface-2 hover:bg-primary hover:text-white text-text-primary border border-border hover:border-transparent transition-all font-semibold group/btn disabled:opacity-50 disabled:hover:bg-surface-2 disabled:hover:text-text-primary disabled:hover:border-border mt-auto"
                >
                  {enteringId === ws.tenantId ? (
                    <div className="flex items-center justify-center w-full gap-2">
                      <Loader2 size={18} className="animate-spin" />
                      <span>Entering...</span>
                    </div>
                  ) : (
                    <>
                      <span>Enter Workspace</span>
                      <ArrowRight size={18} className="text-text-tertiary group-hover/btn:text-white group-hover/btn:translate-x-1 transition-all" />
                    </>
                  )}
                </button>
              </motion.div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
