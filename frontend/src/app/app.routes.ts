import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/landing').then(m => m.Landing), title: 'Peyto Checker · Airtel NOC' },
  { path: 'console', loadComponent: () => import('./pages/console').then(m => m.Console), title: 'Run Check · Peyto Checker' },
  { path: 'rings', loadComponent: () => import('./pages/rings').then(m => m.Rings), title: 'NPT Rings · Peyto Checker' },
  { path: 'rules', loadComponent: () => import('./pages/rules').then(m => m.Rules), title: 'Design Rules · Peyto Checker' },
  { path: '**', redirectTo: '' },
];
