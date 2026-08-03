<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { LogOut, Menu, X } from '@lucide/vue'
import { useAuthStore } from '@/stores/auth'
import { fullName, canAccessModule, getDefaultRoute } from '@/lib/roles'
import { CLINIC } from '@/lib/clinic'
import { getNavigation, type NavChildItem, type NavItem } from '@/lib/navigation'
import { useAppI18n } from '@/i18n/useAppI18n'
import api from '@/api/client'
import UiButton from '@/components/ui/UiButton.vue'
import LanguageSwitcher from '@/components/LanguageSwitcher.vue'
import InstallAppBanner from '@/components/pwa/InstallAppBanner.vue'
import SidebarNavSections from '@/components/layout/SidebarNavSections.vue'
import ProfileAccountModal from '@/components/ProfileAccountModal.vue'
import GlobalAlertsBell from '@/components/layout/GlobalAlertsBell.vue'
import DoctorOvertimeSubmitButton from '@/components/layout/DoctorOvertimeSubmitButton.vue'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const { t, isArabic, localeCode, navLabel, roleLabel } = useAppI18n()
const showProfileModal = ref(false)

type NavBadges = {
  depenses?: number
  salaires?: number
  caisse?: number
}

const navBadges = ref<NavBadges>({})
let badgesTimer: ReturnType<typeof setInterval> | undefined

async function loadNavBadges() {
  if (!auth.user) {
    navBadges.value = {}
    return
  }
  try {
    if (canAccessModule(auth.user.role, 'gestionnaire')) {
      const { data } = await api.get<NavBadges>('/dashboard/gestionnaire/nav-badges')
      navBadges.value = data
    } else if (canAccessModule(auth.user.role, 'admin')) {
      const { data } = await api.get<NavBadges>('/dashboard/admin/nav-badges')
      navBadges.value = data
    } else {
      navBadges.value = {}
    }
  } catch {
    navBadges.value = {}
  }
}

onMounted(() => {
  void loadNavBadges()
  badgesTimer = setInterval(() => {
    void loadNavBadges()
  }, 90_000)
})
onUnmounted(() => {
  if (badgesTimer) clearInterval(badgesTimer)
})
watch(() => auth.user?.id, () => {
  void loadNavBadges()
})

const navConfig = computed(() =>
  auth.user ? getNavigation(auth.user.role) : { sidebarTitle: 'Navigation', sections: [] },
)

const mainNavSections = computed(() => navConfig.value.sections.filter((section) => !section.pinnedBottom))
const pinnedNavSections = computed(() => navConfig.value.sections.filter((section) => section.pinnedBottom))

const expandedGroups = ref<Set<string>>(new Set())
const expandedChildGroups = ref<Set<string>>(new Set())
const sidebarOpen = ref(false)

function closeSidebar() {
  sidebarOpen.value = false
}

function toggleSidebar() {
  sidebarOpen.value = !sidebarOpen.value
}

watch(
  () => route.path,
  () => {
    closeSidebar()
  },
)

watch(sidebarOpen, (open) => {
  if (typeof document === 'undefined') return
  document.body.style.overflow = open ? 'hidden' : ''
})

onUnmounted(() => {
  if (typeof document !== 'undefined') document.body.style.overflow = ''
})

function groupKey(item: NavItem) {
  return item.label
}

function toggleGroup(item: NavItem) {
  const key = groupKey(item)
  if (expandedGroups.value.has(key)) {
    expandedGroups.value = new Set()
    return
  }
  expandedGroups.value = new Set([key])
}

function childGroupKey(parentLabel: string, child: NavChildItem) {
  return `${parentLabel}/${child.label}`
}

function toggleChildGroup(parentLabel: string, child: NavChildItem) {
  const key = childGroupKey(parentLabel, child)
  const next = new Set(expandedChildGroups.value)
  if (next.has(key)) {
    next.delete(key)
  } else {
    next.add(key)
  }
  expandedChildGroups.value = next
}

const isDashboardPage = computed(() => Boolean(route.meta.dashboard))

const initials = computed(() => {
  if (!auth.user) return '?'
  return `${auth.user.firstName[0]}${auth.user.lastName[0]}`.toUpperCase()
})

async function logout() {
  await auth.logout()
  router.push('/login')
}

function openProfileModal() {
  showProfileModal.value = true
}

function closeProfileModal() {
  showProfileModal.value = false
  if (route.name === 'mon-compte' && auth.user) {
    void router.replace(getDefaultRoute(auth.user.role))
  }
}

watch(
  () => route.name,
  (name) => {
    if (name === 'mon-compte') {
      showProfileModal.value = true
    }
  },
  { immediate: true },
)
</script>

<template>
  <div class="app-shell" :class="{ 'app-shell--ar': isArabic }" :key="localeCode">
    <button
      type="button"
      class="sidebar-backdrop"
      :class="{ 'sidebar-backdrop--visible': sidebarOpen }"
      :aria-label="t('common.closeMenu')"
      @click="closeSidebar"
    />

    <aside
      class="sidebar"
      :class="{ 'sidebar--open': sidebarOpen, 'lang-ar': isArabic }"
      :lang="isArabic ? 'ar' : undefined"
    >
      <div class="sidebar__brand">
        <div class="sidebar__logo">
          <img :src="CLINIC.logo" :alt="CLINIC.nameFr" />
        </div>
        <div>
          <strong>{{ isArabic ? CLINIC.nameAr : CLINIC.nameFr }}</strong>
          <span v-if="!isArabic" class="sidebar__brand-ar lang-ar" lang="ar">{{ CLINIC.nameAr }}</span>
          <span v-else class="sidebar__brand-ar">{{ CLINIC.nameFr }}</span>
        </div>
      </div>

      <div class="sidebar__body">
        <div class="sidebar__section-label">{{ navLabel(navConfig.sidebarTitle) }}</div>
        <nav class="sidebar__nav">
          <SidebarNavSections
            :sections="mainNavSections"
            :expanded-groups="expandedGroups"
            :expanded-child-groups="expandedChildGroups"
            :badges="navBadges"
            @toggle-group="toggleGroup"
            @toggle-child-group="toggleChildGroup"
          />
        </nav>
      </div>

      <div v-if="pinnedNavSections.length" class="sidebar__pinned">
        <SidebarNavSections
          :sections="pinnedNavSections"
          :expanded-groups="expandedGroups"
          :expanded-child-groups="expandedChildGroups"
          :badges="navBadges"
          @toggle-group="toggleGroup"
          @toggle-child-group="toggleChildGroup"
        />
      </div>

      <div class="sidebar__footer">
        <UiButton
          variant="danger"
          size="sm"
          block
          :icon="LogOut"
          class="sidebar__logout ui-card-frame ui-card-frame--logout ui-card-frame--compact"
          @click="logout"
        >
          Déconnexion
        </UiButton>
      </div>
    </aside>

    <div class="main-area">
      <header class="topbar">
        <div class="topbar__left">
          <button
            type="button"
            class="topbar__menu-btn"
            :aria-label="sidebarOpen ? t('common.closeMenu') : t('common.openMenu')"
            @click="toggleSidebar"
          >
            <X v-if="sidebarOpen" :size="22" />
            <Menu v-else :size="22" />
          </button>
          <img class="topbar__logo" :src="CLINIC.logo" :alt="CLINIC.nameFr" />
        </div>

        <div class="topbar__right">
          <DoctorOvertimeSubmitButton />
          <GlobalAlertsBell />
          <LanguageSwitcher />

          <button
            v-if="auth.user"
            type="button"
            class="topbar__user"
            :aria-label="t('common.myAccount')"
            :title="t('common.myAccount')"
            @click="openProfileModal"
          >
            <div class="topbar__user-avatar">{{ initials }}</div>
            <div class="topbar__user-info">
              <strong>{{ fullName(auth.user.firstName, auth.user.lastName) }}</strong>
              <span :class="{ 'lang-ar': isArabic }" :lang="isArabic ? 'ar' : undefined">{{ roleLabel(auth.user.role) }}</span>
            </div>
          </button>
        </div>
      </header>

      <main class="page-content" :class="{ 'page-content--dashboard': isDashboardPage }">
        <InstallAppBanner />
        <RouterView />
      </main>
    </div>

    <ProfileAccountModal :open="showProfileModal" @close="closeProfileModal" />
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  height: 100%;
  overflow: hidden;
  background: var(--bg-app);
}

.sidebar {
  position: fixed;
  top: 0;
  inset-inline-start: 0;
  z-index: 200;
  width: var(--sidebar-width);
  height: 100%;
  height: 100dvh;
  background: var(--sidebar-bg);
  color: var(--sidebar-text-strong);
  display: flex;
  flex-direction: column;
  border-inline-end: 1px solid var(--sidebar-border);
  box-shadow: 2px 0 20px rgba(20, 26, 14, 0.25);
  overflow: hidden;
  transition: transform 0.28s ease;
}

.sidebar-backdrop {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 190;
  border: none;
  padding: 0;
  margin: 0;
  background: rgba(15, 20, 8, 0.45);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.28s ease;
  cursor: pointer;
}

.sidebar-backdrop--visible {
  opacity: 1;
  pointer-events: auto;
}

.sidebar__brand {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  padding: 1.5rem 1.25rem;
  border-bottom: 1px solid var(--sidebar-border);
}

.sidebar__logo {
  width: 3rem;
  height: 3rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fff;
  border-radius: 14px;
  border: 1px solid var(--sidebar-border);
  overflow: hidden;
  flex-shrink: 0;
  box-shadow: var(--shadow-sm);
}

.sidebar__logo img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  padding: 0.2rem;
}

.sidebar__brand strong {
  display: block;
  font-size: 0.875rem;
  font-weight: 800;
  line-height: 1.3;
  color: var(--sidebar-text-strong);
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}

.sidebar__brand-ar {
  display: block;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--sidebar-text-muted);
  margin-top: 0.15rem;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

.sidebar__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overflow-x: hidden;
}

.sidebar__section-label {
  padding: 0 1.25rem;
  margin-bottom: 0.5rem;
  margin-top: 0.75rem;
  font-size: 0.6875rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--sidebar-text-muted);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
  flex-shrink: 0;
}

.sidebar__nav {
  flex: 1;
  min-height: 0;
  padding: 0 0.75rem 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.sidebar__pinned {
  flex: 0 1 auto;
  min-height: 0;
  max-height: min(52vh, 26rem);
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding: 0.65rem 0.75rem 0.35rem;
  border-top: 1px solid var(--sidebar-border);
  background: var(--sidebar-bg);
}

.sidebar__pinned :deep(.nav-section--bottom) {
  margin-top: 0;
  padding-top: 0;
  border-top: none;
}

.sidebar__pinned :deep(.nav-submenu__children) {
  padding-bottom: 0.35rem;
}

.sidebar__footer {
  flex-shrink: 0;
  margin-top: 0;
  padding: 0.85rem 1rem 1rem;
  border-top: 1px solid var(--sidebar-border);
  background: var(--sidebar-bg-footer, rgba(0, 0, 0, 0.12));
}

.sidebar__logout {
  justify-content: center;
}

.main-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  margin-inline-start: var(--sidebar-width);
  height: 100%;
  height: 100dvh;
  overflow: hidden;
}

/* Affinages arabe (dir=rtl gère déjà le placement via propriétés logiques) */
.app-shell--ar .sidebar {
  box-shadow: -2px 0 20px rgba(20, 26, 14, 0.25);
}

.app-shell--ar :deep(.nav-item__chevron) {
  transform: scaleX(-1);
}

.app-shell--ar :deep(.nav-item__toggle--collapsed) {
  transform: rotate(90deg);
}

.topbar__menu-btn {
  display: none;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  flex-shrink: 0;
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text);
  cursor: pointer;
  box-shadow: var(--shadow-sm);
}

.topbar__menu-btn:hover {
  border-color: var(--accent-400);
  color: var(--primary-800);
}

.topbar {
  position: sticky;
  top: 0;
  z-index: 100;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 2rem;
  background: linear-gradient(180deg, #ffffff 0%, #fafcf7 100%);
  border-bottom: 1px solid var(--border);
  box-shadow: var(--shadow-sm);
  isolation: isolate;
}

.topbar::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: var(--panel-accent-bar);
}

.topbar__left {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  min-width: 0;
}

.topbar__right {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-shrink: 0;
}

.topbar__user {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.4rem 0.85rem 0.4rem 0.65rem;
  background: var(--menu-btn-bg);
  border: 2px solid var(--menu-btn-border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-sm);
  text-decoration: none;
  text-align: start;
  font: inherit;
  color: inherit;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
}

.topbar__user:hover {
  border-color: var(--primary-500, #1b4f9c);
  background: var(--primary-50, #e8f1fb);
  box-shadow: var(--shadow-md, 0 4px 12px rgba(15, 40, 80, 0.12));
}

.topbar__user:focus-visible {
  outline: none;
  border-color: var(--primary-500, #1b4f9c);
  box-shadow: 0 0 0 3px rgba(27, 79, 156, 0.25);
}

.topbar__user-avatar {
  width: 2.25rem;
  height: 2.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--accent-500), var(--accent-700));
  color: #fff;
  border-radius: 9px;
  font-size: 0.7rem;
  font-weight: 700;
  flex-shrink: 0;
}

.topbar__user-info {
  min-width: 0;
}

.topbar__user-info strong {
  display: block;
  font-size: 0.8125rem;
  font-weight: 700;
  color: var(--menu-btn-text);
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 12rem;
}

.topbar__user-info span {
  display: block;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--menu-btn-desc);
  line-height: 1.2;
}

.topbar__logo {
  width: 2.5rem;
  height: 2.5rem;
  object-fit: contain;
  border-radius: 8px;
  background: #fff;
  border: 2px solid var(--panel-border);
  padding: 0.15rem;
  flex-shrink: 0;
}

.page-content {
  flex: 1;
  min-height: 0;
  padding: var(--page-padding-y) var(--page-padding-x) calc(2.5rem + var(--safe-bottom));
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  background: var(--bg-app);
}

/* ── Tablette ── */
@media (max-width: 1023px) {
  .sidebar {
    width: min(var(--sidebar-width-tablet), 85vw);
    transform: translateX(-100%);
  }

  html[dir='rtl'] .sidebar {
    transform: translateX(100%);
  }

  .sidebar--open,
  html[dir='rtl'] .sidebar--open {
    transform: translateX(0);
  }

  .sidebar-backdrop {
    display: block;
  }

  .main-area {
    margin-inline-start: 0;
  }

  .topbar__menu-btn {
    display: flex;
  }

  .topbar {
    padding: 0.85rem 1.25rem;
    padding-top: calc(0.85rem + var(--safe-top));
    gap: 0.75rem;
  }

}

/* ── Mobile ── */
@media (max-width: 639px) {
  .sidebar {
    width: min(18rem, 92vw);
  }

  .sidebar__brand {
    padding: 1.15rem 1rem;
  }

  .sidebar__brand-ar {
    font-size: 0.6875rem;
  }

  .topbar {
    flex-wrap: wrap;
    padding: 0.75rem 1rem;
    padding-top: calc(0.75rem + var(--safe-top));
  }

  .topbar__left {
    flex: 1;
    min-width: 0;
  }

  .topbar__right {
    width: 100%;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .topbar__user-info span {
    display: none;
  }

  .topbar__user-info strong {
    max-width: 8rem;
    font-size: 0.75rem;
  }

  .topbar__logo {
    width: 2.15rem;
    height: 2.15rem;
  }

  .page-content {
    padding-bottom: calc(1.5rem + var(--safe-bottom));
  }
}

/* ── Très petit écran ── */
@media (max-width: 380px) {
  .nav-item__label {
    font-size: 0.8125rem;
  }
}

.page-content--dashboard {
  background:
    radial-gradient(circle at top right, rgba(20, 184, 166, 0.08), transparent 42%),
    radial-gradient(circle at 10% 20%, rgba(59, 130, 246, 0.06), transparent 38%),
    var(--bg-app);
}

</style>
