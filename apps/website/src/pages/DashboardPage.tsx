import { useAuthStore } from '../store/authStore';
import { motion } from 'framer-motion';
import { ShieldCheck, Lock, ArrowRight, ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';

export function DashboardPage() {
  const { workspaceContext } = useAuthStore();

  if (!workspaceContext) return null;

  const isOwner = workspaceContext.role === 'OWNER';

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-12">
      <header>
        <h1 className="font-heading font-extrabold text-3xl text-text-primary tracking-tight">Dashboard</h1>
        <p className="text-text-secondary mt-1">Welcome to your UnifiedTree workspace overview.</p>
      </header>

      {/* Active Modules Section */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <ShieldCheck size={20} className="text-primary" />
          <h2 className="font-heading font-bold text-xl text-text-primary">Active Modules</h2>
        </div>
        
        {workspaceContext.activeModules.length === 0 ? (
          <div className="bg-surface rounded-xl border border-border p-8 text-center">
            <p className="text-text-secondary">No modules are currently active.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {workspaceContext.activeModules.map((mod, i) => (
              <motion.div
                key={mod.key}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                onClick={() => {
                  if (workspaceContext.workspaceUrl) {
                    window.open(workspaceContext.workspaceUrl + (mod.action || '/'), '_blank', 'noopener,noreferrer');
                  } else {
                    // Fallback if not provided by backend yet
                    window.open(`http://${workspaceContext.subdomain}.localhost:3001${mod.action || '/'}`, '_blank', 'noopener,noreferrer');
                  }
                }}
                className="bg-surface border border-border rounded-xl p-5 hover:border-primary/40 hover:shadow-md transition-all group flex flex-col h-full cursor-pointer"
              >
                <div className="flex justify-between items-start mb-4">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary-dark font-bold font-heading text-lg">
                    {mod.displayName.charAt(0)}
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-primary bg-primary/10 px-2 py-0.5 rounded-sm">Active</span>
                </div>
                <h3 className="font-heading font-bold text-text-primary text-lg mb-1">{mod.displayName}</h3>
                <p className="text-sm text-text-secondary mb-4 line-clamp-2">{mod.category} operations and settings.</p>
                <div className="mt-auto pt-4 border-t border-border/50 flex items-center justify-between text-sm font-semibold text-text-secondary group-hover:text-primary transition-colors">
                  Open Module
                  <ArrowUpRight size={16} />
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </section>

      {/* Owner-Only Preview Section */}
      {isOwner && workspaceContext.lockedPreviewModules?.length > 0 && (
        <section className="pt-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Lock size={20} className="text-text-tertiary" />
              <h2 className="font-heading font-bold text-xl text-text-primary">Available to Add</h2>
            </div>
            <Link 
              to="/app/marketplace"
              className="text-sm font-semibold text-primary hover:text-primary-dark flex items-center gap-1 transition-colors"
            >
              View all {workspaceContext.lockedModuleCount} modules
              <ArrowRight size={16} />
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {workspaceContext.lockedPreviewModules.map((mod, i) => (
              <motion.div
                key={mod.key}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + i * 0.05 }}
                className="bg-bg border border-dashed border-border rounded-xl p-5 hover:border-text-tertiary transition-all flex items-center justify-between"
              >
                <div>
                  <h3 className="font-heading font-bold text-text-secondary text-lg mb-1">{mod.displayName}</h3>
                  <p className="text-sm text-text-tertiary">{mod.category}</p>
                </div>
                <Link
                  to="/app/marketplace"
                  className="px-4 py-2 rounded-lg bg-surface border border-border text-text-primary text-sm font-semibold hover:border-primary/30 hover:text-primary transition-all"
                >
                  Explore
                </Link>
              </motion.div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
