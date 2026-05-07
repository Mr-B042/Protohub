import React, { useState } from "react";
import { Sidebar } from "./Sidebar";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, Search, User, Menu } from "lucide-react";
import { cn } from "../lib/utils";

interface LayoutProps {
  children: React.ReactNode;
  activePage: string;
  setActivePage: (page: any) => void;
  onLogout?: () => void;
}

export const Layout: React.FC<LayoutProps> = ({
  children,
  activePage,
  setActivePage,
  onLogout
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary/10 selection:text-primary overflow-x-hidden">
      {/* Sidebar for Desktop */}
      <div className="hidden lg:block">
        <Sidebar
          activePage={activePage}
          setActivePage={setActivePage}
          isCollapsed={isCollapsed}
          setIsCollapsed={setIsCollapsed}
          onLogout={onLogout}
        />
      </div>

      {/* Main Content Area */}
      <motion.main
        initial={false}
        animate={{ 
          paddingLeft: isCollapsed ? "80px" : "280px" 
        }}
        className={cn(
          "transition-all duration-300 ease-in-out min-h-screen flex flex-col",
          "max-lg:!pl-0"   // Reset for mobile
        )}
      >
        {/* Header */}
        <header className="sticky top-0 z-40 h-20 glass border-b px-4 lg:px-8 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button 
              className="lg:hidden p-2 rounded-xl hover:bg-black/5 transition-colors"
              onClick={() => setIsMobileMenuOpen(true)}
            >
              <Menu className="w-6 h-6" />
            </button>
            <h2 className="text-xl font-bold text-foreground hidden sm:block">
              {activePage}
            </h2>
          </div>

          <div className="flex items-center gap-2 lg:gap-4">
            <div className="hidden md:flex items-center gap-2 bg-black/5 border border-black/5 rounded-xl px-4 py-2 w-64 focus-within:ring-2 focus-within:ring-primary/20 focus-within:bg-white transition-all">
              <Search className="w-4 h-4 text-muted-foreground" />
              <input 
                type="text" 
                placeholder="Search anything..." 
                className="bg-transparent border-none outline-none text-sm w-full"
              />
            </div>

            <div className="flex items-center gap-2">
              <button className="p-2.5 rounded-xl hover:bg-black/5 relative group transition-colors">
                <Bell className="w-5 h-5 text-muted-foreground group-hover:text-foreground" />
                <span className="absolute top-2.5 right-2.5 w-2 h-2 bg-primary rounded-full border-2 border-white" />
              </button>
              
              <div className="h-8 w-px bg-black/10 mx-1 hidden sm:block" />
              
              <button className="flex items-center gap-3 pl-2 pr-1 py-1 rounded-xl hover:bg-black/5 transition-colors">
                <div className="hidden sm:flex flex-col items-end text-right">
                  <span className="text-sm font-bold leading-tight">Admin</span>
                  <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Premium Account</span>
                </div>
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center text-white shadow-lg shadow-primary/20 transition-transform active:scale-95">
                  <User className="w-5 h-5" />
                </div>
              </button>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 p-4 lg:p-8 overflow-x-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={activePage}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="max-w-[1600px] mx-auto w-full"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.main>

      {/* Mobile Sidebar Backdrop */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMobileMenuOpen(false)}
              className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[55] lg:hidden"
            />
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed inset-y-0 left-0 w-[280px] z-[60] lg:hidden"
            >
              <Sidebar
                activePage={activePage}
                setActivePage={(page) => {
                  setActivePage(page);
                  setIsMobileMenuOpen(false);
                }}
                isCollapsed={false}
                setIsCollapsed={() => {}}
                onLogout={onLogout}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};
