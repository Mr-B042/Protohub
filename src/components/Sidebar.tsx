import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  ChevronLeft, 
  ChevronRight, 
  LogOut,
  Sparkles
} from "lucide-react";
import { navItems } from "../data";
import { cn } from "../lib/utils";

interface SidebarProps {
  activePage: string;
  setActivePage: (page: any) => void;
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
  onLogout?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activePage,
  setActivePage,
  isCollapsed,
  setIsCollapsed,
  onLogout
}) => {
  return (
    <motion.aside
      initial={false}
      animate={{ width: isCollapsed ? 80 : 280 }}
      className={cn(
        "fixed left-0 top-0 h-screen z-50 flex flex-col",
        "glass border-r transition-all duration-300 ease-in-out"
      )}
    >
      {/* Brand Header */}
      <div className={cn(
        "h-20 flex items-center px-6 border-b border-white/20",
        isCollapsed ? "justify-center" : "justify-between"
      )}>
        <AnimatePresence mode="wait">
          {!isCollapsed ? (
            <motion.div
              key="full-logo"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex items-center gap-3"
            >
              <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center shadow-lg shadow-primary/20">
                <Sparkles className="w-6 h-6 text-white" />
              </div>
              <span className="font-bold text-xl tracking-tight text-foreground">Protohub</span>
            </motion.div>
          ) : (
            <motion.div
              key="collapsed-logo"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center shadow-lg shadow-primary/20"
            >
              <Sparkles className="w-6 h-6 text-white" />
            </motion.div>
          )}
        </AnimatePresence>

        {!isCollapsed && (
          <button
            onClick={() => setIsCollapsed(true)}
            className="p-1.5 rounded-lg hover:bg-black/5 text-muted-foreground transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Nav Items */}
      <div className="flex-1 overflow-y-auto py-6 px-3 custom-scrollbar">
        <nav className="space-y-1">
          {navItems.map((item) => {
            const isActive = activePage === item.label;
            const Icon = item.icon;

            return (
              <button
                key={item.label}
                onClick={() => setActivePage(item.label)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group relative",
                  isActive 
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/20" 
                    : "text-muted-foreground hover:bg-black/5 hover:text-foreground"
                )}
              >
                <Icon className={cn("w-5 h-5 shrink-0", isActive ? "text-white" : "group-hover:scale-110 transition-transform")} />
                {!isCollapsed && (
                  <motion.span
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="font-medium text-sm whitespace-nowrap"
                  >
                    {item.label}
                  </motion.span>
                )}
                
                {/* Tooltip for collapsed mode */}
                {isCollapsed && (
                  <div className="absolute left-full ml-4 px-2 py-1 bg-foreground text-background text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">
                    {item.label}
                  </div>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer / User Profile */}
      <div className="p-4 border-t border-white/20">
        <button
          onClick={onLogout}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-destructive hover:bg-destructive/10 transition-all duration-200",
            isCollapsed && "justify-center"
          )}
        >
          <LogOut className="w-5 h-5 shrink-0" />
          {!isCollapsed && <span className="font-medium text-sm">Logout</span>}
        </button>
        
        {isCollapsed && (
          <button
            onClick={() => setIsCollapsed(false)}
            className="mt-4 w-full flex justify-center p-2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        )}
      </div>
    </motion.aside>
  );
};
