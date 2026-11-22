<template>
  <div class="layout">
    <aside class="sidebar" :class="{ collapsed }">
      <div class="sidebar-brand" @click="$router.push('/dashboard')">
        <div class="brand-icon">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="8" fill="url(#brandGrad)" />
            <g transform="translate(5, 5) scale(1.3)" stroke="#fff" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 2h8a1 1 0 011 1v14a1 1 0 01-1 1H1a1 1 0 01-1-1V6l4-4z" fill="none" />
              <path d="M4 2v4H0" fill="none" />
              <line x1="3" y1="8" x2="10" y2="8" />
              <line x1="3" y1="11" x2="8" y2="11" />
              <line x1="3" y1="14" x2="6" y2="14" />
            </g>
            <defs>
              <linearGradient id="brandGrad" x1="0" y1="0" x2="32" y2="32">
                <stop stop-color="#ff6b6b"/>
                <stop offset="1" stop-color="#ffa94d"/>
              </linearGradient>
            </defs>
          </svg>
        </div>
        <span v-show="!collapsed" class="brand-text font-heading">SSE 报销</span>
      </div>

      <nav class="sidebar-nav">
        <router-link
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          class="nav-item"
          :class="{ active: $route.path === item.path || $route.path.startsWith(item.path + '/') }"
        >
          <span class="nav-icon" v-html="item.icon"></span>
          <span v-show="!collapsed" class="nav-label">{{ item.label }}</span>
          <span
            v-show="!collapsed && item.path === '/approvals' && pendingApprovalCount > 0"
            class="nav-badge"
          >{{ pendingApprovalCount }}</span>
        </router-link>
      </nav>

      <div class="sidebar-footer">
        <div class="sidebar-user" v-show="!collapsed">
          <div
            class="avatar avatar-coral"
            :style="auth.user?.avatarUrl ? { backgroundImage: `url(/api/auth/profile/avatar?userId=${auth.user?.id})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}"
          >{{ auth.user?.avatarUrl ? '' : userInitial }}</div>
          <span class="sidebar-user-name" @click="$router.push('/profile')">{{ auth.user?.name }}</span>
        </div>
        <button class="collapse-btn" @click="collapsed = !collapsed">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline :points="collapsed ? '15 18 9 12 15 6' : '9 18 15 12 9 6'" />
          </svg>
        </button>
      </div>
    </aside>

    <div class="main-area">
      <header class="topbar">
        <div class="topbar-left">
          <h2 class="page-title font-heading">{{ $route.meta.title || '' }}</h2>
        </div>
        <div class="topbar-right">
          <router-link to="/notifications" class="topbar-btn" title="消息">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            <span v-if="unreadCount > 0" class="topbar-count">{{ unreadCount > 99 ? '99+' : unreadCount }}</span>
          </router-link>
          <div class="topbar-user" @click="showUserMenu = !showUserMenu">
            <div
              class="avatar avatar-coral"
              style="width:34px;height:34px;font-size:0.8rem;"
              :style="auth.user?.avatarUrl ? { backgroundImage: `url(/api/auth/profile/avatar?userId=${auth.user?.id})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}"
            >{{ auth.user?.avatarUrl ? '' : userInitial }}</div>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-left:4px;">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </div>
          <div v-if="showUserMenu" class="user-menu" @mouseleave="showUserMenu = false">
            <router-link to="/profile" class="user-menu-item" @click="showUserMenu = false">个人中心</router-link>
            <div class="user-menu-item" @click="handleLogout">登出</div>
          </div>
        </div>
      </header>

      <main class="content">
        <router-view v-slot="{ Component }">
          <transition name="page" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import api from '../api/index'
import { APPROVER_ROLE_NAMES, canAccessRoute, navItemsForRole } from '@/permissions'

const auth = useAuthStore()
const collapsed = ref(false)
const showUserMenu = ref(false)
const pendingApprovalCount = ref(0)
const unreadCount = ref(0)

function handleLogout() {
  showUserMenu.value = false
  auth.logout()
}

const userInitial = computed(() => auth.user?.name?.charAt(0)?.toUpperCase() || 'U')

const navItems = computed(() => navItemsForRole(auth.user?.role))

onMounted(async () => {
  if (canAccessRoute(auth.user?.role, APPROVER_ROLE_NAMES)) {
    try {
      const res = await api.get('/approvals/pending')
      pendingApprovalCount.value = (res.data || []).length
    } catch {}
  }
  try {
    const res = await api.get('/notifications/unread-count')
    unreadCount.value = res.data.count || 0
  } catch {}
  setInterval(async () => {
    try {
      const res = await api.get('/notifications/unread-count')
      unreadCount.value = res.data.count || 0
    } catch {}
  }, 60000)
})
</script>

<style scoped>
.layout {
  display: flex;
  min-height: 100vh;
}

.sidebar {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  width: var(--sidebar-width);
  background: var(--bg-card);
  border-right: 1px solid var(--border-light);
  display: flex;
  flex-direction: column;
  transition: width var(--transition);
  z-index: 100;
  overflow: hidden;
  box-shadow: var(--shadow);
}
.sidebar.collapsed { width: var(--sidebar-collapsed); }

.sidebar-brand {
  height: var(--topbar-height);
  display: flex;
  align-items: center;
  padding: 0 18px;
  gap: 10px;
  cursor: pointer;
  border-bottom: 1px solid var(--border-light);
  flex-shrink: 0;
}
.brand-icon { display: flex; flex-shrink: 0; }
.brand-text { font-size: 1.25rem; color: var(--accent-coral); letter-spacing: 0.04em; }

.sidebar-nav {
  flex: 1;
  padding: 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 14px;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 0.9rem;
  font-weight: 500;
  transition: all var(--transition);
  white-space: nowrap;
  position: relative;
}
.nav-item:hover { background: var(--bg-hover); color: var(--text-primary); }
.nav-item.active { background: var(--accent-coral-bg); color: var(--accent-coral); }
.nav-item.active::before {
  content: '';
  position: absolute;
  left: -16px;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 20px;
  border-radius: 0 3px 3px 0;
  background: var(--accent-coral);
}
.nav-icon { display: flex; flex-shrink: 0; opacity: 0.65; }
.nav-item.active .nav-icon { opacity: 1; }

.nav-badge {
  margin-left: auto;
  background: var(--accent-coral);
  color: #fff;
  font-size: 0.7rem;
  font-weight: 700;
  min-width: 20px;
  height: 20px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 6px;
}

.sidebar-footer {
  padding: 12px 16px;
  border-top: 1px solid var(--border-light);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.sidebar-user { display: flex; align-items: center; gap: 10px; }
.sidebar-user-name {
  font-size: 0.85rem;
  color: var(--text-secondary);
  cursor: pointer;
  transition: color var(--transition);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sidebar-user-name:hover { color: var(--text-primary); }

.collapse-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--text-muted);
  border-radius: var(--radius-sm);
  transition: all var(--transition);
}
.collapse-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
.sidebar.collapsed .collapse-btn { margin: 0 auto; }
.sidebar.collapsed .sidebar-user { display: none; }
.sidebar.collapsed .nav-badge { display: none; }
.sidebar.collapsed .nav-item.active::before { display: none; }
.sidebar.collapsed .nav-item { justify-content: center; padding: 11px 0; }

.main-area {
  flex: 1;
  margin-left: var(--sidebar-width);
  transition: margin-left var(--transition);
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}
.sidebar.collapsed + .main-area { margin-left: var(--sidebar-collapsed); }

.topbar {
  height: var(--topbar-height);
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-light);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 28px;
  position: sticky;
  top: 0;
  z-index: 50;
  box-shadow: var(--shadow-sm);
}
.page-title { font-size: 1.2rem; color: var(--text-primary); letter-spacing: 0.03em; }
.topbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}
.topbar-btn {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  transition: all var(--transition);
  position: relative;
}
.topbar-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
.topbar-dot {
  position: absolute;
  top: 7px;
  right: 7px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent-coral);
  border: 2px solid var(--bg-card);
}
.topbar-count {
  position: absolute;
  top: -2px;
  right: -4px;
  background: var(--accent-coral);
  color: #fff;
  font-size: 0.6rem;
  font-weight: 700;
  min-width: 18px;
  height: 18px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 5px;
  border: 2px solid var(--bg-card);
}
.topbar-user {
  display: flex;
  align-items: center;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  transition: all var(--transition);
  position: relative;
}
.topbar-user:hover { background: var(--bg-hover); }

.user-menu {
  position: absolute;
  top: var(--topbar-height);
  right: 18px;
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow);
  min-width: 140px;
  z-index: 200;
  overflow: hidden;
}
.user-menu-item {
  display: block;
  padding: 10px 16px;
  font-size: 0.88rem;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition);
  text-decoration: none;
}
.user-menu-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.content {
  flex: 1;
  padding: 28px;
  overflow-y: auto;
}

@media (max-width: 768px) {
  .sidebar { transform: translateX(-100%); }
  .sidebar.collapsed { transform: translateX(0); width: var(--sidebar-width); }
  .main-area { margin-left: 0 !important; }
  .content { padding: 16px; }
}
</style>
