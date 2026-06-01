import { useState } from 'react';
import { useAuthStore, ModuleCard } from '../store/authStore';
import { motion } from 'framer-motion';
import { Store, Loader2, Check, ArrowUpRight } from 'lucide-react';
import { api, ApiError } from '../lib/api';

export function MarketplacePage() {
  const { workspaceContext, loadWorkspaceContext } = useAuthStore();
  const [upgradingKey, setUpgradingKey] = useState<string | null>(null);
  const [successKey, setSuccessKey] = useState<string | null>(null);

  if (!workspaceContext) return null;

  const handleUpgrade = async (mod: ModuleCard) => {
    if (mod.action !== 'BUY') return;
    
    setUpgradingKey(mod.key);
    try {
      await api.post(`/v1/workspace/modules/${mod.key}/request-upgrade`);
      setSuccessKey(mod.key);
      await loadWorkspaceContext(); // Refresh the context to see updated modules
      setTimeout(() => setSuccessKey(null), 3000);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to request upgrade');
    } finally {
      setUpgradingKey(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-12">
      <header>
        <div className="flex items-center gap-2 mb-1">
          <Store className="text-primary" size={24} />
          <h1 className="font-heading font-extrabold text-3xl text-text-primary tracking-tight">Module Marketplace</h1>
        </div>
        <p className="text-text-secondary">Expand your UnifiedTree workspace with new capabilities.</p>
      </header>

      {workspaceContext.lockedPreviewModules.length === 0 ? (
        <div className="bg-surface rounded-xl border border-border p-12 text-center shadow-sm">
          <Store className="mx-auto text-text-tertiary mb-4" size={48} />
          <h3 className="font-heading font-bold text-xl text-text-primary mb-2">You have all modules!</h3>
          <p className="text-text-secondary">Your workspace is fully upgraded with all available features.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {workspaceContext.lockedPreviewModules.map((mod, i) => (
            <motion.div
              key={mod.key}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className="bg-surface border border-border rounded-xl p-6 shadow-sm hover:shadow-lg hover:border-primary/30 transition-all flex flex-col relative overflow-hidden"
            >
              {mod.action === 'COMING_SOON' && (
                <div className="absolute top-4 right-4 bg-bg border border-border px-3 py-1 rounded-full text-xs font-bold tracking-wider text-text-tertiary uppercase">
                  Coming Soon
                </div>
              )}
              
              <div className="w-12 h-12 rounded-xl bg-bg border border-border flex items-center justify-center text-text-primary font-bold font-heading text-xl mb-5">
                {mod.displayName.charAt(0)}
              </div>
              
              <h3 className="font-heading font-bold text-text-primary text-xl mb-2">{mod.displayName}</h3>
              <p className="text-sm text-text-secondary mb-8">{mod.category}</p>

              <div className="mt-auto">
                {mod.action === 'BUY' ? (
                  <button
                    onClick={() => handleUpgrade(mod)}
                    disabled={upgradingKey === mod.key || successKey === mod.key}
                    className={`w-full py-3 rounded-lg font-semibold text-sm transition-all flex items-center justify-center gap-2 ${
                      successKey === mod.key 
                        ? 'bg-green-100 text-green-700 border border-green-200'
                        : 'bg-primary text-white hover:bg-primary-dark shadow-teal hover:shadow-teal-lg'
                    }`}
                  >
                    {upgradingKey === mod.key ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : successKey === mod.key ? (
                      <Check size={16} />
                    ) : null}
                    
                    {upgradingKey === mod.key 
                      ? 'Processing...' 
                      : successKey === mod.key 
                        ? 'Upgrade Requested!' 
                        : 'Request Upgrade'}
                  </button>
                ) : mod.action === 'COMING_SOON' ? (
                  <button disabled className="w-full py-3 rounded-lg bg-bg border border-border text-text-tertiary font-semibold text-sm cursor-not-allowed">
                    Not Yet Available
                  </button>
                ) : (
                  <button className="w-full py-3 rounded-lg bg-surface border border-border hover:border-primary/30 text-text-primary font-semibold text-sm flex items-center justify-center gap-2 transition-colors">
                    Learn More <ArrowUpRight size={16} />
                  </button>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
