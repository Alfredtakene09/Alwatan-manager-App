<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { LogOut, ChevronRight, ChevronDown, Menu, X } from '@lucide/vue'
import { useAuthStore } from '@/stores/auth'
import { fullName } from '@/lib/roles'
import { CLINIC } from '@/lib/clinic'
import {
  getNavigation,
  hasNavChildChildren,
  hasNavChildren,
  isNavChildGroupActive,
  isNavGroupActive,
  isNavItemActive,
  type NavChildItem,
  type NavItem,
} from '@/lib/navigation'
import { useAppI18n } from '@/i18n/useAppI18n'
import UiButton from '@/components/ui/UiButton.vue'
import LanguageSwitcher from '@/components/LanguageSwitcher.vue'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const { t, isArabic, localeCode, navLabel, roleLabel } = useAppI18n()

const navConfig = computed(() =>
  auth.user ? getNavigation(auth.user.role) : { sidebarTitle: 'Navigation', sections: [] },
)

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

function isGroupExpanded(item: NavItem) {
  return expandedGroups.value.has(groupKey(item))
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

function isChildGroupExpanded(parentLabel: string, child: NavChildItem) {
  return (
    expandedChildGroups.value.has(childGroupKey(parentLabel, child)) ||
    isNavChildGroupActive(route.path, child)
  )
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
          <template v-for="(section, sectionIdx) in navConfig.sections" :key="sectionIdx">
            <div
              class="nav-section"
              :class="{ 'nav-section--bottom': section.pinnedBottom }"
            >
              <div v-if="section.label" class="nav-group__label">{{ navLabel(section.label) }}</div>

              <template v-for="item in section.items" :key="item.label + (item.to ?? '')">
              <div v-if="hasNavChildren(item)" class="nav-submenu">
                <button
                  type="button"
                  class="nav-item nav-item--group ui-card-frame ui-card-frame--menu"
                  :class="{ 'nav-item--group-open': isGroupExpanded(item), 'nav-item--group-active': isNavGroupActive(route.path, item) }"
                  @click="toggleGroup(item)"
                >
                  <span class="nav-item__icon">
                    <component :is="item.icon" :size="18" />
                  </span>
                  <span class="nav-item__text">
                    <span class="nav-item__label">{{ navLabel(item.label) }}</span>
                  </span>
                  <ChevronDown
                    :size="14"
                    class="nav-item__toggle"
                    :class="{ 'nav-item__toggle--collapsed': !isGroupExpanded(item) }"
                  />
                </button>

                <div v-show="isGroupExpanded(item)" class="nav-submenu__children">
                  <template v-for="child in item.children" :key="child.to ?? child.label">
                    <div v-if="hasNavChildChildren(child)" class="nav-submenu nav-submenu--nested">
                      <button
                        type="button"
                        class="nav-item nav-item--child nav-item--group ui-card-frame ui-card-frame--menu ui-card-frame--compact"
                        :class="{
                          'nav-item--group-open': isChildGroupExpanded(item.label, child),
                          'nav-item--group-active': isNavChildGroupActive(route.path, child),
                        }"
                        @click="toggleChildGroup(item.label, child)"
                      >
                        <span class="nav-item__icon nav-item__icon--child">
                          <component :is="child.icon" :size="16" />
                        </span>
                        <span class="nav-item__text">
                          <span class="nav-item__label">{{ navLabel(child.label) }}</span>
                        </span>
                        <ChevronDown
                          :size="12"
                          class="nav-item__toggle"
                          :class="{ 'nav-item__toggle--collapsed': !isChildGroupExpanded(item.label, child) }"
                        />
                      </button>

                      <div
                        v-show="isChildGroupExpanded(item.label, child)"
                        class="nav-submenu__children nav-submenu__children--nested"
                      >
                        <RouterLink
                          v-for="nested in child.children"
                          :key="nested.to"
                          :to="nested.to!"
                          class="nav-item nav-item--child nav-item--nested ui-card-frame ui-card-frame--menu ui-card-frame--compact"
                          :class="{ 'nav-item--active': isNavItemActive(route.path, nested.to!) }"
                        >
                          <span class="nav-item__icon nav-item__icon--child">
                            <component :is="nested.icon" :size="14" />
                          </span>
                          <span class="nav-item__text">
                            <span class="nav-item__label">{{ navLabel(nested.label) }}</span>
                          </span>
                          <ChevronRight
                            v-if="isNavItemActive(route.path, nested.to!)"
                            :size="14"
                            class="nav-item__chevron"
                          />
                        </RouterLink>
                      </div>
                    </div>

                    <RouterLink
                      v-else-if="child.to"
                      :to="child.to"
                      class="nav-item nav-item--child ui-card-frame ui-card-frame--menu ui-card-frame--compact"
                      :class="{ 'nav-item--active': isNavItemActive(route.path, child.to) }"
                    >
                      <span class="nav-item__icon nav-item__icon--child">
                        <component :is="child.icon" :size="16" />
                      </span>
                      <span class="nav-item__text">
                        <span class="nav-item__label">{{ navLabel(child.label) }}</span>
                      </span>
                      <ChevronRight v-if="isNavItemActive(route.path, child.to)" :size="14" class="nav-item__chevron" />
                    </RouterLink>
                  </template>
                </div>
              </div>

              <RouterLink
                v-else-if="item.to"
                :to="item.to"
                class="nav-item ui-card-frame ui-card-frame--menu"
                :class="{
                  'nav-item--active': isNavItemActive(route.path, item.to),
                  'nav-item--primary': item.primary && !isNavItemActive(route.path, item.to),
                }"
              >
                <span class="nav-item__icon" :class="{ 'nav-item__icon--primary': item.primary }">
                  <component :is="item.icon" :size="18" />
                </span>
                <span class="nav-item__text">
                  <span class="nav-item__label">{{ navLabel(item.label) }}</span>
                </span>
                <ChevronRight v-if="isNavItemActive(route.path, item.to)" :size="14" class="nav-item__chevron" />
              </RouterLink>
            </template>
            </div>
          </template>
        </nav>
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
          <LanguageSwitcher />

          <div class="topbar__status">
            <span class="status-dot" />
            <span class="topbar__status-text">{{ t('common.dbConnected') }}</span>
          </div>

          <div v-if="auth.user" class="topbar__user">
            <div class="topbar__user-avatar">{{ initials }}</div>
            <div class="topbar__user-info">
              <strong>{{ fullName(auth.user.firstName, auth.user.lastName) }}</strong>
              <span :class="{ 'lang-ar': isArabic }" :lang="isArabic ? 'ar' : undefined">{{ roleLabel(auth.user.role) }}</span>
            </div>
          </div>
        </div>
      </header>

      <main class="page-content" :class="{ 'page-content--dashboard': isDashboardPage }">
        <RouterView />
      </main>
    </div>
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
  left: 0;
  z-index: 200;
  width: var(--sidebar-width);
  height: 100%;
  height: 100dvh;
  background: var(--sidebar-bg);
  color: var(--sidebar-text-strong);
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--sidebar-border);
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

.nav-section {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.nav-section--bottom {
  margin-top: auto;
  padding-top: 0.85rem;
  border-top: 1px solid var(--sidebar-border);
}

.nav-group__label {
  padding: 0.75rem 0.875rem 0.3rem;
  font-size: 0.625rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--sidebar-text-muted);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
}

.nav-submenu {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.nav-submenu__children {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  margin-left: 0.65rem;
  padding-left: 0.55rem;
  border-left: 2px solid rgba(255, 255, 255, 0.2);
}

.nav-submenu--nested {
  gap: 0.1rem;
}

.nav-submenu__children--nested {
  margin-left: 0.45rem;
  padding-left: 0.45rem;
}

.nav-item--nested {
  padding: 0.42rem 0.6rem;
  font-size: 0.75rem;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.7rem 0.85rem;
  color: var(--menu-btn-text);
  font-size: 0.875rem;
  font-weight: 700;
  width: 100%;
  text-align: left;
  cursor: pointer;
  text-decoration: none;
  margin-bottom: 0.35rem;
}

.nav-item--group {
  margin-top: 0.15rem;
}

.nav-item--group-active {
  color: var(--menu-btn-text-active);
}

.nav-item--child {
  padding: 0.5rem 0.7rem;
  font-size: 0.8125rem;
  margin-bottom: 0.2rem;
}

.nav-item__icon--child {
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 8px;
  background: var(--sidebar-icon-bg);
  color: var(--sidebar-icon-text);
}

.nav-item__toggle {
  flex-shrink: 0;
  opacity: 1;
  color: var(--menu-btn-text);
  transition: transform 0.2s ease;
}

.nav-item__toggle--collapsed {
  transform: rotate(-90deg);
}

.nav-item:hover {
  color: var(--menu-btn-text-hover);
}

.nav-item--primary {
  color: var(--menu-btn-text-active);
}

.nav-item--primary:hover {
  color: var(--menu-btn-text-hover);
}

.nav-item--active {
  color: var(--menu-btn-text-active);
}

.nav-item--active:hover {
  color: var(--menu-btn-text-hover);
}

.nav-item__icon {
  width: 2.1rem;
  height: 2.1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 9px;
  background: var(--sidebar-icon-bg);
  color: var(--sidebar-icon-text);
  flex-shrink: 0;
  transition: background 0.18s, color 0.18s;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
}

.nav-item:hover .nav-item__icon {
  background: #f4f6ef;
  color: var(--sidebar-icon-text);
}

.nav-item__icon--primary {
  background: #f4f6ef;
  color: var(--sidebar-icon-text);
}

.nav-item--active .nav-item__icon {
  background: #ffffff;
  color: var(--sidebar-icon-text);
}

.nav-item--active:hover .nav-item__icon {
  background: #f4f6ef;
  color: var(--sidebar-icon-text);
}

.nav-item__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.nav-item__label {
  font-size: 0.875rem;
  font-weight: 700;
  line-height: 1.25;
  color: inherit;
}

.nav-item__desc {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--menu-btn-desc);
  line-height: 1.3;
  opacity: 1;
}

.nav-item:hover .nav-item__desc {
  color: var(--accent-200);
  opacity: 1;
}

.nav-item--active .nav-item__desc {
  color: var(--accent-100);
  opacity: 1;
}

.nav-item__chevron {
  opacity: 1;
  flex-shrink: 0;
  color: var(--menu-btn-text);
}

.sidebar__footer {
  flex-shrink: 0;
  margin-top: auto;
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
  margin-left: var(--sidebar-width);
  height: 100%;
  height: 100dvh;
  overflow: hidden;
}

/* Sidebar à droite en arabe (sans dir=rtl global) */
.app-shell--ar .sidebar {
  left: auto;
  right: 0;
  border-right: none;
  border-left: 1px solid var(--sidebar-border);
  box-shadow: -2px 0 20px rgba(20, 26, 14, 0.25);
}

.app-shell--ar .main-area {
  margin-left: 0;
  margin-right: var(--sidebar-width);
}

.app-shell--ar .sidebar__brand {
  flex-direction: row-reverse;
}

.app-shell--ar .nav-item {
  flex-direction: row-reverse;
  text-align: right;
}

.app-shell--ar .nav-submenu__children {
  margin-left: 0;
  margin-right: 0.65rem;
  padding-left: 0;
  padding-right: 0.55rem;
  border-left: none;
  border-right: 2px solid rgba(255, 255, 255, 0.2);
}

.app-shell--ar .nav-submenu__children--nested {
  margin-right: 0.45rem;
  padding-right: 0.45rem;
}

.app-shell--ar .nav-item__chevron {
  transform: scaleX(-1);
}

.app-shell--ar .nav-item__toggle--collapsed {
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

.topbar__status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.85rem;
  background: var(--success-bg);
  color: var(--success);
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
  white-space: nowrap;
}

.status-dot {
  width: 7px;
  height: 7px;
  background: var(--success);
  border-radius: 50%;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
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

  .sidebar--open {
    transform: translateX(0);
  }

  .app-shell--ar .sidebar {
    transform: translateX(100%);
  }

  .app-shell--ar .sidebar--open {
    transform: translateX(0);
  }

  .sidebar-backdrop {
    display: block;
  }

  .main-area {
    margin-left: 0;
  }

  .app-shell--ar .main-area {
    margin-right: 0;
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

  .topbar__status-text {
    display: none;
  }

  .topbar__status {
    padding: 0.35rem 0.65rem;
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
