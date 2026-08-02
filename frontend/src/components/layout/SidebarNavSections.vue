<script setup lang="ts">
import { ChevronRight, ChevronDown } from '@lucide/vue'
import { useRoute, useRouter } from 'vue-router'
import {
  hasNavChildChildren,
  hasNavChildren,
  isNavChildGroupActive,
  isNavGroupActive,
  isNavItemActive,
  type NavChildItem,
  type NavItem,
  type NavSection,
} from '@/lib/navigation'
import { prefetchRoute } from '@/lib/prefetch-route'
import { useAppI18n } from '@/i18n/useAppI18n'

const props = defineProps<{
  sections: NavSection[]
  expandedGroups: Set<string>
  expandedChildGroups: Set<string>
  badges?: Partial<Record<'depenses' | 'salaires' | 'caisse', number>>
}>()

const emit = defineEmits<{
  toggleGroup: [item: NavItem]
  toggleChildGroup: [parentLabel: string, child: NavChildItem]
}>()

const route = useRoute()
const router = useRouter()
const { navLabel } = useAppI18n()

function prefetch(to?: string) {
  if (to) prefetchRoute(router, to)
}

function prefetchGroup(item: NavItem) {
  if (!item.children) return
  for (const child of item.children) {
    if (child.to) prefetch(child.to)
    if (child.children) {
      for (const nested of child.children) {
        if (nested.to) prefetch(nested.to)
      }
    }
  }
}

function onToggleGroup(item: NavItem) {
  emit('toggleGroup', item)
  prefetchGroup(item)
}

function onToggleChildGroup(parentLabel: string, child: NavChildItem) {
  emit('toggleChildGroup', parentLabel, child)
  if (child.children) {
    for (const nested of child.children) {
      if (nested.to) prefetch(nested.to)
    }
  }
}

function badgeCount(key?: 'depenses' | 'salaires' | 'caisse') {
  if (!key || !props.badges) return 0
  return props.badges[key] ?? 0
}

function groupKey(item: NavItem) {
  return item.label
}

function isGroupExpanded(item: NavItem) {
  return props.expandedGroups.has(groupKey(item)) || isNavGroupActive(route.path, item)
}

function childGroupKey(parentLabel: string, child: NavChildItem) {
  return `${parentLabel}/${child.label}`
}

function isChildGroupExpanded(parentLabel: string, child: NavChildItem) {
  return (
    props.expandedChildGroups.has(childGroupKey(parentLabel, child)) ||
    isNavChildGroupActive(route.path, child)
  )
}
</script>

<template>
  <template v-for="(section, sectionIdx) in sections" :key="sectionIdx">
    <div class="nav-section" :class="{ 'nav-section--bottom': section.pinnedBottom }">
      <div v-if="section.label" class="nav-group__label">{{ navLabel(section.label) }}</div>

      <template v-for="item in section.items" :key="item.label + (item.to ?? '')">
        <div v-if="hasNavChildren(item)" class="nav-submenu">
          <button
            type="button"
            class="nav-item nav-item--group ui-card-frame ui-card-frame--menu"
            :class="{
              'nav-item--group-open': isGroupExpanded(item),
              'nav-item--group-active': isNavGroupActive(route.path, item),
            }"
            @click="onToggleGroup(item)"
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
                  @click="onToggleChildGroup(item.label, child)"
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
                    @mouseenter="prefetch(nested.to)"
                    @focus="prefetch(nested.to)"
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
                @mouseenter="prefetch(child.to)"
                @focus="prefetch(child.to)"
              >
                <span class="nav-item__icon nav-item__icon--child">
                  <component :is="child.icon" :size="16" />
                </span>
                <span class="nav-item__text">
                  <span class="nav-item__label">{{ navLabel(child.label) }}</span>
                </span>
                <span v-if="badgeCount(child.badgeKey) > 0" class="nav-item__badge">
                  {{ badgeCount(child.badgeKey) }}
                </span>
                <ChevronRight v-else-if="isNavItemActive(route.path, child.to)" :size="14" class="nav-item__chevron" />
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
          @mouseenter="prefetch(item.to)"
          @focus="prefetch(item.to)"
        >
          <span class="nav-item__icon" :class="{ 'nav-item__icon--primary': item.primary }">
            <component :is="item.icon" :size="18" />
          </span>
          <span class="nav-item__text">
            <span class="nav-item__label">{{ navLabel(item.label) }}</span>
          </span>
          <span v-if="badgeCount(item.badgeKey) > 0" class="nav-item__badge">
            {{ badgeCount(item.badgeKey) }}
          </span>
          <ChevronRight v-else-if="isNavItemActive(route.path, item.to)" :size="14" class="nav-item__chevron" />
        </RouterLink>
      </template>
    </div>
  </template>
</template>

<style scoped>
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
  margin-inline-start: 0.65rem;
  padding-inline-start: 0.55rem;
  border-inline-start: 2px solid rgba(255, 255, 255, 0.2);
}

.nav-submenu--nested {
  gap: 0.1rem;
}

.nav-submenu__children--nested {
  margin-inline-start: 0.45rem;
  padding-inline-start: 0.45rem;
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
  text-align: start;
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

.nav-item__badge {
  margin-inline-start: auto;
  min-width: 1.2rem;
  height: 1.2rem;
  padding: 0 0.35rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: #dc2626;
  color: #fff;
  font-size: 0.6875rem;
  font-weight: 800;
  line-height: 1;
  flex-shrink: 0;
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
</style>
