import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { canAccessModule, getDefaultRoute } from '@/lib/roles'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue'), meta: { public: true } },
    {
      path: '/',
      component: () => import('@/layouts/AppLayout.vue'),
      children: [
        { path: '', redirect: '/login' },
        { path: 'dashboard', name: 'dashboard', component: () => import('@/views/DashboardView.vue'), meta: { module: 'dashboard', dashboard: true } },
        { path: 'reception', name: 'reception-dashboard', component: () => import('@/views/ReceptionDashboardView.vue'), meta: { module: 'reception' } },
        {
          path: 'reception/tableau-de-bord',
          name: 'reception-tableau-de-bord',
          component: () => import('@/views/dashboard/ReceptionDashboardStatsView.vue'),
          meta: { module: 'reception', dashboard: true },
        },
        { path: 'reception/etat-patients', name: 'reception-etat', component: () => import('@/views/ReceptionQueueView.vue'), meta: { module: 'reception' } },
        { path: 'reception/comptabilite', name: 'reception-comptabilite', component: () => import('@/views/ReceptionComptabiliteView.vue'), meta: { module: 'reception' } },
        {
          path: 'reception/en-attente-paiement',
          name: 'reception-attente-paiement',
          component: () => import('@/views/comptabilite/ComptabiliteAttentePaiementView.vue'),
          meta: { module: 'reception' },
        },
        {
          path: 'reception/examens-payes',
          name: 'reception-examens-payes',
          component: () => import('@/views/comptabilite/ComptabiliteExamensPayesView.vue'),
          meta: { module: 'reception' },
        },
        {
          path: 'reception/examens-payes/reclamations',
          name: 'reception-examens-reclamations',
          component: () => import('@/views/comptabilite/ComptabiliteExamReclamationsView.vue'),
          meta: { module: 'reception' },
        },
        {
          path: 'reception/patient-externe',
          name: 'reception-patient-externe',
          component: () => import('@/views/reception/ReceptionExternalPatientView.vue'),
          meta: { module: 'reception' },
        },
        {
          path: 'reception/operations-attente',
          name: 'reception-operations-attente',
          component: () => import('@/views/operations/OperationsAttenteView.vue'),
          meta: { module: 'reception' },
        },
        {
          path: 'reception/operations-effectuees',
          name: 'reception-operations-effectuees',
          component: () => import('@/views/operations/OperationsEffectueesView.vue'),
          meta: { module: 'reception' },
        },
        {
          path: 'reception/depenses',
          name: 'reception-depenses',
          component: () => import('@/views/reception/ReceptionDepensesView.vue'),
          meta: { module: 'reception' },
        },
        {
          path: 'reception/coupure-monnaie',
          name: 'reception-coupure-monnaie',
          component: () => import('@/views/reception/ReceptionCoupureMonnaieView.vue'),
          meta: { module: 'reception' },
        },
        { path: 'reception/bloc-operatoire', redirect: '/reception/operations-attente' },
        { path: 'reception/file-attente', redirect: '/reception/etat-patients' },
        { path: 'consultation', name: 'consultation', component: () => import('@/views/ConsultationView.vue'), meta: { module: 'consultation' } },
        { path: 'medecin/tableau-de-bord', redirect: '/consultation' },
        {
          path: 'medecin/deja-consulte',
          name: 'medecin-deja-consulte',
          component: () => import('@/views/MedecinDejaConsulteView.vue'),
          meta: { module: 'consultation' },
        },
        { path: 'medecin/labs', redirect: '/medecin/labs-attente' },
        {
          path: 'medecin/labs-attente',
          name: 'medecin-labs-attente',
          component: () => import('@/views/MedecinLabsAttenteView.vue'),
          meta: { module: 'consultation' },
        },
        {
          path: 'medecin/labs-resultats',
          name: 'medecin-labs-resultats',
          component: () => import('@/views/MedecinLabsResultatsView.vue'),
          meta: { module: 'consultation' },
        },
        {
          path: 'medecin/labs-resultats/dossier/:visitId',
          name: 'medecin-labs-resultats-dossier',
          component: () => import('@/views/MedecinLabResultatsDossierView.vue'),
          meta: { module: 'consultation' },
        },
        {
          path: 'medecin/operations',
          name: 'medecin-operations',
          component: () => import('@/views/MedecinOperationsView.vue'),
          meta: { module: 'consultation' },
        },
        {
          path: 'dossier-patient',
          name: 'dossier-patient',
          component: () => import('@/views/PatientDossierView.vue'),
          meta: { module: 'dossier-patient' },
        },
        { path: 'comptabilite', redirect: '/comptabilite/en-attente-paiement' },
        {
          path: 'comptabilite/tableau-de-bord',
          name: 'comptabilite-tableau-de-bord',
          component: () => import('@/views/comptabilite/ComptabiliteEncaissementsDashboardView.vue'),
          meta: { module: 'comptabilite', dashboard: true },
        },
        { path: 'comptabilite/encaissements', redirect: '/comptabilite/journal-encaissements' },
        {
          path: 'comptabilite/journal-encaissements',
          name: 'comptabilite-journal-encaissements',
          component: () => import('@/views/comptabilite/ComptabiliteEncaissementsJournalView.vue'),
          meta: { module: 'comptabilite' },
        },
        {
          path: 'hospitalisation',
          name: 'hospitalisation',
          component: () => import('@/views/HospitalisationView.vue'),
          meta: { module: 'hospitalisation' },
        },
        {
          path: 'comptabilite/parametres/salles',
          name: 'comptabilite-parametres-salles',
          component: () => import('@/views/comptabilite/ComptabiliteSallesParametresView.vue'),
          meta: { module: 'comptabilite' },
        },
        {
          path: 'comptabilite/salles-lits',
          redirect: '/hospitalisation',
        },
        {
          path: 'comptabilite/en-attente-paiement',
          name: 'comptabilite-attente-paiement',
          component: () => import('@/views/comptabilite/ComptabiliteAttentePaiementView.vue'),
          meta: { module: 'comptabilite' },
        },
        {
          path: 'comptabilite/examens-payes',
          name: 'comptabilite-examens-payes',
          component: () => import('@/views/comptabilite/ComptabiliteExamensPayesView.vue'),
          meta: { module: 'comptabilite' },
        },
        {
          path: 'comptabilite/examens-payes/reclamations',
          name: 'comptabilite-examens-reclamations',
          component: () => import('@/views/comptabilite/ComptabiliteExamReclamationsView.vue'),
          meta: { module: 'comptabilite' },
        },
        {
          path: 'comptabilite/compte-rendu-caisse',
          name: 'comptabilite-compte-rendu-caisse',
          component: () => import('@/views/comptabilite/ComptabiliteCompteRenduCaisseView.vue'),
          meta: { module: 'comptabilite' },
        },
        {
          path: 'comptabilite/depenses',
          name: 'comptabilite-depenses',
          component: () => import('@/views/comptabilite/ComptabiliteDepensesView.vue'),
          meta: { module: 'comptabilite' },
        },
        {
          path: 'comptabilite/coupure-monnaie',
          name: 'comptabilite-coupure-monnaie',
          component: () => import('@/views/comptabilite/ComptabiliteCoupureMonnaieView.vue'),
          meta: { module: 'comptabilite' },
        },
        {
          path: 'comptabilite/compte-rendu-receptions',
          redirect: { path: '/reception/comptabilite', query: { tab: 'consultations' } },
        },
        {
          path: 'comptabilite/operations-attente',
          name: 'comptabilite-operations-attente',
          component: () => import('@/views/operations/OperationsAttenteView.vue'),
          meta: { module: 'comptabilite' },
        },
        {
          path: 'comptabilite/operations-effectuees',
          name: 'comptabilite-operations-effectuees',
          component: () => import('@/views/operations/OperationsEffectueesView.vue'),
          meta: { module: 'comptabilite' },
        },
        { path: 'comptabilite/bloc-operatoire', redirect: '/comptabilite/operations-attente' },
        {
          path: 'comptabilite/comptes-rendus',
          name: 'comptabilite-comptes-rendus',
          component: () => import('@/views/comptabilite/ComptabiliteComptesRendusView.vue'),
          meta: { module: 'comptabilite' },
        },
        {
          path: 'comptabilite/types-examen/examen',
          name: 'comptabilite-types-examen',
          component: () => import('@/views/comptabilite/exam-types/ComptabiliteExamCatalogTypesView.vue'),
          props: { kind: 'examen' },
          meta: { module: 'comptabilite' },
        },
        {
          path: 'comptabilite/types-examen/odonto',
          name: 'comptabilite-types-odonto',
          component: () => import('@/views/comptabilite/exam-types/ComptabiliteExamCatalogTypesView.vue'),
          props: { kind: 'odonto' },
          meta: { module: 'comptabilite' },
        },
        {
          path: 'comptabilite/types-examen/radio',
          name: 'comptabilite-types-radio',
          component: () => import('@/views/comptabilite/exam-types/ComptabiliteExamCatalogTypesView.vue'),
          props: { kind: 'radio' },
          meta: { module: 'comptabilite' },
        },
        {
          path: 'comptabilite/types-examen/echo',
          name: 'comptabilite-types-echo',
          component: () => import('@/views/comptabilite/exam-types/ComptabiliteExamCatalogTypesView.vue'),
          props: { kind: 'echo' },
          meta: { module: 'comptabilite' },
        },
        {
          path: 'comptabilite/types-examen/operation',
          name: 'comptabilite-types-operation',
          component: () => import('@/views/comptabilite/exam-types/ComptabiliteOperationTypesView.vue'),
          meta: { module: 'comptabilite' },
        },
        { path: 'bloc-salles', name: 'bloc-salles', component: () => import('@/views/BlocSallesView.vue'), meta: { module: 'bloc-salles' } },
        {
          path: 'bloc-salles/tableau-de-bord',
          name: 'bloc-salles-tableau-de-bord',
          component: () => import('@/views/dashboard/SoignantDashboardView.vue'),
          meta: { module: 'bloc-salles', dashboard: true },
        },
        { path: 'pharmacie', redirect: { name: 'pharmacie-caisse' } },
        {
          path: 'pharmacie/caisse',
          name: 'pharmacie-caisse',
          component: () => import('@/views/pharmacie/PharmacieCaisseView.vue'),
          meta: { module: 'pharmacie' },
        },
        {
          path: 'pharmacie/categories',
          name: 'pharmacie-categories',
          component: () => import('@/views/pharmacie/PharmacieCategoriesView.vue'),
          meta: { module: 'pharmacie' },
        },
        {
          path: 'pharmacie/produits',
          name: 'pharmacie-produits',
          component: () => import('@/views/pharmacie/PharmacieProductsView.vue'),
          meta: { module: 'pharmacie' },
        },
        {
          path: 'pharmacie/ventes',
          name: 'pharmacie-ventes',
          component: () => import('@/views/pharmacie/PharmacieSalesView.vue'),
          meta: { module: 'pharmacie' },
        },
        {
          path: 'pharmacie/rapports',
          name: 'pharmacie-rapports',
          component: () => import('@/views/pharmacie/PharmacieReportsView.vue'),
          meta: { module: 'pharmacie' },
        },
        {
          path: 'pharmacie/alertes',
          name: 'pharmacie-alertes',
          component: () => import('@/views/pharmacie/PharmacieAlertsView.vue'),
          meta: { module: 'pharmacie' },
        },
        {
          path: 'pharmacie/fournisseurs',
          name: 'pharmacie-fournisseurs',
          component: () => import('@/views/pharmacie/PharmacieSuppliersView.vue'),
          meta: { module: 'pharmacie' },
        },
        {
          path: 'pharmacie/mouvements',
          name: 'pharmacie-mouvements',
          component: () => import('@/views/pharmacie/PharmacieMovementsView.vue'),
          meta: { module: 'pharmacie' },
        },
        {
          path: 'pharmacie/tableau-de-bord',
          name: 'pharmacie-tableau-de-bord',
          component: () => import('@/views/dashboard/PharmacieDashboardView.vue'),
          meta: { module: 'pharmacie', dashboard: true },
        },
        { path: 'factures', name: 'factures', component: () => import('@/views/FacturesView.vue'), meta: { module: 'factures' } },
        { path: 'admin', name: 'admin', component: () => import('@/views/AdminView.vue'), meta: { module: 'admin' } },
        {
          path: 'admin/employes',
          name: 'admin-employes',
          component: () => import('@/views/EmployesView.vue'),
          meta: { module: 'utilisateurs' },
        },
        {
          path: 'admin/utilisateurs',
          name: 'admin-utilisateurs',
          component: () => import('@/views/UtilisateursView.vue'),
          meta: { module: 'utilisateurs' },
        },
        {
          path: 'admin/depenses',
          name: 'admin-depenses',
          component: () => import('@/views/admin/AdminDepensesView.vue'),
          meta: { module: 'admin' },
        },
        {
          path: 'admin/salaires',
          name: 'admin-salaires',
          component: () => import('@/views/admin/AdminSalairesView.vue'),
          meta: { module: 'admin' },
        },
        {
          path: 'admin/salaires/historique',
          redirect: { name: 'admin-salaires', query: { tab: 'historique' } },
        },
        { path: 'admin/salaires/fiches', redirect: '/admin/salaires' },
        {
          path: 'gestionnaire/tableau-de-bord',
          name: 'gestionnaire-dashboard',
          component: () => import('@/views/gestionnaire/GestionnaireDashboardView.vue'),
          meta: { module: 'gestionnaire', dashboard: true },
        },
        {
          path: 'gestionnaire/caisse',
          name: 'gestionnaire-caisse',
          component: () => import('@/views/gestionnaire/GestionnaireCaisseView.vue'),
          meta: { module: 'gestionnaire' },
        },
        {
          path: 'gestionnaire/livre-journal',
          name: 'gestionnaire-journal',
          component: () => import('@/views/gestionnaire/GestionnaireJournalView.vue'),
          meta: { module: 'gestionnaire' },
        },
        {
          path: 'gestionnaire/depenses',
          name: 'gestionnaire-depenses',
          component: () => import('@/views/gestionnaire/GestionnaireDepensesView.vue'),
          meta: { module: 'gestionnaire' },
        },
        {
          path: 'gestionnaire/depenses/categories',
          redirect: { name: 'gestionnaire-depenses', query: { tab: 'categories' } },
        },
        {
          path: 'gestionnaire/personnel',
          name: 'gestionnaire-personnel',
          component: () => import('@/views/EmployesView.vue'),
          meta: { module: 'gestionnaire', employeeRegistry: 'gestionnaire' },
        },
        {
          path: 'gestionnaire/salaires',
          name: 'gestionnaire-salaires',
          component: () => import('@/views/gestionnaire/GestionnaireSalairesView.vue'),
          meta: { module: 'gestionnaire' },
        },
        {
          path: 'gestionnaire/salaires/historique',
          redirect: { name: 'gestionnaire-salaires', query: { tab: 'historique' } },
        },
        {
          path: 'gestionnaire/finances',
          name: 'gestionnaire-finances',
          component: () => import('@/views/gestionnaire/GestionnaireFinancesView.vue'),
          meta: { module: 'gestionnaire', dashboard: true },
        },
        {
          path: 'gestionnaire/supervision',
          name: 'gestionnaire-supervision',
          component: () => import('@/views/gestionnaire/GestionnaireSupervisionView.vue'),
          meta: { module: 'gestionnaire' },
        },
        { path: 'laboratoire', name: 'laboratoire', component: () => import('@/views/LaboratoireView.vue'), meta: { module: 'laboratoire' } },
        {
          path: 'laboratoire/termines',
          name: 'laboratoire-termines',
          component: () => import('@/views/LaboratoireTerminesView.vue'),
          meta: { module: 'laboratoire' },
        },
        {
          path: 'laboratoire/dossier/:visitId',
          name: 'laboratoire-dossier',
          component: () => import('@/views/LaboratoireDossierView.vue'),
          meta: { module: 'laboratoire' },
        },
        { path: 'laboratoire/tableau-de-bord', redirect: '/laboratoire' },
        {
          path: 'mon-compte',
          name: 'mon-compte',
          component: () => import('@/views/ProfileView.vue'),
          meta: { account: true },
        },
      ],
    },
  ],
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()

  if (to.meta.public) {
    if (!auth.user) await auth.fetchMe()
    if (auth.user) return getDefaultRoute(auth.user.role)
    return true
  }

  if (!auth.user) {
    await auth.fetchMe()
  }

  if (!auth.user) return '/login'

  if (to.path === '/') {
    return getDefaultRoute(auth.user.role)
  }

  if (to.meta.account) {
    return true
  }

  const module = (to.meta.module as string) ?? 'consultation'
  if (!canAccessModule(auth.user.role, module)) {
    return getDefaultRoute(auth.user.role)
  }

  return true
})

export default router
