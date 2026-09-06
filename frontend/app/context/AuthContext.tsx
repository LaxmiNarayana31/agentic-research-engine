'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001';

export interface User {
  id: string;
  email: string;
  full_name: string;
  avatar_url?: string;
  role: string;
  auth_provider: string;
  created_at?: string;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  tier: string;
  role: string;
}

export interface UsageQuota {
  tier: string;
  rate_limit_per_minute: number;
  remaining: number;
  reset_seconds: number;
  is_authenticated: boolean;
  user_email?: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  activeTenant: Tenant | null;
  workspaces: Tenant[];
  usage: UsageQuota | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, fullName: string, workspaceName?: string) => Promise<void>;
  loginWithGoogle: (idToken: string) => Promise<void>;
  logout: () => void;
  switchWorkspace: (tenantId: string) => void;
  refreshUsage: () => Promise<void>;
  getAuthHeaders: () => Record<string, string>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [activeTenant, setActiveTenant] = useState<Tenant | null>(null);
  const [workspaces, setWorkspaces] = useState<Tenant[]>([]);
  const [usage, setUsage] = useState<UsageQuota | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const getAuthHeaders = useCallback((): Record<string, string> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }, [token]);

  const refreshUsage = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/usage`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setUsage(data);
      }
    } catch {
      // Ignore usage fetch errors
    }
  }, [getAuthHeaders]);

  const fetchUserProfile = useCallback(async (authToken: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/me`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setActiveTenant(data.active_tenant || null);
        setWorkspaces(data.workspaces || []);
      } else {
        // Token expired or invalid
        localStorage.removeItem('dr_access_token');
        setToken(null);
        setUser(null);
      }
    } catch {
      // Backend unreachable or offline
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initialize on mount from localStorage
  useEffect(() => {
    const storedToken = localStorage.getItem('dr_access_token');
    if (storedToken) {
      setToken(storedToken);
      fetchUserProfile(storedToken);
    } else {
      setIsLoading(false);
    }
  }, [fetchUserProfile]);

  useEffect(() => {
    refreshUsage();
  }, [user, refreshUsage]);

  const login = async (email: string, password: string) => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errorMsg = data.error?.message || data.message || data.detail || 'Login failed.';
        throw new Error(errorMsg);
      }
      localStorage.setItem('dr_access_token', data.access_token);
      localStorage.setItem('dr_refresh_token', data.refresh_token);
      setToken(data.access_token);
      setUser(data.user);
      setActiveTenant(data.active_tenant || null);
      setWorkspaces(data.workspaces || []);
      await refreshUsage();
    } finally {
      setIsLoading(false);
    }
  };

  const signup = async (email: string, password: string, fullName: string, workspaceName?: string) => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          full_name: fullName,
          workspace_name: workspaceName,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errorMsg = data.error?.message || data.message || data.detail || 'Signup failed.';
        throw new Error(errorMsg);
      }
      localStorage.setItem('dr_access_token', data.access_token);
      localStorage.setItem('dr_refresh_token', data.refresh_token);
      setToken(data.access_token);
      setUser(data.user);
      setActiveTenant(data.active_tenant || null);
      setWorkspaces(data.workspaces || []);
      await refreshUsage();
    } finally {
      setIsLoading(false);
    }
  };

  const loginWithGoogle = async (idToken: string) => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_token: idToken }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errorMsg = data.error?.message || data.message || data.detail || 'Google sign-in failed.';
        throw new Error(errorMsg);
      }
      localStorage.setItem('dr_access_token', data.access_token);
      localStorage.setItem('dr_refresh_token', data.refresh_token);
      setToken(data.access_token);
      setUser(data.user);
      setActiveTenant(data.active_tenant || null);
      setWorkspaces(data.workspaces || []);
      await refreshUsage();
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem('dr_access_token');
    localStorage.removeItem('dr_refresh_token');
    setToken(null);
    setUser(null);
    setActiveTenant(null);
    setWorkspaces([]);
    refreshUsage();
  };

  const switchWorkspace = (tenantId: string) => {
    const target = workspaces.find((w) => w.id === tenantId);
    if (target) {
      setActiveTenant(target);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        activeTenant,
        workspaces,
        usage,
        isLoading,
        login,
        signup,
        loginWithGoogle,
        logout,
        switchWorkspace,
        refreshUsage,
        getAuthHeaders,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
