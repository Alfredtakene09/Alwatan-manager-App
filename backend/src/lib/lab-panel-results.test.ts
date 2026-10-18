import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hasAllRequiredLabPanelsFilled } from './lab-panel-results.js';

describe('lab-panel-results completeness', () => {
  it('bloque la validation si un panel prescrit reste vide', () => {
    const notes = [
      'Labo panel (routine) : {"glucose":"5.2"}',
      'Labo panel (thyroid) : {}',
    ].join('\n');

    assert.equal(hasAllRequiredLabPanelsFilled(notes, ['routine', 'thyroid']), false);
  });

  it('valide quand tous les panels prescrits ont au moins une valeur', () => {
    const notes = [
      'Labo panel (routine) : {"glucose":"5.2"}',
      'Labo panel (thyroid) : {"tsh":"1.8"}',
    ].join('\n');

    assert.equal(hasAllRequiredLabPanelsFilled(notes, ['routine', 'thyroid']), true);
  });
});
