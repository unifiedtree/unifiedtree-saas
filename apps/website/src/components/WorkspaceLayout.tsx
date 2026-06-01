import { useEffect } from 'react';
import { Outlet, useNavigate, Link, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { LayoutDashboard, Store, Building2, LogOut, Loader2, ArrowLeft } from 'lucide-react';

export function WorkspaceLayout() {
  const { workspaceContext, loadWorkspaceContext, isLoading, logoutTenant } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!workspaceContext && !isLoading) {
      loadWorkspaceContext().catch(() => {
        // If context fails, token might be invalid, return to workspaces
        logoutTenant();
        navigate('/workspaces');
      });
    }
  }, [workspaceContext, loadWorkspaceContext, isLoading, navigate, logoutTenant]);

  if (isLoading || !workspaceContext) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <Loader2 className="animate-spin text-primary" size={32} />
      </div>
    );
  }

  const handleSwitchWorkspace = () => {
    logoutTenant();
    navigate('/workspaces');
  };

  const isOwner = workspaceContext.role === 'OWNER';

  return (
    <div className="min-h-screen bg-bg flex font-body">
      {/* Sidebar */}
      <aside className="w-64 bg-surface border-r border-border flex flex-col hidden md:flex">
        <div className="p-4 border-b border-border flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
            <Building2 size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-heading font-bold text-text-primary text-sm truncate">
              {workspaceContext.tenantName}
            </h2>
            <p className="text-xs text-text-tertiary truncate">{workspaceContext.subdomain}.unifiedtree.com</p>
          </div>
        </div>

        <div className="p-3">
          <div className="text-xs font-bold text-text-tertiary uppercase tracking-wider mb-2 px-3">Main Menu</div>
          <nav className="space-y-1">
            <Link 
              to="/app/dashboard"
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                location.pathname === '/app/dashboard' 
                  ? 'bg-primary/10 text-primary' 
                  : 'text-text-secondary hover:bg-bg hover:text-text-primary'
              }`}
            >
              <LayoutDashboard size={18} />
              Dashboard
            </Link>

            {/* In a real app we would map activeModules to their respective navigation routes here */}
            {workspaceContext.activeModules.map(mod => (
              <a 
                key={mod.key}
                href="#"
                className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-text-secondary hover:bg-bg hover:text-text-primary transition-colors"
              >
                <div className="w-4 h-4 rounded-full border-2 border-primary/40 flex-shrink-0" />
                {mod.displayName}
              </a>
            ))}

            {isOwner && (
              <Link 
                to="/app/marketplace"
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  location.pathname === '/app/marketplace' 
                    ? 'bg-accent/10 text-accent' 
                    : 'text-text-secondary hover:bg-bg hover:text-text-primary'
                }`}
              >
                <Store size={18} />
                Marketplace
              </Link>
            )}
          </nav>
        </div>

        <div className="mt-auto p-4 border-t border-border">
          <button 
            onClick={handleSwitchWorkspace}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-text-secondary hover:bg-bg hover:text-text-primary transition-colors"
          >
            <ArrowLeft size={16} />
            Switch Workspace
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-y-auto">
        {/* Mobile Header */}
        <header className="md:hidden bg-surface border-b border-border p-4 flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center gap-2">
            <Building2 className="text-primary" size={20} />
            <h1 className="font-heading font-bold text-text-primary">{workspaceContext.tenantName}</h1>
          </div>
          <button onClick={handleSwitchWorkspace} className="text-text-secondary hover:text-primary">
            <ArrowLeft size={20} />
          </button>
        </header>

        <div className="flex-1 p-6 lg:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
