import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Cloud, 
  Lock, 
  Plus, 
  Search, 
  Trash2, 
  Edit3, 
  LogOut, 
  LogIn,
  FileText,
  Link as LinkIcon,
  Code,
  Shield,
  Clock,
  Tag,
  ChevronRight,
  MoreVertical,
  X,
  Check,
  AlertCircle,
  Activity,
  HardDrive,
  FileUp
} from 'lucide-react';
import { useAuthState } from 'react-firebase-hooks/auth';
import { 
  auth, 
  googleProvider, 
  signInWithPopup, 
  signOut,
} from './firebase';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---
interface VaultItem {
  id: string;
  title: string;
  content: string;
  type: 'note' | 'link' | 'code' | 'secret';
  userId: string;
  createdAt: any;
  updatedAt?: any;
  tags?: string[];
}

// --- Components ---

const ErrorBoundary = ({ children }: { children: React.ReactNode }) => {
  const [hasError, setHasError] = useState(false);
  const [errorInfo, setErrorInfo] = useState<string | null>(null);

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      if (event.error?.message?.includes('{"error":')) {
        setHasError(true);
        setErrorInfo(event.error.message);
      }
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  if (hasError) {
    return (
      <div className="min-h-screen bg-[#0A0A0B] flex items-center justify-center p-6">
        <div className="bg-red-500/10 border border-red-500/50 p-8 rounded-3xl max-w-md w-full space-y-4">
          <div className="flex items-center gap-3 text-red-500">
            <AlertCircle className="w-8 h-8" />
            <h2 className="text-xl font-bold">Security Restriction</h2>
          </div>
          <p className="text-zinc-400 text-sm leading-relaxed">
            A database operation was blocked by security rules. This usually happens when trying to access data you don't own.
          </p>
          {errorInfo && (
            <pre className="bg-black/50 p-4 rounded-xl text-[10px] font-mono text-red-400 overflow-x-auto">
              {JSON.stringify(JSON.parse(errorInfo), null, 2)}
            </pre>
          )}
          <button 
            onClick={() => window.location.reload()}
            className="w-full bg-red-500 text-white font-bold py-3 rounded-xl hover:bg-red-600 transition-colors"
          >
            Reload Application
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

// --- Constants ---
const API_BASE_URL = 'https://ais-dev-uvpbmqchyfk4pf54otwrwt-190280519791.asia-east1.run.app';

// --- Types ---

interface Profile {
  id: number;
  name: string;
  avatar: string;
}

interface FileItem {
  id: number;
  filename: string;
  size: number;
  mime_type: string;
  category: string;
  created_at: string;
}

interface Stats {
  ram: { used: number; total: number; free: number };
  storage: { used: number; profileUsed: number; path: string };
  uptime: number;
  logs: any[];
}

export default function App() {
  const [user, loading, error] = useAuthState(auth);
  const [activeTab, setActiveTab] = useState<'vault' | 'files' | 'stats'>('vault');
  
  // Vault State
  const [items, setItems] = useState<VaultItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [editingItem, setEditingItem] = useState<VaultItem | null>(null);
  const [filter, setFilter] = useState<VaultItem['type'] | 'all'>('all');

  // Profile & Stats State
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfile, setActiveProfile] = useState<Profile | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    type: 'note' as VaultItem['type'],
    tags: ''
  });

  // Fetch Profiles on mount
  useEffect(() => {
    const fetchProfiles = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/profiles`);
        const data = await res.json();
        setProfiles(data);
        if (data.length > 0 && !activeProfile) setActiveProfile(data[0]);
      } catch (e) { console.error('Profiles fetch error:', e); }
    };
    fetchProfiles();
  }, []);

  // Main Data Fetching
  useEffect(() => {
    if (!user) {
      setItems([]);
      return;
    }

    const fetchData = async () => {
      try {
        // Fetch Vault Items
        const vaultRes = await fetch(`${API_BASE_URL}/api/vault?userId=${user.uid}`);
        if (vaultRes.ok) setItems(await vaultRes.json());

        // Fetch Stats & Files if profile active
        if (activeProfile) {
          const statsRes = await fetch(`${API_BASE_URL}/api/stats?profileId=${activeProfile.id}`);
          if (statsRes.ok) setStats(await statsRes.json());

          const filesRes = await fetch(`${API_BASE_URL}/api/files?profileId=${activeProfile.id}`);
          if (filesRes.ok) setFiles(await filesRes.json());
        }
      } catch (err: any) {
        console.error('Data sync error:', err);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [user, activeProfile]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeProfile) return;

    setIsUploading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(',')[1];
      try {
        const res = await fetch(`${API_BASE_URL}/api/process`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            data: base64,
            filename: file.name,
            type: file.type,
            profileId: activeProfile.id,
            category: 'mobile_upload'
          })
        });
        if (res.ok) {
          const filesRes = await fetch(`${API_BASE_URL}/api/files?profileId=${activeProfile.id}`);
          setFiles(await filesRes.json());
        }
      } catch (e) { console.error('Upload error:', e); }
      finally { setIsUploading(false); }
    };
    reader.readAsDataURL(file);
  };

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error('Login error:', err);
    }
  };

  const handleLogout = () => signOut(auth);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    const id = editingItem ? editingItem.id : Math.random().toString(36).substring(2, 15);
    const itemData = {
      id,
      title: formData.title,
      content: formData.content,
      type: formData.type,
      userId: user.uid,
      tags: formData.tags.split(',').map(t => t.trim()).filter(t => t !== '')
    };

    try {
      const method = editingItem ? 'PUT' : 'POST';
      const url = editingItem ? `${API_BASE_URL}/api/vault/${editingItem.id}` : `${API_BASE_URL}/api/vault`;
      
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(itemData)
      });

      if (!response.ok) throw new Error('Failed to save vault item');

      const fetchResponse = await fetch(`${API_BASE_URL}/api/vault?userId=${user.uid}`);
      setItems(await fetchResponse.json());

      setIsAdding(false);
      setEditingItem(null);
      setFormData({ title: '', content: '', type: 'note', tags: '' });
    } catch (err: any) {
      console.error('Save error:', err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure?')) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/vault/${id}?userId=${user?.uid}`, {
        method: 'DELETE'
      });
      if (response.ok) setItems(prev => prev.filter(item => item.id !== id));
    } catch (err: any) { console.error('Delete error:', err); }
  };

  const filteredItems = items.filter(item => {
    const matchesSearch = item.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                         item.content.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filter === 'all' || item.type === filter;
    return matchesSearch && matchesFilter;
  });

  if (loading) return <div className="min-h-screen bg-[#0A0A0B] flex items-center justify-center"><Cloud className="w-12 h-12 text-blue-500 animate-pulse" /></div>;

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0A0A0B] text-white flex flex-col items-center justify-center p-6 font-sans">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-md w-full text-center space-y-8">
          <div className="w-24 h-24 bg-blue-600 rounded-[2rem] flex items-center justify-center shadow-[0_0_50px_rgba(37,99,235,0.3)] mx-auto">
            <Shield className="w-12 h-12 text-white" />
          </div>
          <h1 className="text-5xl font-bold tracking-tight">Cloud Vault</h1>
          <p className="text-zinc-400">Your secure, multi-device data repository.</p>
          <button onClick={handleLogin} className="w-full bg-white text-black font-bold py-5 rounded-2xl flex items-center justify-center gap-3 hover:bg-zinc-200 transition-all">
            <LogIn className="w-5 h-5" /> Connect with Google
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-[#0A0A0B] text-white flex flex-col font-sans pb-24">
        {/* Header */}
        <header className="px-6 pt-8 pb-4 flex items-center justify-between sticky top-0 bg-[#0A0A0B]/80 backdrop-blur-xl z-40 border-b border-zinc-900">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg">
              <Cloud className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-lg tracking-tight">Vault Server</h1>
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] font-mono text-zinc-500 uppercase">
                  {activeProfile?.name || 'Main'} • Cloud Active
                </span>
              </div>
            </div>
          </div>
          <button onClick={handleLogout} className="p-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-500 hover:text-white transition-all">
            <LogOut className="w-5 h-5" />
          </button>
        </header>

        {/* Tab Navigation */}
        <div className="px-6 py-4 flex gap-2 overflow-x-auto no-scrollbar">
          {[
            { id: 'vault', label: 'Vault', icon: Lock },
            { id: 'files', label: 'Files', icon: FileText },
            { id: 'stats', label: 'Stats', icon: Activity }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={cn(
                "flex items-center gap-2 px-5 py-2.5 rounded-2xl text-xs font-bold uppercase tracking-widest transition-all border",
                activeTab === tab.id 
                  ? "bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-900/20" 
                  : "bg-zinc-900 border-zinc-800 text-zinc-500"
              )}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content Area */}
        <main className="flex-1 px-6">
          {activeTab === 'vault' && (
            <div className="space-y-6">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
                <input 
                  type="text"
                  placeholder="Search vault..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl pl-12 pr-4 py-4 focus:outline-none focus:border-blue-500 transition-all"
                />
              </div>
              <div className="grid grid-cols-1 gap-4">
                {filteredItems.map(item => (
                  <div key={item.id} className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-5 space-y-4">
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-zinc-800 rounded-2xl flex items-center justify-center text-blue-500">
                          {item.type === 'note' ? <FileText className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
                        </div>
                        <h3 className="font-bold">{item.title}</h3>
                      </div>
                      <button onClick={() => handleDelete(item.id)} className="text-zinc-600 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                    </div>
                    <p className="text-zinc-400 text-sm line-clamp-2">{item.content}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'files' && (
            <div className="space-y-6">
              <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 text-center space-y-4">
                <div className="w-16 h-16 bg-blue-600/10 rounded-full flex items-center justify-center mx-auto">
                  <FileUp className="w-8 h-8 text-blue-500" />
                </div>
                <div>
                  <h3 className="font-bold">Cloud Storage</h3>
                  <p className="text-xs text-zinc-500">Upload files to your private server</p>
                </div>
                <label className="block">
                  <span className="sr-only">Choose file</span>
                  <input type="file" onChange={handleFileUpload} className="block w-full text-sm text-zinc-500 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-blue-600 file:text-white hover:file:bg-blue-500 cursor-pointer" />
                </label>
                {isUploading && <div className="text-xs text-blue-500 animate-pulse">Uploading to cloud...</div>}
              </div>

              <div className="space-y-3">
                <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest px-2">Recent Files</h4>
                {files.map(file => (
                  <div key={file.id} className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-zinc-800 rounded-xl flex items-center justify-center text-zinc-400">
                        <FileText className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-zinc-200 truncate max-w-[150px]">{file.filename}</p>
                        <p className="text-[10px] text-zinc-500">{(file.size / 1024).toFixed(1)} KB • {file.category}</p>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-zinc-700" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'stats' && stats && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-5 space-y-3">
                  <Activity className="w-5 h-5 text-blue-500" />
                  <div>
                    <p className="text-[10px] font-bold text-zinc-500 uppercase">RAM Usage</p>
                    <p className="text-xl font-bold">{(stats.ram.used / 1024 / 1024 / 1024).toFixed(1)} GB</p>
                  </div>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-5 space-y-3">
                  <HardDrive className="w-5 h-5 text-emerald-500" />
                  <div>
                    <p className="text-[10px] font-bold text-zinc-500 uppercase">Storage</p>
                    <p className="text-xl font-bold">{(stats.storage.used / 1024 / 1024).toFixed(1)} MB</p>
                  </div>
                </div>
              </div>

              <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold flex items-center gap-2"><Clock className="w-4 h-4 text-zinc-500" /> Server Logs</h3>
                  <span className="text-[10px] font-mono text-zinc-500">Real-time</span>
                </div>
                <div className="space-y-2 max-h-60 overflow-y-auto font-mono text-[10px]">
                  {stats.logs.map((log, i) => (
                    <div key={i} className="flex items-center gap-2 py-1 border-b border-zinc-800 last:border-0">
                      <span className={cn(
                        "px-1.5 py-0.5 rounded text-[8px] font-bold",
                        log.status < 300 ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"
                      )}>{log.status}</span>
                      <span className="text-zinc-400">{log.method}</span>
                      <span className="text-zinc-600 truncate">{log.path}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </main>

        {/* FAB */}
        {activeTab === 'vault' && (
          <button 
            onClick={() => { setEditingItem(null); setFormData({ title: '', content: '', type: 'note', tags: '' }); setIsAdding(true); }}
            className="fixed bottom-8 right-8 w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center shadow-[0_10px_30px_rgba(37,99,235,0.4)] z-50"
          >
            <Plus className="w-8 h-8 text-white" />
          </button>
        )}
      </div>
    </ErrorBoundary>
  );
}

// --- Icons ---
import { Activity, HardDrive, FileUp } from 'lucide-react';

  const filteredItems = items.filter(item => {
    const matchesSearch = item.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                         item.content.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filter === 'all' || item.type === filter;
    return matchesSearch && matchesFilter;
  });
