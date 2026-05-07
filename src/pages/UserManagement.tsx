import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Users, 
  UserPlus, 
  Shield, 
  ShieldCheck, 
  ShieldAlert, 
  Search, 
  Filter, 
  Download, 
  Pencil, 
  KeyRound, 
  Trash2, 
  ChevronRight, 
  Lock, 
  Unlock, 
  CheckCircle2, 
  XCircle,
  Mail,
  UserRound,
  LayoutGrid,
  Settings,
  MoreVertical,
  Activity,
  History,
  ArrowUpRight
} from 'lucide-react';
import { 
  ManagedUser, 
  UserRole, 
  UserStatus, 
  UserPermission, 
  ModalType,
  ActivePage
} from '../types';

interface UserManagementProps {
  users: ManagedUser[];
  activeUserCount: number;
  userSearch: string;
  setUserSearch: (search: string) => void;
  userRole: UserRole;
  setUserRole: (role: UserRole) => void;
  userRoles: readonly UserRole[];
  userStatus: UserStatus;
  setUserStatus: (status: UserStatus) => void;
  userStatuses: readonly UserStatus[];
  filteredUsers: ManagedUser[];
  expandedPermissionsUserId: string | null;
  setExpandedPermissionsUserId: (id: string | null) => void;
  permissionDefs: readonly { key: UserPermission; label: string; group: string }[];
  defaultPermsByRole: Record<string, UserPermission[]>;
  toggleUserPermission: (userId: string, permission: UserPermission) => void;
  openAddUserModal: () => void;
  openEditUserModal: (user: ManagedUser) => void;
  openResetPasswordModal: (user: ManagedUser) => void;
  openDeleteUserModal: (user: ManagedUser) => void;
  setUsers: React.Dispatch<React.SetStateAction<ManagedUser[]>>;
  userInitials: (name: string) => string;
  showToast: (msg: string) => void;
  exportUserData: () => void;
}

export const UserManagement: React.FC<UserManagementProps> = ({
  users,
  activeUserCount,
  userSearch,
  setUserSearch,
  userRole,
  setUserRole,
  userRoles,
  userStatus,
  setUserStatus,
  userStatuses,
  filteredUsers,
  expandedPermissionsUserId,
  setExpandedPermissionsUserId,
  permissionDefs,
  defaultPermsByRole,
  toggleUserPermission,
  openAddUserModal,
  openEditUserModal,
  openResetPasswordModal,
  openDeleteUserModal,
  setUsers,
  userInitials,
  showToast,
  exportUserData
}) => {
  const stats = [
    { title: "Total Workforce", value: users.length, sub: "Registered Users", icon: UserRound, color: "text-blue-500", bg: "bg-blue-500/10" },
    { title: "Active Duty", value: activeUserCount, sub: `${users.length - activeUserCount} Inactive`, icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-500/10" },
    { title: "Onboarding", value: users.filter(u => {
      const created = new Date(u.created);
      const now = new Date();
      return created.getMonth() === now.getMonth() && created.getFullYear() === now.getFullYear();
    }).length, sub: "New this month", icon: UserPlus, color: "text-purple-500", bg: "bg-purple-500/10" },
  ];

  const roleColors: Record<string, string> = {
    "Owner": "bg-gray-900 text-white shadow-xl shadow-gray-900/10",
    "Admin": "bg-indigo-50 text-indigo-600 border-indigo-100",
    "Sales Rep": "bg-emerald-50 text-emerald-600 border-emerald-100",
    "Inventory Manager": "bg-amber-50 text-amber-600 border-amber-100",
  };

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-1">
          <h1 className="text-4xl font-black tracking-tight bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
            User Ecosystem
          </h1>
          <p className="text-muted-foreground font-medium">
            Manage corporate roles, identity access, and organizational security.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={exportUserData}
            className="flex items-center gap-2 px-6 py-3 bg-white border border-gray-100 text-gray-900 rounded-2xl text-sm font-black shadow-sm hover:shadow-xl hover:border-primary/20 transition-all active:scale-95"
          >
            <Download className="w-4 h-4 text-primary" />
            EXPORT DATA
          </button>
          <button 
            onClick={openAddUserModal}
            className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-2xl text-sm font-black shadow-lg shadow-primary/20 hover:scale-105 active:scale-95 transition-all"
          >
            <UserPlus className="w-4 h-4" />
            ADD USER
          </button>
        </div>
      </header>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {stats.map((stat, idx) => (
          <motion.div
            key={stat.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            className="group p-6 bg-white/40 backdrop-blur-xl border border-white/40 rounded-[2.5rem] shadow-sm hover:shadow-xl hover:shadow-primary/5 transition-all"
          >
            <div className="flex items-center justify-between mb-4">
              <div className={`p-3 rounded-2xl ${stat.bg} ${stat.color} transition-transform group-hover:scale-110 duration-500`}>
                <stat.icon className="w-6 h-6" />
              </div>
            </div>
            <div className="space-y-1">
              <h3 className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">{stat.title}</h3>
              <div className="text-2xl font-black tracking-tight text-gray-900">{stat.value}</div>
              <p className="text-[10px] font-bold text-muted-foreground italic uppercase tracking-wider">{stat.sub}</p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-1 max-w-2xl">
          <div className="relative flex-1 group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground transition-colors group-focus-within:text-primary" />
            <input 
              type="text" 
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="Search name, email..."
              className="w-full pl-11 pr-4 py-2.5 bg-white border border-gray-100 rounded-2xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all shadow-sm"
            />
          </div>
          <select 
            className="px-4 py-2.5 bg-white border border-gray-100 rounded-2xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all shadow-sm"
            value={userRole} 
            onChange={(e) => setUserRole(e.target.value as UserRole)}
          >
            {userRoles.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <select 
            className="px-4 py-2.5 bg-white border border-gray-100 rounded-2xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all shadow-sm"
            value={userStatus} 
            onChange={(e) => setUserStatus(e.target.value as UserStatus)}
          >
            {userStatuses.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* Users Table */}
      <section className="bg-white/40 backdrop-blur-xl border border-white/40 rounded-[2.5rem] shadow-sm overflow-hidden">
        <div className="px-8 py-6 border-b border-white/40 flex items-center justify-between bg-white/20">
          <h2 className="text-xl font-black text-gray-900 flex items-center gap-3">
            <LayoutGrid className="w-5 h-5 text-primary" />
            Identity Registry
          </h2>
          <span className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">
            {filteredUsers.length} Profiles Selected
          </span>
        </div>

        <div className="overflow-x-auto overflow-y-visible">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50/50">
                <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">User Profile</th>
                <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Authority Level</th>
                <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Access Control</th>
                <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Vital Status</th>
                <th className="px-8 py-4 text-xs font-black text-muted-foreground uppercase tracking-widest text-right">Operations</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/40">
              <AnimatePresence mode="popLayout">
                {filteredUsers.length === 0 ? (
                  <motion.tr
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <td colSpan={5} className="px-8 py-20 text-center">
                      <div className="flex flex-col items-center gap-4 opacity-50">
                        <Users className="w-12 h-12 text-muted-foreground" />
                        <p className="text-sm font-bold text-muted-foreground italic max-w-xs mx-auto">
                          No users found matching these criteria.
                        </p>
                      </div>
                    </td>
                  </motion.tr>
                ) : (
                  filteredUsers.map((user, idx) => {
                    const isOwner = user.role === "Owner";
                    const isExpanded = expandedPermissionsUserId === user.id;
                    const userPerms = user.permissions ?? defaultPermsByRole[user.role] ?? [];

                    return (
                      <React.Fragment key={user.id}>
                        <motion.tr
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 20 }}
                          transition={{ delay: idx * 0.02 }}
                          className="group hover:bg-white/60 transition-all duration-300"
                        >
                          <td className="px-8 py-5">
                            <div className="flex items-center gap-4">
                              <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-sm font-black text-primary shadow-inner group-hover:scale-105 transition-transform">
                                {userInitials(user.name)}
                              </div>
                              <div className="space-y-0.5">
                                <div className="font-bold text-gray-900 group-hover:text-primary transition-colors">
                                  {user.name}
                                </div>
                                <div className="flex items-center gap-1.5 text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                                  <Mail className="w-3 h-3" />
                                  {user.email}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-8 py-5">
                            <span className={`px-3 py-1 rounded-xl text-[9px] font-black uppercase tracking-widest border transition-all ${roleColors[user.role] || 'bg-gray-50 text-gray-500 border-gray-100'}`}>
                              {user.role}
                            </span>
                          </td>
                          <td className="px-8 py-5">
                            <button
                              onClick={() => setExpandedPermissionsUserId(isExpanded ? null : user.id)}
                              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                                isExpanded 
                                ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20' 
                                : 'bg-white border border-gray-100 text-gray-600 hover:border-primary/20 hover:text-primary'
                              }`}
                            >
                              <Shield className="w-3 h-3" />
                              {isOwner ? "Full Authority" : `${userPerms.length} Directives`}
                              <ChevronRight className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                            </button>
                          </td>
                          <td className="px-8 py-5">
                            <button
                              onClick={() => {
                                setUsers(prev => prev.map(u => u.id === user.id ? { ...u, active: !u.active } : u));
                                showToast(`${user.name} access ${user.active ? 'suspended' : 'restored'}.`);
                              }}
                              className={`flex items-center gap-2 text-xs font-black uppercase tracking-widest transition-colors ${
                                user.active ? 'text-emerald-600' : 'text-rose-600'
                              }`}
                            >
                              <div className={`w-8 h-4 rounded-full relative transition-colors ${user.active ? 'bg-emerald-500' : 'bg-rose-500'}`}>
                                <motion.div 
                                  animate={{ left: user.active ? '1rem' : '0.125rem' }}
                                  className="absolute top-0.5 w-3 h-3 bg-white rounded-full shadow-sm"
                                />
                              </div>
                              {user.active ? 'Operational' : 'Suspended'}
                            </button>
                          </td>
                          <td className="px-8 py-5 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {[
                                { icon: Pencil, title: "Edit Access", action: () => openEditUserModal(user) },
                                { icon: KeyRound, title: "Rotate Credentials", action: () => openResetPasswordModal(user) },
                              ].map((btn, bidx) => (
                                <button
                                  key={bidx}
                                  onClick={btn.action}
                                  title={btn.title}
                                  className="p-2.5 rounded-xl bg-white border border-gray-100 text-gray-400 hover:text-primary hover:border-primary/20 hover:shadow-lg hover:scale-110 transition-all active:scale-95"
                                >
                                  <btn.icon className="w-4 h-4" />
                                </button>
                              ))}
                              {!isOwner && (
                                <button
                                  onClick={() => openDeleteUserModal(user)}
                                  title="Terminate"
                                  className="p-2.5 rounded-xl bg-white border border-rose-100 text-rose-400 hover:bg-rose-50 hover:border-rose-200 hover:text-rose-600 hover:scale-110 transition-all active:scale-95"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </td>
                        </motion.tr>
                        
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.tr
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              className="bg-primary/[0.02] border-b border-primary/5"
                            >
                              <td colSpan={5} className="px-8 py-6">
                                <div className="space-y-6">
                                  <div className="flex items-center justify-between">
                                    <div className="space-y-1">
                                      <h4 className="text-xs font-black text-gray-900 uppercase tracking-widest flex items-center gap-2">
                                        <ShieldCheck className="w-3.5 h-3.5 text-primary" />
                                        Directive Permissions Matrix
                                      </h4>
                                      <p className="text-[10px] font-medium text-muted-foreground italic">
                                        Granular access control list for specialized operational domains.
                                      </p>
                                    </div>
                                    {!isOwner && (
                                      <button 
                                        onClick={() => setUsers(prev => prev.map(u => u.id === user.id ? { ...u, permissions: defaultPermsByRole[u.role] } : u))}
                                        className="text-[9px] font-black text-primary uppercase tracking-widest hover:underline"
                                      >
                                        RESET TO ROLE DEFAULTS
                                      </button>
                                    )}
                                  </div>
                                  
                                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                                    {Array.from(new Set(permissionDefs.map(p => p.group))).map(group => (
                                      <div key={group} className="space-y-3">
                                        <h5 className="text-[9px] font-black text-muted-foreground uppercase tracking-[0.2em] pb-1 border-b border-gray-100">
                                          {group}
                                        </h5>
                                        <div className="space-y-2">
                                          {permissionDefs.filter(p => p.group === group).map(perm => {
                                            const hasIt = isOwner || userPerms.includes(perm.key);
                                            return (
                                              <label 
                                                key={perm.key} 
                                                className={`flex items-center gap-3 p-2 rounded-xl border transition-all cursor-pointer ${
                                                  hasIt 
                                                  ? 'bg-white border-primary/10 shadow-sm' 
                                                  : 'bg-gray-50/50 border-gray-100 opacity-50 grayscale hover:grayscale-0'
                                                } ${isOwner ? 'cursor-not-allowed pointer-events-none' : ''}`}
                                              >
                                                <button
                                                  onClick={() => !isOwner && toggleUserPermission(user.id, perm.key)}
                                                  className={`w-8 h-4 rounded-full relative transition-colors ${hasIt ? 'bg-primary' : 'bg-gray-300'}`}
                                                >
                                                  <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow-sm transition-all ${hasIt ? 'left-4' : 'left-0.5'}`} />
                                                </button>
                                                <span className="text-[10px] font-bold text-gray-700">
                                                  {perm.label}
                                                </span>
                                              </label>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </td>
                            </motion.tr>
                          )}
                        </AnimatePresence>
                      </React.Fragment>
                    );
                  })
                )}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
